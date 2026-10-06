"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { createProjectStore, EMPTY_MANIFEST, EMPTY_TUNING, projectEngine, reslash, slug } = require("./project_store");
const { capabilities } = require("./engine_adapters");

function fail(message, code = "invalid_import", status = 400) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  throw error;
}

function resolveWorkbenchAsset(root, requested) {
  const base = path.resolve(root);
  const raw = reslash(requested);
  const local = path.resolve(base, raw);
  if ((local === base || local.startsWith(`${base}${path.sep}`)) && fs.existsSync(local) && fs.statSync(local).isFile()) return local;
  // Bundled brush textures belong to the checkout, while all imported assets
  // belong to FRAME_TUNER_ROOT. Do not turn this into a general checkout route.
  const prefix = "tools/animation_tuner/public/presets/attack_trails/";
  if (!raw.startsWith(prefix)) return null;
  const name = raw.slice(prefix.length);
  if (!/^[a-z0-9_-]+\.png$/i.test(name)) return null;
  const directory = path.join(__dirname, "animation_tuner", "public", "presets", "attack_trails");
  const bundled = path.join(directory, name);
  if (!fs.existsSync(bundled) || !fs.statSync(bundled).isFile()) return null;
  const realDirectory = fs.realpathSync(directory), realAsset = fs.realpathSync(bundled);
  return realAsset.startsWith(`${realDirectory}${path.sep}`) ? realAsset : null;
}

function pngBuffer(file) {
  const match = /^data:image\/png;base64,([a-z0-9+/=\r\n]+)$/i.exec(String(file?.data || ""));
  if (!match || path.extname(String(file?.name || "")).toLowerCase() !== ".png") fail("Import requires named PNG files with PNG data URLs.");
  const buffer = Buffer.from(match[1], "base64");
  if (buffer.length < 33 || !buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) || buffer.toString("ascii", 12, 16) !== "IHDR") fail(`Invalid PNG: ${file.name}`);
  const width = buffer.readUInt32BE(16), height = buffer.readUInt32BE(20);
  if (width < 1 || height < 1 || width > 16384 || height > 16384) fail(`PNG dimensions must be between 1 and 16384: ${file.name}`);
  return { name: path.basename(file.name), buffer, width, height, hash: crypto.createHash("sha256").update(buffer).digest("hex") };
}

function sheetFrames(raw, image, fps) {
  const sheet = typeof raw === "string" ? JSON.parse(raw) : raw;
  if (!sheet || typeof sheet !== "object") fail("Sheet JSON must be an object.");
  // Unsupported packing data is rejected, never silently interpreted as an ordinary crop.
  const entries = Array.isArray(sheet.frames)
    ? sheet.frames.map((value, index) => [String(value.filename || value.name || index), value])
    : sheet.frames && typeof sheet.frames === "object"
      ? Object.entries(sheet.frames).sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
      : [];
  if (!entries.length) fail("Sheet JSON must contain nonempty frames.");
  return entries.map(([name, value], index) => {
    if (value.rotated === true || value.trimmed === true || value.pivot || value.anchor || value.sourceSize || value.spriteSourceSize) {
      fail(`Unsupported sheet packing metadata for ${name}: rotated, trimmed, pivot, sourceSize and spriteSourceSize require normalization before import.`, "unsupported_sheet_metadata");
    }
    const rect = value.frame || value.crop || value;
    const x = Number(rect.x ?? rect.left ?? 0), y = Number(rect.y ?? rect.top ?? 0);
    const width = Number(rect.w ?? rect.width), height = Number(rect.h ?? rect.height);
    if (![x, y, width, height].every(Number.isInteger) || x < 0 || y < 0 || width < 1 || height < 1 || x + width > image.width || y + height > image.height) fail(`Sheet frame is outside its PNG: ${name}`);
    const durationMs = Number(value.durationMs ?? value.duration ?? (1000 / fps));
    if (!Number.isFinite(durationMs) || durationMs <= 0) fail(`Invalid frame duration: ${name}`);
    return { id: `frame_${String(index + 1).padStart(4, "0")}`, name, width, height, duration: durationMs * fps / 1000, crop: { x, y, width, height, sheetWidth: image.width, sheetHeight: image.height } };
  });
}

function sheetOrigin(raw) {
  const sheet = typeof raw === "string" ? JSON.parse(raw) : raw;
  const origin = sheet?.meta?.origin || sheet?.meta?.canvas?.origin || (sheet?.meta?.canvas && { x: sheet.meta.canvas.originPixelX, y: sheet.meta.canvas.originPixelY });
  if (!origin) return undefined;
  if (!Number.isFinite(Number(origin.x)) || !Number.isFinite(Number(origin.y))) fail("Sheet origin must contain finite x and y coordinates.");
  return { x: Number(origin.x), y: Number(origin.y) };
}

const AUDIO_TYPES = Object.freeze({ ".wav": "audio/wav", ".mp3": "audio/mpeg", ".ogg": "audio/ogg", ".opus": "audio/ogg", ".m4a": "audio/mp4", ".aac": "audio/aac", ".flac": "audio/flac", ".webm": "audio/webm" });

// The CLI supplies bytes, never a path for the service to read. Validate the whole
// audio contract before writing any imported frames or changing authored JSON.
function prepareSheetAudio(raw, supplied, frameCount) {
  const sheet = typeof raw === "string" ? JSON.parse(raw) : raw;
  if (!sheet?.audio) return { assets: [], events: [] };
  const descriptors = sheet.audio.files ?? [], sourceEvents = sheet.audio.events ?? [];
  if (!Array.isArray(descriptors) || !Array.isArray(sourceEvents)) fail("Sheet audio files and events must be arrays.", "invalid_sheet_audio");
  if (!descriptors.length && !sourceEvents.length) return { assets: [], events: [] };
  if (!Array.isArray(supplied) || !supplied.length) fail("This sheet references audio files. Supply its accompanying audio files through the CLI, or import with the legacy Lite sheet importer.", "sheet_audio_requires_files");
  const assets = [], byFile = new Map(), byId = new Map();
  for (const descriptor of descriptors) {
    const file = String(descriptor?.file || "");
    const extension = path.extname(file).toLowerCase();
    if (!file || /^[a-z][a-z0-9+.-]*:/i.test(file) || /^[\\/]/.test(file) || !AUDIO_TYPES[extension]) fail(`Invalid relative sheet audio file: ${file}`, "invalid_sheet_audio");
    if (byFile.has(file) || (descriptor.id && byId.has(String(descriptor.id)))) fail(`Duplicate sheet audio descriptor: ${file}`, "invalid_sheet_audio");
    const source = supplied.find((entry) => String(entry?.file || "") === file);
    if (!source) fail(`Missing sheet audio file: ${file}`, "sheet_audio_requires_files");
    const match = /^data:(audio\/[a-z0-9.+-]+)(?:;[^,]*)?;base64,([a-z0-9+/=\r\n]+)$/i.exec(String(source.data || ""));
    if (!match) fail(`Invalid audio data URL: ${file}`, "invalid_sheet_audio");
    const buffer = Buffer.from(match[2], "base64");
    if (!buffer.length) fail(`Empty audio file: ${file}`, "invalid_sheet_audio");
    const asset = { file, id: String(descriptor.id || ""), extension, type: AUDIO_TYPES[extension], name: path.basename(String(descriptor.name || source.name || file)), buffer, hash: crypto.createHash("sha256").update(buffer).digest("hex") };
    assets.push(asset);
    byFile.set(file, asset);
    if (asset.id) byId.set(asset.id, asset);
  }
  const usedFrames = new Set();
  const events = sourceEvents.map((event) => {
    const frame = Number(event?.outputFrameIndex ?? (Number(event?.outputFrame) - 1));
    if (!Number.isInteger(frame) || frame < 0 || frame >= frameCount) fail(`Sheet audio event refers to an invalid frame: ${frame}`, "invalid_sheet_audio");
    const asset = byId.get(String(event.assetId || "")) || byFile.get(String(event.file || ""));
    if (!asset) fail(`Sheet audio event on frame ${frame + 1} has no matching file.`, "invalid_sheet_audio");
    if (usedFrames.has(frame)) fail(`Multiple audio events on frame ${frame + 1} are not supported by the frame-card editor.`, "unsupported_sheet_audio");
    usedFrames.add(frame);
    const volume = Number(event.volume ?? 1);
    if (!Number.isFinite(volume)) fail(`Invalid audio volume on frame ${frame + 1}`, "invalid_sheet_audio");
    return { frame, asset, volume: Math.min(1, Math.max(0, volume)) };
  });
  return { assets, events };
}

function createWorkbenchService(options = {}) {
  const root = path.resolve(options.root || process.env.FRAME_TUNER_ROOT || path.join(__dirname, ".."));
  const store = options.store || createProjectStore(root);
  const pathsFor = (project) => store.projectPaths ? store.projectPaths(project) : store.paths(project);
  const resolveProject = (id) => {
    const registry = store.readRegistry();
    const project = registry.projects.find((entry) => entry.id === String(id || registry.activeProjectId));
    if (!project) fail(`Project not found: ${id || "(none)"}`, "project_not_found", 404);
    return project;
  };
  const projectData = (id) => {
    const project = resolveProject(id), paths = pathsFor(project);
    const result = {
      root, project, paths,
      manifest: store.readJson(paths.manifest, EMPTY_MANIFEST),
      tuning: store.readJson(paths.tuning, EMPTY_TUNING),
      frameAudioBindings: store.readJson(paths.frameAudio, []),
      frameImageAttachments: store.readJson(paths.frameImageAttachments, []),
      attackTrails: store.readJson(paths.attackTrails, { schemaVersion: 21, presets: [], bindings: {} }),
      settings: store.readJson(paths.settings, { schemaVersion: 1, canvas: { padding: 24 }, export: { sheetColumns: 8 } }),
    };
    if (!result.manifest || !Array.isArray(result.manifest.profiles) || !result.tuning || Array.isArray(result.tuning) || typeof result.tuning !== "object" || !Array.isArray(result.frameImageAttachments) || !result.attackTrails || typeof result.attackTrails !== "object" || !result.settings || typeof result.settings !== "object") fail("Project data has an invalid structure; existing files were preserved.", "invalid_project_json", 500);
    return result;
  };
  const getCapabilities = () => capabilities({ codexPets: typeof options.codexPets === "function" ? options.codexPets() : options.codexPets === true, codexPetsToggle: options.codexPetsToggle === true });
  function createProject(payload = {}) {
    const label = String(payload.label || payload.id || "").trim();
    if (!label) fail("A project name is required.", "invalid_project");
    let project;
    if (store.addProject) {
      const registry = store.addProject({ label, id: payload.id, kind: "frame_lite" });
      project = registry.projects.find((entry) => entry.id === registry.activeProjectId);
    } else {
      const used = new Set(store.readRegistry().projects.map((entry) => entry.id));
      const base = slug(payload.id || label), suffix = (n) => n === 1 ? base : `${base}_${n}`;
      let n = 1;
      while (used.has(suffix(n))) n += 1;
      project = store.ensureProject(suffix(n), label);
    }
    return { ok: true, projectId: project.id, project: store.projectForClient(project), capabilities: getCapabilities() };
  }
  function importAnimation(payload = {}) {
    const data = projectData(payload.projectId);
    if (projectEngine(data.project) !== "lite") fail("Web imports require an independent workspace. Use the engine-specific importer for a bound project.", "project_not_neutral");
    if (!String(payload.profileId || "").trim() || !String(payload.animationId || "").trim()) fail("Character and animation names are required.");
    const profileId = slug(payload.profileId), animationId = slug(payload.animationId);
    const fps = Number(payload.fps ?? 12);
    if (!Number.isFinite(fps) || fps <= 0 || fps > 240) fail("FPS must be greater than 0 and at most 240.");
    const manifest = data.manifest;
    if (!Array.isArray(manifest.profiles)) fail("Project manifest has no profiles array.", "invalid_project_json");
    let profile = manifest.profiles.find((entry) => entry.id === profileId);
    const existing = profile?.animations?.findIndex((entry) => entry.id === animationId) ?? -1;
    if (existing >= 0 && payload.replace !== true) fail(`Animation ${profileId}/${animationId} already exists. Choose another name or explicitly replace it.`, "animation_exists", 409);
    if (!Array.isArray(payload.files) || !payload.files.length || payload.files.length > 4096) fail("Select between 1 and 4096 PNG files.");
    const images = payload.files.map(pngBuffer).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    const sheet = payload.sheetJson !== undefined && payload.sheetJson !== null;
    if (sheet && images.length !== 1) fail("Sheet import requires exactly one PNG and its JSON.");
    const frames = sheet ? sheetFrames(payload.sheetJson, images[0], fps) : images.map((image, index) => ({ id: `frame_${String(index + 1).padStart(4, "0")}`, name: image.name, width: image.width, height: image.height, duration: 1 }));
    const sourceAnchor = sheet ? sheetOrigin(payload.sheetJson) : undefined;
    const importedAudio = sheet ? prepareSheetAudio(payload.sheetJson, payload.audioFiles, frames.length) : { assets: [], events: [] };
    // Every input and existing JSON file has been checked before touching authored data.
    // Content-addressed assets also keep replacement failures from modifying old frames.
    const destination = path.join(data.paths.workspaceDir, "assets", profileId, animationId);
    fs.mkdirSync(destination, { recursive: true });
    images.forEach((image) => {
      const target = path.join(destination, `${image.hash}.png`);
      if (!fs.existsSync(target)) fs.writeFileSync(target, image.buffer);
      image.path = reslash(path.relative(root, target));
    });
    frames.forEach((frame, index) => { const image = images[sheet ? 0 : index]; frame.path = image.path; frame.assetVersion = image.hash.slice(0, 12); });
    importedAudio.assets.forEach((asset) => {
      const target = path.join(data.paths.workspaceDir, "audio", `${asset.hash}${asset.extension}`);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      if (!fs.existsSync(target)) fs.writeFileSync(target, asset.buffer);
      asset.path = reslash(path.relative(root, target));
    });
    const animation = { id: animationId, name: animationId, type: "actor", fps, loop: payload.loop !== false, anchorMode: "canvas_bottom_center", ...(sourceAnchor ? { sourceAnchor } : {}), source: reslash(path.relative(root, destination)), frames };
    if (!profile) {
      profile = { id: profileId, label: profileId, kind: "actor", bodyScale: 1, runtimeScale: 1, supports: ["character_transform", "group_transform", "frame_transform", "frame_playback", "frame_boxes", "reference_frame"], animations: [] };
      manifest.profiles.push(profile);
    }
    if (existing >= 0) profile.animations[existing] = animation;
    else profile.animations.push(animation);
    let audio = Array.isArray(data.frameAudioBindings) ? data.frameAudioBindings : Object.entries(data.frameAudioBindings || {}).map(([key, value]) => ({ key, ...value }));
    // Replacement clears frame-indexed data; it cannot safely refer to a new frame order.
    if (existing >= 0) {
      const key = `${profileId}/${animationId}:`;
      for (const field of ["frame_visual_overrides", "frame_playback_overrides", "frame_box_overrides"]) {
        data.tuning[field] = Object.fromEntries(Object.entries(data.tuning[field] || {}).filter(([entry]) => !entry.startsWith(key)));
      }
      const belongs = (entry) => {
        const metadata = entry?.metadata || entry || {};
        return String(metadata.profileId || "") === profileId && [animationId, `${profileId}/${animationId}`].includes(String(metadata.animation || metadata.animationId || ""));
      };
      audio = audio.filter((entry) => !belongs(entry) && !String(entry?.key || "").includes(key));
      store.writeJson(data.paths.frameImageAttachments, data.frameImageAttachments.filter((entry) => !belongs(entry)));
      delete data.attackTrails.bindings?.[`${profileId}/${animationId}`];
      store.writeJson(data.paths.attackTrails, data.attackTrails);
      store.writeJson(data.paths.tuning, data.tuning);
    }
    for (const event of importedAudio.events) {
      audio.push({
        key: [data.project.id, "player", profileId, "actor", animationId, animation.source, event.frame].join(":"),
        projectId: data.project.id, tuningTarget: "player", profileId, groupType: "actor", animation: `${profileId}/${animationId}`,
        source: animation.source, frame: event.frame, displayFrame: event.frame,
        name: event.asset.name, type: event.asset.type, size: event.asset.buffer.length, path: event.asset.path, volume: event.volume,
      });
    }
    if (existing >= 0 || importedAudio.events.length) store.writeJson(data.paths.frameAudio, audio);
    store.writeJson(data.paths.manifest, manifest);
    const settings = { ...data.settings, canvas: { padding: Number(data.settings.canvas?.padding ?? 24), autoMeasured: false } };
    store.writeJson(data.paths.settings, settings);
    return { ok: true, projectId: data.project.id, profileId, animationId, frameCount: frames.length, audioCount: importedAudio.events.length, fps, replaced: existing >= 0 };
  }
  return { root, store, capabilities: getCapabilities, createProject, importAnimation, resolveProject, projectData, listProjects: () => store.readRegistry().projects.map(store.projectForClient) };
}

module.exports = { createWorkbenchService, pngBuffer, sheetFrames, sheetOrigin, prepareSheetAudio, resolveWorkbenchAsset };
