# Portable workspace and exports

The neutral workspace is the default for new material. It is independent of a game project and of the Agent client. `node tools/frame_tuner.js --help` is the authority for available command options.

## Commands

```sh
node tools/frame_tuner.js create --name "Hero" --id hero
node tools/frame_tuner.js import --project hero --input "/art/idle" --profile hero --animation idle --fps 12
node tools/frame_tuner.js validate --project hero
node tools/frame_tuner.js export --project hero --format sequence --out "/exports/hero-frames"
node tools/frame_tuner.js export --project hero --format sheet --out "/exports/hero-sheet"
node tools/frame_tuner.js export --project hero --format sheet --out "/exports/hero-sheet.zip" --zip
```

Use explicit output paths. Preserve existing output rather than assuming it can be replaced. When a command fails, inspect its JSON/error and the named project; do not retry destructive imports with `--replace` unless replacement was requested.

Import/validation run with Node. Rendering uses `playwright-core` and a locally installed Chrome, Edge, or Chromium, launched headlessly with an isolated profile. The user does not need to operate a browser or pick a folder. Supply `--browser <executable>` or `FRAME_TUNER_BROWSER` when needed. Do not invoke the Agent's browser automation tools as an installation requirement.

## Export authority

- Export every enabled source frame once, using its effective saved duration. Exclude disabled frames from rendered output and frame events.
- Derive one safe transparent canvas per character from visible transformed frames, attachments, layers, and inserted trail slices. All its animations share the same canvas and origin.
- Bake visual layers/trails into output frames. Do not export an attached layer again as an unrelated primary animation.
- Keep relative file paths and copy referenced audio with frame-event metadata. The sheet metadata owns its frame timing and audio mapping; do not create competing timing sources.
- Preserve box and source-frame metadata where supported; do not turn those metadata into automatic physics or combat behavior.
- An export should survive moving the output directory away from the source workspace.

## Validation

For imported data, run the project validator and compare requested groups/counts with saved groups/counts. For exported data, check images exist, output frames/durations match enabled source frames, paths stay within the package, and referenced audio exists. Inspect a representative composite when visual changes matter. If only data validation ran, say so; do not claim preview, engine playback, or gameplay verification.

Run repository checks for code changes, not for every ordinary asset import. Legacy engine-specific validation gates live with their adapter references.
