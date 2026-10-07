"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createWorkbenchService } = require("./workbench_service");
const { createLiteStore } = require("./frame_tuner_lite/store");
const { createLiteApp } = require("./frame_tuner_lite/server");

function snapshot(root) {
  const files = {};
  const visit = (directory) => {
    for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, item.name);
      if (item.isDirectory()) visit(full);
      else files[path.relative(root, full)] = fs.readFileSync(full).toString("base64");
    }
  };
  visit(root);
  return files;
}

async function check(legacy) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "frame-tuner-delete-"));
  let app;
  try {
    const service = createWorkbenchService({ root, ...(legacy ? { store: createLiteStore(root) } : {}) });
    const id = service.createProject({ label: "Delete test", id: "delete-test" }).projectId;
    const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==";
    const input = { projectId: id, profileId: "hero", animationId: "attack", files: [0, 1, 2].map((n) => ({ name: `frame${n}.png`, data: png })) };
    service.importAnimation(input);
    service.importAnimation({ ...input, animationId: "idle" });
    const data = service.projectData(id), store = service.store;
    const paths = data.paths, originalFrames = structuredClone(data.manifest.profiles[0].animations[0].frames);
    data.manifest.profiles[0].animations[0].type = "vfx";
    store.writeJson(paths.manifest, data.manifest);
    const fields = ["frame_visual_overrides", "frame_playback_overrides", "frame_box_overrides", "attack_vfx_frame_overrides", "attack_vfx_playback_overrides"];
    for (const field of fields) data.tuning[field] = { "hero/attack:0": { marker: "first" }, "hero/attack:1": { marker: "deleted" }, "hero/attack:2": { marker: "last" }, "hero/attack:__group": { fps: 7 }, "hero/idle:2": { marker: "other" }, "enemy/attack:2": { marker: "enemy" }, "hero/attack_combo:2": { marker: "prefix" } };
    store.writeJson(paths.tuning, data.tuning);
    const bindings = [
      { id: "deleted", metadata: { projectId: id, profileId: "hero", animation: "hero/attack", frame: 1 } },
      { id: "shifted", frame: 2, displayFrame: 2, metadata: { projectId: id, profileId: "hero", animation: "hero/attack", frame: 2, displayFrame: 2 }, key: `${id}:player:hero:vfx:hero/attack:res://source:2` },
      { id: "modern", key: `${id}:player:hero:vfx:hero/attack:source:2` },
      { id: "legacy", key: "player:hero:vfx:hero/attack:source:2" },
      { id: "stable", frameKey: "hero/attack:2" },
      { id: "other-action", profileId: "hero", animation: "hero/idle", frame: 2 },
      { id: "other-project", projectId: "different", profileId: "hero", animation: "hero/attack", frame: 1 },
      { id: "other-key-project", key: "different:player:hero:vfx:hero/attack:source:1" },
    ];
    store.writeJson(paths.frameAudio, bindings);
    store.writeJson(paths.frameImageAttachments, bindings);
    const trails = { schemaVersion: 21, presets: [{ id: "untouched-preset" }], bindings: {
      "hero/attack": [{ id: "trail", texture: { path: originalFrames[0].path }, sticks: [{ id: "deleted", frame: 1 }, { id: "later", frame: 2 }], frameSlices: { 0: { enabled: false }, 1: { enabled: true }, 2: { enabled: true } } }],
      "hero/idle": [{ id: "other-trail", custom: "preserve", sticks: [{ frame: 2 }] }],
    } };
    store.writeJson(paths.attackTrails, trails);
    const shared = path.join(root, "data", "attack_trail_presets.json");
    store.writeJson(shared, { schemaVersion: 1, presets: [], migratedProjectIds: [], sentinel: "never touch shared state" });
    const appStore = legacy ? store : { ...store, paths: store.projectPaths, resolveProject: (projectId) => store.readRegistry().projects.find((project) => project.id === projectId) };
    app = createLiteApp({ root, store: appStore });
    await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
    const project = service.resolveProject(id);
    const post = async (payload) => {
      const response = await fetch(`http://127.0.0.1:${app.server.address().port}/api/delete-frame`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ projectId: id, profileId: "hero", animationId: "attack", frameIndex: 1, configRevision: app.projectConfigRevision(project), ...payload }) });
      return { status: response.status, body: await response.json() };
    };
    const before = snapshot(root);
    const stale = await post({ configRevision: "stale", force: true });
    assert.equal(stale.status, 409);
    assert.equal(stale.body.code, "stale_config");
    for (const frameIndex of [-1, 0.5, 3, null, "", " ", false]) assert.equal((await post({ frameIndex })).body.code, "invalid_frame");
    assert.equal((await post({ projectId: "" })).status, 404);
    assert.deepEqual(snapshot(root), before, "Rejected deletions do not change authored files");
    const originalRename = fs.renameSync;
    let injected = false;
    fs.renameSync = function failTuning(source, destination) {
      if (!injected && destination === paths.tuning) { injected = true; throw Object.assign(new Error("Injected deletion disk failure"), { code: "EIO" }); }
      return originalRename.call(this, source, destination);
    };
    try {
      assert.throws(() => app.deleteProjectFrame(project, { profileId: "hero", animationId: "attack", frameIndex: 1 }), /Injected deletion disk failure/);
    } finally { fs.renameSync = originalRename; }
    assert.equal(injected, true);
    assert.deepEqual(snapshot(root), before, "A disk failure after manifest commit restores all authored files and removes staging files");
    const deleted = await post({});
    assert.equal(deleted.status, 200);
    assert.equal(deleted.body.frameIndex, 1);
    assert.equal(deleted.body.frameCount, 2);
    assert.ok(deleted.body.warnings.some((warning) => warning.includes("至少需要两根")), "Incomplete trail retains editable data with a warning");
    const after = service.projectData(id);
    assert.deepEqual(after.manifest.profiles[0].animations[0].frames, [originalFrames[0], originalFrames[2]]);
    assert.deepEqual(after.manifest.profiles[0].animations[1], data.manifest.profiles[0].animations[1]);
    for (const field of fields) {
      const expected = { ...data.tuning[field], "hero/attack:1": data.tuning[field]["hero/attack:2"] };
      delete expected["hero/attack:2"];
      assert.deepEqual(after.tuning[field], expected);
    }
    for (const values of [after.frameAudioBindings, after.frameImageAttachments]) {
      assert.equal(values.some((entry) => entry.id === "deleted"), false);
      const shifted = values.find((entry) => entry.id === "shifted");
      assert.equal(shifted.frame, 1); assert.equal(shifted.displayFrame, 1);
      assert.equal(shifted.metadata.frame, 1); assert.equal(shifted.metadata.displayFrame, 1);
      assert.match(shifted.key, /:1$/);
      for (const name of ["modern", "legacy"]) assert.match(values.find((entry) => entry.id === name).key, /:1$/);
      assert.equal(values.find((entry) => entry.id === "stable").frameKey, "hero/attack:1");
      for (const entry of bindings.slice(5)) assert.deepEqual(values.find((value) => value.id === entry.id), entry);
    }
    assert.deepEqual(after.attackTrails.presets, trails.presets);
    assert.deepEqual(after.attackTrails.bindings["hero/idle"], trails.bindings["hero/idle"]);
    assert.deepEqual(after.attackTrails.bindings["hero/attack"][0].sticks, [{ id: "later", frame: 1 }]);
    assert.deepEqual(after.attackTrails.bindings["hero/attack"][0].frameSlices, { 0: { enabled: false }, 1: { enabled: true } });
    const afterFiles = snapshot(root);
    for (const [file, bytes] of Object.entries(before)) if (file.startsWith(`workspace${path.sep}`) || file === path.relative(root, shared)) assert.equal(afterFiles[file], bytes, "Assets and shared preset bytes remain untouched");
    assert.equal((await post({ frameIndex: 1 })).body.frameIndex, 0, "Deleting the last slot selects the previous surviving frame");
    const oneFrame = snapshot(root);
    assert.equal((await post({ frameIndex: 0 })).body.code, "last_frame");
    assert.deepEqual(snapshot(root), oneFrame);
    console.log(`Delete frame checks passed (${legacy ? "legacy Lite" : "main neutral"}).`);
  } finally {
    if (app) await new Promise((resolve) => app.server.close(resolve));
    if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error("Unexpected cleanup path");
    fs.rmSync(root, { recursive: true, force: true });
  }
}
check(false).then(() => check(true)).catch((error) => { console.error(error); process.exitCode = 1; });
