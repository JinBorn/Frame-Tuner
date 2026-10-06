"use strict";

const { EMPTY_MANIFEST, EMPTY_TUNING } = require("./project_store");

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function number(value, fallback = 0) {
  const result = Number(value);
  return Number.isFinite(result) ? result : fallback;
}

function vector(value, fallbackX = 0, fallbackY = fallbackX) {
  return {
    x: number(value?.x, fallbackX),
    y: number(value?.y, fallbackY),
  };
}

function scale(value, scalar = 1) {
  if (value !== null && value !== undefined) {
    const uniform = Number(value);
    if (Number.isFinite(uniform)) {
      return { x: uniform, y: uniform };
    }
  }
  return vector(value, scalar, scalar);
}

function bindingKey(profileId, animationId, frameIndex) {
  return `${profileId}/${animationId}:${frameIndex}`;
}

function stableBindingKey(entry, fallbackIndex = 0) {
  const metadata = entry?.metadata || {};
  const profileId = String(metadata.profileId || entry?.profileId || "");
  const animationId = String(metadata.animation || entry?.animation || entry?.animationId || "").replace(`${profileId}/`, "");
  const frameIndex = number(metadata.frame ?? entry?.frame ?? entry?.frameIndex, fallbackIndex);
  if (profileId && animationId) return bindingKey(profileId, animationId, frameIndex);
  const key = String(entry?.frameKey || entry?.key || "");
  const match = key.match(/([^/:]+)\/([^/:]+):(\d+)$/);
  return match ? `${match[1]}/${match[2]}:${match[3]}` : key;
}

function groupTransform(values, profile, animation) {
  const base = `profiles.${profile.id}.groups.${animation.id}`;
  const scalar = number(values[`${base}.visual_size`], number(animation.defaultScale, 1));
  return {
    position: vector(values[`${base}.offset`] ?? animation.defaultOffset),
    scale: scale(values[`${base}.visual_scale`] ?? animation.defaultScaleVector, scalar),
    uniformScale: scalar,
    rotation: number(values[`${base}.rotation`], number(animation.defaultRotation, 0)),
  };
}

function characterTransform(values, profile) {
  const base = `profiles.${profile.id}.character`;
  const scalar = number(values[`${base}.visual_size`], number(profile.bodyScale, 1) * number(profile.runtimeScale, 1));
  return {
    position: vector(values[`${base}.offset`] ?? profile.defaultOffset),
    scale: scale(values[`${base}.visual_scale`] ?? profile.defaultScaleVector, scalar),
    uniformScale: scalar,
    rotation: number(values[`${base}.rotation`], number(profile.defaultRotation, 0)),
  };
}

function effectiveFrameTransform(base, override) {
  if (!override || typeof override !== "object") return clone(base);
  const scalar = number(override.visual_size, base.scale.x);
  return {
    position: vector(override.offset, base.position.x, base.position.y),
    scale: scale(override.visual_scale, scalar),
    uniformScale: scalar,
    rotation: number(override.rotation, base.rotation),
  };
}

function runtimeAttachment(entry) {
  const result = clone(entry || {});
  const authored = entry?.transform && typeof entry.transform === "object" ? entry.transform : entry || {};
  result.offset = vector(authored.offset);
  const scalar = number(authored.scale, 1);
  result.scale = scale(
    authored.visual_scale ??
      (authored.scaleX !== undefined || authored.scaleY !== undefined
        ? {
            x: number(authored.scaleX, scalar),
            y: number(authored.scaleY, scalar),
          }
        : authored.scale),
    scalar
  );
  result.rotation = number(authored.rotation);
  result.layerOrder = number(entry?.layerOrder, String(entry?.layer || "above") === "below" ? -1 : 1);
  delete result.transform;
  return result;
}

function runtimeAttackTrail(entry) {
  const result = clone(entry || {});
  const sourceSlices = entry?.frameSlices ?? entry?.frame_slices;
  if (sourceSlices && typeof sourceSlices === "object" && !Array.isArray(sourceSlices)) {
    result.frameSlices = Object.entries(sourceSlices)
      .map(([frame, slice]) => ({
        frame: Math.max(0, Math.round(number(frame))),
        enabled: slice?.enabled !== false,
        tailProgress: Math.min(1, Math.max(0, number(slice?.tailProgress ?? slice?.tail_progress))),
        headProgress: Math.min(1, Math.max(0, number(slice?.headProgress ?? slice?.head_progress, 1))),
      }))
      .sort((left, right) => left.frame - right.frame);
  }
  delete result.frame_slices;
  return result;
}

function boxArray(boxes) {
  return ["hurtbox", "hitbox", "collisionbox"].map((kind) => {
    const value = boxes?.[kind] || {};
    return {
      kind,
      enabled: value.enabled === true,
      position: vector(value.offset),
      size: vector(value.size),
      rotation: number(value.rotation),
    };
  });
}

function entriesByKey(entries) {
  const result = new Map();
  (Array.isArray(entries) ? entries : []).forEach((entry, index) => {
    const key = stableBindingKey(entry, index);
    if (!key) return;
    if (!result.has(key)) result.set(key, []);
    result.get(key).push(clone(entry));
  });
  return result;
}

function buildRuntimeData(options = {}) {
  const manifest = options.manifest || EMPTY_MANIFEST;
  const tuning = options.tuning || EMPTY_TUNING;
  const values = tuning.values || {};
  const playback = tuning.frame_playback_overrides || {};
  const visual = tuning.frame_visual_overrides || {};
  const boxes = tuning.frame_box_overrides || {};
  const audio = entriesByKey(options.frameAudioBindings);
  const attachments = entriesByKey(options.frameImageAttachments);
  const attackBindings = options.attackTrails?.bindings || {};
  const bakedFrames = new Map((Array.isArray(options.bakedFrames) ? options.bakedFrames : [])
    .map((entry) => [String(entry?.key || bindingKey(entry?.profileId, entry?.animationId, entry?.frameIndex)), entry]));

  const profiles = (Array.isArray(manifest.profiles) ? manifest.profiles : []).map((profile) => {
    const character = characterTransform(values, profile);
    const animations = (Array.isArray(profile.animations) ? profile.animations : []).map((animationSource) => {
      const animation = { ...animationSource, id: String(animationSource.id || animationSource.name || "animation") };
      const groupKey = `${profile.id}/${animation.id}:__group`;
      const fps = Math.max(0.001, number(playback[groupKey]?.fps, number(animation.fps ?? animation.defaultFps, 12)));
      const baseTransform = groupTransform(values, profile, animation);
      let durationMs = 0;
      const frames = (Array.isArray(animation.frames) ? animation.frames : []).map((frame, frameIndex) => {
        const key = bindingKey(profile.id, animation.id, frameIndex);
        const bakedFrame = bakedFrames.get(key);
        const framePlayback = playback[key] || {};
        const disabled = framePlayback.disabled === true;
        const frameDurationMs = disabled ? 0 : Math.max(0.001, number(framePlayback.duration, number(frame.duration, 1))) * 1000 / fps;
        durationMs += frameDurationMs;
        return {
          index: frameIndex,
          id: String(frame.id || `frame_${String(frameIndex + 1).padStart(4, "0")}`),
          name: String(frame.name || ""),
          assetPath: String(bakedFrame?.assetPath || frame.path || ""),
          sourceAssetPath: String(frame.path || ""),
          // A baked image already contains the crop; retain its source rectangle
          // for provenance without asking runtime consumers to crop it twice.
          crop: !bakedFrame && frame.crop ? clone(frame.crop) : null,
          sourceCrop: frame.crop ? clone(frame.crop) : null,
          bakedComposite: Boolean(bakedFrame),
          bakedOffset: bakedFrame ? vector(bakedFrame.offset) : null,
          bakedMainAnchor: bakedFrame ? vector(bakedFrame.mainAnchor) : null,
          bakedPixelScale: bakedFrame ? Math.max(1, number(bakedFrame.bakedPixelScale, 1)) : 1,
          width: number(bakedFrame?.width, number(frame.width)),
          height: number(bakedFrame?.height, number(frame.height)),
          durationMs: frameDurationMs,
          disabled,
          transform: effectiveFrameTransform(baseTransform, visual[key]),
          boxes: boxArray(boxes[key]),
          audio: audio.get(key) || [],
          attachments: (attachments.get(key) || []).map(runtimeAttachment),
        };
      });
      return {
        id: animation.id,
        name: String(animation.name || animation.id),
        type: String(animation.type || profile.kind || "actor"),
        anchorMode: String(animation.anchorMode || "canvas_bottom_center"),
        sourceAnchor: animation.sourceAnchor ? vector(animation.sourceAnchor) : null,
        fps,
        durationMs,
        frames,
        attackTrails: (Array.isArray(attackBindings[`${profile.id}/${animation.id}`])
          ? attackBindings[`${profile.id}/${animation.id}`]
          : []).map(runtimeAttackTrail),
      };
    });
    return {
      id: String(profile.id || "profile"),
      label: String(profile.label || profile.id || "profile"),
      kind: String(profile.kind || "actor"),
      sourceFacesLeft: profile.source_faces_left === true || profile.sourceFacesLeft === true,
      characterTransform: character,
      animations,
    };
  });

  return {
    schemaVersion: 1,
    authoritySchema: "xsxb-frame-tuner-v1",
    projectId: String(options.projectId || ""),
    profiles,
    sceneSettings: Object.entries(tuning.scene_settings || {}).map(([scene, value]) => ({
      scene,
      scale: number(value?.scale, 1),
    })),
  };
}

module.exports = {
  bindingKey,
  buildRuntimeData,
  stableBindingKey,
};
