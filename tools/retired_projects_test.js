"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createWorkbenchService } = require("./workbench_service");
const { run } = require("./frame_tuner");

const temporaryBase = path.resolve(os.tmpdir());
const root = fs.mkdtempSync(path.join(temporaryBase, "frame-tuner-retired-"));
const pixel = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==";

async function test() {
  const service = createWorkbenchService({ root });
  // A normal authoring project can still have the old integration's name.
  const normal = service.createProject({ id: "codex_pets", label: "My animation" }).project;
  service.importAnimation({ projectId: normal.id, profileId: "hero", animationId: "idle", files: [{ name: "frame.png", data: pixel }] });
  const legacy = {
    id: "old-pets", label: "Old pets", kind: "codex_pets",
    projectRoot: path.join(root, "external-pets"), petRoot: path.join(root, "external-pets"),
    dataDir: "data/projects/old-pets", workspaceDir: "workspace/projects/old-pets",
    recoveryMetadata: { keep: true },
  };
  const registryPath = path.join(root, "data", "projects.json");
  const readStored = () => JSON.parse(fs.readFileSync(registryPath, "utf8"));
  const registry = readStored();
  registry.projects.unshift(legacy);
  registry.activeProjectId = legacy.id;
  fs.writeFileSync(registryPath, JSON.stringify(registry));
  const settingsPath = path.join(root, "data", "workbench_settings.json");
  const oldSettings = JSON.stringify({ codexPets: true });
  fs.writeFileSync(settingsPath, oldSettings);
  fs.mkdirSync(legacy.petRoot);
  const oldAtlas = path.join(legacy.petRoot, "spritesheet.webp");
  const preservedBytes = Buffer.from("Existing user pet asset must remain untouched.");
  fs.writeFileSync(oldAtlas, preservedBytes);

  assert.deepEqual(service.listProjects().map(project => project.id), [normal.id]);
  assert.equal(service.projectData().project.id, normal.id);
  assert.deepEqual(readStored().projects.find(project => project.id === legacy.id), legacy);
  assert.throws(() => service.projectData(legacy.id), { code: "project_not_found" });
  assert.throws(() => service.store.setActiveProject(legacy.id), { code: "unsupported_engine" });
  assert.throws(() => service.store.renameProject(legacy.id, "Changed"), { code: "unsupported_engine" });
  assert.throws(() => service.store.removeProject(legacy.id), { code: "unsupported_engine" });
  assert.throws(() => service.store.addProject({ kind: "codex_pets", label: "New pets" }), { code: "unsupported_engine" });
  for (const method of ["projectDataDir", "projectWorkspaceDir", "projectPaths", "ensureProjectFiles"]) {
    assert.throws(() => service.store[method](legacy), { code: "unsupported_engine" }, method);
  }
  assert.deepEqual((await run(["list"], { service })).projects.map(project => project.id), [normal.id]);
  await assert.rejects(run(["export", "--project", legacy.id, "--format", "cocos", "--out", path.join(root, "blocked-export")], { service }), /Project not found/);
  assert.equal(fs.existsSync(path.join(root, "blocked-export")), false);

  process.env.FRAME_TUNER_ROOT = root;
  // A setting left behind by an older release cannot re-enable removed code.
  process.env.FRAME_TUNER_CODEX_PETS = "1";
  const { server } = require("./animation_tuner/server");
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  const post = (route, payload) => fetch(`${url}${route}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload),
  });
  try {
    const capabilities = await (await fetch(`${url}/api/workbench/capabilities`)).json();
    assert.equal(Object.hasOwn(capabilities.features, "codexPets"), false);
    assert.equal(Object.hasOwn(capabilities.features, "codexPetsToggle"), false);
    assert.equal(capabilities.adapters.some(adapter => adapter.id === "codex_pets"), false);
    assert.equal(capabilities.adapters.some(adapter => adapter.id === "cocos"), true);
    const listed = await (await fetch(`${url}/api/projects`)).json();
    assert.equal(listed.activeProjectId, normal.id);
    assert.deepEqual(listed.projects.map(project => project.id), [normal.id]);
    assert.equal((await fetch(`${url}/api/config?project=${legacy.id}`)).status, 404);
    for (const [route, payload, expected] of [
      ["/api/workbench/codex-pets", { enabled: true }, 404],
      ["/api/codex-pets/import", { projectId: legacy.id, data: "invalid" }, 404],
      ["/api/projects", { kind: "codex_pets", label: "New pets" }, 400],
      ["/api/projects/active", { projectId: legacy.id }, 404],
      ["/api/save", { projectId: legacy.id, force: true, values: {}, codex_pet_exports: [{ profileId: "custom:old", data: "invalid" }] }, 404],
      ["/api/replace-animation", { projectId: legacy.id }, 404],
      ["/api/attack-trail-texture", { projectId: legacy.id }, 404],
      ["/api/workbench/export", { projectId: legacy.id, format: "cocos" }, 404],
    ]) {
      const response = await post(route, payload);
      assert.equal(response.status, expected, `${route}: ${await response.text()}`);
    }
    const config = await (await fetch(`${url}/api/config?project=${normal.id}`)).json();
    const saved = await post("/api/save", { projectId: normal.id, configRevision: config.configRevision,
      values: { "profiles.hero.character.visual_size": 1.5 }, frame_playback_overrides: { "hero/idle:0": { duration: 2 } } });
    assert.equal(saved.status, 200, await saved.text());
    assert.equal(service.projectData(normal.id).tuning.values["profiles.hero.character.visual_size"], 1.5);
    const html = await (await fetch(url)).text();
    assert.doesNotMatch(html, /workbenchPetsToggle|addCodexPet|workbenchOptionalFeatures/);

    // Removing the last supported project leaves a usable empty workbench.
    service.store.removeProject(normal.id);
    const empty = await (await fetch(`${url}/api/projects`)).json();
    assert.deepEqual(empty.projects, []);
    assert.equal(empty.activeProjectId, "");
    const emptyConfig = await (await fetch(`${url}/api/config`)).json();
    assert.equal(emptyConfig.activeProjectId, "");
    assert.deepEqual(emptyConfig.groups, []);
    const fresh = await post("/api/workbench/projects", { id: legacy.id, label: "Fresh animation" });
    assert.equal(fresh.status, 201);
    const created = await fresh.json();
    assert.notEqual(created.projectId, legacy.id, "Retired IDs remain reserved for their preserved data");
    assert.equal(created.project.kind, "frame_lite");
    assert.deepEqual(readStored().projects.find(project => project.id === legacy.id), legacy);
    assert.deepEqual(fs.readFileSync(oldAtlas), preservedBytes);
    assert.equal(fs.readFileSync(settingsPath, "utf8"), oldSettings);
    assert.equal(fs.existsSync(path.join(root, legacy.dataDir)), false);
    assert.equal(fs.existsSync(path.join(root, legacy.workspaceDir)), false);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
  console.log("Retired project checks passed: old files/metadata preserved, removed APIs blocked, same-name normal project saved, CLI export blocked, empty state usable.");
}

test().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
  const resolved = path.resolve(root);
  assert.equal(path.dirname(resolved), temporaryBase);
  assert.match(path.basename(resolved), /^frame-tuner-retired-/);
  fs.rmSync(resolved, { recursive: true, force: true });
});
