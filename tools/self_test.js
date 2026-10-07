const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const zlib = require("node:zlib");
const {
  animationLooksAttack,
  frameBoxCoverageIssues,
  hitboxEnabledByDefault,
  opaqueBoundsForPng,
  upsertEstimatedFrameBoxes,
} = require("./box_estimator");
const { parseBatchArgs } = require("./import_batch");
const { runtimeScript } = require("./godot_runtime");
const { profileIdsForSceneText } = require("./scene_profiles");
const { ATLAS_HEIGHT, ATLAS_HEIGHT_V2, ATLAS_WIDTH, PET_STATES, parseWebpSize } = require("./codex_pets");
const { normalizeAttackTrails, pngInfo, validateAttackTrails } = require("./attack_trails");
const {
  attackTrailsWithSharedPresets,
  attackTrailsWithoutSharedPresets,
  readSharedAttackTrailPresetStore,
  saveSharedAttackTrailPresets,
} = require("./attack_trail_presets");
const { averageFrameTiming, groupFpsForDuration, frameSynchronousEffectSample, liteExportSamples, bakedSequenceSamples, distributeIntegerMilliseconds } = require("./animation_tuner/public/timing_modes");
const { trustedRemote } = require("./updater");
const { withUtf8Charset } = require("./http_content_type");
const { createLiteStore } = require("./frame_tuner_lite/store");
const {
  duplicateFrameBindings,
  duplicateTrailFrameSlices,
  remapFrameOverrideDictionary,
} = require("./frame_tuner_lite/server");
const { cropFromEntry, frameEntries, importSheetAudio } = require("./frame_tuner_lite/import_sheet");
const { bindingScopeForProject, createProjectStore, projectEngine } = require("./project_store");
const { syncGodotProject } = require("./godot_sync");
const { buildRuntimeData } = require("./runtime_data");
const { listUnitySceneFiles, syncUnityProject, validateUnitySync } = require("./unity_sync");
const bindingScope = require("./animation_tuner/public/binding_scope");
const transformSelection = require("./animation_tuner/public/transform_selection");
const animationFamilies = require("./animation_tuner/public/animation_families");
const {
  applyAttackTrailPresetStyle,
  attackTrailLifecycleOrigin,
  preferredAttackTrailSegment,
  resolveAttackTrailContextSegmentId,
  smoothTrailSticks,
  upsertAttackTrailPresetByName,
} = require("./animation_tuner/public/attack_trails");

const localTrailForContext = { id: "local-trail", generated: true, presetOnly: false, sticks: [{}, {}] };
const globalPresetForContext = { id: "global-preset", generated: false, presetOnly: true, sticks: [] };
assert.equal(preferredAttackTrailSegment([localTrailForContext, globalPresetForContext]).id, "local-trail");
assert.equal(resolveAttackTrailContextSegmentId(
  "global-preset",
  [localTrailForContext],
  [localTrailForContext, globalPresetForContext],
), "local-trail");
assert.equal(resolveAttackTrailContextSegmentId("global-preset", [], [globalPresetForContext]), "global-preset");

assert.equal(withUtf8Charset("text/html"), "text/html; charset=utf-8");
assert.equal(withUtf8Charset("text/css"), "text/css; charset=utf-8");
assert.equal(withUtf8Charset("application/javascript"), "application/javascript; charset=utf-8");
assert.equal(withUtf8Charset("application/json"), "application/json; charset=utf-8");
assert.equal(withUtf8Charset("text/html; charset=gbk"), "text/html; charset=gbk");
assert.equal(withUtf8Charset("image/png"), "image/png");

const organizedChebaoGroups = animationFamilies.organizeAnimationGroups([
  { uiId: "idle", profileId: "chebao", profileLabel: "chebao", name: "idle" },
  { uiId: "attack", profileId: "chebao", profileLabel: "chebao", name: "stand_attack" },
  { uiId: "switch-dart", profileId: "chebao", profileLabel: "chebao", name: "switch dart" },
  { uiId: "dart-idle", profileId: "chebao", profileLabel: "chebao", name: "dart idle" },
  { uiId: "dart-run", profileId: "chebao", profileLabel: "chebao", name: "dart run" },
  { uiId: "dart-jump", profileId: "chebao", profileLabel: "chebao", name: "dart jump" },
  { uiId: "dart-fall", profileId: "chebao", profileLabel: "chebao", name: "dart fall" },
  { uiId: "dart-land", profileId: "chebao", profileLabel: "chebao", name: "dart land" },
  { uiId: "hurt", profileId: "chebao", profileLabel: "chebao", name: "knockback" },
  { uiId: "vfx", profileId: "chebao-vfx", profileLabel: "chebao VFX", name: "attack_1", type: "vfx" },
], { includeProfile: true });
const dartSection = organizedChebaoGroups.find((section) => section.familyId === "rope_dart");
assert.deepEqual(dartSection.groups.map((group) => group.uiId), [
  "switch-dart",
  "dart-idle",
  "dart-run",
  "dart-jump",
  "dart-fall",
  "dart-land",
]);
assert.equal(animationFamilies.animationFamilyId({ name: "death_cat_run" }), "state");
assert.equal(animationFamilies.animationFamilyId({ name: "air_attack" }), "combat");
assert.equal(animationFamilies.animationFamilyId({ name: "idle_to_run" }), "movement");
assert.equal(animationFamilies.animationFamilyId({ name: "attack_1", type: "vfx" }), "vfx");

const presetTarget = {
  id: "trail-live",
  name: "Live trail",
  presetOnly: false,
  sticks: [{ id: "stick-1", frame: 3 }, { id: "stick-2", frame: 4 }],
  frameSlices: { 3: { enabled: true, tailProgress: 0, headProgress: 1 } },
  texture: { path: "old.png" },
  color: "#111111",
  glowColor: "#440011",
  glowStrength: 0.2,
  materialLayers: { core: { strength: 0.2 } },
};
const presetPathBefore = JSON.stringify({
  id: presetTarget.id,
  name: presetTarget.name,
  presetOnly: presetTarget.presetOnly,
  sticks: presetTarget.sticks,
  frameSlices: presetTarget.frameSlices,
});
applyAttackTrailPresetStyle(presetTarget, {
  presetOnly: true,
  texture: { path: "new.png" },
  color: "#ff3388",
  glowColor: "#ff00aa",
  glowStrength: 1.1,
  materialLayers: { core: { strength: 0.4 } },
});
assert.equal(presetTarget.texture.path, "new.png");
assert.equal(presetTarget.color, "#ff3388");
assert.equal(presetTarget.glowColor, "#ff00aa");
assert.equal(presetTarget.glowStrength, 1.1);
assert.equal(presetTarget.materialLayers.core.strength, 0.4);
assert.equal(JSON.stringify({
  id: presetTarget.id,
  name: presetTarget.name,
  presetOnly: presetTarget.presetOnly,
  sticks: presetTarget.sticks,
  frameSlices: presetTarget.frameSlices,
}), presetPathBefore);
const immutablePreset = {
  name: "Shared preset",
  texture: { path: "shared.png" },
  materialLayers: { core: { color: "#ffffff", strength: 0.7 } },
};
const actionStyle = { texture: {}, materialLayers: {} };
applyAttackTrailPresetStyle(actionStyle, immutablePreset);
actionStyle.texture.path = "action-only.png";
actionStyle.materialLayers.core.color = "#ff0000";
assert.equal(immutablePreset.texture.path, "shared.png");
assert.equal(immutablePreset.materialLayers.core.color, "#ffffff");
const namedPresets = [{ id: "keep-id", name: "Same Name", color: "#111111" }];
const overwrittenPreset = upsertAttackTrailPresetByName(namedPresets, {
  id: "discard-id",
  name: " same name ",
  color: "#222222",
});
assert.equal(overwrittenPreset.overwritten, true);
assert.equal(namedPresets.length, 1);
assert.equal(namedPresets[0].id, "keep-id");
assert.equal(namedPresets[0].color, "#222222");
const newPreset = upsertAttackTrailPresetByName(namedPresets, {
  id: "new-id",
  name: "Different Name",
  color: "#333333",
});
assert.equal(newPreset.overwritten, false);
assert.equal(namedPresets.length, 2);

const smoothingFixture = [
  { id: "a", frame: 2, framePhase: 0.1, headFrame: false, layer: "behind", reverseDirection: false, directionOffset: 12, tangentStrength: 0.3, top: { x: 0, y: -40 }, bottom: { x: 0, y: 40 } },
  { id: "b", frame: 2, framePhase: 0.4, headFrame: false, layer: "front", reverseDirection: false, directionOffset: -30, tangentStrength: 1.4, top: { x: 45, y: -100 }, bottom: { x: 55, y: 100 } },
  { id: "c", frame: 3, framePhase: 0.2, headFrame: true, layer: "front", reverseDirection: true, directionOffset: 40, tangentStrength: 0.2, top: { x: 100, y: 45 }, bottom: { x: 100, y: -35 } },
  { id: "d", frame: 4, framePhase: 0.8, headFrame: true, layer: "behind", reverseDirection: false, directionOffset: 0, tangentStrength: 0.8, top: { x: 150, y: -40 }, bottom: { x: 150, y: 40 } },
];
const smoothingPose = (stick) => {
  const top = stick.reverseDirection ? stick.bottom : stick.top;
  const bottom = stick.reverseDirection ? stick.top : stick.bottom;
  return {
    center: { x: (top.x + bottom.x) / 2, y: (top.y + bottom.y) / 2 },
    length: Math.hypot(bottom.x - top.x, bottom.y - top.y),
  };
};
const smoothedFixture = smoothTrailSticks(smoothingFixture);
assert.deepEqual(
  smoothedFixture.map(({ id, frame, framePhase, headFrame, layer, reverseDirection }) => ({ id, frame, framePhase, headFrame, layer, reverseDirection })),
  smoothingFixture.map(({ id, frame, framePhase, headFrame, layer, reverseDirection }) => ({ id, frame, framePhase, headFrame, layer, reverseDirection })),
);
assert.deepEqual(smoothingPose(smoothedFixture[0]).center, smoothingPose(smoothingFixture[0]).center);
assert.deepEqual(smoothingPose(smoothedFixture.at(-1)).center, smoothingPose(smoothingFixture.at(-1)).center);
assert.ok(smoothingPose(smoothedFixture[1]).length < smoothingPose(smoothingFixture[1]).length);
assert.notDeepEqual(smoothingPose(smoothedFixture[1]).center, smoothingPose(smoothingFixture[1]).center);

const lifecycleFrameDurationsMs = [43, 43, 43, 43, 143, 53, 53];
const lifecycleFrameArrival = (frame, phase) => (
  lifecycleFrameDurationsMs.slice(0, frame).reduce((sum, duration) => sum + duration, 0)
  + lifecycleFrameDurationsMs[frame] * phase
) / 1000;
const lifecycleSticks = [
  { frame: 4, framePhase: 1 / 3 },
  { frame: 4, framePhase: 2 / 3 },
];
const lifecycleOrigin = attackTrailLifecycleOrigin(lifecycleSticks, lifecycleFrameArrival);
const frameSevenStart = lifecycleFrameArrival(6, 0);
assert.ok(Math.abs((frameSevenStart - lifecycleOrigin) - 0.196) < 0.000001);
assert.ok(frameSevenStart - lifecycleOrigin >= 0.175);
assert.ok(frameSevenStart - lifecycleFrameArrival(4, 1 / 3) < 0.175);

const independentlyOffsetFrame = {
  scale: 1,
  scaleX: 1,
  scaleY: 1,
  offset: { x: 37, y: -19 },
  rotation: 12,
};
assert.deepEqual(
  transformSelection.applyEditedField(
    independentlyOffsetFrame,
    { scale: 1.5, scaleX: 1.5, scaleY: 1.5, offset: { x: 0, y: 0 }, rotation: 0 },
    "scale"
  ),
  { scale: 1.5, scaleX: 1.5, scaleY: 1.5, offset: { x: 37, y: -19 }, rotation: 12 }
);
assert.deepEqual(
  transformSelection.applyEditedField(
    independentlyOffsetFrame,
    { scale: 1, scaleX: 1, scaleY: 1, offset: { x: 88, y: 0 }, rotation: 0 },
    "offsetX"
  ),
  { scale: 1, scaleX: 1, scaleY: 1, offset: { x: 88, y: -19 }, rotation: 12 }
);
assert.deepEqual(
  transformSelection.applyEditedField(
    independentlyOffsetFrame,
    { scale: 1, scaleX: 1, scaleY: 1, offset: { x: 13, y: -4 }, rotation: 0 },
    "offsetX",
    { scale: 1, scaleX: 1, scaleY: 1, offset: { x: 10, y: -4 }, rotation: 0 }
  ),
  { scale: 1, scaleX: 1, scaleY: 1, offset: { x: 40, y: -19 }, rotation: 12 }
);
assert.deepEqual(
  transformSelection.applyEditedField(
    independentlyOffsetFrame,
    { scale: 1, scaleX: 1, scaleY: 1, offset: { x: 10, y: -7 }, rotation: 0 },
    "offsetY",
    { scale: 1, scaleX: 1, scaleY: 1, offset: { x: 10, y: -4 }, rotation: 0 }
  ),
  { scale: 1, scaleX: 1, scaleY: 1, offset: { x: 37, y: -22 }, rotation: 12 }
);

const utf8Decoder = new TextDecoder("utf-8", { fatal: true });
for (const publicRoot of [
  path.join(__dirname, "animation_tuner", "public"),
  path.join(__dirname, "frame_tuner_lite", "public"),
]) {
  for (const entry of fs.readdirSync(publicRoot, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !/\.(?:html|js|css)$/i.test(entry.name)) continue;
    const filePath = path.join(entry.parentPath || entry.path, entry.name);
    const text = utf8Decoder.decode(fs.readFileSync(filePath));
    assert.doesNotMatch(text, /[\u0080-\u009f\ufffd]|(?:Ã.|Â.|â€|锟斤拷)/u, `${filePath} contains mojibake`);
  }
}

assert.equal(animationLooksAttack("stand_attack"), true);
assert.equal(animationLooksAttack("站立攻击"), true);
assert.equal(animationLooksAttack("格挡反击"), true);
assert.equal(animationLooksAttack("idle"), false);
assert.equal(hitboxEnabledByDefault(0, 3, "attack"), true);
assert.equal(hitboxEnabledByDefault(0, 12, "stand_attack"), false);
assert.equal(hitboxEnabledByDefault(5, 12, "stand_attack"), true);

const groupTiming = averageFrameTiming(800, 4, 10);
assert.equal(groupTiming.durationMs, 200);
assert.equal(groupTiming.multiplier, 2);
const currentFrameTotalMs = ((2.1 + 2 + 2 + 2) / 10) * 1000;
const switchedGroupFps = groupFpsForDuration(4, currentFrameTotalMs);
assert.ok(Math.abs(switchedGroupFps - (4 / 0.81)) < 1e-12);
assert.ok(Math.abs((4 / switchedGroupFps) - 0.81) < 1e-12);
assert.equal(averageFrameTiming(800, 0, 10), null);
const normalTrailSample = frameSynchronousEffectSample(0.02, 0, 0.05, 0.05);
assert.deepEqual(
  { sampleIndex: normalTrailSample.sampleIndex, subdivisions: normalTrailSample.subdivisions },
  { sampleIndex: 0, subdivisions: 1 },
);
assert.ok(Math.abs(normalTrailSample.time - 0.025) < 1e-12);
const longTrailSampleA = frameSynchronousEffectSample(0.02, 0, 0.15, 0.05);
const longTrailSampleB = frameSynchronousEffectSample(0.08, 0, 0.15, 0.05);
const longTrailSampleC = frameSynchronousEffectSample(0.14, 0, 0.15, 0.05);
assert.deepEqual(
  [longTrailSampleA, longTrailSampleB, longTrailSampleC].map((sample) => [sample.sampleIndex, sample.subdivisions]),
  [[0, 3], [1, 3], [2, 3]],
);
assert.deepEqual(
  [longTrailSampleA, longTrailSampleB, longTrailSampleC].map((sample) => Math.round(sample.time * 1000)),
  [25, 75, 125],
);
const sixPlayableFrames = [25, 25, 25, 25, 25, 135].map((durationMs, frameIndex) => ({
  frameIndex,
  durationMs,
  trailActive: true,
  // Export sampling must ignore stick-authored phases. Sticks shape the path only.
  stickPhases: frameIndex === 4 ? [1 / 3, 2 / 3] : frameIndex === 5 ? [0.5] : [],
}));
const liteTrailSamples = liteExportSamples(sixPlayableFrames, 80, 260, true);
assert.equal(liteTrailSamples.length, 8);
assert.equal(new Set(liteTrailSamples.filter((sample) => sample.reason !== "trail_end").map((sample) => sample.frameIndex)).size, 6);
assert.equal(liteTrailSamples.filter((sample) => sample.frameIndex === 4 && sample.reason !== "trail_end").length, 1);
assert.equal(liteTrailSamples.filter((sample) => sample.frameIndex === 5 && sample.reason !== "trail_end").length, 2);
assert.equal(liteTrailSamples.at(-1).reason, "trail_end");
assert.ok(liteTrailSamples.every((sample) => sample.durationMs > 0));
assert.ok(Math.abs(liteTrailSamples.filter((sample) => sample.reason !== "trail_end").reduce((total, sample) => total + sample.durationMs, 0) - 260) < 0.001);
const liteNoTrailSamples = liteExportSamples(sixPlayableFrames.map((frame) => ({ ...frame, trailActive: false })), 25, 260, false);
assert.equal(liteNoTrailSamples.length, 6);
const slowerFrames = sixPlayableFrames.map((frame) => ({ ...frame, durationMs: 160 }));
assert.equal(liteExportSamples(slowerFrames, 80, 960, false).length, 12);
assert.equal(liteExportSamples([{ frameIndex: 0, durationMs: 25.000000000000004 }], 25, 25, false).length, 1);
assert.equal(liteExportSamples([{ frameIndex: 0, durationMs: 25.001, trailActive: true }], 25, 25.001, false).length, 2);
assert.equal(liteExportSamples([
  { frameIndex: 0, durationMs: 100, trailActive: false },
  { frameIndex: 1, durationMs: 100, trailActive: true },
  { frameIndex: 2, durationMs: 100, trailActive: false },
], 25, 300, false).length, 6);
const bakedSamples = bakedSequenceSamples([
  { frameIndex: 2, durationMs: 37.5, trailActive: true },
  { frameIndex: 5, durationMs: 62.5, trailActive: false },
]);
assert.deepEqual(bakedSamples.map((sample) => ({
  frameIndex: sample.frameIndex,
  durationMs: sample.durationMs,
  timeMs: sample.timeMs,
  reason: sample.reason,
})), [
  { frameIndex: 2, durationMs: 37.5, timeMs: 18.75, reason: "baked_frame" },
  { frameIndex: 5, durationMs: 62.5, timeMs: 68.75, reason: "baked_frame" },
]);
assert.deepEqual(distributeIntegerMilliseconds(Array(6).fill(22.5)), [23, 22, 23, 22, 23, 22]);
assert.equal(distributeIntegerMilliseconds(Array(6).fill(22.5)).reduce((sum, value) => sum + value, 0), 135);

assert.deepEqual(PET_STATES.map((state) => state.id), [
  "idle", "running-right", "running-left", "waving", "jumping", "failed", "waiting", "running", "review",
]);
assert.deepEqual(PET_STATES.map((state) => state.durations.length), [6, 8, 8, 4, 5, 8, 6, 6, 6]);
assert.equal(PET_STATES.reduce((total, state) => total + state.durations.length, 0), 57);
const webpHeader = Buffer.alloc(30);
webpHeader.write("RIFF", 0, "ascii");
webpHeader.writeUInt32LE(22, 4);
webpHeader.write("WEBP", 8, "ascii");
webpHeader.write("VP8X", 12, "ascii");
webpHeader.writeUInt32LE(10, 16);
webpHeader.writeUIntLE(ATLAS_WIDTH - 1, 24, 3);
webpHeader.writeUIntLE(ATLAS_HEIGHT - 1, 27, 3);
assert.deepEqual(parseWebpSize(webpHeader), { width: ATLAS_WIDTH, height: ATLAS_HEIGHT });
webpHeader.writeUIntLE(ATLAS_HEIGHT_V2 - 1, 27, 3);
assert.deepEqual(parseWebpSize(webpHeader), { width: ATLAS_WIDTH, height: ATLAS_HEIGHT_V2 });

const sceneProfiles = [
  { id: "hero", label: "Hero" },
  { id: "companion", label: "companion_idle" },
  { id: "bell", label: "bell" },
];
assert.deepEqual(profileIdsForSceneText('[node name="Hero" type="Node2D"]', sceneProfiles), ["hero"]);
assert.deepEqual(profileIdsForSceneText('[ext_resource type="SpriteFrames" path="res://art/characters/playable/companion/idle/companion_idle.spriteframes.tres" id="1"]', sceneProfiles), ["companion"]);
assert.deepEqual(profileIdsForSceneText('[ext_resource type="SpriteFrames" path="res://art/props/bell/bell.spriteframes.tres" id="1"]', sceneProfiles), ["bell"]);
assert.deepEqual(profileIdsForSceneText('[ext_resource type="Texture2D" path="res://art/backgrounds/dev/hero_playground_stage.png" id="1"]\n[ext_resource type="Script" path="res://scripts/dev/UnrelatedPreviewTool.gd" id="2"]', sceneProfiles), []);

const parsed = parseBatchArgs([
  "--project-root", "C:\\game",
  "--project", "demo",
  "--profile", "hero",
  "--fps", "12",
  "--replace",
  "--animation", "idle",
  "--source", "C:\\frames\\idle",
  "--animation", "站立攻击",
  "--source", "C:\\frames\\attack",
  "--fps", "18",
]);
assert.equal(parsed.globals.project, "demo");
assert.equal(parsed.globals.profile, "hero");
assert.equal(parsed.globals.replace, true);
assert.equal(parsed.entries.length, 2);
assert.equal(parsed.entries[0].animation, "idle");
assert.equal(parsed.entries[1].fps, "18");

const source = runtimeScript("demo");
const attackTrailRendererSource = fs.readFileSync(path.join(__dirname, "runtime", "xsxb_attack_trail_renderer.gd"), "utf8");
const attackTrailShaderSource = fs.readFileSync(path.join(__dirname, "runtime", "xsxb_attack_trail.gdshader"), "utf8");
const sharedTrailPresetStore = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "data", "attack_trail_presets.json"), "utf8"),
);
const rectangularTrailPreset = sharedTrailPresetStore.presets.find(
  (preset) => preset.id === "xsxb_rectangular_head_multilayer_v1",
);
const referencePinkTrailPreset = sharedTrailPresetStore.presets.find(
  (preset) => preset.id === "xsxb_reference_pink_four_layer_v1",
);
assert.ok(referencePinkTrailPreset);
assert.equal(referencePinkTrailPreset.name, "四层·粉色剑光参考复刻");
assert.equal(referencePinkTrailPreset.materialLayers.breakup.texture.path, referencePinkTrailPreset.materialLayers.streaks.texture.path);
assert.equal(referencePinkTrailPreset.materialLayers.breakup.texture.assetHash, referencePinkTrailPreset.materialLayers.streaks.texture.assetHash);
assert.equal(referencePinkTrailPreset.bodyOpacityFloor, 0.3);
assert.equal(referencePinkTrailPreset.bodyDetailStrength, 0.25);
assert.equal(referencePinkTrailPreset.bodyWhiteThreshold, 0.86);
assert.equal(referencePinkTrailPreset.widthMode, "fixed");
assert.equal(referencePinkTrailPreset.fixedWidth, 110);
assert.equal(referencePinkTrailPreset.widthScale, 1);
assert.equal(referencePinkTrailPreset.widthOffset, 0);
assert.equal(referencePinkTrailPreset.widthChaseStrength, 0.12);
assert.equal(referencePinkTrailPreset.pathScaleX, 0.68);
assert.equal(referencePinkTrailPreset.pathScaleY, 1);
assert.equal(referencePinkTrailPreset.headWhitePreserve, 1);
assert.equal(referencePinkTrailPreset.materialLayers.breakup.strength, 0.7);
assert.equal(referencePinkTrailPreset.materialLayers.breakup.expansion, 0.04);
assert.equal(referencePinkTrailPreset.materialLayers.streaks.expansion, 0.01);
for (const texture of [
  referencePinkTrailPreset.texture,
  referencePinkTrailPreset.materialLayers.breakup.texture,
  referencePinkTrailPreset.materialLayers.core.texture,
]) {
  const buffer = fs.readFileSync(path.join(__dirname, "..", texture.path));
  assert.deepEqual([pngInfo(buffer).width, pngInfo(buffer).height], [256, 256]);
  assert.equal(crypto.createHash("sha256").update(buffer).digest("hex"), texture.assetHash);
}
assert.equal(rectangularTrailPreset.name, "四层·流体环纹");
const functionalTrailVariants = [
  rectangularTrailPreset,
  sharedTrailPresetStore.presets.find((preset) => preset.id === "xsxb_four_layer_ribbons_v1"),
  sharedTrailPresetStore.presets.find((preset) => preset.id === "xsxb_four_layer_eroded_v1"),
];
assert.equal(new Set(functionalTrailVariants.map((preset) => preset.texture.path)).size, 1);
assert.equal(new Set(functionalTrailVariants.map((preset) => preset.materialLayers.core.texture.path)).size, 1);
assert.equal(new Set(functionalTrailVariants.map((preset) => preset.materialLayers.breakup.texture.path)).size, 3);
for (const preset of functionalTrailVariants) {
  assert.equal(preset.materialLayers.breakup.texture.path, preset.materialLayers.streaks.texture.path);
  assert.equal(preset.materialLayers.breakup.texture.assetHash, preset.materialLayers.streaks.texture.assetHash);
}
const rectangularTrailTexturePaths = [
  rectangularTrailPreset.texture.path,
  rectangularTrailPreset.materialLayers.streaks.texture.path,
  rectangularTrailPreset.materialLayers.core.texture.path,
];
assert.equal(new Set(rectangularTrailTexturePaths).size, 3);
for (const texturePath of rectangularTrailTexturePaths) {
  const info = pngInfo(fs.readFileSync(path.join(__dirname, "..", texturePath)));
  assert.equal(info.width, 256);
  assert.equal(info.height, 256);
}
assert.match(source, /frame_audio_bindings\.json/);
assert.match(source, /frame_image_attachments\.json/);
assert.match(source, /func animation_duration\(/);
assert.match(source, /func scene_scale\(/);
assert.match(source, /_character_scale\(\) \* scene_scale\(\)/);
assert.match(source, /size\.x\) \* sprite_scale_x/);
assert.match(source, /size\.y\) \* sprite_scale_y/);
assert.match(source, /func restart_frame_animation\(/);
assert.match(source, /attack_trails\.json/);
assert.match(source, /func trail_frame_arrival_time\(/);
assert.match(source, /func trail_frame_duration\(/);
assert.match(source, /func trail_animation_elapsed\(/);
assert.match(source, /func trail_quantized_animation_elapsed\(/);
assert.doesNotMatch(source, /var subdivisions := clampi\(roundi\(frame_duration/);
assert.match(source, /get_node_or_null\("AttackTrailsBehind"\)/);
assert.match(source, /func _apply_attack_trail_transform\(\)/);
assert.match(source, /var transform: Dictionary = _group_visual_transform\(_current_animation\)/);
assert.doesNotMatch(source, /get_node_or_null\("VisualOwner\/AttackTrailsBehind"\)/);
assert.match(attackTrailRendererSource, /const TRAIL_MESH_WIDTH_ROWS := 17/);
assert.match(attackTrailRendererSource, /const DEFAULT_PATH_COLUMNS := 20/);
assert.match(attackTrailRendererSource, /const DEFAULT_TAIL_HEAD_SPEED_RATIO := 0\.7/);
assert.match(attackTrailRendererSource, /func _total_duration_s\(/);
assert.match(attackTrailRendererSource, /func _head_curve_profile\(/);
assert.match(attackTrailRendererSource, /point -= head_direction \* bulge/);
assert.match(attackTrailRendererSource, /return 1\.0 - sqrt\(maxf\(0\.0, 1\.0 - centered \* centered\)\)/);
assert.match(attackTrailRendererSource, /func _gradient_texture\(/);
assert.match(attackTrailRendererSource, /material\.set_shader_parameter\("use_gradient", color_mode == "gradient"\)/);
assert.match(attackTrailRendererSource, /material\.set_shader_parameter\("invert_texture", bool\(segment\.get\("invertTexture", false\)\)\)/);
assert.match(attackTrailRendererSource, /material\.set_shader_parameter\("breakup_texture", breakup_texture\)/);
assert.match(attackTrailRendererSource, /material\.set_shader_parameter\("streaks_texture", streaks_texture\)/);
assert.match(attackTrailRendererSource, /material\.set_shader_parameter\("core_texture", core_texture\)/);
assert.match(attackTrailRendererSource, /material\.set_shader_parameter\("glow_color"/);
assert.match(attackTrailRendererSource, /material\.set_shader_parameter\("body_opacity_floor"/);
assert.match(attackTrailRendererSource, /material\.set_shader_parameter\("body_detail_strength"/);
assert.match(attackTrailRendererSource, /material\.set_shader_parameter\("body_white_threshold"/);
assert.match(attackTrailRendererSource, /material\.set_shader_parameter\("head_white_preserve"/);
assert.match(attackTrailRendererSource, /func _styled_width_pose\(/);
assert.match(attackTrailRendererSource, /func _styled_path_pose\(/);
assert.match(attackTrailRendererSource, /lerpf\(center_tail_distance, authored_tail_distance, width_chase_strength\)/);
assert.match(attackTrailRendererSource, /material\.set_shader_parameter\("breakup_expansion"/);
assert.match(attackTrailRendererSource, /material\.set_shader_parameter\("streaks_expansion"/);
assert.match(attackTrailRendererSource, /func _glow_padding\(/);
assert.match(attackTrailShaderSource, /texture\(trail_gradient, vec2\(1\.0 - safe_uv\.y, 0\.5\)\)/);
assert.match(attackTrailShaderSource, /uniform bool invert_texture = false/);
assert.match(attackTrailShaderSource, /body_luma = invert_texture \? 1\.0 - source_luma : source_luma/);
assert.match(attackTrailShaderSource, /uniform float body_detail_strength/);
assert.match(attackTrailShaderSource, /float body_detail = mix\(1\.0, authored_detail, body_detail_strength\)/);
assert.match(attackTrailShaderSource, /float body_white = max\(head_white, authored_white \* body_detail_strength\)/);
assert.match(attackTrailShaderSource, /uniform sampler2D breakup_texture/);
assert.match(attackTrailShaderSource, /uniform sampler2D streaks_texture/);
assert.match(attackTrailShaderSource, /uniform sampler2D core_texture/);
assert.match(attackTrailShaderSource, /float blurred_core_alpha\(/);
assert.match(attackTrailShaderSource, /float mask_response\(/);
assert.match(attackTrailShaderSource, /body_color = mix\(body_color, vec3\(1\.0\), body_white\)/);
assert.match(attackTrailShaderSource, /streaks_strength \* \(1\.0 - white_protection\)/);
assert.match(attackTrailShaderSource, /result = composite_layer\(result, glow_color\.rgb, halo_alpha, 1\)/);
assert.match(attackTrailShaderSource, /base_premultiplied\.rgb \+ layer_color \* layer_alpha/);
assert.doesNotMatch(attackTrailShaderSource, /\(base_premultiplied\.rgb \+ layer_color \* layer_alpha\) \* max\(base_alpha, layer_alpha\)/);
assert.match(attackTrailRendererSource, /func _mesh_tail_distance\(/);
assert.match(attackTrailRendererSource, /const FINAL_HEAD_CAP_MARGIN_RATIO := 0\.25/);
assert.match(attackTrailRendererSource, /func _terminal_head_cap_blend\(/);
assert.match(attackTrailRendererSource, /uvs\.append\(Vector2\(u, v\)\)/);
assert.match(attackTrailRendererSource, /const TAIL_WIDTH_SPEED_INFLUENCE := 0\.18/);
assert.match(attackTrailRendererSource, /func _guard_tail_edge_progress\(/);
assert.match(attackTrailRendererSource, /func _head_path_time\(/);
assert.match(attackTrailRendererSource, /var current_path_time := _head_path_time/);
assert.match(attackTrailRendererSource, /head_indices\.insert\(0, 0\)/);
assert.match(attackTrailRendererSource, /var tuner_normal := Vector2\(-axis\.y, axis\.x\)/);
assert.doesNotMatch(attackTrailRendererSource, /axis\.orthogonal\(\)/);
assert.doesNotMatch(attackTrailRendererSource, /segment\.get\("collapsedWidth"/);
assert.match(attackTrailRendererSource, /"last_sample_time": -1\.0/);
assert.match(attackTrailRendererSource, /is_equal_approx\(float\(state\.get\("last_sample_time"/);
assert.match(attackTrailRendererSource, /segment\.get\("frameSlices"/);
assert.match(attackTrailRendererSource, /tailProgress/);
assert.match(attackTrailRendererSource, /headProgress/);
const attackTrailEditorSource = fs.readFileSync(path.join(__dirname, "animation_tuner", "public", "attack_trails.js"), "utf8");
assert.match(attackTrailEditorSource, /pixelStorei\(gl\.UNPACK_FLIP_Y_WEBGL, true\)/);
assert.match(attackTrailEditorSource, /const DEFAULT_PATH_COLUMNS = 20/);
assert.match(attackTrailEditorSource, /_savePreset\(name\)/);
assert.match(attackTrailEditorSource, /exportTimeRanges\(\)/);
assert.match(attackTrailEditorSource, /sticks: \[\]/);
assert.match(attackTrailEditorSource, /name: presetName/);
assert.match(attackTrailEditorSource, /_headPathTime\(segment, timing, localTime\)/);
assert.match(attackTrailEditorSource, /_selectedGuidePreviewPathTime\(segment, timing\)/);
assert.match(attackTrailEditorSource, /stick\.headFrame = stick\.headFrame === false/);
assert.match(attackTrailEditorSource, /_preferredSegment\(segments = this\._displaySegments\(\)\)/);
assert.match(attackTrailEditorSource, /segments\.filter\(\(segment\) => segment\.presetOnly !== true\)/);
assert.match(attackTrailEditorSource, /\.\.\.this\._presets\(\)/);
assert.match(attackTrailEditorSource, /应用预设（全局通用）/);
assert.match(attackTrailEditorSource, /upsertAttackTrailPresetByName\(\(this\.data\.presets \|\|= \[\]\), segment\)/);
assert.match(attackTrailEditorSource, /if \(!preview\?\.presetOnly\) return preview;\s*return this\._trailFromSavedPreset\(preview\)/);
const tunerHtmlSource = fs.readFileSync(path.join(__dirname, "animation_tuner", "public", "index.html"), "utf8");
assert.match(tunerHtmlSource, /id="attackTrailNew"[^>]*>保存<\/button>/);
assert.match(tunerHtmlSource, /id="attackTrailPresetName"[^>]*maxlength="60"/);
assert.match(tunerHtmlSource, /id="attackTrailAddStick"[^>]*>＋<\/button>/);
assert.match(tunerHtmlSource, /id="attackTrailDeleteStick"[^>]*>－<\/button>/);
assert.match(tunerHtmlSource, /id="attackTrailHeadFrame"[^>]*>头部帧<\/button>/);
assert.match(tunerHtmlSource, /id="attackTrailDrawMode"[^>]*>拖尾绘制<\/button>/);
assert.match(tunerHtmlSource, /id="attackTrailInsertMode"[^>]*>拖尾插入<\/button>/);
assert.match(tunerHtmlSource, /id="attackTrailPreview"[^>]*>拖尾预览<\/button>/);
assert.match(tunerHtmlSource, /id="attackTrailPathToggle"[^>]*>轨<\/button>/);
assert.match(tunerHtmlSource, /id="attackTrailInvertTexture"[^>]*>反色<\/button>/);
assert.match(tunerHtmlSource, /id="attackTrailSmooth"/);
assert.match(tunerHtmlSource, /id="attackTrailFrameToggle"/);
assert.match(tunerHtmlSource, /材质叠层（4 个用途 \/ 3 种纹理）/);
assert.match(tunerHtmlSource, /id="attackTrailStreaksPreview"/);
assert.match(tunerHtmlSource, /id="attackTrailStreaksBrowse"/);
assert.match(tunerHtmlSource, /id="attackTrailBreakupPreview"/);
assert.match(tunerHtmlSource, /id="attackTrailBreakupBrowse"/);
assert.match(tunerHtmlSource, /id="attackTrailCorePreview"/);
assert.match(tunerHtmlSource, /id="attackTrailCoreBrowse"/);
assert.match(tunerHtmlSource, /id="attackTrailCoreColor"/);
assert.match(tunerHtmlSource, /id="attackTrailGlowColor"/);
assert.match(tunerHtmlSource, /id="attackTrailCoreEdge"/);
assert.match(tunerHtmlSource, /id="attackTrailCoreStrength"/);
assert.match(tunerHtmlSource, /id="attackTrailGlowStrength"/);
assert.match(tunerHtmlSource, /id="attackTrailGlowRadius"[^>]*max="60"/);
assert.match(tunerHtmlSource, /id="attackTrailHeadLightBoost"/);
assert.match(tunerHtmlSource, /id="attackTrailBodyOpacityFloor"/);
assert.match(tunerHtmlSource, /id="attackTrailBodyDetailStrength"/);
assert.match(tunerHtmlSource, /id="attackTrailWidthMode"/);
assert.match(tunerHtmlSource, /id="attackTrailFixedWidth"/);
assert.match(tunerHtmlSource, /id="attackTrailWidthScale"/);
assert.match(tunerHtmlSource, /id="attackTrailWidthOffset"/);
assert.match(tunerHtmlSource, /id="attackTrailWidthChaseStrength"/);
assert.match(tunerHtmlSource, /id="attackTrailPathScaleX"/);
assert.match(tunerHtmlSource, /id="attackTrailPathScaleY"/);
assert.match(tunerHtmlSource, /id="attackTrailBodyWhiteThreshold"/);
assert.match(tunerHtmlSource, /id="attackTrailBreakupThreshold"/);
assert.match(tunerHtmlSource, /id="attackTrailBreakupSoftness"/);
assert.match(tunerHtmlSource, /id="attackTrailBreakupExpansion"/);
assert.match(tunerHtmlSource, /id="attackTrailStreaksThreshold"/);
assert.match(tunerHtmlSource, /id="attackTrailStreaksSoftness"/);
assert.match(tunerHtmlSource, /id="attackTrailStreaksExpansion"/);
assert.match(tunerHtmlSource, /id="attackTrailHeadWhitePreserve"/);
assert.match(tunerHtmlSource, /id="attackTrailHeadWhiteLength"/);
assert.match(tunerHtmlSource, /亮边与荧光（最上层）/);
assert.equal((tunerHtmlSource.match(/亮边颜色/g) || []).length, 1);
assert.equal((tunerHtmlSource.match(/荧光颜色/g) || []).length, 1);
assert.equal((tunerHtmlSource.match(/亮边强度 %/g) || []).length, 1);
assert.equal((tunerHtmlSource.match(/荧光强度 %/g) || []).length, 1);
assert.match(tunerHtmlSource, /斑驳抠除（第 3 层）/);
assert.match(tunerHtmlSource, /内部变色（第 4 层，默认复用第 3 张）/);
assert.match(tunerHtmlSource, /<summary>拖尾参数<\/summary>/);
assert.doesNotMatch(tunerHtmlSource, /attackTrailBeforeTimeMs|attackTrailAfterTimeMs|attackTrailTotalDurationMs|attackTrailTailHeadSpeedRatio|动态与细腻度/);
assert.match(attackTrailEditorSource, /const DRAW_PREVIEW_DURATION_MS = 1000/);
assert.match(attackTrailEditorSource, /const DRAW_PREVIEW_TAIL_HEAD_SPEED_RATIO = 0\.5/);
assert.match(attackTrailEditorSource, /for \(const stick of \[\.\.\.segment\.sticks\]\.reverse\(\)\)/);
assert.match(attackTrailEditorSource, /frameSlice\?\.enabled && this\.pathVisible/);
assert.match(attackTrailEditorSource, /_processedBodyTexture\(\s*image,\s*segment,\s*breakupMask/);
assert.match(attackTrailEditorSource, /_processedMaterialLayerTexture\(materialImage, material, segment, layerId, image\)/);
assert.match(attackTrailEditorSource, /breakupAlpha = 1 - clamp\(maskMaterial\.strength/);
assert.match(attackTrailEditorSource, /const whiteAmount = Math\.max\(headWhite, authoredWhite \* segment\.bodyDetailStrength\)/);
assert.match(attackTrailEditorSource, /_widthPose\(pose, segment\)/);
assert.match(attackTrailEditorSource, /_pathScalePose\(pose, segment, pivot\)/);
assert.match(attackTrailEditorSource, /authoredTailDistance - centerTailDistance\) \* segment\.widthChaseStrength/);
assert.match(attackTrailEditorSource, /const PREVIEW_TEXTURE_MAX_SIZE = 256/);
assert.match(attackTrailEditorSource, /compositeGpuSurface\(this\.gpuCanvas, "source-over", alpha\)/);
assert.match(attackTrailEditorSource, /coreSurface = this\.gpuCoreCanvas/);
assert.match(attackTrailEditorSource, /compositeGpuSurface\(\s*glowSurface,\s*"lighter"/);
assert.match(attackTrailEditorSource, /alpha \* segment\.glowStrength \* 0\.95/);
assert.match(attackTrailEditorSource, /alpha \* coreMaterial\.strength/);
assert.match(attackTrailEditorSource, /const fluorescentHaloColor = \(value\) =>/);
assert.match(attackTrailEditorSource, /fillStyle = segment\.glowColor/);
assert.match(attackTrailEditorSource, /globalCompositeOperation = "lighter";\s*this\.gpuGlowContext\.drawImage\(coreSurface/);
assert.match(attackTrailEditorSource, /_enterStaticEditPreview\(\) \{\s*this\.hooks\.stopPlayback\?\.\(\);\s*this\._stopFixedPreview\(false\);\s*this\.staticEditPreview = true;/);
assert.match(attackTrailEditorSource, /if \(this\.staticEditPreview\) \{\s*this\._drawSegment\(segment, alpha, layer, \{ enabled: true, tailProgress: 0, headProgress: 1 \}\);/);
assert.match(attackTrailEditorSource, /isContinuous\(\) \{\s*if \(this\.staticEditPreview\) return false;/);
assert.match(attackTrailEditorSource, /_usesFrameSlicesOnly\(\)/);
assert.match(attackTrailEditorSource, /Object\.values\(segment\.frameSlices \|\| \{\}\)\.some/);
assert.match(attackTrailEditorSource, /frameSlices: frameSlices \|\| \{\}/);
assert.match(attackTrailEditorSource, /_startFixedPreview\(\)[\s\S]*?this\.staticEditPreview = false;\s*this\.previewing = true;/);
const tunerAppSource = fs.readFileSync(path.join(__dirname, "animation_tuner", "public", "app.js"), "utf8");
const tunerStyleSource = fs.readFileSync(path.join(__dirname, "animation_tuner", "public", "style.css"), "utf8");
assert.match(tunerAppSource, /frame\?\.assetVersion \|\| frame\?\.assetHash/);
const tunerAttackTrailSource = fs.readFileSync(path.join(__dirname, "animation_tuner", "public", "attack_trails.js"), "utf8");
const tunerServerSource = fs.readFileSync(path.join(__dirname, "animation_tuner", "server.js"), "utf8");
const godotAttackTrailRendererSource = fs.readFileSync(path.join(__dirname, "runtime", "xsxb_attack_trail_renderer.gd"), "utf8");
const liteUiSource = fs.readFileSync(path.join(__dirname, "frame_tuner_lite", "public", "lite.js"), "utf8");
const liteServerSource = fs.readFileSync(path.join(__dirname, "frame_tuner_lite", "server.js"), "utf8");
const liteContractSource = fs.readFileSync(path.join(__dirname, "..", "skills", "xsxb-frame-tuner", "references", "lite-contract.md"), "utf8");
const liteImportFramesSource = fs.readFileSync(path.join(__dirname, "frame_tuner_lite", "import_frames.js"), "utf8");
const liteImportSheetSource = fs.readFileSync(path.join(__dirname, "frame_tuner_lite", "import_sheet.js"), "utf8");
assert.match(tunerAppSource, /window\.XsxbFrameTunerLite/);
assert.match(tunerAppSource, /function frameAudioKey[\s\S]*?tuningAnimationName\(group\)/);
assert.match(tunerServerSource, /values: tuningFile\.values/);
assert.match(tunerServerSource, /values: supplied\("values"\)/);
assert.match(tunerServerSource, /const attackTrails = project\.kind === "codex_pets" \? EMPTY_ATTACK_TRAILS : readAttackTrails\(project\)/);
assert.match(tunerServerSource, /function projectConfigRevision\(project\)/);
assert.match(tunerServerSource, /sharedAttackTrailPresetPath\(ROOT\)/);
assert.match(tunerServerSource, /saveSharedAttackTrailPresets\(ROOT, project\.id, trails\.presets\)/);
assert.match(tunerServerSource, /const godotSync = engine === "godot" \? syncGodotProject\(ROOT, projectStore, project, syncOptions\) : null/);
assert.match(tunerServerSource, /parsed\.pathname === "\/api\/duplicate-frame"/);
assert.match(tunerServerSource, /duplicateProjectFrame\(project, payload\)/);
assert.match(tunerServerSource, /parsed\.pathname === "\/api\/frame-audio"[\s\S]*?configRevision: projectConfigRevision\(project\)/);
assert.match(tunerServerSource, /payload\.allowEmpty !== true/);
assert.match(tunerServerSource, /缺少可保存的音频数据或稳定路径/);
assert.match(tunerServerSource, /code: "stale_config"/);
assert.match(tunerServerSource, /cache-control", "no-store, no-cache, must-revalidate"/);
assert.match(tunerAppSource, /configRevision: config\?\.configRevision \|\| ""/);
assert.match(tunerAppSource, /res\.status === 409 && errorPayload\.code === "stale_config"/);
assert.match(tunerAppSource, /result\.engine === "godot"/);
assert.match(tunerAppSource, /result\.godotSync\?\.ok === true/);
assert.match(tunerAppSource, /godotSyncFailed/);
assert.match(tunerAppSource, /async function syncFrameAudioBindingsToGame[\s\S]*?configRevision: config\?\.configRevision \|\| ""/);
assert.match(tunerAppSource, /async function syncFrameAudioBindingsToGame[\s\S]*?config\.configRevision = result\.configRevision/);
assert.match(tunerAppSource, /allowEmpty: options\.allowEmpty === true/);
assert.match(tunerAppSource, /syncFrameAudioBindingsToGame\(\{ allowEmpty: true \}\)/);
assert.match(tunerAppSource, /function renderLiteExportFrame\(/);
assert.match(tunerAppSource, /zoom: pixelScale \/ Math\.max/);
assert.match(tunerAppSource, /function unityBakePixelScaleForFrame\(/);
assert.match(tunerAppSource, /function unityBakePixelScaleThatFits\(/);
assert.match(tunerAppSource, /changedGroupKeys\.has\(saveScopeGroupKey\(group\)\)/);
assert.match(tunerAppSource, /changed_groups: config\?\.projectEngine === "unity"/);
assert.match(tunerAppSource, /bakedPixelScale,/);
assert.match(tunerAppSource, /function isMarkerOnlyFrameAttachment\(attachment\)/);
assert.match(tunerAppSource, /endsWith\("_hand_anchor\.png"\)/);
// Editing-marker exclusion is verified through rendered pixels in browser_export_test.js.
assert.match(tunerAppSource, /\.filter\(\(attachment\) => !isMarkerOnlyFrameAttachment\(attachment\)\)/);
assert.match(tunerAppSource, /function liteExportAudio\(/);
assert.match(tunerAppSource, /XsxbTimingModes\.bakedSequenceSamples\(playableFrames\)/);
assert.match(tunerAppSource, /if \(attackTrailEditor\?\.isContinuous\(\)\) return true/);
assert.match(tunerAppSource, /data-action="duplicate-frame"/);
assert.match(tunerAppSource, /async function duplicateFrameAfter\(/);
assert.match(tunerAppSource, /selectedGuidePreviewActive: \(\) => !playing && !Number\.isFinite\(liteExportTime\)/);
assert.match(tunerAttackTrailSource, /isEditingWorkspace\(\) \{\s*return this\.enabled && \(this\.workspaceMode === "draw" \|\| this\.workspaceMode === "insert"\);/);
assert.match(tunerAttackTrailSource, /this\.hooks\.attachmentEditingLockChanged\?\.\(locked\)/);
assert.match(tunerAppSource, /function frameAttachmentEditingLocked\(\)/);
assert.match(tunerAppSource, /function directManipulationAttachment\(\) \{\s*if \(frameAttachmentEditingLocked\(\)\) return null;/);
assert.match(tunerAppSource, /if \(selectedFrameAttachment\(\)\) return mode === "frame" && !frameAttachmentEditingLocked\(\);/);
assert.match(tunerAppSource, /locked \? "lockedAttachment" : ""/);
assert.match(tunerAppSource, /async function bindFrameImageAttachmentFile[\s\S]*?frameAttachmentEditingLocked\(\)/);
assert.match(tunerAppSource, /attachmentEditingLockChanged: \(locked\) => syncFrameAttachmentEditingLock\(locked\)/);
assert.match(tunerStyleSource, /\.attachmentThumb\.lockedAttachment/);
assert.match(tunerStyleSource, /\.attachmentLockBadge/);
assert.match(tunerAttackTrailSource, /_triangleTouchesLayer\(/);
assert.match(tunerAttackTrailSource, /triangleTimes\.some\(/);
assert.match(tunerAttackTrailSource, /totalDuration \* speedRatio \/ \(1 \+ speedRatio\)/);
assert.match(tunerAttackTrailSource, /tailProgress = clamp\(\(local - duration\)/);
assert.match(tunerAttackTrailSource, /smoothTrailSticks/);
assert.match(tunerAttackTrailSource, /pushUndo\("smooth attack trail"\)/);
assert.match(tunerAttackTrailSource, /_drawFrameSliceHandles\(/);
assert.match(tunerAttackTrailSource, /tailProgress/);
assert.match(tunerAttackTrailSource, /headProgress/);
assert.match(tunerAttackTrailSource, /attackTrailLifecycleOrigin\(sticks, this\.hooks\.frameArrival\)/);
assert.match(godotAttackTrailRendererSource, /func _triangle_touches_layer\(/);
assert.match(godotAttackTrailRendererSource, /sample_times\[vertex_index\]/);
assert.match(godotAttackTrailRendererSource, /total_duration \* speed_ratio \/ \(1\.0 \+ speed_ratio\)/);
assert.match(godotAttackTrailRendererSource, /tail_progress := clampf\(\(local_time - motion_duration\)/);
assert.match(godotAttackTrailRendererSource, /trail_frame_arrival_time", animation_name, int\(lifecycle_first_stick\.get\("frame", 0\)\), 0\.0/);
assert.match(tunerAppSource, /audio: \(samples\) => liteExportAudio\(samples\)/);
assert.match(tunerAppSource, /measureFrame:/);
assert.match(tunerAppSource, /options\.measureOnly === true/);
assert.match(tunerAppSource, /projectKind !== "frame_lite"/);
assert.match(liteUiSource, /透明序列导出/);
assert.doesNotMatch(liteUiSource, /id="litePhaseDurationMs"/);
assert.doesNotMatch(liteUiSource, /id="liteExportFps"/);
assert.match(liteUiSource, /导出 PNG 序列/);
assert.match(liteUiSource, /导出 Sheet \+ JSON/);
assert.match(liteUiSource, /重新计算全角色画布/);
assert.match(liteUiSource, /calculateOptimalLayout/);
assert.match(liteUiSource, /collectExportGroups/);
assert.match(liteUiSource, /packageAudioAssets/);
assert.match(liteUiSource, /audioMetadata/);
assert.match(liteUiSource, /if \(kind === "sequence"\) \{\s*await writeJson\(targetDirectory, "export\.json"/);
assert.match(liteUiSource, /sourceFrameIndex: frame\.sourceFrame/);
assert.match(liteUiSource, /getDirectoryHandle\("audio", \{ create: true \}\)/);
assert.match(liteUiSource, /showDirectoryPicker/);
assert.doesNotMatch(liteUiSource, /litePhaseDurationMs/);
assert.match(liteUiSource, /每张可播放源帧只生成一张透明烘焙帧/);
assert.match(liteUiSource, /createWritable/);
assert.doesNotMatch(liteUiSource, /\/api\/lite\/export-file/);
assert.doesNotMatch(liteServerSource, /\/api\/lite\/export-file/);
assert.doesNotMatch(liteServerSource, /\/api\/lite\/export-complete/);
assert.match(liteServerSource, /saveFrameAudioBindings/);
assert.match(liteServerSource, /frameAudioBindings: data\.audio/);
assert.match(liteServerSource, /url\.pathname === "\/api\/frame-audio"/);
assert.match(liteServerSource, /url\.pathname === "\/api\/frame-audio"[\s\S]*?configRevision: projectConfigRevision\(project\)/);
assert.match(liteServerSource, /payload\.allowEmpty !== true/);
assert.match(liteServerSource, /缺少可保存的音频数据或 Lite 稳定路径/);
assert.match(liteServerSource, /url\.pathname === "\/api\/duplicate-frame"/);
assert.match(liteServerSource, /function duplicateProjectFrame\(/);
assert.match(liteServerSource, /function projectConfigRevision\(/);
assert.match(liteServerSource, /sharedAttackTrailPresetPath\(ROOT\)/);
// Shared preset persistence and rollback are exercised by frame_edit_audit_test.js.
assert.match(liteServerSource, /code: "stale_config"/);
assert.doesNotMatch(liteServerSource, /Lite 不绑定音效/);
assert.match(liteContractSource, /portable audio files plus JSON events/);
assert.match(liteContractSource, /must not create a duplicate `export\.json`/);
assert.doesNotMatch(liteContractSource, /no audio/);
assert.doesNotMatch(liteImportFramesSource, /parseCanvas/);
assert.doesNotMatch(liteImportSheetSource, /parseCanvas/);
assert.deepEqual(frameEntries({ frames: [{ filename: "f2.png" }, { filename: "f10.png" }] }).map(([name]) => name), ["f2.png", "f10.png"]);
assert.deepEqual(frameEntries({ frames: { "f10.png": {}, "f2.png": {} } }).map(([name]) => name), ["f2.png", "f10.png"]);
assert.deepEqual(cropFromEntry({ frame: { x: 4, y: 7, w: 20, h: 30 } }), { x: 4, y: 7, width: 20, height: 30 });
assert.deepEqual(cropFromEntry({ crop: { left: 2, top: 3, width: 9, height: 11 } }), { x: 2, y: 3, width: 9, height: 11 });

const normalizedTrails = normalizeAttackTrails({
  bindings: {
    "hero/attack": [{
      layer: "front",
      colorMode: "original",
      invertTexture: true,
      tailFadeStart: 0.72,
      headCurvature: 0.65,
      texture: { path: "workspace/trail.png", hasEffectiveAlpha: true },
      sticks: [
        { id: "second", order: 9, frame: 2, framePhase: 0.75, directionOffset: 35, top: { x: 0, y: 0 }, bottom: { x: 0, y: 20 } },
        { id: "first", order: 2, frame: 2, framePhase: 0.25, layer: "behind", top: { x: 0, y: 0 }, bottom: { x: 0, y: 10 } },
      ],
    }],
  },
});
assert.equal(normalizedTrails.bindings["hero/attack"][0].sticks.length, 2);
assert.deepEqual(normalizedTrails.bindings["hero/attack"][0].sticks.map((stick) => stick.order), [0, 1]);
assert.deepEqual(normalizedTrails.bindings["hero/attack"][0].sticks.map((stick) => stick.framePhase), [1 / 3, 2 / 3]);
assert.deepEqual(normalizedTrails.bindings["hero/attack"][0].sticks.map((stick) => stick.layer), ["front", "behind"]);
assert.equal(normalizedTrails.bindings["hero/attack"][0].tailFadeStart, 0.72);
assert.equal(normalizedTrails.bindings["hero/attack"][0].headCurvature, 0.65);
assert.equal(normalizedTrails.bindings["hero/attack"][0].invertTexture, true);
assert.equal(normalizedTrails.bindings["hero/attack"][0].sticks[0].directionOffset, 35);
assert.equal(normalizedTrails.bindings["hero/attack"][0].sticks[1].directionOffset, 0);
assert.equal(normalizedTrails.bindings["hero/attack"][0].coordinateSpace, "group");
assert.equal(normalizedTrails.schemaVersion, 21);
assert.deepEqual(normalizedTrails.bindings["hero/attack"][0].sticks.map((stick) => stick.headFrame), [true, true]);
assert.equal(normalizedTrails.bindings["hero/attack"][0].totalDurationMs, 0);
assert.equal(normalizedTrails.bindings["hero/attack"][0].tailHeadSpeedRatio, 0.7);
assert.equal(normalizedTrails.bindings["hero/attack"][0].gradientStops.length, 2);
assert.deepEqual(Object.keys(normalizedTrails.bindings["hero/attack"][0].materialLayers), ["streaks", "breakup", "core"]);
assert.equal(normalizedTrails.bindings["hero/attack"][0].materialLayers.streaks.texture.name, "coherent_breakup_luma.png");
assert.equal(normalizedTrails.bindings["hero/attack"][0].materialLayers.breakup.texture.name, "coherent_breakup_luma.png");
assert.equal(normalizedTrails.bindings["hero/attack"][0].materialLayers.core.texture.name, "coherent_outer_glow_luma.png");
assert.deepEqual(
  [
    normalizedTrails.presetTexture,
    normalizedTrails.bindings["hero/attack"][0].materialLayers.streaks.texture,
    normalizedTrails.bindings["hero/attack"][0].materialLayers.breakup.texture,
    normalizedTrails.bindings["hero/attack"][0].materialLayers.core.texture,
  ].map((texture) => [texture.width, texture.height]),
  [[256, 256], [256, 256], [256, 256], [256, 256]],
);
assert.equal(normalizedTrails.bindings["hero/attack"][0].materialLayers.streaks.strength, 0.46);
assert.equal(normalizedTrails.bindings["hero/attack"][0].materialLayers.breakup.strength, 0.72);
assert.equal(normalizedTrails.bindings["hero/attack"][0].materialLayers.breakup.invert, false);
assert.equal(normalizedTrails.bindings["hero/attack"][0].materialLayers.core.color, "#ffe7ee");
assert.equal(normalizedTrails.bindings["hero/attack"][0].materialLayers.core.strength, 1.05);
assert.equal(normalizedTrails.bindings["hero/attack"][0].coreEdge, "top");
assert.equal(normalizedTrails.bindings["hero/attack"][0].glowColor, "#ff2d6a");
assert.equal(normalizedTrails.bindings["hero/attack"][0].glowStrength, 0.28);
assert.equal(normalizedTrails.bindings["hero/attack"][0].glowRadius, 16);
assert.equal(normalizedTrails.bindings["hero/attack"][0].headLightBoost, 0.55);
assert.equal(normalizedTrails.presetTexture.name, "coherent_trail_body_luma.png");
assert.equal(normalizedTrails.presetTexture.assetHash, "af5fffcb5009c5eb78bc595d85f72f0bd68e310d5f7926e54512d4f39efb1878");
const separatedEdgeAndGlow = normalizeAttackTrails({ bindings: { "hero/attack": [{
  bodyOpacityFloor: 0.4,
  bodyDetailStrength: 0.45,
  bodyWhiteThreshold: 0.68,
  widthMode: "fixed",
  fixedWidth: 144,
  widthScale: 0.75,
  widthOffset: -0.2,
  widthChaseStrength: 0.15,
  pathScaleX: 0.72,
  pathScaleY: 1.1,
  materialLayers: {
    core: { color: "#00ffff", strength: 0.6 },
    breakup: { threshold: 0.12, softness: 0.34, expansion: 0.04 },
    streaks: { threshold: 0.22, softness: 0.18, expansion: 0.06 },
  },
  glowColor: "#ff00ff",
  glowStrength: 2.3,
  headWhitePreserve: 0.9,
  headWhiteLength: 0.24,
}] } });
const reloadedEdgeAndGlow = normalizeAttackTrails(JSON.parse(JSON.stringify(separatedEdgeAndGlow)))
  .bindings["hero/attack"][0];
assert.equal(reloadedEdgeAndGlow.materialLayers.core.color, "#00ffff");
assert.equal(reloadedEdgeAndGlow.materialLayers.core.strength, 0.6);
assert.equal(reloadedEdgeAndGlow.bodyOpacityFloor, 0.4);
assert.equal(reloadedEdgeAndGlow.bodyDetailStrength, 0.45);
assert.equal(reloadedEdgeAndGlow.bodyWhiteThreshold, 0.68);
assert.equal(reloadedEdgeAndGlow.widthMode, "fixed");
assert.equal(reloadedEdgeAndGlow.fixedWidth, 144);
assert.equal(reloadedEdgeAndGlow.widthScale, 0.75);
assert.equal(reloadedEdgeAndGlow.widthOffset, -0.2);
assert.equal(reloadedEdgeAndGlow.widthChaseStrength, 0.15);
assert.equal(reloadedEdgeAndGlow.pathScaleX, 0.72);
assert.equal(reloadedEdgeAndGlow.pathScaleY, 1.1);
assert.equal(reloadedEdgeAndGlow.materialLayers.breakup.threshold, 0.12);
assert.equal(reloadedEdgeAndGlow.materialLayers.breakup.softness, 0.34);
assert.equal(reloadedEdgeAndGlow.materialLayers.breakup.expansion, 0.04);
assert.equal(reloadedEdgeAndGlow.materialLayers.streaks.threshold, 0.22);
assert.equal(reloadedEdgeAndGlow.materialLayers.streaks.softness, 0.18);
assert.equal(reloadedEdgeAndGlow.materialLayers.streaks.expansion, 0.06);
assert.equal(reloadedEdgeAndGlow.glowColor, "#ff00ff");
assert.equal(reloadedEdgeAndGlow.glowStrength, 2.3);
assert.equal(reloadedEdgeAndGlow.headWhitePreserve, 0.9);
assert.equal(reloadedEdgeAndGlow.headWhiteLength, 0.24);
assert.equal(normalizeAttackTrails({
  presetTexture: {
    path: "tools/animation_tuner/public/presets/attack_trails/dynamic_trail_luma.png",
    assetHash: "e2b855cdb3c59db8b4ed33f400b03bafd4af7df2636f3fd4d3eb68603763da90",
  },
  bindings: {
    "hero/attack": [{
      texture: {
        path: "tools/animation_tuner/public/presets/attack_trails/dynamic_trail_luma.png",
        assetHash: "e2b855cdb3c59db8b4ed33f400b03bafd4af7df2636f3fd4d3eb68603763da90",
      },
    }],
  },
}).bindings["hero/attack"][0].texture.name, "coherent_trail_body_luma.png");
const reloadedTrails = normalizeAttackTrails(JSON.parse(JSON.stringify(normalizedTrails)));
assert.equal(reloadedTrails.bindings["hero/attack"][0].headCurvature, 0.65);
assert.equal(reloadedTrails.bindings["hero/attack"][0].invertTexture, true);
assert.equal(reloadedTrails.bindings["hero/attack"][0].sticks[0].directionOffset, 35);
assert.equal(normalizeAttackTrails({ bindings: { "hero/punch": [{ name: "Saved style", headCurvature: 0.8, color: "#ff8844" }] } }).bindings["hero/punch"][0].name, "Saved style");
assert.equal(normalizeAttackTrails({ bindings: { "hero/punch": [{ name: "?????????" }] } }).bindings["hero/punch"][0].name, "默认拖尾");
assert.equal(normalizeAttackTrails({ bindings: { "hero/punch": [{ name: "姒涙顓婚幏鏍х啲" }] } }).bindings["hero/punch"][0].name, "默认拖尾");
assert.equal(normalizeAttackTrails({ presetTexture: { path: "workspace/custom.png", name: "custom.png" } }).presetTexture.path, "workspace/custom.png");
assert.equal(normalizeAttackTrails({ bindings: { "hero/attack": [{}] } }).bindings["hero/attack"][0].tailFadeStart, 0.6);
assert.equal(normalizeAttackTrails({ bindings: { "hero/attack": [{}] } }).bindings["hero/attack"][0].pathColumns, 20);
const savedStylePreset = normalizeAttackTrails({ bindings: { "hero/attack": [{ presetOnly: true, name: "Warm punch", texture: { path: "workspace/trail.png" }, color: "#ff8844", sticks: [] }] } });
assert.equal(savedStylePreset.presets[0].presetOnly, true);
assert.equal(savedStylePreset.presets[0].name, "Warm punch");
assert.equal(savedStylePreset.bindings["hero/attack"], undefined);
assert.deepEqual(validateAttackTrails(savedStylePreset, { profiles: [{ id: "hero", animations: [{ id: "attack" }] }] }), []);
const sharedStylePreset = normalizeAttackTrails({
  presets: [{ id: "shared", presetOnly: true, name: "Shared style", sticks: [] }],
  bindings: {
    "hero/attack1": [{ id: "legacy", presetOnly: true, name: "Legacy style", sticks: [] }],
    "hero/attack2": [{ id: "live", sticks: [{ frame: 0 }, { frame: 1 }] }],
  },
});
assert.deepEqual(sharedStylePreset.presets.map((preset) => preset.name), ["Shared style", "Legacy style"]);
assert.equal(sharedStylePreset.bindings["hero/attack1"], undefined);
assert.equal(sharedStylePreset.bindings["hero/attack2"][0].id, "live");
const sharedTrailPresetRoot = fs.mkdtempSync(path.join(os.tmpdir(), "xsxb-shared-trail-presets-"));
try {
  const projectATrails = normalizeAttackTrails({
    presets: [{ id: "preset_a", presetOnly: true, name: "Preset A", sticks: [] }],
    bindings: { "hero/attack": [{ id: "trail_a", sticks: [{ frame: 0 }, { frame: 1 }] }] },
  });
  const projectBTrails = normalizeAttackTrails({
    presets: [{ id: "preset_b", presetOnly: true, name: "Preset B", sticks: [] }],
    bindings: { "enemy/attack": [{ id: "trail_b", sticks: [{ frame: 0 }, { frame: 1 }] }] },
  });
  const loadedA = attackTrailsWithSharedPresets(sharedTrailPresetRoot, "project_a", projectATrails);
  assert.deepEqual(loadedA.presets.map((preset) => preset.id), ["preset_a"]);
  assert.equal("profileId" in loadedA.presets[0], false);
  assert.equal("animationId" in loadedA.presets[0], false);
  assert.equal("frameSlices" in loadedA.presets[0], false);
  assert.equal("totalDurationMs" in loadedA.presets[0], false);
  const loadedB = attackTrailsWithSharedPresets(sharedTrailPresetRoot, "project_b", projectBTrails);
  assert.deepEqual(loadedB.presets.map((preset) => preset.id), ["preset_a", "preset_b"]);
  const loadedAAgain = attackTrailsWithSharedPresets(sharedTrailPresetRoot, "project_a", projectATrails);
  assert.deepEqual(loadedAAgain.presets.map((preset) => preset.id), ["preset_a", "preset_b"]);
  saveSharedAttackTrailPresets(sharedTrailPresetRoot, "project_b", [loadedB.presets[1]]);
  const afterGlobalDelete = attackTrailsWithSharedPresets(sharedTrailPresetRoot, "project_a", projectATrails);
  assert.deepEqual(afterGlobalDelete.presets.map((preset) => preset.id), ["preset_b"]);
  assert.deepEqual(readSharedAttackTrailPresetStore(sharedTrailPresetRoot).migratedProjectIds, ["project_a", "project_b"]);
  const runtimeTrails = attackTrailsWithoutSharedPresets(loadedB);
  assert.deepEqual(runtimeTrails.presets, []);
  assert.equal(runtimeTrails.bindings["enemy/attack"][0].id, "trail_b");
} finally {
  fs.rmSync(sharedTrailPresetRoot, { recursive: true, force: true });
}
const registeredTrailPresetStore = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, "..", "data", "attack_trail_presets.json"), "utf8"),
);
const registeredFourLayerPresetIds = [
  "xsxb_rectangular_head_multilayer_v1",
  "xsxb_four_layer_ribbons_v1",
  "xsxb_four_layer_eroded_v1",
];
const registeredFourLayerPresets = registeredFourLayerPresetIds.map((presetId) => {
  const preset = registeredTrailPresetStore.presets.find((candidate) => candidate.id === presetId);
  assert.ok(preset, `missing registered four-layer trail preset: ${presetId}`);
  return preset;
});
assert.equal(new Set(registeredFourLayerPresets.map((preset) => (
  `${preset.texture.path}:${preset.texture.assetHash}`
))).size, 1);
assert.equal(new Set(registeredFourLayerPresets.map((preset) => (
  `${preset.materialLayers.core.texture.path}:${preset.materialLayers.core.texture.assetHash}`
))).size, 1);
const registeredFourLayerPalette = (preset) => ({
  colorMode: preset.colorMode,
  color: preset.color,
  gradientColors: preset.gradientStops.map((stop) => stop.color),
  streaksColor: preset.materialLayers.streaks.color,
  streaksStrength: preset.materialLayers.streaks.strength,
  streaksBlendMode: preset.materialLayers.streaks.blendMode,
  breakupStrength: preset.materialLayers.breakup.strength,
  coreColor: preset.materialLayers.core.color,
  coreStrength: preset.materialLayers.core.strength,
  glowColor: preset.glowColor,
  glowStrength: preset.glowStrength,
  glowRadius: preset.glowRadius,
});
assert.equal(new Set(registeredFourLayerPresets.map((preset) => (
  JSON.stringify(registeredFourLayerPalette(preset))
))).size, 1);
assert.deepEqual(registeredFourLayerPalette(registeredFourLayerPresets[0]), {
  colorMode: "solid",
  color: "#e8ecf1",
  gradientColors: ["#cbd3dc", "#ffffff"],
  streaksColor: "#dce6f0",
  streaksStrength: 0.95,
  streaksBlendMode: "screen",
  breakupStrength: 0.32,
  coreColor: "#ffffff",
  coreStrength: 1.25,
  glowColor: "#ffffff",
  glowStrength: 0.7,
  glowRadius: 18,
});
for (const preset of registeredFourLayerPresets) {
  const sharedMaskTexture = preset.materialLayers.breakup.texture;
  const sharedColorTexture = preset.materialLayers.streaks.texture;
  assert.equal(sharedMaskTexture.path, sharedColorTexture.path);
  assert.equal(sharedMaskTexture.assetHash, sharedColorTexture.assetHash);
  assert.equal(preset.materialLayers.core.texture.path.includes("four_layer_fixed_edge_luma_v4.png"), true);
  assert.equal(preset.texture.path.includes("four_layer_fixed_body_luma_v4.png"), true);
  for (const texture of [preset.texture, sharedMaskTexture, sharedColorTexture, preset.materialLayers.core.texture]) {
    const texturePath = path.resolve(__dirname, "..", texture.path);
    const textureBuffer = fs.readFileSync(texturePath);
    const textureInfo = pngInfo(textureBuffer);
    assert.deepEqual([textureInfo.width, textureInfo.height], [256, 256]);
    assert.equal(crypto.createHash("sha256").update(textureBuffer).digest("hex"), texture.assetHash);
  }
}
const migratedChase = normalizeAttackTrails({ bindings: { "hero/attack": [{ beforeStopChaseSpeed: 55, afterStopChaseSpeed: 1360 }] } }).bindings["hero/attack"][0];
assert.ok(Math.abs(migratedChase.tailHeadSpeedRatio - (1 / 1.1875)) < 1e-12);
assert.equal("beforeStopChaseSpeed" in migratedChase, false);
assert.equal("afterStopChaseSpeed" in migratedChase, false);
const explicitChase = normalizeAttackTrails({ bindings: { "hero/attack": [{ beforeStopChaseMultiplier: 0.42, afterStopChaseMultiplier: 3.5 }] } }).bindings["hero/attack"][0];
assert.ok(Math.abs(explicitChase.tailHeadSpeedRatio - (1 / (1 + 0.58 / 3.5))) < 1e-12);
const migratedDefaultChase = normalizeAttackTrails({ schemaVersion: 5, bindings: { "hero/attack": [{ beforeStopChaseMultiplier: 0.7, afterStopChaseMultiplier: 2 }] } });
assert.equal(migratedDefaultChase.schemaVersion, 21);
assert.equal(migratedDefaultChase.bindings["hero/attack"][0].tailHeadSpeedRatio, 0.8);
const explicitTrailTiming = normalizeAttackTrails({ schemaVersion: 11, bindings: { "hero/attack": [{ totalDurationMs: 240, tailHeadSpeedRatio: 1.5 }] } }).bindings["hero/attack"][0];
assert.equal(explicitTrailTiming.totalDurationMs, 240);
assert.equal(explicitTrailTiming.tailHeadSpeedRatio, 0.9);
const strictSpeedRatioTotalMs = 90;
const strictSpeedRatio = 0.5;
const strictHeadDurationMs = strictSpeedRatioTotalMs * strictSpeedRatio / (1 + strictSpeedRatio);
const strictTailDurationMs = strictSpeedRatioTotalMs - strictHeadDurationMs;
assert.equal(strictHeadDurationMs, 30);
assert.equal(strictTailDurationMs, 60);
const gradientTrail = normalizeAttackTrails({ bindings: { "hero/gradient": [{
  colorMode: "gradient",
  color: "#123456",
  gradientStops: [
    { id: "top", position: 1, color: "#ffffff" },
    { id: "middle", position: 0.4, color: "#00ff88" },
    { id: "bottom", position: 0, color: "#220044" },
  ],
}] } }).bindings["hero/gradient"][0];
assert.equal(gradientTrail.colorMode, "gradient");
assert.deepEqual(gradientTrail.gradientStops.map((stop) => stop.position), [0, 0.4, 1]);
assert.deepEqual(gradientTrail.gradientStops.map((stop) => stop.color), ["#220044", "#00ff88", "#ffffff"]);
assert.equal(normalizeAttackTrails({ bindings: { "hero/legacy": [{ colorMode: "luma_tint" }] } }).bindings["hero/legacy"][0].colorMode, "solid");
const mixedPhaseSticks = normalizeAttackTrails({ bindings: { "hero/attack": [{ sticks: [
  { frame: 3, framePhase: 0.6, phaseMode: "manual" },
  { frame: 3, phaseMode: "auto" },
  { frame: 3, phaseMode: "auto" },
] }] } }).bindings["hero/attack"][0].sticks;
assert.deepEqual(mixedPhaseSticks.map((stick) => stick.framePhase), [0.6, 0.7333333333333333, 0.8666666666666667]);
const guideOnlyMiddleStick = normalizeAttackTrails({ bindings: { "hero/attack": [{ sticks: [
  { frame: 3, phaseMode: "auto", headFrame: false },
  { frame: 3, phaseMode: "auto", headFrame: false },
  { frame: 3, phaseMode: "auto", headFrame: false },
] }] } }).bindings["hero/attack"][0].sticks;
assert.deepEqual(guideOnlyMiddleStick.map((stick) => stick.headFrame), [false, false, true]);
assert.deepEqual(guideOnlyMiddleStick.map((stick) => stick.framePhase), [0.5, 0.5, 0.5]);
const automaticHeadSticks = normalizeAttackTrails({ schemaVersion: 11, bindings: { "hero/attack": [{ sticks: [
  { frame: 3, headFrame: true, headFrameMode: "auto" },
  { frame: 3, headFrame: true, headFrameMode: "auto" },
  { frame: 3, headFrame: true, headFrameMode: "manual" },
  { frame: 3, headFrame: true, headFrameMode: "auto" },
] }] } }).bindings["hero/attack"][0].sticks;
assert.deepEqual(automaticHeadSticks.map((stick) => stick.headFrame), [false, false, true, true]);
assert.deepEqual(automaticHeadSticks.map((stick) => stick.headFrameMode), ["auto", "auto", "manual", "auto"]);
const staticFrameTrail = normalizeAttackTrails({ bindings: { "hero/attack": [{
  frameSlices: {
    4: { tailProgress: 0.8, headProgress: 0.2 },
    7: { enabled: false, tail: -1, head: 2 },
  },
}] } }).bindings["hero/attack"][0].frameSlices;
assert.deepEqual(staticFrameTrail, {
  4: { enabled: true, tailProgress: 0.2, headProgress: 0.8 },
  7: { enabled: false, tailProgress: 0, headProgress: 1 },
});
assert.deepEqual(remapFrameOverrideDictionary({
  "hero/attack:0": { duration: 2 },
  "hero/attack:1": { duration: 3 },
  "hero/idle:0": { duration: 4 },
}, "hero/attack:", 0), {
  "hero/attack:0": { duration: 2 },
  "hero/attack:1": { duration: 2 },
  "hero/attack:2": { duration: 3 },
  "hero/idle:0": { duration: 4 },
});
const duplicatedBindings = duplicateFrameBindings([
  { id: "sound", profileId: "hero", animation: "attack", frame: 0, key: "hero/attack:0" },
  { id: "later", profileId: "hero", animation: "attack", frame: 1, key: "hero/attack:1" },
], "hero", "attack", 0);
assert.deepEqual(duplicatedBindings.map((entry) => [entry.id, entry.frame, entry.key]), [
  ["sound", 0, "hero/attack:0"],
  ["sound", 1, "hero/attack:1"],
  ["later", 2, "hero/attack:2"],
]);
const duplicatedTrail = duplicateTrailFrameSlices({
  bindings: {
    "hero/attack": [{
      sticks: [{ frame: 0 }, { frame: 1 }],
      frameSlices: {
        0: { enabled: true, tailProgress: 0.1, headProgress: 0.6 },
        1: { enabled: true, tailProgress: 0.4, headProgress: 1 },
      },
    }],
  },
}, "hero/attack", 0).bindings["hero/attack"][0];
assert.deepEqual(duplicatedTrail.sticks.map((stick) => stick.frame), [0, 2]);
assert.deepEqual(Object.keys(duplicatedTrail.frameSlices), ["0", "1", "2"]);
assert.deepEqual(duplicatedTrail.frameSlices["1"], duplicatedTrail.frameSlices["0"]);
assert.deepEqual(duplicatedTrail.frameSlices["2"], { enabled: true, tailProgress: 0.4, headProgress: 1 });

function tinyPng(colorType, pixelBytes) {
  const chunk = (type, data) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    return Buffer.concat([length, Buffer.from(type, "ascii"), data, Buffer.alloc(4)]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 8;
  ihdr[9] = colorType;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(Buffer.from([0, ...pixelBytes]))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
assert.equal(pngInfo(tinyPng(6, [255, 20, 30, 80])).hasEffectiveAlpha, true);
assert.equal(pngInfo(tinyPng(6, [255, 20, 30, 255])).hasEffectiveAlpha, false);
assert.equal(pngInfo(tinyPng(2, [255, 20, 30])).hasAlphaChannel, false);

function rgbaPng(width, height, pixelAt) {
  const chunk = (type, data) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    return Buffer.concat([length, Buffer.from(type, "ascii"), data, Buffer.alloc(4)]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const rows = [];
  for (let y = 0; y < height; y += 1) {
    rows.push(Buffer.from([0]));
    for (let x = 0; x < width; x += 1) rows.push(Buffer.from(pixelAt(x, y)));
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(Buffer.concat(rows))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const boxEstimatorTestRoot = fs.mkdtempSync(path.join(os.tmpdir(), "xsxb-box-estimator-test-"));
try {
  const greenFrame = path.join(boxEstimatorTestRoot, "green-frame.png");
  fs.writeFileSync(greenFrame, rgbaPng(12, 12, (x, y) => (
    x >= 2 && x <= 8 && y >= 2 && y <= 9
      ? [210, 25, 35, 255]
      : [8, 105, 30, 255]
  )));
  const bounds = opaqueBoundsForPng(greenFrame);
  assert.deepEqual(
    { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
    { x: 2, y: 2, width: 7, height: 8 },
  );
  assert.deepEqual(
    { x: bounds.weaponAccent.x, y: bounds.weaponAccent.y, width: bounds.weaponAccent.width, height: bounds.weaponAccent.height },
    { x: 2, y: 2, width: 7, height: 8 },
  );
  const preservedCollision = {
    offset: { x: 4, y: -10 },
    size: { x: 8, y: 20 },
    rotation: 0,
    enabled: true,
  };
  const tuning = { frame_box_overrides: { "hero/attack1:0": { collisionbox: preservedCollision } } };
  const animation = {
    id: "attack1",
    name: "attack1",
    type: "actor",
    anchorMode: "canvas_bottom_center",
    frames: [{ path: greenFrame }],
  };
  upsertEstimatedFrameBoxes(tuning, "hero", animation, [greenFrame]);
  assert.deepEqual(tuning.frame_box_overrides["hero/attack1:0"].collisionbox, preservedCollision);
  assert.equal(frameBoxCoverageIssues(tuning, "hero", animation).length, 0);
} finally {
  fs.rmSync(boxEstimatorTestRoot, { recursive: true, force: true });
}

assert.equal(trustedRemote("https://github.com/JinBorn/Frame-Tuner.git"), true);
assert.equal(trustedRemote("git@github.com:JinBorn/Frame-Tuner.git"), true);
assert.equal(trustedRemote("ssh://git@github.com/JinBorn/Frame-Tuner.git"), true);
assert.equal(trustedRemote("https://github.com/sparklecatta-lang/XSXB-Frame-Tuner.git"), false);
assert.equal(trustedRemote("https://github.com/example/Frame-Tuner.git"), false);
assert.equal(trustedRemote("https://evilgithub.com/JinBorn/Frame-Tuner.git"), false);

const liteStoreTestRoot = fs.mkdtempSync(path.join(os.tmpdir(), "xsxb-lite-store-test-"));
try {
  const liteStore = createLiteStore(liteStoreTestRoot);
  const project = liteStore.ensureProject("demo project", "Demo Project");
  assert.equal(project.id, "demo_project");
  assert.equal(project.kind, "frame_lite");
  assert.equal(liteStore.readRegistry().activeProjectId, "demo_project");
  const paths = liteStore.paths(project);
  assert.equal(fs.existsSync(paths.manifest), true);
  assert.equal(fs.existsSync(paths.tuning), true);
  assert.equal(fs.existsSync(paths.frameAudio), true);
  assert.deepEqual(liteStore.readJson(paths.frameAudio, null), []);
  assert.equal(fs.existsSync(paths.frameImageAttachments), true);
  assert.equal(fs.existsSync(paths.attackTrails), true);
  assert.equal(liteStore.readJson(paths.attackTrails, {}).schemaVersion, 21);
  assert.deepEqual(liteStore.readJson(paths.attackTrails, {}).presets, []);
  assert.equal(fs.existsSync(paths.settings), true);
  assert.equal(paths.workspaceDir.startsWith(path.resolve(liteStoreTestRoot)), true);
  const exportedAnimationDirectory = path.join(liteStoreTestRoot, "portable_export", "idle");
  const exportedAudioDirectory = path.join(liteStoreTestRoot, "portable_export", "audio");
  fs.mkdirSync(exportedAnimationDirectory, { recursive: true });
  fs.mkdirSync(exportedAudioDirectory, { recursive: true });
  const exportedAudio = path.join(exportedAudioDirectory, "hit.wav");
  fs.writeFileSync(exportedAudio, Buffer.from("RIFFportable-lite-audio", "ascii"));
  const importedAudioCount = importSheetAudio({
    project,
    profileId: "hero",
    animationId: "idle",
    animationType: "actor",
    outputPath: "workspace/lite/projects/demo_project/assets/hero/idle/sheet.png",
    jsonPath: path.join(exportedAnimationDirectory, "spritesheet.json"),
    liteStore,
    root: liteStoreTestRoot,
    source: {
      audio: {
        files: [{ id: "audio_1", name: "hit.wav", file: "../audio/hit.wav", type: "audio/wav" }],
        events: [{ outputFrame: 2, outputFrameIndex: 1, timeMs: 80, assetId: "audio_1", file: "../audio/hit.wav" }],
      },
    },
  });
  assert.equal(importedAudioCount, 1);
  const importedAudio = liteStore.readJson(paths.frameAudio, []);
  assert.equal(importedAudio.length, 1);
  assert.equal(importedAudio[0].frame, 1);
  assert.equal(importedAudio[0].animation, "hero/idle");
  assert.equal(importedAudio[0].type, "audio/wav");
  assert.equal(importedAudio[0].path.startsWith("workspace/lite/projects/demo_project/audio/"), true);
  assert.equal(fs.readFileSync(path.join(liteStoreTestRoot, ...importedAudio[0].path.split("/"))).subarray(0, 4).toString("ascii"), "RIFF");
} finally {
  const resolvedLiteStoreTestRoot = path.resolve(liteStoreTestRoot);
  const resolvedSystemTemp = path.resolve(os.tmpdir());
  assert.equal(resolvedLiteStoreTestRoot.startsWith(`${resolvedSystemTemp}${path.sep}`), true);
  fs.rmSync(resolvedLiteStoreTestRoot, { recursive: true, force: true });
}

assert.equal(projectEngine({ kind: "godot" }), "godot");
assert.equal(projectEngine({ kind: "unity" }), "unity");
assert.equal(projectEngine({ kind: "frame_lite" }), "lite");
const sharedRegistry = {
  projects: [
    { id: "huanchao_boss_rush", kind: "godot", dataDir: "data/projects/huanchao_boss_rush" },
    { id: "huanchao_boss_rush_unity", kind: "unity", dataDir: "data/projects/huanchao_boss_rush" },
  ],
};
assert.deepEqual(bindingScopeForProject(sharedRegistry, sharedRegistry.projects[1]), {
  bindingProjectId: "huanchao_boss_rush",
  dataProjectIds: ["huanchao_boss_rush", "huanchao_boss_rush_unity"],
});
const isolatedRegistry = {
  projects: [
    { id: "huanchao_boss_rush", kind: "godot", dataDir: "data/projects/huanchao_boss_rush" },
    { id: "huanchao_boss_rush_unity", kind: "unity", dataDir: "data/projects/huanchao_boss_rush_unity" },
  ],
};
assert.deepEqual(bindingScopeForProject(isolatedRegistry, isolatedRegistry.projects[1]), {
  bindingProjectId: "huanchao_boss_rush_unity",
  dataProjectIds: ["huanchao_boss_rush_unity"],
});
const switchedConfig = {
  activeProjectId: "huanchao_boss_rush_unity",
  bindingProjectId: "huanchao_boss_rush",
  dataProjectIds: ["huanchao_boss_rush", "huanchao_boss_rush_unity"],
};
const sharedAudioBindings = [
  ["attack1", 6],
  ["attack2", 2],
  ["attack3", 2],
  ["attack3", 9],
].map(([animation, frame]) => ({
  key: `soul/${animation}:${frame}`,
  projectId: "huanchao_boss_rush",
  tuningTarget: "player",
  profileId: "soul",
  groupType: "actor",
  animation,
  source: `workspace/projects/huanchao_boss_rush/assets/soul/${animation}`,
  frame,
}));
assert.equal(sharedAudioBindings.filter((entry) => bindingScope.containsProjectId(switchedConfig, entry.projectId)).length, 4);
assert.equal(new Set(sharedAudioBindings.map((entry) => bindingScope.bindingKey(switchedConfig, entry.key, entry))).size, 4);
assert.equal(sharedAudioBindings.every((entry) => bindingScope.bindingKey(switchedConfig, entry.key, entry).startsWith("huanchao_boss_rush:")), true);

const godotSyncTestRoot = fs.mkdtempSync(path.join(os.tmpdir(), "xsxb-godot-sync-test-"));
try {
  const godotRoot = path.join(godotSyncTestRoot, "game");
  fs.mkdirSync(godotRoot, { recursive: true });
  fs.writeFileSync(path.join(godotRoot, "project.godot"), "[application]\nconfig/name=\"XSXB sync fixture\"\n", "utf8");
  const texturePaths = ["body", "streaks", "breakup", "core"].map((name, index) => {
    const texturePath = path.join(godotSyncTestRoot, `${name}.png`);
    fs.writeFileSync(texturePath, tinyPng(6, [255 - index * 20, 25 + index * 30, 40 + index * 15, 255]));
    return texturePath;
  });
  const store = createProjectStore(godotSyncTestRoot);
  store.addProject({ id: "godot_demo", label: "Godot Demo", kind: "godot", projectRoot: godotRoot });
  const project = store.activeProject("godot_demo");
  const paths = store.projectPaths(project);
  store.writeJson(paths.manifest, { schemaVersion: 1, profiles: [] });
  store.writeJson(paths.attackTrails, { schemaVersion: 19, bindings: { "hero/attack": [{
    id: "trail",
    profileId: "hero",
    animationId: "attack",
    texture: { path: texturePaths[0], name: "body.png", width: 1, height: 1 },
    materialLayers: {
      streaks: { enabled: true, texture: { path: texturePaths[1], name: "streaks.png", width: 1, height: 1 }, color: "#ff3355", strength: 0.4, blendMode: "screen" },
      breakup: { enabled: true, texture: { path: texturePaths[2], name: "breakup.png", width: 1, height: 1 }, strength: 0.6 },
      core: { enabled: true, texture: { path: texturePaths[3], name: "core.png", width: 1, height: 1 }, color: "#fff0f5", strength: 1.1, blendMode: "add" },
    },
    glowColor: "#ff0066",
    glowStrength: 0.8,
    glowRadius: 12,
    frameSlices: { 0: { enabled: true, tailProgress: 0, headProgress: 1 } },
    sticks: [
      { id: "s1", frame: 0, top: { x: 0, y: -4 }, bottom: { x: 0, y: 4 } },
      { id: "s2", frame: 0, top: { x: 8, y: -4 }, bottom: { x: 8, y: 4 } },
    ],
  }] } });
  const result = syncGodotProject(path.resolve(__dirname, ".."), store, project);
  assert.equal(result.ok, true);
  assert.equal(result.attackTrailCount, 1);
  assert.equal(result.copiedAttackTrailTextures, 5);
  assert.deepEqual(result.attackTrailTextureErrors, []);
  const syncedTrailsPath = path.join(godotRoot, "xsxb_frame_tuner", "data", "projects", "godot_demo", "attack_trails.json");
  const syncedTrails = JSON.parse(fs.readFileSync(syncedTrailsPath, "utf8"));
  const syncedSegment = syncedTrails.bindings["hero/attack"][0];
  const syncedTextures = [
    syncedSegment.texture,
    syncedSegment.materialLayers.streaks.texture,
    syncedSegment.materialLayers.breakup.texture,
    syncedSegment.materialLayers.core.texture,
  ];
  assert.equal(syncedTrails.presets.length, 0);
  assert.equal(syncedTextures.every((texture) => texture.path.startsWith("res://xsxb_frame_tuner/attack_trails/projects/godot_demo/")), true);
  assert.equal(syncedTextures.every((texture) => fs.existsSync(path.join(godotRoot, texture.path.slice("res://".length)))), true);
  assert.equal(JSON.stringify(syncedTrails).includes("tools/animation_tuner"), false);
  const syncedShader = fs.readFileSync(path.join(godotRoot, "xsxb_frame_tuner", "runtime", "xsxb_attack_trail.gdshader"), "utf8");
  assert.match(syncedShader, /uniform sampler2D breakup_texture/);
  assert.match(syncedShader, /uniform vec4 glow_color/);
  const brokenTrails = store.readJson(paths.attackTrails, {});
  brokenTrails.bindings["hero/attack"][0].materialLayers.core.texture.path = path.join(godotSyncTestRoot, "missing-core.png");
  const brokenResult = syncGodotProject(path.resolve(__dirname, ".."), store, project, { attackTrails: brokenTrails });
  assert.equal(brokenResult.ok, false);
  assert.match(brokenResult.reason, /hero\/attack\/trail core/);
} finally {
  fs.rmSync(godotSyncTestRoot, { recursive: true, force: true });
}

const unitySyncTestRoot = fs.mkdtempSync(path.join(os.tmpdir(), "xsxb-unity-sync-test-"));
try {
  const unityRoot = path.join(unitySyncTestRoot, "game");
  fs.mkdirSync(path.join(unityRoot, "Assets"), { recursive: true });
  fs.mkdirSync(path.join(unityRoot, "ProjectSettings"), { recursive: true });
  fs.writeFileSync(path.join(unityRoot, "ProjectSettings", "ProjectVersion.txt"), "m_EditorVersion: 6000.3.20f1\n", "utf8");
  fs.mkdirSync(path.join(unityRoot, "Assets", "_Project", "Scenes", "Production", "Act1"), { recursive: true });
  fs.mkdirSync(path.join(unityRoot, "Assets", "_Project", "Scenes", "Runtime", "Act1"), { recursive: true });
  fs.mkdirSync(path.join(unityRoot, "Assets", "_Project", "Scenes", "Development"), { recursive: true });
  fs.writeFileSync(path.join(unityRoot, "Assets", "_Project", "Scenes", "Production", "Act1", "Arena.unity"), "production\n", "utf8");
  fs.writeFileSync(path.join(unityRoot, "Assets", "_Project", "Scenes", "Runtime", "Act1", "Arena.unity"), "runtime\n", "utf8");
  fs.writeFileSync(path.join(unityRoot, "Assets", "_Project", "Scenes", "Development", "Probe.unity"), "development\n", "utf8");
  fs.writeFileSync(path.join(unityRoot, "ProjectSettings", "EditorBuildSettings.asset"), [
    "EditorBuildSettings:",
    "  m_Scenes:",
    "  - enabled: 1",
    "    path: Assets/_Project/Scenes/Runtime/Act1/Arena.unity",
    "  - enabled: 0",
    "    path: Assets/_Project/Scenes/Development/Probe.unity",
    "",
  ].join("\n"), "utf8");
  const unityScenes = listUnitySceneFiles(unityRoot, [{ id: "hero" }]);
  assert.deepEqual(unityScenes.map((scene) => scene.id), ["Assets/_Project/Scenes/Production/Act1/Arena.unity"]);
  assert.deepEqual(unityScenes[0].profileIds, ["hero"]);
  const framePath = path.join(unitySyncTestRoot, "frame.png");
  fs.writeFileSync(framePath, tinyPng(6, [255, 255, 255, 255]));
  const store = createProjectStore(unitySyncTestRoot);
  store.addProject({ id: "unity_demo", label: "Unity Demo", kind: "unity", projectRoot: unityRoot });
  const project = store.activeProject("unity_demo");
  assert.equal(project.kind, "unity");
  assert.equal(store.projectForClient(project).engine, "unity");
  const paths = store.projectPaths(project);
  store.writeJson(paths.manifest, { schemaVersion: 1, profiles: [{
    id: "hero", label: "Hero", kind: "actor", bodyScale: 0.5, runtimeScale: 2, source_faces_left: true,
    animations: [
      { id: "attack", fps: 10, anchorMode: "canvas_bottom_center", frames: [
        { id: "f1", name: "f1.png", path: framePath, duration: 1, width: 1, height: 1 },
        { id: "f2", name: "f2.png", path: framePath, duration: 1, width: 1, height: 1 },
      ] },
      { id: "idle", fps: 8, anchorMode: "canvas_bottom_center", frames: [
        { id: "idle1", name: "idle1.png", path: framePath, duration: 1, width: 1, height: 1 },
      ] },
    ],
  }] });
  store.writeJson(paths.tuning, {
    schemaVersion: 1,
    values: {
      "profiles.hero.character.visual_size": 0.75,
      "profiles.hero.groups.attack.visual_size": 1.2,
      "profiles.hero.groups.attack.offset": { x: 4, y: -3 },
    },
    scene_settings: {},
    frame_visual_overrides: { "hero/attack:0": { visual_size: 1.5, offset: { x: 8, y: 2 }, rotation: 15 } },
    frame_playback_overrides: { "hero/attack:__group": { fps: 20 }, "hero/attack:0": { duration: 2 }, "hero/attack:1": { disabled: true } },
    frame_box_overrides: { "hero/attack:0": { hitbox: { enabled: true, offset: { x: 2, y: 3 }, size: { x: 8, y: 4 }, rotation: 5 } } },
  });
  store.writeJson(paths.frameAudio, [{ profileId: "hero", animation: "attack", frame: 0, name: "hit.wav", type: "audio/wav", data: `data:audio/wav;base64,${Buffer.from("RIFFtest").toString("base64")}` }]);
  store.writeJson(paths.frameImageAttachments, [{
    profileId: "hero",
    animation: "attack",
    frame: 0,
    name: "flash.png",
    path: framePath,
    layer: "below",
    layerOrder: -2,
    transform: {
      offset: { x: 7, y: -9 },
      visual_scale: { x: 1.25, y: 0.75 },
      rotation: 12,
    },
  }]);
  store.writeJson(paths.attackTrails, { schemaVersion: 9, bindings: { "hero/attack": [{
    id: "trail", profileId: "hero", animationId: "attack", enabled: true,
    texture: { path: framePath, name: "trail.png", hasEffectiveAlpha: true },
    frameSlices: { 0: { enabled: true, tailProgress: 0.2, headProgress: 0.85 } },
    sticks: [{ id: "s1", order: 0, frame: 0, framePhase: 0.5, top: { x: 0, y: -4 }, bottom: { x: 0, y: 4 }, layer: "front" }],
  }] } });
  const result = syncUnityProject(unitySyncTestRoot, store, project, { bakedFrames: [{
    profileId: "hero",
    animationId: "attack",
    frameIndex: 0,
    data: `data:image/png;base64,${fs.readFileSync(framePath).toString("base64")}`,
    width: 48,
    height: 64,
    bakedPixelScale: 8,
    offset: { x: 2, y: 3 },
    mainAnchor: { x: 10, y: 12 },
  }] });
  assert.equal(result.engine, "unity");
  assert.equal(result.frameCount, 3);
  assert.equal(result.checkedFrames, 3);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(validateUnitySync(unityRoot, "unity_demo"), []);
  assert.equal(result.writes.syncSignal, true);
  const syncSignalPath = path.join(unityRoot, "Assets", "XSXBFrameTuner", "RuntimeData", "unity_demo", "xsxb_sync_signal.json");
  const firstSyncSignal = JSON.parse(fs.readFileSync(syncSignalPath, "utf8"));
  const secondSyncResult = syncUnityProject(unitySyncTestRoot, store, project);
  const secondSyncSignal = JSON.parse(fs.readFileSync(syncSignalPath, "utf8"));
  assert.equal(secondSyncResult.writes.syncSignal, true);
  assert.notEqual(secondSyncSignal.nonce, firstSyncSignal.nonce);
  const runtimePath = path.join(unityRoot, "Assets", "XSXBFrameTuner", "RuntimeData", "unity_demo", "xsxb_runtime_data.json");
  const runtime = JSON.parse(fs.readFileSync(runtimePath, "utf8"));
  assert.equal(runtime.authoritySchema, "xsxb-frame-tuner-v1");
  assert.equal(runtime.profiles[0].animations[0].durationMs, 100);
  assert.equal(runtime.profiles[0].animations[0].frames[0].durationMs, 100);
  assert.equal(runtime.profiles[0].animations[0].frames[1].disabled, true);
  assert.equal(runtime.profiles[0].animations[0].frames[0].bakedPixelScale, 8);
  assert.equal(runtime.profiles[0].animations[0].frames[1].bakedPixelScale, 1);
  assert.equal(runtime.profiles[0].characterTransform.uniformScale, 0.75);
  assert.deepEqual(runtime.profiles[0].animations[0].frames[0].transform.scale, { x: 1.5, y: 1.5 });
  assert.equal(runtime.profiles[0].animations[0].frames[0].transform.uniformScale, 1.5);
  assert.deepEqual(runtime.profiles[0].animations[0].frames[0].attachments[0].offset, { x: 7, y: -9 });
  assert.deepEqual(runtime.profiles[0].animations[0].frames[0].attachments[0].scale, { x: 1.25, y: 0.75 });
  assert.equal(runtime.profiles[0].animations[0].frames[0].attachments[0].rotation, 12);
  assert.equal(runtime.profiles[0].animations[0].frames[0].attachments[0].layerOrder, -2);
  assert.match(runtime.profiles[0].animations[0].frames[0].assetPath, /^Assets\/XSXBFrameTuner\/BakedFrames\//);
  assert.match(runtime.profiles[0].animations[0].frames[0].assetPath, /\.png$/);
  assert.match(runtime.profiles[0].animations[0].frames[0].sourceAssetPath, /^Assets\/XSXBFrameTuner\/Frames\//);
  assert.match(runtime.profiles[0].animations[0].frames[0].audio[0].assetPath, /^Assets\/XSXBFrameTuner\/Audio\//);
  assert.match(runtime.profiles[0].animations[0].attackTrails[0].texture.assetPath, /^Assets\/XSXBFrameTuner\/AttackTrails\//);
  assert.equal(runtime.profiles[0].animations[0].attackTrails[0].sticks[0].headFrame, true);
  assert.deepEqual(runtime.profiles[0].animations[0].attackTrails[0].frameSlices, [{
    frame: 0,
    enabled: true,
    tailProgress: 0.2,
    headProgress: 0.85,
  }]);
  const playerSource = fs.readFileSync(path.join(unityRoot, "Assets", "XSXBFrameTuner", "Runtime", "XsxbFramePlayer.cs"), "utf8");
  assert.match(playerSource, /if \(!restart && _animation != null && _animation\.id == nextAnimationId && _playing\)/);
  assert.match(playerSource, /IXsxbAttackTrailConsumer/);
  assert.match(playerSource, /CurrentAnimationTimeSeconds/);
  assert.match(playerSource, /TryGetAttachmentLocalPosition/);
  assert.match(playerSource, /GetAnimationDurationSeconds/);
  assert.match(playerSource, /public bool HotReloadDatabase\(\)/);
  assert.match(playerSource, /ApplyFrame\(false\)/);
  assert.match(playerSource, /XSXB_HOT_RELOAD_APPLIED/);
  assert.match(playerSource, /EnsureAudioListener\(\)/);
  assert.match(playerSource, /_visualRoot = transform\.Find\("XSXB Visual Root"\)/);
  assert.match(playerSource, /EnsureBox\("XSXB Hurtbox"/);
  assert.match(playerSource, /ApplyGroundedCollisionBox/);
  assert.match(playerSource, /CharacterUniformScale/);
  assert.match(playerSource, /frame\.bakedPixelScale > 0f \? frame\.bakedPixelScale : 1f/);
  assert.match(playerSource, /sceneScale\.x \* bakedMirror \/ bakedPixelScale/);
  assert.match(playerSource, /child\.SetParent\(transform, false\)/);
  assert.match(playerSource, /if \(collider == null\) collider = child\.gameObject\.AddComponent<BoxCollider2D>\(\)/);
  assert.match(playerSource, /if \(collider == null\) return;/);
  assert.match(playerSource, /FindFirstObjectByType<AudioListener>/);
  assert.match(playerSource, /AddComponent<AudioListener>/);
  const runtimeDatabaseSource = fs.readFileSync(path.join(unityRoot, "Assets", "XSXBFrameTuner", "Runtime", "XsxbRuntimeDatabase.cs"), "utf8");
  assert.match(runtimeDatabaseSource, /public bool headFrame;/);
  assert.match(runtimeDatabaseSource, /public string headFrameMode;/);
  assert.match(runtimeDatabaseSource, /public float bakedPixelScale;/);
  assert.equal(fs.existsSync(path.join(unityRoot, "Assets", "XSXBFrameTuner", "Runtime", "XsxbRuntimeData.cs")), false);
  const unityImporterSource = fs.readFileSync(path.join(unityRoot, "Assets", "XSXBFrameTuner", "Runtime", "Editor", "XsxbRuntimeImporter.cs"), "utf8");
  assert.match(unityImporterSource, /\[InitializeOnLoadMethod\]/);
  assert.match(unityImporterSource, /public override uint GetVersion\(\)[\s\S]*?return 1;/);
  assert.match(unityImporterSource, /private static void ScheduleRebuild\(\)/);
  assert.match(unityImporterSource, /item\.Contains\("\/Frames\/"\)/);
  assert.match(unityImporterSource, /importer\.maxTextureSize = 8192;/);
  assert.match(unityImporterSource, /TextureImporterCompression\.Uncompressed/);
  assert.doesNotMatch(unityImporterSource, /AssetDatabase\.Refresh\(ImportAssetOptions\.ForceSynchronousImport\)/);
  assert.match(unityImporterSource, /FindObjectsByType<XsxbFramePlayer>/);
  assert.match(unityImporterSource, /ResolveDatabaseForProfile/);
  assert.match(unityImporterSource, /XSXB_RUNTIME_DATABASE_REBOUND/);
  assert.match(unityImporterSource, /XSXB_RUNTIME_REBUILD_OK/);
  assert.match(unityImporterSource, /player\.HotReloadDatabase\(\)/);
  assert.match(unityImporterSource, /referencePaths\.Contains\(audioPath\)/);
  assert.match(unityImporterSource, /references are maintained by the Frame Tuner sync/);
  assert.match(unityImporterSource, /audioClips=/);
  assert.match(unityImporterSource, /EditorApplication\.update \+= PollSyncSignals/);
  assert.match(unityImporterSource, /xsxb_sync_signal\.json/);
  assert.match(unityImporterSource, /nextSignalPollAt = EditorApplication\.timeSinceStartup \+ 0\.75d/);
  assert.match(unityImporterSource, /EditorApplication\.isCompiling \|\| EditorApplication\.isUpdating/);
  const incrementalSyncResult = syncUnityProject(unitySyncTestRoot, store, project, {
    changedGroups: ["hero/idle"],
    bakedFrames: [],
  });
  assert.equal(incrementalSyncResult.checkedFrames, 1);
  assert.equal(incrementalSyncResult.bakedFrameCount, 1);
  assert.equal(incrementalSyncResult.processedBakedFrames, 0);
  assert.deepEqual(JSON.parse(fs.readFileSync(syncSignalPath, "utf8")).changedGroups, ["hero/idle"]);
  const removeBakedAttackResult = syncUnityProject(unitySyncTestRoot, store, project, {
    changedGroups: ["hero/attack"],
    bakedFrames: [],
  });
  assert.equal(removeBakedAttackResult.checkedFrames, 2);
  assert.equal(removeBakedAttackResult.bakedFrameCount, 0);
  assert.equal(removeBakedAttackResult.processedBakedFrames, 0);
  assert.equal(removeBakedAttackResult.removedStaleBakedFrames, 1);
  const directRuntime = buildRuntimeData({ projectId: "unity_demo", manifest: store.readJson(paths.manifest, {}), tuning: store.readJson(paths.tuning, {}) });
  assert.equal(directRuntime.profiles[0].sourceFacesLeft, true);
} finally {
  fs.rmSync(unitySyncTestRoot, { recursive: true, force: true });
}

console.log("XSXB self-tests passed.");
