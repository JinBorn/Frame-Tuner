// Integration check: requires npm install and an installed Chrome/Edge/Chromium.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const zlib = require("node:zlib");
const { chromium } = require("playwright-core");
const { createWorkbenchService } = require("./workbench_service");
const { createSamplePackage } = require("./cocos/sample_package");
const { findBrowser, startExportServer, run } = require("./frame_tuner");
const { buildExportPackage, crc32, writePackageDirectory } = require("./export_package");
const { normalizeAttackTrails } = require("./attack_trails");
const { unzip } = require("./export_package_test");

function solidPng() {
  const chunk = (type, data) => {
    const tag = Buffer.from(type), result = Buffer.alloc(data.length + 12);
    result.writeUInt32BE(data.length); tag.copy(result, 4); data.copy(result, 8);
    result.writeUInt32BE(crc32(Buffer.concat([tag, data])), data.length + 8); return result;
  };
  const header = Buffer.alloc(13); header.writeUInt32BE(8); header.writeUInt32BE(8, 4); header[8] = 8; header[9] = 6;
  const rows = Buffer.alloc(8 * 33);
  for (let y = 0; y < 8; y += 1) for (let x = 0; x < 8; x += 1) { const offset = y * 33 + 1 + x * 4; rows[offset] = 255; rows[offset + 1] = 255; rows[offset + 2] = 255; rows[offset + 3] = 255; }
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk("IHDR", header), chunk("IDAT", zlib.deflateSync(rows)), chunk("IEND", Buffer.alloc(0))]);
}

async function test() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "frame-tuner-browser-test-"));
  let server, browser;
  try {
    const service = createWorkbenchService({ root });
    service.createProject({ label: "Browser export", id: "browser-export" });
    const sample = createSamplePackage();
    service.importAnimation({ projectId: "browser-export", profileId: "hero", animationId: "idle", fps: 10,
      files: [0, 1, 2, 3].map((index) => ({ name: `frame_${index}.png`, data: `data:image/png;base64,${sample.files.get(`frames/demo_${index}.png`).toString("base64")}` })) });
    const data = service.projectData("browser-export");
    data.tuning.frame_playback_overrides = { "hero/idle:0": { duration: 1.2 }, "hero/idle:1": { disabled: true }, "hero/idle:2": { duration: 3.1 }, "hero/idle:3": { duration: 0.8 } };
    data.tuning.frame_visual_overrides = { "hero/idle:2": { visual_size: 1.5, offset: { x: 12, y: -8 }, rotation: 15 } };
    data.tuning.frame_box_overrides = { "hero/idle:2": { hurtbox: { enabled: true, offset: { x: 10, y: -20 }, size: { x: 30, y: 40 }, rotation: 12 } } };
    service.store.writeJson(data.paths.tuning, data.tuning);
    const audioPath = "workspace/projects/browser-export/tick.wav";
    fs.writeFileSync(path.join(root, audioPath), sample.files.get("audio/tick.wav"));
    service.store.writeJson(data.paths.frameAudio, [{ key: "browser-export:player:hero:actor:hero/idle:workspace/projects/browser-export/assets/hero/idle:2", path: audioPath, type: "audio/wav", name: "tick.wav", volume: 0.35,
      metadata: { projectId: "browser-export", tuningTarget: "player", profileId: "hero", groupType: "actor", animation: "hero/idle", source: "workspace/projects/browser-export/assets/hero/idle", frame: 2 } }]);
    const before = [data.paths.manifest, data.paths.tuning].map((file) => fs.readFileSync(file));
    server = await startExportServer(root);
    browser = await chromium.launch({ executablePath: findBrowser(), headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1 });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${server.url}/?project=browser-export`, { waitUntil: "networkidle" });
    await page.evaluate(() => window.XsxbFrameTunerLite.ready);
    const sequence = await page.evaluate(() => window.FrameTunerPortable.collectPayload({ format: "sequence" }));
    const frames = sequence.manifest.animations[0].frames;
    assert.deepEqual(frames.map((frame) => frame.sourceFrame), [0, 2, 3]);
    assert.deepEqual(frames.map((frame) => frame.durationMs), [120, 310, 80]);
    assert.deepEqual(frames.map((frame) => frame.timeMs), [0, 120, 430]);
    assert.equal(frames[1].audio[0].volume, 0.35);
    const box = frames[1].boxes.find((entry) => entry.kind === "hurtbox");
    assert.deepEqual(box.size, { x: 45, y: 60 }); assert.equal(box.rotation, 27);
    assert.ok(Math.abs(box.position.x - 34.25345874741165) < 0.000001);
    const sequencePackage = await buildExportPackage(sequence, { root, projectData: service.projectData("browser-export") });
    assert.ok(sequencePackage.files.has("source/editor-snapshot.json"));
    const sheet = await page.evaluate(() => window.FrameTunerPortable.collectPayload({ format: "sheet", columns: 2 }));
    const visual = await page.evaluate(async ({ sequence, sheet }) => {
      const read = async (data) => { const image = new Image(); image.src = data; await image.decode(); return image; };
      const atlas = await read(sheet.files.find((entry) => entry.path.endsWith("spritesheet.png")).data);
      const result = [];
      for (let index = 0; index < sequence.manifest.animations[0].frames.length; index += 1) {
        const frame = sequence.manifest.animations[0].frames[index], rect = sheet.manifest.animations[0].frames[index].atlasRect;
        const canvas = document.createElement("canvas"); canvas.width = frame.width; canvas.height = frame.height;
        const context = canvas.getContext("2d");
        context.drawImage(await read(sequence.files.find((entry) => entry.path === frame.path).data), 0, 0);
        const original = context.getImageData(0, 0, frame.width, frame.height).data;
        context.clearRect(0, 0, frame.width, frame.height);
        context.drawImage(atlas, rect.x, rect.y, rect.width, rect.height, 0, 0, frame.width, frame.height);
        const packed = context.getImageData(0, 0, frame.width, frame.height).data;
        const mismatches = original.reduce((count, byte, offset) => count + Number(byte !== packed[offset]), 0);
        const maxDelta = original.reduce((maximum, byte, offset) => Math.max(maximum, Math.abs(byte - packed[offset])), 0);
        const alphaMismatches = original.reduce((count, byte, offset) => count + Number(offset % 4 === 3 && byte !== packed[offset]), 0);
        result.push({ samePixels: mismatches === 0, mismatches, maxDelta, alphaMismatches, visible: original.some((byte, offset) => offset % 4 === 3 && byte > 0) });
      }
      return result;
    }, { sequence, sheet });
    // Re-encoding a rotated, antialiased image through Canvas may round an RGB
    // channel by one when converting premultiplied alpha. Geometry/alpha must
    // remain exact, and a larger color difference indicates a real regression.
    assert.ok(visual.every((entry) => entry.maxDelta <= 1 && entry.alphaMismatches === 0 && entry.visible), `Sequence and sheet pixels differ beyond Canvas rounding: ${JSON.stringify(visual)}`);
    const zipped = await page.evaluate(async (payload) => {
      const result = await window.FrameTunerPortable.requestPackage(payload);
      return [...new Uint8Array(await result.blob.arrayBuffer())];
    }, sheet);
    const unzipped = unzip(Buffer.from(zipped));
    assert.equal(JSON.parse(unzipped.get("manifest.json")).format, "sheet");
    assert.deepEqual(unzipped.get("audio/1_tick.wav"), sample.files.get("audio/tick.wav"));
    const sheetDirectory = path.join(root, "sheet-roundtrip"); writePackageDirectory(sheetDirectory, unzipped);
    service.createProject({ label: "Sheet roundtrip", id: "sheet-roundtrip" });
    const sheetImage = [...unzipped.keys()].find((name) => name.endsWith("spritesheet.png"));
    const sheetDescriptor = [...unzipped.keys()].find((name) => name.endsWith("spritesheet.json"));
    await run(["import", "--project", "sheet-roundtrip", "--profile", "hero", "--animation", "idle", "--input", path.join(sheetDirectory, sheetImage), "--json", path.join(sheetDirectory, sheetDescriptor)], { service });
    const reimported = service.projectData("sheet-roundtrip"), reimportedAnimation = reimported.manifest.profiles[0].animations[0];
    assert.deepEqual(reimportedAnimation.sourceAnchor, sheet.manifest.canvas.origin, "Sheet reimport preserves the baked origin");
    reimportedAnimation.frames.forEach((frame, index) => assert.ok(Math.abs(frame.duration * 1000 / reimportedAnimation.fps - [120, 310, 80][index]) < 0.000001));
    assert.equal(reimported.frameAudioBindings.length, 1);
    assert.equal(reimported.frameAudioBindings[0].volume, 0.35);
    assert.deepEqual(fs.readFileSync(path.join(root, reimported.frameAudioBindings[0].path)), sample.files.get("audio/tick.wav"));
    const cocos = await buildExportPackage({ ...sequence, format: "cocos" }, { root, projectData: service.projectData("browser-export") });
    assert.ok([...cocos.files.keys()].some((file) => file.endsWith("FrameTunerDemo.scene")));
    const renderFixture = () => page.evaluate(async () => {
      const api = window.XsxbFrameTunerLite, sample = api.timeline()[0];
      const options = { width: 1024, height: 1024, originPixelX: 512, originPixelY: 512 };
      return { png: await api.renderFrame(sample, options), bounds: await api.measureFrame(sample, options) };
    });
    const baseline = await renderFixture();
    const texturePath = "workspace/projects/browser-export/white.png";
    fs.writeFileSync(path.join(root, texturePath), solidPng());
    const attachment = {
      id: "marker", name: "tool_hand_anchor.png", path: texturePath, width: 8, height: 8, type: "image/png", layer: "above",
      key: "browser-export:player:hero:actor:hero/idle:workspace/projects/browser-export/assets/hero/idle:0",
      metadata: { projectId: "browser-export", tuningTarget: "player", profileId: "hero", groupType: "actor", animation: "hero/idle", source: "workspace/projects/browser-export/assets/hero/idle", frame: 0 },
      transform: { scale: 8, offset: { x: 220, y: -60 }, rotation: 0 },
    };
    service.store.writeJson(data.paths.frameImageAttachments, [attachment]);
    await page.evaluate(() => window.FrameTunerWorkbench.reload());
    const markerOnly = await renderFixture();
    assert.deepEqual(markerOnly, baseline, "A marker-only attachment must not change any baked pixel or measured visible bound");
    const markerPayload = await page.evaluate(() => window.FrameTunerPortable.collectPayload({ format: "sequence" }));
    assert.deepEqual(markerPayload.manifest.canvas, sequence.manifest.canvas, "Invisible helper geometry must not enlarge the package canvas");
    const markerPackage = await buildExportPackage(markerPayload, { root, projectData: service.projectData("browser-export") });
    const editable = JSON.parse(markerPackage.files.get("source/project.json"));
    assert.equal(editable.frameImageAttachments[0].name, "tool_hand_anchor.png", "Helper remains editable in source archive");
    assert.ok(markerPackage.files.has(editable.frameImageAttachments[0].path));
    service.store.writeJson(data.paths.frameImageAttachments, [attachment, { ...attachment, id: "visible-prop", name: "prop.png" }]);
    await page.evaluate(() => window.FrameTunerWorkbench.reload());
    const attached = await renderFixture();
    assert.notEqual(attached.png, baseline.png, "An ordinary image attachment must be baked");
    assert.ok(attached.bounds.right > baseline.bounds.right + 100, "Visible prop extends the baked bounds at its configured offset");
    service.store.writeJson(data.paths.attackTrails, normalizeAttackTrails({ schemaVersion: 21, bindings: { "hero/idle": [{
      id: "visible-trail", enabled: true, generated: true, layer: "front", coordinateSpace: "group",
      texture: { path: texturePath, name: "white.png", width: 8, height: 8, hasEffectiveAlpha: true },
      colorMode: "solid", color: "#ff6633", glowStrength: 0,
      materialLayers: { streaks: { enabled: false }, breakup: { enabled: false }, core: { enabled: false } },
      frameSlices: { 0: { enabled: true, tailProgress: 0, headProgress: 1 } },
      sticks: [{ id: "start", frame: 0, layer: "front", top: { x: -140, y: -80 }, bottom: { x: -140, y: -50 } }, { id: "end", frame: 0, layer: "front", top: { x: -70, y: -80 }, bottom: { x: -70, y: -50 } }],
    }] } }));
    await page.evaluate(() => window.FrameTunerWorkbench.reload());
    const trailed = await renderFixture();
    assert.notEqual(trailed.png, attached.png, "Inserted attack trail must be baked along with the body and prop");
    assert.ok(trailed.bounds.left < attached.bounds.left - 20, "Trail contributes visible pixels along its authored trajectory");
    service.store.writeJson(data.paths.frameImageAttachments, [attachment, { ...attachment, id: "distant-prop", name: "distant.png", transform: { scale: 8, offset: { x: 700, y: -60 }, rotation: 0 } }]);
    await page.evaluate(() => window.FrameTunerWorkbench.reload());
    const distantPayload = await page.evaluate(() => window.FrameTunerPortable.collectPayload({ format: "sequence" }));
    assert.ok(distantPayload.manifest.canvas.width > 700, "A prop entirely outside the initial probe must still be measured and baked");
    service.store.writeJson(data.paths.frameImageAttachments, [attachment]);
    const distantTrails = service.projectData("browser-export").attackTrails;
    for (const stick of distantTrails.bindings["hero/idle"][0].sticks) { stick.top.x += 900; stick.bottom.x += 900; }
    service.store.writeJson(data.paths.attackTrails, distantTrails);
    await page.evaluate(() => window.FrameTunerWorkbench.reload());
    const distantTrailPayload = await page.evaluate(() => window.FrameTunerPortable.collectPayload({ format: "sequence" }));
    assert.ok(distantTrailPayload.manifest.canvas.width > 800, "An entire trail outside the initial probe must contribute actual visible pixels to the baked canvas");
    const checkRelativeSource = (value) => {
      if (Array.isArray(value)) { value.forEach(checkRelativeSource); return; }
      if (typeof value === "string") { assert.ok(!value.includes(root) && !value.includes(root.replaceAll("\\", "/")), "Source snapshot must not contain machine-specific root paths"); return; }
      if (!value || typeof value !== "object") return;
      for (const [key, entry] of Object.entries(value)) {
        if (["path", "file"].includes(key) && entry) assert.ok(!path.isAbsolute(entry) && !/^[a-z]:/i.test(entry), `Source asset must be relative: ${entry}`);
        checkRelativeSource(entry);
      }
    };
    checkRelativeSource(JSON.parse(markerPackage.files.get("source/editor-snapshot.json")));
    [data.paths.manifest, data.paths.tuning].forEach((file, index) => assert.deepEqual(fs.readFileSync(file), before[index]));
    assert.deepEqual(errors, []);
    return { ok: true, renderer: "actual Chrome/Edge canvas", verified: "timing/disabled frames/boxes/audio, sequence-sheet RGBA tolerance, sheet roundtrip origin/audio, HTTP ZIP, Cocos, marker excluded but editable, prop/trail/distant prop+distant trail baked, relative source paths and source unchanged" };
  } finally {
    await browser?.close();
    if (server?.child && server.child.exitCode === null) {
      await new Promise((resolve) => { server.child.once("exit", resolve); server.child.kill(); });
    }
    const resolved = path.resolve(root);
    if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith("frame-tuner-browser-test-")) throw new Error("Unsafe temporary test cleanup path.");
    fs.rmSync(resolved, { recursive: true, force: true });
  }
}
if (require.main === module) test().then((result) => console.log(JSON.stringify(result))).catch((error) => { console.error(error); process.exitCode = 1; });
module.exports = { test };
