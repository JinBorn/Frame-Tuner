"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { createWorkbenchService } = require("./workbench_service");
const { createLiteStore } = require("./frame_tuner_lite/store");
const { projectEngine } = require("./project_store");

const pixel = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==";
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "frame-tuner-workbench-"));

async function run() {
  const service = createWorkbenchService({ root: tempRoot });
  const created = service.createProject({ label: "Neutral hero" });
  assert.equal(created.project.kind, "frame_lite");
  assert.equal(projectEngine({ kind: "unknown_engine" }), "unsupported");
  assert.equal(projectEngine({}), "godot", "Legacy untyped records keep their original engine");
  const input = { projectId: created.projectId, profileId: "hero", animationId: "walk", fps: 8, files: [{ name: "10.png", data: pixel }, { name: "2.png", data: pixel }] };
  assert.equal(service.importAnimation(input).frameCount, 2);
  const data = service.projectData(created.projectId);
  assert.equal(data.manifest.profiles[0].animations[0].frames[0].name, "2.png");
  assert.throws(() => service.importAnimation(input), (error) => error.code === "animation_exists" && error.status === 409);
  const original = fs.readFileSync(data.paths.manifest, "utf8");
  assert.throws(() => service.importAnimation({ ...input, animationId: "bad", sheetJson: { frames: [{ frame: { x: 0, y: 0, w: 1, h: 1 }, rotated: true }] }, files: input.files.slice(0, 1) }), /Unsupported sheet packing/);
  assert.equal(fs.readFileSync(data.paths.manifest, "utf8"), original);
  assert.throws(() => service.importAnimation({ ...input, projectId: "missing" }), /Project not found/);
  assert.throws(() => service.importAnimation({ ...input, animationId: "bad", fps: NaN }), /FPS/);
  const sheet = service.importAnimation({ ...input, animationId: "sheet", sheetJson: { frames: [{ frame: { x: 0, y: 0, w: 1, h: 1 }, duration: 250 }] }, files: input.files.slice(0, 1) });
  assert.equal(sheet.frameCount, 1);
  assert.equal(service.projectData(created.projectId).manifest.profiles[0].animations[1].frames[0].duration, 2);
  fs.writeFileSync(data.paths.tuning, "{broken");
  assert.throws(() => service.importAnimation({ ...input, replace: true }), /original file was preserved/);
  assert.equal(fs.readFileSync(data.paths.tuning, "utf8"), "{broken");
  fs.writeFileSync(data.paths.tuning, JSON.stringify(data.tuning));
  assert.equal(service.importAnimation({ ...input, replace: true }).replaced, true);
  const lite = createWorkbenchService({ root: tempRoot, store: createLiteStore(tempRoot) });
  const legacy = lite.createProject({ label: "Legacy Lite" });
  assert.equal(lite.importAnimation({ ...input, projectId: legacy.projectId }).frameCount, 2);
  assert.match(lite.projectData(legacy.projectId).paths.dataDir, /data[\\/]lite/);

  const source = path.join(tempRoot, "source");
  fs.mkdirSync(source);
  fs.writeFileSync(path.join(source, "1.png"), Buffer.from(pixel.split(",")[1], "base64"));
  const cliArgs = [path.join(__dirname, "import_frames.js"), "--project", "cli-neutral", "--profile", "hero", "--animation", "idle", "--source", source];
  const importedCli = spawnSync(process.execPath, cliArgs, { encoding: "utf8", windowsHide: true, env: { ...process.env, FRAME_TUNER_ROOT: tempRoot } });
  assert.equal(importedCli.status, 0, importedCli.stderr);
  assert.equal(JSON.parse(importedCli.stdout).frameCount, 1);
  const duplicateCli = spawnSync(process.execPath, cliArgs, { encoding: "utf8", windowsHide: true, env: { ...process.env, FRAME_TUNER_ROOT: tempRoot } });
  assert.notEqual(duplicateCli.status, 0, "Legacy CLI also refuses implicit replacement");
  const batchCli = spawnSync(process.execPath, [path.join(__dirname, "import_batch.js"), "--project", "batch-neutral", "--profile", "hero", "--animation", "idle", "--source", source], { encoding: "utf8", windowsHide: true, env: { ...process.env, FRAME_TUNER_ROOT: tempRoot } });
  assert.equal(batchCli.status, 0, batchCli.stderr);
  assert.equal(JSON.parse(batchCli.stdout).frameCount, 1);

  process.env.FRAME_TUNER_ROOT = tempRoot;
  const { server } = require("./animation_tuner/server");
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  const post = async (pathname, payload) => {
    const response = await fetch(`${url}${pathname}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
    return { status: response.status, data: await response.json() };
  };
  try {
    const config = await (await fetch(`${url}/api/config?project=${created.projectId}`)).json();
    assert.equal(config.projectKind, "frame_lite");
    assert.ok(config.liteSettings);
    assert.equal(config.groups.length, 2);
    const caps = await (await fetch(`${url}/api/workbench/capabilities`)).json();
    assert.equal(caps.defaultKind, "frame_lite");
    for (const feature of ["manageProjects", "createProject", "importPng", "importSheet", "portableExport"]) {
      assert.equal(caps.features[feature], true, `Workbench supports ${feature}`);
    }
    const registry = await (await fetch(`${url}/api/projects`)).json();
    assert.ok(registry.projects.some((project) => project.id === created.projectId && project.kind === "frame_lite"));
    const saved = await post("/api/save", { projectId: created.projectId, configRevision: config.configRevision, values: { "profiles.hero.character.visual_size": 1.2 }, frame_playback_overrides: { "hero/walk:0": { duration: 2 } } });
    assert.equal(saved.status, 200, JSON.stringify(saved.data));
    const stale = await post("/api/save", { projectId: created.projectId, configRevision: config.configRevision, values: {} });
    assert.equal(stale.status, 409);
    assert.equal((await post("/api/workbench/import", input)).status, 409);
    assert.equal((await post("/api/workbench/projects", { label: "API project" })).status, 201);
    assert.equal((await fetch(`${url}/lite.js`)).status, 200);
    assert.equal((await fetch(`${url}/`)).status, 200, "Isolated data roots still serve checkout code");
    fs.writeFileSync(data.paths.tuning, "broken again");
    const blocked = await post("/api/save", { projectId: created.projectId, force: true, values: {} });
    assert.equal(blocked.status, 500);
    assert.equal(blocked.data.code, "invalid_project_json");
    assert.equal(fs.readFileSync(data.paths.tuning, "utf8"), "broken again");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

run().then(() => console.log("Workbench service and HTTP checks passed.")).catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => {
  if (!path.resolve(tempRoot).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error("Unexpected test cleanup path");
  fs.rmSync(tempRoot, { recursive: true, force: true });
});
