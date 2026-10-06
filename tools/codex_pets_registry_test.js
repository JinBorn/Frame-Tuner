"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { ensureCodexPetsProject } = require("./codex_pets");
const { createWorkbenchService } = require("./workbench_service");

const pixel = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==";
const temporaryBase = path.resolve(os.tmpdir());
const root = fs.mkdtempSync(path.join(temporaryBase, "frame-tuner-pets-registry-"));

function checkCollision(name, ids, expectedPetId) {
  const service = createWorkbenchService({ root: path.join(root, name) });
  const originals = ids.map((id) => {
    const created = service.createProject({ label: `User ${id}`, id });
    service.importAnimation({ projectId: created.projectId, profileId: "hero", animationId: "idle",
      files: [{ name: "1.png", data: pixel }] });
    const data = service.projectData(created.projectId);
    data.tuning.values["profiles.hero.character.visual_size"] = 1.75;
    service.store.writeJson(data.paths.tuning, data.tuning);
    return { project: structuredClone(data.project), paths: data.paths,
      manifest: fs.readFileSync(data.paths.manifest, "utf8"), tuning: fs.readFileSync(data.paths.tuning, "utf8") };
  });
  const active = service.store.readRegistry().activeProjectId;
  const petRoot = path.join(root, name, "isolated-client", "pets");
  const registry = ensureCodexPetsProject(service.store, { petRoot });
  assert.equal(registry.projects.length, ids.length + 1);
  assert.equal(registry.activeProjectId, active || expectedPetId);
  const pets = registry.projects.filter(project => project.kind === "codex_pets");
  assert.equal(pets.length, 1);
  assert.equal(pets[0].id, expectedPetId);
  assert.equal(pets[0].petRoot, petRoot);
  const petPaths = service.store.projectPaths(pets[0]);
  const marker = { schemaVersion: 1, profiles: [{ id: "kept-pet", animations: [] }] };
  service.store.writeJson(petPaths.manifest, marker);

  // Recreate the store to model a fresh server process and re-enable the feature.
  const reopened = createWorkbenchService({ root: service.root });
  const repeated = ensureCodexPetsProject(reopened.store, { petRoot });
  assert.deepEqual(repeated, registry, "Repeated startup reuses the same Pets project and paths");
  assert.deepEqual(reopened.store.readJson(petPaths.manifest), marker);
  for (const original of originals) {
    const data = reopened.projectData(original.project.id);
    assert.deepEqual(data.project, original.project, "Enabling Pets never reclassifies the user's project");
    assert.notEqual(data.paths.dataDir.toLowerCase(), petPaths.dataDir.toLowerCase());
    assert.notEqual(data.paths.workspaceDir.toLowerCase(), petPaths.workspaceDir.toLowerCase());
    assert.equal(fs.readFileSync(data.paths.manifest, "utf8"), original.manifest);
    assert.equal(fs.readFileSync(data.paths.tuning, "utf8"), original.tuning);
  }
}

try {
  checkCollision("exact", ["codex_pets"], "codex_pets_2");
  checkCollision("case-and-suffix", ["Codex_Pets", "codex_pets_2"], "codex_pets_3");
  checkCollision("empty", [], "codex_pets");
  const service = createWorkbenchService({ root: path.join(root, "existing-pet") });
  const petRoot = path.join(root, "existing-pet", "isolated-client", "pets");
  service.store.writeRegistry({ schemaVersion: 1, activeProjectId: "my-pets", projects: [
    { id: "my-pets", label: "My Pets", kind: "codex_pets", petRoot, projectRoot: petRoot,
      dataDir: "data/my-pet-data", workspaceDir: "workspace/my-pet-assets" },
  ] });
  const before = service.store.readRegistry();
  assert.deepEqual(ensureCodexPetsProject(service.store, { petRoot }), before,
    "A genuine Pets project with an existing non-default ID is reused");
  console.log("Codex Pets registry tests passed: user projects preserved, unique IDs, stable restart.");
} finally {
  const resolved = path.resolve(root);
  assert.equal(path.dirname(resolved), temporaryBase);
  assert.match(path.basename(resolved), /^frame-tuner-pets-registry-/);
  fs.rmSync(resolved, { recursive: true, force: true });
}
