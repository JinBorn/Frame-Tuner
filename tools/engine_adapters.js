"use strict";

// A kind identifies the authoring project. Export targets are independent of it.
const ADAPTERS = Object.freeze({
  frame_lite: { id: "frame_lite", engine: "lite", label: "Independent workspace", sync: false, scenes: false, portableExport: true },
  godot: { id: "godot", engine: "godot", label: "Godot", sync: true, scenes: true, portableExport: false },
  unity: { id: "unity", engine: "unity", label: "Unity", sync: true, scenes: true, portableExport: false },
  cocos: { id: "cocos", engine: "cocos", label: "Cocos Creator 3.8.8 export", sync: false, scenes: false, portableExport: true },
  codex_pets: { id: "codex_pets", engine: "codex_pets", label: "Codex Pets (optional)", sync: true, scenes: false, portableExport: false },
});

function projectKind(project) {
  // Existing records without kind were Godot projects; never reclassify them.
  return String(project?.kind || project?.engine || "godot").toLowerCase();
}

function adapterForProject(project) {
  return ADAPTERS[projectKind(project)] || { id: projectKind(project), engine: "unsupported", label: "Unsupported project kind", sync: false, scenes: false, portableExport: false, supported: false };
}

function capabilities(options = {}) {
  return {
    schemaVersion: 1,
    defaultKind: "frame_lite",
    features: { createProject: true, importPng: true, importSheet: true, portableExport: true, codexPets: options.codexPets === true, codexPetsToggle: options.codexPetsToggle === true },
    adapters: Object.values(ADAPTERS).map((adapter) => ({ ...adapter, supported: true, enabled: adapter.id !== "codex_pets" || options.codexPets === true })),
  };
}

module.exports = { ADAPTERS, adapterForProject, capabilities, projectKind };
