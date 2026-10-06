const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { chromium } = require("playwright-core");
const { createWorkbenchService } = require("./workbench_service");
const { createSamplePackage } = require("./cocos/sample_package");
const { findBrowser, startExportServer } = require("./frame_tuner");
const { buildExportPackage } = require("./export_package");

function deferred() {
  let resolve;
  const promise = new Promise((yes) => { resolve = yes; });
  return { promise, resolve };
}

async function dropAudio(page, name, buffer) {
  await page.evaluate(({ name, base64 }) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([Uint8Array.from(atob(base64), (value) => value.charCodeAt(0))], name, { type: "audio/wav" }));
    document.querySelector("#filmstrip .thumb").dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer }));
  }, { name, base64: buffer.toString("base64") });
}

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "frame-tuner-audio-sync-"));
  let server;
  let browser;
  const release = deferred();
  try {
    const service = createWorkbenchService({ root });
    service.createProject({ id: "audio-sync", label: "Audio sync" });
    const sample = createSamplePackage();
    const original = sample.files.get("audio/tick.wav");
    const replacement = Buffer.from(original);
    replacement[replacement.length - 2] ^= 0x55;
    service.importAnimation({ projectId: "audio-sync", profileId: "hero", animationId: "idle", files: [
      { name: "idle.png", data: `data:image/png;base64,${sample.files.get("frames/demo_0.png").toString("base64")}` },
    ] });
    server = await startExportServer(root);
    browser = await chromium.launch({ executablePath: findBrowser(), headless: true });
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${server.url}/?project=audio-sync&export=1`);
    await page.evaluate(() => window.FrameTunerWorkbench.ready);
    let failSync = false;
    const firstRequest = deferred();
    const failedRequest = deferred();
    await page.route("**/api/frame-audio", async (route) => {
      if (failSync) {
        await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Temporary audio sync outage" }) });
        failedRequest.resolve();
      } else {
        firstRequest.resolve();
        await release.promise;
        await route.continue();
      }
    });
    await dropAudio(page, "tick.wav", original);
    await firstRequest.promise;
    const pending = await page.evaluate(() => window.FrameTunerWorkbench.current());
    if (!pending.saving) {
      const unsafe = await page.evaluate(() => window.FrameTunerPortable.collectPayload({ format: "sequence" }));
      const sourceAudio = unsafe.source.frameAudioBindings[0];
      throw new Error(`Reproduced unsafe export during audio upload: runtime audio=${unsafe.manifest.animations[0].frames[0].audio.length}, editable source has bytes/path=${Boolean(sourceAudio?.data || sourceAudio?.path)}, current.saving=${pending.saving}`);
    }
    const blocked = await page.evaluate(async () => {
      try { await window.FrameTunerPortable.collectPayload({ format: "sequence" }); return "allowed"; }
      catch (error) { return error.message; }
    });
    assert.match(blocked, /保存|saving/);
    assert.equal(await page.evaluate(() => window.FrameTunerPortable.busy()), false);
    release.resolve();
    await page.waitForFunction(() => !window.FrameTunerWorkbench.current().saving);
    const savedPayload = await page.evaluate(() => window.FrameTunerPortable.collectPayload({ format: "sequence" }));
    const savedPackage = await buildExportPackage(savedPayload, { root, projectData: service.projectData("audio-sync") });
    const savedSource = JSON.parse(savedPackage.files.get("source/editor-snapshot.json"));
    assert.deepEqual(savedPackage.files.get(savedSource.frameAudioBindings[0].path), original);

    // Replace an existing sound, fail automatic persistence, then export the
    // unsaved edit. The source snapshot must contain the replacement bytes.
    failSync = true;
    await dropAudio(page, "replacement.wav", replacement);
    await failedRequest.promise;
    await page.waitForFunction(() => !window.FrameTunerWorkbench.current().saving);
    assert.equal(await page.evaluate(() => window.FrameTunerWorkbench.current().dirty), true);
    assert.match(await page.locator("#status").textContent(), /Temporary audio sync outage/);
    assert.doesNotMatch(await page.locator("#status").textContent(), /已保存到项目|Saved to project/);
    const failedPayload = await page.evaluate(() => window.FrameTunerPortable.collectPayload({ format: "sequence" }));
    const failedPackage = await buildExportPackage(failedPayload, { root, projectData: service.projectData("audio-sync") });
    const failedSource = JSON.parse(failedPackage.files.get("source/editor-snapshot.json"));
    assert.deepEqual(failedPackage.files.get(failedSource.frameAudioBindings[0].path), replacement);
    const runtimePath = failedPayload.manifest.animations[0].frames[0].audio[0].path;
    assert.deepEqual(failedPackage.files.get(runtimePath), replacement);

    // Saving retries from the retained in-memory File instead of reusing the
    // old persisted path, without asking the user to select the sound again.
    await page.locator("#save").click();
    await page.waitForFunction(() => !window.FrameTunerWorkbench.current().saving && !window.FrameTunerWorkbench.current().dirty);
    const recovered = service.projectData("audio-sync").frameAudioBindings[0];
    assert.deepEqual(fs.readFileSync(path.resolve(root, recovered.path)), replacement);

    // A Sheet/service replacement can reuse the same frame binding key. The
    // project's new disk asset must win over the old browser IndexedDB File.
    const updated = service.projectData("audio-sync");
    const importedPath = "workspace/projects/audio-sync/sheet-imported.wav";
    fs.writeFileSync(path.resolve(root, importedPath), original);
    service.store.writeJson(updated.paths.frameAudio, [{ ...recovered, name: "sheet-imported.wav", path: importedPath }]);
    assert.equal(await page.evaluate(() => window.FrameTunerWorkbench.reload()), true);
    const importedPayload = await page.evaluate(() => window.FrameTunerPortable.collectPayload({ format: "sequence" }));
    const importedPackage = await buildExportPackage(importedPayload, { root, projectData: service.projectData("audio-sync") });
    const importedSource = JSON.parse(importedPackage.files.get("source/editor-snapshot.json"));
    assert.deepEqual(importedPackage.files.get(importedSource.frameAudioBindings[0].path), original, "a stale IndexedDB sound must not replace an imported project asset");
    assert.deepEqual(importedPackage.files.get(importedPayload.manifest.animations[0].frames[0].audio[0].path), original);
    assert.deepEqual(errors, []);
    console.log("Audio sync browser regressions passed: export readiness, replacement source bytes, failure feedback, save recovery and project audio superseding stale IndexedDB.");
  } finally {
    release.resolve();
    await browser?.close();
    server?.child.kill();
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
    assert.match(path.basename(root), /^frame-tuner-audio-sync-/);
    fs.rmSync(root, { recursive: true, force: true });
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
