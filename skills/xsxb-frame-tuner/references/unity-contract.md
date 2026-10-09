# Unity Runtime Contract

This is an optional adapter for an explicitly selected Unity project. A neutral import or portable export does not authorize creating a Unity binding or editing gameplay. Keep existing bindings usable; connect a game scene only when that integration is requested.

## Binding and authority

- Bind Unity projects with `kind: "unity"` and an exact Unity project root containing `Assets/` and `ProjectSettings/ProjectVersion.txt`.
- Keep Godot, Unity, and Lite as explicit project kinds. Never run Godot scanners or sync against a Unity root.
- Continue using `animation_manifest.json`, `animation_tuning.json`, `frame_audio_bindings.json`, `frame_image_attachments.json`, and `attack_trails.json` as the authority. A migration may deliberately point the Godot and Unity bindings at the same Tuner data directory.
- Never make Unity assets reference the Tuner checkout, Downloads, Temp, or a Godot `res://` path.

## Save and sync boundary

Tuner Save must copy data and assets under `Assets/XSXBFrameTuner/`:

- `Frames/<project_id>/`
- `Audio/<project_id>/`
- `Attachments/<project_id>/`
- `AttackTrails/<project_id>/`
- `RuntimeData/<project_id>/`
- `Runtime/`

The derived `xsxb_runtime_data.json` must contain resolved per-frame milliseconds, disabled state, stable Unity asset paths, Character/Group/Frame transforms, facing, boxes, SFX, attachments, scene-scale boundary data, and attack-trail data. Preserve the original authoritative JSON alongside it for migration and debugging.

## Runtime behavior

- Use `XsxbFramePlayer` or an equivalent consumer of the generated runtime database.
- Repeated play calls for the same looping animation must not reset it. One-shot actions must explicitly restart.
- Expose animation duration to gameplay and trigger SFX once per frame entry.
- Sprite, hitbox, hurtbox, collisionbox, and attachments must share the same transform and facing semantics.
- Use `IXsxbAttackTrailConsumer` as the stable data/timing boundary. Do not claim full attack-trail rendering until a Unity mesh/shader consumer is implemented and visually checked.
- Do not depend on Unity MCP or AI packages at runtime.

## Importer and validation

- `XsxbRuntimeImporter` must import copied images as sprites and build `xsxb_runtime_data.asset` automatically after script-domain reload, including when JSON arrived before the importer compiled.
- Run `npm run validate:unity -- --project <id>` for project data. Run `npm run check` and `npm test` when changing the tool code.
- Run `npm run smoke:unity` with the intended Unity editor version. A successful smoke must compile both runtime and editor importer and generate a database asset.
- In the real project, verify the database `.asset` exists and the latest Unity compilation has no XSXB errors. Separate unrelated project compilation errors from XSXB failures.
