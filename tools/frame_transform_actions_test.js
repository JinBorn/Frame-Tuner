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
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "frame-tuner-transform-actions-"));
  let browser, server, release;
  try {
    const service = createWorkbenchService({ root });
    const png = createSamplePackage().files.get("frames/demo_0.png").toString("base64");
    for (const id of ["first", "second"]) {
      service.createProject({ id, label: id });
      for (const animationId of ["idle", "run"]) service.importAnimation({ projectId: id, profileId: "hero", animationId,
        files: [0, 1, 2].map(index => ({ name: `${index}.png`, data: `data:image/png;base64,${png}` })) });
    }
    server = await startExportServer(root);
    browser = await chromium.launch({ executablePath: findBrowser(), headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`${server.url}/?project=first&export=1`);
    await page.evaluate(() => window.FrameTunerWorkbench.ready);
    await page.evaluate(async pngData => {
      await selectGroup(config.groups.find(group => group.animationId === "idle" || group.animation === "hero/idle") || config.groups[0]);
      window.fixtureGroupId = currentGroup.uiId;
      const store = valueStore();
      store[currentGroup.scale] = 1.25;
      store[currentGroup.scaleVector] = { x: 1.5, y: 0.75 };
      store[currentGroup.offset] = { x: 7, y: -9 };
      store[currentGroup.rotation] = 15;
      for (let index = 0; index < 3; index++) {
        overrideStore()[tuningFrameKey(index)] = { visual_size: index + 2, visual_scale: { x: index + 2.5, y: index + 1.5 },
          offset: { x: index * 13 + 2, y: index * -7 - 3 }, rotation: index * 21 - 11, fixtureMetadata: { frame: index } };
        framePlaybackOverrides[tuningFrameKey(index)] = { duration_ms: 100 + index * 30 };
        frameBoxOverrides[tuningFrameKey(index)] = { hitboxes: [{ x: index + 1, y: 2, width: 3, height: 4 }], hurtboxes: [] };
        const imageBytes = Uint8Array.from(atob(pngData), c => c.charCodeAt(0));
        await bindFrameImageAttachmentFile(new File([imageBytes], `layer-${index}.png`, { type: "image/png" }), index, currentGroup);
        const wav = new Uint8Array(46), view = new DataView(wav.buffer);
        for (const [offset, value] of [[0, "RIFF"], [8, "WAVE"], [12, "fmt "], [36, "data"]]) [...value].forEach((c, n) => wav[offset + n] = c.charCodeAt(0));
        view.setUint32(4, 38, true); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
        view.setUint32(24, 8000, true); view.setUint32(28, 16000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); view.setUint32(40, 2, true);
        await bindFrameAudioFile(new File([wav], `sound-${index}.wav`, { type: "audio/wav" }), index, currentGroup);
      }
      selectedAttachmentId = null;
      selectedFrame = 1; selectedFrames = new Set([1]);
      setAdjustmentMode("frame"); syncFrameInputs(); renderFilmstrip(); draw();
      markDirty();
      await window.FrameTunerWorkbench.save();
    }, png);
    const buttons = ["#resetFrameTransform", "#copyFrameTransform", "#applyFrameTransform"];
    const select = index => page.locator(`#filmstrip .thumb:not(.attachmentThumb)[data-frame-index="${index}"] .frameSelect`);
    const state = () => page.evaluate(() => ({ transforms: [0, 1, 2].map(index => frameTransform(index)),
      overrides: structuredClone(overrideStore()), playback: structuredClone(framePlaybackOverrides), boxes: structuredClone(frameBoxOverrides),
      audio: Object.values(frameAudioBindings).map(({ url, ...binding }) => binding), attachments: collectFrameImageAttachmentsForSave() }));
    const untouched = snapshot => ({ playback: snapshot.playback, boxes: snapshot.boxes, audio: snapshot.audio, attachments: snapshot.attachments,
      metadata: Object.values(snapshot.overrides).map(override => override.fixtureMetadata) });
    const initial = await state();
    const baselineData = service.projectData("first");
    assert.equal(initial.audio.length, 3); assert.equal(initial.attachments.length, 3);
    assert.equal(await page.locator(buttons[2]).isDisabled(), true, "Empty clipboard disables apply");
    await select(1).click();
    await page.locator(buttons[1]).click();
    await select(0).click();
    await select(2).click({ modifiers: ["Control"] });
    assert.deepEqual(await page.evaluate(() => [...selectedFrames].sort()), [0, 2]);
    const undoCount = await page.evaluate(() => undoStack.length);
    await page.locator(buttons[2]).click();
    const pasted = await state();
    assert.deepEqual(pasted.transforms, [initial.transforms[1], initial.transforms[1], initial.transforms[1]], "Apply copies exact primary transform to noncontiguous selected frames");
    assert.deepEqual(untouched(pasted), untouched(initial), "Apply preserves per-frame metadata, timing, boxes, audio and attachments");
    assert.equal(await page.evaluate(() => undoStack.length), undoCount + 1);
    await page.locator("#undoTop").click(); await page.waitForFunction(() => !selectionLoading);
    assert.deepEqual(await state(), initial, "One undo restores both targets");
    await page.locator("#redoTop").click(); await page.waitForFunction(() => !selectionLoading);
    assert.deepEqual(await state(), pasted, "One redo reapplies both targets");
    await page.locator(buttons[0]).click();
    const reset = await state();
    const base = await page.evaluate(() => { const { visual_scale, ...transform } = baseTransform(); return transform; });
    assert.deepEqual(reset.transforms, [base, initial.transforms[1], base], "Reset selected frames to inherited group base");
    assert.deepEqual(untouched(reset), untouched(initial));
    const targetOverrides = await page.evaluate(() => [0, 2].map(index => overrideStore()[tuningFrameKey(index)]));
    assert.deepEqual(targetOverrides, [{ fixtureMetadata: { frame: 0 } }, { fixtureMetadata: { frame: 2 } }], "Reset removes only visual fields");
    await page.locator("#undoTop").click(); await page.waitForFunction(() => !selectionLoading);
    assert.deepEqual(await state(), pasted);
    await page.evaluate(() => window.FrameTunerWorkbench.save());
    const saved = service.projectData("first");
    for (const field of ["frameAudioBindings", "frameImageAttachments"]) assert.deepEqual(saved[field], baselineData[field], `Saving transforms preserves ${field} on disk`);
    for (const field of ["frame_playback_overrides", "frame_box_overrides"]) assert.deepEqual(saved.tuning[field], baselineData.tuning[field], `Saving transforms preserves ${field} on disk`);
    await page.reload(); await page.evaluate(() => window.FrameTunerWorkbench.ready);
    await page.locator('label:has(> #adjustFrame)').click();
    assert.deepEqual((await state()).transforms, pasted.transforms, "Saved transforms survive reload");
    assert.deepEqual(service.projectData("first").tuning, saved.tuning);
    assert.equal(await page.locator(buttons[2]).isDisabled(), true, "Reload clears clipboard");
    await page.locator(buttons[1]).click();
    for (const mode of ["Group", "Character"]) {
      await page.locator(`label:has(> #adjust${mode})`).click();
      for (const selector of buttons) assert.equal(await page.locator(selector).isDisabled(), true, `${mode} disables frame-only actions`);
    }
    await page.locator('label:has(> #adjustFrame)').click();
    const originalGroup = await page.evaluate(() => currentGroup.uiId);
    await page.evaluate(async () => selectGroup(config.groups.find(group => group.uiId !== currentGroup.uiId)));
    assert.equal(await page.locator(buttons[2]).isDisabled(), true, "Another action cannot paste this clipboard");
    await page.evaluate(async id => selectGroup(config.groups.find(group => group.uiId === id)), originalGroup);
    assert.equal(await page.locator(buttons[2]).isDisabled(), false, "Returning to original action retains clipboard");

    // Delay real requests, so both disabled UI and handler guards are exercised during actual operations.
    for (const operation of ["save", "load"]) {
      let reached;
      const started = new Promise(resolve => { reached = resolve; });
      const gate = new Promise(resolve => { release = resolve; });
      const pattern = operation === "save" ? "**/api/save" : "**/api/config?*";
      await page.route(pattern, async route => { reached(); await gate; await route.continue(); });
      const before = await state();
      const pending = page.evaluate(kind => kind === "save" ? window.FrameTunerWorkbench.save() : window.FrameTunerWorkbench.reload("second"), operation);
      pending.catch(() => {}); // Cleanup closes the page if an assertion fails while this request is held.
      await started;
      await page.waitForFunction(selectors => selectors.every(selector => document.querySelector(selector).disabled), buttons);
      for (const selector of buttons) assert.equal(await page.locator(selector).isDisabled(), true, `${operation} disables ${selector}`);
      await page.evaluate(() => { runFrameTransformAction("reset"); runFrameTransformAction("apply"); runFrameTransformAction("copy"); });
      if (operation === "save") assert.deepEqual(await state(), before, "Busy handler guards reject edits even when called directly");
      release(); await pending; release = null;
      await page.unroute(pattern);
    }
    await page.locator('label:has(> #adjustFrame)').click();
    assert.equal(await page.locator(buttons[2]).isDisabled(), true, "Changing project clears clipboard");
    await page.evaluate(() => window.FrameTunerWorkbench.reload("first"));
    await page.locator('label:has(> #adjustFrame)').click();
    assert.equal(await page.locator(buttons[2]).isDisabled(), true, "Returning project cannot resurrect clipboard");
    // An effective transform equal to the base is still allowed to carry authored metadata.
    await select(1).click();
    await page.locator(buttons[0]).click();
    await page.locator(buttons[1]).click();
    await select(0).click();
    await page.locator(buttons[2]).click();
    const baseCopy = await state();
    assert.deepEqual(baseCopy.transforms[0], baseCopy.transforms[1]);
    await page.evaluate(() => window.FrameTunerWorkbench.save());
    await page.reload(); await page.evaluate(() => window.FrameTunerWorkbench.ready);
    const afterBaseCopy = await state();
    assert.deepEqual(afterBaseCopy.transforms[0], baseCopy.transforms[0], "A pasted base transform survives save/reload");
    const retainedMetadata = await page.evaluate(() => [0, 1, 2].map(index => overrideStore()[tuningFrameKey(index)]?.fixtureMetadata));
    assert.deepEqual(retainedMetadata, [{ frame: 0 }, { frame: 1 }, { frame: 2 }], "Pruning no-op visual overrides must retain authored metadata, including reset and pasted-base frames");
    assert.deepEqual(errors, []);
    console.log("Frame transform actions passed: exact primary copy to noncontiguous selection, metadata/timing/boxes/audio/attachments preserved, single undo/redo, inherited reset, persistence, scope/mode and real save/load guards.");
  } finally {
    release?.();
    await browser?.close();
    if (server?.child && server.child.exitCode === null) await new Promise(resolve => { server.child.once("exit", resolve); server.child.kill(); });
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
    assert.match(path.basename(root), /^frame-tuner-transform-actions-/);
    fs.rmSync(root, { recursive: true, force: true });
  }
}
test().catch(error => { console.error(error); process.exitCode = 1; });
