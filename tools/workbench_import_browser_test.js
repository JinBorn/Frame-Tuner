"use strict";

// Exercise real file inputs, FileReader payloads, dialogs, and the local service.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const { chromium } = require("playwright-core");
const { createWorkbenchService } = require("./workbench_service");
const { createSamplePackage } = require("./cocos/sample_package");
const { findBrowser, startExportServer } = require("./frame_tuner");

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "frame-tuner-import-browser-"));
  let browser, server;
  try {
    const service = createWorkbenchService({ root });
    service.createProject({ id: "import-test", label: "Import test" });
    const sample = createSamplePackage();
    const png = sample.files.get("frames/demo_0.png");
    const wav = sample.files.get("audio/tick.wav");
    const secondWav = Buffer.from(wav);
    secondWav[secondWav.length - 2] ^= 1;
    service.importAnimation({ projectId: "import-test", profileId: "hero", animationId: "keep", files: [{ name: "keep.png", data: `data:image/png;base64,${png.toString("base64")}` }] });
    const authoredSnapshot = () => {
      const result = {};
      const walk = (directory) => {
        for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
          const file = path.join(directory, entry.name);
          if (entry.isDirectory()) walk(file);
          else result[path.relative(root, file)] = crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
        }
      };
      for (const directory of ["data", "workspace"]) walk(path.join(root, directory));
      return result;
    };
    const sheet = {
      frames: [{ frame: { x: 0, y: 0, w: 96, h: 176 }, duration: 120 }, { frame: { x: 96, y: 0, w: 96, h: 176 }, duration: 240 }],
      audio: { files: [{ file: "../../audio/tick.wav", id: "tick" }, { file: "../audio/chime.wav", id: "chime" }], events: [{ outputFrameIndex: 0, assetId: "tick", volume: 0.37 }, { outputFrameIndex: 1, assetId: "chime", volume: 0.82 }] },
    };
    const audioFiles = [{ name: "chime.wav", mimeType: "application/octet-stream", buffer: secondWav }, { name: "tick.wav", mimeType: "application/octet-stream", buffer: wav }];
    server = await startExportServer(root);
    browser = await chromium.launch({ executablePath: findBrowser(), headless: true });
    const page = await browser.newPage({ viewport: { width: 1024, height: 640 } });
    const capture = async (name) => {
      if (process.env.FRAME_TUNER_CAPTURE_UI !== "1") return;
      const directory = path.resolve(__dirname, "..", ".tmp", "verification");
      fs.mkdirSync(directory, { recursive: true });
      const target = path.join(directory, `${name}-${Date.now()}.png`);
      await page.screenshot({ path: target });
      console.log(`Screenshot: ${target}`);
    };
    const errors = [], requests = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("request", (request) => { if (new URL(request.url()).pathname === "/api/workbench/import") requests.push(request.postDataJSON()); });
    await page.goto(`${server.url}/?project=import-test&export=1`, { waitUntil: "domcontentloaded" });
    await page.evaluate(() => window.FrameTunerWorkbench.ready);
    const setJson = (value) => page.locator("#workbenchSheetJson").setInputFiles({ name: "sheet.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(value)) });
    const setupImport = async (animationId, metadata = sheet, audio = audioFiles) => {
      if (!await page.locator("#workbenchImportDialog").isVisible()) await page.locator("#workbenchImport").click();
      await page.locator('input[name="importMode"][value="sheet"]').check();
      await page.locator("#workbenchImageFiles").setInputFiles({ name: "sheet.png", mimeType: "image/png", buffer: png });
      await setJson(metadata);
      await page.locator("#workbenchSheetAudio").setInputFiles(audio);
      await page.locator("#workbenchProfileId").fill("hero");
      await page.locator("#workbenchAnimationId").fill(animationId);
    };
    const submit = () => page.locator("#workbenchImportSubmit").click();
    const assertSelectionsKept = async () => {
      await page.waitForFunction(() => document.getElementById("workbenchImportDialog").getAttribute("aria-busy") === "false");
      assert.equal(await page.locator("#workbenchImportDialog").isVisible(), true);
      assert.deepEqual(await page.evaluate(() => [document.getElementById("workbenchImageFiles").files.length, document.getElementById("workbenchSheetJson").files.length, document.getElementById("workbenchSheetAudio").files.length]), [1, 1, 2]);
      assert.equal(await page.locator("#workbenchImportSubmit").isEnabled(), true);
    };

    await setupImport("sheet");
    if (process.env.FRAME_TUNER_CAPTURE_UI === "1") {
      await page.setViewportSize({ width: 1440, height: 960 });
      await capture("sheet-companion-audio");
      await page.setViewportSize({ width: 1024, height: 640 });
    }
    // At a short desktop height the dialog must scroll without losing its footer.
    assert.equal(await page.locator("#workbenchImportDialog").evaluate((dialog) => dialog.getBoundingClientRect().height <= innerHeight - 30 && dialog.scrollHeight > dialog.clientHeight), true);
    await page.locator("#workbenchImportSubmit").scrollIntoViewIfNeeded();
    assert.equal(await page.locator("#workbenchImportSubmit").evaluate((button) => button.getBoundingClientRect().bottom <= innerHeight), true);
    await submit();
    await page.locator("#workbenchImportDialog").waitFor({ state: "hidden" });
    assert.deepEqual(requests[0].audioFiles.map((entry) => entry.file), ["../../audio/tick.wav", "../audio/chime.wav"]);
    assert.equal(requests[0].replace, undefined);
    assert.ok(requests[0].audioFiles.every((entry) => entry.data.startsWith("data:audio/wav;base64,")));
    let data = service.projectData("import-test");
    assert.deepEqual(data.frameAudioBindings.map((entry) => entry.volume), [0.37, 0.82]);
    assert.deepEqual(fs.readFileSync(path.join(root, data.frameAudioBindings[0].path)), wav);
    assert.deepEqual(fs.readFileSync(path.join(root, data.frameAudioBindings[1].path)), secondWav);
    await page.evaluate(async () => { const api = window.FrameTunerWorkbench; await api.selectGroup(api.groups().find((group) => group.animationId === "sheet").groupId); });
    assert.equal(await page.locator("#filmstrip .frameSfxBadge").count(), 2);
    assert.deepEqual(await page.evaluate(() => window.XsxbFrameTunerLite.audio().events.map((event) => event.volume)), [0.37, 0.82]);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.evaluate(() => window.FrameTunerWorkbench.ready);
    await page.evaluate(async () => { const api = window.FrameTunerWorkbench; await api.selectGroup(api.groups().find((group) => group.animationId === "sheet").groupId); });
    assert.deepEqual(await page.evaluate(() => window.XsxbFrameTunerLite.audio().events.map((event) => event.volume)), [0.37, 0.82], "audio volume survives a full browser reload");

    const beforeInvalid = authoredSnapshot();
    await setupImport("missing", sheet, []);
    await submit();
    await page.waitForFunction(() => /缺少配套音频/.test(document.getElementById("workbenchImportError").textContent));
    assert.equal(requests.length, 1, "missing audio is rejected before any import request");
    assert.deepEqual(authoredSnapshot(), beforeInvalid);

    const ambiguous = structuredClone(sheet);
    ambiguous.audio.files = [{ file: "a/tick.wav", id: "tick" }, { file: "b/tick.wav", id: "chime" }];
    await setupImport("ambiguous", ambiguous, [audioFiles[1]]);
    await submit();
    await page.waitForFunction(() => /无法唯一匹配音频/.test(document.getElementById("workbenchImportError").textContent));
    assert.equal(requests.length, 1, "one basename must not be reused for two references");
    assert.deepEqual(authoredSnapshot(), beforeInvalid);
    await setupImport("ambiguous", sheet, [audioFiles[0], audioFiles[1], { ...audioFiles[1], buffer: secondWav }]);
    await submit();
    await page.waitForFunction(() => /无法唯一匹配音频/.test(document.getElementById("workbenchImportError").textContent));
    assert.equal(requests.length, 1, "duplicate selected basenames are not guessed");
    assert.deepEqual(authoredSnapshot(), beforeInvalid);

    // A real unsaved frame edit plus the editor's native discard dialog.
    await page.locator("#workbenchImportDialog [data-close-dialog]").last().click();
    await page.locator("#filmstrip .thumb .durationStep").nth(1).click();
    assert.equal(await page.evaluate(() => window.FrameTunerWorkbench.current().dirty), true);
    await setupImport("dirty-cancel");
    const discardDialog = page.waitForEvent("dialog").then((dialog) => dialog.dismiss());
    await submit();
    await discardDialog;
    await page.waitForFunction(() => document.getElementById("workbenchImportDialog").getAttribute("aria-busy") === "false");
    await assertSelectionsKept();
    assert.equal(requests.length, 1);
    assert.deepEqual(authoredSnapshot(), beforeInvalid);
    // Accept the first dirty guard, then cancel the fresh guard after replacement
    // confirmation. The rejected 409 request must remain the only request.
    await page.locator("#workbenchAnimationId").fill("sheet");
    const firstDiscard = page.waitForEvent("dialog").then((dialog) => dialog.accept());
    await submit();
    await firstDiscard;
    await page.locator("#workbenchReplaceDialog").waitFor({ state: "visible" });
    const secondDiscard = page.waitForEvent("dialog").then((dialog) => dialog.dismiss());
    await page.locator("#workbenchReplaceConfirm").click();
    await secondDiscard;
    await assertSelectionsKept();
    assert.equal(requests.length, 2);
    assert.equal(requests.at(-1).replace, undefined);
    assert.equal(await page.evaluate(() => window.FrameTunerWorkbench.current().dirty), true);
    assert.deepEqual(authoredSnapshot(), beforeInvalid);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.evaluate(() => window.FrameTunerWorkbench.ready);

    // Seed old frame-indexed edits after page load, then inspect the actual files
    // after cancel and confirm; no stub service or in-memory editor is involved.
    data = service.projectData("import-test");
    data.tuning.values = { "profiles.hero.character.visual_size": 1.2, "profiles.hero.animations.sheet.visual_size": 1.3 };
    data.tuning.frame_visual_overrides = { "hero/sheet:0": { x: 42 }, "hero/keep:0": { x: 7 } };
    data.tuning.frame_playback_overrides = { "hero/sheet:0": { duration: 9 }, "hero/sheet:__group__": { duration: 2 }, "hero/keep:0": { duration: 3 } };
    data.tuning.frame_box_overrides = { "hero/sheet:0": { hitbox: { enabled: true } } };
    fs.writeFileSync(data.paths.tuning, JSON.stringify(data.tuning));
    fs.writeFileSync(data.paths.frameImageAttachments, JSON.stringify([{ id: "old-attachment", metadata: { profileId: "hero", animation: "hero/sheet", frame: 0 } }]));
    fs.writeFileSync(data.paths.attackTrails, JSON.stringify({ ...data.attackTrails, bindings: { "hero/sheet": { segments: [] } } }));
    const beforeReplace = authoredSnapshot();
    const replacement = { ...sheet, frames: sheet.frames.slice(0, 1), audio: { files: sheet.audio.files.slice(0, 1), events: [{ outputFrameIndex: 0, assetId: "tick", volume: 0.15 }] } };
    await setupImport("sheet", replacement);
    await submit();
    await page.locator("#workbenchReplaceDialog").waitFor({ state: "visible" });
    await capture("sheet-replace-confirmation");
    assert.equal(await page.locator("#workbenchReplaceCancel").evaluate((button) => button === document.activeElement), true);
    assert.equal(await page.locator("#workbenchImportSubmit").isDisabled(), true);
    assert.match(await page.locator("#workbenchReplaceWarning").textContent(), /角色级和动作组级配置/);
    assert.equal(requests.at(-1).replace, undefined, "HTTP 409 does not automatically retry with replace");
    assert.deepEqual(authoredSnapshot(), beforeReplace);
    await page.locator("#workbenchReplaceCancel").click();
    await page.locator("#workbenchReplaceDialog").waitFor({ state: "hidden" });
    await assertSelectionsKept();
    assert.deepEqual(authoredSnapshot(), beforeReplace);

    await submit();
    await page.locator("#workbenchReplaceDialog").waitFor({ state: "visible" });
    await page.keyboard.press("Escape");
    await page.locator("#workbenchReplaceDialog").waitFor({ state: "hidden" });
    await assertSelectionsKept();
    assert.deepEqual(authoredSnapshot(), beforeReplace);

    // All new labels and confirmation controls follow the editor language.
    await page.evaluate(() => { document.documentElement.lang = "en"; });
    await submit();
    await page.locator("#workbenchReplaceDialog").waitFor({ state: "visible" });
    assert.equal(await page.locator("#workbenchReplaceConfirm").textContent(), "Replace existing animation");
    assert.match(await page.locator("#workbenchSheetAudioField").textContent(), /Companion audio/);
    assert.match(await page.locator("#workbenchReplaceWarning").textContent(), /Character and animation-group settings/);
    assert.equal(await page.locator("#workbenchReplaceDialog").evaluate((dialog) => dialog.scrollWidth <= dialog.clientWidth), true);
    await page.locator("#workbenchReplaceConfirm").click();
    await page.locator("#workbenchImportDialog").waitFor({ state: "hidden" });
    assert.equal(requests.at(-1).replace, true);
    data = service.projectData("import-test");
    assert.equal(data.manifest.profiles[0].animations.find((animation) => animation.id === "sheet").frames.length, 1);
    assert.equal(data.manifest.profiles[0].animations.find((animation) => animation.id === "keep").frames.length, 1);
    assert.deepEqual(data.tuning.values, { "profiles.hero.character.visual_size": 1.2, "profiles.hero.animations.sheet.visual_size": 1.3 });
    assert.deepEqual(data.tuning.frame_visual_overrides, { "hero/keep:0": { x: 7 } });
    assert.deepEqual(data.tuning.frame_playback_overrides, { "hero/sheet:__group__": { duration: 2 }, "hero/keep:0": { duration: 3 } });
    assert.deepEqual(data.tuning.frame_box_overrides, {});
    assert.deepEqual(data.frameImageAttachments, []);
    assert.deepEqual(data.attackTrails.bindings, {});
    assert.equal(data.frameAudioBindings.length, 1);
    assert.equal(data.frameAudioBindings[0].volume, 0.15);
    assert.deepEqual(fs.readFileSync(path.join(root, data.frameAudioBindings[0].path)), wav);
    assert.deepEqual(errors, []);
    console.log("Workbench import browser regressions passed: companion audio bytes/volume, missing and ambiguous no-write checks, dirty cancellation, explicit replacement cancel/Escape/confirm, bilingual controls, and short-dialog scrolling.");
  } finally {
    await browser?.close();
    server?.child.kill();
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
    assert.match(path.basename(root), /^frame-tuner-import-browser-/);
    fs.rmSync(root, { recursive: true, force: true });
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
