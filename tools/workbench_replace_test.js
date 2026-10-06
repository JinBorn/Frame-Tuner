"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createWorkbenchService } = require("./workbench_service");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "frame-tuner-replace-"));
const pixel = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==";
const image = (name = "frame.png", suffix = "") => ({ name, data: `data:image/png;base64,${Buffer.concat([Buffer.from(pixel, "base64"), Buffer.from(suffix)]).toString("base64")}` });

function filesSnapshot(directory) {
  const result = {};
  function visit(current) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) visit(full);
      else result[path.relative(directory, full)] = fs.readFileSync(full).toString("base64");
    }
  }
  visit(directory);
  return result;
}

try {
  const service = createWorkbenchService({ root });
  const projectId = service.createProject({ label: "Replace scope" }).projectId;
  const input = { projectId, profileId: "hero", animationId: "attack", fps: 12, files: [image()] };
  service.importAnimation(input);
  service.importAnimation({ ...input, animationId: "idle" });
  service.importAnimation({ ...input, profileId: "enemy" });
  const original = service.projectData(projectId), store = service.store;
  const previousAnimation = original.manifest.profiles[0].animations[0];
  Object.assign(previousAnimation, { loop: false, defaultScale: 1.75, defaultOffset: { x: 6, y: 8 }, defaultRotation: 12, type: "vfx", attachedLayers: ["glow"], sourceAnchor: { x: 0.3, y: 0.8 } });
  previousAnimation.frames[0].crop = { x: 0, y: 0, width: 1, height: 1, sheetWidth: 1, sheetHeight: 1 };
  const expectedOtherProfiles = structuredClone(original.manifest.profiles.slice(1));
  const expectedOtherAnimation = structuredClone(original.manifest.profiles[0].animations[1]);
  const tuning = {
    ...original.tuning,
    values: { "profiles.hero.character.visual_size": 2, "profiles.hero.groups.attack.rotation": 45, "profiles.hero.groups.idle.rotation": 20 },
    scene_settings: { scene: { scale: 1.5 } },
    frame_visual_overrides: { "hero/attack:0": { rotation: 80 }, "hero/attack:1": { rotation: 50 }, "hero/idle:0": { rotation: 15 }, "enemy/attack:0": { rotation: 10 } },
    frame_playback_overrides: { "hero/attack:0": { disabled: true }, "hero/attack:__group": { fps: 9 }, "hero/idle:0": { duration: 2 } },
    frame_box_overrides: { "hero/attack:0": { hitbox: { enabled: true } }, "hero/idle:0": { hurtbox: { enabled: true } } },
    attack_vfx_frame_overrides: { "hero/attack:0": { rotation: 35 }, "hero/attack:1": { scale: 1.5 }, "hero/attack:__group": { offset: { x: 4, y: 5 } }, "hero/idle:0": { rotation: 10 }, "enemy/attack:0": { scale: 2 }, "hero/attack_combo:0": { rotation: 20 } },
    attack_vfx_playback_overrides: { "hero/attack:0": { disabled: true }, "hero/attack:1": { duration: 3 }, "hero/attack:__group": { fps: 7 }, "hero/idle:0": { duration: 2 }, "enemy/attack:0": { disabled: true }, "hero/attack_combo:0": { duration: 4 } },
  };
  const targetBindings = [
    { id: "nested", metadata: { projectId, profileId: "hero", animation: "hero/attack", frame: 0 } },
    { id: "top-level-with-empty-metadata", metadata: {}, profileId: "hero", animation: "attack", frame: 0 },
    { id: "modern-key-only", key: `${projectId}:player:hero:actor:hero/attack:workspace/source:0` },
    { id: "legacy-key-only", key: "player:hero:actor:hero/attack:workspace/source:0" },
    { id: "stable-key-only", frameKey: "hero/attack:0" },
  ];
  const retainedBindings = [
    { id: "other-action", metadata: { profileId: "hero", animation: "hero/idle", frame: 0 }, key: `${projectId}:player:hero:actor:hero/idle:workspace/hero/attack:0` },
    { id: "other-profile", profileId: "enemy", animation: "enemy/attack", frame: 0 },
    { id: "other-project", projectId: "another", profileId: "hero", animation: "hero/attack", frame: 0 },
    { id: "prefix-name", key: `${projectId}:player:hero:actor:hero/attack_combo:workspace/source:0` },
  ];
  const trails = { schemaVersion: 21, presets: [{ id: "preset" }], bindings: { "hero/attack": [{ id: "remove" }], "hero/idle": [{ id: "keep" }], "enemy/attack": [{ id: "other" }] } };
  store.writeJson(original.paths.manifest, original.manifest);
  store.writeJson(original.paths.tuning, tuning);
  store.writeJson(original.paths.frameAudio, [...targetBindings, ...retainedBindings]);
  store.writeJson(original.paths.frameImageAttachments, [...targetBindings, ...retainedBindings]);
  store.writeJson(original.paths.attackTrails, trails);
  const before = filesSnapshot(root);
  assert.throws(() => service.importAnimation(input), (error) => error.code === "animation_exists");
  assert.deepEqual(filesSnapshot(root), before, "A duplicate import has no side effects");
  assert.throws(() => service.importAnimation({ ...input, replace: true, sheetJson: { frames: [{ frame: { x: 0, y: 0, w: 1, h: 1 } }], audio: { files: [{ id: "missing", file: "beep.wav" }], events: [{ assetId: "missing", outputFrameIndex: 0 }] } } }), (error) => error.code === "sheet_audio_requires_files");
  assert.deepEqual(filesSnapshot(root), before, "Invalid replacement preserves every authored file and asset");
  service.importAnimation({ ...input, replace: true, fps: 18, files: [image("new.png", "new frame bytes")] });
  const replaced = service.projectData(projectId);
  assert.deepEqual(replaced.tuning.values, tuning.values, "Character and group transforms survive replacement");
  assert.deepEqual(replaced.tuning.scene_settings, tuning.scene_settings);
  assert.deepEqual(replaced.tuning.frame_playback_overrides["hero/attack:__group"], { fps: 9 }, "Group playback survives replacement");
  assert.equal(replaced.tuning.frame_visual_overrides["hero/attack:0"], undefined);
  assert.equal(replaced.tuning.frame_visual_overrides["hero/attack:1"], undefined);
  assert.equal(replaced.tuning.frame_playback_overrides["hero/attack:0"], undefined);
  assert.equal(replaced.tuning.frame_box_overrides["hero/attack:0"], undefined);
  for (const field of ["attack_vfx_frame_overrides", "attack_vfx_playback_overrides"]) {
    const expected = { ...tuning[field] };
    delete expected["hero/attack:0"];
    delete expected["hero/attack:1"];
    assert.deepEqual(replaced.tuning[field], expected, `${field} removes target frames while preserving group settings, other actions and profiles`);
  }
  assert.deepEqual(replaced.tuning.frame_visual_overrides["hero/idle:0"], tuning.frame_visual_overrides["hero/idle:0"]);
  assert.deepEqual(replaced.frameAudioBindings, retainedBindings);
  assert.deepEqual(replaced.frameImageAttachments, retainedBindings);
  assert.deepEqual(replaced.attackTrails, { ...trails, bindings: { "hero/idle": trails.bindings["hero/idle"], "enemy/attack": trails.bindings["enemy/attack"] } });
  const nextAnimation = replaced.manifest.profiles[0].animations[0];
  for (const field of ["loop", "defaultScale", "defaultOffset", "defaultRotation", "type", "attachedLayers"]) assert.deepEqual(nextAnimation[field], previousAnimation[field], `Preserve action setting: ${field}`);
  assert.equal(nextAnimation.sourceAnchor, undefined, "Replacement PNG sequence must not inherit the previous artwork's origin");
  assert.equal(nextAnimation.anchorMode, "canvas_bottom_center", "A replacement without an origin uses the default canvas anchor");
  assert.equal(nextAnimation.frames[0].crop, undefined, "New sequence frames do not inherit old sheet crops");
  assert.equal(nextAnimation.fps, 18, "Explicit import FPS describes the replacement source");
  assert.deepEqual(replaced.manifest.profiles.slice(1), expectedOtherProfiles);
  assert.deepEqual(replaced.manifest.profiles[0].animations[1], expectedOtherAnimation);

  const beforeFailure = filesSnapshot(root);
  const rename = fs.renameSync;
  let injected = false;
  fs.renameSync = function failManifest(source, destination) {
    if (!injected && destination === original.paths.manifest) { injected = true; const error = new Error("Injected manifest write failure"); error.code = "EIO"; throw error; }
    return rename.call(this, source, destination);
  };
  try { assert.throws(() => service.importAnimation({ ...input, replace: true, files: [image("failure.png", "failed bytes")] }), /Injected manifest write failure/); }
  finally { fs.renameSync = rename; }
  assert.equal(injected, true);
  assert.deepEqual(filesSnapshot(root), beforeFailure, "A failure after commit starts rolls back metadata and new assets");

  const ambiguousInput = { ...input, profileId: "player", animationId: "actor" };
  service.importAnimation(ambiguousInput);
  const ambiguous = service.projectData(projectId);
  const preserveModernBindings = [
    { key: `${projectId}:player:enemy:actor:idle:workspace/source:0` },
    { key: "another-project:player:enemy:actor:idle:workspace/source:0" },
    { key: `${projectId}:player:enemy:actor:idle:res://source:0` },
  ];
  const removeModernBindings = [{ key: `${projectId}:player:player:actor:actor:res://source:0` }];
  store.writeJson(ambiguous.paths.frameAudio, [...preserveModernBindings, ...removeModernBindings]);
  store.writeJson(ambiguous.paths.frameImageAttachments, [...preserveModernBindings, ...removeModernBindings]);
  service.importAnimation({ ...ambiguousInput, replace: true });
  const unambiguous = service.projectData(projectId);
  assert.deepEqual(unambiguous.frameAudioBindings, preserveModernBindings, "Modern records must not be reparsed as legacy records for another action");
  assert.deepEqual(unambiguous.frameImageAttachments, preserveModernBindings, "Other profiles and projects survive even when modern key fields resemble a legacy target");
  console.log("Replacement import checks passed: exact cleanup, retained settings/actions, validation and file-write rollback.");
} finally {
  if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error("Unexpected cleanup path");
  fs.rmSync(root, { recursive: true, force: true });
}
