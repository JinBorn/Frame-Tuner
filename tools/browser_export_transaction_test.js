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
  let browser, server, releasePost, releaseConfig, releaseEditorOperation;
  try {
    const service = createWorkbenchService({ root });
    service.createProject({ label: "Export transaction", id: "transaction" });
    const sample = createSamplePackage();
    service.importAnimation({ projectId: "transaction", profileId: "hero", animationId: "idle", fps: 12, files: [0, 2].map(index => ({ name: `idle_${index}.png`, data: `data:image/png;base64,${sample.files.get(`frames/demo_${index}.png`).toString("base64")}` })) });
    server = await startExportServer(root);
    browser = await chromium.launch({ executablePath: findBrowser(), headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1, acceptDownloads: true });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${server.url}/?project=transaction&export=1`, { waitUntil: "networkidle" });
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
    assert.deepEqual(await outcome(), { ok: true, filename: "transaction_sequence.zip" });
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
      window.showDirectoryPicker = async () => ({ getFileHandle: async () => ({ createWritable: async () => ({
        write: async (blob) => { window.disk.stage = "write"; window.disk.bytes = blob.size; await new Promise((resolve) => { window.finishWrite = resolve; }); },
        close: async () => { window.disk.stage = "close"; await new Promise((resolve) => { window.finishClose = resolve; }); window.disk.stage = "done"; },
        abort: async () => { window.disk.aborted = true; },
      }) }) });
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
    assert.equal((await state()).status, "Saved 1 animation · transaction_sequence.zip");
    assert.ok(await page.evaluate(() => window.disk.bytes > 0 && !window.disk.aborted));

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
    const archive = unzip(fs.readFileSync(await download.path()));
    assert.equal(JSON.parse(archive.get("manifest.json")).projectId, "transaction");
    assert.equal((await state()).busy, false);
    assert.equal((await state()).status, "Download started with 1 animation · transaction_sequence.zip");

    const standalone = await page.evaluate(async () => { const payload = await window.FrameTunerPortable.collectPayload({ format: "sequence" }); return { projectId: payload.projectId, busy: window.FrameTunerPortable.busy() }; });
    assert.deepEqual(standalone, { projectId: "transaction", busy: false });
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
    await earlyPage.goto(`${server.url}/?project=transaction&export=1`, { waitUntil: "domcontentloaded" });
    await earlyPage.waitForFunction(() => Boolean(window.FrameTunerPortable));
    await earlyPage.evaluate(() => { window.earlyPayload = window.FrameTunerPortable.collectPayload({ format: "sequence" }).then((payload) => ({ projectId: payload.projectId })); });
    assert.equal(await earlyPage.evaluate(() => window.FrameTunerPortable.busy()), false, "Waiting for initial editor readiness must not block its group selection");
    releaseConfig();
    assert.deepEqual(await earlyPage.evaluate(() => window.earlyPayload), { projectId: "transaction" });
    await earlyPage.close();
    assert.deepEqual(errors, []);
    return { ok: true, verified: "whole-export lock, delayed HTTP concurrency, save/load exclusion, HTTP/picker/disk failure recovery, disk commit, real ZIP download, initial-ready and independent collectPayload, translated labels/status with preserved inputs" };
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
