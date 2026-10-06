"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createWorkbenchService } = require("./workbench_service");

const pixel = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==";
const temporaryBase = path.resolve(os.tmpdir());
const root = fs.mkdtempSync(path.join(temporaryBase, "frame-tuner-registry-"));

function authorProject(service, created, animationId, scale) {
  assert.equal(created.ok, true);
  assert.equal(created.projectId, created.project.id, "Creation returns the project it registered");
  assert.equal(service.store.readRegistry().activeProjectId, created.projectId);
  service.importAnimation({ projectId: created.projectId, profileId: "actor", animationId,
    files: [{ name: "frame.png", data: pixel }] });
  const data = service.projectData(created.projectId);
  data.tuning.values["profiles.actor.character.visual_size"] = scale;
  service.store.writeJson(data.paths.tuning, data.tuning);
  return data;
}

function verifyIndependentProjects(directory, firstPayload, secondPayload) {
  const service = createWorkbenchService({ root: path.join(root, directory) });
  const first = service.createProject(firstPayload);
  const initial = authorProject(service, first, "idle", 1.25);
  const firstManifest = fs.readFileSync(initial.paths.manifest, "utf8");
  const firstTuning = fs.readFileSync(initial.paths.tuning, "utf8");
  const second = service.createProject(secondPayload);
  assert.notEqual(first.projectId.toLowerCase(), second.projectId.toLowerCase(), "New IDs have distinct case-insensitive paths");
  assert.equal(second.project.label, secondPayload.label);
  authorProject(service, second, "run", 2.5);

  // Reopen the real registry and data files, rather than only checking normalization.
  const reopened = createWorkbenchService({ root: service.root });
  const projects = reopened.listProjects();
  assert.equal(projects.length, 2);
  for (const [created, animation, scale] of [[first, "idle", 1.25], [second, "run", 2.5]]) {
    assert.ok(projects.some(project => project.id === created.projectId));
    reopened.store.setActiveProject(created.projectId);
    const data = reopened.projectData();
    assert.equal(data.project.id, created.projectId);
    assert.equal(data.manifest.profiles[0].animations.length, 1);
    assert.equal(data.manifest.profiles[0].animations[0].id, animation);
    assert.equal(data.tuning.values["profiles.actor.character.visual_size"], scale);
  }
  assert.equal(fs.readFileSync(initial.paths.manifest, "utf8"), firstManifest);
  assert.equal(fs.readFileSync(initial.paths.tuning, "utf8"), firstTuning);
  return { first, second };
}

try {
  const defaultFirst = verifyIndependentProjects("default-label-first", { label: "default" }, { label: "Second" });
  assert.equal(defaultFirst.first.projectId, "default");
  const defaultSecond = verifyIndependentProjects("default-label-second", { label: "First" }, { label: "default" });
  assert.equal(defaultSecond.second.projectId, "default");
  verifyIndependentProjects("default-id-first", { label: "Authored default", id: "default" }, { label: "Second" });
  verifyIndependentProjects("default-id-second", { label: "First" }, { label: "Authored default", id: "default" });
  const mixedCase = verifyIndependentProjects("case-distinct", { label: "Hero" }, { label: "hero" });
  assert.equal(mixedCase.first.projectId, "Hero");
  assert.equal(mixedCase.second.projectId, "hero_2");
  const explicitCase = verifyIndependentProjects("case-explicit", { label: "First", id: "Hero" }, { label: "Second", id: "hero" });
  assert.equal(explicitCase.second.projectId, "hero_2");
  const legacy = createWorkbenchService({ root: path.join(root, "legacy-paths") });
  legacy.store.writeRegistry({ schemaVersion: 1, activeProjectId: "HERO", projects: [
    { id: "Hero", label: "Legacy A", kind: "frame_lite", dataDir: "data/legacy-a", workspaceDir: "workspace/legacy-a" },
    { id: "HERO", label: "Legacy B", kind: "frame_lite", dataDir: "data/legacy-b", workspaceDir: "workspace/legacy-b" },
  ] });
  assert.deepEqual(legacy.listProjects().map(project => [project.id, project.dataDir]), [
    ["Hero", "data/legacy-a"], ["HERO", "data/legacy-b"],
  ], "Loading existing IDs never silently renames them or relocates their data");
  assert.equal(legacy.createProject({ label: "hero" }).projectId, "hero_2");
  console.log("Project registry tests passed: default project retention and independent case-insensitive paths.");
} finally {
  const resolved = path.resolve(root);
  assert.equal(path.dirname(resolved), temporaryBase);
  assert.match(path.basename(resolved), /^frame-tuner-registry-/);
  fs.rmSync(resolved, { recursive: true, force: true });
}
