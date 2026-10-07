const fs = require("node:fs");
const path = require("node:path");
const { normalizeAttackTrails } = require("./attack_trails");

const SHARED_ATTACK_TRAIL_PRESET_SCHEMA_VERSION = 1;
const SHARED_PRESET_STYLE_KEYS = [
  "texture", "invertTexture", "colorMode", "color", "gradientStops", "materialLayers",
  "bodyOpacityFloor", "bodyDetailStrength", "bodyWhiteThreshold",
  "coreEdge", "glowColor", "glowStrength", "glowRadius", "headLightBoost", "headWhitePreserve", "headWhiteLength",
  "widthMode", "fixedWidth", "widthScale", "widthOffset", "widthChaseStrength", "pathScaleX", "pathScaleY",
  "tailSamples", "pathColumns", "tailFadeStart", "headCurvature",
];

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function sharedAttackTrailPresetPath(root) {
  return path.join(root, "data", "attack_trail_presets.json");
}

function normalizeSharedAttackTrailPresetStore(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  const normalized = normalizeAttackTrails({
    presets: Array.isArray(source.presets) ? source.presets : [],
    bindings: {},
  });
  const presets = normalized.presets.map((preset) => {
    const result = {
      id: preset.id,
      name: preset.name,
      generated: false,
      presetOnly: true,
    };
    for (const key of SHARED_PRESET_STYLE_KEYS) result[key] = clone(preset[key]);
    return result;
  });
  return {
    schemaVersion: SHARED_ATTACK_TRAIL_PRESET_SCHEMA_VERSION,
    presets,
    migratedProjectIds: [...new Set(
      (Array.isArray(source.migratedProjectIds) ? source.migratedProjectIds : [])
        .map((value) => String(value || "").trim())
        .filter(Boolean),
    )],
  };
}

function readSharedAttackTrailPresetStore(root) {
  const filePath = sharedAttackTrailPresetPath(root);
  if (!fs.existsSync(filePath)) return normalizeSharedAttackTrailPresetStore({});
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, ""));
    if (!raw || typeof raw !== "object" || Array.isArray(raw) || !Array.isArray(raw.presets)
      || (raw.schemaVersion !== undefined && raw.schemaVersion !== SHARED_ATTACK_TRAIL_PRESET_SCHEMA_VERSION)
      || (raw.migratedProjectIds !== undefined && !Array.isArray(raw.migratedProjectIds))
      || raw.presets.some((preset) => !preset || typeof preset !== "object" || Array.isArray(preset))) {
      throw new Error("Invalid shared attack trail preset structure or schema version.");
    }
    return normalizeSharedAttackTrailPresetStore(raw);
  } catch (cause) {
    const error = new Error(`Cannot read shared attack trail presets; the original file was preserved: ${filePath}. ${cause.message}`);
    error.code = "invalid_project_json";
    error.cause = cause;
    throw error;
  }
}

function writeSharedAttackTrailPresetStore(root, value) {
  const filePath = sharedAttackTrailPresetPath(root);
  const normalized = normalizeSharedAttackTrailPresetStore(value);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
  fs.renameSync(tempPath, filePath);
  return normalized;
}

function mergePresets(existing, incoming) {
  const merged = [];
  const ids = new Set();
  for (const preset of [...(existing || []), ...(incoming || [])]) {
    const id = String(preset?.id || "");
    if (!id || ids.has(id)) continue;
    ids.add(id);
    merged.push(clone(preset));
  }
  return merged;
}

function attackTrailsWithSharedPresets(root, projectId, input) {
  const trails = normalizeAttackTrails(input);
  let store = readSharedAttackTrailPresetStore(root);
  const id = String(projectId || "").trim();
  if (id && !store.migratedProjectIds.includes(id)) {
    store.presets = mergePresets(store.presets, trails.presets);
    store.migratedProjectIds.push(id);
    store = writeSharedAttackTrailPresetStore(root, store);
  }
  trails.presets = clone(store.presets);
  return trails;
}

function saveSharedAttackTrailPresets(root, projectId, presets) {
  const normalized = normalizeAttackTrails({ presets, bindings: {} });
  const store = readSharedAttackTrailPresetStore(root);
  const id = String(projectId || "").trim();
  store.presets = normalized.presets;
  if (id && !store.migratedProjectIds.includes(id)) store.migratedProjectIds.push(id);
  return writeSharedAttackTrailPresetStore(root, store).presets;
}

function attackTrailsWithoutSharedPresets(input) {
  const trails = normalizeAttackTrails(input);
  trails.presets = [];
  return trails;
}

module.exports = {
  attackTrailsWithSharedPresets,
  attackTrailsWithoutSharedPresets,
  normalizeSharedAttackTrailPresetStore,
  readSharedAttackTrailPresetStore,
  saveSharedAttackTrailPresets,
  sharedAttackTrailPresetPath,
  writeSharedAttackTrailPresetStore,
};
