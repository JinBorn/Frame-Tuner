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
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "frame-tuner-inheritance-"));
  let browser, server;
  try {
    const service = createWorkbenchService({ root });
    service.createProject({ id: "hero", label: "Hero" });
    const sample = createSamplePackage();
    service.importAnimation({ projectId: "hero", profileId: "hero", animationId: "idle", fps: 12,
      files: [0, 1].map(index => ({ name: `${index}.png`, data: "data:image/png;base64," + sample.files.get(`frames/demo_${index}.png`).toString("base64") })) });
    server = await startExportServer(root);
    browser = await chromium.launch({ executablePath: findBrowser(), headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`${server.url}/?project=hero&export=1`);
    await page.evaluate(() => window.FrameTunerWorkbench.ready);
    await page.evaluate(() => {
      const store = valueStore();
      store[currentGroup.scale] = 1;
      store[currentGroup.scaleVector] = { x: 1, y: 1 };
      store[currentGroup.rotation] = 30;
      overrideStore()[tuningFrameKey(0)] = { visual_size: 2, offset: { x: 4, y: 5 } };
      overrideStore()[tuningFrameKey(1)] = { visual_size: 3, visual_scale: { x: 4, y: 5 }, rotation: 0 };
      setAdjustmentMode("group");
      syncFrameInputs();
      draw();
    });
    const initial = await page.evaluate(() => [frameTransform(0), frameTransform(1)]);
    const scale = page.locator("#baseScale");
    await scale.fill("2");
    await scale.press("Enter");
    const scaled = await page.evaluate(() => [frameTransform(0), frameTransform(1)]);
    assert.equal(scaled[0].scale, 4);
    assert.equal(scaled[0].scaleX, 4, "A uniform frame override scales once when the group doubles");
    assert.equal(scaled[0].scaleY, 4);
    assert.equal(scaled[1].scale, 6);
    assert.equal(scaled[1].scaleX, 8, "Explicit nonuniform axes preserve their ratios");
    assert.equal(scaled[1].scaleY, 10);
    assert.equal(initial[0].rotation, 30, "A partial override inherits the group rotation");
    assert.equal(initial[1].rotation, 0, "Explicit zero rotation remains an override");
    await page.locator("#undoTop").click();
    await page.waitForFunction(() => !selectionLoading);
    assert.deepEqual(await page.evaluate(() => [frameTransform(0), frameTransform(1)]), initial);
    await page.locator("#redoTop").click();
    await page.waitForFunction(() => !selectionLoading);
    assert.deepEqual(await page.evaluate(() => [frameTransform(0), frameTransform(1)]), scaled);

    // An offset-only frame inherits nonuniform group axes without applying the next ratio twice.
    await page.evaluate(() => {
      overrideStore()[tuningFrameKey(0)] = { offset: { x: 4, y: 5 } };
      const store = valueStore();
      store[currentGroup.scale] = 2;
      store[currentGroup.scaleVector] = { x: 3, y: 4 };
      syncFrameInputs();
    });
    await page.locator("#baseScaleX").fill("6");
    await page.locator("#baseScaleX").press("Enter");
    const inherited = await page.evaluate(() => frameTransform(0));
    assert.equal(inherited.scaleX, 6);
    assert.equal(inherited.scaleY, 4);
    assert.deepEqual(inherited.offset, { x: 4, y: 5 });
    const duration = page.locator("#groupTimeMs");
    const timingBefore = await page.evaluate(() => ({ ms: groupTimeMs(), undo: undoStack.length }));
    await page.locator("#playPause").click();
    await duration.focus();
    assert.equal(await page.evaluate(() => playing), false, "Typing duration pauses playback so frame refreshes do not overwrite the draft");
    await duration.press("ControlOrMeta+A");
    await duration.pressSequentially("1000");
    assert.equal(await duration.inputValue(), "1000", "Group duration typing preserves intermediate digits");
    await duration.press("Enter");
    assert.equal(await page.evaluate(() => groupTimeMs()), 1000);
    assert.equal(await page.evaluate(() => undoStack.length), timingBefore.undo + 1, "One duration edit creates one undo entry");
    await page.locator("#undoTop").click();
    await page.waitForFunction(() => !selectionLoading);
    assert.equal(await page.evaluate(() => groupTimeMs()), timingBefore.ms);
    await duration.fill("777");
    await duration.press("Escape");
    assert.equal(await page.evaluate(() => groupTimeMs()), timingBefore.ms, "Escape cancels duration draft");
    const beforeSaveUndo = await page.evaluate(() => undoStack.length);
    await duration.fill("750");
    await duration.press("ControlOrMeta+s");
    await page.waitForFunction(() => !window.FrameTunerWorkbench.current().saving && !window.FrameTunerWorkbench.current().dirty);
    assert.equal(await page.evaluate(() => groupTimeMs()), 750, "Ctrl+S commits the focused duration draft");
    assert.equal(await page.evaluate(() => undoStack.length), beforeSaveUndo + 1, "Ctrl+S creates one undo entry for the duration edit");
    await page.reload();
    await page.evaluate(() => window.FrameTunerWorkbench.ready);
    assert.equal(await page.evaluate(() => groupTimeMs()), 750, "Ctrl+S persists the newly entered duration across reload");
    assert.deepEqual(errors, []);
    console.log("Transform inheritance passed: uniform/nonuniform group scaling, partial rotation, explicit zero, offset-only inheritance, undo/redo; group duration typing, one-step undo, Escape, playback pause and Ctrl+S persistence across reload.");
  } finally {
    await browser?.close();
    if (server?.child && server.child.exitCode === null) await new Promise(resolve => { server.child.once("exit", resolve); server.child.kill(); });
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
    assert.match(path.basename(root), /^frame-tuner-inheritance-/);
    fs.rmSync(root, { recursive: true, force: true });
  }
}
test().catch(error => { console.error(error); process.exitCode = 1; });
