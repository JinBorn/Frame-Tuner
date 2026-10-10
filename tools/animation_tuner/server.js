const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");
const { EMPTY_MANIFEST, EMPTY_TUNING, bindingScopeForProject, createProjectStore, projectEngine, reslash } = require("../project_store");
const { syncFrameAudio, syncGodotProject } = require("../godot_sync");
const { listUnitySceneFiles, syncUnityProject, validUnityProjectRoot, validateUnitySync } = require("../unity_sync");
const {
  EMPTY_ATTACK_TRAILS,
  normalizeAttackTrails,
  pngInfo,
  saveAttackTrailTexture,
  validateAttackTrails,
} = require("../attack_trails");
const {
  attackTrailsWithSharedPresets,
  attackTrailsWithoutSharedPresets,
  saveSharedAttackTrailPresets,
  sharedAttackTrailPresetPath,
} = require("../attack_trail_presets");
const { profileIdsForSceneText } = require("../scene_profiles");
const { checkForUpdates, performUpdate } = require("../updater");
const { withUtf8Charset } = require("../http_content_type");
const { assertLocalRequest, readRequestBody: readBody, attachmentDisposition } = require("../http_security");
const { frameBoxCoverageIssues } = require("../box_estimator");
const { createLiteApp } = require("../frame_tuner_lite/server");
const { createWorkbenchService, resolveWorkbenchAsset, pngBuffer, commitImportFiles } = require("../workbench_service");
const { adapterForProject, capabilities } = require("../engine_adapters");

const ROOT = path.resolve(process.env.FRAME_TUNER_ROOT || path.join(__dirname, "..", ".."));
const PUBLIC = path.join(__dirname, "public");
const PORT = Number(process.env.PORT || 5179);
const projectStore = createProjectStore(ROOT);
function availableRegistry() {
  const registry = projectStore.readRegistry();
  registry.projects = registry.projects.filter((entry) => projectEngine(entry) !== "unsupported");
  if (!registry.projects.some((entry) => entry.id === registry.activeProjectId)) registry.activeProjectId = registry.projects[0]?.id || "";
  return registry;
}
const neutralStore = {
  ...projectStore,
  paths: projectStore.projectPaths,
  readRegistry: availableRegistry,
  resolveProject: (id) => {
    const registry = availableRegistry();
    return registry.projects.find((entry) => entry.id === String(id || registry.activeProjectId)) || null;
  },
};
const neutralApp = createLiteApp({ root: ROOT, store: neutralStore });
const workbench = createWorkbenchService({ root: ROOT, store: neutralStore });
const UPDATE_TOKEN = crypto.randomBytes(24).toString("hex");
let restartScheduled = false;

const DEFAULT_SUPPORTS = [
  "character_transform",
  "group_transform",
  "frame_transform",
  "frame_playback",
  "frame_boxes",
  "reference_frame",
];
const GDSCRIPT_SCAN_LIMIT = 250;
const GDSCRIPT_SKIP_DIRS = new Set([
  ".git",
  ".godot",
  "addons",
  "node_modules",
  "_external_vfx",
]);
const SCENE_SKIP_DIRS = new Set([
  ...GDSCRIPT_SKIP_DIRS,
  ".import",
]);

function send(res, status, body, contentType = "application/json") {
  const data = Buffer.isBuffer(body)
    ? body
    : /^application\/json(?:\s*;|$)/i.test(contentType)
      ? Buffer.from(JSON.stringify(body, null, 2))
      : Buffer.from(String(body));
  res.writeHead(status, {
    "content-type": withUtf8Charset(contentType),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  res.end(data);
}


function safeResolve(base, requested) {
  const full = path.resolve(base, String(requested || ""));
  return full === base || full.startsWith(`${base}${path.sep}`) ? full : null;
}

function isInside(childPath, parentPath) {
  const relative = path.relative(parentPath, childPath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function round(value) {
  return Number(value || 0).toFixed(4).replace(/\.?0+$/, "");
}

function vector(value, fallback = { x: 0, y: 0 }) {
  if (!value || typeof value !== "object") return { ...fallback };
  return {
    x: Number(value.x ?? fallback.x ?? 0),
    y: Number(value.y ?? fallback.y ?? 0),
  };
}

function scaleVector(value, fallbackScale = 1) {
  if (!value || typeof value !== "object") {
    return { x: Number(fallbackScale || 1), y: Number(fallbackScale || 1) };
  }
  return {
    x: Number(value.x ?? fallbackScale ?? 1),
    y: Number(value.y ?? fallbackScale ?? 1),
  };
}

function getPngSize(filePath) {
  try {
    const buffer = fs.readFileSync(filePath);
    if (buffer.length < 24 || buffer.toString("ascii", 1, 4) !== "PNG") {
      return { width: 0, height: 0 };
    }
    return {
      width: buffer.readUInt32BE(16),
      height: buffer.readUInt32BE(20),
    };
  } catch {
    return { width: 0, height: 0 };
  }
}

function sanitizeSegment(value, fallback = "asset") {
  const text = String(value || fallback)
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
    .replace(/\s+/g, "_")
    .replace(/\.\./g, "_")
    .replace(/^_+|_+$/g, "");
  return text && !/^\.+$/.test(text) ? text : fallback;
}

function decodeDataUrl(dataUrl) {
  const match = /^data:([^;,]+)?(;base64)?,([\s\S]*)$/i.exec(String(dataUrl || ""));
  if (!match) return null;
  return {
    mime: String(match[1] || "").toLowerCase(),
    buffer: match[2] ? Buffer.from(match[3], "base64") : Buffer.from(decodeURIComponent(match[3] || ""), "utf8"),
  };
}

function contentHash(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function attachmentImageSourcePath(project, attachment) {
  const raw = String(attachment?.path || "");
  if (!raw) return "";
  if (path.isAbsolute(raw)) return fs.existsSync(raw) ? raw : "";
  if (raw.startsWith("res://")) {
    const projectRoot = project?.projectRoot ? path.resolve(String(project.projectRoot)) : "";
    const fullPath = projectRoot ? path.join(projectRoot, raw.slice("res://".length)) : "";
    return fullPath && fs.existsSync(fullPath) ? fullPath : "";
  }
  const fullPath = safeResolve(ROOT, raw);
  return fullPath && fs.existsSync(fullPath) ? fullPath : "";
}

function withFrameAttachmentHash(project, attachment) {
  const next = { ...attachment };
  if (!next.assetHash) {
    const source = attachmentImageSourcePath(project, next);
    if (source) next.assetHash = contentHash(fs.readFileSync(source));
  }
  return next;
}

function imageExtensionFromMime(mime, name) {
  const ext = path.extname(String(name || "")).toLowerCase();
  if ([".png", ".jpg", ".jpeg", ".webp", ".gif"].includes(ext)) return ext;
  if (mime === "image/png") return ".png";
  if (mime === "image/jpeg" || mime === "image/jpg") return ".jpg";
  if (mime === "image/webp") return ".webp";
  if (mime === "image/gif") return ".gif";
  return "";
}

function normalizeManifest(raw) {
  const profiles = Array.isArray(raw?.profiles) ? raw.profiles : [];
  return {
    schemaVersion: Number(raw?.schemaVersion || 1),
    profiles: profiles.map((profile) => ({
      id: String(profile.id || profile.name || "profile"),
      label: String(profile.label || profile.id || profile.name || "Profile"),
      kind: String(profile.kind || "actor"),
      sourceFacesLeft: profile.source_faces_left === true || profile.sourceFacesLeft === true,
      bodyScale: Math.max(0.001, Number(profile.bodyScale ?? 1)),
      runtimeScale: Math.max(0.001, Number(profile.runtimeScale ?? 1)),
      supports: Array.isArray(profile.supports) ? profile.supports : DEFAULT_SUPPORTS,
      animations: Array.isArray(profile.animations) ? profile.animations : [],
    })),
  };
}

function projectFromRequest(projectId, options = {}) {
  let registry = availableRegistry();
  const requestedId = projectId ? projectStore.slug(projectId) : "";
  if (requestedId && !registry.projects.some((entry) => entry.id === requestedId)) {
    const error = new Error(`Project not found or unsupported: ${requestedId}`);
    error.status = 404; error.code = "project_not_found"; throw error;
  }
  if (options.activate && requestedId && registry.projects.some((entry) => entry.id === requestedId) && registry.activeProjectId !== requestedId) {
    registry.activeProjectId = requestedId;
    projectStore.setActiveProject(requestedId);
    registry = availableRegistry();
  }
  return {
    registry,
    project: projectStore.resolveProject(registry, projectId),
  };
}

function readManifest(project) {
  projectStore.ensureProjectFiles(project);
  const paths = projectStore.projectPaths(project);
  return normalizeManifest(projectStore.readJson(paths.manifest, EMPTY_MANIFEST));
}

function readTuningFile(project) {
  projectStore.ensureProjectFiles(project);
  const paths = projectStore.projectPaths(project);
  const raw = projectStore.readJson(paths.tuning, EMPTY_TUNING);
  return {
    schemaVersion: Number(raw.schemaVersion || 1),
    values: raw.values && typeof raw.values === "object" ? raw.values : {},
    scene_settings: raw.scene_settings && typeof raw.scene_settings === "object" ? raw.scene_settings : {},
    frame_visual_overrides: raw.frame_visual_overrides && typeof raw.frame_visual_overrides === "object" ? raw.frame_visual_overrides : {},
    frame_playback_overrides: raw.frame_playback_overrides && typeof raw.frame_playback_overrides === "object" ? raw.frame_playback_overrides : {},
    frame_box_overrides: raw.frame_box_overrides && typeof raw.frame_box_overrides === "object" ? raw.frame_box_overrides : {},
  };
}

function readFrameAudioBindings(project) {
  projectStore.ensureProjectFiles(project);
  const raw = projectStore.readJson(projectStore.projectPaths(project).frameAudio, []);
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === "object") {
    return Object.entries(raw).map(([key, value]) => ({
      key,
      ...(value && typeof value === "object" ? value : {}),
    }));
  }
  return [];
}

function readAttackTrails(project) {
  projectStore.ensureProjectFiles(project);
  const local = normalizeAttackTrails(projectStore.readJson(projectStore.projectPaths(project).attackTrails, EMPTY_ATTACK_TRAILS));
  return attackTrailsWithSharedPresets(ROOT, project.id, local);
}

function readFrameImageAttachments(project) {
  projectStore.ensureProjectFiles(project);
  const raw = projectStore.readJson(projectStore.projectPaths(project).frameImageAttachments, []);
  return Array.isArray(raw)
    ? raw.filter((entry) => entry && typeof entry === "object").map((entry) => withFrameAttachmentHash(project, entry))
    : [];
}

function tuningForClient(tuningFile) {
  return {
    ...tuningFile.values,
    values: tuningFile.values,
    scene_settings: tuningFile.scene_settings,
    frame_visual_overrides: tuningFile.frame_visual_overrides,
    frame_playback_overrides: tuningFile.frame_playback_overrides,
    frame_box_overrides: tuningFile.frame_box_overrides,
  };
}

function profileForClient(profile) {
  return {
    id: profile.id,
    label: profile.label,
    kind: profile.kind,
    sourceFacesLeft: profile.sourceFacesLeft === true,
    scale_semantic: "character_group_frame",
    anchor_mode: "manifest_anchor_mode",
    supports: profile.supports,
  };
}

function frameForClient(frame, index) {
  const relPath = reslash(frame.path || "");
  const fullPath = safeResolve(ROOT, relPath);
  const size = fullPath && fs.existsSync(fullPath) ? getPngSize(fullPath) : {};
  return {
    id: String(frame.id || `frame_${String(index + 1).padStart(4, "0")}`),
    name: String(frame.name || path.basename(relPath) || `frame_${index + 1}.png`),
    path: relPath,
    duration: Number(frame.duration || 1),
    width: Number(frame.width || size.width || 0),
    height: Number(frame.height || size.height || 0),
    crop: frame.crop && typeof frame.crop === "object" ? {
      x: Number(frame.crop.x || 0),
      y: Number(frame.crop.y || 0),
      width: Number(frame.crop.width || frame.width || 0),
      height: Number(frame.crop.height || frame.height || 0),
      sheetWidth: Number(frame.crop.sheetWidth || 0),
      sheetHeight: Number(frame.crop.sheetHeight || 0),
    } : null,
    assetVersion: String(frame.assetVersion || ""),
  };
}

function buildGroups(manifest, tuningFile) {
  const groups = [];
  for (const profile of manifest.profiles) {
    for (const animation of profile.animations) {
      const animationId = String(animation.id || animation.name || "animation");
      const groupName = String(animation.name || animationId);
      const characterKeyBase = `profiles.${profile.id}.character`;
      const keyBase = `profiles.${profile.id}.groups.${animationId}`;
      const defaultScale = Number(animation.defaultScale ?? 1);
      const frames = (Array.isArray(animation.frames) ? animation.frames : [])
        .map(frameForClient)
        .filter((frame) => frame.path);
      if (!frames.length) continue;
      const characterBaseScale = profile.bodyScale * profile.runtimeScale;
      const characterBaseScaleVector = tuningFile.values[`${characterKeyBase}.visual_scale`]
        ?? profile.defaultScaleVector
        ?? null;
      groups.push({
        name: groupName,
        animationId,
        loop: animation.loop !== false,
        sourceFacesLeft: profile.sourceFacesLeft === true || profile.source_faces_left === true,
        runtimeAnimation: `${profile.id}/${animationId}`,
        profileId: profile.id,
        profileLabel: profile.label,
        profileKind: profile.kind,
        profileScaleSemantic: "character_group_frame",
        profileAnchorMode: String(animation.anchorMode || "canvas_bottom_center"),
        profileSupports: Array.isArray(animation.supports) ? animation.supports : profile.supports,
        type: String(animation.type || "actor"),
        tuningTarget: "",
        anchorMode: String(animation.anchorMode || "canvas_bottom_center"),
        sourceAnchor: animation.sourceAnchor ? vector(animation.sourceAnchor) : null,
        scaleSemantic: String(animation.scaleSemantic || ""),
        source: reslash(animation.source || path.dirname(frames[0]?.path || "")),
        speed: Number(animation.fps || animation.defaultFps || 12),
        frames,
        characterScale: `${characterKeyBase}.visual_size`,
        characterScaleVector: `${characterKeyBase}.visual_scale`,
        characterOffset: `${characterKeyBase}.offset`,
        characterRotation: `${characterKeyBase}.rotation`,
        characterBaseScale,
        characterBaseScaleVector,
        characterBaseOffset: tuningFile.values[`${characterKeyBase}.offset`] ?? profile.defaultOffset ?? { x: 0, y: 0 },
        characterBaseRotation: Number(tuningFile.values[`${characterKeyBase}.rotation`] ?? profile.defaultRotation ?? 0),
        characterBaseSource: profile.runtimeScale !== 1 ? "bodyScale * runtimeScale" : "bodyScale",
        runtimeScale: profile.runtimeScale,
        bodyScale: profile.bodyScale,
        scale: `${keyBase}.visual_size`,
        scaleVector: `${keyBase}.visual_scale`,
        offset: `${keyBase}.offset`,
        rotation: `${keyBase}.rotation`,
        defaultScale,
        defaultScaleVector: animation.defaultScaleVector ? scaleVector(animation.defaultScaleVector, defaultScale) : null,
        defaultOffset: vector(animation.defaultOffset),
        defaultRotation: Number(animation.defaultRotation || 0),
        baseScale: tuningFile.values[`${keyBase}.visual_size`] ?? defaultScale,
        baseScaleVector: tuningFile.values[`${keyBase}.visual_scale`] ?? animation.defaultScaleVector ?? null,
        baseOffset: tuningFile.values[`${keyBase}.offset`] ?? animation.defaultOffset ?? { x: 0, y: 0 },
        baseRotation: Number(tuningFile.values[`${keyBase}.rotation`] ?? animation.defaultRotation ?? 0),
      });
    }
  }
  return groups;
}

function validateManifest(manifest) {
  const warnings = [];
  for (const profile of Array.isArray(manifest?.profiles) ? manifest.profiles : []) {
    for (const animation of Array.isArray(profile?.animations) ? profile.animations : []) {
      const anchorMode = String(animation.anchorMode || "canvas_bottom_center");
      if (String(profile.kind || "actor").toLowerCase() === "actor" && anchorMode === "canvas_left_bottom") {
        warnings.push(`${profile.id}/${animation.id || animation.name}: actor animation uses canvas_left_bottom; use canvas_bottom_center so the character enters tuner/game at the foot-center origin.`);
      }
      for (const [index, frame] of (animation.frames || []).entries()) {
        const relPath = reslash(frame.path || "");
        const fullPath = safeResolve(ROOT, relPath);
        if (!relPath || !fullPath || !fs.existsSync(fullPath)) {
          warnings.push(`${profile.id}/${animation.id || animation.name}: missing frame ${index + 1}: ${relPath || "(empty)"}`);
        }
      }
    }
  }
  return warnings;
}

function validateCharacterScaleValues(project, manifest) {
  const warnings = [];
  if (!manifestHasRuntimeAnimations(manifest)) return warnings;
  const paths = projectStore.projectPaths(project);
  const tuning = projectStore.readJson(paths.tuning, EMPTY_TUNING);
  const values = tuning?.values && typeof tuning.values === "object" ? tuning.values : {};
  for (const profile of Array.isArray(manifest?.profiles) ? manifest.profiles : []) {
    const scaleKey = `profiles.${profile.id}.character.visual_size`;
    const vectorKey = `profiles.${profile.id}.character.visual_scale`;
    const scale = Number(values[scaleKey] ?? profile.bodyScale ?? 1);
    const vector = values[vectorKey];
    if (vector && typeof vector === "object") {
      const x = Number(vector.x);
      const y = Number(vector.y);
      if (Number.isFinite(x) && Number.isFinite(y) && Math.abs(x - y) <= 0.0001 && Number.isFinite(scale) && Math.abs(x - scale) > 0.0001) {
        warnings.push(`${profile.id}: uniform character visual_scale (${x}) overrides visual_size (${scale}); remove visual_scale or make it match visual_size.`);
      }
    }
    const firstFrame = (profile.animations || []).flatMap((animation) => animation.frames || [])[0];
    const frameHeight = Number(firstFrame?.height || 0);
    if (frameHeight >= 512 && Number.isFinite(scale) && scale >= 0.75) {
      warnings.push(`${profile.id}: imported actor uses a large source canvas (${frameHeight}px high) with character visual_size ${scale}; initialize it from the scene actor/viewport height instead of 1:1 pixels.`);
    }
  }
  return warnings;
}

function relativeProjectPath(filePath, projectRoot) {
  return reslash(path.relative(projectRoot, filePath));
}

function isGeneratedTunerScene(scenePath) {
  const normalized = reslash(String(scenePath || ""));
  return normalized.startsWith("xsxb_frame_tuner/runtime/");
}

function listSceneFiles(projectRoot, profiles = []) {
  const root = projectRoot ? path.resolve(String(projectRoot)) : "";
  const scenes = [];
  if (!root || !fs.existsSync(root) || !fs.statSync(root).isDirectory()) return scenes;

  const walk = (dir) => {
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SCENE_SKIP_DIRS.has(entry.name)) walk(fullPath);
        continue;
      }
      if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== ".tscn") continue;
      const scenePath = relativeProjectPath(fullPath, root);
      if (isGeneratedTunerScene(scenePath)) continue;
      let sceneText = "";
      try {
        sceneText = fs.readFileSync(fullPath, "utf8");
      } catch {
        sceneText = "";
      }
      scenes.push({
        id: `res://${scenePath}`,
        label: path.basename(entry.name, ".tscn"),
        path: scenePath,
        profileIds: profileIdsForSceneText(sceneText, profiles),
      });
    }
  };

  walk(root);
  return scenes.sort((left, right) => left.id.localeCompare(right.id));
}

function gdscriptTypeWarning(filePath, projectRoot, lineNumber, message, line) {
  return `${relativeProjectPath(filePath, projectRoot)}:${lineNumber}: ${message}: ${line.trim()}`;
}

function gdscriptTextureInferenceWarning(filePath, projectRoot, lineNumber, line) {
  const match = line.match(/^\s*var\s+([A-Za-z_]\w*)\s*:=\s*(.+)$/);
  if (!match) return "";
  const variableName = match[1];
  const rhs = match[2];
  if (/\sas\s+[A-Za-z_]\w*/.test(rhs)) return "";
  const riskyRhs = /\b(load|preload)\s*\(/.test(rhs)
    || /\bResourceLoader\.load\s*\(/.test(rhs)
    || /\.get_frame_texture\s*\(/.test(rhs)
    || /_load[A-Za-z0-9_]*texture\s*\(/i.test(rhs);
  if (!riskyRhs) return "";
  const typeHint = /texture/i.test(variableName) ? "Texture2D" : "explicit type";
  return gdscriptTypeWarning(
    filePath,
    projectRoot,
    lineNumber,
    `Godot may not infer this variable type; use "var ${variableName}: ${typeHint} = ..."`,
    line
  );
}

function gdscriptTextureFunctionWarning(filePath, projectRoot, lineNumber, line) {
  const match = line.match(/^\s*func\s+(_load[A-Za-z0-9_]*texture)\s*\([^)]*\)\s*:\s*(?:#.*)?$/i);
  if (!match) return "";
  return gdscriptTypeWarning(
    filePath,
    projectRoot,
    lineNumber,
    `texture loader has no return type; use "func ${match[1]}(...) -> Texture2D:"`,
    line
  );
}

function gdscriptBoxDrivenVisualWarning(filePath, projectRoot, lines, lineNumber, line) {
  const trimmed = line.trim();
  const visualPositionAssignment = /(?:sprite|visual|image|frame)[A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)*\.(?:position|global_position|offset)\s*=/.test(trimmed);
  if (!visualPositionAssignment) return "";

  const context = lines
    .slice(Math.max(0, lineNumber - 4), Math.min(lines.length, lineNumber + 3))
    .join("\n");
  const hasBoxOffset = /\b(?:collision|hit|hurt)?box(?:es)?\b/i.test(context)
    || /\bcollision_offset\b/i.test(context)
    || /\b(?:collision|hit|hurt)_offset\b/i.test(context);
  if (!hasBoxOffset) return "";

  return gdscriptTypeWarning(
    filePath,
    projectRoot,
    lineNumber,
    "Runtime visual alignment must not use collision/hit/hurt box offsets; use XSXB character/group/frame visual transforms only",
    line
  );
}

function validateGdscriptTypeInference(projectRoot) {
  const warnings = [];
  if (!projectRoot) return warnings;
  const root = path.resolve(String(projectRoot));
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) return warnings;

  const walk = (dir) => {
    if (warnings.length >= GDSCRIPT_SCAN_LIMIT) return;
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (warnings.length >= GDSCRIPT_SCAN_LIMIT) return;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!GDSCRIPT_SKIP_DIRS.has(entry.name)) walk(fullPath);
        continue;
      }
      if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== ".gd") continue;
      let lines = [];
      try {
        lines = fs.readFileSync(fullPath, "utf8").split(/\r?\n/);
      } catch {
        continue;
      }
      lines.forEach((line, index) => {
        if (warnings.length >= GDSCRIPT_SCAN_LIMIT) return;
        const textureWarning = gdscriptTextureInferenceWarning(fullPath, root, index + 1, line);
        if (textureWarning) warnings.push(textureWarning);
        const functionWarning = gdscriptTextureFunctionWarning(fullPath, root, index + 1, line);
        if (functionWarning) warnings.push(functionWarning);
        const boxDrivenVisualWarning = gdscriptBoxDrivenVisualWarning(fullPath, root, lines, index + 1, line);
        if (boxDrivenVisualWarning) warnings.push(boxDrivenVisualWarning);
      });
    }
  };

  walk(root);
  if (warnings.length >= GDSCRIPT_SCAN_LIMIT) {
    warnings.push(`GDScript type scan stopped after ${GDSCRIPT_SCAN_LIMIT} warnings.`);
  }
  return warnings;
}

function manifestHasRuntimeAnimations(manifest) {
  return (Array.isArray(manifest?.profiles) ? manifest.profiles : [])
    .some((profile) => Array.isArray(profile?.animations) && profile.animations.length > 0);
}

function collectRuntimeActorScripts(projectRoot) {
  const scriptTexts = new Map();
  const runtimeScripts = new Set(["xsxb_frame_tuner/runtime/xsxb_frame_actor.gd"]);

  const walk = (dir) => {
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!GDSCRIPT_SKIP_DIRS.has(entry.name)) walk(fullPath);
        continue;
      }
      if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== ".gd") continue;
      try {
        scriptTexts.set(relativeProjectPath(fullPath, projectRoot), fs.readFileSync(fullPath, "utf8"));
      } catch {
        // Ignore unreadable scripts during validation; other checks report missing runtime support.
      }
    }
  };

  walk(projectRoot);
  let changed = true;
  while (changed) {
    changed = false;
    for (const [relPath, text] of scriptTexts.entries()) {
      if (runtimeScripts.has(relPath)) continue;
      const extendsMatch = text.match(/extends\s+"res:\/\/([^"]+\.gd)"/);
      if (!extendsMatch) continue;
      if (!runtimeScripts.has(reslash(extendsMatch[1]))) continue;
      runtimeScripts.add(relPath);
      changed = true;
    }
  }
  return runtimeScripts;
}

function validateRuntimeSceneUsage(project, manifest) {
  const warnings = [];
  if (!manifestHasRuntimeAnimations(manifest)) return warnings;
  const projectRoot = project?.projectRoot ? path.resolve(String(project.projectRoot)) : "";
  if (!projectRoot || !fs.existsSync(projectRoot) || !fs.statSync(projectRoot).isDirectory()) return warnings;

  const runtimeScripts = collectRuntimeActorScripts(projectRoot);
  let sceneUsesRuntime = false;

  const walk = (dir) => {
    if (sceneUsesRuntime) return;
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (sceneUsesRuntime) return;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SCENE_SKIP_DIRS.has(entry.name)) walk(fullPath);
        continue;
      }
      if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== ".tscn") continue;
      const relScene = relativeProjectPath(fullPath, projectRoot);
      if (isGeneratedTunerScene(relScene)) continue;
      let text = "";
      try {
        text = fs.readFileSync(fullPath, "utf8");
      } catch {
        continue;
      }
      if (/res:\/\/xsxb_frame_tuner\/runtime\/xsxb_frame_actor\.tscn/.test(text)) {
        sceneUsesRuntime = true;
        return;
      }
      for (const scriptRel of runtimeScripts) {
        if (text.includes(`res://${scriptRel}`)) {
          sceneUsesRuntime = true;
          return;
        }
      }
    }
  };

  walk(projectRoot);
  if (!sceneUsesRuntime) {
    warnings.push("Imported XSXB animations are synced, but no gameplay scene appears to instantiate xsxb_frame_actor.tscn or a script extending xsxb_frame_actor.gd. The generated runtime test scene can play the data, but the actual game scene will not change until a gameplay node uses the XSXB runtime.");
  }
  return warnings;
}

function validateRuntimeBindingReaders(project, manifest) {
  const warnings = [];
  const projectRoot = project?.projectRoot ? path.resolve(String(project.projectRoot)) : "";
  if (!projectRoot || !fs.existsSync(projectRoot) || !fs.statSync(projectRoot).isDirectory()) return warnings;

  const paths = projectStore.projectPaths(project);
  const frameAudioBindings = projectStore.readJson(paths.frameAudio, []);
  const frameImageAttachments = projectStore.readJson(paths.frameImageAttachments, []);
  const tuning = projectStore.readJson(paths.tuning, EMPTY_TUNING);
  const frameBoxOverrides = tuning?.frame_box_overrides && typeof tuning.frame_box_overrides === "object"
    ? tuning.frame_box_overrides
    : {};
  const sceneSettings = tuning?.scene_settings && typeof tuning.scene_settings === "object"
    ? tuning.scene_settings
    : {};
  const hasRuntimeAnimations = manifestHasRuntimeAnimations(manifest);
  const needsFrameAudio = hasRuntimeAnimations || (Array.isArray(frameAudioBindings) && frameAudioBindings.length > 0);
  const needsFrameImageAttachments = hasRuntimeAnimations || (Array.isArray(frameImageAttachments) && frameImageAttachments.length > 0);
  const needsFramePlayback = hasRuntimeAnimations;
  const needsFrameBoxes = Object.keys(frameBoxOverrides).length > 0;
  const needsSceneScale = hasRuntimeAnimations || Object.keys(sceneSettings).length > 0;
  if (!needsFrameAudio && !needsFrameImageAttachments && !needsFramePlayback && !needsFrameBoxes && !needsSceneScale) return warnings;

  const found = {
    frameAudioBindings: false,
    frameAudioPlayback: false,
    frameAudioAdvancePlayback: false,
    frameAudioFrameVisitTrigger: false,
    frameImageAttachments: false,
    framePlaybackOverrides: false,
    groupPlayback: false,
    playbackIdempotent: false,
    sceneSettings: false,
    sceneScaleInterface: false,
    sceneScaleApplied: false,
    sceneScaleAppliedToBoxes: false,
    frameBoxOverrides: false,
    runtimeHitboxInterface: false,
    runtimeHurtboxInterface: false,
    runtimeAppliesHurtbox: false,
    runtimeSourceFacing: false,
    hardcodedGameplayBodyCollision: false,
    gameplayBodyCollisionUsesRuntime: false,
    gameplayBodyCollisionGroundAnchored: false,
    hardcodedGameplayAttackRange: false,
    gameplayAttackUsesRuntimeHitbox: false,
    animationDurationInterface: false,
    startRunState: false,
    startRunTransitionsToRun: false,
  };

  const walk = (dir) => {
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!GDSCRIPT_SKIP_DIRS.has(entry.name)) walk(fullPath);
        continue;
      }
      if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== ".gd") continue;
      let text = "";
      try {
        text = fs.readFileSync(fullPath, "utf8");
      } catch {
        continue;
      }
      if (/frame_audio_bindings\.json|frame_audio_bindings/i.test(text)) found.frameAudioBindings = true;
      if (/AudioStream|AudioStreamPlayer|\.play\s*\(/.test(text)) found.frameAudioPlayback = true;
      if (/while\s+_frame_clock\s*>=\s*_current_frame_duration\s*\(\s*\)[\s\S]{0,900}_play_current_frame_audio\s*\(\s*\)/.test(text)
        || /while\s+_frame_clock\s*>=\s*_current_frame_duration\s*\(\s*\)[\s\S]{0,900}_play_frame_audio\s*\(/.test(text)) found.frameAudioAdvancePlayback = true;
      if (/_frame_visit_serial/.test(text) && /trigger_key/.test(text) && /_last_audio_key/.test(text)) found.frameAudioFrameVisitTrigger = true;
      if (/frame_image_attachments\.json|frame_image_attachments/i.test(text)) found.frameImageAttachments = true;
      if (/frame_playback_overrides/i.test(text)) found.framePlaybackOverrides = true;
      if (/__group|group_playback/i.test(text)) found.groupPlayback = true;
      if (/func\s+play_frame_animation\s*\([^)]*animation_name/.test(text)
        && /_current_animation\s*==\s*animation_name/.test(text)
        && /\brestart\b/.test(text)) found.playbackIdempotent = true;
      if (/scene_settings/i.test(text)) found.sceneSettings = true;
      if (/func\s+scene_scale\s*\(/.test(text)) found.sceneScaleInterface = true;
      if (/_character_scale\s*\(\s*\)\s*\*\s*scene_scale\s*\(\s*\)|scene_scale\s*\(\s*\)\s*\*\s*_character_scale\s*\(\s*\)/.test(text)) found.sceneScaleApplied = true;
      if (/_box_actor_size\s*\([^)]*runtime_scale/.test(text) && /_box_actor_position\s*\([^)]*runtime_scale/.test(text)) found.sceneScaleAppliedToBoxes = true;
      if (/frame_box_overrides/i.test(text)) found.frameBoxOverrides = true;
      if (/current_hitbox_enabled|current_hitbox_size|current_hitbox_position/.test(text)) found.runtimeHitboxInterface = true;
      if (/current_hurtbox_enabled|current_hurtbox_size|current_hurtbox_position/.test(text)) found.runtimeHurtboxInterface = true;
      if (/func\s+_apply_frame_hurtbox\s*\(/.test(text)) found.runtimeAppliesHurtbox = true;
      if (/source_faces_left|func\s+render_facing\s*\(/.test(text)) found.runtimeSourceFacing = true;
      const hasGameplayMovementCollision = /BodyCollision|movement_collision_shape|movement_rectangle_shape/i.test(text);
      if (hasGameplayMovementCollision && /RectangleShape2D\.new\s*\(\s*\)/.test(text) && /\.size\s*=/.test(text)) found.hardcodedGameplayBodyCollision = true;
      if (hasGameplayMovementCollision && /current_collision_box_size|current_collision_box_position|current_grounded_collision_box_position/.test(text)) found.gameplayBodyCollisionUsesRuntime = true;
      if (hasGameplayMovementCollision && /current_grounded_collision_box_position|-\s*size\.y\s*\*\s*0\.5|-\s*_body_shape\.size\.y\s*\*\s*0\.5|-\s*runtime_shape\.size\.y\s*\*\s*0\.5|-\s*movement_rectangle_shape\.size\.y\s*\*\s*0\.5/.test(text)) found.gameplayBodyCollisionGroundAnchored = true;
      if (/ATTACK_RANGE|ATTACK_HEIGHT|AIR_ATTACK_RANGE|AIR_ATTACK_HEIGHT/.test(text)) found.hardcodedGameplayAttackRange = true;
      if (/current_hitbox_size|current_hitbox_position|current_hitbox_enabled/.test(text) && /current_hurtbox_size|current_hurtbox_position|current_hurtbox_enabled|_runtime_hurt_rect/.test(text)) found.gameplayAttackUsesRuntimeHitbox = true;
      if (/func\s+(?:current_)?animation_duration\s*\(|animation_finished\s*\./.test(text)) found.animationDurationInterface = true;
      if (/ActionState\.START_RUN/.test(text) && /_enter_start_run/.test(text) && /_enter_run/.test(text)) found.startRunState = true;
      if (/finished_state\s*==\s*ActionState\.START_RUN/.test(text)) found.startRunTransitionsToRun = true;
    }
  };

  walk(projectRoot);

  if (needsFrameAudio && !found.frameAudioBindings) {
    warnings.push("Runtime must support XSXB frame audio, but no GDScript appears to read frame_audio_bindings.json.");
  } else if (needsFrameAudio && !found.frameAudioPlayback) {
    warnings.push("Runtime reads frame audio bindings, but no GDScript AudioStream/AudioStreamPlayer playback path was found.");
  } else if (needsFrameAudio && !found.frameAudioAdvancePlayback) {
    warnings.push("Runtime frame audio only appears to play during final frame rendering; very short frame durations can skip bound SFX frames.");
  } else if (needsFrameAudio && !found.frameAudioFrameVisitTrigger) {
    warnings.push("Runtime frame audio de-duplication appears keyed only by frame key; looped one-frame or repeated same-frame SFX can be blocked instead of triggering on frame entry.");
  }
  if (needsFrameImageAttachments && !found.frameImageAttachments) {
    warnings.push("Runtime must support XSXB frame image attachments, but no GDScript appears to read frame_image_attachments.json.");
  }
  if (needsFramePlayback && !found.framePlaybackOverrides) {
    warnings.push("Runtime must support XSXB frame playback overrides, but no GDScript appears to read frame_playback_overrides.");
  } else if (needsFramePlayback && !found.groupPlayback) {
    warnings.push("Runtime reads frame playback overrides, but no GDScript appears to handle <profile>/<animation>:__group timing.");
  } else if (needsFramePlayback && !found.animationDurationInterface) {
    warnings.push("Runtime reads group timing, but no animation_duration/current_animation_duration interface was found for gameplay action timers.");
  } else if (needsFramePlayback && !found.playbackIdempotent) {
    warnings.push("Runtime play_frame_animation appears to restart the same animation on every call; repeated gameplay calls can make an animation look like one frame.");
  }
  if (needsFrameBoxes && !found.frameBoxOverrides) {
    warnings.push("Runtime must support XSXB frame boxes, but no GDScript appears to read frame_box_overrides.");
  } else if (needsFrameBoxes && needsSceneScale && !found.sceneScaleAppliedToBoxes) {
    warnings.push("Runtime reads frame boxes, but box size/position does not appear to use the same scene_scale() runtime scale as the sprite.");
  } else if (needsFrameBoxes && (!found.runtimeHitboxInterface || !found.runtimeHurtboxInterface || !found.runtimeAppliesHurtbox)) {
    warnings.push("Runtime frame boxes are incomplete: gameplay must be able to query hitbox and hurtbox, and runtime must apply hurtbox with the same transform as collisionbox/hitbox.");
  }
  if (needsSceneScale && !found.sceneSettings) {
    warnings.push("Runtime must support XSXB scene scale, but no GDScript appears to read scene_settings.");
  } else if (needsSceneScale && !found.sceneScaleInterface) {
    warnings.push("Runtime reads scene_settings, but no scene_scale() interface was found for gameplay movement scaling.");
  } else if (needsSceneScale && !found.sceneScaleApplied) {
    warnings.push("Runtime scene scale exists, but visual scale does not appear to multiply character scale by scene_scale().");
  }
  if (hasRuntimeAnimations && !found.runtimeSourceFacing) {
    warnings.push("Runtime has no source_faces_left/render_facing interface; imported art facing left can make gameplay directions render backwards.");
  }
  if (needsFrameBoxes && found.hardcodedGameplayBodyCollision && !found.gameplayBodyCollisionUsesRuntime) {
    warnings.push("Gameplay creates its own movement collision rectangle but does not sync it from xsxb_frame_actor current_collision_box_*; tuner box and scene scale changes will not affect in-game movement collision.");
  } else if (needsFrameBoxes && found.hardcodedGameplayBodyCollision && found.gameplayBodyCollisionUsesRuntime && !found.gameplayBodyCollisionGroundAnchored) {
    warnings.push("Gameplay movement collision sync appears to use the runtime collisionbox Y position directly; grounded movement should anchor the collision bottom at the actor origin so visual Y offsets are not cancelled by floor collision.");
  }
  if (needsFrameBoxes && found.hardcodedGameplayAttackRange && !found.gameplayAttackUsesRuntimeHitbox) {
    warnings.push("Gameplay still appears to use fixed attack range/height without intersecting xsxb_frame_actor hitbox against target hurtbox; tuner hitbox changes will not affect combat.");
  }
  if (hasRuntimeAnimations && found.startRunState && !found.startRunTransitionsToRun) {
    warnings.push("Runtime START_RUN state appears not to transition into RUN after the start animation; holding a direction can leave movement locked.");
  }

  return warnings;
}

function validateGameLocalBindingKeys(project) {
  const warnings = [];
  const projectRoot = project?.projectRoot ? path.resolve(String(project.projectRoot)) : "";
  const projectId = String(project?.id || "");
  if (!projectRoot || !projectId || !fs.existsSync(projectRoot) || !fs.statSync(projectRoot).isDirectory()) return warnings;

  const files = [
    ["frame_audio_bindings.json", "frame audio"],
    ["frame_image_attachments.json", "frame image attachment"],
  ];
  for (const [fileName, label] of files) {
    const filePath = path.join(projectRoot, "xsxb_frame_tuner", "data", "projects", projectId, fileName);
    if (!fs.existsSync(filePath)) continue;
    const entries = projectStore.readJson(filePath, []);
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      const key = String(entry?.key || entry?.frameKey || "");
      if (!key) continue;
      if (key.split(":").length <= 2) continue;
      warnings.push(`Game-local ${label} binding key "${key}" is source-heavy; Save sync must write stable <profile>/<animation>:<frame> keys.`);
      break;
    }
  }
  return warnings;
}

function validateFrameBoxCoverage(manifest, tuning) {
  const warnings = [];
  for (const profile of Array.isArray(manifest?.profiles) ? manifest.profiles : []) {
    for (const animation of Array.isArray(profile?.animations) ? profile.animations : []) {
      const issues = frameBoxCoverageIssues(tuning, profile.id, animation);
      if (!issues.length) continue;
      const counts = issues.reduce((result, issue) => {
        result[issue.kind] = (result[issue.kind] || 0) + 1;
        return result;
      }, {});
      const labels = { hurtbox: "受击框", collisionbox: "碰撞框", hitbox: "攻击框" };
      const total = Array.isArray(animation.frames) ? animation.frames.length : 0;
      for (const [kind, count] of Object.entries(counts)) {
        warnings.push(`${profile.id}/${animation.id || animation.name}: ${count}/${total} 帧缺少有效${labels[kind] || kind}。`);
      }
    }
  }
  return warnings;
}

function validateProject(project, manifest, tuning = readTuningFile(project)) {
  if (projectEngine(project) === "unity") {
    const warnings = [
      ...validateManifest(manifest),
      ...validateFrameBoxCoverage(manifest, tuning),
      ...validateAttackTrails(readAttackTrails(project), manifest),
      ...validateCharacterScaleValues(project, manifest),
    ];
    const unityRoot = validUnityProjectRoot(project);
    if (!unityRoot) warnings.push(`Unity project root is invalid: ${project?.projectRoot || "(empty)"}`);
    else {
      const runtimeData = path.join(unityRoot, "Assets", "XSXBFrameTuner", "RuntimeData", project.id, "xsxb_runtime_data.json");
      if (fs.existsSync(runtimeData)) warnings.push(...validateUnitySync(unityRoot, project.id));
    }
    return warnings;
  }
  if (projectEngine(project) !== "godot") {
    return [...validateManifest(manifest), ...validateFrameBoxCoverage(manifest, tuning)];
  }
  return [
    ...validateManifest(manifest),
    ...validateFrameBoxCoverage(manifest, tuning),
    ...validateAttackTrails(readAttackTrails(project), manifest),
    ...validateCharacterScaleValues(project, manifest),
    ...validateGdscriptTypeInference(project?.projectRoot),
    ...validateRuntimeBindingReaders(project, manifest),
    ...validateRuntimeSceneUsage(project, manifest),
    ...validateGameLocalBindingKeys(project),
  ];
}

function syncGodotRuntimeProjectId(project) {
  const projectRoot = project?.projectRoot ? path.resolve(String(project.projectRoot)) : "";
  const projectId = String(project?.id || "");
  const changed = [];
  if (!projectRoot || !projectId || !fs.existsSync(projectRoot) || !fs.statSync(projectRoot).isDirectory()) return changed;

  const walk = (dir) => {
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!GDSCRIPT_SKIP_DIRS.has(entry.name)) walk(fullPath);
        continue;
      }
      if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== ".gd") continue;
      let text = "";
      try {
        text = fs.readFileSync(fullPath, "utf8");
      } catch {
        continue;
      }
      const next = text.replace(
        /(const\s+XSXB_PROJECT_ID\s*:\s*String\s*=\s*)"([^"]*)"/g,
        `$1"${projectId}"`
      );
      if (next === text) continue;
      fs.writeFileSync(fullPath, next);
      changed.push(relativeProjectPath(fullPath, projectRoot));
    }
  };

  walk(projectRoot);
  return changed;
}

function configResponse(projectId) {
  const { registry, project } = projectFromRequest(projectId, { activate: true });
  if (!project || projectEngine(project) === "lite") return neutralApp.configResponse(project?.id);
  workbench.projectData(project.id);
  if (!project) {
    return {
      root: ROOT,
      workspaceRoot: path.join(ROOT, "workspace"),
      workspaceAllRoot: path.join(ROOT, "workspace"),
      projectRoot: "",
      activeProjectId: "",
      bindingProjectId: "",
      dataProjectIds: [],
      activeProject: null,
      projects: [],
      scenes: [],
      profiles: [],
      frameAudioBindings: [],
      frameImageAttachments: [],
      tuning: tuningForClient(EMPTY_TUNING),
      tuningDefaults: {},
      bossTuning: {},
      act2StatueBossTuning: {},
      act2StatueBossDefaults: {},
      huangXianTuning: {},
      huangXianDefaults: {},
      huangXianManifest: {},
      soulTuning: {},
      soulDefaults: {},
      soulManifest: {},
      yechengPropTuning: {},
      yechengPropDefaults: {},
      warnings: ["当前 tuner 没有项目。请用 skill 给新的 Godot 项目导入角色或动画。"],
      references: {
        playerCanonicalIdleHeight: 0,
        playerSpriteCenterX: 0,
        playerSpriteFootY: 0,
        playerFloorTopOffsetY: 0,
        bossFloorTopOffsetY: 0,
      },
      groups: [],
    };
  }
  const manifest = readManifest(project);
  const tuningFile = readTuningFile(project);
  const groups = buildGroups(manifest, tuningFile);
  const warnings = validateProject(project, manifest, tuningFile);
  if (!groups.length) {
    warnings.unshift("当前项目没有已导入的动画组。请先用 skill/import_frames/import_spriteframes 导入 PNG 序列或 SpriteFrames。");
  }
  const projectClient = projectStore.projectForClient(project);
  const bindingScope = bindingScopeForProject(registry, project);
  const attackTrails = readAttackTrails(project);
  return {
    root: ROOT,
    workspaceRoot: projectStore.projectWorkspaceDir(project),
    workspaceAllRoot: path.join(ROOT, "workspace"),
    projectRoot: project.projectRoot,
    activeProjectId: project.id,
    bindingProjectId: bindingScope.bindingProjectId,
    dataProjectIds: bindingScope.dataProjectIds,
    activeProject: projectClient,
    configRevision: projectConfigRevision(project),
    projects: registry.projects.map(projectStore.projectForClient),
    scenes: projectEngine(project) === "godot"
      ? listSceneFiles(project.projectRoot, manifest.profiles)
      : projectEngine(project) === "unity"
        ? listUnitySceneFiles(project.projectRoot, manifest.profiles)
        : [],
    profiles: manifest.profiles.map(profileForClient),
    frameAudioBindings: readFrameAudioBindings(project),
    frameImageAttachments: readFrameImageAttachments(project),
    attackTrails,
    tuning: tuningForClient(tuningFile),
    tuningDefaults: {},
    bossTuning: {},
    act2StatueBossTuning: {},
    act2StatueBossDefaults: {},
    huangXianTuning: {},
    huangXianDefaults: {},
    huangXianManifest: {},
    soulTuning: {},
    soulDefaults: {},
    soulManifest: {},
    yechengPropTuning: {},
    yechengPropDefaults: {},
    warnings,
    references: {
      playerCanonicalIdleHeight: 0,
      playerSpriteCenterX: 0,
      playerSpriteFootY: 0,
      playerFloorTopOffsetY: 0,
      bossFloorTopOffsetY: 0,
    },
    projectKind: project.kind || "godot",
    projectEngine: projectEngine(project),
    capabilities: adapterForProject(project),
    groups,
  };
}

function projectConfigRevision(project) {
  const paths = projectStore.projectPaths(project);
  const hash = crypto.createHash("sha256");
  for (const filePath of [
    paths.manifest,
    paths.tuning,
    paths.frameAudio,
    paths.frameImageAttachments,
    paths.attackTrails,
    sharedAttackTrailPresetPath(ROOT),
  ]) {
    hash.update(path.basename(filePath));
    hash.update("\0");
    hash.update(fs.existsSync(filePath) ? fs.readFileSync(filePath) : Buffer.alloc(0));
    hash.update("\0");
  }
  return hash.digest("hex");
}

function normalizeTuningScaleValues(values) {
  const next = values && typeof values === "object" ? values : {};
  for (const key of Object.keys(next)) {
    if (!/\.character\.visual_scale$/.test(key)) continue;
    const vector = next[key];
    if (!vector || typeof vector !== "object") continue;
    const x = Number(vector.x);
    const y = Number(vector.y);
    if (!Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x - y) > 0.0001) continue;
    const scaleKey = key.replace(/\.visual_scale$/, ".visual_size");
    const scale = Number(next[scaleKey]);
    if (Number.isFinite(scale) && scale > 0) delete next[key];
  }
  return next;
}

function saveTuningPayload(payload, project) {
  const current = readTuningFile(project);
  const supplied = (key) => Object.prototype.hasOwnProperty.call(payload, key);
  const next = {
    schemaVersion: 1,
    values: supplied("values") && payload.values && typeof payload.values === "object"
      ? normalizeTuningScaleValues(payload.values)
      : current.values,
    scene_settings: supplied("scene_settings") && payload.scene_settings && typeof payload.scene_settings === "object"
      ? payload.scene_settings
      : current.scene_settings,
    frame_visual_overrides: supplied("frame_visual_overrides") && payload.frame_visual_overrides && typeof payload.frame_visual_overrides === "object"
      ? payload.frame_visual_overrides
      : current.frame_visual_overrides,
    frame_playback_overrides: supplied("frame_playback_overrides") && payload.frame_playback_overrides && typeof payload.frame_playback_overrides === "object"
      ? payload.frame_playback_overrides
      : current.frame_playback_overrides,
    frame_box_overrides: supplied("frame_box_overrides") && payload.frame_box_overrides && typeof payload.frame_box_overrides === "object"
      ? payload.frame_box_overrides
      : current.frame_box_overrides,
  };
  projectStore.writeJson(projectStore.projectPaths(project).tuning, next);
}

function saveFrameImageAttachments(payload, project) {
  const attachments = Array.isArray(payload)
    ? payload.filter((entry) => entry && typeof entry === "object").map((entry) => withFrameAttachmentHash(project, entry))
    : [];
  projectStore.writeJson(projectStore.projectPaths(project).frameImageAttachments, attachments);
  return attachments;
}

function saveFrameAudioBindings(payload, project) {
  const bindings = Array.isArray(payload)
    ? payload.filter((entry) => entry && typeof entry === "object")
    : Object.entries(payload || {}).map(([key, value]) => ({
      key,
      ...(value && typeof value === "object" ? value : {}),
    })).filter((entry) => entry && typeof entry === "object");
  const unusableBindings = bindings.filter((entry) => !entry.data && !entry.path && !entry.file);
  if (unusableBindings.length) {
    throw new Error(`${unusableBindings.length} 条音效记录缺少可保存的音频数据或稳定路径，已阻止覆盖原音效。`);
  }
  projectStore.writeJson(projectStore.projectPaths(project).frameAudio, bindings);
  return bindings;
}

function saveAttackTrails(payload, project) {
  const trails = normalizeAttackTrails(payload);
  for (const [key, segments] of Object.entries(trails.bindings)) {
    for (const segment of segments) {
      const texturePath = safeResolve(ROOT, segment.texture?.path || "");
      if (texturePath && fs.existsSync(texturePath)) {
        const info = pngInfo(fs.readFileSync(texturePath));
        segment.texture.width = info.width;
        segment.texture.height = info.height;
        segment.texture.hasEffectiveAlpha = info.hasEffectiveAlpha;
      }
      if (segment.colorMode === "original" && !segment.texture?.hasEffectiveAlpha) {
        throw new Error(`${key}/${segment.id}: 使用贴图原色需要带有效 Alpha 的透明 RGBA PNG。`);
      }
    }
  }
  saveSharedAttackTrailPresets(ROOT, project.id, trails.presets);
  const projectTrails = attackTrailsWithoutSharedPresets(trails);
  projectStore.writeJson(projectStore.projectPaths(project).attackTrails, projectTrails);
  return projectTrails;
}

function remapFrameOverrideDictionary(source, framePrefix, frameIndex) {
  const result = {};
  for (const [key, value] of Object.entries(source || {})) {
    if (!key.startsWith(framePrefix)) {
      result[key] = value;
      continue;
    }
    const suffix = key.slice(framePrefix.length);
    if (!/^\d+$/.test(suffix)) {
      result[key] = value;
      continue;
    }
    const index = Number(suffix);
    const targetIndex = index > frameIndex ? index + 1 : index;
    result[`${framePrefix}${targetIndex}`] = value;
    if (index === frameIndex) result[`${framePrefix}${frameIndex + 1}`] = structuredClone(value);
  }
  return result;
}

function bindingTargetsFrame(entry, profileId, animationId) {
  const metadata = entry?.metadata && typeof entry.metadata === "object" ? entry.metadata : {};
  const profile = String(metadata.profileId || entry?.profileId || "");
  const animation = String(metadata.animation || entry?.animation || "");
  return profile === profileId && (animation === animationId || animation === `${profileId}/${animationId}`);
}

function bindingAtFrame(entry, frameIndex, options = {}) {
  const next = structuredClone(entry);
  const replaceFrameSuffix = (value) => String(value || "").replace(/:\d+$/, `:${frameIndex}`);
  if (next.key) next.key = replaceFrameSuffix(next.key);
  if (next.frameKey) next.frameKey = replaceFrameSuffix(next.frameKey);
  if (Number.isFinite(Number(next.frame))) next.frame = frameIndex;
  if (Number.isFinite(Number(next.displayFrame))) next.displayFrame = frameIndex;
  if (next.metadata && typeof next.metadata === "object") {
    next.metadata.frame = frameIndex;
    next.metadata.displayFrame = frameIndex;
  }
  if (options.newId && next.id) next.id = `layer_${crypto.randomBytes(10).toString("hex")}`;
  return next;
}

function duplicateFrameBindings(entries, profileId, animationId, frameIndex, options = {}) {
  const result = [];
  for (const entry of Array.isArray(entries) ? entries : []) {
    if (!bindingTargetsFrame(entry, profileId, animationId)) {
      result.push(entry);
      continue;
    }
    const metadata = entry?.metadata && typeof entry.metadata === "object" ? entry.metadata : {};
    const currentFrame = Number(metadata.frame ?? entry.frame);
    if (!Number.isFinite(currentFrame)) {
      result.push(entry);
      continue;
    }
    result.push(bindingAtFrame(entry, currentFrame > frameIndex ? currentFrame + 1 : currentFrame));
    if (currentFrame === frameIndex) result.push(bindingAtFrame(entry, frameIndex + 1, options));
  }
  return result;
}

function duplicateTrailFrameSlices(trails, bindingKey, frameIndex) {
  const next = structuredClone(trails);
  const segments = Array.isArray(next.bindings?.[bindingKey]) ? next.bindings[bindingKey] : [];
  for (const segment of segments) {
    for (const stick of Array.isArray(segment.sticks) ? segment.sticks : []) {
      if (Number(stick.frame) > frameIndex) stick.frame = Number(stick.frame) + 1;
    }
    if (!segment.frameSlices || typeof segment.frameSlices !== "object" || Array.isArray(segment.frameSlices)) continue;
    const slices = {};
    for (const [rawFrame, slice] of Object.entries(segment.frameSlices)) {
      const currentFrame = Number(rawFrame);
      if (!Number.isFinite(currentFrame)) continue;
      slices[String(currentFrame > frameIndex ? currentFrame + 1 : currentFrame)] = slice;
      if (currentFrame === frameIndex) slices[String(frameIndex + 1)] = structuredClone(slice);
    }
    segment.frameSlices = slices;
  }
  return next;
}

function duplicateProjectFrame(project, payload) {
  const profileId = String(payload.profileId || "");
  const animationId = String(payload.animationId || "");
  const frameIndex = Math.max(0, Math.round(Number(payload.frameIndex || 0)));
  projectStore.ensureProjectFiles(project);
  const paths = projectStore.projectPaths(project);
  const manifest = projectStore.readJson(paths.manifest, EMPTY_MANIFEST);
  const profile = manifest.profiles.find((entry) => String(entry.id) === profileId);
  const animation = profile?.animations?.find((entry) => String(entry.id || entry.name) === animationId);
  const frames = Array.isArray(animation?.frames) ? animation.frames : null;
  if (!profile || !animation || !frames || frameIndex >= frames.length) {
    throw new Error(`Frame not found: ${profileId}/${animationId}:${frameIndex}`);
  }

  const copiedFrame = structuredClone(frames[frameIndex]);
  copiedFrame.id = `${String(copiedFrame.id || `frame_${frameIndex + 1}`)}_copy_${crypto.randomBytes(5).toString("hex")}`;
  frames.splice(frameIndex + 1, 0, copiedFrame);

  const tuning = readTuningFile(project);
  const framePrefix = `${profileId}/${animationId}:`;
  tuning.frame_visual_overrides = remapFrameOverrideDictionary(tuning.frame_visual_overrides, framePrefix, frameIndex);
  tuning.frame_playback_overrides = remapFrameOverrideDictionary(tuning.frame_playback_overrides, framePrefix, frameIndex);
  tuning.frame_box_overrides = remapFrameOverrideDictionary(tuning.frame_box_overrides, framePrefix, frameIndex);
  const audio = duplicateFrameBindings(readFrameAudioBindings(project), profileId, animationId, frameIndex);
  const attachments = duplicateFrameBindings(readFrameImageAttachments(project), profileId, animationId, frameIndex, { newId: true });
  const trails = duplicateTrailFrameSlices(readAttackTrails(project), `${profileId}/${animationId}`, frameIndex);

  projectStore.writeJson(paths.manifest, manifest);
  projectStore.writeJson(paths.tuning, tuning);
  projectStore.writeJson(paths.frameAudio, audio);
  projectStore.writeJson(paths.frameImageAttachments, attachments);
  projectStore.writeJson(paths.attackTrails, trails);

  const engine = projectEngine(project);
  const syncOptions = { frameAudioBindings: audio, frameImageAttachments: attachments, attackTrails: trails };
  const godotSync = engine === "godot" ? syncGodotProject(ROOT, projectStore, project, syncOptions) : null;
  const unitySync = engine === "unity" ? syncUnityProject(ROOT, projectStore, project, syncOptions) : null;
  const runtimeProjectIdFiles = engine === "godot" ? syncGodotRuntimeProjectId(project) : [];
  return {
    frameIndex: frameIndex + 1,
    frameCount: frames.length,
    engine,
    godotSync,
    unitySync,
    runtimeProjectIdFiles,
    warnings: validateProject(project, normalizeManifest(manifest)),
  };
}

function saveFrameAttachmentImage(payload, project) {
  const decoded = decodeDataUrl(payload.data);
  if (!decoded?.buffer?.length || !decoded.mime.startsWith("image/")) {
    throw new Error("Expected an image data URL.");
  }
  const ext = imageExtensionFromMime(decoded.mime, payload.name);
  if (!ext) throw new Error("Unsupported image type.");
  const hash = contentHash(decoded.buffer);
  const fileName = `${hash}${ext}`;
  const workspaceDir = projectStore.projectWorkspaceDir(project);
  const fullPath = path.join(workspaceDir, "attachments", fileName);
  if (!isInside(fullPath, workspaceDir)) throw new Error("Attachment image must stay under the active project workspace.");
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  if (!fs.existsSync(fullPath)) fs.writeFileSync(fullPath, decoded.buffer);
  const relPath = reslash(path.relative(ROOT, fullPath));
  const pngSize = ext === ".png" ? getPngSize(fullPath) : {};
  return {
    path: relPath,
    assetHash: hash,
    name: String(payload.name || fileName),
    type: decoded.mime,
    width: Number(payload.width || pngSize.width || 0),
    height: Number(payload.height || pngSize.height || 0),
  };
}

function prepareReplacementFrameImage(payload, project) {
  const relPath = reslash(payload.path || "");
  const fullPath = safeResolve(ROOT, relPath);
  const workspaceDir = projectStore.projectWorkspaceDir(project);
  if (!fullPath || !isInside(fullPath, workspaceDir) || path.extname(fullPath).toLowerCase() !== ".png"
      || !fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()
      || !isInside(fs.realpathSync(fullPath), fs.realpathSync(workspaceDir))) {
    throw Object.assign(new Error("Frame replacement path must be an existing PNG under the active project workspace."), { status: 400, code: "invalid_frame_path" });
  }
  const { buffer, width, height } = pngBuffer({ name: path.basename(fullPath), data: payload.data });
  return { fullPath, buffer, result: { path: relPath, width, height } };
}

function replaceFrameImage(payload, project) {
  const prepared = prepareReplacementFrameImage(payload, project);
  commitImportFiles([[prepared.fullPath, prepared.buffer]]);
  return prepared.result;
}

function replaceAnimationImages(frames, files, project) {
  const prepared = frames.map((frame, index) => prepareReplacementFrameImage({ path: frame.path, data: files[index].data }, project));
  const unique = new Map();
  for (const frame of prepared) {
    const resolved = fs.realpathSync(frame.fullPath);
    const key = process.platform === "win32" ? resolved.toLowerCase() : resolved;
    if (unique.has(key) && !unique.get(key).buffer.equals(frame.buffer)) throw Object.assign(new Error("Multiple frames share one image path; provide identical replacement bytes or import a new animation."), { status: 400, code: "shared_frame_path" });
    unique.set(key, frame);
  }
  commitImportFiles([...unique.values()].map((frame) => [frame.fullPath, frame.buffer]));
  return prepared.map((frame) => frame.result);
}

function projectsResponse() {
  const registry = availableRegistry();
  return {
    activeProjectId: registry.activeProjectId,
    projects: registry.projects.map(projectStore.projectForClient),
  };
}

function scheduleServerRestart() {
  if (restartScheduled) return;
  restartScheduled = true;
  const timer = setTimeout(() => {
    server.close(() => {
      // The Windows launcher owns the console and restarts us in-place after
      // an explicit update; do not escape into a detached background process.
      if (process.env.FRAME_TUNER_FOREGROUND === "1") return process.exit(75);
      const child = spawn(process.execPath, [__filename], {
        cwd: ROOT,
        env: { ...process.env, PORT: String(PORT) },
        detached: true,
        stdio: "ignore",
        windowsHide: true,
      });
      child.unref();
      process.exit(0);
    });
    if (typeof server.closeIdleConnections === "function") server.closeIdleConnections();
    const forceClose = setTimeout(() => {
      if (typeof server.closeAllConnections === "function") server.closeAllConnections();
    }, 2500);
    forceClose.unref();
  }, 600);
  timer.unref();
}

function serveStatic(req, res, pathname) {
  const requestPath = pathname === "/" ? "index.html" : pathname.slice(1);
  const staticRoot = ["lite.js", "lite.css"].includes(requestPath) ? path.resolve(__dirname, "..", "frame_tuner_lite", "public") : PUBLIC;
  const full = safeResolve(staticRoot, requestPath);
  if (!full || !fs.existsSync(full) || fs.statSync(full).isDirectory()) {
    return send(res, 404, "Not found", "text/plain");
  }
  res.setHeader("cache-control", "no-store, no-cache, must-revalidate");
  res.setHeader("pragma", "no-cache");
  res.setHeader("expires", "0");
  const ext = path.extname(full).toLowerCase();
  const type = ext === ".js" ? "application/javascript" : ext === ".css" ? "text/css" : "text/html";
  return send(res, 200, fs.readFileSync(full), type);
}

const server = http.createServer(async (req, res) => {
  try {
    assertLocalRequest(req);
    const parsed = new URL(req.url, "http://127.0.0.1");
    if (req.method === "POST") req.workbenchBody = await readBody(req);
    if (req.method === "GET" && parsed.pathname === "/api/workbench/capabilities") return send(res, 200, capabilities({ manageProjects: true }));
    if (req.method === "POST" && parsed.pathname === "/api/workbench/projects") return send(res, 201, workbench.createProject(JSON.parse(req.workbenchBody)));
    if (req.method === "POST" && ["/api/workbench/projects/rename", "/api/workbench/projects/remove"].includes(parsed.pathname)) {
      const payload = JSON.parse(req.workbenchBody);
      if (!availableRegistry().projects.some((entry) => entry.id === payload.projectId)) return send(res, 404, { error: "Project not found." });
      try {
        if (parsed.pathname.endsWith("/rename")) projectStore.renameProject(payload.projectId, payload.label);
        else projectStore.removeProject(payload.projectId);
      } catch (error) { return send(res, 400, { error: error.message }); }
      return send(res, 200, { ok: true, ...projectsResponse() });
    }
    if (req.method === "POST" && parsed.pathname === "/api/workbench/import") return send(res, 200, workbench.importAnimation(JSON.parse(req.workbenchBody)));
    if (req.method === "POST" && ["/api/workbench/animations/rename", "/api/workbench/animations/remove"].includes(parsed.pathname)) {
      const payload = JSON.parse(req.workbenchBody);
      const project = payload.projectId ? availableRegistry().projects.find(entry => entry.id === payload.projectId) : null;
      if (!project) return send(res, 404, { error: "Project not found.", code: "project_not_found" });
      if (projectEngine(project) !== "lite") return send(res, 400, { error: "Animation management requires an independent workspace.", code: "project_not_neutral" });
      return neutralApp.requestHandler(req, res);
    }
    if (req.method === "POST" && parsed.pathname === "/api/workbench/compress-png") {
      const payload = JSON.parse(req.workbenchBody);
      workbench.projectData(payload.projectId);
      const files = require("../export_package").decodeFiles([{ path: "export.png", data: payload.data }]);
      const report = await require("../png_compression").compressRuntimePngs(files, ["export.png"], payload.pngQuality);
      res.setHeader("x-frame-tuner-png-compression", JSON.stringify(report));
      return send(res, 200, files.get("export.png"), "image/png");
    }
    if (req.method === "POST" && parsed.pathname === "/api/workbench/export") {
      const payload = JSON.parse(req.workbenchBody);
      const result = await require("../export_package").buildExportPackage(payload, { projectData: workbench.projectData(payload.projectId), root: ROOT });
      res.setHeader("content-disposition", attachmentDisposition(result.filename));
      res.setHeader("x-frame-tuner-png-compression", JSON.stringify(result.pngCompression));
      return send(res, 200, result.buffer, "application/zip");
    }
    const neutralRoutes = new Set(["/api/save", "/api/lite/settings", "/api/duplicate-frame", "/api/delete-frame", "/api/frame-audio", "/api/attack-trail-texture", "/api/frame-attachment-image", "/api/replace-frame", "/api/replace-animation"]);
    if (req.method === "POST" && neutralRoutes.has(parsed.pathname)) {
      const payload = JSON.parse(req.workbenchBody);
      const { project } = projectFromRequest(payload.projectId || parsed.searchParams.get("project"));
      if (project) workbench.projectData(project.id);
      if (projectEngine(project) === "lite") return neutralApp.requestHandler(req, res);
      if (projectEngine(project) === "unsupported") return send(res, 400, { error: "Unsupported project kind; saving has been blocked.", code: "unsupported_engine" });
    }
    if (req.method === "GET" && parsed.pathname === "/api/update-status") {
      return send(res, 200, { ...checkForUpdates(ROOT), token: UPDATE_TOKEN, restarting: restartScheduled });
    }
    if (req.method === "POST" && parsed.pathname === "/api/update") {
      if (req.headers["x-xsxb-update-token"] !== UPDATE_TOKEN) {
        return send(res, 403, { error: "Invalid update token." });
      }
      if (restartScheduled) return send(res, 409, { error: "A tuner restart is already scheduled." });
      const update = performUpdate(ROOT);
      res.setHeader("connection", "close");
      send(res, 200, { ok: true, update });
      scheduleServerRestart();
      return;
    }
    if (req.method === "GET" && parsed.pathname === "/api/projects") {
      return send(res, 200, projectsResponse());
    }
    if (req.method === "POST" && parsed.pathname === "/api/projects") {
      const payload = JSON.parse(await readBody(req));
      const registry = projectStore.addProject(payload);
      return send(res, 200, {
        ok: true,
        ...projectsResponse(),
      });
    }
    if (req.method === "POST" && parsed.pathname === "/api/projects/active") {
      const payload = JSON.parse(await readBody(req));
      projectFromRequest(payload.projectId);
      const registry = projectStore.setActiveProject(payload.projectId);
      return send(res, 200, {
        ok: true,
        ...projectsResponse(),
      });
    }
    if (req.method === "GET" && parsed.pathname === "/api/config") {
      return send(res, 200, configResponse(parsed.searchParams.get("project")));
    }
    if (req.method === "POST" && parsed.pathname === "/api/unity-baked-frames") {
      const payload = JSON.parse(await readBody(req));
      const { project } = projectFromRequest(payload.projectId || parsed.searchParams.get("project"));
      if (projectEngine(project) !== "unity") return send(res, 400, { error: "Unity baked frames require a Unity project." });
      if (!Array.isArray(payload.bakedFrames)) return send(res, 400, { error: "bakedFrames must be an array." });
      const unitySync = syncUnityProject(ROOT, projectStore, project, { bakedFrames: payload.bakedFrames });
      return send(res, 200, { ok: true, engine: "unity", unitySync });
    }
    if (req.method === "POST" && parsed.pathname === "/api/duplicate-frame") {
      const payload = JSON.parse(await readBody(req));
      const { project } = projectFromRequest(payload.projectId || parsed.searchParams.get("project"));
      const currentRevision = projectConfigRevision(project);
      const suppliedRevision = String(payload.configRevision || "");
      if (payload.force !== true && suppliedRevision !== currentRevision) {
        return send(res, 409, {
          error: "服务器数据已被其他页面或工具更新，本次旧页面复制已阻止。请刷新页面后再操作。",
          code: "stale_config",
          configRevision: currentRevision,
        });
      }
      const duplicated = duplicateProjectFrame(project, payload);
      return send(res, 200, {
        ok: true,
        ...duplicated,
        configRevision: projectConfigRevision(project),
      });
    }
    if (req.method === "POST" && parsed.pathname === "/api/save") {
      const payload = JSON.parse(await readBody(req));
      const { project } = projectFromRequest(payload.projectId || parsed.searchParams.get("project"));
      const currentRevision = projectConfigRevision(project);
      const suppliedRevision = String(payload.configRevision || "");
      if (payload.force !== true && suppliedRevision !== currentRevision) {
        return send(res, 409, {
          error: "服务器数据已被其他页面或工具更新；本次旧页面保存已阻止。请刷新页面后再修改。",
          code: "stale_config",
          configRevision: currentRevision,
        });
      }
      const requestedUnityBakes = payload.unity_baked_frames || payload.unityBakedFrames;
      if (projectEngine(project) === "unity" && Array.isArray(requestedUnityBakes)
        && requestedUnityBakes.some((frame) => !frame?.mainAnchor
          || !Number.isFinite(Number(frame.mainAnchor.x))
          || !Number.isFinite(Number(frame.mainAnchor.y)))) {
        return send(res, 409, {
          error: "烘焙锚点格式已经更新，请刷新 Tuner 页面后重新保存。旧页面的烘焙结果已被阻止，现有游戏帧未被覆盖。",
          code: "stale_bake_client",
          configRevision: currentRevision,
        });
      }
      saveTuningPayload(payload, project);
      let frameAudioBindings = null;
      if (Array.isArray(payload.frame_audio_bindings) || Array.isArray(payload.frameAudioBindings) || payload.frameAudioBindings) {
        const requestedAudio = payload.frame_audio_bindings || payload.frameAudioBindings;
        const currentAudio = readFrameAudioBindings(project);
        frameAudioBindings = Array.isArray(requestedAudio) && requestedAudio.length === 0 && currentAudio.length > 0
          ? currentAudio
          : saveFrameAudioBindings(requestedAudio, project);
      }
      let frameImageAttachments = null;
      if (Array.isArray(payload.frame_image_attachments) || Array.isArray(payload.frameImageAttachments)) {
        frameImageAttachments = saveFrameImageAttachments(payload.frame_image_attachments || payload.frameImageAttachments, project);
      }
      const hasAttackTrails = Object.prototype.hasOwnProperty.call(payload, "attack_trails")
        || Object.prototype.hasOwnProperty.call(payload, "attackTrails");
      const attackTrails = hasAttackTrails
        ? saveAttackTrails(payload.attack_trails || payload.attackTrails || EMPTY_ATTACK_TRAILS, project)
        : readAttackTrails(project);
      const engine = projectEngine(project);
      const changedGroups = Array.isArray(payload.changed_groups || payload.changedGroups)
        ? (payload.changed_groups || payload.changedGroups).map(String).filter(Boolean)
        : null;
      const syncOptions = {
        ...(frameAudioBindings ? { frameAudioBindings } : {}),
        ...(frameImageAttachments ? { frameImageAttachments } : {}),
        ...(Array.isArray(payload.unity_baked_frames) || Array.isArray(payload.unityBakedFrames)
          ? { bakedFrames: payload.unity_baked_frames || payload.unityBakedFrames }
          : {}),
        ...(changedGroups ? { changedGroups } : {}),
        attackTrails,
      };
      const godotSync = engine === "godot" ? syncGodotProject(ROOT, projectStore, project, syncOptions) : null;
      const unitySync = engine === "unity" ? syncUnityProject(ROOT, projectStore, project, syncOptions) : null;
      const runtimeProjectIdFiles = engine === "godot" ? syncGodotRuntimeProjectId(project) : [];
      return send(res, 200, {
        ok: true,
        configRevision: projectConfigRevision(project),
        tuning: tuningForClient(readTuningFile(project)),
        engine,
        godotSync,
        unitySync,
        runtimeProjectIdFiles,
        warnings: validateProject(project, readManifest(project)),
      });
    }
    if (req.method === "POST" && parsed.pathname === "/api/attack-trail-texture") {
      const payload = JSON.parse(await readBody(req));
      const { project } = projectFromRequest(payload.projectId || parsed.searchParams.get("project"));
      return send(res, 200, { ok: true, texture: saveAttackTrailTexture(ROOT, projectStore, project, payload) });
    }
    if (req.method === "POST" && parsed.pathname === "/api/frame-audio") {
      const payload = JSON.parse(await readBody(req));
      const { project } = projectFromRequest(payload.projectId || parsed.searchParams.get("project"));
      const currentRevision = projectConfigRevision(project);
      if (payload.force !== true && String(payload.configRevision || "") !== currentRevision) {
        return send(res, 409, {
          error: "服务器数据已被其他页面或工具更新，本次旧页面音效同步已阻止。请刷新页面后再操作。",
          code: "stale_config",
          configRevision: currentRevision,
        });
      }
      if (!Array.isArray(payload.frameAudioBindings)) {
        return send(res, 400, { error: "frameAudioBindings 必须是数组，已阻止覆盖原音效。" });
      }
      const currentBindings = readFrameAudioBindings(project);
      if (!payload.frameAudioBindings.length && currentBindings.length && payload.allowEmpty !== true) {
        return send(res, 400, { error: "页面提交了空音效列表，但没有明确删除授权，已保留服务器上的音效。" });
      }
      const bindings = payload.frameAudioBindings;
      saveFrameAudioBindings(bindings, project);
      const engine = projectEngine(project);
      const godotAudioSync = engine === "godot" ? syncFrameAudio(ROOT, projectStore, project, bindings) : null;
      const unitySync = engine === "unity" ? syncUnityProject(ROOT, projectStore, project, { frameAudioBindings: bindings }) : null;
      return send(res, 200, {
        ok: true,
        configRevision: projectConfigRevision(project),
        engine,
        frameAudioCount: bindings.length,
        godotAudioSync,
        unitySync,
      });
    }
    if (req.method === "POST" && parsed.pathname === "/api/frame-attachment-image") {
      const payload = JSON.parse(await readBody(req));
      const { project } = projectFromRequest(payload.projectId || parsed.searchParams.get("project"));
      return send(res, 200, { ok: true, image: saveFrameAttachmentImage(payload, project) });
    }
    if (req.method === "POST" && parsed.pathname === "/api/replace-frame") {
      const payload = JSON.parse(await readBody(req));
      const { project } = projectFromRequest(payload.projectId || parsed.searchParams.get("project"));
      const frame = replaceFrameImage(payload, project);
      const unitySync = projectEngine(project) === "unity" ? syncUnityProject(ROOT, projectStore, project) : null;
      return send(res, 200, { ok: true, frame, unitySync });
    }
    if (req.method === "POST" && parsed.pathname === "/api/replace-animation") {
      const payload = JSON.parse(await readBody(req));
      const { project } = projectFromRequest(payload.projectId || parsed.searchParams.get("project"));
      const frames = Array.isArray(payload.frames) ? payload.frames : [];
      const files = Array.isArray(payload.files) ? payload.files : [];
      if (!frames.length || frames.length !== files.length) {
        return send(res, 400, { error: `Expected exactly ${frames.length} PNG files` });
      }
      const result = replaceAnimationImages(frames, files, project);
      const unitySync = projectEngine(project) === "unity" ? syncUnityProject(ROOT, projectStore, project) : null;
      return send(res, 200, { ok: true, frames: result, unitySync });
    }
    if (req.method === "GET" && parsed.pathname === "/asset") {
      const relPath = parsed.searchParams.get("path");
      const full = resolveWorkbenchAsset(ROOT, relPath);
      const ext = path.extname(full || "").toLowerCase();
      const imageTypes = {
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".webp": "image/webp",
        ".gif": "image/gif",
        ...neutralApp.AUDIO_MIME_BY_EXTENSION,
      };
      if (!full || !fs.existsSync(full) || !imageTypes[ext]) {
        return send(res, 404, "Not found", "text/plain");
      }
      res.writeHead(200, { "content-type": imageTypes[ext], "cache-control": "no-store" });
      return fs.createReadStream(full).pipe(res);
    }
    return serveStatic(req, res, parsed.pathname);
  } catch (error) {
    if (!error.status || error.status >= 500) console.error(error.message || error);
    if (error.status === 413) res.setHeader("connection", "close");
    return send(res, error.status || (error instanceof SyntaxError ? 400 : 500), { error: String(error.message || error), code: error.code || "request_failed" });
  }
});

if (require.main === module) server.listen(PORT, "127.0.0.1", () => {
  console.log(`XSXB Frame Tuner running at http://127.0.0.1:${PORT}`);
  console.log(`Workspace root: ${ROOT}`);
});
module.exports = { server, configResponse, workbench, replaceAnimationImages };
