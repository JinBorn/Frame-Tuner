"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createLiteApp } = require("./frame_tuner_lite/server");
const { createWorkbenchService } = require("./workbench_service");
function snapshot(root) {
  const output = {};
  function visit(dir) { for (const item of fs.readdirSync(dir, { withFileTypes: true })) { const full = path.join(dir, item.name); if (item.isDirectory()) visit(full); else output[path.relative(root, full)] = fs.readFileSync(full).toString("base64"); } }
  visit(root); return output;
}
const root = fs.mkdtempSync(path.join(os.tmpdir(), "frame-edit-audit-"));
try {
  const app = createLiteApp({ root }), store = app.store;
  const service = createWorkbenchService({ root, store });
  const id = service.createProject({ label: "Audit" }).projectId;
  const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==";
  service.importAnimation({ projectId: id, profileId: "hero", animationId: "attack", files: [0, 1, 2].map((n) => ({ name: `${n}.png`, data: png })) });
  const project = service.resolveProject(id), data = service.projectData(id), paths = data.paths;
  const vfx = { "hero/attack:0": { rotation: 10 }, "hero/attack:1": { rotation: 20 }, "hero/attack:2": { rotation: 30 }, "hero/attack:__group": { fps: 7 }, "hero/idle:2": { rotation: 99 } };
  data.tuning.attack_vfx_frame_overrides = vfx;
  data.tuning.attack_vfx_playback_overrides = vfx;
  store.writeJson(paths.tuning, data.tuning);
  assert.deepEqual(app.configResponse(id).tuning.attack_vfx_frame_overrides, vfx, "Config exposes VFX overrides instead of dropping them on load");
  app.savePayload(project, { values: { retained: 1 } });
  assert.deepEqual(store.readJson(paths.tuning, {}).attack_vfx_frame_overrides, vfx, "Partial save preserves omitted VFX overrides");
  const changed = { ...vfx, "hero/attack:0": { rotation: 12 } };
  app.savePayload(project, { attack_vfx_frame_overrides: changed, attack_vfx_playback_overrides: vfx });
  assert.deepEqual(store.readJson(paths.tuning, {}).attack_vfx_frame_overrides, changed, "Save persists explicit VFX changes");
  const bindings = [{ id: "key-only", key: `${id}:player:hero:vfx:hero/attack:source:1` }, { id: "other-project", projectId: "different", profileId: "hero", animation: "hero/attack", frame: 1 }];
  store.writeJson(paths.frameAudio, bindings);
  store.writeJson(paths.frameImageAttachments, bindings);
  let before = snapshot(root);
  for (const frameIndex of [-1, 0.2, null, "", "bad"]) assert.throws(() => app.duplicateProjectFrame(project, { profileId: "hero", animationId: "attack", frameIndex }));
  assert.deepEqual(snapshot(root), before, "Invalid copy indices never modify files");
  function failCommit(action, target) {
    const oldRename = fs.renameSync; let injected = false;
    fs.renameSync = function (source, destination) { if (!injected && destination === target) { injected = true; throw new Error("audit disk failure"); } return oldRename.call(this, source, destination); };
    try { assert.throws(action, /audit disk failure/); } finally { fs.renameSync = oldRename; }
    assert.ok(injected); assert.deepEqual(snapshot(root), before, "Failed transaction restores every authored file and staged asset");
  }
  failCommit(() => app.duplicateProjectFrame(project, { profileId: "hero", animationId: "attack", frameIndex: 1 }), paths.tuning);
  app.duplicateProjectFrame(project, { profileId: "hero", animationId: "attack", frameIndex: 1 });
  const copied = service.projectData(id);
  assert.deepEqual(copied.tuning.attack_vfx_frame_overrides["hero/attack:2"], changed["hero/attack:1"]);
  assert.deepEqual(copied.tuning.attack_vfx_frame_overrides["hero/attack:3"], changed["hero/attack:2"]);
  assert.deepEqual(copied.tuning.attack_vfx_playback_overrides["hero/attack:__group"], { fps: 7 });
  assert.equal(copied.frameAudioBindings.filter((entry) => entry.id === "other-project").length, 1);
  assert.deepEqual(copied.frameAudioBindings.find((entry) => entry.id === "other-project"), bindings[1]);
  assert.ok(copied.frameAudioBindings.some((entry) => entry.key === `${id}:player:hero:vfx:hero/attack:source:2`));
  assert.equal(new Set(copied.frameImageAttachments.map((entry) => entry.id)).size, copied.frameImageAttachments.length);
  before = snapshot(root);
  const uploaded = { name: "new.wav", data: "data:audio/wav;base64,UklGRg==" };
  assert.throws(() => app.savePayload(project, { values: {}, attack_trails: { presets: [], bindings: {} }, frame_audio_bindings: [uploaded, { path: "missing.wav" }] }));
  assert.deepEqual(snapshot(root), before, "Invalid later audio does not save presets or leave earlier audio bytes");
  failCommit(() => app.savePayload(project, { values: { changed: 2 }, frame_audio_bindings: [uploaded], frame_image_attachments: [], attack_trails: { presets: [], bindings: {} } }), paths.frameImageAttachments);
  const framePath = copied.manifest.profiles[0].animations[0].frames[0].path;
  const changedPng = `data:image/png;base64,${Buffer.concat([Buffer.from(png.split(",")[1], "base64"), Buffer.from("replacement")]).toString("base64")}`;
  assert.throws(() => app.replaceAnimationFrames(project, [{ path: framePath }, { path: framePath }], [{ data: changedPng }, { data: "bad" }]));
  assert.deepEqual(snapshot(root), before, "Invalid later replacement does not overwrite the first image");
  assert.throws(() => app.replaceAnimationFrames(project, [{ path: framePath }, { path: framePath }], [{ data: changedPng }, { data: png }]), (error) => error.code === "shared_frame_path");
  assert.deepEqual(snapshot(root), before, "Different replacement bytes cannot overwrite a shared Sheet/duplicate frame path");
  console.log("Frame edit audit passed: VFX load/save/copy, scoped bindings, invalid indices and failed-save rollback.");
} finally {
  if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error("Unexpected cleanup path");
  fs.rmSync(root, { recursive: true, force: true });
}
