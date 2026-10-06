# Import contract

## Project and batch identity

Treat multiple animation folders for one character as one project/profile batch unless the request separates them. Preserve explicit animation IDs and existing tuning keys. Before writing, check source existence, image counts, duplicate IDs, and whether an animation already exists. Use source timing when available; otherwise use the requested FPS, with 12 FPS as a disclosed fallback.

A neutral project needs no game root. Existing Godot and Unity bindings use an exact engine project root; never reuse a binding for a different game. Other projects are schema references, not sources for numeric tuning or gameplay assumptions.

Use `node tools/frame_tuner.js import --project <id> --input <source> --profile <id> --animation <id>` for the common workspace. Add `--json <metadata.json>` for a sheet. Legacy importers are adapter-specific; do not run the Godot importer merely because the input is a PNG folder.

## Sources and replacement

- Copy source assets to stable workspace-owned paths. Preserve original images, dimensions, and authored alpha.
- Adding an animation preserves unrelated animations, audio, attachments, trails, and overrides.
- An existing animation is not permission to replace it. Use `--replace` for explicit replacement intent; report any reset of that animation's tuning.
- Do not copy engine cache files such as Godot `.import` files as authored assets.
- Validate the saved animation count and per-group frame count after the whole batch, including partial failures.

## Anchors, scale, and boxes

Use a consistent character origin across animations. Grounded actors generally use `canvas_bottom_center`; preserve an intentionally authored alternative. Keep Group transforms at identity unless art needs a correction, and put alignment changes in visual transforms rather than box offsets. Only infer a game-relative scale when a game/scene is actually part of the request.

Boxes are optional metadata in neutral projects. When asked to author gameplay boxes, inspect representative poses and materially different attack phases. Body boxes should not encompass weapons, cloth, trails, or faint alpha noise. Keep boxes in source-local coordinates; Character/Group/Frame/facing transformations are applied when rendered or consumed. Do not enable attack hitboxes from filenames alone. Engine-specific collision and active-window behavior belongs to the requested runtime integration.

Report which geometry was inspected. A presence validator cannot establish that hit/hurt boxes are artistically or mechanically correct.
