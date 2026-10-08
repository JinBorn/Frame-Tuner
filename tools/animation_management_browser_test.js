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
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "frame-tuner-animation-ui-"));
  let browser, server, release;
  try {
    const service = createWorkbenchService({ root });
    const bytes = createSamplePackage().files.get("frames/demo_0.png");
    for (const id of ["managed", "last"]) {
      service.createProject({ id, label: id });
      const scopes = id === "managed" ? [["hero", "idle"], ["hero", "run"], ["hero", "attack"], ["rival", "idle"]] : [["solo", "only"]];
      for (const [profileId, animationId] of scopes) service.importAnimation({ projectId: id, profileId, animationId,
        files: [0, 1].map(index => ({ name: `${index}.png`, data: `data:image/png;base64,${bytes.toString("base64")}` })) });
    }
    const fixture = service.projectData("managed");
    fixture.tuning.frame_visual_overrides = { "hero/idle:0": { offset: { x: 3, y: -4 }, fixtureMetadata: "keep" }, "rival/idle:0": { rotation: 11 } };
    fixture.tuning.frame_playback_overrides = { "hero/idle:0": { duration_ms: 130 }, "rival/idle:0": { duration_ms: 170 } };
    service.store.writeJson(fixture.paths.tuning, fixture.tuning);
    const rivalBefore = structuredClone(fixture.manifest.profiles.find(profile => profile.id === "rival"));
    const sourcePaths = ["managed", "last"].flatMap(id => service.projectData(id).manifest.profiles.flatMap(profile => profile.animations.flatMap(animation => animation.frames.map(frame => path.resolve(root, frame.path)))));
    server = await startExportServer(root);
    browser = await chromium.launch({ executablePath: findBrowser(), headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [], requests = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("request", request => {
      const pathname = new URL(request.url()).pathname;
      if (request.method() === "POST" && (pathname === "/api/save" || pathname.startsWith("/api/workbench/animations/"))) requests.push({ pathname, payload: request.postDataJSON() });
    });
    await page.goto(`${server.url}/?project=managed&export=1`);
    await page.evaluate(() => window.FrameTunerWorkbench.ready);
    const waitIdle = () => page.waitForFunction(() => !projectOperationInFlight && !saveInFlight && !selectionLoading);
    const select = (profileId, animationId) => page.evaluate(async scope => {
      const group = window.FrameTunerWorkbench.groups().find(group => group.profileId === scope.profileId && group.animationId === scope.animationId);
      await window.FrameTunerWorkbench.selectGroup(group.groupId);
    }, { profileId, animationId });
    const current = () => page.evaluate(() => ({ profileId: currentGroup?.profileId, animationId: currentGroup?.animationId, name: currentGroup?.name, dirty }));
    const animation = (profileId, animationId, id = "managed") => service.projectData(id).manifest.profiles.find(profile => profile.id === profileId)?.animations.find(animation => animation.id === animationId);
    const openRename = async name => {
      await page.locator("#workbenchRenameAnimation").click();
      await page.locator("#workbenchAnimationDialog").waitFor({ state: "visible" });
      await page.locator("#workbenchAnimationName").fill(name);
    };
    const submitRename = () => page.locator("#workbenchAnimationRenameSubmit").click();
    const waitRenameClosed = async () => { await page.locator("#workbenchAnimationDialog").waitFor({ state: "hidden" }); await waitIdle(); };
    const openRemove = async () => { await page.locator("#workbenchRemoveAnimation").click(); await page.locator("#workbenchRemoveAnimationDialog").waitFor({ state: "visible" }); };
    const remove = async () => { await openRemove(); await page.locator("#workbenchRemoveAnimationConfirm").click(); await page.locator("#workbenchRemoveAnimationDialog").waitFor({ state: "hidden" }); await waitIdle(); };
    const count = suffix => requests.filter(request => request.pathname.endsWith(suffix)).length;
    const dirtyFrame = async value => {
      await page.locator('label:has(> #adjustFrame)').click();
      await page.locator("#baseX").fill(String(value)); await page.locator("#baseX").press("Enter");
      assert.equal((await current()).dirty, true);
    };
    await select("hero", "idle");
    const firstId = animation("hero", "idle").id;
    const framePaths = animation("hero", "idle").frames.map(frame => frame.path);
    await dirtyFrame(29);
    const requestStart = requests.length;
    const htmlName = '待机 <img src=x onerror="window.animationNameInjected=true">𠮷';
    await openRename(htmlName); await submitRename(); await waitRenameClosed();
    assert.deepEqual(requests.slice(requestStart).map(request => request.pathname), ["/api/save", "/api/workbench/animations/rename"], "Rename saves dirty tuning before changing the manifest");
    assert.equal(animation("hero", "idle").name, htmlName);
    assert.equal(animation("hero", "idle").id, firstId);
    assert.deepEqual(animation("hero", "idle").frames.map(frame => frame.path), framePaths);
    assert.deepEqual(await current(), { profileId: "hero", animationId: "idle", name: htmlName, dirty: false }, "Reload restores selection by stable profile/action ID");
    assert.equal(service.projectData("managed").tuning.frame_visual_overrides["hero/idle:0"].offset.x, 29);
    assert.equal(await page.locator('.animationListButton[aria-current="true"] .animationName').textContent(), htmlName);
    assert.equal(await page.locator(".animationList img").count(), 0, "An HTML-like name is rendered as text");
    assert.equal(await page.evaluate(() => window.animationNameInjected), undefined);
    assert.deepEqual(service.projectData("managed").manifest.profiles.find(profile => profile.id === "rival"), rivalBefore);

    // A failed save leaves the dirty frame intact and must never reach the rename endpoint.
    await dirtyFrame(41);
    const renamesBeforeSaveFailure = count("/rename");
    await page.route("**/api/save", route => route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "fixture save failure" }) }));
    await openRename("保存失败不能改名"); await submitRename();
    await page.waitForFunction(() => document.querySelector("#workbenchAnimationError").textContent.trim().length > 0);
    await waitIdle();
    assert.equal(count("/rename"), renamesBeforeSaveFailure);
    assert.equal((await current()).dirty, true); assert.equal(await page.locator("#baseX").inputValue(), "41");
    assert.equal(animation("hero", "idle").name, htmlName);
    await page.keyboard.press("Escape"); await page.unroute("**/api/save");
    await page.evaluate(() => window.FrameTunerWorkbench.save());

    // Conflict response is exposed in the remove dialog and is not retried automatically.
    const removesBeforeConflict = count("/remove");
    await page.route("**/api/workbench/animations/remove", route => route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ error: "fixture configuration conflict", code: "config_conflict" }) }));
    await openRemove(); await page.locator("#workbenchRemoveAnimationConfirm").click();
    await page.waitForFunction(() => document.querySelector("#workbenchRemoveAnimationError").textContent.trim().length > 0); await waitIdle();
    assert.equal(count("/remove"), removesBeforeConflict + 1);
    assert.ok(animation("hero", "idle"));
    await page.locator("#workbenchRemoveAnimationCancel").click(); await page.unroute("**/api/workbench/animations/remove");

    // Slow real rename holds a single mutation even if controls and the API are activated again.
    let reached;
    const started = new Promise(resolve => { reached = resolve; });
    const gate = new Promise(resolve => { release = resolve; });
    await page.route("**/api/workbench/animations/rename", async route => { reached(); await gate; await route.continue(); });
    const renamesBeforeSlow = count("/rename");
    await openRename("慢请求完成"); await submitRename(); await started;
    assert.equal(await page.locator(".app").evaluate(app => app.inert), true);
    assert.equal(await page.locator("#workbenchAnimationRenameSubmit").isDisabled(), true);
    for (const selector of ["#workbenchRenameAnimation", "#workbenchRemoveAnimation"]) assert.equal(await page.locator(selector).isDisabled(), true, "Animation management buttons are disabled during mutation");
    await page.evaluate(async () => {
      document.querySelector("#workbenchAnimationRenameSubmit").click();
      await window.FrameTunerWorkbench.manageAnimation("rename", { projectId: "managed", profileId: "hero", animationId: "idle", name: "不应重复" }).catch(() => {});
    });
    assert.equal(count("/rename"), renamesBeforeSlow + 1);
    release(); release = null; await waitRenameClosed(); await page.unroute("**/api/workbench/animations/rename");
    assert.equal(await page.locator(".app").evaluate(app => app.inert), false);
    assert.equal(animation("hero", "idle").name, "慢请求完成");

    // A committed rename followed by failed reload closes the dialog instead of offering a duplicate mutation.
    const renamesBeforeReloadFailure = count("/rename");
    await page.route("**/api/config?*", route => route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "fixture reload failure" }) }));
    await openRename("已改名但重载失败"); await submitRename(); await waitRenameClosed();
    assert.equal(count("/rename"), renamesBeforeReloadFailure + 1);
    assert.equal(animation("hero", "idle").name, "已改名但重载失败");
    assert.equal(await page.locator(".app").evaluate(app => app.inert), false);
    await page.unroute("**/api/config?*");
    await page.evaluate(() => window.FrameTunerWorkbench.reload("managed")); await select("hero", "idle");
    assert.equal(count("/rename"), renamesBeforeReloadFailure + 1, "Retrying only reload does not send another rename");

    // Two small controls stay in the existing action-list heading in both themes and narrow viewports.
    for (const language of ["zh", "en"]) for (const theme of ["dark", "light"]) {
      await page.setViewportSize({ width: 1024, height: 1000 });
      await page.locator(`[data-language="${language}"]`).click();
      await page.locator(`.headerThemeSwitch [data-theme="${theme}"]`).click();
      for (const width of [1024, 390]) {
        await page.setViewportSize({ width, height: 1000 });
        const layout = await page.evaluate(() => {
          const headingElement = document.querySelector(".animationListHeading"), heading = headingElement.getBoundingClientRect();
          const controls = ["#workbenchRenameAnimation", "#workbenchRemoveAnimation"].map(selector => { const r = document.querySelector(selector).getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, height: r.height }; });
          return { width: innerWidth, scrollWidth: document.documentElement.scrollWidth, heading: { left: heading.left, right: heading.right, top: heading.top, bottom: heading.bottom, height: heading.height, scrollWidth: headingElement.scrollWidth, clientWidth: headingElement.clientWidth }, controls };
        });
        assert.ok(layout.scrollWidth <= width, `${language}/${theme}/${width}: no horizontal overflow`);
        assert.ok(layout.heading.height <= 36, "Management controls do not add another heading row");
        assert.ok(layout.heading.scrollWidth <= layout.heading.clientWidth && layout.controls.every(control => control.height > 0 && control.left >= layout.heading.left && control.right <= layout.heading.right && control.top >= layout.heading.top && control.bottom <= layout.heading.bottom), `${language}/${theme}/${width}: management icons remain inside the existing heading row: ${JSON.stringify(layout)}`);
        assert.ok(Math.abs(layout.controls[0].top - layout.controls[1].top) < 1);
      }
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await select("hero", "run");
    const beforeCancel = fs.readFileSync(service.projectData("managed").paths.manifest, "utf8"), removesBeforeCancel = count("/remove");
    await openRemove(); await page.locator("#workbenchRemoveAnimationCancel").click();
    assert.equal(count("/remove"), removesBeforeCancel); assert.equal(fs.readFileSync(service.projectData("managed").paths.manifest, "utf8"), beforeCancel);
    await dirtyFrame(53);
    const beforeRemove = requests.length;
    await remove();
    assert.deepEqual(requests.slice(beforeRemove).map(request => request.pathname), ["/api/save", "/api/workbench/animations/remove"], "Remove also saves dirty tuning first");
    assert.equal(animation("hero", "run"), undefined);
    const neighbor = await current();
    assert.equal(neighbor.profileId, "hero"); assert.ok(["idle", "attack"].includes(neighbor.animationId), "Removed action selects a surviving neighboring action in the same character");
    assert.deepEqual(service.projectData("managed").manifest.profiles.find(profile => profile.id === "rival"), rivalBefore);
    const exportGroups = await page.evaluate(() => window.XsxbFrameTunerLite.exportGroups({ allProfiles: true }).map(group => `${group.profileId}/${group.animationId}`).sort());
    assert.deepEqual(exportGroups, ["hero/attack", "hero/idle", "rival/idle"]);
    const exportPayload = await page.evaluate(() => window.FrameTunerPortable.collectPayload({ format: "sequence" }));
    assert.equal(exportPayload.manifest.animations.length, 3);
    assert.ok(!exportPayload.manifest.animations.some(animation => animation.id === "hero/run"));

    // A successful removal with a failed reload must invalidate stale editor/export state.
    await select("hero", "attack");
    const removesBeforeReloadFailure = count("/remove");
    await page.route("**/api/config?*", route => route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "fixture post-remove reload failure" }) }));
    await remove();
    assert.equal(count("/remove"), removesBeforeReloadFailure + 1);
    assert.equal(animation("hero", "attack"), undefined, "The removal committed even though refreshing its config failed");
    assert.equal(await page.evaluate(() => window.FrameTunerWorkbench.current().ready), false, "Stale config cannot remain ready after a committed removal");
    for (const selector of ["#save", "#workbenchRenameAnimation", "#workbenchRemoveAnimation"]) assert.equal(await page.locator(selector).isDisabled(), true, `Stale ${selector} remains disabled until reload`);
    assert.equal(await page.locator("#baseX").evaluate(input => input.disabled || Boolean(input.closest("[inert]"))), true, "Stale inspector input cannot be interacted with until reload");
    const staleExport = await page.evaluate(async () => window.FrameTunerPortable.collectPayload({ format: "sequence" }).then(
      () => ({ producedPayload: true }), error => ({ producedPayload: false, error: error.message })));
    assert.equal(staleExport.producedPayload, false, "Export cannot include the action removed on disk");
    assert.ok(staleExport.error);
    const savesWhileStale = count("/api/save");
    const staleSave = await page.evaluate(async () => window.FrameTunerWorkbench.save().then(() => ({ accepted: true }), error => ({ accepted: false, error: error.message })));
    assert.equal(staleSave.accepted, false); assert.ok(staleSave.error);
    assert.equal(count("/api/save"), savesWhileStale, "Saving stale config must not recreate removed entries");
    await page.unroute("**/api/config?*");
    await page.evaluate(() => window.FrameTunerWorkbench.reload("managed"));
    assert.equal(await page.evaluate(() => window.FrameTunerWorkbench.current().ready), true);
    assert.equal(count("/remove"), removesBeforeReloadFailure + 1, "Recovery only reloads and never repeats the committed removal");
    const recovered = await page.evaluate(() => window.FrameTunerPortable.collectPayload({ format: "sequence" }));
    assert.equal(recovered.manifest.animations.length, 2);
    assert.ok(!recovered.manifest.animations.some(animation => animation.id === "hero/attack" || animation.id === "hero/run"));

    await page.goto(`${server.url}/?project=last&export=1`);
    await page.evaluate(() => window.FrameTunerWorkbench.ready);
    await remove();
    assert.equal(service.projectData("last").manifest.profiles.flatMap(profile => profile.animations).length, 0);
    await page.waitForFunction(() => !document.querySelector("#workbenchEmptyState").hidden);
    assert.deepEqual(await page.evaluate(() => window.FrameTunerWorkbench.groups()), []);
    assert.equal(await page.locator("#workbenchRenameAnimation").isDisabled(), true);
    assert.equal(await page.locator("#workbenchRemoveAnimation").isDisabled(), true);
    assert.equal(await page.locator(".animationListButton").count(), 0);
    await page.reload(); await page.evaluate(() => window.FrameTunerWorkbench.ready);
    await page.locator("#workbenchEmptyState").waitFor({ state: "visible" });
    for (const sourcePath of sourcePaths) assert.deepEqual(fs.readFileSync(sourcePath), bytes, "Animation removal retains original source images");
    assert.deepEqual(errors, []);
    console.log("Animation management browser checks passed: safe Unicode/HTML labels, stable IDs, dirty-save ordering, cancellation/conflict/save/reload failure recovery, single busy mutation, neighboring selection, profile protection, empty state, source/export integrity, and compact dark/light controls.");
  } finally {
    release?.(); await browser?.close();
    if (server?.child && server.child.exitCode === null) await new Promise(resolve => { server.child.once("exit", resolve); server.child.kill(); });
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir())); assert.match(path.basename(root), /^frame-tuner-animation-ui-/);
    fs.rmSync(root, { recursive: true, force: true });
  }
}
test().catch(error => { console.error(error); process.exitCode = 1; });
