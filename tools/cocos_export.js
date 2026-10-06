"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const SCHEMA = "frame-tuner-package-v1";
const RUNTIME_FILES = ["FrameTunerData.ts", "FrameTunerClock.ts", "FrameTunerPlayer.ts"];

function relativeAssetPath(value) {
  if (typeof value !== "string" || !value || /[\\:\0<>"|?*]/.test(value)) throw new Error(`Invalid package path: ${value}`);
  if (path.posix.isAbsolute(value) || value.split("/").some(part => !part || part === "." || part === "..")) throw new Error(`Invalid package path: ${value}`);
  return value;
}

function finite(value, label, minimum = -Infinity) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum) throw new Error(`${label} must be a finite number >= ${minimum}.`);
}

function point(value, label, minimum = -Infinity) {
  finite(value?.x, `${label}.x`, minimum);
  finite(value?.y, `${label}.y`, minimum);
}

function validatePackage(pkg, files) {
  if (pkg?.schema !== SCHEMA || pkg.version !== 1 || pkg.bakedVisual !== true) throw new Error(`Cocos requires a baked ${SCHEMA} package.`);
  if (pkg.coordinateSystem?.unit !== "pixel" || pkg.coordinateSystem?.x !== "right" || pkg.coordinateSystem?.y !== "down") throw new Error("Cocos requires pixel/right/down package coordinates.");
  if (typeof pkg.projectId !== "string" || !pkg.projectId.trim()) throw new Error("Package projectId must not be empty.");
  if (!Array.isArray(pkg.animations) || !pkg.animations.length) throw new Error("The package has no animations.");
  const ids = new Set();
  const assetPaths = new Set();
  const resourcePaths = new Map();
  function asset(file, extensions) {
    relativeAssetPath(file);
    if (!extensions.includes(path.posix.extname(file).toLowerCase())) throw new Error(`Unsupported Cocos asset: ${file}`);
    if (files && !files.has(file)) throw new Error(`Package is missing asset: ${file}`);
    const resource = file.replace(/\.[^/.]+$/, "").toLowerCase();
    if (resourcePaths.has(resource) && resourcePaths.get(resource) !== file) throw new Error(`Ambiguous Cocos resources path: ${file}`);
    resourcePaths.set(resource, file);
    assetPaths.add(file);
  }
  for (const animation of pkg.animations) {
    if (!animation.id || typeof animation.id !== "string" || ids.has(animation.id)) throw new Error("Animation ids must be nonempty and unique.");
    ids.add(animation.id);
    if (typeof animation.name !== "string") throw new Error(`Animation ${animation.id} needs a name.`);
    if (typeof animation.loop !== "boolean") throw new Error(`Animation ${animation.id} needs a boolean loop mode.`);
    if (!Array.isArray(animation.frames) || !animation.frames.length) throw new Error(`Animation ${animation.id} has no frames.`);
    for (const [index, frame] of animation.frames.entries()) {
      const label = `${animation.id} frame ${index}`;
      finite(frame.sourceFrame, `${label}.sourceFrame`, 0);
      if (!Number.isInteger(frame.sourceFrame)) throw new Error(`${label}.sourceFrame must be an integer.`);
      if (frame.disabled !== undefined && typeof frame.disabled !== "boolean") throw new Error(`${label}.disabled must be a boolean.`);
      finite(frame.durationMs, `${label}.durationMs`, frame.disabled ? 0 : Number.MIN_VALUE);
      finite(frame.width, `${label}.width`, 1);
      finite(frame.height, `${label}.height`, 1);
      point(frame.origin, `${label}.origin`);
      asset(frame.path, [".png"]);
      if (!Number.isInteger(frame.width) || !Number.isInteger(frame.height)) throw new Error(`${label} dimensions must be integers.`);
      if (frame.atlasRect) {
        for (const key of ["x", "y", "width", "height"]) {
          finite(frame.atlasRect[key], `${label}.atlasRect.${key}`, key === "x" || key === "y" ? 0 : 1);
          if (!Number.isInteger(frame.atlasRect[key])) throw new Error(`${label}.atlasRect.${key} must be an integer.`);
        }
        if (frame.atlasRect.rotated || frame.atlasRect.width !== frame.width || frame.atlasRect.height !== frame.height) throw new Error(`${label} has an unsupported atlas rotation or inconsistent crop size.`);
      }
      if (files) {
        const png = files.get(frame.path);
        if (png.length < 24 || !png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error(`Invalid PNG: ${frame.path}`);
        const width = png.readUInt32BE(16), height = png.readUInt32BE(20);
        if (frame.atlasRect) {
          if (frame.atlasRect.x + frame.width > width || frame.atlasRect.y + frame.height > height) throw new Error(`Atlas crop exceeds image: ${frame.path}`);
        } else if (width !== frame.width || height !== frame.height) throw new Error(`PNG dimensions differ from manifest: ${frame.path}`);
      }
      if (!Array.isArray(frame.boxes) || !Array.isArray(frame.audio)) throw new Error(`${label} needs boxes and audio arrays.`);
      for (const box of frame.boxes) {
        if (!["hitbox", "hurtbox", "collisionbox"].includes(box.kind) || typeof box.enabled !== "boolean") throw new Error(`${label} contains an invalid box.`);
        point(box.position, `${label}.box.position`);
        point(box.size, `${label}.box.size`, 0);
        finite(box.rotation, `${label}.box.rotation`);
      }
      for (const audio of frame.audio) {
        asset(audio.path, [".wav", ".mp3", ".ogg"]);
        if (audio.volume !== undefined) {
          finite(audio.volume, `${label}.audio.volume`, 0);
          if (audio.volume > 1) throw new Error(`${label}.audio.volume must not exceed 1.`);
        }
      }
    }
  }
  return { assetPaths: [...assetPaths], animationCount: ids.size };
}

function stableUuid(name) {
  const hex = crypto.createHash("sha256").update(`frame-tuner-cocos-v1/${name}`).digest("hex").slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20)}`;
}

function compressUuid(uuid) {
  const hex = uuid.replace(/-/g, "");
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let result = hex.slice(0, 5);
  for (let index = 5; index < hex.length; index += 3) {
    const value = Number.parseInt(hex.slice(index, index + 3), 16);
    result += alphabet[value >> 6] + alphabet[value & 63];
  }
  return result;
}

function resourceProjectId(projectId) {
  return /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(projectId)
    ? projectId : `project-${crypto.createHash("sha256").update(projectId).digest("hex").slice(0, 12)}`;
}

function metadata(name, importer, version) {
  return { ver: version, importer, imported: true, uuid: stableUuid(name), files: importer === "scene" ? [".json"] : [], subMetas: {}, userData: {} };
}

function createDemoScene(projectId) {
  const node = {
    __type__: "cc.Node", _name: "Frame Tuner Demo", _objFlags: 0, __editorExtras__: {},
    _parent: { __id__: 1 }, _children: [], _active: true, _components: [{ __id__: 3 }], _prefab: null,
    _lpos: { __type__: "cc.Vec3", x: 0, y: 0, z: 0 },
    _lrot: { __type__: "cc.Quat", x: 0, y: 0, z: 0, w: 1 },
    _lscale: { __type__: "cc.Vec3", x: 1, y: 1, z: 1 }, _mobility: 0, _layer: 1073741824,
    _euler: { __type__: "cc.Vec3", x: 0, y: 0, z: 0 }, _id: stableUuid("demo-node"),
  };
  return [
    { __type__: "cc.SceneAsset", _name: "FrameTunerDemo", _objFlags: 0, __editorExtras__: {}, _native: "", scene: { __id__: 1 } },
    { ...node, __type__: "cc.Scene", _name: "FrameTunerDemo", _parent: null, _children: [{ __id__: 2 }], _components: [],
      autoReleaseAssets: false, _globals: { __id__: 4 }, _id: stableUuid("FrameTunerDemo.scene") },
    node,
    { __type__: compressUuid(stableUuid("FrameTunerDemo.ts")), _name: "", _objFlags: 0, __editorExtras__: {},
      node: { __id__: 2 }, _enabled: true, __prefab: null, packagePath: `frame-tuner/${projectId}/manifest`, _id: stableUuid("demo-component") },
    { __type__: "cc.SceneGlobals" },
  ];
}

/** Pure in-memory builder; never opens or changes an existing Cocos project. */
function buildCocosPackage(pkg, inputFiles, options = {}) {
  const input = inputFiles instanceof Map ? inputFiles : new Map(Object.entries(inputFiles || {}));
  const validation = validatePackage(pkg, input);
  const files = new Map();
  const json = value => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
  const resourceId = resourceProjectId(pkg.projectId);
  const resourceRoot = `assets/resources/frame-tuner/${resourceId}`;
  const runtimeRoot = "assets/scripts/frame-tuner";
  const runtimeManifest = { ...pkg, sourceArchive: { base: "export-root", path: "frame-tuner-source/manifest.json" } };
  delete runtimeManifest.editableSource;
  delete runtimeManifest.editorSnapshot;
  files.set(`${resourceRoot}/manifest.json`, json(runtimeManifest));
  for (const [file, bytes] of input) files.set(`frame-tuner-source/${relativeAssetPath(file)}`, Buffer.from(bytes));
  files.set("frame-tuner-source/manifest.json", json(pkg));
  for (const file of validation.assetPaths) files.set(`${resourceRoot}/${file}`, Buffer.from(input.get(file)));
  for (const file of [...RUNTIME_FILES, ...(options.demo ? ["FrameTunerDemo.ts"] : [])]) {
    files.set(`${runtimeRoot}/${file}`, fs.readFileSync(path.join(__dirname, "cocos", file)));
    files.set(`${runtimeRoot}/${file}.meta`, json(metadata(file, "typescript", "4.0.24")));
  }
  const manifest = { target: "cocos-creator", engineVersion: "3.8.8", projectId: pkg.projectId,
    resourcePath: `frame-tuner/${resourceId}/manifest`, sceneUuid: options.demo ? stableUuid("FrameTunerDemo.scene") : null };
  files.set("FRAME-TUNER-IMPORT.json", json(manifest));
  files.set("FRAME-TUNER-README.md", Buffer.from(`# Frame Tuner → Cocos Creator 3.8.8\n\nCopy the assets directory into your Cocos project. Attach FrameTunerPlayer to a node under a Canvas and set packagePath to \`${manifest.resourcePath}\`.\n\nGenerated files are replaceable. Keep gameplay scripts separate; edit animation data in Frame Tuner and export again. Visual transforms, attachments and trails are already baked. Do not apply source transforms again.\n\nAPI: await player.load(path); player.play(animationId, loop); player.setFacingLeft(true); player.queryBoxes(kind, world); player.pause(); player.resume().\nEvents: frame-tuner-ready, frame-tuner-frame, frame-tuner-loop, frame-tuner-finished, frame-tuner-audio, frame-tuner-error. Once playback holds the final enabled frame and emits finished once.\n\nBoxes are oriented corners; use your game's own collision logic. The adapter does not install physics colliders. Audio is preloaded; browser playback requires a user gesture.\n${options.demo ? "\nOpen this generated directory as a separate Creator 3.8.8 project and open assets/frame-tuner-demo/FrameTunerDemo.scene. Click Preview, then Loop/Once to unlock audio.\n" : ""}`));
  if (options.demo) {
    files.set("assets/frame-tuner-demo/FrameTunerDemo.scene", json(createDemoScene(resourceId)));
    files.set("assets/frame-tuner-demo/FrameTunerDemo.scene.meta", json(metadata("FrameTunerDemo.scene", "scene", "1.1.50")));
    files.set("package.json", json({ name: `frame-tuner-demo-${resourceId}`, uuid: stableUuid(`demo-project/${pkg.projectId}`), creator: { version: "3.8.8" } }));
    files.set("tsconfig.json", json({ extends: "./temp/tsconfig.cocos.json", compilerOptions: { strict: true } }));
    files.set(".gitignore", Buffer.from("library/\ntemp/\nlocal/\nprofiles/\nbuild/\nnode_modules/\n"));
    files.set(".creator/default-meta.json", json({ image: { type: "sprite-frame" } }));
    files.set("settings/v2/packages/project.json", json({ __version__: "1.0.6" }));
  }
  return { files, manifest, ...validation };
}

function readPackage(directory) {
  const base = fs.realpathSync(path.resolve(directory));
  const pkg = JSON.parse(fs.readFileSync(path.join(base, "manifest.json"), "utf8"));
  validatePackage(pkg);
  const files = new Map();
  let bytes = 0;
  function visit(relativeDirectory) {
    for (const entry of fs.readdirSync(path.join(base, relativeDirectory), { withFileTypes: true })) {
      const file = relativeAssetPath(path.posix.join(relativeDirectory, entry.name));
      if (entry.isSymbolicLink()) throw new Error(`Package contains a symbolic link: ${file}`);
      if (entry.isDirectory()) visit(file);
      else if (entry.isFile()) {
        const buffer = fs.readFileSync(path.join(base, file));
        bytes += buffer.length;
        if (bytes > 256 * 1024 * 1024) throw new Error("Source package exceeds 256 MiB.");
        files.set(file, buffer);
      }
    }
  }
  visit("");
  return { pkg, files };
}

function writeCocosPackage(inputDirectory, outputDirectory, options = {}) {
  const source = options.sample ? require("./cocos/sample_package").createSamplePackage() : readPackage(inputDirectory);
  const result = buildCocosPackage(source.pkg, source.files, options);
  const output = path.resolve(outputDirectory);
  if (fs.existsSync(output) && fs.readdirSync(output).length && !options.overwrite) throw new Error("Output directory is not empty. Choose a new directory or explicitly pass --overwrite for generated files.");
  fs.mkdirSync(output, { recursive: true });
  const realOutput = fs.realpathSync(output);
  for (const [file, bytes] of result.files) {
    const target = path.resolve(output, file);
    if (!target.startsWith(`${output}${path.sep}`)) throw new Error(`Unsafe output path: ${file}`);
    // Check the nearest existing ancestor before creating directories: a symlink
    // must not redirect mkdir or the eventual write outside the chosen output.
    let ancestor = path.dirname(target);
    while (!fs.existsSync(ancestor)) ancestor = path.dirname(ancestor);
    const relative = path.relative(realOutput, fs.realpathSync(ancestor));
    if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative) || (fs.existsSync(target) && fs.lstatSync(target).isSymbolicLink())) throw new Error(`Output path escapes destination: ${file}`);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, bytes);
  }
  return { ...result.manifest, outputDirectory: output, fileCount: result.files.size, animationCount: result.animationCount };
}

if (require.main === module) {
  try {
    const args = process.argv.slice(2);
    if (args.includes("--help")) {
      console.log("node tools/cocos_export.js --input <unpacked-neutral-package> --out <new-output-directory> [--demo]\nnode tools/cocos_export.js --sample --demo --out <new-demo-project>\n--overwrite replaces generated files only; use only with a disposable export directory.");
    } else {
      const options = {};
      for (let index = 0; index < args.length; index += 1) {
        const name = args[index];
        if (["--demo", "--sample", "--overwrite"].includes(name)) options[name.slice(2)] = true;
        else if (["--input", "--out"].includes(name)) {
          if (!args[index + 1] || args[index + 1].startsWith("--")) throw new Error(`Missing value for ${name}.`);
          options[name.slice(2)] = args[++index];
        } else throw new Error(`Unknown option: ${name}`);
      }
      if (!options.out || (!options.input && !options.sample)) throw new Error("Provide --input and --out, or --sample and --out. See --help.");
      if (options.input && options.sample) throw new Error("Choose either --input or --sample.");
      console.log(JSON.stringify({ ok: true, ...writeCocosPackage(options.input, options.out, options) }, null, 2));
    }
  } catch (error) {
    console.error(JSON.stringify({ ok: false, error: error.message }));
    process.exitCode = 1;
  }
}

module.exports = { buildCocosPackage, writeCocosPackage, validatePackage, createDemoScene, relativeAssetPath, SCHEMA };
