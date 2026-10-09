---
name: xsxb-frame-tuner
description: Import, tune, validate, and export frame animations with Frame Tuner. Use for PNG sequences, sprite sheets, frame timing, layers, boxes, SFX, attack trails, or Cocos Creator 3.8.8 animation packages; use the optional Godot and Unity adapters only for those targets.
---

# Frame Tuner

Use the engine-neutral workspace for animation editing and portable exports. The tool runs locally; it does not call a model API or require Codex. Any Agent that can read files and run Node commands can use this workflow.

## Locate and choose the deliverable

Resolve the tool root from the current workspace (`tools/frame_tuner.js`), a user-supplied path, or an existing clone of `https://github.com/JinBorn/Frame-Tuner`. Run commands there. `FRAME_TUNER_ROOT` selects a separate data workspace when needed; it is not the location of the tool executable.

An animation import means importing and validating the requested material. A portable export means a PNG sequence or sheet plus metadata. Neither implies modifying a game project or installing this skill into another Agent. A Cocos package supplies assets and a playback component; wiring an existing gameplay scene is a separate task when requested.

Read only the references relevant to the task:

- [import-contract.md](references/import-contract.md): grouping, source assets, replacement, anchors, and boxes for imports.
- [portable-contract.md](references/portable-contract.md): the common CLI, transparent exports, and validation.
- [cocos-contract.md](references/cocos-contract.md): Cocos Creator 3.8.8 packages and playback.
- [godot-contract.md](references/godot-contract.md): existing Godot bindings, SpriteFrames, runtime sync, and requested gameplay integration.
- [unity-contract.md](references/unity-contract.md): existing Unity bindings and runtime sync.
- [lite-contract.md](references/lite-contract.md): the isolated legacy Lite workspace.
- [ui-contract.md](references/ui-contract.md): editing the workbench itself or changing its save format.

## Common workflow

1. Identify the intended project, character/profile, all source groups, timing, and requested output. Keep one profile for one character across a batch.
2. Preserve source images and existing tuned animations. Use `--replace` only for a requested replacement.
3. Run the import and project validation commands. Check the resulting project/profile IDs and frame counts against the sources.
4. When an export is requested, pass an explicit output path and inspect the generated metadata and a representative image. Report missing assets or failed validation before calling the deliverable complete.
5. Open the workbench when requested or useful for artistic adjustments. The Agent workflow does not require clicking browser controls or a system directory picker.

Examples (replace sample paths and IDs with actual values):

```sh
node tools/frame_tuner.js list
node tools/frame_tuner.js create --name "Hero" --id hero
node tools/frame_tuner.js import --project hero --input "/art/idle" --profile hero --animation idle --fps 12
node tools/frame_tuner.js import --project hero --input "/art/run.png" --json "/art/run.json" --profile hero --animation run
node tools/frame_tuner.js validate --project hero
node tools/frame_tuner.js export --project hero --format sheet --out "/exports/hero"
node tools/frame_tuner.js export --project hero --format cocos --out "/exports/hero-cocos"
```

Commands return JSON on stdout and a nonzero exit code on failure. Import and validation need no browser. Export uses `playwright-core` with an installed Chrome, Edge, or Chromium in headless mode to reuse the editor renderer. Use `--browser <executable>` or `FRAME_TUNER_BROWSER` if automatic discovery fails. Do not silently replace a failed visual export with metadata-only output.

## Data and scope

- Keep original frame dimensions during import; derive a shared transparent canvas at export after transforms and visible layers are known.
- Character, Group, and Frame transforms, timing, enabled frames, attachments, SFX, and trails share the same saved authority in preview and export.
- Boxes remain source-local metadata. Do not enable game hit detection, invent active attack frames, or wire gameplay merely because boxes can be edited.
- Engine targets receive portable relative assets. Do not leave deliverables referencing the Tuner checkout, Downloads, temporary files, or another engine's resource scheme.
- Adapter code generation is not proof of execution in an engine. Distinguish artifact validation, editor compilation, actual playback, and any requested gameplay integration in the result.

Report the imported groups/counts, saved project ID, output location, validation performed, and any concrete unverified behavior. Client installation and invocation instructions live in the repository's `docs/agents.md`; `agents/openai.yaml` is optional Codex UI metadata.
