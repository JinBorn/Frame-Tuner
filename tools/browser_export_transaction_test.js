// Real browser/canvas/HTTP checks; only the native folder picker and writable
// handle are substituted so cancellation and slow disk writes are deterministic.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { chromium } = require("playwright-core");
const { createWorkbenchService } = require("./workbench_service");
const { createSamplePackage } = require("./cocos/sample_package");
const { findBrowser, startExportServer } = require("./frame_tuner");
const { unzip } = require("./export_package_test");

async function test() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "frame-tuner-export-transaction-"));
  const projectId = "中文导出-𠮷";
  const filename = `${projectId}_sequence.zip`;
  let browser, server, releasePost, releaseConfig, releaseEditorOperation;
  try {
    const service = createWorkbenchService({ root });
    service.createProject({ label: "中文导出事务", id: projectId });
    const sample = createSamplePackage();
    service.importAnimation({ projectId, profileId: "hero", animationId: "idle", fps: 12, files: [0, 2].map(index => ({ name: `idle_${index}.png`, data: `data:image/png;base64,${sample.files.get(`frames/demo_${index}.png`).toString("base64")}` })) });
    const assertArchive = (bytes, format = "sequence") => {
      const archive = unzip(bytes);
      const prefix = format === "cocos" ? "frame-tuner-source/" : "";
      const manifest = JSON.parse(archive.get(`${prefix}manifest.json`));
      assert.equal(manifest.projectId, projectId);
      assert.equal(manifest.animations.length, 1);
      assert.equal(manifest.animations[0].frames.length, 2);
      for (const frame of manifest.animations[0].frames) assert.ok(archive.has(`${prefix}${frame.path}`), `${format} includes its rendered frame assets`);
      const source = JSON.parse(archive.get(`${prefix}${manifest.editableSource}`));
      assert.equal(source.project.id, projectId);
      assert.equal(source.project.label, "中文导出事务");
      const frames = source.manifest.profiles[0].animations[0].frames;
      assert.equal(source.manifest.profiles[0].id, "hero");
      assert.equal(source.manifest.profiles[0].animations[0].id, "idle");
      assert.equal(frames.length, 2);
      frames.forEach((frame, index) => {
        assert.ok(frame.path.startsWith("source/assets/"));
        assert.deepEqual(archive.get(`${prefix}${frame.path}`), sample.files.get(`frames/demo_${[0, 2][index]}.png`));
      });
      const editor = JSON.parse(archive.get(`${prefix}${manifest.editorSnapshot}`));
      assert.equal(editor.projectId, projectId);
      assert.equal(editor.groups[0].frames.length, 2);
      if (format === "sheet") assert.ok(manifest.animations[0].frames.every(frame => frame.atlasRect), "Sheet export records atlas crops");
      if (format === "cocos") {
        const imported = JSON.parse(archive.get("FRAME-TUNER-IMPORT.json"));
        assert.equal(imported.projectId, projectId);
        assert.equal(imported.engineVersion, "3.8.8");
        assert.ok([...archive.keys()].some(name => name.endsWith("/FrameTunerPlayer.ts")));
      }
      return archive;
    };
    server = await startExportServer(root);
    browser = await chromium.launch({ executablePath: findBrowser(), headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1, acceptDownloads: true });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${server.url}/?project=${encodeURIComponent(projectId)}&export=1`, { waitUntil: "networkidle" });
    await page.evaluate(() => window.XsxbFrameTunerLite.ready);
    await page.evaluate(() => window.XsxbFrameTunerLite.selectGroup(window.XsxbFrameTunerLite.current().groupId, { frameIndex: 1 }));
    await page.locator("#portablePadding").fill("37");
    await page.locator("#portableColumns").fill("3");
    await page.locator("#portableDestination").selectOption("directory");
    await page.evaluate(() => { window.originalPaddingControl = document.querySelector("#portablePadding"); });
    await page.locator('[data-language="en"]').click();
    await page.waitForFunction(() => document.querySelector("#portableExportPanel h2").textContent === "Export package");
    assert.deepEqual(await page.evaluate(() => ({ padding: document.querySelector("#portablePadding").value, columns: document.querySelector("#portableColumns").value, destination: document.querySelector("#portableDestination").value, sameControl: window.originalPaddingControl === document.querySelector("#portablePadding"), help: document.querySelector("#portableExportStatus").textContent })), {
      padding: "37", columns: "3", destination: "directory", sameControl: true,
      help: "Exports every profile and animation. Disabled frames remain in the editable source.",
    });
    await page.locator("#portableDestination").selectOption("download");
    await page.evaluate(() => {
      window.exportStates = [];
      window.addEventListener("frame-tuner-export-state", (event) => window.exportStates.push(event.detail.busy));
      window.startExport = (options = {}) => {
        window.exportOutcome = window.FrameTunerPortable.exportProject({ format: "sequence", download: false, ...options }).then(
          (result) => ({ ok: true, filename: result.filename }),
          (error) => ({ ok: false, name: error.name, message: error.message }),
        );
      };
    });
    const start = (options) => page.evaluate((value) => { window.startExport(value); }, options || {});
    const outcome = () => page.evaluate(() => window.exportOutcome);
    const state = () => page.evaluate(() => ({
      busy: window.FrameTunerPortable.busy(),
      disabled: [...document.querySelectorAll("#portableExportPanel button, #portableExportPanel input, #portableExportPanel select")].every((control) => control.disabled),
      status: document.querySelector("#portableExportStatus").textContent,
      states: [...window.exportStates],
    }));
    const assertConcurrentBlocked = async () => {
      const blocked = await page.evaluate(async () => {
        document.querySelector("#workbenchNewProject").click();
        document.querySelector("#workbenchImport").click();
        const failures = await Promise.all([window.FrameTunerPortable.exportProject(), window.FrameTunerPortable.collectPayload()].map((promise) => promise.then(() => "unexpected success", (error) => error.message)));
        return { failures, dialogs: [...document.querySelectorAll(".workbenchDialog")].some((dialog) => dialog.open), busy: window.FrameTunerPortable.busy(), canDiscard: window.FrameTunerWorkbench.confirmDiscard() };
      });
      assert.deepEqual(blocked, { failures: ["An export is in progress. Wait for it to finish.", "An export is in progress. Wait for it to finish."], dialogs: false, busy: true, canDiscard: null });
    };
    let seenPost;
    const postReached = new Promise((resolve) => { seenPost = resolve; });
    const postGate = new Promise((resolve) => { releasePost = resolve; });
    let postCount = 0;
    await page.route("**/api/workbench/export", async (route) => { postCount += 1; seenPost(); await postGate; await route.continue(); });
    await start();
    await postReached;
    assert.deepEqual(await state(), { busy: true, disabled: true, status: "Packaging source data and baked assets…", states: [true] });
    await assertConcurrentBlocked();
    assert.equal(postCount, 1);
    assert.equal((await state()).status, "Packaging source data and baked assets…", "Rejected competitors must not replace the active transaction's progress");
    releasePost();
    assert.deepEqual(await outcome(), { ok: true, filename });
    assert.equal(await page.evaluate(() => window.XsxbFrameTunerLite.current().frameIndex), 1, "export must restore the selected frame, not jump to the first frame");
    assert.deepEqual((await state()).states, [true, false], "Packaging must not release and reacquire the lock");
    assert.equal((await state()).busy, false);
    assert.equal((await state()).disabled, false);
    await page.unroute("**/api/workbench/export");

    // A real HTTP error unlocks the workbench and exposes a translatable result.
    await page.route("**/api/workbench/export", (route) => route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "fixture packaging failure" }) }));
    await start();
    assert.equal((await outcome()).ok, false);
    assert.equal(await page.evaluate(() => window.XsxbFrameTunerLite.current().frameIndex), 1, "failed export also preserves selection");
    assert.equal((await state()).busy, false);
    assert.equal((await state()).status, "Export failed: fixture packaging failure");
    await page.locator('[data-language="zh"]').click();
    await page.waitForFunction(() => document.querySelector("#portableExportStatus").textContent === "导出失败：fixture packaging failure");
    assert.equal(await page.locator("#portablePadding").inputValue(), "37");
    assert.equal(await page.locator("#portableColumns").inputValue(), "3");
    await page.locator('[data-language="en"]').click();
    await page.unroute("**/api/workbench/export");

    // Native folder picking starts synchronously with the lock already held.
    await page.evaluate(() => {
      window.showDirectoryPicker = () => {
        window.pickerWasLocked = window.FrameTunerPortable.busy();
        return new Promise((resolve, reject) => { window.cancelPicker = () => reject(new DOMException("cancelled", "AbortError")); });
      };
    });
    await start({ destination: "directory" });
    assert.equal(await page.evaluate(() => window.pickerWasLocked), true);
    assert.equal((await state()).status, "Choose a folder for the ZIP…");
    await assertConcurrentBlocked();
    await page.evaluate(() => window.cancelPicker());
    assert.equal((await outcome()).name, "AbortError");
    assert.equal((await state()).busy, false);
    assert.equal((await state()).status, "Export cancelled");

    // Actual package generation followed by slow write AND slow commit.
    await page.evaluate(() => {
      window.disk = { stage: "picker", bytes: 0, aborted: false };
      window.showDirectoryPicker = async () => ({ getFileHandle: async (filename) => {
        window.disk.filename = filename;
        return { createWritable: async () => ({
        write: async (blob) => { window.disk.blob = blob; window.disk.stage = "write"; window.disk.bytes = blob.size; await new Promise((resolve) => { window.finishWrite = resolve; }); },
        close: async () => { window.disk.stage = "close"; await new Promise((resolve) => { window.finishClose = resolve; }); window.disk.stage = "done"; },
        abort: async () => { window.disk.aborted = true; },
      }) }; } });
    });
    await start({ destination: "directory" });
    await page.waitForFunction(() => window.disk.stage === "write");
    assert.equal((await state()).busy, true);
    assert.match((await state()).status, /^Saving ZIP/);
    await assertConcurrentBlocked();
    await page.evaluate(() => window.finishWrite());
    await page.waitForFunction(() => window.disk.stage === "close");
    assert.equal((await state()).busy, true, "Disk commit is part of the export transaction");
    await page.evaluate(() => window.finishClose());
    assert.equal((await outcome()).ok, true);
    assert.equal((await state()).busy, false);
    assert.equal((await state()).status, `Saved 1 animation · ${filename}`);
    assert.ok(await page.evaluate(() => window.disk.bytes > 0 && !window.disk.aborted));
    assert.equal(await page.evaluate(() => window.disk.filename), filename, "Folder save receives the complete Unicode filename");
    assertArchive(Buffer.from(await page.evaluate(async () => Array.from(new Uint8Array(await window.disk.blob.arrayBuffer())))));

    await page.evaluate(() => {
      window.disk.aborted = false;
      window.showDirectoryPicker = async () => ({ getFileHandle: async () => ({ createWritable: async () => ({
        write: async () => { throw new Error("fixture disk full"); },
        close: async () => { throw new Error("Must not commit a failed write"); },
        abort: async () => { window.disk.aborted = true; },
      }) }) });
    });
    await start({ destination: "directory" });
    assert.equal((await outcome()).message, "fixture disk full");
    assert.equal(await page.evaluate(() => window.disk.aborted), true);
    assert.equal((await state()).busy, false);
    assert.equal((await state()).disabled, false);

    // The browser accepts a real ZIP download while the transaction is locked.
    await page.evaluate(() => {
      const click = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = function () { if (this.download) window.downloadWasLocked = window.FrameTunerPortable.busy(); return click.call(this); };
    });
    const downloaded = page.waitForEvent("download");
    await start({ download: true });
    const download = await downloaded;
    assert.equal((await outcome()).ok, true);
    assert.equal(await page.evaluate(() => window.downloadWasLocked), true);
    assert.equal(download.suggestedFilename(), filename, "Chrome download retains Chinese and supplementary Unicode characters");
    assertArchive(fs.readFileSync(await download.path()));
    assert.equal((await state()).busy, false);
    assert.equal((await state()).status, `Download started with 1 animation · ${filename}`);

    const standalone = await page.evaluate(async () => { const payload = await window.FrameTunerPortable.collectPayload({ format: "sequence" }); return { projectId: payload.projectId, busy: window.FrameTunerPortable.busy() }; });
    assert.deepEqual(standalone, { projectId, busy: false });
    const failure = await page.evaluate(async () => { try { await window.FrameTunerPortable.collectPayload({ format: "invalid" }); } catch (error) { return { message: error.message, busy: window.FrameTunerPortable.busy() }; } });
    assert.deepEqual(failure, { message: "Unsupported export format: invalid", busy: false });
    for (const operation of [{ name: "loading", url: "**/api/config**", run: "reload" }, { name: "saving", url: "**/api/save", run: "save" }]) {
      let reached;
      const requestReached = new Promise((resolve) => { reached = resolve; });
      const gate = new Promise((resolve) => { releaseEditorOperation = resolve; });
      await page.route(operation.url, async (route) => { reached(); await gate; await route.continue(); });
      await page.evaluate((method) => { window.editorOperation = window.FrameTunerWorkbench[method](); }, operation.run);
      await requestReached;
      assert.equal(await page.evaluate((name) => window.XsxbFrameTunerLite.current()[name], operation.name), true);
      const rejected = await page.evaluate(async () => {
        const messages = await Promise.all([window.FrameTunerPortable.exportProject(), window.FrameTunerPortable.collectPayload()].map((promise) => promise.then(() => "unexpected success", (error) => error.message)));
        return { messages, busy: window.FrameTunerPortable.busy() };
      });
      assert.deepEqual(rejected, { messages: ["Wait for the project to finish saving or loading before exporting.", "Wait for the project to finish saving or loading before exporting."], busy: false });
      releaseEditorOperation();
      await page.evaluate(() => window.editorOperation);
      assert.equal(await page.evaluate((name) => window.XsxbFrameTunerLite.current()[name], operation.name), false);
      assert.equal(await page.evaluate(() => window.XsxbFrameTunerLite.current().ready), true, "Rejected export must not disrupt the editor's existing operation");
      await page.unroute(operation.url);
    }
    const earlyPage = await browser.newPage();
    const configGate = new Promise((resolve) => { releaseConfig = resolve; });
    await earlyPage.route("**/api/config**", async (route) => { await configGate; await route.continue(); });
    await earlyPage.goto(`${server.url}/?project=${encodeURIComponent(projectId)}&export=1`, { waitUntil: "domcontentloaded" });
    await earlyPage.waitForFunction(() => Boolean(window.FrameTunerPortable));
    await earlyPage.evaluate(() => { window.earlyPayload = window.FrameTunerPortable.collectPayload({ format: "sequence" }).then((payload) => ({ projectId: payload.projectId })); });
    assert.equal(await earlyPage.evaluate(() => window.FrameTunerPortable.busy()), false, "Waiting for initial editor readiness must not block its group selection");
    releaseConfig();
    assert.deepEqual(await earlyPage.evaluate(() => window.earlyPayload), { projectId });
    await earlyPage.close();
    // Exercise the user's actual destination select and format buttons for all ZIP formats.
    await page.evaluate(() => {
      window.showDirectoryPicker = async () => ({ getFileHandle: async (filename) => {
        window.matrixDisk = { filename, done: false };
        return { createWritable: async () => ({
          write: async (blob) => { window.matrixDisk.blob = blob; },
          close: async () => { window.matrixDisk.done = true; },
          abort: async () => { window.matrixDisk.aborted = true; },
        }) };
      } });
    });
    for (const destination of ["download", "directory"]) {
      await page.locator("#portableDestination").selectOption(destination);
      for (const format of ["sequence", "sheet", "cocos"]) {
        const expectedFilename = `${projectId}_${format}.zip`;
        const response = page.waitForResponse(response => new URL(response.url()).pathname === "/api/workbench/export");
        const downloaded = destination === "download" ? page.waitForEvent("download") : null;
        await page.evaluate(() => { window.matrixDisk = null; });
        await page.locator(`[data-export-format="${format}"]`).click();
        assert.equal((await response).status(), 200, `${destination}/${format} packages through real HTTP`);
        let bytes;
        if (downloaded) {
          const download = await downloaded;
          assert.equal(download.suggestedFilename(), expectedFilename);
          bytes = fs.readFileSync(await download.path());
        } else {
          await page.waitForFunction(() => window.matrixDisk?.done);
          assert.equal(await page.evaluate(() => window.matrixDisk.filename), expectedFilename);
          bytes = Buffer.from(await page.evaluate(async () => Array.from(new Uint8Array(await window.matrixDisk.blob.arrayBuffer()))));
        }
        await page.waitForFunction(() => !window.FrameTunerPortable.busy());
        assertArchive(bytes, format);
      }
    }
    assert.deepEqual(errors, []);
    return { ok: true, verified: "whole-export lock, delayed HTTP concurrency, save/load exclusion, HTTP/picker/disk failure recovery, disk commit, Chinese/supplementary Unicode ZIP download and directory filenames in all three formats through actual controls with archived source verification, initial-ready and independent collectPayload, translated labels/status with preserved inputs" };
  } finally {
    releasePost?.();
    releaseConfig?.();
    releaseEditorOperation?.();
    await browser?.close();
    if (server?.child && server.child.exitCode === null) await new Promise((resolve) => { server.child.once("exit", resolve); server.child.kill(); });
    const resolved = path.resolve(root);
    if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith("frame-tuner-export-transaction-")) throw new Error("Unsafe test cleanup path.");
    fs.rmSync(resolved, { recursive: true, force: true });
  }
}
if (require.main === module) test().then((result) => console.log(JSON.stringify(result))).catch((error) => { console.error(error); process.exitCode = 1; });
module.exports = { test };
