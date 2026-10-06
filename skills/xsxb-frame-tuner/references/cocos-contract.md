# Cocos Creator 3.8.8 adapter

Use this adapter when a Cocos package or Cocos playback integration is requested. Begin with a validated neutral project and export to a separate destination:

```sh
node tools/frame_tuner.js export --project hero --format cocos --out "/exports/hero-cocos"
```

## Package and playback

The package contains portable baked frames/audio and a `frame-tuner-package-v1` manifest at `assets/resources/frame-tuner/<project-id>/manifest.json`, plus `FrameTunerPlayer.ts`, `FrameTunerData.ts`, and `FrameTunerClock.ts` in `assets/scripts/frame-tuner/`.

Merge the generated `assets` only into an explicitly selected game project. Place `FrameTunerPlayer` on a node under a Canvas. Load `frame-tuner/<project-id>/manifest`, then call `play(animationId, loop?)`. Use `pause()`, `resume()`, `stop()`, and `setFacingLeft(boolean)` for playback. Preserve nonuniform per-frame durations and skip disabled frames. One-shot playback holds its last frame and emits completion once.

Visuals are already baked (`bakedVisual: true`): do not apply source transform/crop/attachments/trails again. The player exposes frame, loop, finished, audio, ready, and error events, and `queryBoxes(kind?, world=false)` returns rotated corners. Boxes are query data; the adapter does not create collision components or decide combat rules. Browser audio may require a user gesture.

No automatic gameplay wiring or reverse synchronization is implied by export. A game integration request should name the target scene/actor and preserve its existing logic. The default UI scale is one pixel per unit for a Canvas workflow; deliberate game scaling belongs on the consuming node/component.

## Verification

Run project validation and inspect the exported relative asset paths and manifest. For code changes, use `node tools/cocos/self_test.js` and `node tools/cocos/typecheck.js` as available. A standalone sample can be generated with `node tools/cocos_export.js --sample --demo --out <empty-directory>`.

Actual Creator acceptance means importing into 3.8.8, opening `assets/frame-tuner-demo/FrameTunerDemo.scene` for the sample, confirming scripts compile, and checking looping/one-shot playback, unequal durations, disabled frames, facing, box queries, and available SFX. If Creator was not run, label the result as package/static validation only. Runtime details are maintained in the tool repository's `docs/cocos-3.8.8.md`.
