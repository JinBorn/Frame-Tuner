"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createWorkbenchService } = require("./workbench_service");
const { createLiteStore } = require("./frame_tuner_lite/store");
const { createLiteApp } = require("./frame_tuner_lite/server");
const pixel = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==";
const fields = ["frame_visual_overrides", "frame_playback_overrides", "frame_box_overrides", "attack_vfx_frame_overrides", "attack_vfx_playback_overrides"];
function snapshot(root) {
  const result = {};
  function visit(directory) {
    for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, item.name);
      if (item.isDirectory()) visit(file);
      else result[path.relative(root, file)] = fs.readFileSync(file).toString("base64");
    }
  }
  visit(root);
  return result;
}
async function check(legacy) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "frame-tuner-animation-manage-"));
  let server;
  const previousRoot = process.env.FRAME_TUNER_ROOT;
  try {
    const service = createWorkbenchService({ root, ...(legacy ? { store: createLiteStore(root) } : {}) });
    const id = service.createProject({ id: "actions", label: "Actions" }).projectId;
    const otherId = service.createProject({ id: "unrelated", label: "Unrelated" }).projectId;
    const input = { projectId: id, profileId: "hero", animationId: "attack", files: [{ name: "0.png", data: pixel }] };
    for (const animationId of ["attack", "glow", "attack.combo", "idle"]) service.importAnimation({ ...input, animationId });
    service.importAnimation({ ...input, profileId: "enemy" });
    service.importAnimation({ ...input, projectId: otherId });
    const data = service.projectData(id), store = service.store;
    const hero = data.manifest.profiles.find(profile => profile.id === "hero");
    const attack = hero.animations.find(action => action.id === "attack");
    const glow = hero.animations.find(action => action.id === "glow");
    attack.name = "攻击";
    attack.attachedLayers = ["光效", "idle"];
    glow.name = "光效";
    glow.previewOwner = "攻击";
    glow.attachTo = "攻击";
    glow.attachedLayers = ["attack"];
    data.manifest.profiles.find(profile => profile.id === "enemy").animations[0].previewOwner = "攻击";
    // An ID with dots is loaded exactly as authored, without deletion prefix collisions.
    const combo = hero.animations.find(action => action.id !== "attack" && action.id.startsWith("attack"));
    combo.id = "attack.combo";
    data.manifest.profiles.push({ id: "hero.groups.attack.extra", animations: [] });
    store.writeJson(data.paths.manifest, data.manifest);
    const rawFrames = structuredClone(attack.frames);
    data.tuning.values = {
      "profiles.hero.character.visual_size": 2,
      "profiles.hero.groups.attack.visual_size": 3,
      "profiles.hero.groups.attack.custom.option": 42,
      "profiles.hero.groups.attack.combo.visual_size": 5,
      "profiles.hero.groups.attack.extra.character.visual_size": 7,
      "profiles.hero.groups.idle.rotation": 9,
      "profiles.enemy.groups.attack.visual_size": 11,
    };
    for (const field of fields) data.tuning[field] = {
      "hero/attack:0": { sentinel: field }, "hero/attack:__group": { fps: 7 },
      "hero/attack.combo:0": { keep: 1 }, "hero/idle:0": { keep: 2 }, "enemy/attack:0": { keep: 3 },
    };
    store.writeJson(data.paths.tuning, data.tuning);
    const bindings = [
      { id: "stable", key: "hero/attack:0" },
      { id: "modern", key: `${id}:player:hero:actor:hero/attack:res://source:0` },
      { id: "legacy", key: "player:hero:actor:hero/attack:source:0" },
      { id: "metadata", metadata: { projectId: id, profileId: "hero", animation: "hero/attack", frame: 0 } },
      { id: "other-profile", profileId: "enemy", animation: "attack", frame: 0 },
      { id: "other-project", projectId: otherId, profileId: "hero", animation: "attack", frame: 0 },
      { id: "other-key-project", key: `${otherId}:player:hero:actor:hero/attack:source:0` },
      { id: "other-action", key: "hero/attack.combo:0" },
    ];
    store.writeJson(data.paths.frameAudio, legacy ? Object.fromEntries(bindings.map(entry => [entry.key || entry.id, entry])) : bindings);
    store.writeJson(data.paths.frameImageAttachments, bindings);
    const trails = { schemaVersion: 21, presets: [{ id: "local-preset" }], custom: "keep", bindings: { "hero/attack": [{ id: "remove" }], "hero/idle": [{ id: "keep" }] } };
    store.writeJson(data.paths.attackTrails, trails);
    const shared = path.join(root, "data", "attack_trail_presets.json");
    store.writeJson(shared, { schemaVersion: 1, presets: [], migratedProjectIds: [`lite:${id}`], sentinel: "shared" });
    const project = service.resolveProject(id);
    if (legacy) {
      const app = createLiteApp({ root, store });
      server = app.server;
    } else {
      process.env.FRAME_TUNER_ROOT = root;
      server = require("./animation_tuner/server").server;
    }
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    const url = `http://127.0.0.1:${server.address().port}`;
    const config = async () => (await fetch(`${url}/api/config?project=${id}`)).json();
    const post = async (action, payload = {}) => {
      const response = await fetch(`${url}/api/workbench/animations/${action}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ projectId: id, profileId: "hero", animationId: "attack", configRevision: (await config()).configRevision, ...payload }) });
      return { status: response.status, body: await response.json() };
    };
    await config(); // Establish the current project before checking mutation isolation.
    const before = snapshot(root);
    assert.equal((await post("rename", { name: "new", configRevision: "stale", force: true })).body.code, "stale_config");
    assert.equal((await post("remove", { configRevision: "stale", force: true })).body.code, "stale_config");
    assert.equal((await post("rename", { name: "idle" })).body.code, "animation_name_conflict");
    for (const name of ["", " ", null, 123, "a\nb", "a".repeat(121)]) assert.equal((await post("rename", { name })).status, 400);
    assert.equal((await post("remove", { projectId: "missing" })).status, 404);
    assert.equal((await post("remove", { profileId: "missing" })).status, 404);
    const blocked = await post("remove");
    assert.equal(blocked.body.code, "animation_in_use");
    assert.match(blocked.body.error, /hero\/glow/);
    assert.deepEqual(blocked.body.dependencies, ["hero/glow (previewOwner)", "hero/glow (attachTo)"]);
    assert.deepEqual(snapshot(root), before, "Rejected requests change no files");

    const newName = '攻击 <img src=x onerror="alert(1)">';
    const rename = await post("rename", { name: newName });
    assert.equal(rename.status, 200, JSON.stringify(rename.body));
    assert.equal(rename.body.name, newName);
    let updated = service.projectData(id);
    let actions = updated.manifest.profiles.find(profile => profile.id === "hero").animations;
    assert.equal(actions[0].id, "attack");
    assert.deepEqual(actions[0].frames, rawFrames);
    assert.equal(actions.find(action => action.id === "glow").previewOwner, newName);
    assert.equal(actions.find(action => action.id === "glow").attachTo, newName);
    assert.deepEqual(actions.find(action => action.id === "glow").attachedLayers, ["attack"], "Stable ID references remain unchanged when the display name changes");
    assert.equal(updated.manifest.profiles.find(profile => profile.id === "enemy").animations[0].previewOwner, "攻击");
    assert.deepEqual(updated.tuning, data.tuning);
    assert.equal((await post("rename", { animationId: "glow", name: "新光效" })).status, 200);
    assert.deepEqual(service.projectData(id).manifest.profiles[0].animations[0].attachedLayers, ["新光效", "idle"]);
    assert.equal((await post("rename", { animationId: "idle", name: "run" })).status, 200);
    assert.throws(() => service.importAnimation({ ...input, animationId: "run" }), error => error.code === "animation_name_conflict");
    // Layer removal severs attachedLayers, while owner dependencies block removal in the other direction.
    assert.equal((await post("remove", { animationId: "glow" })).status, 200);
    assert.deepEqual(service.projectData(id).manifest.profiles[0].animations[0].attachedLayers, ["run"]);
    const beforeRemoval = snapshot(root);
    const originalRename = fs.renameSync;
    let injected = false;
    fs.renameSync = function failTuning(source, destination) {
      if (!injected && destination === data.paths.tuning) { injected = true; throw new Error("Injected animation transaction failure"); }
      return originalRename.call(this, source, destination);
    };
    try { assert.throws(() => service.removeAnimation(input), /Injected animation transaction failure/); }
    finally { fs.renameSync = originalRename; }
    assert.equal(injected, true);
    assert.deepEqual(snapshot(root), beforeRemoval, "Failed multi-file removal rolls back manifest and all data");
    const removed = await post("remove");
    assert.equal(removed.status, 200, JSON.stringify(removed.body));
    assert.equal(removed.body.remainingAnimations, 2);
    updated = service.projectData(id);
    assert.equal(updated.tuning.values["profiles.hero.groups.attack.visual_size"], undefined);
    assert.equal(updated.tuning.values["profiles.hero.groups.attack.custom.option"], undefined);
    for (const key of Object.keys(data.tuning.values).filter(key => !["profiles.hero.groups.attack.visual_size", "profiles.hero.groups.attack.custom.option"].includes(key))) assert.equal(updated.tuning.values[key], data.tuning.values[key]);
    for (const field of fields) {
      const expected = { ...data.tuning[field] }; delete expected["hero/attack:0"]; delete expected["hero/attack:__group"];
      assert.deepEqual(updated.tuning[field], expected);
    }
    for (const entries of [Array.isArray(updated.frameAudioBindings) ? updated.frameAudioBindings : Object.values(updated.frameAudioBindings), updated.frameImageAttachments]) assert.deepEqual(entries.map(entry => entry.id), bindings.slice(4).map(entry => entry.id));
    assert.deepEqual(updated.attackTrails, { ...trails, bindings: { "hero/idle": trails.bindings["hero/idle"] } });
    for (const animationId of ["attack.combo", "idle"]) assert.equal((await post("remove", { animationId })).status, 200);
    assert.equal(service.projectData(id).manifest.profiles.find(profile => profile.id === "hero").animations.length, 0, "The last action may be removed without removing its profile");
    const after = snapshot(root);
    for (const [file, bytes] of Object.entries(before)) {
      if (file.startsWith(`workspace${path.sep}`) || file === path.relative(root, shared) || file.includes(`${path.sep}${otherId}${path.sep}`)) assert.equal(after[file], bytes, `Preserved ${file}`);
    }
    assert.equal((await config()).groups.some(group => group.profileId === "hero"), false);
    // Ambiguous names/IDs are rejected instead of reassigning a dependency.
    service.importAnimation({ ...input, animationId: "first" });
    service.importAnimation({ ...input, animationId: "second" });
    updated = service.projectData(id);
    actions = updated.manifest.profiles[0].animations;
    actions.find(action => action.id === "first").name = "second";
    actions.find(action => action.id === "second").name = "Other";
    actions.find(action => action.id === "second").previewOwner = "second";
    store.writeJson(data.paths.manifest, updated.manifest);
    assert.equal((await post("rename", { animationId: "first", name: "Fixed" })).body.code, "ambiguous_animation_reference");
    assert.equal((await post("remove", { animationId: "first" })).body.code, "ambiguous_animation_reference");
    console.log(`Animation management passed (${legacy ? "Lite HTTP" : "main delegated HTTP"}): rename/references, scoped removal, stale/invalid/dependency guards, dotted IDs, metadata/assets/presets, final action and atomic rollback.`);
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    if (previousRoot === undefined) delete process.env.FRAME_TUNER_ROOT; else process.env.FRAME_TUNER_ROOT = previousRoot;
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
    assert.match(path.basename(root), /^frame-tuner-animation-manage-/);
    fs.rmSync(root, { recursive: true, force: true });
  }
}
check(true).then(() => check(false)).catch(error => { console.error(error); process.exitCode = 1; });
