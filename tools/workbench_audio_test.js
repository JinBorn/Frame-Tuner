"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createWorkbenchService } = require("./workbench_service");
const { createLiteStore } = require("./frame_tuner_lite/store");
const { importSheetAudio } = require("./frame_tuner_lite/import_sheet");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "frame-tuner-audio-"));
try {
  const service = createWorkbenchService({ root });
  const projectId = service.createProject({ label: "Audio roundtrip" }).projectId;
  const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==";
  const wav = Buffer.alloc(48);
  wav.write("RIFF", 0); wav.writeUInt32LE(40, 4); wav.write("WAVEfmt ", 8); wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28);
  wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write("data", 36); wav.writeUInt32LE(4, 40); wav.writeInt16LE(1000, 44); wav.writeInt16LE(-1000, 46);
  const sheetJson = {
    meta: { origin: { x: 0.25, y: 0.75 } },
    frames: [{ frame: { x: 0, y: 0, w: 1, h: 1 }, duration: 125 }],
    audio: { files: [{ id: "sound", file: "../../audio/beep.wav", name: "beep.wav", type: "audio/wav" }], events: [{ outputFrameIndex: 0, assetId: "sound", file: "../../audio/beep.wav", volume: 0.35 }] },
  };
  const payload = { projectId, profileId: "hero", animationId: "attack", fps: 8, files: [{ name: "spritesheet.png", data: png }], sheetJson };
  const original = fs.readFileSync(service.projectData(projectId).paths.manifest, "utf8");
  assert.throws(() => service.importAnimation(payload), (error) => error.code === "sheet_audio_requires_files");
  assert.equal(fs.readFileSync(service.projectData(projectId).paths.manifest, "utf8"), original);
  const audioFiles = [{ file: "../../audio/beep.wav", name: "beep.wav", type: "audio/wav", data: `data:audio/wav;base64,${wav.toString("base64")}` }];
  assert.throws(() => service.importAnimation({ ...payload, audioFiles, sheetJson: { ...sheetJson, audio: { ...sheetJson.audio, events: [{ outputFrameIndex: 3, assetId: "sound" }] } } }), /invalid frame/);
  assert.equal(fs.readFileSync(service.projectData(projectId).paths.manifest, "utf8"), original);
  const result = service.importAnimation({ ...payload, audioFiles });
  assert.equal(result.audioCount, 1);
  const saved = service.projectData(projectId);
  assert.deepEqual(saved.manifest.profiles[0].animations[0].sourceAnchor, { x: 0.25, y: 0.75 });
  assert.equal(saved.frameAudioBindings[0].volume, 0.35);
  assert.equal(saved.frameAudioBindings[0].animation, "hero/attack");
  assert.equal(saved.frameAudioBindings[0].frame, 0);
  assert.deepEqual(fs.readFileSync(path.join(root, saved.frameAudioBindings[0].path)), wav);
  assert.equal(path.isAbsolute(saved.frameAudioBindings[0].path), false);
  service.importAnimation({ ...payload, audioFiles, replace: true });
  assert.equal(service.projectData(projectId).frameAudioBindings.length, 1, "Explicit reimport does not duplicate SFX");

  const liteStore = createLiteStore(root);
  const legacy = liteStore.ensureProject("legacy");
  const sheetFolder = path.join(root, "sheet", "animations", "hero");
  fs.mkdirSync(sheetFolder, { recursive: true });
  fs.mkdirSync(path.join(root, "sheet", "audio"), { recursive: true });
  fs.writeFileSync(path.join(root, "sheet", "audio", "beep.wav"), wav);
  assert.equal(importSheetAudio({ project: legacy, profileId: "hero", animationId: "attack", animationType: "actor", outputPath: "sheet.png", jsonPath: path.join(sheetFolder, "spritesheet.json"), source: sheetJson, liteStore, root }), 1);
  assert.equal(liteStore.readJson(liteStore.paths(legacy).frameAudio, [])[0].volume, 0.35);
  assert.equal(service.capabilities().features.codexPetsToggle, false);
  let enabled = false;
  const main = createWorkbenchService({ root, codexPetsToggle: true, codexPets: () => enabled });
  assert.equal(main.capabilities().features.codexPetsToggle, true);
  assert.equal(main.capabilities().features.codexPets, false);
  enabled = true;
  assert.equal(main.capabilities().features.codexPets, true);
  console.log("Workbench audio import checks passed: frame bindings, WAV bytes, origin, volume, preflight rejection, replacement and capability flags.");
} finally {
  if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error("Unexpected cleanup path");
  fs.rmSync(root, { recursive: true, force: true });
}
