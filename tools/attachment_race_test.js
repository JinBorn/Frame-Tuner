"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { chromium } = require("playwright-core");
const { createWorkbenchService } = require("./workbench_service");
const { createSamplePackage } = require("./cocos/sample_package");
const { startExportServer, findBrowser } = require("./frame_tuner");

async function test() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "frame-tuner-attachment-race-"));
  let browser, server, release;
  try {
    const service = createWorkbenchService({ root });
    const bytes = createSamplePackage().files.get("frames/demo_0.png");
    for (const id of ["first", "second"]) {
      service.createProject({ id, label: id });
      service.importAnimation({ projectId: id, profileId: "hero", animationId: "idle", files: [{ name: "0.png", data: `data:image/png;base64,${bytes.toString("base64")}` }] });
    }
    server = await startExportServer(root);
    browser = await chromium.launch({ executablePath: findBrowser(), headless: true });
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`${server.url}/?project=first&export=1`);
    await page.evaluate(() => window.FrameTunerWorkbench.ready);
    let uploadStarted;
    const started = new Promise(resolve => { uploadStarted = resolve; });
    const gate = new Promise(resolve => { release = resolve; });
    await page.route("**/api/frame-attachment-image", async route => {
      assert.equal(route.request().postDataJSON().projectId, "first");
      uploadStarted();
      await gate;
      await route.continue();
    });
    const upload = () => page.evaluate(async data => {
      const bytes = Uint8Array.from(atob(data), c => c.charCodeAt(0));
      return bindFrameImageAttachmentFile(new File([bytes], "layer.png", { type: "image/png" }));
    }, bytes.toString("base64"));
    const pending = upload();
    await started;
    assert.equal(await page.evaluate(() => window.FrameTunerWorkbench.current().saving), true);
    assert.equal(await page.evaluate(() => window.FrameTunerWorkbench.reload("second")), false, "Cannot switch project while image upload is pending");
    assert.equal(await page.evaluate(() => Boolean(window.FrameTunerWorkbench.confirmDiscard())), false);
    assert.equal(await page.evaluate(() => window.FrameTunerWorkbench.save()), undefined);
    await page.locator('[data-action="duplicate-frame"]').click();
    assert.equal(await page.evaluate(() => currentGroup.frames.length), 1);
    release();
    assert.equal(await pending, true);
    assert.equal(await page.evaluate(() => window.FrameTunerWorkbench.current().saving), false);
    await page.evaluate(() => window.FrameTunerWorkbench.save());
    assert.equal(service.projectData("first").frameImageAttachments.length, 1);
    assert.equal(service.projectData("second").frameImageAttachments.length, 0);
    await page.unroute("**/api/frame-attachment-image");
    await page.route("**/api/frame-attachment-image", route => route.fulfill({ status: 500, body: "Injected upload failure" }));
    assert.equal(await upload(), false);
    assert.equal(await page.evaluate(() => window.FrameTunerWorkbench.current().saving), false, "Failed uploads release the busy state");
    assert.equal(await page.evaluate(() => frameImageAttachments.length), 1);
    assert.equal(await page.evaluate(() => window.FrameTunerWorkbench.reload("second")), true);
    assert.equal(await page.evaluate(() => frameImageAttachments.length), 0);
    assert.deepEqual(errors, []);
    console.log("Attachment upload race passed: project/save/frame edits blocked while pending; correct project binding; failure unlocks; reload remains clean.");
  } finally {
    release?.();
    await browser?.close();
    if (server?.child && server.child.exitCode === null) await new Promise(resolve => { server.child.once("exit", resolve); server.child.kill(); });
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith("frame-tuner-attachment-race-"));
    fs.rmSync(root, { recursive: true, force: true });
  }
}
test().catch(error => { console.error(error); process.exitCode = 1; });
