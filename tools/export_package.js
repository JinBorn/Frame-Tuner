const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const zlib = require("node:zlib");
const { normalizePngQuality, compressRuntimePngs } = require("./png_compression");

const SCHEMA = "frame-tuner-package-v1";
const MAX_BYTES = 256 * 1024 * 1024;
const json = (value) => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);

function safePackagePath(value) {
  const name = String(value || "").replaceAll("\\", "/");
  if (!name || name.startsWith("/") || name.includes(":") || name.includes("\0") || name.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new Error(`Invalid package path: ${name}`);
  }
  return name;
}

function decodeFiles(input) {
  const output = new Map();
  let size = 0;
  const entries = input instanceof Map ? [...input].map(([filePath, data]) => ({ path: filePath, data })) : input;
  if (!Array.isArray(entries)) throw new Error("Export files must be an array.");
  for (const entry of entries) {
    const name = safePackagePath(entry.path);
    if (output.has(name)) throw new Error(`Duplicate package path: ${name}`);
    let buffer;
    if (Buffer.isBuffer(entry.data)) buffer = entry.data;
    else if (entry.encoding === "utf8") buffer = Buffer.from(String(entry.data), "utf8");
    else {
      const data = String(entry.data || "");
      const match = /^data:[^,]*;base64,([a-z0-9+/=\r\n]+)$/i.exec(data);
      if (!match && entry.encoding !== "base64") throw new Error(`Expected base64 data for ${name}.`);
      buffer = Buffer.from(match ? match[1] : data, "base64");
    }
    size += buffer.length;
    if (size > MAX_BYTES) throw new Error("Export package exceeds 256 MiB; export smaller batches.");
    output.set(name, buffer);
  }
  return output;
}

function finite(value, label, minimum = -Infinity) {
  if (!Number.isFinite(value) || value < minimum) throw new Error(`Invalid ${label}: ${value}`);
}

function validatePackage(manifest, files) {
  if (manifest?.schema !== SCHEMA || manifest.version !== 1 || manifest.bakedVisual !== true) throw new Error(`Expected ${SCHEMA} baked manifest.`);
  if (manifest.coordinateSystem?.unit !== "pixel" || manifest.coordinateSystem?.x !== "right" || manifest.coordinateSystem?.y !== "down") throw new Error("Export requires pixel/right/down coordinates.");
  if (!Array.isArray(manifest.animations) || !manifest.animations.length) throw new Error("No animations to export.");
  const ids = new Set();
  for (const animation of manifest.animations) {
    const id = `${animation.profileId || ""}/${animation.id || animation.name}`;
    if (ids.has(id)) throw new Error(`Duplicate animation: ${id}`);
    ids.add(id);
    if (!Array.isArray(animation.frames) || !animation.frames.length) throw new Error(`Animation has no playable frames: ${id}`);
    for (const frame of animation.frames) {
      finite(frame.durationMs, "frame duration", frame.disabled === true ? 0 : Number.EPSILON);
      finite(frame.width, "frame width", 1);
      finite(frame.height, "frame height", 1);
      finite(frame.origin?.x, "frame origin x");
      finite(frame.origin?.y, "frame origin y");
      if (!files.has(safePackagePath(frame.path))) throw new Error(`Missing exported image: ${frame.path}`);
      const png = files.get(frame.path);
      if (png.length < 24 || !png.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) throw new Error(`Invalid exported PNG: ${frame.path}`);
      const width = png.readUInt32BE(16);
      const height = png.readUInt32BE(20);
      if (frame.atlasRect) {
        for (const key of ["x", "y", "width", "height"]) finite(frame.atlasRect[key], `atlas ${key}`, key === "x" || key === "y" ? 0 : 1);
        if (frame.atlasRect.x + frame.atlasRect.width > width || frame.atlasRect.y + frame.atlasRect.height > height) throw new Error(`Atlas rectangle is outside ${frame.path}`);
      } else if (width !== frame.width || height !== frame.height) throw new Error(`PNG dimensions differ from manifest: ${frame.path}`);
      for (const event of frame.audio || []) {
        if (!files.has(safePackagePath(event.path))) throw new Error(`Missing exported audio: ${event.path}`);
        finite(event.volume ?? 1, "audio volume", 0);
        if ((event.volume ?? 1) > 1) throw new Error("Audio volume must not exceed 1.");
      }
      for (const box of frame.boxes || []) {
        if (!["hitbox", "hurtbox", "collisionbox"].includes(box.kind)) throw new Error(`Unknown box kind: ${box.kind}`);
        finite(box.position?.x, "box position x"); finite(box.position?.y, "box position y");
        finite(box.size?.x, "box width", 0); finite(box.size?.y, "box height", 0);
        finite(box.rotation ?? 0, "box rotation");
      }
    }
  }
  return manifest;
}

// Preserve the editable source independently from baked images. Local paths are
// replaced by content-addressed package paths, so the archive remains portable.
function archiveSource(projectData, files, options = {}) {
  if (!projectData) return null;
  const root = path.resolve(options.root || projectData.root || process.env.FRAME_TUNER_ROOT || path.join(__dirname, ".."));
  const codeRoot = path.resolve(__dirname, "..");
  const isWithin = (base, full) => {
    const relative = path.relative(base, full);
    return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
  };
  const source = {};
  for (const key of ["format", "version", "projectId", "projectKind", "engine", "profiles", "groups", "manifest", "tuning", "frameAudioBindings", "frameImageAttachments", "attackTrails", "settings"]) {
    if (projectData[key] !== undefined) source[key] = structuredClone(projectData[key]);
  }
  source.project = { id: projectData.project?.id || "", label: projectData.project?.label || "", engine: projectData.project?.engine || "none" };
  const remap = new Map();
  function asset(value) {
    if (remap.has(value)) return remap.get(value);
    let buffer;
    let extension;
    if (value.startsWith("data:")) {
      const match = /^data:([^;,]+);base64,(.+)$/s.exec(value);
      if (!match) return value;
      buffer = Buffer.from(match[2], "base64");
      extension = ({ "image/png": ".png", "image/jpeg": ".jpg", "audio/wav": ".wav", "audio/mpeg": ".mp3", "audio/ogg": ".ogg" })[match[1]] || ".bin";
    } else {
      if (/^(?:https?:|blob:)/i.test(value)) return value;
      let full = path.resolve(root, value);
      let allowedRoot = root;
      if (!isWithin(root, full)) throw new Error(`Source asset is outside workspace: ${value}`);
      if (!fs.existsSync(full) && value.replaceAll("\\", "/").startsWith("tools/animation_tuner/public/")) {
        allowedRoot = path.join(codeRoot, "tools/animation_tuner/public");
        full = path.resolve(codeRoot, value);
        if (!isWithin(allowedRoot, full)) throw new Error(`Source asset is outside bundled assets: ${value}`);
      }
      if (!fs.existsSync(full) || !fs.statSync(full).isFile()) throw new Error(`Missing source asset: ${value}`);
      // A workspace junction or symlink must not include unrelated local files
      // in a portable archive, even when its lexical path is inside the root.
      full = fs.realpathSync(full);
      if (!isWithin(fs.realpathSync(allowedRoot), full)) throw new Error(`Source asset is outside workspace: ${value}`);
      buffer = fs.readFileSync(full);
      extension = path.extname(full).toLowerCase() || ".bin";
    }
    const name = `source/assets/${crypto.createHash("sha256").update(buffer).digest("hex").slice(0, 24)}${extension}`;
    files.set(name, buffer);
    remap.set(value, name);
    return name;
  }
  function visit(value) {
    if (Array.isArray(value)) return value.map(visit);
    if (!value || typeof value !== "object") return value;
    const next = {};
    for (const [key, entry] of Object.entries(value)) {
      if (typeof entry === "string" && entry && (["path", "file"].includes(key) || key === "data" && entry.startsWith("data:"))) next[key === "data" ? "path" : key] = asset(entry);
      else next[key] = visit(entry);
    }
    return next;
  }
  const archived = visit(source);
  files.set("source/project.json", json(archived));
  return { path: "source/project.json", remap };
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  for (let i = 0; i < 8; i += 1) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function createZip(files) {
  if (files.size > 65535) throw new Error("Too many files for a ZIP archive.");
  const local = [], central = [];
  let offset = 0, rawBytes = 0;
  for (const [filePath, buffer] of files) {
    const name = Buffer.from(safePackagePath(filePath));
    rawBytes += buffer.length;
    if (rawBytes > MAX_BYTES) throw new Error("Export package exceeds 256 MiB; export smaller batches.");
    const compressed = zlib.deflateRawSync(buffer);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0); header.writeUInt16LE(20, 4); header.writeUInt16LE(0x800, 6);
    header.writeUInt16LE(8, 8); header.writeUInt16LE(0x21, 12); header.writeUInt32LE(crc32(buffer), 14);
    header.writeUInt32LE(compressed.length, 18); header.writeUInt32LE(buffer.length, 22); header.writeUInt16LE(name.length, 26);
    const directory = Buffer.alloc(46);
    directory.writeUInt32LE(0x02014b50, 0); directory.writeUInt16LE(20, 4); header.copy(directory, 6, 4, 30);
    directory.writeUInt32LE(offset, 42);
    local.push(header, name, compressed); central.push(directory, name);
    offset += header.length + name.length + compressed.length;
  }
  const end = Buffer.alloc(22);
  const directorySize = central.reduce((sum, chunk) => sum + chunk.length, 0);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.size, 8); end.writeUInt16LE(files.size, 10);
  end.writeUInt32LE(directorySize, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, ...central, end]);
}

async function buildExportPackage(payload, options = {}) {
  const format = payload.format || "sequence";
  if (!["sequence", "sheet", "cocos"].includes(format)) throw new Error(`Unsupported export format: ${format}`);
  const pngQuality = normalizePngQuality(payload.pngQuality);
  let files = decodeFiles(payload.files);
  let manifest = structuredClone(payload.manifest);
  validatePackage(manifest, files);
  let imagePaths = [...new Set(manifest.animations.flatMap(animation => animation.frames.map(frame => frame.path)))];
  manifest.generator = { ...manifest.generator, name: "Frame Tuner", version: require("../package.json").version };
  const archived = archiveSource(options.projectData, files, options);
  if (archived) {
    manifest.editableSource = archived.path;
    const rewrite = (value) => {
      if (Array.isArray(value)) return value.map(rewrite);
      if (!value || typeof value !== "object") return typeof value === "string" ? archived.remap.get(value) || value : value;
      return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, rewrite(entry)]));
    };
    manifest = rewrite(manifest);
  }
  // The browser snapshot also preserves edits not yet saved to the project.
  if (payload.source) {
    const sourceFiles = new Map();
    archiveSource({ ...options.projectData, ...payload.source }, sourceFiles, options);
    for (const [name, buffer] of sourceFiles) files.set(name === "source/project.json" ? "source/editor-snapshot.json" : name, buffer);
    manifest.editorSnapshot = "source/editor-snapshot.json";
  }
  files.set("manifest.json", json(manifest));
  if (format === "cocos") {
    const { buildCocosPackage } = require("./cocos_export");
    const result = await buildCocosPackage(manifest, files, { demo: true });
    files = result.files;
    manifest = result.manifest || manifest;
    const resourceRoot = `assets/resources/${path.posix.dirname(manifest.resourcePath)}`;
    imagePaths = imagePaths.map(name => `${resourceRoot}/${name}`);
  }
  // For Cocos, only the images under assets/resources are optimized. Even the
  // baked reference PNGs inside frame-tuner-source remain byte-for-byte intact.
  const pngCompression = await compressRuntimePngs(files, imagePaths, pngQuality);
  const filename = `${String(manifest.projectId || "animation").replace(/[^\p{L}\p{N}_.-]/gu, "_")}_${format}.zip`;
  return { manifest, files, filename, pngCompression, buffer: createZip(files) };
}

function writePackageDirectory(directory, files) {
  const root = path.resolve(directory);
  if (fs.existsSync(root) && fs.readdirSync(root).length) throw new Error(`Output directory must be empty: ${root}`);
  fs.mkdirSync(root, { recursive: true });
  for (const [name, buffer] of files) {
    const full = path.resolve(root, safePackagePath(name));
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, buffer, { flag: "wx" });
  }
  return root;
}

module.exports = { SCHEMA, safePackagePath, decodeFiles, validatePackage, archiveSource, crc32, createZip, buildExportPackage, writePackageDirectory };
