const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
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
  readSharedAttackTrailPresetStore,
  normalizeSharedAttackTrailPresetStore,
  sharedAttackTrailPresetPath,
} = require("../attack_trail_presets");
const { EMPTY_MANIFEST, EMPTY_SETTINGS, EMPTY_TUNING, createLiteStore, reslash, slug } = require("./store");
const { withUtf8Charset } = require("../http_content_type");
const { assertLocalRequest, readRequestBody: readBody, attachmentDisposition } = require("../http_security");
const { createWorkbenchService, resolveWorkbenchAsset, commitImportFiles, pngBuffer } = require("../workbench_service");
const { adapterForProject } = require("../engine_adapters");

function createLiteApp(options = {}) {
const ROOT = path.resolve(options.root || process.env.FRAME_TUNER_ROOT || path.join(__dirname, "..", ".."));
const FULL_PUBLIC = path.resolve(__dirname, "..", "animation_tuner", "public");
const LITE_PUBLIC = path.join(__dirname, "public");
const PORT = Number(process.env.LITE_PORT || 5180);
const store = options.store || createLiteStore(ROOT);
const workbench = createWorkbenchService({ root: ROOT, store });

const clone = (value) => JSON.parse(JSON.stringify(value));
const vector = (value, fallback = { x: 0, y: 0 }) => ({ x: Number(value?.x ?? fallback.x), y: Number(value?.y ?? fallback.y) });
const scaleVector = (value, fallback = 1) => ({ x: Number(value?.x ?? fallback), y: Number(value?.y ?? fallback) });
const safeResolve = (base, value) => {
  const full = path.resolve(base, String(value || ""));
  return full === base || full.startsWith(`${base}${path.sep}`) ? full : null;
};
const isInside = (child, parent) => {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
};

const AUDIO_MIME_BY_EXTENSION = Object.freeze({
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".opus": "audio/ogg",
  ".wav": "audio/wav",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".flac": "audio/flac",
  ".webm": "audio/webm",
});
const AUDIO_EXTENSION_BY_MIME = Object.freeze({
  "audio/mpeg": ".mp3",
  "audio/mp3": ".mp3",
  "audio/ogg": ".ogg",
  "audio/opus": ".opus",
  "audio/wav": ".wav",
  "audio/x-wav": ".wav",
  "audio/mp4": ".m4a",
  "audio/aac": ".aac",
  "audio/flac": ".flac",
  "audio/webm": ".webm",
});

function audioBindingsArray(payload) {
  return Array.isArray(payload)
    ? payload.filter((entry) => entry && typeof entry === "object")
    : Object.entries(payload || {}).map(([key, value]) => ({
      key,
      ...(value && typeof value === "object" ? value : {}),
    }));
}

function audioExtension(binding, mime = "") {
  const named = path.extname(String(binding?.name || binding?.path || binding?.file || "")).toLowerCase();
  if (AUDIO_MIME_BY_EXTENSION[named]) return named;
  return AUDIO_EXTENSION_BY_MIME[String(mime || binding?.type || "").toLowerCase()] || "";
}

function prepareFrameAudioBindings(project, payload) {
  const target = store.paths(project);
  const workspace = target.workspaceDir;
  const audioDirectory = path.join(workspace, "audio");
  const bindings = [], writes = [];
  for (const input of audioBindingsArray(payload)) {
    const next = { ...input };
    delete next.data;
    delete next.file;
    const dataMatch = /^data:(audio\/[a-z0-9.+-]+)(?:;[^,]*)?;base64,([a-z0-9+/=\r\n]+)$/i.exec(String(input.data || ""));
    let full = null;
    let size;
    let mime = String(input.type || dataMatch?.[1] || "").toLowerCase();
    if (dataMatch) {
      const buffer = Buffer.from(dataMatch[2], "base64");
      const extension = audioExtension(input, dataMatch[1]);
      if (!buffer.length || !extension) throw new Error(`${input.name || "音效"}: 不支持的音频格式。`);
      const hash = crypto.createHash("sha256").update(buffer).digest("hex");
      full = path.join(audioDirectory, `${hash}${extension}`);
      writes.push([full, buffer]);
      size = buffer.length;
      mime = AUDIO_MIME_BY_EXTENSION[extension] || mime;
    } else {
      full = safeResolve(ROOT, input.path || input.file || "");
      const extension = path.extname(full || "").toLowerCase();
      if (!full || !isInside(full, workspace) || !fs.existsSync(full) || !AUDIO_MIME_BY_EXTENSION[extension]
          || !fs.statSync(full).isFile() || !isInside(fs.realpathSync(full), fs.realpathSync(workspace))) {
        throw Object.assign(new Error(`${input.name || "音效"}: 缺少可保存的音频数据或 Lite 稳定路径，已阻止覆盖原音效。`), { status: 400, code: "invalid_audio_path" });
      }
      mime = mime || AUDIO_MIME_BY_EXTENSION[extension];
      size = fs.statSync(full).size;
    }
    bindings.push({
      ...next,
      key: String(input.key || ""),
      name: path.basename(String(input.name || path.basename(full) || "audio")),
      type: mime,
      size,
      path: reslash(path.relative(ROOT, full)),
    });
  }
  return { bindings, writes };
}

function saveFrameAudioBindings(project, payload) {
  const { bindings, writes } = prepareFrameAudioBindings(project, payload);
  commitImportFiles([...writes, [store.paths(project).frameAudio, `${JSON.stringify(bindings, null, 2)}\n`]]);
  return bindings;
}

function send(res, status, body, contentType = "application/json") {
  const data = Buffer.isBuffer(body) ? body : Buffer.from(/^application\/json(?:\s*;|$)/i.test(contentType) ? JSON.stringify(body, null, 2) : String(body));
  res.writeHead(status, {
    "content-type": withUtf8Charset(contentType),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  res.end(data);
}


function pngSize(filePath) {
  try {
    const buffer = fs.readFileSync(filePath);
    if (buffer.length < 24 || buffer.toString("ascii", 1, 4) !== "PNG") return { width: 0, height: 0 };
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  } catch {
    return { width: 0, height: 0 };
  }
}

function normalizeManifest(raw) {
  return {
    schemaVersion: Number(raw?.schemaVersion || 1),
    profiles: (Array.isArray(raw?.profiles) ? raw.profiles : []).map((profile) => ({
      id: String(profile.id || profile.name || "sequence"),
      label: String(profile.label || profile.id || profile.name || "Sequence"),
      kind: "actor",
      sourceFacesLeft: profile.source_faces_left === true || profile.sourceFacesLeft === true,
      bodyScale: Math.max(0.001, Number(profile.bodyScale ?? 1)),
      runtimeScale: Math.max(0.001, Number(profile.runtimeScale ?? 1)),
      supports: Array.isArray(profile.supports) ? profile.supports : ["character_transform", "group_transform", "frame_transform", "frame_playback", "reference_frame"],
      animations: Array.isArray(profile.animations) ? profile.animations : [],
    })),
  };
}

function frameForClient(frame, index) {
  const relative = reslash(frame.path || "");
  const full = safeResolve(ROOT, relative);
  const size = full && fs.existsSync(full) ? pngSize(full) : {};
  return {
    id: String(frame.id || `frame_${String(index + 1).padStart(4, "0")}`),
    name: String(frame.name || path.basename(relative) || `frame_${index + 1}.png`),
    path: relative,
    duration: Number(frame.duration || 1),
    width: Number(frame.width || frame.crop?.width || size.width || 0),
    height: Number(frame.height || frame.crop?.height || size.height || 0),
    crop: frame.crop && typeof frame.crop === "object" ? {
      x: Number(frame.crop.x || 0), y: Number(frame.crop.y || 0),
      width: Number(frame.crop.width || frame.width || 0), height: Number(frame.crop.height || frame.height || 0),
      sheetWidth: Number(frame.crop.sheetWidth || size.width || 0), sheetHeight: Number(frame.crop.sheetHeight || size.height || 0),
    } : null,
    assetVersion: String(frame.assetVersion || ""),
  };
}

function buildGroups(manifest, tuning) {
  const groups = [];
  for (const profile of manifest.profiles) {
    for (const animation of profile.animations) {
      const id = String(animation.id || animation.name || "animation");
      const name = String(animation.name || id);
      const characterKey = `profiles.${profile.id}.character`;
      const groupKey = `profiles.${profile.id}.groups.${id}`;
      const frames = (animation.frames || []).map(frameForClient).filter((frame) => frame.path);
      if (!frames.length) continue;
      const defaultScale = Number(animation.defaultScale ?? 1);
      groups.push({
        name,
        animationId: id,
        loop: animation.loop !== false,
        sourceFacesLeft: profile.source_faces_left === true || profile.sourceFacesLeft === true,
        runtimeAnimation: `${profile.id}/${id}`,
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
        source: reslash(animation.source || path.dirname(frames[0]?.path || "")),
        speed: Number(animation.fps || 12),
        frames,
        previewOwner: String(animation.previewOwner || ""),
        attachTo: String(animation.attachTo || animation.previewOwner || ""),
        previewLayer: String(animation.previewLayer || "front") === "behind" ? "behind" : "front",
        attachedLayers: Array.isArray(animation.attachedLayers) ? animation.attachedLayers.map(String) : [],
        independentPlayback: animation.independentPlayback === true,
        sequenceOverlap: animation.sequenceOverlap === true,
        sequenceOverlapAlpha: Number(animation.sequenceOverlapAlpha ?? 0.48),
        characterScale: `${characterKey}.visual_size`, characterScaleVector: `${characterKey}.visual_scale`,
        characterOffset: `${characterKey}.offset`, characterRotation: `${characterKey}.rotation`,
        characterBaseScale: Number(profile.bodyScale || 1) * Number(profile.runtimeScale || 1),
        characterBaseScaleVector: tuning.values[`${characterKey}.visual_scale`] ?? null,
        characterBaseOffset: tuning.values[`${characterKey}.offset`] ?? { x: 0, y: 0 },
        characterBaseRotation: Number(tuning.values[`${characterKey}.rotation`] ?? 0),
        runtimeScale: Number(profile.runtimeScale || 1), bodyScale: Number(profile.bodyScale || 1),
        scale: `${groupKey}.visual_size`, scaleVector: `${groupKey}.visual_scale`, offset: `${groupKey}.offset`, rotation: `${groupKey}.rotation`,
        defaultScale, defaultScaleVector: animation.defaultScaleVector ? scaleVector(animation.defaultScaleVector, defaultScale) : null,
        defaultOffset: vector(animation.defaultOffset), defaultRotation: Number(animation.defaultRotation || 0),
        baseScale: tuning.values[`${groupKey}.visual_size`] ?? defaultScale,
        baseScaleVector: tuning.values[`${groupKey}.visual_scale`] ?? animation.defaultScaleVector ?? null,
        baseOffset: tuning.values[`${groupKey}.offset`] ?? animation.defaultOffset ?? { x: 0, y: 0 },
        baseRotation: Number(tuning.values[`${groupKey}.rotation`] ?? animation.defaultRotation ?? 0),
      });
    }
  }
  return groups;
}

function projectData(project) {
  store.ensureProjectFiles(project);
  const target = store.paths(project);
  const manifest = normalizeManifest(store.readJson(target.manifest, EMPTY_MANIFEST));
  const tuning = store.readJson(target.tuning, EMPTY_TUNING);
  tuning.values = tuning.values && typeof tuning.values === "object" ? tuning.values : {};
  const localAttackTrails = normalizeAttackTrails(store.readJson(target.attackTrails, EMPTY_ATTACK_TRAILS));
  const attackTrails = attackTrailsWithSharedPresets(ROOT, `lite:${project.id}`, localAttackTrails);
  const audio = audioBindingsArray(store.readJson(target.frameAudio, []));
  const attachments = store.readJson(target.frameImageAttachments, []);
  const rawSettings = store.readJson(target.settings, EMPTY_SETTINGS);
  const settings = {
    schemaVersion: 1,
    canvas: rawSettings.canvas && typeof rawSettings.canvas === "object" ? rawSettings.canvas : { ...EMPTY_SETTINGS.canvas },
    export: {
      sheetColumns: Math.min(64, Math.max(1, Math.round(Number(rawSettings.export?.sheetColumns || 8)))),
    },
  };
  if (JSON.stringify(rawSettings) !== JSON.stringify(settings)) store.writeJson(target.settings, settings);
  return { target, manifest, tuning, attackTrails, audio, attachments: Array.isArray(attachments) ? attachments : [], settings };
}

function projectConfigRevision(project) {
  const target = store.paths(project);
  const hash = crypto.createHash("sha256");
  for (const filePath of [
    target.manifest,
    target.tuning,
    target.frameAudio,
    target.frameImageAttachments,
    target.attackTrails,
    sharedAttackTrailPresetPath(ROOT),
  ]) {
    hash.update(path.basename(filePath));
    hash.update("\0");
    hash.update(fs.existsSync(filePath) ? fs.readFileSync(filePath) : Buffer.alloc(0));
    hash.update("\0");
  }
  return hash.digest("hex");
}

function remapFrameOverrideDictionary(source, framePrefix, frameIndex) {
  const result = {};
  for (const [key, value] of Object.entries(source || {})) {
    if (!key.startsWith(framePrefix) || !/^\d+$/.test(key.slice(framePrefix.length))) {
      result[key] = value;
      continue;
    }
    const currentFrame = Number(key.slice(framePrefix.length));
    result[`${framePrefix}${currentFrame > frameIndex ? currentFrame + 1 : currentFrame}`] = value;
    if (currentFrame === frameIndex) result[`${framePrefix}${frameIndex + 1}`] = structuredClone(value);
  }
  return result;
}

function bindingAtFrame(entry, frameIndex, options = {}) {
  const next = structuredClone(entry);
  const replaceFrameSuffix = (value) => String(value || "").replace(/:\d+$/, `:${frameIndex}`);
  if (next.key) next.key = replaceFrameSuffix(next.key);
  if (next.frameKey) next.frameKey = replaceFrameSuffix(next.frameKey);
  if (Number.isFinite(Number(next.frame))) next.frame = frameIndex;
  if (Number.isFinite(Number(next.displayFrame))) next.displayFrame = frameIndex;
  if (Object.hasOwn(next, "frameIndex")) next.frameIndex = frameIndex;
  if (next.metadata && typeof next.metadata === "object") {
    next.metadata.frame = frameIndex;
    next.metadata.displayFrame = frameIndex;
    if (Object.hasOwn(next.metadata, "frameIndex")) next.metadata.frameIndex = frameIndex;
  }
  if (options.newId && next.id) next.id = `layer_${crypto.randomBytes(10).toString("hex")}`;
  return next;
}

function duplicateFrameBindings(entries, profileId, animationId, frameIndex, options = {}) {
  const result = [];
  for (const entry of Array.isArray(entries) ? entries : []) {
    const currentFrame = frameBindingIndex(entry, options.projectId, profileId, animationId);
    if (currentFrame === null) {
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
  const frameIndex = Number(payload.frameIndex);
  const target = store.paths(project);
  const manifest = store.readJson(target.manifest, EMPTY_MANIFEST);
  const profile = (Array.isArray(manifest.profiles) ? manifest.profiles : []).find((entry) => String(entry.id) === profileId);
  const animation = profile?.animations?.find((entry) => String(entry.id || entry.name) === animationId);
  const frames = Array.isArray(animation?.frames) ? animation.frames : null;
  if (!["number", "string"].includes(typeof payload.frameIndex) || String(payload.frameIndex).trim() === "" || !Number.isInteger(frameIndex) || frameIndex < 0 || !profile || !animation || !frames || frameIndex >= frames.length) {
    throw new Error(`Frame not found: ${profileId}/${animationId}:${frameIndex}`);
  }
  const copiedFrame = structuredClone(frames[frameIndex]);
  copiedFrame.id = `${String(copiedFrame.id || `frame_${frameIndex + 1}`)}_copy_${crypto.randomBytes(5).toString("hex")}`;
  frames.splice(frameIndex + 1, 0, copiedFrame);

  const tuning = store.readJson(target.tuning, EMPTY_TUNING);
  const framePrefix = `${profileId}/${animationId}:`;
  for (const field of ["frame_visual_overrides", "frame_playback_overrides", "frame_box_overrides", "attack_vfx_frame_overrides", "attack_vfx_playback_overrides"]) {
    if (tuning[field] !== undefined) tuning[field] = remapFrameOverrideDictionary(tuning[field], framePrefix, frameIndex);
  }
  const audio = duplicateFrameBindings(audioBindingsArray(store.readJson(target.frameAudio, [])), profileId, animationId, frameIndex, { projectId: project.id });
  const attachments = duplicateFrameBindings(store.readJson(target.frameImageAttachments, []), profileId, animationId, frameIndex, { projectId: project.id, newId: true });
  const trails = duplicateTrailFrameSlices(store.readJson(target.attackTrails, EMPTY_ATTACK_TRAILS), `${profileId}/${animationId}`, frameIndex);
  const settings = store.readJson(target.settings, EMPTY_SETTINGS);
  const warnings = validateLiteProject(project, { target, manifest, audio, settings, attackTrails: normalizeAttackTrails(trails) });
  commitImportFiles([[target.manifest, manifest], [target.tuning, tuning], [target.frameAudio, audio], [target.frameImageAttachments, attachments], [target.attackTrails, trails]].map(([file, value]) => [file, `${JSON.stringify(value, null, 2)}\n`]));
  return { frameIndex: frameIndex + 1, frameCount: frames.length, warnings };
}

function deleteFrameOverrideDictionary(source, framePrefix, frameIndex) {
  const result = {};
  for (const [key, value] of Object.entries(source || {})) {
    const suffix = key.startsWith(framePrefix) ? key.slice(framePrefix.length) : "";
    if (!/^\d+$/.test(suffix)) { result[key] = value; continue; }
    const index = Number(suffix);
    if (index !== frameIndex) result[`${framePrefix}${index > frameIndex ? index - 1 : index}`] = value;
  }
  return result;
}

function frameBindingIndex(entry, projectId, profileId, animationId) {
  const animationMatches = (name) => name === animationId || name === `${profileId}/${animationId}`;
  const projectMatches = (id) => !projectId || !id || id === "legacy" || id === projectId;
    const raw = { ...entry, ...(entry?.metadata && typeof entry.metadata === "object" ? entry.metadata : {}) };
    let index = null;
    if (projectMatches(raw.projectId) && (!raw.profileId || raw.profileId === profileId) && (!raw.animation || animationMatches(raw.animation))) {
      const rawFrame = raw.frame ?? raw.frameIndex;
      if (raw.profileId === profileId && animationMatches(raw.animation) && rawFrame !== undefined && rawFrame !== null && Number.isInteger(Number(rawFrame)) && Number(rawFrame) >= 0) index = Number(rawFrame);
      if (index === null) for (const key of [entry?.key, entry?.frameKey]) {
        const text = String(key || ""), prefix = `${profileId}/${animationId}:`;
        if (text.startsWith(prefix) && /^\d+$/.test(text.slice(prefix.length))) { index = Number(text.slice(prefix.length)); break; }
        const parts = text.split(":");
        if (!/^\d+$/.test(parts.at(-1) || "")) continue;
        if ((parts.length >= 7 && projectMatches(parts[0]) && parts[2] === profileId && animationMatches(parts[4]))
          || (parts.length === 6 && parts[1] === profileId && animationMatches(parts[3]))) { index = Number(parts.at(-1)); break; }
      }
    }
  return index;
}

function deleteFrameBindings(entries, projectId, profileId, animationId, frameIndex) {
  const result = [];
  for (const entry of Array.isArray(entries) ? entries : []) {
    const index = frameBindingIndex(entry, projectId, profileId, animationId);
    if (index === frameIndex) continue;
    if (index !== null && index > frameIndex) {
      const shifted = bindingAtFrame(entry, index - 1);
      result.push(shifted);
    } else result.push(entry);
  }
  return result;
}

function deleteTrailFrameSlices(trails, bindingKey, frameIndex) {
  const next = structuredClone(trails);
  for (const segment of Array.isArray(next.bindings?.[bindingKey]) ? next.bindings[bindingKey] : []) {
    if (Array.isArray(segment.sticks)) segment.sticks = segment.sticks.filter((stick) => Number(stick.frame) !== frameIndex).map((stick) => Number(stick.frame) > frameIndex ? { ...stick, frame: Number(stick.frame) - 1 } : stick);
    if (segment.frameSlices && typeof segment.frameSlices === "object" && !Array.isArray(segment.frameSlices)) segment.frameSlices = deleteFrameOverrideDictionary(segment.frameSlices, "", frameIndex);
  }
  return next;
}

function deleteProjectFrame(project, payload) {
  const profileId = String(payload.profileId || ""), animationId = String(payload.animationId || "");
  const frameIndex = Number(payload.frameIndex);
  const target = store.paths(project);
  const manifest = store.readJson(target.manifest, EMPTY_MANIFEST);
  const profile = manifest.profiles?.find((entry) => String(entry.id) === profileId);
  const animation = profile?.animations?.find((entry) => String(entry.id || entry.name) === animationId);
  const frames = animation?.frames;
  if (!["number", "string"].includes(typeof payload.frameIndex) || String(payload.frameIndex).trim() === "" || !Number.isInteger(frameIndex) || frameIndex < 0 || !Array.isArray(frames) || frameIndex >= frames.length) {
    throw Object.assign(new Error(`Frame not found: ${profileId}/${animationId}:${payload.frameIndex}`), { status: 400, code: "invalid_frame" });
  }
  if (frames.length <= 1) throw Object.assign(new Error("An animation must retain at least one frame."), { status: 400, code: "last_frame" });
  frames.splice(frameIndex, 1);
  const tuning = store.readJson(target.tuning, EMPTY_TUNING);
  for (const field of ["frame_visual_overrides", "frame_playback_overrides", "frame_box_overrides", "attack_vfx_frame_overrides", "attack_vfx_playback_overrides"]) {
    if (tuning[field] !== undefined) tuning[field] = deleteFrameOverrideDictionary(tuning[field], `${profileId}/${animationId}:`, frameIndex);
  }
  const audio = deleteFrameBindings(audioBindingsArray(store.readJson(target.frameAudio, [])), project.id, profileId, animationId, frameIndex);
  const attachments = deleteFrameBindings(store.readJson(target.frameImageAttachments, []), project.id, profileId, animationId, frameIndex);
  const trails = deleteTrailFrameSlices(store.readJson(target.attackTrails, EMPTY_ATTACK_TRAILS), `${profileId}/${animationId}`, frameIndex);
  const settings = store.readJson(target.settings, EMPTY_SETTINGS);
  // Validate without projectData(), which also migrates shared preset state.
  const warnings = validateLiteProject(project, { target, manifest, audio, settings, attackTrails: normalizeAttackTrails(trails) });
  // Reuse import's staged writes and rollback so a reported disk failure does
  // not leave frame indices out of sync across the five authored files.
  commitImportFiles([
    [target.manifest, manifest], [target.tuning, tuning], [target.frameAudio, audio],
    [target.frameImageAttachments, attachments], [target.attackTrails, trails],
  ].map(([file, value]) => [file, `${JSON.stringify(value, null, 2)}\n`]));
  return { frameIndex: Math.min(frameIndex, frames.length - 1), frameCount: frames.length, warnings };
}

function validateLiteProject(project, data = projectData(project)) {
  const warnings = [];
  const ids = new Set();
  for (const profile of data.manifest.profiles) {
    for (const animation of profile.animations) {
      const key = `${profile.id}/${animation.id || animation.name}`;
      ids.add(key);
      if (!(animation.frames || []).length) warnings.push(`${key}: 没有帧。`);
      for (const [index, frame] of (animation.frames || []).entries()) {
        const full = safeResolve(ROOT, frame.path);
        if (!full || !fs.existsSync(full)) warnings.push(`${key}: 缺少第 ${index + 1} 帧：${frame.path || "(empty)"}`);
      }
    }
  }
  warnings.push(...validateAttackTrails(data.attackTrails, { profiles: data.manifest.profiles }));
  for (const binding of data.audio) {
    const full = safeResolve(ROOT, binding.path || binding.file || "");
    if (!full || !isInside(full, data.target.workspaceDir) || !fs.existsSync(full)) {
      warnings.push(`${binding.name || "音效"}: Lite 音频文件不存在或不在当前项目稳定目录。`);
    }
  }
  const width = Number(data.settings.canvas?.width || 0);
  const height = Number(data.settings.canvas?.height || 0);
  if (data.settings.canvas?.autoMeasured === true && (width < 1 || height < 1 || width > 8192 || height > 8192)) warnings.push("已计算的统一透明画布尺寸必须在 1-8192 px。 ");
  return warnings;
}

function configResponse(projectId) {
  const registry = store.readRegistry();
  const project = store.resolveProject(projectId);
  const projects = registry.projects.map(store.projectForClient);
  if (!project) {
    return {
      root: ROOT, workspaceRoot: path.join(ROOT, "workspace", "lite"), workspaceAllRoot: path.join(ROOT, "workspace", "lite"), projectRoot: "",
      activeProjectId: "", activeProject: null, projects, scenes: [], profiles: [], frameAudioBindings: [], frameImageAttachments: [],
      attackTrails: EMPTY_ATTACK_TRAILS, tuning: clone(EMPTY_TUNING), warnings: ["还没有素材。新建项目并导入 PNG 序列或 PNG + JSON 图集即可开始。"],
      references: {}, projectKind: "frame_lite", projectEngine: "lite", capabilities: workbench.capabilities(), liteSettings: clone(EMPTY_SETTINGS), groups: [], configRevision: "",
    };
  }
  workbench.projectData(project.id);
  const data = projectData(project);
  return {
    root: ROOT, workspaceRoot: data.target.workspaceDir, workspaceAllRoot: path.join(ROOT, "workspace", "lite"), projectRoot: "",
    activeProjectId: project.id, activeProject: store.projectForClient(project), projects, scenes: [],
    profiles: data.manifest.profiles.map((profile) => ({ id: profile.id, label: profile.label, kind: profile.kind, sourceFacesLeft: profile.sourceFacesLeft === true, scale_semantic: "character_group_frame", anchor_mode: "manifest_anchor_mode", supports: profile.supports })),
    frameAudioBindings: data.audio, frameImageAttachments: data.attachments, attackTrails: data.attackTrails,
    tuning: { ...data.tuning.values, scene_settings: data.tuning.scene_settings || {}, frame_visual_overrides: data.tuning.frame_visual_overrides || {}, frame_playback_overrides: data.tuning.frame_playback_overrides || {}, frame_box_overrides: data.tuning.frame_box_overrides || {}, attack_vfx_frame_overrides: data.tuning.attack_vfx_frame_overrides || {}, attack_vfx_playback_overrides: data.tuning.attack_vfx_playback_overrides || {} },
    tuningDefaults: {}, bossTuning: {}, act2StatueBossTuning: {}, act2StatueBossDefaults: {}, huangXianTuning: {}, huangXianDefaults: {}, huangXianManifest: {}, soulTuning: {}, soulDefaults: {}, soulManifest: {}, yechengPropTuning: {}, yechengPropDefaults: {},
    warnings: validateLiteProject(project, data), references: {}, projectKind: "frame_lite", projectEngine: "lite", capabilities: adapterForProject(project), liteSettings: data.settings,
    configRevision: projectConfigRevision(project),
    groups: buildGroups(data.manifest, data.tuning),
  };
}

function saveAttachmentImage(project, payload) {
  const match = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=\r\n]+)$/i.exec(String(payload.data || ""));
  if (!match) throw new Error("Expected an image data URL.");
  const buffer = Buffer.from(match[2], "base64");
  const hash = crypto.createHash("sha256").update(buffer).digest("hex");
  const extension = match[1].toLowerCase() === "image/png" ? ".png" : match[1].toLowerCase() === "image/webp" ? ".webp" : match[1].toLowerCase() === "image/gif" ? ".gif" : ".jpg";
  const full = path.join(store.paths(project).workspaceDir, "attachments", `${hash}${extension}`);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  if (!fs.existsSync(full)) fs.writeFileSync(full, buffer);
  const size = extension === ".png" ? pngSize(full) : {};
  return { path: reslash(path.relative(ROOT, full)), assetHash: hash, name: String(payload.name || path.basename(full)), type: match[1].toLowerCase(), width: Number(payload.width || size.width || 0), height: Number(payload.height || size.height || 0) };
}

function prepareReplacementFrame(project, payload) {
  const full = safeResolve(ROOT, payload.path);
  const workspace = store.paths(project).workspaceDir;
  if (!full || !isInside(full, workspace) || path.extname(full).toLowerCase() !== ".png"
      || !fs.existsSync(full) || !fs.statSync(full).isFile()
      || !isInside(fs.realpathSync(full), fs.realpathSync(workspace))) throw Object.assign(new Error("Frame replacement must be an existing PNG inside the active Lite workspace."), { status: 400, code: "invalid_frame_path" });
  const { buffer, width, height } = pngBuffer({ name: path.basename(full), data: payload.data });
  return { full, buffer, result: { path: reslash(path.relative(ROOT, full)), width, height } };
}

function replaceFrame(project, payload) {
  const prepared = prepareReplacementFrame(project, payload);
  commitImportFiles([[prepared.full, prepared.buffer]]);
  return prepared.result;
}

function replaceAnimationFrames(project, frames, files) {
  const prepared = frames.map((frame, index) => prepareReplacementFrame(project, { path: frame.path, data: files[index].data }));
  const unique = new Map();
  for (const frame of prepared) {
    const resolved = fs.realpathSync(frame.full);
    const key = process.platform === "win32" ? resolved.toLowerCase() : resolved;
    if (unique.has(key) && !unique.get(key).buffer.equals(frame.buffer)) throw Object.assign(new Error("Multiple frames share one image path; provide identical replacement bytes or import a new animation."), { status: 400, code: "shared_frame_path" });
    unique.set(key, frame);
  }
  commitImportFiles([...unique.values()].map((frame) => [frame.full, frame.buffer]));
  return prepared.map((frame) => frame.result);
}

function savePayload(project, payload) {
  const target = store.paths(project);
  const tuning = store.readJson(target.tuning, EMPTY_TUNING);
  for (const field of ["values", "scene_settings", "frame_visual_overrides", "frame_playback_overrides", "frame_box_overrides", "attack_vfx_frame_overrides", "attack_vfx_playback_overrides"]) {
    if (!Object.hasOwn(payload, field)) continue;
    if (!payload[field] || typeof payload[field] !== "object" || Array.isArray(payload[field])) throw new Error(`${field} must be an object.`);
    tuning[field] = payload[field];
  }
  const requestedAudio = payload.frame_audio_bindings || payload.frameAudioBindings || [];
  const currentAudio = audioBindingsArray(store.readJson(target.frameAudio, []));
  if (Object.hasOwn(payload, "frame_image_attachments") && !Array.isArray(payload.frame_image_attachments)) throw new Error("frame_image_attachments must be an array.");
  const attachments = payload.frame_image_attachments ?? store.readJson(target.frameImageAttachments, []);
  const trailsProvided = Object.hasOwn(payload, "attack_trails");
  if (trailsProvided && (!payload.attack_trails || typeof payload.attack_trails !== "object" || Array.isArray(payload.attack_trails))) throw new Error("attack_trails must be an object.");
  const existingTrails = store.readJson(target.attackTrails, EMPTY_ATTACK_TRAILS);
  const trails = normalizeAttackTrails(trailsProvided ? payload.attack_trails : existingTrails);
  for (const segments of Object.values(trails.bindings)) {
    for (const segment of segments) {
      const texture = safeResolve(ROOT, segment.texture?.path || "");
      if (texture && fs.existsSync(texture)) {
        const info = pngInfo(fs.readFileSync(texture));
        segment.texture.width = info.width; segment.texture.height = info.height; segment.texture.hasEffectiveAlpha = info.hasEffectiveAlpha;
      }
      if (segment.colorMode === "original" && !segment.texture?.hasEffectiveAlpha) throw new Error(`${segment.name}: 原色模式需要带有效 Alpha 的 RGBA PNG。`);
    }
  }
  const prepared = Array.isArray(requestedAudio) && requestedAudio.length === 0 && currentAudio.length > 0
    ? { bindings: currentAudio, writes: [] }
    : prepareFrameAudioBindings(project, requestedAudio);
  const audio = prepared.bindings;
  const projectTrails = trailsProvided ? attackTrailsWithoutSharedPresets(trails) : existingTrails;
  const jsonWrites = [[target.tuning, tuning], [target.frameAudio, audio], [target.frameImageAttachments, attachments], [target.attackTrails, projectTrails]];
  if (trailsProvided) {
    const shared = readSharedAttackTrailPresetStore(ROOT);
    shared.presets = trails.presets;
    const id = `lite:${project.id}`;
    if (!shared.migratedProjectIds.includes(id)) shared.migratedProjectIds.push(id);
    jsonWrites.push([sharedAttackTrailPresetPath(ROOT), normalizeSharedAttackTrailPresetStore(shared)]);
  }
  commitImportFiles([...prepared.writes, ...jsonWrites.map(([file, value]) => [file, `${JSON.stringify(value, null, 2)}\n`])]);
  return { tuning, audio, attachments, trails: projectTrails };
}

function serveIndex(res) {
  let html = fs.readFileSync(path.join(FULL_PUBLIC, "index.html"), "utf8");
  html = html.replace("<title>XSXB Frame Tuner</title>", "<title>XSXB Frame Tuner Lite</title>")
    .replace("<h1>XSXB Frame Tuner</h1>", "<h1>XSXB Frame Tuner Lite</h1>")
    .replace("<h1>Frame Tuner</h1>", "<h1>Frame Tuner Lite</h1>");
  if (!html.includes('href="/lite.css"')) html = html.replace("</head>", "  <link rel=\"stylesheet\" href=\"/lite.css\" />\n  </head>");
  if (!html.includes('src="/lite.js"')) html = html.replace("</body>", "    <script src=\"/lite.js\"></script>\n  </body>");
  return send(res, 200, html, "text/html; charset=utf-8");
}

function serveStatic(res, pathname) {
  if (pathname === "/") return serveIndex(res);
  const lite = pathname === "/lite.js" || pathname === "/lite.css";
  const base = lite ? LITE_PUBLIC : FULL_PUBLIC;
  const full = safeResolve(base, pathname.slice(1));
  if (!full || !fs.existsSync(full) || fs.statSync(full).isDirectory()) return send(res, 404, "Not found", "text/plain");
  const ext = path.extname(full).toLowerCase();
  const type = ext === ".js" ? "application/javascript; charset=utf-8" : ext === ".css" ? "text/css; charset=utf-8" : ext === ".png" ? "image/png" : "application/octet-stream";
  return send(res, 200, fs.readFileSync(full), type);
}

const requestHandler = async (req, res) => {
  try {
    assertLocalRequest(req);
    const url = new URL(req.url, "http://127.0.0.1");
    if (req.method === "POST") {
      req.workbenchBody = await readBody(req);
      const payload = JSON.parse(req.workbenchBody);
      if (!["/api/workbench/projects", "/api/projects/active"].includes(url.pathname) && payload.projectId) workbench.projectData(payload.projectId);
    }
    if (req.method === "GET" && url.pathname === "/api/workbench/capabilities") return send(res, 200, workbench.capabilities());
    if (req.method === "POST" && url.pathname === "/api/workbench/projects") return send(res, 201, workbench.createProject(JSON.parse(await readBody(req))));
    if (req.method === "POST" && url.pathname === "/api/workbench/import") return send(res, 200, workbench.importAnimation(JSON.parse(await readBody(req))));
    if (req.method === "POST" && ["/api/workbench/animations/rename", "/api/workbench/animations/remove"].includes(url.pathname)) {
      const payload = JSON.parse(await readBody(req));
      const project = payload.projectId ? store.resolveProject(payload.projectId) : null;
      if (!project) return send(res, 404, { error: "Lite project not found.", code: "project_not_found" });
      const currentRevision = projectConfigRevision(project);
      if (String(payload.configRevision || "") !== currentRevision) return send(res, 409, {
        error: "服务器数据已更新，请刷新后再管理动作。", code: "stale_config", configRevision: currentRevision,
      });
      const result = url.pathname.endsWith("/rename") ? workbench.renameAnimation(payload) : workbench.removeAnimation(payload);
      return send(res, 200, { ...result, configRevision: projectConfigRevision(project) });
    }
    if (req.method === "POST" && url.pathname === "/api/workbench/compress-png") {
      const payload = JSON.parse(await readBody(req));
      workbench.projectData(payload.projectId);
      const files = require("../export_package").decodeFiles([{ path: "export.png", data: payload.data }]);
      const report = await require("../png_compression").compressRuntimePngs(files, ["export.png"], payload.pngQuality);
      res.setHeader("x-frame-tuner-png-compression", JSON.stringify(report));
      return send(res, 200, files.get("export.png"), "image/png");
    }
    if (req.method === "POST" && url.pathname === "/api/workbench/export") {
      const payload = JSON.parse(await readBody(req));
      const result = await require("../export_package").buildExportPackage(payload, { projectData: workbench.projectData(payload.projectId), root: ROOT });
      res.setHeader("content-disposition", attachmentDisposition(result.filename));
      res.setHeader("x-frame-tuner-png-compression", JSON.stringify(result.pngCompression));
      return send(res, 200, result.buffer, "application/zip");
    }
    if (req.method === "GET" && url.pathname === "/api/update-status") return send(res, 200, { updateAvailable: false, lite: true });
    if (req.method === "GET" && url.pathname === "/api/projects") {
      const registry = store.readRegistry();
      return send(res, 200, { activeProjectId: registry.activeProjectId, projects: registry.projects.map(store.projectForClient) });
    }
    if (req.method === "POST" && url.pathname === "/api/projects/active") {
      const payload = JSON.parse(await readBody(req));
      const registry = store.setActiveProject(payload.projectId);
      return send(res, 200, { ok: true, activeProjectId: registry.activeProjectId, projects: registry.projects.map(store.projectForClient) });
    }
    if (req.method === "GET" && url.pathname === "/api/config") return send(res, 200, configResponse(url.searchParams.get("project")));
    if (req.method === "POST" && url.pathname === "/api/delete-frame") {
      const payload = JSON.parse(await readBody(req));
      const project = payload.projectId ? store.resolveProject(payload.projectId) : null;
      if (!project) return send(res, 404, { error: "Lite project not found." });
      const currentRevision = projectConfigRevision(project);
      if (String(payload.configRevision || "") !== currentRevision) return send(res, 409, {
        error: "服务器数据已被其他页面或工具更新，本次旧页面删除已阻止。请刷新页面后再操作。",
        code: "stale_config", configRevision: currentRevision,
      });
      const deleted = deleteProjectFrame(project, payload);
      return send(res, 200, { ok: true, ...deleted, configRevision: projectConfigRevision(project) });
    }
    if (req.method === "POST" && url.pathname === "/api/duplicate-frame") {
      const payload = JSON.parse(await readBody(req));
      const project = store.resolveProject(payload.projectId);
      if (!project) return send(res, 404, { error: "Lite project not found." });
      const currentRevision = projectConfigRevision(project);
      if (payload.force !== true && String(payload.configRevision || "") !== currentRevision) {
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
    if (req.method === "POST" && url.pathname === "/api/save") {
      const payload = JSON.parse(await readBody(req));
      const project = store.resolveProject(payload.projectId);
      if (!project) return send(res, 404, { error: "Lite project not found." });
      const currentRevision = projectConfigRevision(project);
      if (payload.force !== true && String(payload.configRevision || "") !== currentRevision) {
        return send(res, 409, {
          error: "服务器数据已被其他页面或工具更新，本次旧页面保存已阻止。请刷新页面后再操作。",
          code: "stale_config",
          configRevision: currentRevision,
        });
      }
      const saved = savePayload(project, payload);
      return send(res, 200, {
        ok: true,
        configRevision: projectConfigRevision(project),
        warnings: validateLiteProject(project),
        godotSync: null,
        frameAudioCount: saved.audio.length,
      });
    }
    if (req.method === "POST" && url.pathname === "/api/attack-trail-texture") {
      const payload = JSON.parse(await readBody(req));
      const project = store.resolveProject(payload.projectId);
      if (!project) return send(res, 404, { error: "Lite project not found." });
      return send(res, 200, { ok: true, texture: saveAttackTrailTexture(ROOT, store, project, payload) });
    }
    if (req.method === "POST" && url.pathname === "/api/frame-attachment-image") {
      const payload = JSON.parse(await readBody(req));
      const project = store.resolveProject(payload.projectId);
      return send(res, 200, { ok: true, image: saveAttachmentImage(project, payload) });
    }
    if (req.method === "POST" && url.pathname === "/api/replace-frame") {
      const payload = JSON.parse(await readBody(req));
      const project = store.resolveProject(payload.projectId);
      return send(res, 200, { ok: true, frame: replaceFrame(project, payload) });
    }
    if (req.method === "POST" && url.pathname === "/api/replace-animation") {
      const payload = JSON.parse(await readBody(req));
      const project = store.resolveProject(payload.projectId);
      const frames = Array.isArray(payload.frames) ? payload.frames : [];
      const files = Array.isArray(payload.files) ? payload.files : [];
      if (!frames.length || frames.length !== files.length) return send(res, 400, { error: "Replacement PNG count must match the animation frame count." });
      return send(res, 200, { ok: true, frames: replaceAnimationFrames(project, frames, files) });
    }
    if (req.method === "POST" && url.pathname === "/api/lite/settings") {
      const payload = JSON.parse(await readBody(req));
      const project = store.resolveProject(payload.projectId);
      const settings = {
        schemaVersion: 1,
        canvas: {
          width: Math.min(8192, Math.max(1, Math.round(Number(payload.canvas?.width || 1024)))),
          height: Math.min(8192, Math.max(1, Math.round(Number(payload.canvas?.height || 1024)))),
          originPixelX: Number(payload.canvas?.originPixelX ?? 512),
          originPixelY: Number(payload.canvas?.originPixelY ?? 880),
          padding: Math.min(1024, Math.max(0, Math.round(Number(payload.canvas?.padding ?? 24)))),
          autoMeasured: payload.canvas?.autoMeasured === true,
        },
        export: {
          sheetColumns: Math.min(64, Math.max(1, Math.round(Number(payload.export?.sheetColumns || 8)))),
        },
      };
      store.writeJson(store.paths(project).settings, settings);
      return send(res, 200, { ok: true, settings });
    }
    if (req.method === "POST" && url.pathname === "/api/frame-audio") {
      const payload = JSON.parse(await readBody(req));
      const project = store.resolveProject(payload.projectId);
      if (!project) return send(res, 404, { error: "Lite project not found." });
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
      const currentBindings = audioBindingsArray(store.readJson(store.paths(project).frameAudio, []));
      if (!payload.frameAudioBindings.length && currentBindings.length && payload.allowEmpty !== true) {
        return send(res, 400, { error: "页面提交了空音效列表，但没有明确删除授权，已保留服务器上的音效。" });
      }
      const bindings = saveFrameAudioBindings(project, payload.frameAudioBindings || []);
      return send(res, 200, {
        ok: true,
        configRevision: projectConfigRevision(project),
        frameAudioCount: bindings.length,
        frameAudioBindings: bindings,
        godotAudioSync: null,
      });
    }
    if (req.method === "GET" && url.pathname === "/asset") {
      const full = resolveWorkbenchAsset(ROOT, url.searchParams.get("path"));
      const types = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif", ...AUDIO_MIME_BY_EXTENSION };
      const type = types[path.extname(full || "").toLowerCase()];
      if (!full || !fs.existsSync(full) || !type) return send(res, 404, "Not found", "text/plain");
      res.writeHead(200, { "content-type": type, "cache-control": "no-store" });
      return fs.createReadStream(full).pipe(res);
    }
    return serveStatic(res, url.pathname);
  } catch (error) {
    if (!error.status || error.status >= 500) console.error(error.message || error);
    if (error.status === 413) res.setHeader("connection", "close");
    return send(res, error.status || (error instanceof SyntaxError ? 400 : 500), { error: String(error.message || error), code: error.code || "request_failed",
      ...(error.code === "animation_in_use" && Array.isArray(error.dependencies) ? { dependencies: error.dependencies.map(String) } : {}),
    });
  }
};
const server = http.createServer(requestHandler);
return {
  AUDIO_MIME_BY_EXTENSION,
  buildGroups,
  configResponse,
  duplicateFrameBindings,
  duplicateProjectFrame,
  savePayload,
  replaceAnimationFrames,
  deleteFrameBindings,
  deleteFrameOverrideDictionary,
  deleteTrailFrameSlices,
  deleteProjectFrame,
  projectConfigRevision,
  duplicateTrailFrameSlices,
  remapFrameOverrideDictionary,
  saveFrameAudioBindings,
  requestHandler,
  store,
  server,
  validateLiteProject,
};
}

const defaultApp = createLiteApp();
if (require.main === module) {
  const port = Number(process.env.LITE_PORT || 5180);
  defaultApp.server.listen(port, "127.0.0.1", () => console.log(`Frame Tuner Lite running at http://127.0.0.1:${port}`));
}
module.exports = { ...defaultApp, createLiteApp };
