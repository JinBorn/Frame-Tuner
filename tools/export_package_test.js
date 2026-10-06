const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const zlib = require("node:zlib");
const { createSamplePackage } = require("./cocos/sample_package");
const { buildExportPackage, crc32, safePackagePath, writePackageDirectory } = require("./export_package");
const { createWorkbenchService } = require("./workbench_service");
const { run } = require("./frame_tuner");

// Parse ZIP records independently of the writer, checking content, checksums and
// directory offsets. This catches archives that look valid but cannot be opened.
function unzip(buffer) {
  const files = new Map();
  let offset = 0;
  const locations = [];
  while (buffer.readUInt32LE(offset) === 0x04034b50) {
    const size = buffer.readUInt32LE(offset + 18), length = buffer.readUInt16LE(offset + 26);
    const name = buffer.subarray(offset + 30, offset + 30 + length).toString("utf8");
    const bytes = zlib.inflateRawSync(buffer.subarray(offset + 30 + length, offset + 30 + length + size));
    assert.equal(crc32(bytes), buffer.readUInt32LE(offset + 14));
    assert.equal(bytes.length, buffer.readUInt32LE(offset + 22));
    assert.equal(buffer.readUInt16LE(offset + 6), 0x800, "UTF-8 file names");
    locations.push(offset); files.set(name, bytes); offset += 30 + length + size;
  }
  const start = offset;
  locations.forEach((location) => {
    assert.equal(buffer.readUInt32LE(offset), 0x02014b50);
    assert.equal(buffer.readUInt32LE(offset + 42), location);
    offset += 46 + buffer.readUInt16LE(offset + 28);
  });
  assert.equal(buffer.readUInt32LE(offset), 0x06054b50);
  assert.equal(buffer.readUInt32LE(offset + 16), start);
  assert.equal(buffer.readUInt16LE(offset + 10), files.size);
  return files;
}

async function test() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "frame-tuner-export-test-"));
  try {
    const sample = createSamplePackage();
    const input = path.join(root, "input"); fs.mkdirSync(input);
    fs.writeFileSync(path.join(input, "frame_10.png"), sample.files.get("frames/demo_2.png"));
    fs.writeFileSync(path.join(input, "frame_2.png"), sample.files.get("frames/demo_0.png"));
    const service = createWorkbenchService({ root });
    const created = await run(["create", "--name", "导出测试", "--id", "export-test"], { service });
    const projectId = created.projectId;
    assert.equal(created.ok, true);
    const imported = await run(["import", "--project", projectId, "--profile", "hero", "--animation", "idle", "--input", input, "--fps", "10"], { service });
    assert.equal(imported.frameCount, 2);
    const data = service.projectData(projectId);
    assert.equal(data.manifest.profiles[0].animations[0].frames[0].name, "frame_2.png", "natural sequence ordering");
    assert.equal((await run(["validate", "--project", projectId], { service })).ok, true);
    const before = fs.readFileSync(data.paths.manifest);
    const result = await buildExportPackage({ format: "sequence", manifest: sample.pkg, files: sample.files }, { root, projectData: data });
    const unpacked = unzip(result.buffer);
    assert.deepEqual(unpacked.get("frames/demo_2.png"), sample.files.get("frames/demo_2.png"));
    assert.deepEqual(unpacked.get("audio/tick.wav"), sample.files.get("audio/tick.wav"));
    const manifest = JSON.parse(unpacked.get("manifest.json"));
    assert.equal(manifest.animations[0].frames[2].durationMs, 310);
    assert.equal(manifest.animations[0].frames[2].audio[0].volume, 0.35);
    assert.deepEqual(manifest.animations[0].frames[3].boxes[1], sample.pkg.animations[0].frames[3].boxes[1]);
    const source = JSON.parse(unpacked.get("source/project.json"));
    const sourcePath = source.manifest.profiles[0].animations[0].frames[0].path;
    assert.ok(sourcePath.startsWith("source/assets/"));
    assert.deepEqual(unpacked.get(sourcePath), sample.files.get("frames/demo_0.png"));
    assert.deepEqual(fs.readFileSync(data.paths.manifest), before, "export must not alter source project");
    const output = path.join(root, "export"); writePackageDirectory(output, result.files);
    assert.deepEqual(fs.readFileSync(path.join(output, "audio", "tick.wav")), sample.files.get("audio/tick.wav"));
    assert.throws(() => writePackageDirectory(output, result.files), /empty/);
    assert.throws(() => safePackagePath("../outside.png"), /Invalid/);
    const missing = new Map(sample.files); missing.delete("audio/tick.wav");
    await assert.rejects(() => buildExportPackage({ manifest: sample.pkg, files: missing }), /Missing exported audio/);
    const invalid = structuredClone(sample.pkg); invalid.animations[0].frames[0].durationMs = 0;
    await assert.rejects(() => buildExportPackage({ manifest: invalid, files: sample.files }), /frame duration/);
    const cocos = await buildExportPackage({ format: "cocos", manifest: sample.pkg, files: sample.files }, { root, projectData: data });
    const cocosFiles = unzip(cocos.buffer);
    assert.ok([...cocosFiles.keys()].some((name) => name.endsWith("FrameTunerPlayer.ts")));
    assert.ok([...cocosFiles.keys()].some((name) => name.endsWith("source/project.json")), "Cocos archive retains editable project");
    return { ok: true, assertions: "PNG/audio ZIP roundtrip, CRC and central directory, metadata, portable source, CLI create/import/validate, Cocos package and invalid input rejection" };
  } finally {
    const resolved = path.resolve(root);
    if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith("frame-tuner-export-test-")) throw new Error("Unsafe temporary test cleanup path.");
    fs.rmSync(resolved, { recursive: true, force: true });
  }
}
if (require.main === module) test().then((result) => console.log(JSON.stringify(result))).catch((error) => { console.error(error); process.exitCode = 1; });
module.exports = { test, unzip };
