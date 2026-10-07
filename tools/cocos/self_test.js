"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const { buildCocosPackage, validatePackage } = require("../cocos_export");
const { createSamplePackage } = require("./sample_package");
const { buildRuntimeData } = require("../runtime_data");

function loadTs(file) {
  const source = fs.readFileSync(path.join(__dirname, file), "utf8");
  const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2019, module: ts.ModuleKind.CommonJS } });
  const exports = {};
  vm.runInNewContext(outputText, { exports, require }, { filename: file });
  return exports;
}

const { FrameTunerClock } = loadTs("FrameTunerClock.ts");
const { boxCorners, frameAnchor } = loadTs("FrameTunerData.ts");
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-7, `${actual} ≠ ${expected}`);
const frames = [{ durationMs: 120 }, { durationMs: 0, disabled: true }, { durationMs: 310 }, { durationMs: 80 }];

{
  const clock = new FrameTunerClock();
  const events = [];
  let finishes = 0;
  assert.equal(clock.start(frames, false, { frame: index => events.push(index), finish: () => { finishes += 1; } }), true);
  clock.advance(119); assert.equal(clock.frameIndex, 0);
  clock.advance(1); assert.equal(clock.frameIndex, 2);
  clock.advance(325); assert.equal(clock.frameIndex, 3); close(clock.elapsedMs, 15);
  clock.advance(65); assert.equal(clock.finished, true); assert.equal(clock.playing, false);
  assert.equal(clock.frameIndex, 3); assert.equal(finishes, 1);
  clock.advance(9999); clock.resume(); clock.advance(9999); assert.equal(finishes, 1);
  assert.deepEqual(events, [0, 2, 3]);
}
{
  const clock = new FrameTunerClock();
  const visited = [];
  clock.start(frames, true, { frame: index => visited.push(index) });
  for (let index = 0; index < 600; index += 1) clock.advance(1000 / 60);
  assert.equal(clock.cycles, 19); assert.equal(clock.frameIndex, 2); close(clock.elapsedMs, 190);
  assert.ok(!visited.includes(1));
  clock.pause(); clock.advance(500); close(clock.elapsedMs, 190);
  clock.resume(); clock.advance(120); assert.equal(clock.frameIndex, 3);
}
{
  const clock = new FrameTunerClock();
  clock.start(frames, true, { frame: index => {
    if (index === 2) clock.start([{ durationMs: 90 }], false);
  } });
  clock.advance(800); assert.equal(clock.frameIndex, 0); assert.equal(clock.elapsedMs, 0);
  assert.equal(clock.finished, false); clock.advance(90); assert.equal(clock.finished, true);
  clock.start(frames, true, { loop: () => clock.pause() });
  clock.advance(510); assert.equal(clock.frameIndex, 0); assert.equal(clock.playing, false);
  clock.resume(); clock.advance(120); assert.equal(clock.frameIndex, 2);
  assert.equal(clock.start([{ durationMs: 0, disabled: true }], true), false);
  assert.throws(() => clock.start([{ durationMs: 0 }], true), /positive durationMs/);
  assert.throws(() => clock.advance(Infinity), /finite/);
}
{
  const clock = new FrameTunerClock();
  let visits = 0;
  // A zero-duration update must never consume a very short positive frame.
  clock.start([{ durationMs: 1e-10 }], true, { frame: () => {
    visits += 1;
    assert.ok(visits < 10, "small durations must not cause an unbounded loop");
  } });
  clock.advance(0);
  assert.equal(visits, 1);
  clock.advance(1e-10);
  assert.equal(visits, 2);
  assert.equal(clock.cycles, 1);
}
{
  const anchor = frameAnchor({ origin: { x: 10, y: 80 }, width: 40, height: 100 });
  close(anchor.x, 0.25); close(anchor.y, 0.2);
  const box = { position: { x: 20, y: -10 }, size: { x: 4, y: 8 }, rotation: 90 };
  const right = boxCorners(box, false, 2), left = boxCorners(box, true, 2);
  close(right[0].x, 12); close(right[0].y, 6);
  for (let index = 0; index < 4; index += 1) { close(left[index].x, -right[index].x); close(left[index].y, right[index].y); }
}
{
  const crop = { x: 12, y: 24, width: 40, height: 60, sheetWidth: 200, sheetHeight: 200 };
  const manifest = { profiles: [{ id: "actor", animations: [{ id: "idle", frames: [{ path: "sheet.png", width: 40, height: 60, crop }] }] }] };
  const raw = buildRuntimeData({ manifest }).profiles[0].animations[0].frames[0];
  assert.deepEqual(raw.crop, crop); assert.deepEqual(raw.sourceCrop, crop);
  raw.crop.x = 99; assert.equal(crop.x, 12);
  const baked = buildRuntimeData({ manifest, bakedFrames: [{ key: "actor/idle:0", assetPath: "baked.png" }] }).profiles[0].animations[0].frames[0];
  assert.equal(baked.crop, null); assert.deepEqual(baked.sourceCrop, crop);
}
{
  const { pkg, files } = createSamplePackage();
  files.set("source/project.json", Buffer.from('{"authoritative":true}'));
  pkg.editableSource = "source/project.json";
  const result = buildCocosPackage(pkg, files, { demo: true });
  assert.ok(result.files.has("assets/scripts/frame-tuner/FrameTunerPlayer.ts"));
  assert.ok(result.files.has("assets/frame-tuner-demo/FrameTunerDemo.scene"));
  assert.ok(result.files.has("frame-tuner-source/source/project.json"));
  assert.equal(JSON.parse(result.files.get("frame-tuner-source/manifest.json")).editableSource, "source/project.json");
  assert.equal(JSON.parse(result.files.get("assets/resources/frame-tuner/demo/manifest.json")).sourceArchive.base, "export-root");
  assert.equal(JSON.parse(result.files.get("package.json")).creator.version, "3.8.8");
  assert.equal(result.manifest.resourcePath, "frame-tuner/demo/manifest");
  const chinese = buildCocosPackage({ ...pkg, projectId: "角色测试" }, files);
  assert.match(chinese.manifest.resourcePath, /^frame-tuner\/project-[0-9a-f]{12}\/manifest$/);
  assert.throws(() => validatePackage({ ...pkg, bakedVisual: false }, files), /baked/);
  const bad = structuredClone(pkg); bad.animations[0].frames[0].path = "../bad.png";
  assert.throws(() => validatePackage(bad, files), /Invalid package path/);
  const wrong = structuredClone(pkg); wrong.animations[0].frames[0].width = 20;
  assert.throws(() => validatePackage(wrong, files), /dimensions differ/);
  const atlas = structuredClone(pkg); const frame = atlas.animations[0].frames[0];
  frame.width = 96; frame.height = 88; frame.atlasRect = { x: 96, y: 88, width: 96, height: 88 };
  assert.doesNotThrow(() => validatePackage(atlas, files));
  frame.atlasRect.x = 97;
  assert.throws(() => validatePackage(atlas, files), /crop exceeds/);
  const missing = new Map(files); missing.delete("audio/tick.wav");
  assert.throws(() => validatePackage(pkg, missing), /missing asset/);
}

console.log("Cocos adapter tests passed: timing, disabled frames, finish, looping, cancellation, facing, origin, boxes, atlas, archive and package validation.");
