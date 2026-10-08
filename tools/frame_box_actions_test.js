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
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "frame-tuner-box-actions-"));
  let browser, server, release;
  try {
    const service = createWorkbenchService({ root });
    const png = createSamplePackage().files.get("frames/demo_0.png").toString("base64");
    for (const id of ["first", "second"]) {
      service.createProject({ id, label: id });
      for (const profileId of ["hero", "rival"]) for (const animationId of ["attack", "run"]) {
        service.importAnimation({ projectId: id, profileId, animationId,
          files: [0, 1, 2].map(index => ({ name: `${index}.png`, data: `data:image/png;base64,${png}` })) });
      }
    }
    service.importAnimation({ projectId: "first", profileId: "hero", animationId: "effect", files: [{ name: "0.png", data: `data:image/png;base64,${png}` }] });
    const fixture = service.projectData("first");
    const effect = fixture.manifest.profiles.find(profile => profile.id === "hero").animations.find(animation => animation.id === "effect");
    effect.type = "actor"; effect.previewOwner = "hero/attack";
    service.store.writeJson(fixture.paths.manifest, fixture.manifest);
    fixture.tuning.frame_box_overrides = {};
    fixture.tuning.frame_visual_overrides = {};
    fixture.tuning.frame_playback_overrides = {};
    for (const profile of fixture.manifest.profiles) for (const animation of profile.animations) for (let index = 0; index < animation.frames.length; index++) {
      const key = `${profile.id}/${animation.id}:${index}`;
      const n = index + (profile.id === "rival" ? 40 : animation.id === "run" ? 20 : 0);
      const box = (kind, enabled) => ({ size: { x: n + 16, y: n + 20 }, offset: { x: n + 3, y: kind === "collisionbox" ? -(n + 20) / 2 : -n - 7 },
        rotation: kind === "collisionbox" ? 0 : n + 11, enabled, fixtureBoxMetadata: `${key}/${kind}` });
      fixture.tuning.frame_box_overrides[key] = { fixtureEntryMetadata: { key }, hurtbox: box("hurtbox", true),
        collisionbox: box("collisionbox", index !== 1), hitbox: box("hitbox", index !== 1) };
      if (animation.id === "run" && index === 2) delete fixture.tuning.frame_box_overrides[key].hurtbox;
      fixture.tuning.frame_visual_overrides[key] = { visual_size: 1 + index / 10, offset: { x: index * 3, y: index * -4 }, rotation: index * 5 };
      fixture.tuning.frame_playback_overrides[key] = { duration_ms: 100 + index * 30 };
    }
    service.store.writeJson(fixture.paths.tuning, fixture.tuning);
    server = await startExportServer(root);
    browser = await chromium.launch({ executablePath: findBrowser(), headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`${server.url}/?project=first&export=1`);
    await page.evaluate(() => window.FrameTunerWorkbench.ready);
    const selectGroup = (profileId, animationId) => page.evaluate(async ({ profileId, animationId }) => {
      await window.FrameTunerWorkbench.selectGroup(config.groups.find(group => group.profileId === profileId && group.animationId === animationId).uiId);
    }, { profileId, animationId });
    await selectGroup("hero", "attack");
    await page.evaluate(async image => {
      const bytes = Uint8Array.from(atob(image), c => c.charCodeAt(0));
      await bindFrameImageAttachmentFile(new File([bytes], "layer.png", { type: "image/png" }), 1, currentGroup);
      const wav = new Uint8Array(46), view = new DataView(wav.buffer);
      for (const [offset, value] of [[0, "RIFF"], [8, "WAVE"], [12, "fmt "], [36, "data"]]) [...value].forEach((c, n) => wav[offset + n] = c.charCodeAt(0));
      view.setUint32(4, 38, true); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
      view.setUint32(24, 8000, true); view.setUint32(28, 16000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); view.setUint32(40, 2, true);
      await bindFrameAudioFile(new File([wav], "sound.wav", { type: "audio/wav" }), 1, currentGroup);
      selectedAttachmentId = null;
      await window.FrameTunerWorkbench.save();
      syncFrameInputs(); renderFilmstrip(); draw();
    }, png);
    const selectors = ["#copyFrameBox", "#applyFrameBoxSelection", "#applyFrameBoxAnimation", "#applyFrameBoxCharacter"];
    const frame = index => page.locator(`#filmstrip .thumb:not(.attachmentThumb)[data-frame-index="${index}"] .frameSelect`);
    const boxChoice = async kind => {
      if (!(await page.locator('[data-panel="boxes"]').evaluate(panel => panel.open))) await page.locator('[data-panel="boxes"] > summary').click();
      await page.evaluate(() => { selectedBoxes.clear(); selectedBox = ""; syncBoxInputs(); });
      await page.locator(`label:has(> [data-box-choice="${kind}"])`).click();
      assert.equal(await page.evaluate(() => selectedBox), kind);
    };
    const snapshot = () => page.evaluate(() => window.XsxbFrameTunerLite.snapshotProject());
    const getBoxes = () => page.evaluate(() => structuredClone(frameBoxOverrides));
    const baseline = await snapshot();
    const baselineDisk = service.projectData("first");
    assert.equal(baseline.frameAudioBindings.length, 1); assert.equal(baseline.frameImageAttachments.length, 1);
    const expectPatch = (before, keys, kind, copied) => {
      const expected = structuredClone(before);
      for (const key of keys) expected[key] = { ...expected[key], [kind]: { ...expected[key]?.[kind], ...copied } };
      return expected;
    };
    const clickConfirmed = async (selector, accept) => {
      const dialog = page.waitForEvent("dialog").then(async dialog => {
        assert.equal(dialog.type(), "confirm");
        assert.match(dialog.message(), /撤销|undo/i);
        if (accept) await dialog.accept(); else await dialog.dismiss();
      });
      await page.locator(selector).click(); await dialog;
    };
    const history = async action => { await page.locator(action === "undo" ? "#undoTop" : "#redoTop").click(); await page.waitForFunction(() => !selectionLoading); };
    await boxChoice("hurtbox"); await frame(1).click();
    const sourceHurt = await page.evaluate(() => frameBox("hurtbox"));
    await page.locator(selectors[0]).click();
    await frame(0).click(); await frame(2).click({ modifiers: ["Control"] });
    const beforeSelection = await getBoxes(), undoBefore = await page.evaluate(() => undoStack.length);
    await page.locator(selectors[1]).click();
    const selectedBoxesExpected = expectPatch(beforeSelection, ["hero/attack:0", "hero/attack:2"], "hurtbox", sourceHurt);
    assert.deepEqual(await getBoxes(), selectedBoxesExpected, "Selected apply changes only this box on Ctrl-selected frames, preserving unselected/other fields");
    assert.equal(await page.evaluate(() => undoStack.length), undoBefore + 1);
    await history("undo"); assert.deepEqual(await getBoxes(), beforeSelection);
    await history("redo"); assert.deepEqual(await getBoxes(), selectedBoxesExpected);
    await selectGroup("hero", "run");
    assert.equal(await page.locator(selectors[1]).isDisabled(), false, "Same character can paste across actions");
    const beforeCancel = await getBoxes(), undoCancel = await page.evaluate(() => undoStack.length);
    await clickConfirmed(selectors[2], false);
    assert.deepEqual(await getBoxes(), beforeCancel); assert.equal(await page.evaluate(() => undoStack.length), undoCancel);
    await clickConfirmed(selectors[2], true);
    assert.deepEqual(await getBoxes(), expectPatch(beforeCancel, [0, 1, 2].map(i => `hero/run:${i}`), "hurtbox", sourceHurt), "Whole action creates missing boxes without changing siblings or metadata");
    const beforeCharacter = await getBoxes();
    await clickConfirmed(selectors[3], true);
    const heroKeys = ["attack", "run"].flatMap(action => [0, 1, 2].map(i => `hero/${action}:${i}`));
    const afterCharacter = expectPatch(beforeCharacter, heroKeys, "hurtbox", sourceHurt);
    assert.deepEqual(await getBoxes(), afterCharacter, "Character scope excludes rival and actor proxy/previewOwner entries");
    assert.deepEqual(await page.evaluate(() => [...dirtyGroupRevisions.keys()].sort()), ["hero/attack", "hero/run"], "Every edited action is dirty and no unrelated action is marked");
    await page.evaluate(() => window.FrameTunerWorkbench.save());
    await history("undo");
    assert.deepEqual(await getBoxes(), beforeCharacter, "One undo restores all groups after bulk save");
    assert.deepEqual(await page.evaluate(() => [...dirtyGroupRevisions.keys()].sort()), ["hero/attack", "hero/run"], "Undo marks all affected actions dirty after save");
    await page.evaluate(() => window.FrameTunerWorkbench.save());
    assert.deepEqual(service.projectData("first").tuning.frame_box_overrides, beforeCharacter, "Save after undo persists all restored groups");
    await history("redo"); assert.deepEqual(await getBoxes(), afterCharacter);
    assert.deepEqual(await page.evaluate(() => [...dirtyGroupRevisions.keys()].sort()), ["hero/attack", "hero/run"], "Redo marks all affected actions dirty after undo/save");

    await selectGroup("hero", "attack"); await boxChoice("collisionbox");
    assert.equal(await page.locator(selectors[1]).isDisabled(), true, "A different selected box cannot receive clipboard data");
    await frame(1).click(); await page.locator(selectors[0]).click();
    const collision = await page.evaluate(() => frameBox("collisionbox"));
    assert.equal(collision.enabled, false);
    await frame(0).click(); await frame(2).click({ modifiers: ["Control"] });
    const beforeCollision = await getBoxes(); await page.locator(selectors[1]).click();
    assert.deepEqual(await getBoxes(), expectPatch(beforeCollision, ["hero/attack:0", "hero/attack:2"], "collisionbox", collision), "Collision copy retains floor-anchored geometry and disabled state");
    await boxChoice("hitbox"); await frame(1).click(); await page.locator(selectors[0]).click();
    const hit = await page.evaluate(() => frameBox("hitbox"));
    assert.equal(hit.enabled, false);
    for (const selector of selectors.slice(2)) assert.equal(await page.locator(selector).isDisabled(), true, "Hitbox forbids action/character bulk apply");
    const beforeHit = await getBoxes();
    await page.evaluate(() => { runFrameBoxAction("animation"); runFrameBoxAction("character"); });
    assert.deepEqual(await getBoxes(), beforeHit, "Hitbox guard also rejects direct calls");
    await frame(0).click(); await frame(2).click({ modifiers: ["Control"] }); await page.locator(selectors[1]).click();
    assert.deepEqual(await getBoxes(), expectPatch(beforeHit, ["hero/attack:0", "hero/attack:2"], "hitbox", hit), "Selected hitbox paste preserves enabled=false outside default attack windows");
    await selectGroup("rival", "attack");
    assert.equal(await page.locator(selectors[1]).isDisabled(), true, "Another character cannot use this clipboard");
    await selectGroup("hero", "effect");
    await boxChoice("hurtbox");
    await page.waitForFunction(selectors => selectors.every(selector => document.querySelector(selector).disabled), selectors);
    const beforeProxy = await getBoxes();
    await page.evaluate(() => { for (const action of ["copy", "selection", "animation", "character"]) runFrameBoxAction(action); });
    assert.deepEqual(await getBoxes(), beforeProxy, "An actor proxy cannot copy/apply boxes or mutate its preview owner");
    await selectGroup("hero", "attack");
    const final = await snapshot();
    for (const field of ["frame_visual_overrides", "frame_playback_overrides"]) assert.deepEqual(final.tuning[field], baseline.tuning[field], `${field} is unchanged`);
    for (const field of ["frameAudioBindings", "frameImageAttachments"]) assert.deepEqual(final[field], baseline[field], `${field} is unchanged`);
    const exported = await page.evaluate(() => [0, 1, 2].map(frameIndex => window.XsxbFrameTunerLite.frameMetadata({ frameIndex })));
    await page.evaluate(() => window.FrameTunerWorkbench.save());
    for (const field of ["frameAudioBindings", "frameImageAttachments"]) assert.deepEqual(service.projectData("first")[field], baselineDisk[field]);
    await page.reload(); await page.evaluate(() => window.FrameTunerWorkbench.ready); await selectGroup("hero", "attack");
    assert.deepEqual(await getBoxes(), final.tuning.frame_box_overrides, "All boxes and unknown metadata survive save/reload");
    assert.deepEqual(await page.evaluate(() => [0, 1, 2].map(frameIndex => window.XsxbFrameTunerLite.frameMetadata({ frameIndex }))), exported, "Exported normalized/source box metadata agrees across reload");
    assert.deepEqual((await snapshot()).tuning.frame_box_overrides, final.tuning.frame_box_overrides, "Editable export snapshot preserves unknown box metadata");

    await boxChoice("hurtbox"); await page.locator(selectors[0]).click();
    await boxChoice("collisionbox");
    const beforeMismatch = await getBoxes();
    await page.evaluate(() => runFrameBoxAction("selection"));
    assert.deepEqual(await getBoxes(), beforeMismatch, "Mismatched active box type is guarded");
    await boxChoice("hurtbox");
    for (const operation of ["save", "load"]) {
      let reached;
      const started = new Promise(resolve => { reached = resolve; });
      const gate = new Promise(resolve => { release = resolve; });
      const pattern = operation === "save" ? "**/api/save" : "**/api/config?*";
      await page.route(pattern, async route => { reached(); await gate; await route.continue(); });
      const before = await getBoxes();
      const pending = page.evaluate(kind => kind === "save" ? window.FrameTunerWorkbench.save() : window.FrameTunerWorkbench.reload("second"), operation);
      pending.catch(() => {}); await started;
      await page.waitForFunction(selectors => selectors.every(selector => document.querySelector(selector).disabled), selectors);
      await page.evaluate(() => { for (const action of ["copy", "selection", "animation", "character"]) runFrameBoxAction(action); });
      if (operation === "save") assert.deepEqual(await getBoxes(), before, "Busy direct calls cannot edit boxes");
      release(); await pending; release = null; await page.unroute(pattern);
    }
    await boxChoice("hurtbox");
    assert.equal(await page.locator(selectors[1]).isDisabled(), true, "Project switch clears box clipboard");
    await page.evaluate(() => window.FrameTunerWorkbench.reload("first")); await boxChoice("hurtbox");
    assert.equal(await page.locator(selectors[1]).isDisabled(), true, "Returning project cannot resurrect clipboard");
    assert.deepEqual(errors, []);
    console.log("Frame box actions passed: scoped copy/paste, whole-action confirm, strict character scope, disabled hitboxes, metadata preservation, cross-group undo/save/redo, export/reload and busy/clipboard guards.");
  } finally {
    release?.(); await browser?.close();
    if (server?.child && server.child.exitCode === null) await new Promise(resolve => { server.child.once("exit", resolve); server.child.kill(); });
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir())); assert.match(path.basename(root), /^frame-tuner-box-actions-/);
    fs.rmSync(root, { recursive: true, force: true });
  }
}
test().catch(error => { console.error(error); process.exitCode = 1; });
