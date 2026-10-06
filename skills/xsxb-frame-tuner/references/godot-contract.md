# Optional Godot adapter

Use this adapter for an explicitly selected Godot project or Godot SpriteFrames import. Ordinary neutral import/export does not invoke it.

Existing bindings retain their exact `project.godot` root and stable `res://xsxb_frame_tuner/` assets. Before changing a bound project, read [runtime-contract.md](runtime-contract.md). That document describes runtime data semantics, not authorization to change gameplay.

```sh
node tools/import_frames.js --project <id> --project-root <godot-root> --profile <id> --animation <id> --source <png-folder> --fps 12
node tools/import_spriteframes.js --project-root <godot-root> --project <id> --all
node tools/validate_import.js --project <id> --project-root <godot-root>
```

For several folders use `tools/import_batch.js` with global options followed by repeated `--animation <id> --source <folder> --fps <fps>` blocks. `--replace` is only for requested replacement.

Keep saved authority, copied assets, SFX, attachments, and transforms consistent with the existing runtime. Do not change arbitrary game scenes or combat code to satisfy a default importer contract. When full gameplay integration is specifically requested, read [validation.md](validation.md), connect the intended actor, and run `validate_import.js --require-gameplay --strict` plus available Godot compilation/playback checks. Report unavailable engine execution separately from static validation.
