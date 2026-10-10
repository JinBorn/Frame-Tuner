"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const zlib = require("node:zlib");
const sharp = require("sharp");
const { normalizePngQuality, compressPng, compressRuntimePngs } = require("./png_compression");
const { buildExportPackage, writePackageDirectory, crc32 } = require("./export_package");
const { unzip } = require("./export_package_test");
const { createSamplePackage } = require("./cocos/sample_package");
const { parseArgs } = require("./frame_tuner");

function chunk(type, data) {
  const tag = Buffer.from(type), output = Buffer.alloc(data.length + 12);
  output.writeUInt32BE(data.length); tag.copy(output, 4); data.copy(output, 8);
  output.writeUInt32BE(crc32(Buffer.concat([tag, data])), data.length + 8);
  return output;
}

// Encode independently of sharp, retaining nonzero RGB even when alpha is zero.
// The repeatable gradient/noise exercises palette compression without assets
// from the user's project or an external encoder fixture.
function fixture(width = 96, height = 64) {
  const rgba = Buffer.alloc(width * height * 4);
  let seed = 0x12345678;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const offset = (y * width + x) * 4;
      rgba[offset] = (x * 3 + (seed & 31)) & 255;
      rgba[offset + 1] = (y * 4 + ((seed >>> 8) & 31)) & 255;
      rgba[offset + 2] = (x + y * 2 + ((seed >>> 16) & 31)) & 255;
      rgba[offset + 3] = [0, 47, 128, 255][Math.floor(x * 4 / width)];
    }
  }
  const rows = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y += 1) rgba.copy(rows, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6;
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(rows, { level: 0 })), chunk("IEND", Buffer.alloc(0)),
  ]);
  return { width, height, rgba, png };
}

async function pixels(png) {
  return sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
}

async function samePixels(actual, expected, message) {
  const a = await pixels(actual), b = await pixels(expected);
  assert.deepEqual(a.info, b.info, `${message}: dimensions/channels`);
  assert.deepEqual(a.data, b.data, `${message}: RGBA including hidden RGB`);
}

function packageFixture(image, format, audio) {
  const images = format === "sheet" ? ["spritesheet.png", "spritesheet.png"] : ["frames/idle_0.png", "frames/idle_1.png"];
  const frames = images.map((file, index) => ({
    sourceFrame: index, durationMs: index ? 180 : 90, path: file,
    width: format === "sheet" ? image.width / 2 : image.width, height: image.height,
    origin: { x: 12, y: 24 }, boxes: [{ kind: "hurtbox", enabled: true, position: { x: 2, y: -4 }, size: { x: 9, y: 17 }, rotation: 5 }],
    audio: index ? [{ path: "audio/tick.wav", volume: 0.45 }] : [],
    ...(format === "sheet" ? { atlasRect: { x: index * image.width / 2, y: 0, width: image.width / 2, height: image.height } } : {}),
  }));
  const manifest = {
    schema: "frame-tuner-package-v1", version: 1, projectId: "compression", bakedVisual: true,
    coordinateSystem: { unit: "pixel", x: "right", y: "down" },
    animations: [{ id: "hero/idle", profileId: "hero", name: "Idle", loop: true, frames }],
  };
  const files = new Map(images.map((name) => [name, image.png]));
  files.set("audio/tick.wav", audio);
  files.set("notes.json", Buffer.from('{ "untouched": true }\n'));
  files.set("source/embedded.png", image.png);
  files.set("source/tuning.json", Buffer.from('{ "scale": 1.35 }\n'));
  files.set("frame-tuner-source/original.png", image.png);
  return { manifest, files, images: [...new Set(images)] };
}

async function test() {
  assert.equal(normalizePngQuality(), 100);
  for (const quality of [1, 35, 100, "1", "75", "100"]) assert.equal(normalizePngQuality(quality), Number(quality));
  for (const quality of [null, true, false, {}, [], "", " ", "abc", 0, 101, -1, 1.5, "1.5", NaN, Infinity]) {
    assert.throws(() => normalizePngQuality(quality), /quality|质量/i, `invalid quality: ${String(quality)}`);
  }
  const image = fixture();
  const original = Buffer.from(image.png);
  const decoded = await pixels(image.png);
  assert.deepEqual(decoded.data, image.rgba, "fixture retains all RGBA bytes including transparent RGB");
  const lossless = await compressPng(image.png);
  assert.ok(lossless.length < image.png.length, "default lossless compression reduces unoptimized PNG");
  await samePixels(lossless, image.png, "default quality is lossless");
  const header16 = Buffer.from(image.png.subarray(16, 29)); header16[8] = 16;
  const stride16 = image.width * 8 + 1, rows16 = Buffer.alloc(stride16 * image.height);
  for (let y = 0; y < image.height; y += 1) for (let x = 0; x < image.width * 4; x += 1) {
    const sample = y * image.width * 4 + x;
    rows16.writeUInt16BE((image.rgba[sample] * 257 + sample % 17) & 65535, y * stride16 + 1 + x * 2);
  }
  const png16 = Buffer.concat([image.png.subarray(0, 8), chunk("IHDR", header16), chunk("IDAT", zlib.deflateSync(rows16)), chunk("IEND", Buffer.alloc(0))]);
  assert.equal((await sharp(png16).metadata()).depth, "ushort", "fixture carries actual 16-bit channels");
  const oriented = await sharp(image.png).withMetadata({ orientation: 6 }).png().toBuffer();
  assert.equal((await sharp(oriented).metadata()).orientation, 6);
  for (const quality of [100, 45]) {
    assert.deepEqual(await compressPng(png16, quality), png16, "16-bit input retains its precision and metadata");
    assert.deepEqual(await compressPng(oriented, quality), oriented, "oriented input retains its display orientation");
  }
  const corrupt16 = Buffer.concat([image.png.subarray(0, 8), chunk("IHDR", header16), chunk("IDAT", Buffer.from("invalid deflate")), chunk("IEND", Buffer.alloc(0))]);
  await assert.rejects(() => compressPng(corrupt16), /PNG|image|read|corrupt|header|inflate/i, "pass-through images must still have decodable pixels");
  const lossy = await compressPng(image.png, 45);
  assert.ok(lossy.length < lossless.length, "quality setting reduces a continuous-tone PNG further");
  const reduced = await pixels(lossy);
  assert.equal(reduced.info.width, image.width); assert.equal(reduced.info.height, image.height);
  assert.equal(reduced.info.channels, 4);
  const alphas = new Set(Array.from(reduced.data).filter((_, index) => index % 4 === 3));
  assert.ok(alphas.has(0) && alphas.has(255) && [...alphas].some((alpha) => alpha > 0 && alpha < 255), "palette retains transparent, opaque and translucent pixels");
  assert.deepEqual(image.png, original, "compression must not mutate input bytes");
  for (const quality of [1, 45, 100]) {
    const recompressed = await compressPng(lossless, quality);
    assert.ok(recompressed.length <= lossless.length, "an optimized image never grows");
  }
  await assert.rejects(() => compressPng(image.png, 101), /quality|质量/i);
  await assert.rejects(() => compressPng(Buffer.from("not a PNG")), /PNG|image|format/i);
  await assert.rejects(() => compressPng(image.png.subarray(0, 60)), /PNG|image|read|corrupt|header/i);
  await assert.rejects(() => compressPng(fixture(16385, 1).png), /PNG|dimension|limit|pixel|16384/i);
  const oversized = Buffer.from(image.png);
  oversized.writeUInt32BE(11000, 16); oversized.writeUInt32BE(11000, 20);
  oversized.writeUInt32BE(crc32(oversized.subarray(12, 29)), 29);
  await assert.rejects(() => compressPng(oversized), /limit|pixels/i, "reject excessive decoded pixel count before allocating image memory");

  const audio = createSamplePackage().files.get("audio/tick.wav");
  const map = new Map([
    ["spritesheet.png", image.png], ["unused.png", image.png], ["audio.wav", audio], ["manifest.json", Buffer.from("{}")],
    ["source/original.png", image.png], ["frame-tuner-source/original.png", image.png],
  ]);
  const summary = await compressRuntimePngs(map, ["spritesheet.png", "spritesheet.png", "source/original.png", "frame-tuner-source/original.png", "audio.wav", "manifest.json"], 100);
  assert.deepEqual(summary, { quality: 100, files: 1, optimizedFiles: 1, inputBytes: image.png.length, outputBytes: map.get("spritesheet.png").length }, "duplicate atlas references count only once");
  for (const name of ["unused.png", "source/original.png", "frame-tuner-source/original.png"]) assert.deepEqual(map.get(name), original, `${name} is not recompressed`);
  assert.deepEqual(map.get("audio.wav"), audio); assert.deepEqual(map.get("manifest.json"), Buffer.from("{}"));
  await assert.rejects(() => compressRuntimePngs(new Map([["broken.png", Buffer.from("broken")]]), ["broken.png"]), /PNG|image|format/i);

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "frame-tuner-png-compression-"));
  try {
    fs.writeFileSync(path.join(root, "original.png"), image.png);
    fs.writeFileSync(path.join(root, "original.wav"), audio);
    const projectData = {
      projectId: "compression", project: { id: "compression", label: "Compression", engine: "none" },
      manifest: { profiles: [{ id: "hero", animations: [{ id: "idle", frames: [{ path: "original.png" }] }] }] },
      tuning: { frame_transforms: { "hero/idle/0": { x: 5, y: -3, scale: 1.25, rotation: 10 } } },
      frameAudioBindings: { "hero/idle/1": [{ path: "original.wav", volume: 0.45 }] },
    };
    const source = { tuning: { frame_transforms: { "hero/idle/0": { x: 9, y: -3, scale: 1.75 } } } };
    const projectBefore = structuredClone(projectData), sourceBefore = structuredClone(source);
    for (const format of ["sequence", "sheet", "cocos"]) {
      const input = packageFixture(image, format, audio);
      const before = new Map([...input.files].map(([name, bytes]) => [name, Buffer.from(bytes)]));
      const manifestBefore = structuredClone(input.manifest);
      const exported = await buildExportPackage({ format, manifest: input.manifest, files: input.files, source }, { root, projectData });
      const smaller = await buildExportPackage({ format, manifest: input.manifest, files: input.files, source, pngQuality: "45" }, { root, projectData });
      const prefix = format === "cocos" ? "assets/resources/frame-tuner/compression/" : "";
      const runtime = new Set(input.images.map((name) => prefix + name));
      assert.equal(exported.pngCompression.quality, 100);
      assert.equal(exported.pngCompression.files, runtime.size, `${format}: process every unique runtime PNG`);
      assert.equal(smaller.pngCompression.quality, 45);
      assert.equal(smaller.pngCompression.files, runtime.size);
      assert.ok(smaller.pngCompression.outputBytes < exported.pngCompression.outputBytes, `${format}: quality reaches package compressor`);
      assert.deepEqual(smaller.manifest, exported.manifest, `${format}: animation data does not change with quality`);
      for (const name of runtime) await samePixels(exported.files.get(name), image.png, `${format}: ${name}`);
      for (const [name, bytes] of exported.files) {
        if (!runtime.has(name)) assert.deepEqual(smaller.files.get(name), bytes, `${format}: ${name} stays byte-identical at different quality`);
      }
      const sourcePrefix = format === "cocos" ? "frame-tuner-source/" : "";
      for (const name of ["source/embedded.png", "source/tuning.json", "frame-tuner-source/original.png", "audio/tick.wav", "notes.json"]) {
        assert.deepEqual(smaller.files.get(sourcePrefix + name), before.get(name), `${format}: archived ${name} preserves original bytes`);
      }
      const archived = JSON.parse(smaller.files.get(`${sourcePrefix}source/project.json`));
      const originalPath = archived.manifest.profiles[0].animations[0].frames[0].path;
      assert.deepEqual(smaller.files.get(sourcePrefix + originalPath), original, `${format}: source asset is untouched`);
      assert.deepEqual(archived.tuning, projectData.tuning, `${format}: saved tuning is untouched`);
      const snapshot = JSON.parse(smaller.files.get(`${sourcePrefix}source/editor-snapshot.json`));
      assert.deepEqual(snapshot.tuning, source.tuning, `${format}: unsaved tuning is untouched`);
      if (format === "cocos") {
        for (const name of input.images) assert.deepEqual(smaller.files.get(`frame-tuner-source/${name}`), image.png, "Cocos source copies preserve uncompressed runtime originals too");
      }
      for (const [label, result] of [["lossless", exported], ["quality45", smaller]]) {
        const unpacked = unzip(result.buffer);
        assert.equal(unpacked.size, result.files.size);
        const destination = path.join(root, `${format}-${label}`);
        writePackageDirectory(destination, result.files);
        for (const [name, bytes] of result.files) {
          assert.deepEqual(unpacked.get(name), bytes, `${format}/${label}: ZIP ${name}`);
          assert.deepEqual(fs.readFileSync(path.join(destination, name)), bytes, `${format}/${label}: directory ${name}`);
        }
      }
      assert.deepEqual(input.files, before, `${format}: caller input map is untouched`);
      assert.deepEqual(input.manifest, manifestBefore, `${format}: caller manifest is untouched`);
    }
    assert.deepEqual(projectData, projectBefore); assert.deepEqual(source, sourceBefore);
    assert.deepEqual(fs.readFileSync(path.join(root, "original.png")), original, "on-disk source PNG is untouched");
    assert.deepEqual(fs.readFileSync(path.join(root, "original.wav")), audio, "on-disk source audio is untouched");
    const input = packageFixture(image, "sheet", audio);
    await assert.rejects(() => buildExportPackage({ ...input, format: "sheet", pngQuality: 0 }), /quality|质量/i);
    input.files.set("spritesheet.png", image.png.subarray(0, 60));
    await assert.rejects(() => buildExportPackage({ ...input, format: "sheet" }), /PNG|image|read|corrupt|header/i);
    assert.equal(parseArgs(["export", "--png-quality", "45"]).args["png-quality"], "45");
    assert.throws(() => parseArgs(["export", "--png-quality"]), /Missing value/);
    for (const value of ["0", "101", "no", "1.5"]) assert.throws(() => parseArgs(["export", "--png-quality", value]), /quality|质量/i);
    return { ok: true, assertions: "Lossless RGBA/hidden RGB, 16-bit/orientation preservation, palette alpha and size, no growth, unique runtime PNGs, quality/corrupt PNG rejection, untouched source/audio/tuning, sequence/sheet/Cocos ZIP-directory parity, CLI quality validation" };
  } finally {
    const resolved = path.resolve(root);
    if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith("frame-tuner-png-compression-")) throw new Error("Unsafe temporary test cleanup path.");
    fs.rmSync(resolved, { recursive: true, force: true });
  }
}

if (require.main === module) test().then((result) => console.log(JSON.stringify(result))).catch((error) => { console.error(error); process.exitCode = 1; });
module.exports = { test };
