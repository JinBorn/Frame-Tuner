# Frame Tuner Lite Contract

Frame Tuner Lite is the isolated legacy workspace. Use it for existing Lite projects or an explicitly requested Lite workflow. New neutral projects use the common workspace and [portable-contract.md](portable-contract.md).

## Isolation

- Start Lite with `npm run start:lite`; its default address is `http://127.0.0.1:5180`. Use `LITE_PORT` only when a different Lite port is required; the Full Tuner `PORT` variable does not redirect Lite.
- Keep Full Tuner on port `5179`. Do not reuse its project registry or project data.
- Lite registry and edits live under `data/lite/`; stable imported assets live under `workspace/lite/`. User exports never use a fixed internal workspace path.
- Lite projects have `kind: frame_lite`, an empty Godot root, no runtime sync, and no gameplay wiring. Frame-bound SFX is saved inside the isolated Lite workspace and exported as portable audio files plus JSON events; it is never synced to Godot. Other editor data, including collision-box metadata, remains editable and saveable.
- Never add Lite project records to `data/projects.json` or copy Lite data to a Godot project.

## Agent Import

For a PNG folder:

```powershell
node tools/frame_tuner_lite/import_frames.js --project <project_id> --profile <material_set> --animation <sequence_id> --source "<png_folder>" --fps <fps>
```

For a TexturePacker/Aseprite-style PNG plus JSON sheet:

```powershell
node tools/frame_tuner_lite/import_sheet.js --project <project_id> --profile <material_set> --animation <sequence_id> --sheet "<sheet.png>" --json "<sheet.json>" --fps <fallback_fps>
```

The JSON `frames` value may be an array or an object. Each entry must provide a `frame`, `crop`, or direct rectangle using `x/y/w/h` or `x/y/width/height`. Per-frame `duration` or `durationMs` values are preserved relative to the fallback FPS.

To attach another imported sequence as a visual layer:

```powershell
node tools/frame_tuner_lite/import_frames.js --project <project_id> --profile <material_set> --animation <layer_id> --source "<png_folder>" --fps <fps> --attach-to <owner_sequence_id> --layer behind
```

Use `--layer front` for an upper layer. Add `--independent` only when the layer should advance on its own timeline; otherwise it follows the owner frame index. Every imported source is copied to a stable Lite workspace path. Never leave manifests pointing to Downloads or Temp.

## Calibrate First, Then Derive the Canvas

- Do not choose, normalize, or calculate a canvas during import. Preserve each frame's original dimensions only so the editor can draw the raw material.
- First let the user calibrate the sequence transforms, layers, frame timing, frame SFX, and attack trails.
- At export time, scan the actual visible alpha bounds of every sampled frame across every primary animation in the current profile, including attached layers and attack trails. Add the chosen transparent padding and derive the smallest safe character-wide canvas.
- Every animation of that character must use the same width, height, and stable character origin. The background is always transparent, so switching animation groups does not jump or resize the canvas.
- Frame transforms, durations, disabled frames, image attachments, layers, frame SFX, and editable attack trails use the same data as the preview.
- Lite attack-trail sticks are trajectory geometry only. They never create output frames or visible trail poses by themselves. A trail appears in preview and export only after the user explicitly adds a `frameSlices` entry to that owner frame in `拖尾插入` mode.
- There is no separate export FPS or trail phase sampling. Authored group/per-frame durations remain metadata, and every playable source frame produces exactly one baked output frame. That PNG composites the transformed owner frame, its image attachments, and only the trail slices explicitly attached to that same frame.
- Legacy Lite segments without `frameSlices` remain editable as paths but render and export no trail until frames are explicitly inserted. Do not infer or migrate visible frames from stick positions.
- The UI exposes two independent character-wide batch outputs. `导出 PNG 序列` writes a transparent frame sequence plus its sole `export.json` descriptor for every primary animation in the current profile. `导出 Sheet + JSON` writes only one `spritesheet.png` plus re-importable `spritesheet.json` pair per primary animation; it must not create a duplicate `export.json`. Attached visual layers are composited into their owner and are not exported again as standalone groups.
- Both export modes copy every referenced SFX into the batch-level `audio/` folder. Sequence mode writes `audio.files` and `audio.events` to `export.json`; Sheet mode writes them only to `spritesheet.json`. An event records its zero- and one-based output frame, millisecond time, source/display frame, asset id, and relative audio path. Bindings on disabled frames do not export. Map each event to the first duration-derived output sample at or after the authoritative source-frame arrival time instead of dropping or repeating it.
- `spritesheet.json` is the only timing authority for Sheet output. Because common sheet consumers expect integer milliseconds, distribute rounding over the ordered samples using cumulative elapsed time so the integers preserve the rounded animation total (for example, six 22.5 ms samples become `23,22,23,22,23,22`, totaling 135 ms).
- When the Agent imports a Lite-exported `spritesheet.json`, copy its referenced audio files into the target Lite project's stable `workspace/lite/.../audio/` directory and recreate the bindings on `outputFrameIndex`. Preserve unrelated animations' existing SFX.
- Legacy Lite export buttons use the browser's writable-directory picker. This is a human UI path, not a required Agent capability. Use the common CLI for new headless export workflows; do not silently move an existing Lite project into the common registry.
- Keep sprite sheets within browser canvas limits. Reduce columns or transparent padding if the UI reports an oversized sheet.

## Validation

For existing Lite project data, run:

```powershell
npm run validate:lite -- --project <project_id>
```

For requested UI/export verification, inspect a representative output image, timing metadata, and referenced audio/events. Do not create sample audio bindings in the user's data merely to satisfy a test. Run repository checks when changing code. Report whether preview or export was actually exercised, and preserve the common workbench's project selection.
