"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createWorkbenchService } = require("./workbench_service");
const { createLiteStore } = require("./frame_tuner_lite/store");

const temporaryBase = path.resolve(os.tmpdir());
const root = fs.mkdtempSync(path.join(temporaryBase, "frame-tuner-storage-"));
const pixel = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==";
try {
  for (const lite of [false, true]) {
    const directory = path.join(root, lite ? "lite" : "main");
    const service = createWorkbenchService({ root: directory, ...(lite ? { store: createLiteStore(directory) } : {}) });
    for (const label of ["CON", "aux.png", "LPT1", "COM¹"]) {
      const created = service.createProject({ label });
      assert.equal(created.project.label, label, "The display name stays intact");
      assert.equal(service.projectData(created.projectId).manifest.profiles.length, 0);
      assert.match(created.projectId, /^project_/);
    }
    const first = service.createProject({ label: "Hero" });
    const second = service.createProject({ label: "hero." });
    assert.notEqual(first.projectId.toLowerCase(), second.projectId.toLowerCase(), "Trailing dots cannot alias another project directory");
    const third = service.createProject({ label: "HERO" });
    assert.notEqual(first.projectId.toLowerCase(), third.projectId.toLowerCase(), "Lite and main projects both avoid case aliases");
    const payload = { projectId: first.projectId, profileId: "NUL", animationId: "COM1", files: [{ name: "frame.png", data: pixel }] };
    const imported = service.importAnimation(payload);
    assert.equal(imported.profileId, "project_NUL");
    assert.equal(imported.animationId, "project_COM1");
    const data = service.projectData(first.projectId);
    assert.ok(fs.existsSync(path.join(directory, data.manifest.profiles[0].animations[0].frames[0].path)));
    const manifest = fs.readFileSync(data.paths.manifest);
    for (const length of [33, 50]) {
      const truncated = "data:image/png;base64," + Buffer.from(pixel.split(",")[1], "base64").subarray(0, length).toString("base64");
      assert.throws(() => service.importAnimation({ ...payload, replace: true, files: [{ name: "frame.png", data: truncated }] }), { code: "invalid_import" });
      assert.deepEqual(fs.readFileSync(data.paths.manifest), manifest, "Truncated image cannot replace an existing action");
    }
    for (const [target, malformed] of [[data.paths.frameAudio, null], [data.paths.frameAudio, "broken"], [data.paths.tuning, { frame_visual_overrides: [1, 2] }], [data.paths.attackTrails, []], [data.paths.settings, { canvas: [] }]]) {
      const original = fs.readFileSync(target);
      const corrupted = JSON.stringify(malformed);
      fs.writeFileSync(target, corrupted);
      assert.throws(() => service.importAnimation({ ...payload, replace: true }), { code: "invalid_project_json" });
      assert.equal(fs.readFileSync(target, "utf8"), corrupted, "Malformed authored data must never be overwritten by replacement");
      assert.deepEqual(fs.readFileSync(data.paths.manifest), manifest, "A failed replacement leaves the manifest intact");
      fs.writeFileSync(target, original);
    }
  }
  console.log("Storage integrity passed: Windows filenames, case aliases, malformed-data preservation.");
} finally {
  assert.ok(root.startsWith(`${temporaryBase}${path.sep}frame-tuner-storage-`));
  fs.rmSync(root, { recursive: true, force: true });
}
