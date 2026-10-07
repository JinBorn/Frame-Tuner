"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { readSharedAttackTrailPresetStore, sharedAttackTrailPresetPath, attackTrailsWithSharedPresets, saveSharedAttackTrailPresets } = require("./attack_trail_presets");

const temporaryBase = path.resolve(os.tmpdir());
const root = fs.mkdtempSync(path.join(temporaryBase, "frame-tuner-preset-integrity-"));
try {
  const target = sharedAttackTrailPresetPath(root);
  assert.deepEqual(readSharedAttackTrailPresetStore(root).presets, []);
  assert.equal(fs.existsSync(target), false, "Reading a missing file does not create it");
  fs.mkdirSync(path.dirname(target), { recursive: true });
  for (const invalid of ["{broken", "null", "[]", "{}", '{"presets":{}}', '{"presets":[],"schemaVersion":999}', '{"presets":[],"migratedProjectIds":{}}', '{"presets":[null]}']) {
    fs.writeFileSync(target, invalid);
    for (const operation of [() => readSharedAttackTrailPresetStore(root), () => attackTrailsWithSharedPresets(root, "hero", { presets: [], bindings: {} }), () => saveSharedAttackTrailPresets(root, "hero", [])]) {
      assert.throws(operation, { code: "invalid_project_json" });
      assert.equal(fs.readFileSync(target, "utf8"), invalid, "Reading, migrating, or saving cannot replace corrupt originals");
    }
  }
  fs.writeFileSync(target, '\uFEFF{"presets":[],"migratedProjectIds":[]}');
  assert.deepEqual(readSharedAttackTrailPresetStore(root).presets, [], "Legacy schema without an explicit version and BOM remains readable");
  attackTrailsWithSharedPresets(root, "hero", { presets: [], bindings: {} });
  assert.deepEqual(readSharedAttackTrailPresetStore(root).migratedProjectIds, ["hero"]);
  console.log("Shared preset integrity passed: malformed JSON/schema preserved across read, migration and save.");
} finally {
  assert.ok(root.startsWith(`${temporaryBase}${path.sep}frame-tuner-preset-integrity-`));
  fs.rmSync(root, { recursive: true, force: true });
}
