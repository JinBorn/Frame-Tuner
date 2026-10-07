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
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "frame-tuner-frame-controls-"));
  let server, browser;
  try {
    const service = createWorkbenchService({ root });
    service.createProject({ id: "hero", label: "Hero" });
    const sample = createSamplePackage();
    service.importAnimation({ projectId: "hero", profileId: "hero", animationId: "idle", fps: 12,
      files: [0, 1].map(index => ({ name: `${index}.png`, data: `data:image/png;base64,${sample.files.get(`frames/demo_${index}.png`).toString("base64")}` })) });
    server = await startExportServer(root);
    browser = await chromium.launch({ executablePath: findBrowser(), headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [], deletes = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("request", request => { if (new URL(request.url()).pathname === "/api/delete-frame") deletes.push(request.postDataJSON()); });
    await page.goto(`${server.url}/?project=hero&export=1`);
    await page.evaluate(() => window.FrameTunerWorkbench.ready);
    const thumb = index => page.locator(`#filmstrip .thumb[data-frame-index="${index}"]`);
    const waitFrames = async count => {
      await page.waitForFunction(expected => !window.FrameTunerWorkbench.current().loading && currentGroup.frames.length === expected, count);
      assert.equal(await page.locator("#filmstrip .thumb").count(), count);
    };

    await page.locator("label:has(> #frameReference)").click();
    await thumb(1).locator(".frameSelect").click();
    await page.locator("#frameReference").focus();
    assert.equal(await page.evaluate(() => Boolean(referenceFrame)), true);
    await page.keyboard.down("h");
    assert.equal(await page.evaluate(() => referenceFrameHiddenByKey), true, "H works with the reference checkbox focused");
    await page.keyboard.up("h");
    assert.equal(await page.evaluate(() => referenceFrameHiddenByKey), false);
    await page.keyboard.down("h");
    await page.locator("#groupSearch").focus();
    await page.keyboard.up("h");
    assert.equal(await page.evaluate(() => referenceFrameHiddenByKey), false, "Keyup restores the reference even after focus changes");
    await page.locator("#groupSearch").fill("");
    await page.keyboard.down("h");
    assert.equal(await page.locator("#groupSearch").inputValue(), "h", "Text entry is not intercepted");
    assert.equal(await page.evaluate(() => referenceFrameHiddenByKey), false);
    await page.keyboard.up("h");
    await page.locator("#groupSearch").fill("");
    await page.evaluate(() => { referenceFrame = null; referenceFrameHiddenByKey = false; view = { ...view, zoom: 1.37 }; draw(); });

    const preview = () => page.evaluate(() => { draw(); return document.querySelector("#stage").toDataURL("image/png"); });
    const bake = () => page.evaluate(() => {
      const api = window.XsxbFrameTunerLite;
      return api.renderFrame(api.timeline()[0], { width: 512, height: 512, originPixelX: 256, originPixelY: 256 });
    });
    await page.locator('[data-preview-sampling="smooth"]').click();
    const smoothPreview = await preview(), smoothExport = await bake();
    await page.locator('[data-preview-sampling="pixel"]').click();
    assert.equal(await page.locator('[data-preview-sampling="pixel"]').getAttribute("aria-pressed"), "true");
    assert.equal(await page.locator("#stage").getAttribute("data-sampling"), "pixel");
    const pixelPreview = await preview(), pixelExport = await bake();
    assert.notEqual(pixelPreview, smoothPreview, "Sampling changes actual canvas pixels at fractional zoom");
    assert.equal(pixelExport, smoothExport, "Preview sampling does not change exported PNG bytes");

    await thumb(0).locator('[data-action="duplicate-frame"]').click();
    await waitFrames(3);
    const original = service.projectData("hero");
    const originalFrames = original.manifest.profiles[0].animations[0].frames;
    assert.equal(originalFrames[0].path, originalFrames[1].path, "Duplicate retains source image");
    const beforeCancel = [original.paths.manifest, original.paths.tuning, original.paths.frameAudio, original.paths.frameImageAttachments, original.paths.attackTrails].map(file => [file, fs.readFileSync(file, "utf8")]);
    const cancelled = page.waitForEvent("dialog").then(dialog => dialog.dismiss());
    await thumb(1).locator('[data-action="delete-frame"]').click();
    await cancelled;
    assert.equal(deletes.length, 0, "Cancelling deletion sends no mutation request");
    for (const [file, contents] of beforeCancel) assert.equal(fs.readFileSync(file, "utf8"), contents);
    await waitFrames(3);

    await page.setViewportSize({ width: 1280, height: 640 });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const bounds = await page.locator('#filmstrip [data-action="delete-frame"]').evaluateAll(buttons => buttons.map(button => {
      const rect = button.getBoundingClientRect(), card = button.closest(".thumb").getBoundingClientRect();
      return { contained: rect.left >= card.left - 1 && rect.right <= card.right + 1 && rect.top >= card.top - 1 && rect.bottom <= card.bottom + 1, width: rect.width, height: rect.height };
    }));
    assert.ok(bounds.every(value => value.contained && value.width > 0 && value.height > 0), `Delete buttons stay inside their cards at 1280×640: ${JSON.stringify(bounds)}`);

    for (const remaining of [2, 1]) {
      const accepted = page.waitForEvent("dialog").then(async dialog => {
        assert.match(dialog.message(), /不能撤销|cannot be undone/);
        await dialog.accept();
      });
      await thumb(1).locator('[data-action="delete-frame"]').click();
      await accepted;
      await waitFrames(remaining);
    }
    assert.equal(deletes.length, 2);
    assert.equal(await thumb(0).locator('[data-action="delete-frame"]').isDisabled(), true);
    await thumb(0).locator('[data-action="delete-frame"]').evaluate(button => button.click());
    assert.equal(deletes.length, 2, "Last frame cannot trigger deletion");
    for (const frame of originalFrames) assert.equal(fs.existsSync(path.join(root, frame.path)), true, "Deleting a frame preserves original asset files");
    assert.equal(service.projectData("hero").manifest.profiles[0].animations[0].frames.length, 1);
    await page.reload();
    await page.evaluate(() => window.FrameTunerWorkbench.ready);
    await waitFrames(1);
    assert.equal(await thumb(0).locator('[data-action="delete-frame"]').isDisabled(), true);
    assert.equal(await page.locator('[data-preview-sampling="pixel"]').getAttribute("aria-pressed"), "true", "Preview preference survives reload");
    assert.deepEqual(errors, []);
    console.log("Frame controls passed: H checkbox/text/focus release; actual preview sampling and stable export; duplicate/delete cancel/confirm, last-frame guard, original assets, reload, and short-window card bounds.");
  } finally {
    await browser?.close();
    if (server?.child && server.child.exitCode === null) await new Promise(resolve => { server.child.once("exit", resolve); server.child.kill(); });
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
    assert.match(path.basename(root), /^frame-tuner-frame-controls-/);
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test().catch(error => { console.error(error); process.exitCode = 1; });
