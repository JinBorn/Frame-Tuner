(function attackTrailModule() {
  const SPEED_PROFILE = [0.94, 1.015, 0.985, 1.025, 1.035, 1.02, 0.97, 1.04];
  const TAIL_WIDTH_SPEED_INFLUENCE = 0.18;
  const HANDLE_RADIUS = 9;
  const CENTER_HANDLE_RADIUS = 8;
  const DIRECTION_HANDLE_UNIT_PX = 57.5;
  const DIRECTION_HANDLE_MIN_STRENGTH = 0.1;
  const DIRECTION_HANDLE_MAX_STRENGTH = 4;
  const DEFAULT_TAIL_HEAD_SPEED_RATIO = 0.7;
  const DRAW_PREVIEW_DURATION_MS = 1000;
  const DRAW_PREVIEW_TAIL_HEAD_SPEED_RATIO = 0.5;
  const DEFAULT_PATH_COLUMNS = 20;
  const DEFAULT_BEFORE_CHASE_MULTIPLIER = 0.5;
  const DEFAULT_AFTER_CHASE_MULTIPLIER = 2;
  const LEGACY_BEFORE_CHASE_SPEED = 110;
  const LEGACY_AFTER_CHASE_SPEED = 680;
  const TRAIL_MESH_WIDTH_ROWS = 17;
  const PREVIEW_TEXTURE_MAX_SIZE = 256;
  const FINAL_HEAD_CAP_MARGIN_RATIO = 0.25;
  const TAIL_ALPHA_EXPONENT = 2.2;
  const ATTACK_TRAIL_SCHEMA_VERSION = 21;
  const DEFAULT_GLOW_STRENGTH = 0.28;
  const DEFAULT_GLOW_RADIUS = 16;
  const DEFAULT_HEAD_LIGHT_BOOST = 0.55;
  const PRESET_SEGMENT_ID = "__xsxb_default_attack_trail_preset__";
  const DEFAULT_PRESET_TEXTURE = {
    path: "tools/animation_tuner/public/presets/attack_trails/coherent_trail_body_luma.png",
    assetHash: "af5fffcb5009c5eb78bc595d85f72f0bd68e310d5f7926e54512d4f39efb1878",
    name: "coherent_trail_body_luma.png",
    type: "image/png",
    width: 256,
    height: 256,
    hasEffectiveAlpha: false,
  };
  const LEGACY_PRESET_TEXTURE_PATH = "tools/animation_tuner/public/presets/attack_trails/dynamic_trail_luma.png";
  const LEGACY_PRESET_TEXTURE_HASH = "e2b855cdb3c59db8b4ed33f400b03bafd4af7df2636f3fd4d3eb68603763da90";
  const DEFAULT_MATERIAL_LAYERS = {
    streaks: {
      enabled: true,
      texture: {
        path: "tools/animation_tuner/public/presets/attack_trails/coherent_breakup_luma.png",
        assetHash: "1702655ad189266dd598355cfc47afbf42bba34c064e423200b5daa6ae13c760",
        name: "coherent_breakup_luma.png",
        type: "image/png",
        width: 256,
        height: 256,
        hasEffectiveAlpha: false,
      },
      color: "#e93f73",
      strength: 0.46,
      blendMode: "screen",
      invert: false,
      threshold: 0,
      softness: 0,
      expansion: 0,
    },
    breakup: {
      enabled: true,
      texture: {
        path: "tools/animation_tuner/public/presets/attack_trails/coherent_breakup_luma.png",
        assetHash: "1702655ad189266dd598355cfc47afbf42bba34c064e423200b5daa6ae13c760",
        name: "coherent_breakup_luma.png",
        type: "image/png",
        width: 256,
        height: 256,
        hasEffectiveAlpha: false,
      },
      color: "#ffffff",
      strength: 0.72,
      blendMode: "normal",
      invert: false,
      threshold: 0,
      softness: 0,
      expansion: 0,
    },
    core: {
      enabled: true,
      texture: {
        path: "tools/animation_tuner/public/presets/attack_trails/coherent_outer_glow_luma.png",
        assetHash: "fc6b0c707f9cbf57aee0efdc7cb985ae2b8191e65e55dcc4644ecbb37972fd33",
        name: "coherent_outer_glow_luma.png",
        type: "image/png",
        width: 256,
        height: 256,
        hasEffectiveAlpha: false,
      },
      color: "#ffe7ee",
      strength: 1.05,
      blendMode: "add",
      invert: false,
      threshold: 0,
      softness: 0,
      expansion: 0,
    },
  };

  const clone = (value) => JSON.parse(JSON.stringify(value));
  const PRESET_STYLE_KEYS = [
    "texture", "invertTexture", "colorMode", "color", "gradientStops", "materialLayers",
    "bodyOpacityFloor", "bodyDetailStrength", "bodyWhiteThreshold",
    "coreEdge", "glowColor", "glowStrength", "glowRadius", "headLightBoost", "headWhitePreserve", "headWhiteLength",
    "widthMode", "fixedWidth", "widthScale", "widthOffset", "widthChaseStrength", "pathScaleX", "pathScaleY",
    "tailSamples", "pathColumns", "tailFadeStart", "headCurvature",
  ];
  const applyAttackTrailPresetStyle = (target, preset) => {
    if (!target || !preset) return target;
    for (const key of PRESET_STYLE_KEYS) {
      if (Object.prototype.hasOwnProperty.call(preset, key)) target[key] = clone(preset[key]);
    }
    return target;
  };
  const upsertAttackTrailPresetByName = (presets, preset) => {
    const list = Array.isArray(presets) ? presets : [];
    const nameKey = String(preset?.name || "").trim().toLocaleLowerCase();
    const existingIndex = list.findIndex((entry) => (
      String(entry?.name || "").trim().toLocaleLowerCase() === nameKey
    ));
    const next = clone(preset);
    if (existingIndex >= 0) {
      next.id = list[existingIndex].id;
      list[existingIndex] = next;
      return { preset: next, overwritten: true };
    }
    list.push(next);
    return { preset: next, overwritten: false };
  };
  const preferredAttackTrailSegment = (segments = []) => (
    segments.find((segment) => segment.presetOnly !== true && segment.generated !== false && segment.sticks?.length >= 2)
    || segments.find((segment) => segment.presetOnly !== true)
    || segments[0]
    || null
  );
  const resolveAttackTrailContextSegmentId = (currentId, localSegments = [], displayedSegments = []) => {
    const currentLocal = localSegments.find((segment) => segment.id === currentId);
    if (currentLocal) return currentLocal.id;
    const preferredLocal = preferredAttackTrailSegment(localSegments);
    if (preferredLocal) return preferredLocal.id;
    const currentDisplayed = displayedSegments.find((segment) => segment.id === currentId);
    if (currentDisplayed) return currentDisplayed.id;
    return preferredAttackTrailSegment(displayedSegments)?.id || "";
  };
  const normalizeBodyTexture = (value) => {
    const texture = value && typeof value === "object" ? value : {};
    const legacyDefault = texture.path === LEGACY_PRESET_TEXTURE_PATH || texture.assetHash === LEGACY_PRESET_TEXTURE_HASH;
    const canonicalDefault = texture.path === DEFAULT_PRESET_TEXTURE.path;
    if (!texture.path || legacyDefault || canonicalDefault) return clone(DEFAULT_PRESET_TEXTURE);
    return {
      path: String(texture.path || ""),
      assetHash: String(texture.assetHash || ""),
      name: String(texture.name || ""),
      type: String(texture.type || "image/png"),
      width: Number(texture.width || 0),
      height: Number(texture.height || 0),
      hasEffectiveAlpha: texture.hasEffectiveAlpha === true,
    };
  };
  const clamp = (value, min, max, fallback = min) => {
    const number = Number(value);
    return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
  };
  const smoothstep = (edge0, edge1, value) => {
    const phase = clamp((value - edge0) / Math.max(0.000001, edge1 - edge0), 0, 1, 0);
    return phase * phase * (3 - 2 * phase);
  };
  const maskResponse = (value, threshold = 0, softness = 0) => {
    if (softness <= 0.0001) return threshold <= 0.0001 ? value : (value >= threshold ? 1 : 0);
    return smoothstep(threshold, Math.min(1, threshold + softness), value);
  };
  const point = (value, fallback = { x: 0, y: 0 }) => ({
    x: clamp(value?.x, -100000, 100000, fallback.x),
    y: clamp(value?.y, -100000, 100000, fallback.y),
  });
  const randomId = (prefix) => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  const normalizeColor = (value, fallback = "#d9364a") => (/^#[0-9a-f]{6}$/i.test(String(value || "")) ? String(value).toLowerCase() : fallback);
  const normalizeTrailName = (value, index = 0) => {
    const name = String(value || "").trim();
    if (!name) return `Trail ${index + 1}`;
    if (/^\?+$/.test(name) || /[\uE000-\uF8FF\uFFFD]/u.test(name)) return "默认拖尾";
    return name;
  };
  const normalizeColorMode = (value) => {
    const mode = String(value || "").toLowerCase();
    if (mode === "original" || mode === "gradient") return mode;
    return "solid";
  };
  const normalizeCoreEdge = (value) => {
    const edge = String(value || "").toLowerCase();
    return edge === "bottom" || edge === "both" ? edge : "top";
  };
  const normalizeBlendMode = (value, fallback = "add") => {
    const mode = String(value || "").toLowerCase();
    return ["add", "screen", "normal", "multiply"].includes(mode) ? mode : fallback;
  };
  const normalizeMaterialLayers = (value = {}, legacy = {}) => {
    const source = value && typeof value === "object" ? value : {};
    const legacyEnabled = legacy.layeredMaterial !== false && legacy.layered_material !== false;
    const result = {};
    for (const layerId of ["streaks", "breakup", "core"]) {
      const defaults = DEFAULT_MATERIAL_LAYERS[layerId];
      const material = source[layerId] && typeof source[layerId] === "object" ? source[layerId] : {};
      const canonicalDefault = material.texture?.path === defaults.texture.path;
      const texture = material.texture?.path && !canonicalDefault
        ? { ...clone(defaults.texture), ...clone(material.texture) }
        : clone(defaults.texture);
      result[layerId] = {
        enabled: legacyEnabled && material.enabled !== false,
        texture,
        color: normalizeColor(
          material.color ?? (layerId === "core" ? legacy.coreColor ?? legacy.core_color : undefined),
          defaults.color,
        ),
        strength: clamp(
          material.strength ?? (layerId === "core" ? legacy.coreStrength ?? legacy.core_strength : undefined),
          0,
          2,
          defaults.strength,
        ),
        blendMode: normalizeBlendMode(material.blendMode ?? material.blend_mode, defaults.blendMode),
        invert: material.invert === undefined ? defaults.invert : material.invert === true,
        threshold: clamp(material.threshold, 0, 1, defaults.threshold),
        softness: clamp(material.softness, 0, 1, defaults.softness),
        expansion: clamp(material.expansion, 0, 0.12, defaults.expansion),
      };
    }
    return result;
  };
  const normalizeGradientStops = (value, fallbackColor = "#d9364a") => {
    const stops = (Array.isArray(value) ? value : []).slice(0, 16).map((stop, index) => ({
      id: String(stop?.id || `gradient_stop_${index + 1}`),
      position: clamp(stop?.position ?? stop?.offset, 0, 1, index ? 1 : 0),
      color: normalizeColor(stop?.color, fallbackColor),
    })).sort((a, b) => a.position - b.position);
    if (stops.length >= 2) return stops;
    return [
      { id: "gradient_stop_bottom", position: 0, color: fallbackColor },
      { id: "gradient_stop_top", position: 1, color: fallbackColor },
    ];
  };
  const colorChannels = (value) => [1, 3, 5].map((offset) => parseInt(normalizeColor(value).slice(offset, offset + 2), 16));
  const channelsToColor = (channels) => `#${channels.map((channel) => Math.round(clamp(channel, 0, 255, 0)).toString(16).padStart(2, "0")).join("")}`;
  const fluorescentHaloColor = (value) => {
    const channels = colorChannels(value);
    const minimum = Math.min(...channels);
    const maximum = Math.max(...channels);
    const range = maximum - minimum;
    if (range < 3) return normalizeColor(value);
    return channelsToColor(channels.map((channel) => 45 + (channel - minimum) / range * 210));
  };
  const trailPose = (stick) => {
    const top = stick.reverseDirection ? stick.bottom : stick.top;
    const bottom = stick.reverseDirection ? stick.top : stick.bottom;
    return { top, bottom, center: { x: (top.x + bottom.x) / 2, y: (top.y + bottom.y) / 2 } };
  };
  const trailFractions = (points) => {
    const distances = [0];
    for (let index = 1; index < points.length; index += 1) {
      distances.push(distances.at(-1) + Math.hypot(points[index].x - points[index - 1].x, points[index].y - points[index - 1].y));
    }
    const total = distances.at(-1) || 0;
    return total > 0.0001
      ? distances.map((distance) => distance / total)
      : points.map((_, index) => index / Math.max(1, points.length - 1));
  };
  const trailChaikin = (points, iterations = 3) => {
    let curve = points.map((entry) => ({ ...entry }));
    for (let pass = 0; pass < iterations && curve.length >= 3; pass += 1) {
      const next = [{ ...curve[0] }];
      for (let index = 0; index < curve.length - 1; index += 1) {
        const a = curve[index], b = curve[index + 1];
        next.push({ x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25 });
        next.push({ x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75 });
      }
      next.push({ ...curve.at(-1) });
      curve = next;
    }
    return curve;
  };
  const trailSamplePolyline = (points, fraction) => {
    if (!points.length) return { x: 0, y: 0 };
    if (points.length === 1 || fraction <= 0) return { ...points[0] };
    if (fraction >= 1) return { ...points.at(-1) };
    const fractions = trailFractions(points);
    let index = 0;
    while (index + 1 < fractions.length && fractions[index + 1] < fraction) index += 1;
    const span = Math.max(0.000001, fractions[index + 1] - fractions[index]);
    const phase = clamp((fraction - fractions[index]) / span, 0, 1, 0);
    return {
      x: points[index].x + (points[index + 1].x - points[index].x) * phase,
      y: points[index].y + (points[index + 1].y - points[index].y) * phase,
    };
  };
  const trailSampleByX = (points, x) => {
    if (!points.length) return 0;
    if (points.length === 1 || x <= points[0].x) return points[0].y;
    if (x >= points.at(-1).x) return points.at(-1).y;
    let index = 0;
    while (index + 1 < points.length && points[index + 1].x < x) index += 1;
    const span = Math.max(0.000001, points[index + 1].x - points[index].x);
    const phase = clamp((x - points[index].x) / span, 0, 1, 0);
    return points[index].y + (points[index + 1].y - points[index].y) * phase;
  };
  const normalizeTrailVector = (value, fallback = { x: 1, y: 0 }) => {
    const length = Math.hypot(value.x, value.y);
    return length > 0.0001 ? { x: value.x / length, y: value.y / length } : { ...fallback };
  };
  const signedTrailAngle = (from, to) => {
    const radians = Math.atan2(from.x * to.y - from.y * to.x, from.x * to.x + from.y * to.y);
    return Math.round(radians * 1800 / Math.PI) / 10;
  };
  const attackTrailLifecycleOrigin = (sticks, frameArrival) => {
    if (!Array.isArray(sticks) || !sticks.length || typeof frameArrival !== "function") return 0;
    return Number(frameArrival(sticks[0].frame, 0)) || 0;
  };
  const normalizeFrameSlices = (value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const result = {};
    for (const [rawFrame, rawSlice] of Object.entries(value)) {
      if (!rawSlice || typeof rawSlice !== "object") continue;
      const frame = Math.max(0, Math.round(clamp(rawFrame, 0, 100000, 0)));
      const tail = clamp(rawSlice.tailProgress ?? rawSlice.tail ?? rawSlice.start, 0, 1, 0);
      const head = clamp(rawSlice.headProgress ?? rawSlice.head ?? rawSlice.end, 0, 1, 1);
      result[String(frame)] = {
        enabled: rawSlice.enabled !== false,
        tailProgress: Math.min(tail, head),
        headProgress: Math.max(tail, head),
      };
    }
    return result;
  };
  const smoothTrailSticks = (sticks) => {
    if (!Array.isArray(sticks) || sticks.length < 3) return Array.isArray(sticks) ? clone(sticks) : [];
    const result = clone(sticks);
    const poses = result.map(trailPose);
    const centers = poses.map((pose) => pose.center);
    const fractions = trailFractions(centers);
    const centerCurve = trailChaikin(centers, 3);
    const smoothCenters = fractions.map((fraction) => trailSamplePolyline(centerCurve, fraction));
    smoothCenters[0] = { ...centers[0] };
    smoothCenters[smoothCenters.length - 1] = { ...centers.at(-1) };

    const lengths = poses.map((pose) => Math.max(1, Math.hypot(pose.bottom.x - pose.top.x, pose.bottom.y - pose.top.y)));
    const lengthCurve = trailChaikin(fractions.map((fraction, index) => ({ x: fraction, y: lengths[index] })), 3);
    const smoothLengths = fractions.map((fraction) => Math.max(1, trailSampleByX(lengthCurve, fraction)));

    for (let index = 0; index < result.length; index += 1) {
      const fraction = fractions[index];
      const previousGap = index > 0 ? fraction - fractions[index - 1] : 1;
      const nextGap = index + 1 < fractions.length ? fractions[index + 1] - fraction : 1;
      const probe = clamp(Math.min(previousGap, nextGap) * 0.45, 0.005, 0.06, 0.02);
      const before = trailSamplePolyline(centerCurve, Math.max(0, fraction - probe));
      const after = trailSamplePolyline(centerCurve, Math.min(1, fraction + probe));
      const tangent = normalizeTrailVector(
        { x: after.x - before.x, y: after.y - before.y },
        index ? { x: smoothCenters[index].x - smoothCenters[index - 1].x, y: smoothCenters[index].y - smoothCenters[index - 1].y } : { x: 1, y: 0 },
      );
      let normal = { x: tangent.y, y: -tangent.x };
      const oldAcross = {
        x: poses[index].bottom.x - poses[index].top.x,
        y: poses[index].bottom.y - poses[index].top.y,
      };
      if (normal.x * oldAcross.x + normal.y * oldAcross.y < 0) normal = { x: -normal.x, y: -normal.y };
      const halfLength = smoothLengths[index] / 2;
      const poseTop = {
        x: smoothCenters[index].x - normal.x * halfLength,
        y: smoothCenters[index].y - normal.y * halfLength,
      };
      const poseBottom = {
        x: smoothCenters[index].x + normal.x * halfLength,
        y: smoothCenters[index].y + normal.y * halfLength,
      };
      const baseDirection = { x: -normal.y, y: normal.x };
      const incoming = index > 0
        ? normalizeTrailVector({ x: smoothCenters[index].x - smoothCenters[index - 1].x, y: smoothCenters[index].y - smoothCenters[index - 1].y }, tangent)
        : tangent;
      const outgoing = index + 1 < smoothCenters.length
        ? normalizeTrailVector({ x: smoothCenters[index + 1].x - smoothCenters[index].x, y: smoothCenters[index + 1].y - smoothCenters[index].y }, tangent)
        : tangent;
      const turn = Math.acos(clamp(incoming.x * outgoing.x + incoming.y * outgoing.y, -1, 1, 1));
      const tangentStrength = clamp(1 / Math.max(0.7, Math.cos(turn / 4) ** 2), 0.8, 1.2, 1);
      const roundedTop = { x: Math.round(poseTop.x * 10) / 10, y: Math.round(poseTop.y * 10) / 10 };
      const roundedBottom = { x: Math.round(poseBottom.x * 10) / 10, y: Math.round(poseBottom.y * 10) / 10 };
      result[index].top = result[index].reverseDirection ? roundedBottom : roundedTop;
      result[index].bottom = result[index].reverseDirection ? roundedTop : roundedBottom;
      result[index].directionOffset = signedTrailAngle(baseDirection, tangent);
      result[index].tangentStrength = Math.round(tangentStrength * 100) / 100;
    }
    return result;
  };

  class AttackTrailEditor {
    constructor(hooks) {
      this.hooks = hooks;
      this.data = { schemaVersion: ATTACK_TRAIL_SCHEMA_VERSION, bindings: {} };
      this.segmentId = "";
      this.stickId = "";
      this.gradientStopId = "";
      this.gradientDrag = null;
      this.presetEditOriginal = null;
      this.enabled = false;
      this.workspaceMode = "";
      this.attachmentEditingLocked = false;
      this.guidesVisible = false;
      this.pathVisible = true;
      this.previewing = false;
      this.staticEditPreview = false;
      this.previewStartedAt = 0;
      this.previewRequest = 0;
      this.picking = false;
      this.drag = null;
      this.images = new Map();
      this.processed = new Map();
      this.pathCache = new Map();
      this.meshCanvas = document.createElement("canvas");
      this.meshContext = this.meshCanvas.getContext("2d");
      this.meshMaskCanvas = document.createElement("canvas");
      this.meshMaskContext = this.meshMaskCanvas.getContext("2d");
      this.meshSeamCanvas = document.createElement("canvas");
      this.meshSeamContext = this.meshSeamCanvas.getContext("2d");
      this.meshRepairCanvas = document.createElement("canvas");
      this.meshRepairContext = this.meshRepairCanvas.getContext("2d");
      this.gpuCanvas = document.createElement("canvas");
      this.gpuCoreCanvas = document.createElement("canvas");
      this.gpuCoreContext = this.gpuCoreCanvas.getContext("2d");
      this.gpuGlowCanvas = document.createElement("canvas");
      this.gpuGlowContext = this.gpuGlowCanvas.getContext("2d");
      this.gpuTextures = new WeakMap();
      this.gpuRenderer = this._createGpuRenderer();
      this.els = Object.fromEntries([
        "attackTrailPanel", "attackTrailMode", "attackTrailModeChoices", "attackTrailDrawMode", "attackTrailInsertMode",
        "attackTrailBody", "attackTrailDrawControls", "attackTrailInsertControls", "attackTrailSegment", "attackTrailNew",
        "attackTrailDelete", "attackTrailLayerToggle", "attackTrailTextureFile", "attackTrailInvertTexture",
        "attackTrailTextureBrowse", "attackTrailTextureName", "attackTrailTexturePreview", "attackTrailColorMode",
        "attackTrailColor", "attackTrailBodyOpacityFloor", "attackTrailBodyDetailStrength", "attackTrailBodyWhiteThreshold",
        "attackTrailPickColor", "attackTrailGradientEditor", "attackTrailGradientBar",
        "attackTrailGradientColor", "attackTrailGradientPosition",
        "attackTrailStreaksEnabled", "attackTrailStreaksPreview", "attackTrailStreaksName", "attackTrailStreaksFile",
        "attackTrailStreaksBrowse", "attackTrailStreaksColor", "attackTrailStreaksStrength", "attackTrailStreaksThreshold", "attackTrailStreaksSoftness", "attackTrailStreaksExpansion", "attackTrailStreaksBlend", "attackTrailStreaksInvert",
        "attackTrailBreakupEnabled", "attackTrailBreakupPreview", "attackTrailBreakupName", "attackTrailBreakupFile",
        "attackTrailBreakupBrowse", "attackTrailBreakupColor", "attackTrailBreakupStrength", "attackTrailBreakupThreshold", "attackTrailBreakupSoftness", "attackTrailBreakupExpansion", "attackTrailBreakupBlend", "attackTrailBreakupInvert",
        "attackTrailCoreEnabled", "attackTrailCorePreview", "attackTrailCoreName", "attackTrailCoreFile",
        "attackTrailCoreBrowse", "attackTrailCoreColor", "attackTrailCoreStrength", "attackTrailCoreBlend", "attackTrailCoreInvert",
        "attackTrailCoreEdge", "attackTrailGlowColor", "attackTrailGlowStrength", "attackTrailGlowRadius", "attackTrailHeadLightBoost",
        "attackTrailHeadWhitePreserve", "attackTrailHeadWhiteLength",
        "attackTrailWidthMode", "attackTrailFixedWidth", "attackTrailWidthScale", "attackTrailWidthOffset", "attackTrailWidthChaseStrength",
        "attackTrailPathScaleX", "attackTrailPathScaleY",
        "attackTrailTailSamples", "attackTrailPathColumns", "attackTrailTailFadeStart", "attackTrailHeadCurvature", "attackTrailHeadCurvatureValue", "attackTrailAddStick",
        "attackTrailSmooth", "attackTrailFrameToggle",
        "attackTrailDeleteStick", "attackTrailHeadFrame", "attackTrailReverse", "attackTrailTimingSummary",
        "attackTrailGuideToggle", "attackTrailPathToggle", "attackTrailPreview", "attackTrailPresetDialog", "attackTrailPresetForm",
        "attackTrailPresetName", "attackTrailPresetCancel",
      ].map((id) => [id, document.querySelector(`#${id}`)]));
      this._bind();
    }

    load(raw) {
      this.presetEditOriginal = null;
      this.data = this._normalizeData(raw);
      this.pathCache.clear();
      this.processed.clear();
      this.contextChanged();
    }

    snapshot() {
      return clone(this.data);
    }

    restore(raw) {
      this.presetEditOriginal = null;
      this.data = this._normalizeData(raw);
      this.pathCache.clear();
      this.render();
      this.hooks.draw();
    }

    serialize() {
      const data = clone(this.data);
      const draft = this.presetEditOriginal;
      if (draft) {
        const segments = draft.scope === "presets"
          ? (data.presets || [])
          : (data.bindings[draft.bindingKey] || []);
        const index = segments.findIndex((segment) => segment.id === draft.segmentId);
        if (index >= 0) segments[index] = clone(draft.segment);
      }
      return this._normalizeData(data);
    }

    _usesFrameSlicesOnly() {
      return this.hooks.projectKind() === "frame_lite";
    }

    contextChanged() {
      this._discardPresetEdit();
      this.staticEditPreview = false;
      const supported = Boolean(this.hooks.group());
      this._syncGuideToggle(supported);
      if (this.els.attackTrailPanel) this.els.attackTrailPanel.hidden = !supported;
      if (!supported) {
        this._stopFixedPreview();
        this.enabled = false;
        this.workspaceMode = "";
        if (this.els.attackTrailMode) this.els.attackTrailMode.checked = false;
      }
      const segments = this._displaySegments();
      this.segmentId = resolveAttackTrailContextSegmentId(this.segmentId, this._segments(), segments);
      const segment = this._segment();
      if (!segment?.sticks.some((entry) => entry.id === this.stickId)) this.stickId = "";
      this.render();
    }

    frameChanged() {
      if (this.workspaceMode !== "draw") this.stickId = "";
      this.render();
    }

    isContinuous() {
      if (this.staticEditPreview) return false;
      if (this.previewing) return true;
      if (this._usesFrameSlicesOnly()) return false;
      return this.enabled && this.workspaceMode !== "draw" && this._segments().some((segment) => (
        !segment.frameSlices
        && segment.enabled !== false
        && segment.generated !== false
        && segment.sticks.length >= 2
      ));
    }

    isEditingWorkspace() {
      return this.enabled && (this.workspaceMode === "draw" || this.workspaceMode === "insert");
    }

    _syncAttachmentEditingLock() {
      const locked = this.isEditingWorkspace();
      if (locked === this.attachmentEditingLocked) return;
      this.attachmentEditingLocked = locked;
      this.hooks.attachmentEditingLockChanged?.(locked);
    }

    stopPreview() {
      this._stopFixedPreview();
    }

    async prepareExport() {
      const textures = [];
      for (const segment of this._segments()) {
        if (segment.enabled === false || segment.generated === false) continue;
        if (segment.texture?.path) textures.push(segment.texture);
        for (const material of Object.values(segment.materialLayers || {})) {
          if (material?.enabled !== false && material?.texture?.path) textures.push(material.texture);
        }
      }
      await Promise.all(textures.map(async (texture) => {
        if (this.images.has(texture.path)) return;
        const image = await this.hooks.loadTexture(texture);
        this.images.set(texture.path, image);
      }));
    }

    exportEndTime(animationDuration = 0) {
      let endTime = Math.max(0, Number(animationDuration || 0));
      for (const range of this.exportTimeRanges()) endTime = Math.max(endTime, range.end);
      return endTime;
    }

    hasExportTrail() {
      const frameSlicesOnly = this._usesFrameSlicesOnly();
      return this._segments().some((segment) => segment.enabled !== false
        && segment.generated !== false
        && segment.sticks.length >= 2
        && (frameSlicesOnly
          ? Object.values(segment.frameSlices || {}).some((slice) => slice?.enabled)
          : (!segment.frameSlices || Object.values(segment.frameSlices).some((slice) => slice?.enabled))));
    }

    exportTimeRanges() {
      const ranges = [];
      for (const segment of this._segments()) {
        if (segment.enabled === false || segment.generated === false || segment.sticks.length < 2) continue;
        if (segment.frameSlices) {
          for (const [rawFrame, slice] of Object.entries(segment.frameSlices)) {
            if (!slice?.enabled) continue;
            const frame = Math.max(0, Math.round(Number(rawFrame) || 0));
            const start = Math.max(0, Number(this.hooks.frameArrival(frame, 0)) || 0);
            const end = Math.max(start, Number(this.hooks.frameArrival(frame, 1)) || start);
            ranges.push({ start, end });
          }
          continue;
        }
        if (this._usesFrameSlicesOnly()) continue;
        const timing = this._timing(segment);
        const start = Math.max(0, Number(timing.absolute[0] || 0));
        ranges.push({ start, end: start + timing.totalDuration });
      }
      return ranges;
    }

    selectedStickArrival() {
      if (!this.enabled) return null;
      const segment = this._segment();
      const stick = this._stick();
      if (!segment || !stick || stick.frame !== this.hooks.selectedFrame()) return null;
      const index = segment.sticks.findIndex((entry) => entry.id === stick.id);
      return this._timing(segment).absolute[index] ?? this.hooks.frameArrival(stick.frame, stick.framePhase);
    }

    render() {
      this._syncAttachmentEditingLock();
      const e = this.els;
      const supported = Boolean(this.hooks.group());
      this._syncGuideToggle(supported);
      if (!e.attackTrailPanel || e.attackTrailPanel.hidden) return;
      e.attackTrailMode.checked = this.enabled;
      e.attackTrailModeChoices.hidden = !this.enabled;
      e.attackTrailBody.hidden = !this.enabled || !this.workspaceMode;
      e.attackTrailDrawControls.hidden = this.workspaceMode !== "draw";
      e.attackTrailInsertControls.hidden = this.workspaceMode !== "insert";
      e.attackTrailDrawMode.classList.toggle("active", this.workspaceMode === "draw");
      e.attackTrailInsertMode.classList.toggle("active", this.workspaceMode === "insert");
      e.attackTrailDrawMode.setAttribute("aria-pressed", this.workspaceMode === "draw" ? "true" : "false");
      e.attackTrailInsertMode.setAttribute("aria-pressed", this.workspaceMode === "insert" ? "true" : "false");
      const segments = this._displaySegments();
      e.attackTrailSegment.innerHTML = segments.length
        ? segments.map((segment, index) => `<option value="${this._escape(segment.id)}">${segment.presetOnly ? "应用预设（全局通用）· " : `拖尾 ${index + 1} · `}${this._escape(segment.name || `Trail ${index + 1}`)}</option>`).join("")
        : '<option value="">暂无拖尾段</option>';
      e.attackTrailSegment.value = this.segmentId;
      const segment = this._segment();
      const presetPreview = this._isPresetSegment(segment);
      const materialControlIds = ["Streaks", "Breakup", "Core"].flatMap((prefix) => [
        `attackTrail${prefix}Enabled`, `attackTrail${prefix}Browse`, `attackTrail${prefix}Color`,
        ...(prefix === "Core" ? [] : [
          `attackTrail${prefix}Strength`, `attackTrail${prefix}Threshold`, `attackTrail${prefix}Softness`, `attackTrail${prefix}Expansion`,
        ]),
        `attackTrail${prefix}Blend`, `attackTrail${prefix}Invert`,
      ]);
      for (const element of [e.attackTrailDelete, e.attackTrailLayerToggle, e.attackTrailTextureBrowse,
        e.attackTrailInvertTexture, e.attackTrailColorMode, e.attackTrailColor, e.attackTrailBodyOpacityFloor, e.attackTrailBodyDetailStrength,
        e.attackTrailBodyWhiteThreshold, e.attackTrailPickColor, e.attackTrailGradientColor,
        ...materialControlIds.map((id) => e[id]), e.attackTrailCoreEdge, e.attackTrailGlowStrength, e.attackTrailGlowRadius,
        e.attackTrailHeadLightBoost, e.attackTrailHeadWhitePreserve, e.attackTrailHeadWhiteLength,
        e.attackTrailWidthMode, e.attackTrailFixedWidth, e.attackTrailWidthScale, e.attackTrailWidthOffset, e.attackTrailWidthChaseStrength,
        e.attackTrailPathScaleX, e.attackTrailPathScaleY,
        e.attackTrailTailSamples, e.attackTrailPathColumns, e.attackTrailTailFadeStart, e.attackTrailHeadCurvature,
        e.attackTrailAddStick, e.attackTrailDeleteStick, e.attackTrailHeadFrame, e.attackTrailReverse, e.attackTrailSmooth,
        e.attackTrailFrameToggle]) {
        if (element) element.disabled = !segment;
      }
      if (e.attackTrailDelete) e.attackTrailDelete.disabled = !segment || presetPreview;
      if (!segment) {
        e.attackTrailTextureName.textContent = "先新增一段拖尾";
        e.attackTrailTexturePreview.hidden = true;
        e.attackTrailGradientEditor.hidden = true;
        e.attackTrailTimingSummary.textContent = "";
        this._syncToolbar(supported);
        return;
      }
      e.attackTrailTextureName.textContent = segment.texture?.name
        ? `${presetPreview ? "默认预设 · " : ""}${segment.texture.name}`
        : "尚未导入 PNG";
      this._renderTexturePreview(segment);
      e.attackTrailInvertTexture.classList.toggle("active", segment.invertTexture === true);
      e.attackTrailInvertTexture.setAttribute("aria-pressed", segment.invertTexture === true ? "true" : "false");
      e.attackTrailInvertTexture.title = segment.invertTexture === true ? "恢复当前拖尾纹理原始明暗" : "反转当前拖尾纹理的明暗";
      e.attackTrailColorMode.value = segment.colorMode;
      e.attackTrailColor.value = segment.color.slice(0, 7);
      e.attackTrailBodyOpacityFloor.value = Math.round(segment.bodyOpacityFloor * 100);
      e.attackTrailBodyDetailStrength.value = Math.round(segment.bodyDetailStrength * 100);
      e.attackTrailBodyWhiteThreshold.value = Math.round(segment.bodyWhiteThreshold * 100);
      const solidColorMode = segment.colorMode === "solid";
      e.attackTrailColor.disabled = !solidColorMode;
      e.attackTrailPickColor.disabled = !solidColorMode;
      const materialUi = {
        streaks: "Streaks",
        breakup: "Breakup",
        core: "Core",
      };
      for (const [layerId, prefix] of Object.entries(materialUi)) {
        const material = segment.materialLayers[layerId];
        const enabled = material.enabled !== false;
        e[`attackTrail${prefix}Enabled`].checked = enabled;
        e[`attackTrail${prefix}Color`].value = material.color;
        const strengthControl = e[`attackTrail${prefix}Strength`];
        if (strengthControl) strengthControl.value = Math.round(material.strength * 100);
        const thresholdControl = e[`attackTrail${prefix}Threshold`];
        if (thresholdControl) thresholdControl.value = Math.round(material.threshold * 100);
        const softnessControl = e[`attackTrail${prefix}Softness`];
        if (softnessControl) softnessControl.value = Math.round(material.softness * 100);
        const expansionControl = e[`attackTrail${prefix}Expansion`];
        if (expansionControl) expansionControl.value = Math.round(material.expansion * 100);
        e[`attackTrail${prefix}Blend`].value = material.blendMode;
        e[`attackTrail${prefix}Invert`].checked = material.invert === true;
        e[`attackTrail${prefix}Name`].textContent = material.texture?.name || "尚未导入 PNG";
        const preview = e[`attackTrail${prefix}Preview`];
        if (material.texture?.path) {
          preview.src = this.hooks.assetUrl(material.texture);
          preview.hidden = false;
        } else {
          preview.removeAttribute("src");
          preview.hidden = true;
        }
        for (const suffix of ["Browse", "Color", "Strength", "Threshold", "Softness", "Expansion", "Blend", "Invert"]) {
          const control = e[`attackTrail${prefix}${suffix}`];
          if (control) control.disabled = !enabled;
        }
      }
      e.attackTrailCoreEdge.value = segment.coreEdge;
      e.attackTrailGlowColor.value = segment.glowColor;
      e.attackTrailGlowStrength.value = Math.round(segment.glowStrength * 100);
      e.attackTrailGlowRadius.value = Math.round(segment.glowRadius);
      e.attackTrailHeadLightBoost.value = Math.round(segment.headLightBoost * 100);
      e.attackTrailHeadWhitePreserve.value = Math.round(segment.headWhitePreserve * 100);
      e.attackTrailHeadWhiteLength.value = Math.round(segment.headWhiteLength * 100);
      for (const element of [e.attackTrailCoreEdge, e.attackTrailGlowColor, e.attackTrailGlowStrength,
        e.attackTrailGlowRadius, e.attackTrailHeadLightBoost, e.attackTrailHeadWhitePreserve, e.attackTrailHeadWhiteLength]) {
        element.disabled = segment.materialLayers.core.enabled === false;
      }
      e.attackTrailGradientEditor.hidden = segment.colorMode !== "gradient";
      if (segment.colorMode === "gradient") this._renderGradientEditor(segment);
      e.attackTrailPickColor.classList.toggle("active", this.picking);
      e.attackTrailWidthMode.value = segment.widthMode;
      e.attackTrailFixedWidth.value = Math.round(segment.fixedWidth);
      e.attackTrailWidthScale.value = Math.round(segment.widthScale * 100);
      e.attackTrailWidthOffset.value = Math.round(segment.widthOffset * 100);
      e.attackTrailWidthChaseStrength.value = Math.round(segment.widthChaseStrength * 100);
      e.attackTrailPathScaleX.value = Math.round(segment.pathScaleX * 100);
      e.attackTrailPathScaleY.value = Math.round(segment.pathScaleY * 100);
      e.attackTrailFixedWidth.disabled = segment.widthMode !== "fixed";
      e.attackTrailTailSamples.value = segment.tailSamples;
      e.attackTrailPathColumns.value = segment.pathColumns;
      e.attackTrailTailFadeStart.value = Math.round(segment.tailFadeStart * 100);
      e.attackTrailHeadCurvature.value = Math.round(segment.headCurvature * 100);
      e.attackTrailHeadCurvatureValue.value = `${Math.round(segment.headCurvature * 100)}`;
      const frameSlice = this._frameSlice(segment);
      e.attackTrailFrameToggle.disabled = segment.sticks.length < 2 || presetPreview;
      e.attackTrailFrameToggle.classList.toggle("active", Boolean(frameSlice?.enabled));
      e.attackTrailFrameToggle.textContent = frameSlice?.enabled ? "移除本帧拖尾" : "本帧加入拖尾";
      if (!segment.sticks.some((entry) => entry.id === this.stickId)) this.stickId = "";
      const stick = this._stick();
      const stickIndex = segment.sticks.findIndex((entry) => entry.id === stick?.id);
      const endpointStick = stickIndex === segment.sticks.length - 1;
      e.attackTrailDeleteStick.disabled = !stick;
      e.attackTrailHeadFrame.disabled = !stick || endpointStick;
      e.attackTrailLayerToggle.disabled = !stick;
      e.attackTrailReverse.disabled = !stick;
      e.attackTrailSmooth.disabled = segment.sticks.length < 3 || presetPreview;
      e.attackTrailHeadFrame.classList.toggle("active", stick?.headFrame !== false);
      e.attackTrailHeadFrame.setAttribute("aria-pressed", stick?.headFrame !== false ? "true" : "false");
      e.attackTrailHeadFrame.title = endpointStick
        ? "最后一根棍子必须是头部帧"
        : (stick?.headFrame !== false ? "当前棍子会成为实际显示的拖尾头部帧" : "当前棍子只塑造轨迹，不会成为拖尾头部");
      e.attackTrailLayerToggle.classList.toggle("behind", stick?.layer === "behind");
      e.attackTrailLayerToggle.classList.toggle("front", stick?.layer === "front");
      e.attackTrailLayerToggle.textContent = stick
        ? (stick.layer === "front" ? "角色前" : "角色后")
        : "角色层";
      e.attackTrailReverse.classList.toggle("active", stick?.reverseDirection === true);
      e.attackTrailReverse.setAttribute("aria-pressed", stick?.reverseDirection === true ? "true" : "false");
      e.attackTrailTimingSummary.textContent = segment.presetOnly
        ? "这是新建拖尾使用的预设；修改它不会改变已有拖尾。"
        : segment.sticks.length >= 2
          ? `轨迹：${segment.sticks.length} 根棍子 · 拖尾预览固定 1000 ms · 尾/头速度比 0.5`
          : "至少需要两根棍子才能生成拖尾。";
      this._syncToolbar(supported);
    }

    drawLayer(layer, frameIndex, alpha = 1) {
      if (!this.enabled || frameIndex !== this.hooks.selectedFrame()) return;
      if (this.workspaceMode === "draw") {
        const segment = this._segment();
        if (!segment || segment.enabled === false || segment.generated === false || segment.sticks.length < 2 || !segment.texture?.path) return;
        if (this.previewing) {
          const elapsed = (performance.now() - this.previewStartedAt) / 1000;
          this._drawSegment(segment, alpha, layer, null, elapsed);
          return;
        }
        if (this.staticEditPreview) {
          this._drawSegment(segment, alpha, layer, { enabled: true, tailProgress: 0, headProgress: 1 });
          return;
        }
        const stickIndex = segment.sticks.findIndex((entry) => entry.id === this.stickId);
        const headProgress = stickIndex < 0
          ? 1
          : this._stickProgress(segment, stickIndex);
        this._drawSegment(segment, alpha, layer, { enabled: true, tailProgress: 0, headProgress });
        return;
      }
      if (!this.workspaceMode && this.hooks.selectedGuidePreviewActive?.() === true) return;
      for (const segment of this._segments()) {
        if (segment.enabled === false || segment.generated === false || segment.sticks.length < 2 || !segment.texture?.path) continue;
        if (this.workspaceMode === "insert" || segment.frameSlices) {
          const slice = segment.frameSlices?.[String(frameIndex)];
          if (slice?.enabled) this._drawSegment(segment, alpha, layer, slice);
        } else {
          this._drawSegment(segment, alpha, layer);
        }
      }
    }

    drawGuides() {
      if (!this.enabled || !this.workspaceMode) return;
      const segment = this._segment();
      if (!segment) return;
      if (this.workspaceMode === "insert") {
        const frameSlice = this._frameSlice(segment);
        if (frameSlice?.enabled && this.pathVisible) this._drawFrameSliceHandles(segment, frameSlice);
        return;
      }
      if (this.workspaceMode !== "draw" || !this.guidesVisible) return;
      const ctx = this.hooks.ctx;
      const dpr = this.hooks.dpr();
      if (this.pathVisible) this._drawSelectedPathGuide(segment);
      for (const stick of segment.sticks) {
        const top = this.hooks.localToScreen(stick.top);
        const bottom = this.hooks.localToScreen(stick.bottom);
        const center = { x: (top.x + bottom.x) / 2, y: (top.y + bottom.y) / 2 };
        const directionHandle = this._directionHandleScreen(stick);
        const direction = directionHandle.direction;
        const arrow = directionHandle.arrow;
        const selected = stick.id === this.stickId;
        const layerColor = stick.layer === "front" ? "#ff982e" : "#39baff";
        ctx.save();
        ctx.globalAlpha = selected ? 1 : 0.82;
        ctx.strokeStyle = layerColor;
        ctx.fillStyle = layerColor;
        ctx.lineWidth = (selected ? 3 : 2) * dpr;
        if (selected) { ctx.shadowColor = layerColor; ctx.shadowBlur = 8 * dpr; }
        ctx.beginPath(); ctx.moveTo(top.x, top.y); ctx.lineTo(bottom.x, bottom.y); ctx.stroke();
        for (const handle of [top, bottom]) {
          ctx.beginPath(); ctx.arc(handle.x, handle.y, HANDLE_RADIUS * dpr, 0, Math.PI * 2); ctx.fill();
        }
        ctx.save();
        ctx.shadowBlur = 0;
        ctx.fillStyle = "#fff8e8";
        ctx.strokeStyle = layerColor;
        ctx.lineWidth = 3 * dpr;
        ctx.beginPath(); ctx.arc(center.x, center.y, CENTER_HANDLE_RADIUS * dpr, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.fillStyle = layerColor;
        ctx.beginPath(); ctx.arc(center.x, center.y, 2.5 * dpr, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
        ctx.strokeStyle = layerColor;
        ctx.fillStyle = layerColor;
        ctx.beginPath(); ctx.moveTo(center.x, center.y); ctx.lineTo(arrow.x, arrow.y); ctx.stroke();
        const side = { x: -direction.y * 7 * dpr, y: direction.x * 7 * dpr };
        ctx.beginPath();
        ctx.moveTo(arrow.x, arrow.y);
        ctx.lineTo(arrow.x - direction.x * 13 * dpr + side.x, arrow.y - direction.y * 13 * dpr + side.y);
        ctx.lineTo(arrow.x - direction.x * 13 * dpr - side.x, arrow.y - direction.y * 13 * dpr - side.y);
        ctx.closePath(); ctx.fill();
        if (selected) {
          ctx.save();
          ctx.shadowBlur = 0;
          ctx.fillStyle = "#fff8e8";
          ctx.strokeStyle = layerColor;
          ctx.lineWidth = 3 * dpr;
          ctx.beginPath(); ctx.arc(arrow.x, arrow.y, 7 * dpr, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
          ctx.restore();
        }
        ctx.font = `bold ${14 * dpr}px system-ui, sans-serif`;
        ctx.fillText(`#${stick.order + 1}`, arrow.x + 8 * dpr, arrow.y - 7 * dpr);
        ctx.restore();
      }
    }

    _frameSliceHandleScreen(segment, progress) {
      const state = this._pathState(segment);
      const time = this._timeAtDistance(state, state.total * clamp(progress, 0, 1, 0));
      return this.hooks.localToScreen(this._pose(segment.sticks, state.timing.times, time).center);
    }

    _nearestFrameSliceProgress(segment, cursor) {
      const state = this._pathState(segment);
      let nearest = state.samples[0];
      let nearestDistance = Infinity;
      for (const sample of state.samples) {
        const screen = this.hooks.localToScreen(sample.pose.center);
        const distance = Math.hypot(cursor.x - screen.x, cursor.y - screen.y);
        if (distance < nearestDistance) {
          nearest = sample;
          nearestDistance = distance;
        }
      }
      return clamp(nearest.distance / Math.max(0.001, state.total), 0, 1, 0);
    }

    _drawFrameSliceHandles(segment, slice) {
      const state = this._pathState(segment);
      const ctx = this.hooks.ctx;
      const dpr = this.hooks.dpr();
      ctx.save();
      if (this.pathVisible) {
        ctx.strokeStyle = "rgba(255,255,255,.55)";
        ctx.lineWidth = 2 * dpr;
        ctx.setLineDash([6 * dpr, 5 * dpr]);
        ctx.beginPath();
        state.samples.forEach((sample, index) => {
          const screen = this.hooks.localToScreen(sample.pose.center);
          if (!index) ctx.moveTo(screen.x, screen.y);
          else ctx.lineTo(screen.x, screen.y);
        });
        ctx.stroke();
        ctx.setLineDash([]);
      }
      for (const [endpoint, label, color] of [
        ["tailProgress", "尾", "#39baff"],
        ["headProgress", "头", "#ff982e"],
      ]) {
        const handle = this._frameSliceHandleScreen(segment, slice[endpoint]);
        ctx.fillStyle = color;
        ctx.strokeStyle = "#10151d";
        ctx.lineWidth = 3 * dpr;
        ctx.beginPath();
        ctx.arc(handle.x, handle.y, 11 * dpr, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = "#fff";
        ctx.font = `900 ${12 * dpr}px system-ui, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(label, handle.x, handle.y);
      }
      ctx.restore();
    }

    _drawSelectedPathGuide(segment) {
      const selectedIndex = segment.sticks.findIndex((stick) => stick.id === this.stickId);
      if (selectedIndex < 0 || segment.sticks.length < 2) return;
      const timing = this._timing(segment);
      const firstIndex = Math.max(0, selectedIndex - 1);
      const lastIndex = Math.min(segment.sticks.length - 1, selectedIndex + 1);
      if (firstIndex === lastIndex) return;
      const startTime = timing.times[firstIndex];
      const endTime = timing.times[lastIndex];
      const ctx = this.hooks.ctx;
      const dpr = this.hooks.dpr();
      ctx.save();
      ctx.strokeStyle = "#ffe36a";
      ctx.lineWidth = 2 * dpr;
      ctx.setLineDash([7 * dpr, 5 * dpr]);
      ctx.globalAlpha = 0.92;
      ctx.beginPath();
      for (let sample = 0; sample <= 48; sample += 1) {
        const time = startTime + (endTime - startTime) * sample / 48;
        const screen = this.hooks.localToScreen(this._pose(segment.sticks, timing.times, time).center);
        if (sample === 0) ctx.moveTo(screen.x, screen.y);
        else ctx.lineTo(screen.x, screen.y);
      }
      ctx.stroke();

      const stick = segment.sticks[selectedIndex];
      const pose = this._stickPose(stick);
      const previousPose = selectedIndex > 0 ? this._stickPose(segment.sticks[selectedIndex - 1]) : null;
      const nextPose = selectedIndex + 1 < segment.sticks.length ? this._stickPose(segment.sticks[selectedIndex + 1]) : null;
      const distances = [previousPose, nextPose].filter(Boolean).map((entry) => Math.hypot(entry.center.x - pose.center.x, entry.center.y - pose.center.y));
      const handleDistance = (distances.reduce((sum, value) => sum + value, 0) / Math.max(1, distances.length)) * stick.tangentStrength / 3;
      const direction = this._direction(stick);
      const center = this.hooks.localToScreen(pose.center);
      const outgoing = this.hooks.localToScreen({ x: pose.center.x + direction.x * handleDistance, y: pose.center.y + direction.y * handleDistance });
      const incoming = this.hooks.localToScreen({ x: pose.center.x - direction.x * handleDistance, y: pose.center.y - direction.y * handleDistance });
      ctx.setLineDash([]);
      ctx.strokeStyle = "#ffef9c";
      ctx.fillStyle = "#ffe36a";
      ctx.lineWidth = 1.5 * dpr;
      ctx.beginPath(); ctx.moveTo(incoming.x, incoming.y); ctx.lineTo(outgoing.x, outgoing.y); ctx.stroke();
      for (const handle of [incoming, outgoing]) {
        ctx.beginPath(); ctx.arc(handle.x, handle.y, 4 * dpr, 0, Math.PI * 2); ctx.fill();
      }
      ctx.beginPath(); ctx.arc(center.x, center.y, 3 * dpr, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }

    pointerDown(event) {
      if (!this.enabled || !this.workspaceMode) return false;
      this.staticEditPreview = false;
      if (this.picking) {
        if (this.workspaceMode !== "draw") return false;
        this._pickColor(event);
        return true;
      }
      const segment = this._segment();
      if (!segment) return false;
      const cursor = this.hooks.stagePoint(event);
      const radius = HANDLE_RADIUS * this.hooks.dpr() * 1.8;
      const frameSlice = this.workspaceMode === "insert" ? this._frameSlice(segment) : null;
      if (frameSlice?.enabled) {
        for (const endpoint of ["headProgress", "tailProgress"]) {
          const handle = this._frameSliceHandleScreen(segment, frameSlice[endpoint]);
          if (Math.hypot(cursor.x - handle.x, cursor.y - handle.y) <= radius) {
            this.hooks.pushUndo("drag frame trail endpoint");
            this.drag = { mode: "frameSlice", endpoint };
            return true;
          }
        }
      }
      if (this.workspaceMode !== "draw" || !this.guidesVisible) return false;
      for (const stick of [...segment.sticks].reverse()) {
        const handle = this._directionHandleScreen(stick).arrow;
        if (Math.hypot(cursor.x - handle.x, cursor.y - handle.y) <= radius) {
          this.hooks.pushUndo("adjust attack trail curve handle");
          this.stickId = stick.id;
          this.drag = { stickId: stick.id, mode: "direction" };
          this.render(); this.hooks.draw();
          return true;
        }
      }
      for (const stick of [...segment.sticks].reverse()) {
        for (const endpoint of ["top", "bottom"]) {
          const handle = this.hooks.localToScreen(stick[endpoint]);
          if (Math.hypot(cursor.x - handle.x, cursor.y - handle.y) <= radius) {
            this.hooks.pushUndo("drag attack trail stick");
            this.stickId = stick.id;
            this.drag = { stickId: stick.id, endpoint };
            this.render();
            this.hooks.draw();
            return true;
          }
        }
      }
      for (const stick of [...segment.sticks].reverse()) {
        const top = this.hooks.localToScreen(stick.top);
        const bottom = this.hooks.localToScreen(stick.bottom);
        const center = { x: (top.x + bottom.x) / 2, y: (top.y + bottom.y) / 2 };
        if (Math.hypot(cursor.x - center.x, cursor.y - center.y) <= CENTER_HANDLE_RADIUS * this.hooks.dpr() * 1.8) {
          this.hooks.pushUndo("move attack trail stick");
          this.stickId = stick.id;
          this.drag = {
            stickId: stick.id,
            mode: "center",
            startLocal: this.hooks.screenToLocal(cursor),
            startTop: { ...stick.top },
            startBottom: { ...stick.bottom },
          };
          this.render();
          this.hooks.draw();
          return true;
        }
      }
      for (const stick of [...segment.sticks].reverse()) {
        const top = this.hooks.localToScreen(stick.top);
        const bottom = this.hooks.localToScreen(stick.bottom);
        if (this._distanceToSegment(cursor, top, bottom) <= 11 * this.hooks.dpr()) {
          this.stickId = stick.id;
          this.drag = null;
          this.render(); this.hooks.draw();
          return true;
        }
      }
      return false;
    }

    _distanceToSegment(pointValue, start, end) {
      const dx = end.x - start.x, dy = end.y - start.y;
      const lengthSquared = dx * dx + dy * dy;
      if (lengthSquared <= 0.0001) return Math.hypot(pointValue.x - start.x, pointValue.y - start.y);
      const phase = clamp(((pointValue.x - start.x) * dx + (pointValue.y - start.y) * dy) / lengthSquared, 0, 1, 0);
      return Math.hypot(pointValue.x - (start.x + dx * phase), pointValue.y - (start.y + dy * phase));
    }

    pointerMove(event) {
      if (!this.drag) return false;
      if (this.drag.mode === "frameSlice") {
        const segment = this._segment();
        const slice = this._frameSlice(segment);
        if (!segment || !slice) return false;
        const progress = this._nearestFrameSliceProgress(segment, this.hooks.stagePoint(event));
        if (this.drag.endpoint === "tailProgress") {
          slice.tailProgress = Math.min(progress, slice.headProgress);
        } else {
          slice.headProgress = Math.max(progress, slice.tailProgress);
        }
        this.hooks.markDirty();
        this.hooks.draw();
        return true;
      }
      const stick = this._segment()?.sticks.find((entry) => entry.id === this.drag.stickId);
      if (!stick) return false;
      const cursor = this.hooks.stagePoint(event);
      const local = this.hooks.screenToLocal(cursor);
      if (this.drag.mode === "direction") {
        const pose = this._stickPose(stick);
        const desired = { x: local.x - pose.center.x, y: local.y - pose.center.y };
        const desiredLength = Math.hypot(desired.x, desired.y);
        if (desiredLength > 0.001) {
          const base = this._baseDirection(stick);
          const normalized = { x: desired.x / desiredLength, y: desired.y / desiredLength };
          const degrees = Math.atan2(base.x * normalized.y - base.y * normalized.x, base.x * normalized.x + base.y * normalized.y) * 180 / Math.PI;
          stick.directionOffset = Math.round(degrees * 10) / 10;
        }
        const center = this.hooks.localToScreen(pose.center);
        const handleLength = Math.hypot(cursor.x - center.x, cursor.y - center.y) / this.hooks.dpr();
        stick.tangentStrength = Math.round(clamp(
          handleLength / DIRECTION_HANDLE_UNIT_PX,
          DIRECTION_HANDLE_MIN_STRENGTH,
          DIRECTION_HANDLE_MAX_STRENGTH,
          stick.tangentStrength,
        ) * 100) / 100;
      } else if (this.drag.mode === "center") {
        const dx = local.x - this.drag.startLocal.x;
        const dy = local.y - this.drag.startLocal.y;
        stick.top = { x: Math.round((this.drag.startTop.x + dx) * 10) / 10, y: Math.round((this.drag.startTop.y + dy) * 10) / 10 };
        stick.bottom = { x: Math.round((this.drag.startBottom.x + dx) * 10) / 10, y: Math.round((this.drag.startBottom.y + dy) * 10) / 10 };
      } else {
        stick[this.drag.endpoint] = { x: Math.round(local.x * 10) / 10, y: Math.round(local.y * 10) / 10 };
      }
      this.pathCache.clear();
      this.hooks.markDirty();
      this.hooks.draw();
      return true;
    }

    pointerUp() {
      const hadDrag = Boolean(this.drag);
      this.drag = null;
      if (hadDrag) this.render();
      return hadDrag;
    }

    _bind() {
      const e = this.els;
      if (!e.attackTrailMode) return;
      e.attackTrailMode.addEventListener("change", () => {
        this.enabled = e.attackTrailMode.checked;
        this.staticEditPreview = false;
        if (!this.enabled) {
          this._stopFixedPreview();
          this.workspaceMode = "";
          this.stickId = "";
        }
        this.picking = false;
        this.render(); this.hooks.draw();
      });
      e.attackTrailDrawMode.addEventListener("click", () => this._setWorkspaceMode("draw"));
      e.attackTrailInsertMode.addEventListener("click", () => this._setWorkspaceMode("insert"));
      e.attackTrailSegment.addEventListener("change", () => {
        const selectedId = e.attackTrailSegment.value;
        const previous = this._segment();
        this._discardPresetEdit();
        this.staticEditPreview = false;
        const selected = this._displaySegments().find((segment) => segment.id === selectedId)
          || (selectedId === PRESET_SEGMENT_ID ? this._presetSegment() : null);
        if (selected?.presetOnly) {
          let target = previous?.presetOnly !== true
            ? this._segments().find((segment) => segment.id === previous.id)
            : this._preferredSegment(this._segments().filter((segment) => segment.presetOnly !== true));
          if (target) {
            this._applyPresetToTrail(target, selected);
            return;
          }
          target = this._trailFromSavedPreset(selected);
          this.stickId = "";
          this.hooks.markDirty();
          this.render();
          this.hooks.draw();
          this.hooks.status(`已将预设“${selected.name}”复制为当前动作的独立拖尾；后续修改不会影响预设或其他动作。`);
          return;
        }
        this.segmentId = selectedId;
        this.stickId = this._segment()?.sticks[0]?.id || "";
        this.picking = false;
        this.render(); this.hooks.draw();
      });
      e.attackTrailNew.addEventListener("click", () => this._openPresetDialog());
      e.attackTrailPresetCancel.addEventListener("click", () => e.attackTrailPresetDialog.close());
      e.attackTrailPresetForm.addEventListener("submit", (event) => {
        event.preventDefault();
        this._savePreset(e.attackTrailPresetName.value);
        e.attackTrailPresetDialog.close();
      });
      e.attackTrailDelete.addEventListener("click", () => this._deleteSegment());
      e.attackTrailLayerToggle.addEventListener("click", () => this._toggleStickLayer());
      e.attackTrailTextureBrowse.addEventListener("click", () => e.attackTrailTextureFile.click());
      e.attackTrailTextureFile.addEventListener("change", () => this._uploadTexture(e.attackTrailTextureFile.files?.[0]));
      e.attackTrailInvertTexture.addEventListener("click", () => {
        const segment = this._segment();
        if (!segment) return;
        this.hooks.pushUndo("invert attack trail texture");
        this._editSegment("invertTexture", segment.invertTexture !== true);
      });
      e.attackTrailColorMode.addEventListener("change", () => this._setColorMode(e.attackTrailColorMode.value));
      e.attackTrailColor.addEventListener("input", () => this._editSegment("color", e.attackTrailColor.value));
      e.attackTrailBodyOpacityFloor.addEventListener("input", () => (
        this._editSegment("bodyOpacityFloor", clamp(e.attackTrailBodyOpacityFloor.value, 0, 100, 0) / 100)
      ));
      e.attackTrailBodyDetailStrength.addEventListener("input", () => (
        this._editSegment("bodyDetailStrength", clamp(e.attackTrailBodyDetailStrength.value, 0, 100, 100) / 100)
      ));
      e.attackTrailBodyWhiteThreshold.addEventListener("input", () => (
        this._editSegment("bodyWhiteThreshold", clamp(e.attackTrailBodyWhiteThreshold.value, 0, 100, 100) / 100)
      ));
      for (const [layerId, prefix] of [["streaks", "Streaks"], ["breakup", "Breakup"], ["core", "Core"]]) {
        e[`attackTrail${prefix}Enabled`].addEventListener("change", () => (
          this._editMaterialLayer(layerId, "enabled", e[`attackTrail${prefix}Enabled`].checked)
        ));
        e[`attackTrail${prefix}Color`].addEventListener("input", () => (
          this._editMaterialLayer(layerId, "color", e[`attackTrail${prefix}Color`].value)
        ));
        const strengthControl = e[`attackTrail${prefix}Strength`];
        if (strengthControl) strengthControl.addEventListener("input", () => (
          this._editMaterialLayer(layerId, "strength", clamp(strengthControl.value, 0, 200, 100) / 100)
        ));
        for (const key of ["threshold", "softness", "expansion"]) {
          const control = e[`attackTrail${prefix}${key[0].toUpperCase()}${key.slice(1)}`];
          if (control) control.addEventListener("input", () => (
            this._editMaterialLayer(layerId, key, clamp(control.value, 0, key === "expansion" ? 12 : 100, 0) / 100)
          ));
        }
        e[`attackTrail${prefix}Blend`].addEventListener("change", () => (
          this._editMaterialLayer(layerId, "blendMode", normalizeBlendMode(e[`attackTrail${prefix}Blend`].value))
        ));
        e[`attackTrail${prefix}Invert`].addEventListener("change", () => (
          this._editMaterialLayer(layerId, "invert", e[`attackTrail${prefix}Invert`].checked)
        ));
        e[`attackTrail${prefix}Browse`].addEventListener("click", () => e[`attackTrail${prefix}File`].click());
        e[`attackTrail${prefix}File`].addEventListener("change", () => (
          this._uploadMaterialLayerTexture(layerId, e[`attackTrail${prefix}File`].files?.[0], prefix)
        ));
      }
      e.attackTrailCoreEdge.addEventListener("change", () => this._editSegment("coreEdge", normalizeCoreEdge(e.attackTrailCoreEdge.value)));
      e.attackTrailGradientColor.addEventListener("pointerdown", () => {
        if (this._segment()?.colorMode === "gradient" && this._gradientStop()) this.hooks.pushUndo("change attack trail gradient color");
      });
      e.attackTrailGradientColor.addEventListener("input", () => this._setGradientStopColor(e.attackTrailGradientColor.value));
      e.attackTrailGradientBar.addEventListener("pointerdown", (event) => this._gradientPointerDown(event));
      e.attackTrailGradientBar.addEventListener("pointermove", (event) => this._gradientPointerMove(event));
      e.attackTrailGradientBar.addEventListener("pointerup", (event) => this._gradientPointerUp(event));
      e.attackTrailGradientBar.addEventListener("pointercancel", (event) => this._gradientPointerUp(event));
      e.attackTrailGradientBar.addEventListener("dblclick", (event) => {
        if (event.target.closest?.(".trailGradientStop")) e.attackTrailGradientColor.click();
      });
      window.addEventListener("keydown", (event) => {
        if (event.key !== "Delete" || event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
        if (this.enabled && this._segment()?.colorMode === "gradient" && this.gradientStopId) {
          event.preventDefault();
          this._deleteGradientStop();
        }
      });
      e.attackTrailPickColor.addEventListener("click", () => { this.picking = !this.picking; this.render(); this.hooks.draw(); });
      e.attackTrailGuideToggle.addEventListener("click", () => {
        if (!this.enabled || this.workspaceMode !== "draw") return;
        this.guidesVisible = !this.guidesVisible;
        this._syncGuideToggle(true);
        this.hooks.draw();
      });
      e.attackTrailPathToggle.addEventListener("click", () => {
        if (!this.enabled || !this.workspaceMode) return;
        this.pathVisible = !this.pathVisible;
        this._syncToolbar(true);
        this.hooks.draw();
      });
      e.attackTrailPreview.addEventListener("click", () => {
        if (this.previewing) this._stopFixedPreview();
        else this._startFixedPreview();
      });
      e.attackTrailWidthMode.addEventListener("change", () => this._editSegment(
        "widthMode",
        e.attackTrailWidthMode.value === "fixed" ? "fixed" : "authored",
      ));
      e.attackTrailFixedWidth.addEventListener("input", () => this._editSegment(
        "fixedWidth",
        clamp(e.attackTrailFixedWidth.value, 8, 600, 160),
      ));
      for (const [id, key, min, max, fallback] of [
        ["attackTrailWidthScale", "widthScale", 10, 300, 100],
        ["attackTrailWidthOffset", "widthOffset", -100, 100, 0],
        ["attackTrailWidthChaseStrength", "widthChaseStrength", 0, 100, 100],
        ["attackTrailPathScaleX", "pathScaleX", 25, 300, 100],
        ["attackTrailPathScaleY", "pathScaleY", 25, 300, 100],
      ]) e[id].addEventListener("input", () => this._editSegment(key, clamp(e[id].value, min, max, fallback) / 100));
      for (const [id, key, min, max] of [
        ["attackTrailTailSamples", "tailSamples", 4, 8], ["attackTrailPathColumns", "pathColumns", 8, 96],
      ]) e[id].addEventListener("input", () => this._editSegment(key, clamp(e[id].value, min, max, min)));
      for (const [id, key, min, max, fallback] of [
        ["attackTrailGlowStrength", "glowStrength", 0, 300, 28],
        ["attackTrailHeadLightBoost", "headLightBoost", 0, 200, 55],
        ["attackTrailHeadWhitePreserve", "headWhitePreserve", 0, 100, 0],
        ["attackTrailHeadWhiteLength", "headWhiteLength", 0, 50, 18],
      ]) e[id].addEventListener("input", () => this._editSegment(key, clamp(e[id].value, min, max, fallback) / 100));
      e.attackTrailGlowColor.addEventListener("input", () => this._editSegment("glowColor", e.attackTrailGlowColor.value));
      e.attackTrailGlowRadius.addEventListener("input", () => (
        this._editSegment("glowRadius", clamp(e.attackTrailGlowRadius.value, 0, 60, DEFAULT_GLOW_RADIUS))
      ));
      e.attackTrailTailFadeStart.addEventListener("input", () => this._editSegment("tailFadeStart", clamp(e.attackTrailTailFadeStart.value, 0, 95, 60) / 100));
      e.attackTrailHeadCurvature.addEventListener("input", () => this._editSegment("headCurvature", clamp(e.attackTrailHeadCurvature.value, -100, 100, 0) / 100));
      e.attackTrailAddStick.addEventListener("click", () => this._addStick());
      e.attackTrailDeleteStick.addEventListener("click", () => this._deleteStick());
      e.attackTrailHeadFrame.addEventListener("click", () => this._toggleStickHeadFrame());
      e.attackTrailFrameToggle.addEventListener("click", () => this._toggleFrameSlice());
      e.attackTrailSmooth.addEventListener("click", () => this._smoothSegment());
      e.attackTrailReverse.addEventListener("click", () => {
        const stick = this._stick();
        if (!stick) return;
        this.hooks.pushUndo("flip attack trail stick face");
        stick.reverseDirection = !stick.reverseDirection;
        stick.directionOffset = ((stick.directionOffset + 360) % 360) - 180;
        this._updateGenerated(this._segment());
        this.pathCache.clear(); this.hooks.markDirty(); this.render(); this.hooks.draw();
      });
    }

    _setWorkspaceMode(mode) {
      if (mode !== "draw" && mode !== "insert") return;
      this._stopFixedPreview();
      this.staticEditPreview = false;
      this.workspaceMode = mode;
      this.picking = false;
      this.drag = null;
      this.stickId = "";
      this.guidesVisible = mode === "draw";
      this.render();
      this.hooks.draw();
    }

    _startFixedPreview() {
      const segment = this._segment();
      if (!this.enabled || this.workspaceMode !== "draw" || !segment || segment.sticks.length < 2) return;
      this.hooks.stopPlayback?.();
      this.staticEditPreview = false;
      this.previewing = true;
      this.previewStartedAt = performance.now();
      const tick = () => {
        if (!this.previewing) return;
        const elapsed = performance.now() - this.previewStartedAt;
        if (elapsed >= DRAW_PREVIEW_DURATION_MS) {
          this._stopFixedPreview();
          return;
        }
        this.hooks.draw();
        this.previewRequest = requestAnimationFrame(tick);
      };
      this.previewRequest = requestAnimationFrame(tick);
      this._syncToolbar(true);
      this.hooks.draw();
    }

    _stopFixedPreview(redraw = true) {
      if (this.previewRequest) cancelAnimationFrame(this.previewRequest);
      this.previewRequest = 0;
      const changed = this.previewing;
      this.previewing = false;
      this.previewStartedAt = 0;
      if (changed) {
        this._syncToolbar(true);
        if (redraw) this.hooks.draw();
      }
    }

    _enterStaticEditPreview() {
      this.hooks.stopPlayback?.();
      this._stopFixedPreview(false);
      this.staticEditPreview = true;
    }

    _bindingKey() {
      const group = this.hooks.group();
      return group ? `${group.profileId}/${group.name}` : "";
    }

    _segments() {
      return this.data.bindings[this._bindingKey()] || [];
    }

    _presets() {
      return this.data.presets || [];
    }

    _displaySegments() {
      const segments = this._segments();
      const displayed = [
        ...segments.filter((segment) => segment.presetOnly !== true),
        ...segments.filter((segment) => segment.presetOnly === true),
        ...this._presets(),
      ];
      return displayed.length ? displayed : [this._presetSegment()].filter(Boolean);
    }

    _preferredSegment(segments = this._displaySegments()) {
      return preferredAttackTrailSegment(segments);
    }

    _presetSegment() {
      const key = this._bindingKey();
      if (!key) return null;
      const [profileId, animationId] = key.split("/");
      return this._normalizeSegment({
        id: PRESET_SEGMENT_ID,
        name: "默认拖尾预设",
        profileId,
        animationId,
        generated: false,
        presetOnly: true,
        texture: clone(this.data.presetTexture || DEFAULT_PRESET_TEXTURE),
      }, 0, key);
    }

    _isPresetSegment(segment) {
      return segment?.id === PRESET_SEGMENT_ID;
    }

    _materializePreset() {
      const preview = this._segment();
      if (!preview?.presetOnly) return preview;
      return this._trailFromSavedPreset(preview);
    }

    _beginPresetEdit(segment) {
      if (!segment?.presetOnly) return;
      const scope = this._presets().some((entry) => entry.id === segment.id) ? "presets" : "binding";
      const bindingKey = scope === "binding" ? this._bindingKey() : "";
      if (this.presetEditOriginal?.scope === scope
        && this.presetEditOriginal?.bindingKey === bindingKey
        && this.presetEditOriginal?.segmentId === segment.id) return;
      this._discardPresetEdit();
      this.presetEditOriginal = { scope, bindingKey, segmentId: segment.id, segment: clone(segment) };
    }

    _discardPresetEdit() {
      const draft = this.presetEditOriginal;
      if (!draft) return;
      const segments = draft.scope === "presets"
        ? this._presets()
        : (this.data.bindings[draft.bindingKey] || []);
      const index = segments.findIndex((segment) => segment.id === draft.segmentId);
      if (index >= 0) segments[index] = clone(draft.segment);
      this.presetEditOriginal = null;
      this.processed.clear();
      this.pathCache.clear();
    }

    _trailFromSavedPreset(source) {
      const key = this._bindingKey();
      const style = clone(source);
      this._discardPresetEdit();
      const [profileId, animationId] = key.split("/");
      const segment = this._normalizeSegment({
        ...style,
        id: randomId("trail"),
        name: style.name,
        profileId,
        animationId,
        generated: false,
        presetOnly: false,
        sticks: [],
      }, this._segments().length, key);
      (this.data.bindings[key] ||= []).push(segment);
      this.segmentId = segment.id;
      return segment;
    }

    _applyPresetToTrail(target, preset) {
      if (!target || target.presetOnly === true || !preset?.presetOnly) return false;
      this.hooks.pushUndo("apply attack trail preset");
      this._enterStaticEditPreview();
      applyAttackTrailPresetStyle(target, preset);
      this._updateGenerated(target);
      this.segmentId = target.id;
      if (!target.sticks.some((stick) => stick.id === this.stickId)) this.stickId = "";
      this.picking = false;
      this.processed.clear();
      this.pathCache.clear();
      this.hooks.markDirty();
      this.render();
      this.hooks.draw();
      this.hooks.status(`已应用预设“${preset.name}”；${target.sticks.length} 根棍子的轨迹保持不变。`);
      return true;
    }

    _segment() {
      const segment = this._segments().find((entry) => entry.id === this.segmentId);
      if (segment) return segment;
      const preset = this._presets().find((entry) => entry.id === this.segmentId);
      if (preset) return preset;
      return this.segmentId === PRESET_SEGMENT_ID && !this._segments().length ? this._presetSegment() : null;
    }

    _stick() {
      return this._segment()?.sticks.find((entry) => entry.id === this.stickId) || null;
    }

    _frameSticks(segment = this._segment()) {
      if (!segment) return [];
      const frame = this.hooks.selectedFrame();
      return segment.sticks.filter((stick) => stick.frame === frame);
    }

    _stickProgress(segment, stickIndex) {
      if (!segment || stickIndex < 0 || stickIndex >= segment.sticks.length) return 1;
      const state = this._pathState(segment);
      const time = state.timing.times[stickIndex] ?? state.timing.times.at(-1) ?? 0;
      return clamp(this._distanceAtTime(state, time) / Math.max(0.001, state.total), 0, 1, 1);
    }

    _frameSlice(segment = this._segment(), create = false) {
      if (!segment) return null;
      if (!segment.frameSlices && create) segment.frameSlices = {};
      if (!segment.frameSlices) return null;
      const key = String(this.hooks.selectedFrame());
      if (!segment.frameSlices[key] && create) {
        segment.frameSlices[key] = { enabled: true, tailProgress: 0, headProgress: 1 };
      }
      return segment.frameSlices[key] || null;
    }

    _toggleFrameSlice() {
      const segment = this._materializePreset();
      if (!segment || segment.sticks.length < 2) {
        this.hooks.status("请先用至少两根棍子绘制完整轨迹。");
        return;
      }
      this.hooks.pushUndo("toggle frame trail layer");
      const key = String(this.hooks.selectedFrame());
      if (segment.frameSlices?.[key]) {
        delete segment.frameSlices[key];
      } else {
        const slice = this._frameSlice(segment, true);
        slice.enabled = true;
        slice.tailProgress = 0;
        slice.headProgress = 1;
      }
      this.hooks.markDirty();
      this.render();
      this.hooks.draw();
    }

    _defaultPresetName() {
      const presets = [
        ...this._presets(),
        ...this._segments().filter((segment) => segment.presetOnly === true),
      ];
      const used = new Set(presets.map((segment) => String(segment.name || "").trim().toLocaleLowerCase()));
      let number = Math.max(1, presets.length + 1);
      while (used.has(`拖尾预设 ${number}`.toLocaleLowerCase())) number += 1;
      return `拖尾预设 ${number}`;
    }

    _openPresetDialog() {
      const segment = this._segment();
      if (!segment) return;
      const fallbackName = this._defaultPresetName();
      this.els.attackTrailPresetName.value = "";
      this.els.attackTrailPresetName.placeholder = `留空则使用“${fallbackName}”`;
      this.els.attackTrailPresetDialog.showModal();
      requestAnimationFrame(() => this.els.attackTrailPresetName.focus());
    }

    _savePreset(name) {
      const key = this._bindingKey();
      const source = this._segment();
      if (!key || !source) return;
      const sourceId = source.id;
      this.hooks.pushUndo("save attack trail preset");
      const style = clone(source);
      this._discardPresetEdit();
      const [profileId, animationId] = key.split("/");
      const presetName = String(name || "").trim().slice(0, 60) || this._defaultPresetName();
      const existingPreset = this._presets().find((entry) => (
        String(entry.name || "").trim().toLocaleLowerCase() === presetName.toLocaleLowerCase()
      ));
      const segment = this._normalizeSegment({
        ...style,
        id: existingPreset?.id || randomId("trail"),
        name: presetName,
        profileId,
        animationId,
        generated: false,
        presetOnly: true,
        sticks: [],
      }, this._segments().length, key);
      const saved = upsertAttackTrailPresetByName((this.data.presets ||= []), segment);
      const sourceTrail = this._segments().find((entry) => entry.id === sourceId && entry.presetOnly !== true);
      this.segmentId = sourceTrail?.id || segment.id;
      if (sourceTrail && !sourceTrail.sticks.some((stick) => stick.id === this.stickId)) this.stickId = "";
      this.hooks.markDirty(); this.render(); this.hooks.draw();
      this.hooks.status(`${saved.overwritten ? "已覆盖" : "已新建"}预设“${presetName}”${
        sourceTrail ? `；当前 ${sourceTrail.sticks.length} 根棍子的轨迹保持选中。` : "。"
      }`);
    }

    _deleteSegment() {
      const segment = this._segment();
      if (!segment || this._isPresetSegment(segment) || !window.confirm(`删除${segment.presetOnly ? "预设" : "拖尾段"}“${segment.name}”？`)) return;
      this.hooks.pushUndo("delete attack trail segment");
      this.presetEditOriginal = null;
      if (segment.presetOnly && this._presets().some((entry) => entry.id === segment.id)) {
        this.data.presets = this._presets().filter((entry) => entry.id !== segment.id);
      } else {
        this.data.bindings[this._bindingKey()] = this._segments().filter((entry) => entry.id !== segment.id);
      }
      this.segmentId = this._preferredSegment()?.id || "";
      this.stickId = this._segment()?.sticks[0]?.id || "";
      this.hooks.markDirty(); this.render(); this.hooks.draw();
    }

    _editSegment(key, value) {
      const segment = this._materializePreset();
      if (!segment) return;
      this._enterStaticEditPreview();
      this._beginPresetEdit(segment);
      segment[key] = value;
      this._updateGenerated(segment);
      if ([
        "totalDurationMs", "tailHeadSpeedRatio", "speedVariation", "stableSeed", "pathCacheSamples",
      ].includes(key)) this.pathCache.clear();
      if ([
        "invertTexture", "colorMode", "color", "gradientStops", "bodyOpacityFloor", "bodyDetailStrength", "bodyWhiteThreshold",
        "tailFadeStart", "coreEdge", "headLightBoost", "headWhitePreserve", "headWhiteLength",
      ].includes(key)) this.processed.clear();
      this.hooks.markDirty(); this.render(); this.hooks.draw();
    }

    _editMaterialLayer(layerId, key, value) {
      const segment = this._materializePreset();
      const material = segment?.materialLayers?.[layerId];
      if (!segment || !material) return;
      this._enterStaticEditPreview();
      this._beginPresetEdit(segment);
      material[key] = value;
      if (["color", "invert", "threshold", "softness", "expansion"].includes(key) || (layerId === "breakup" && key === "strength")) {
        this.processed.clear();
      }
      this.hooks.markDirty(); this.render(); this.hooks.draw();
    }

    _setColorMode(value) {
      const mode = normalizeColorMode(value);
      const wasPreset = this._isPresetSegment(this._segment());
      this.hooks.pushUndo("change attack trail color mode");
      const segment = this._materializePreset();
      if (!segment) return;
      this._enterStaticEditPreview();
      this._beginPresetEdit(segment);
      segment.colorMode = mode;
      if (mode === "gradient") {
        segment.gradientStops = normalizeGradientStops(segment.gradientStops, segment.color);
        this.gradientStopId = segment.gradientStops[0].id;
        if (wasPreset) segment.name = `渐变拖尾 ${this._segments().length}`;
      }
      this.picking = false;
      this._updateGenerated(segment);
      this.processed.clear();
      this.hooks.markDirty(); this.render(); this.hooks.draw();
    }

    _gradientStop(segment = this._segment()) {
      return segment?.gradientStops?.find((stop) => stop.id === this.gradientStopId) || null;
    }

    _gradientColorAt(stops, position) {
      const normalized = normalizeGradientStops(stops);
      const sample = clamp(position, 0, 1, 0);
      if (sample <= normalized[0].position) return colorChannels(normalized[0].color);
      for (let index = 1; index < normalized.length; index += 1) {
        const left = normalized[index - 1], right = normalized[index];
        if (sample > right.position) continue;
        const phase = clamp((sample - left.position) / Math.max(0.000001, right.position - left.position), 0, 1, 0);
        const a = colorChannels(left.color), b = colorChannels(right.color);
        return a.map((channel, channelIndex) => channel + (b[channelIndex] - channel) * phase);
      }
      return colorChannels(normalized.at(-1).color);
    }

    _gradientCss(stops) {
      return normalizeGradientStops(stops).map((stop) => `${stop.color} ${Math.round(stop.position * 1000) / 10}%`).join(", ");
    }

    _renderGradientEditor(segment) {
      const e = this.els;
      if (!segment || segment.colorMode !== "gradient") return;
      segment.gradientStops = normalizeGradientStops(segment.gradientStops, segment.color);
      if (!this._gradientStop(segment)) this.gradientStopId = segment.gradientStops[0].id;
      e.attackTrailGradientBar.style.background = `linear-gradient(to right, ${this._gradientCss(segment.gradientStops)})`;
      e.attackTrailGradientBar.innerHTML = segment.gradientStops.map((stop) => (
        `<button type="button" class="trailGradientStop${stop.id === this.gradientStopId ? " selected" : ""}" data-gradient-stop="${this._escape(stop.id)}" style="left:${stop.position * 100}%;background:${stop.color}" title="${Math.round(stop.position * 100)}% · ${stop.color}" aria-label="渐变节点 ${Math.round(stop.position * 100)}% ${stop.color}"></button>`
      )).join("");
      const selected = this._gradientStop(segment);
      e.attackTrailGradientColor.disabled = !selected;
      if (selected) {
        e.attackTrailGradientColor.value = selected.color;
        e.attackTrailGradientPosition.value = `${Math.round(selected.position * 100)}%`;
        e.attackTrailGradientPosition.textContent = `${Math.round(selected.position * 100)}%`;
      }
    }

    _gradientPosition(event) {
      const rect = this.els.attackTrailGradientBar.getBoundingClientRect();
      return clamp((event.clientX - rect.left) / Math.max(1, rect.width), 0, 1, 0);
    }

    _gradientPointerDown(event) {
      const segment = this._segment();
      if (!segment || segment.colorMode !== "gradient" || event.button !== 0) return;
      const stopButton = event.target.closest?.(".trailGradientStop");
      if (stopButton) {
        this.gradientStopId = stopButton.dataset.gradientStop;
        this.gradientDrag = { pointerId: event.pointerId, undoPushed: false };
      } else {
        if (segment.gradientStops.length >= 16) return this.hooks.status("渐变最多支持 16 个颜色节点。", true);
        this._enterStaticEditPreview();
        this._beginPresetEdit(segment);
        this.hooks.pushUndo("add attack trail gradient stop");
        const position = this._gradientPosition(event);
        const stop = { id: randomId("gradient"), position, color: channelsToColor(this._gradientColorAt(segment.gradientStops, position)) };
        segment.gradientStops.push(stop);
        segment.gradientStops.sort((a, b) => a.position - b.position);
        this.gradientStopId = stop.id;
        this.gradientDrag = { pointerId: event.pointerId, undoPushed: true };
        this.processed.clear(); this.hooks.markDirty(); this.hooks.draw();
      }
      this.els.attackTrailGradientBar.focus({ preventScroll: true });
      this.els.attackTrailGradientBar.setPointerCapture(event.pointerId);
      this._renderGradientEditor(segment);
      event.preventDefault();
    }

    _gradientPointerMove(event) {
      if (!this.gradientDrag || this.gradientDrag.pointerId !== event.pointerId) return;
      const segment = this._segment(), stop = this._gradientStop(segment);
      if (!segment || !stop) return;
      this._enterStaticEditPreview();
      const position = this._gradientPosition(event);
      if (Math.abs(position - stop.position) < 0.0001) return;
      if (!this.gradientDrag.undoPushed) {
        this.hooks.pushUndo("move attack trail gradient stop");
        this.gradientDrag.undoPushed = true;
      }
      this._beginPresetEdit(segment);
      stop.position = position;
      segment.gradientStops.sort((a, b) => a.position - b.position);
      this.processed.clear(); this.hooks.markDirty(); this._renderGradientEditor(segment); this.hooks.draw();
    }

    _gradientPointerUp(event) {
      if (!this.gradientDrag || this.gradientDrag.pointerId !== event.pointerId) return;
      this.gradientDrag = null;
      if (this.els.attackTrailGradientBar.hasPointerCapture(event.pointerId)) this.els.attackTrailGradientBar.releasePointerCapture(event.pointerId);
    }

    _setGradientStopColor(value) {
      const segment = this._segment();
      const stop = this._gradientStop(segment);
      if (!stop) return;
      this._enterStaticEditPreview();
      this._beginPresetEdit(segment);
      stop.color = normalizeColor(value, stop.color);
      this.processed.clear(); this.hooks.markDirty(); this._renderGradientEditor(this._segment()); this.hooks.draw();
    }

    _deleteGradientStop() {
      const segment = this._segment();
      const stop = this._gradientStop(segment);
      if (!segment || !stop) return;
      if (segment.gradientStops.length <= 2) return this.hooks.status("渐变至少保留两个颜色节点。", true);
      this._enterStaticEditPreview();
      this.hooks.pushUndo("delete attack trail gradient stop");
      this._beginPresetEdit(segment);
      const oldIndex = segment.gradientStops.indexOf(stop);
      segment.gradientStops = segment.gradientStops.filter((entry) => entry.id !== stop.id);
      this.gradientStopId = segment.gradientStops[Math.min(oldIndex, segment.gradientStops.length - 1)].id;
      this.processed.clear(); this.hooks.markDirty(); this.render(); this.hooks.draw();
    }

    _effectiveTotalDurationMs(segment) {
      const saved = Math.round(clamp(segment?.totalDurationMs, 0, 60000, 0));
      if (saved > 0) return saved;
      const frame = segment?.sticks?.[0]?.frame ?? this.hooks.selectedFrame();
      return Math.max(1, Math.round(clamp(this.hooks.frameDurationMs?.(frame), 1, 60000, 1000 / 12)));
    }

    _toggleStickLayer() {
      const stick = this._stick();
      if (!stick) return;
      this.hooks.pushUndo("toggle attack trail stick layer");
      this._editStick("layer", stick.layer === "front" ? "behind" : "front");
    }

    _addStick() {
      const selected = this._segment();
      if (!selected) return;
      this.hooks.pushUndo("add attack trail stick");
      let segment = this._materializePreset();
      if (!segment) return;
      if (segment.presetOnly && !this._isPresetSegment(selected)) segment = this._trailFromSavedPreset(segment);
      segment.presetOnly = false;
      const frame = this.hooks.selectedFrame();
      const firstLaterIndex = segment.sticks.findIndex((stick) => stick.frame > frame);
      const insertIndex = firstLaterIndex < 0 ? segment.sticks.length : firstLaterIndex;
      const previous = insertIndex > 0 ? segment.sticks[insertIndex - 1] : null;
      const next = insertIndex < segment.sticks.length ? segment.sticks[insertIndex] : null;
      let top = { x: -90, y: -120 };
      let bottom = { x: 90, y: 120 };
      if (previous && next && previous.frame < frame && next.frame > frame) {
        const phase = clamp((frame - previous.frame) / Math.max(1, next.frame - previous.frame), 0, 1, 0.5);
        top = { x: previous.top.x + (next.top.x - previous.top.x) * phase, y: previous.top.y + (next.top.y - previous.top.y) * phase };
        bottom = { x: previous.bottom.x + (next.bottom.x - previous.bottom.x) * phase, y: previous.bottom.y + (next.bottom.y - previous.bottom.y) * phase };
      } else if (previous) {
        top = { x: previous.top.x + 24, y: previous.top.y };
        bottom = { x: previous.bottom.x + 24, y: previous.bottom.y };
      } else if (next) {
        top = { x: next.top.x - 24, y: next.top.y };
        bottom = { x: next.bottom.x - 24, y: next.bottom.y };
      }
      const stick = this._normalizeStick({
        id: randomId("stick"), frame, phaseMode: "auto", headFrame: true, headFrameMode: "auto",
        top, bottom,
        layer: previous?.layer || next?.layer || segment.layer,
        reverseDirection: previous?.reverseDirection ?? next?.reverseDirection ?? false,
        directionOffset: previous?.directionOffset ?? next?.directionOffset ?? 0,
        tangentStrength: previous?.tangentStrength ?? next?.tangentStrength ?? 0.8,
      }, insertIndex);
      segment.sticks.splice(insertIndex, 0, stick);
      if (segment.sticks.length === 1 && !(Number(segment.totalDurationMs) > 0)) {
        segment.totalDurationMs = this._effectiveTotalDurationMs(segment);
      }
      this._renumberAndAutoPhase(segment);
      this._updateGenerated(segment);
      this.stickId = stick.id;
      this.guidesVisible = true;
      this._syncGuideToggle(true);
      this.pathCache.clear(); this.hooks.markDirty(); this.render(); this.hooks.draw();
    }

    _deleteStick() {
      const segment = this._segment();
      const stick = this._stick();
      if (!segment || !stick) return;
      this.hooks.pushUndo("delete attack trail stick");
      segment.sticks = segment.sticks.filter((entry) => entry.id !== stick.id);
      this._renumberAndAutoPhase(segment);
      this._updateGenerated(segment);
      this.stickId = "";
      this.pathCache.clear(); this.hooks.markDirty(); this.render(); this.hooks.draw();
    }

    _toggleStickHeadFrame() {
      const segment = this._segment();
      const stick = this._stick();
      if (!segment || !stick) return;
      const index = segment.sticks.findIndex((entry) => entry.id === stick.id);
      if (index < 0 || index >= segment.sticks.length - 1) return;
      this.hooks.pushUndo("toggle attack trail head frame");
      stick.headFrame = stick.headFrame === false;
      stick.headFrameMode = "manual";
      this._renumberAndAutoPhase(segment);
      this._updateGenerated(segment);
      this.pathCache.clear(); this.hooks.markDirty(); this.render(); this.hooks.draw();
    }

    _smoothSegment() {
      const segment = this._segment();
      if (!segment || segment.presetOnly || segment.sticks.length < 3) {
        this.hooks.status("至少需要三根棍子才能平滑整段轨迹。");
        return;
      }
      this.hooks.pushUndo("smooth attack trail");
      segment.sticks = smoothTrailSticks(segment.sticks);
      this._updateGenerated(segment);
      this.pathCache.clear();
      this.hooks.markDirty();
      this.render();
      this.hooks.draw();
      this.hooks.status(`已平滑 ${segment.sticks.length} 根棍子：端点中心保持不动，中间路径、方向和棍长已自动连续化。`);
    }

    _editStick(key, value, manualPhase = false) {
      const stick = this._stick();
      if (!stick) return;
      stick[key] = value;
      if (manualPhase) stick.phaseMode = "manual";
      this._updateGenerated(this._segment());
      this.pathCache.clear(); this.hooks.markDirty(); this.render(); this.hooks.draw();
    }

    _renumberAndAutoPhase(segment) {
      segment.sticks.forEach((stick, index) => { stick.order = index; });
      if (segment.sticks.length) {
        segment.sticks.forEach((stick, index) => {
          if (stick.headFrameMode === "auto") stick.headFrame = index === segment.sticks.length - 1;
        });
        segment.sticks.at(-1).headFrame = true;
      }
      const frames = new Map();
      for (const stick of segment.sticks) {
        if (stick.headFrame === false) continue;
        (frames.get(stick.frame) || frames.set(stick.frame, []).get(stick.frame)).push(stick);
      }
      for (const sticks of frames.values()) {
        let index = 0;
        while (index < sticks.length) {
          if (sticks[index].phaseMode === "manual") { index += 1; continue; }
          const start = index;
          while (index < sticks.length && sticks[index].phaseMode !== "manual") index += 1;
          const lower = start > 0 ? sticks[start - 1].framePhase : 0;
          const upper = index < sticks.length ? sticks[index].framePhase : 1;
          const count = index - start;
          for (let offset = 0; offset < count; offset += 1) {
            sticks[start + offset].framePhase = lower + (upper - lower) * (offset + 1) / (count + 1);
          }
        }
        let previous = -0.0001;
        sticks.forEach((stick, stickIndex) => {
          const maximum = 1 - (sticks.length - 1 - stickIndex) * 0.0001;
          stick.framePhase = clamp(stick.framePhase, previous + 0.0001, maximum, (stickIndex + 1) / (sticks.length + 1));
          previous = stick.framePhase;
        });
      }
    }

    async _uploadTexture(file) {
      if (!file || !this._segment()) return;
      if (file.type !== "image/png" && !file.name.toLowerCase().endsWith(".png")) {
        this.hooks.status("攻击拖尾纹理目前仅支持 PNG。", true); return;
      }
      try {
        const data = await this._readDataUrl(file);
        const response = await fetch("/api/attack-trail-texture", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ projectId: this.hooks.projectId(), profileId: this.hooks.group().profileId, animationId: this.hooks.group().name, name: file.name, data }),
        });
        if (!response.ok) throw new Error(await response.text());
        const result = await response.json();
        this.hooks.pushUndo("import attack trail texture");
        const segment = this._materializePreset();
        this._enterStaticEditPreview();
        this._beginPresetEdit(segment);
        segment.texture = result.texture;
        this._updateGenerated(segment);
        this.images.delete(result.texture.path);
        this.processed.clear();
        this.hooks.markDirty(); this.render(); this.hooks.draw();
        this.hooks.status(`拖尾纹理已复制到稳定项目路径：${result.texture.path}`);
      } catch (error) {
        this.hooks.status(`拖尾纹理导入失败：${error.message}`, true);
      } finally {
        this.els.attackTrailTextureFile.value = "";
      }
    }

    async _uploadMaterialLayerTexture(layerId, file, uiPrefix) {
      if (!file || !this._segment()) return;
      if (file.type !== "image/png" && !file.name.toLowerCase().endsWith(".png")) {
        this.hooks.status("材质图层目前仅支持 PNG。", true);
        return;
      }
      try {
        const data = await this._readDataUrl(file);
        const response = await fetch("/api/attack-trail-texture", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            projectId: this.hooks.projectId(),
            profileId: this.hooks.group().profileId,
            animationId: this.hooks.group().name,
            name: file.name,
            data,
          }),
        });
        if (!response.ok) throw new Error(await response.text());
        const result = await response.json();
        this.hooks.pushUndo(`import ${layerId} attack trail texture`);
        const segment = this._materializePreset();
        this._enterStaticEditPreview();
        this._beginPresetEdit(segment);
        segment.materialLayers[layerId].texture = result.texture;
        this.images.delete(result.texture.path);
        this.processed.clear();
        this.hooks.markDirty(); this.render(); this.hooks.draw();
        this.hooks.status(`材质图层已替换为独立 PNG：${result.texture.path}`);
      } catch (error) {
        this.hooks.status(`材质图层导入失败：${error.message}`, true);
      } finally {
        if (uiPrefix && this.els[`attackTrail${uiPrefix}File`]) {
          this.els[`attackTrail${uiPrefix}File`].value = "";
        }
      }
    }

    _updateGenerated(segment) {
      if (!segment) return false;
      const validTexture = Boolean(segment.texture?.path)
        && (segment.colorMode !== "original" || segment.texture.hasEffectiveAlpha === true);
      segment.generated = segment.presetOnly !== true && validTexture && segment.sticks.length >= 2;
      return segment.generated;
    }

    _pickColor(event) {
      const image = this.hooks.currentImage();
      if (!image) return;
      const local = this.hooks.screenToLocal(this.hooks.stagePoint(event));
      const x = Math.floor(local.x + image.width / 2);
      const y = Math.floor(local.y + image.height / 2);
      if (x < 0 || y < 0 || x >= image.width || y >= image.height) return this.hooks.status("请在角色 Sprite 的有效像素上取色。", true);
      const canvas = document.createElement("canvas"); canvas.width = image.width; canvas.height = image.height;
      const context = canvas.getContext("2d", { willReadFrequently: true }); context.drawImage(image, 0, 0);
      const rgba = context.getImageData(x, y, 1, 1).data;
      if (rgba[3] < 8) return this.hooks.status("透明像素不接受取色；请点击角色的有效 Sprite 像素。", true);
      const color = `#${[rgba[0], rgba[1], rgba[2]].map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
      const segment = this._materializePreset();
      this._enterStaticEditPreview();
      this._beginPresetEdit(segment);
      segment.color = color;
      segment.colorMode = "solid";
      this.picking = false;
      this.processed.clear(); this.hooks.markDirty(); this.render(); this.hooks.draw();
      this.hooks.status(`已从角色源图像素取色：${color}`);
    }

    _timing(segment) {
      const sticks = segment.sticks;
      const headIndices = this._usesFrameSlicesOnly()
        ? sticks.map((_, index) => index)
        : sticks.map((stick, index) => (stick.headFrame === false ? -1 : index)).filter((index) => index >= 0);
      if (sticks.length && headIndices[0] !== 0) headIndices.unshift(0);
      if (sticks.length > 1 && headIndices.at(-1) !== sticks.length - 1) headIndices.push(sticks.length - 1);
      const headAbsolute = headIndices.map((index) => this.hooks.frameArrival(sticks[index].frame, sticks[index].framePhase));
      for (let index = 1; index < headAbsolute.length; index += 1) {
        headAbsolute[index] = Math.max(headAbsolute[index], headAbsolute[index - 1] + 0.0001);
      }
      const authoredOrigin = headAbsolute[0] || 0;
      const origin = attackTrailLifecycleOrigin(sticks, this.hooks.frameArrival);
      const totalDuration = this._effectiveTotalDurationMs(segment) / 1000;
      const speedRatio = clamp(segment.tailHeadSpeedRatio, 0.01, 0.9, DEFAULT_TAIL_HEAD_SPEED_RATIO);
      const motionDuration = Math.max(0.000001, totalDuration * speedRatio / (1 + speedRatio));
      const tailDuration = Math.max(0.000001, totalDuration - motionDuration);
      const authoredSpan = Math.max(0.0001, (headAbsolute.at(-1) || authoredOrigin) - authoredOrigin);
      const headLocal = headAbsolute.map((time, index) => {
        if (headAbsolute.length <= 1) return 0;
        if (index === headAbsolute.length - 1) return motionDuration;
        return motionDuration * clamp((time - authoredOrigin) / authoredSpan, 0, 1, 0);
      });
      const times = new Array(sticks.length).fill(headLocal[0] || 0);
      for (let headIndex = 0; headIndex < headIndices.length - 1; headIndex += 1) {
        const startIndex = headIndices[headIndex];
        const endIndex = headIndices[headIndex + 1];
        const startTime = headLocal[headIndex];
        const endTime = headLocal[headIndex + 1];
        for (let index = startIndex; index <= endIndex; index += 1) {
          times[index] = startTime + (endTime - startTime) * (index - startIndex) / Math.max(1, endIndex - startIndex);
        }
      }
      return {
        absolute: times.map((time) => origin + time),
        times,
        headIndices,
        origin,
        motionDuration,
        tailDuration,
        totalDuration,
      };
    }

    _headPathTime(segment, timing, localTime) {
      let pathTime = timing.times[timing.headIndices[0] || 0] || 0;
      for (const index of timing.headIndices) {
        if (timing.times[index] > localTime + 0.000001) break;
        pathTime = timing.times[index];
      }
      return pathTime;
    }

    _selectedGuidePreviewPathTime(segment, timing) {
      if (this.hooks.selectedGuidePreviewActive?.() !== true || segment.id !== this.segmentId) return null;
      const stick = this._stick();
      if (!stick || (!this._usesFrameSlicesOnly() && stick.headFrame !== false) || stick.frame !== this.hooks.selectedFrame()) return null;
      const index = segment.sticks.findIndex((entry) => entry.id === stick.id);
      return index >= 0 ? timing.times[index] : null;
    }

    _pathState(segment) {
      const timing = this._timing(segment);
      const signature = JSON.stringify([segment.sticks, timing.absolute, segment.tailSamples, segment.stableSeed, segment.speedVariation]);
      const cached = this.pathCache.get(segment.id);
      if (cached?.signature === signature) return cached;
      const count = Math.max(32, Math.min(256, segment.pathCacheSamples || 192));
      const duration = timing.times.at(-1) || 0.0001;
      const samples = [];
      let distance = 0;
      let previous = this._pose(segment.sticks, timing.times, 0);
      for (let index = 0; index < count; index += 1) {
        const time = duration * index / (count - 1);
        const pose = this._pose(segment.sticks, timing.times, time);
        if (index) distance += Math.hypot(pose.center.x - previous.center.x, pose.center.y - previous.center.y);
        samples.push({ time, distance, pose }); previous = pose;
      }
      let seed = (segment.stableSeed || 73129) >>> 0;
      const random = () => { seed = (1664525 * seed + 1013904223) >>> 0; return seed / 4294967296; };
      const speeds = [];
      const variation = segment.speedVariation ?? 0.008;
      for (let index = 0; index < segment.tailSamples; index += 1) speeds.push(SPEED_PROFILE[index] + (random() * 2 - 1) * variation);
      const mean = speeds.reduce((sum, value) => sum + value, 0) / speeds.length;
      const state = { signature, timing, samples, total: Math.max(0.001, distance), speeds: speeds.map((value) => value / mean) };
      this.pathCache.set(segment.id, state);
      return state;
    }

    _pose(sticks, times, time) {
      if (!sticks.length) return { top: { x: 0, y: -1 }, bottom: { x: 0, y: 1 }, center: { x: 0, y: 0 } };
      if (sticks.length === 1 || time <= times[0]) return this._stickPose(sticks[0]);
      if (time >= times.at(-1)) return this._stickPose(sticks.at(-1));
      let index = 0;
      while (index + 1 < times.length && time > times[index + 1]) index += 1;
      const a = sticks[index], b = sticks[index + 1], pa = this._stickPose(a), pb = this._stickPose(b);
      const t = clamp((time - times[index]) / Math.max(0.0001, times[index + 1] - times[index]), 0, 1, 0);
      const da = this._direction(a), db = this._direction(b);
      const topDistance = Math.hypot(pb.top.x - pa.top.x, pb.top.y - pa.top.y);
      const bottomDistance = Math.hypot(pb.bottom.x - pa.bottom.x, pb.bottom.y - pa.bottom.y);
      const top = this._hermite(
        pa.top,
        { x: da.x * topDistance * a.tangentStrength, y: da.y * topDistance * a.tangentStrength },
        pb.top,
        { x: db.x * topDistance * b.tangentStrength, y: db.y * topDistance * b.tangentStrength },
        t,
      );
      const bottom = this._hermite(
        pa.bottom,
        { x: da.x * bottomDistance * a.tangentStrength, y: da.y * bottomDistance * a.tangentStrength },
        pb.bottom,
        { x: db.x * bottomDistance * b.tangentStrength, y: db.y * bottomDistance * b.tangentStrength },
        t,
      );
      return { top, bottom, center: { x: (top.x + bottom.x) / 2, y: (top.y + bottom.y) / 2 } };
    }

    _widthPose(pose, segment) {
      const dx = pose.bottom.x - pose.top.x;
      const dy = pose.bottom.y - pose.top.y;
      const authoredWidth = Math.max(0.001, Math.hypot(dx, dy));
      const axis = { x: dx / authoredWidth, y: dy / authoredWidth };
      const baseWidth = segment.widthMode === "fixed" ? segment.fixedWidth : authoredWidth;
      const width = Math.max(0.001, baseWidth * segment.widthScale);
      const center = {
        x: pose.center.x + axis.x * width * 0.5 * segment.widthOffset,
        y: pose.center.y + axis.y * width * 0.5 * segment.widthOffset,
      };
      return {
        center,
        top: { x: center.x - axis.x * width * 0.5, y: center.y - axis.y * width * 0.5 },
        bottom: { x: center.x + axis.x * width * 0.5, y: center.y + axis.y * width * 0.5 },
      };
    }

    _pathPivot(sticks) {
      if (!sticks.length) return { x: 0, y: 0 };
      const total = sticks.reduce((sum, stick) => {
        const center = this._stickPose(stick).center;
        return { x: sum.x + center.x, y: sum.y + center.y };
      }, { x: 0, y: 0 });
      return { x: total.x / sticks.length, y: total.y / sticks.length };
    }

    _pathScalePose(pose, segment, pivot) {
      const transform = (point) => ({
        x: pivot.x + (point.x - pivot.x) * segment.pathScaleX,
        y: pivot.y + (point.y - pivot.y) * segment.pathScaleY,
      });
      return {
        top: transform(pose.top),
        bottom: transform(pose.bottom),
        center: transform(pose.center),
      };
    }

    _stickPose(stick) {
      const top = stick.reverseDirection ? stick.bottom : stick.top;
      const bottom = stick.reverseDirection ? stick.top : stick.bottom;
      return { top, bottom, center: { x: (top.x + bottom.x) / 2, y: (top.y + bottom.y) / 2 } };
    }
    _direction(stick) {
      const base = this._baseDirection(stick);
      const radians = clamp(stick.directionOffset, -180, 180, 0) * Math.PI / 180;
      return { x: base.x * Math.cos(radians) - base.y * Math.sin(radians), y: base.x * Math.sin(radians) + base.y * Math.cos(radians) };
    }
    _baseDirection(stick) {
      const pose = this._stickPose(stick);
      const dx = pose.bottom.x - pose.top.x, dy = pose.bottom.y - pose.top.y, length = Math.max(0.001, Math.hypot(dx, dy));
      return { x: -dy / length, y: dx / length };
    }
    _directionAtTime(sticks, times, time) {
      if (!sticks.length) return { x: 1, y: 0 };
      if (sticks.length === 1 || time <= times[0]) return this._direction(sticks[0]);
      if (time >= times.at(-1)) return this._direction(sticks.at(-1));
      let index = 0;
      while (index + 1 < times.length && time > times[index + 1]) index += 1;
      const phase = clamp((time - times[index]) / Math.max(0.0001, times[index + 1] - times[index]), 0, 1, 0);
      const a = this._direction(sticks[index]), b = this._direction(sticks[index + 1]);
      const x = a.x + (b.x - a.x) * phase, y = a.y + (b.y - a.y) * phase;
      const length = Math.max(0.001, Math.hypot(x, y));
      return { x: x / length, y: y / length };
    }
    _directionHandleScreen(stick) {
      const pose = this._stickPose(stick);
      const center = this.hooks.localToScreen(pose.center);
      const direction = this._direction(stick);
      const sample = this.hooks.localToScreen({ x: pose.center.x + direction.x, y: pose.center.y + direction.y });
      const dx = sample.x - center.x, dy = sample.y - center.y, length = Math.max(0.001, Math.hypot(dx, dy));
      const screenDirection = { x: dx / length, y: dy / length };
      const strength = clamp(
        stick.tangentStrength,
        DIRECTION_HANDLE_MIN_STRENGTH,
        DIRECTION_HANDLE_MAX_STRENGTH,
        0.8,
      );
      const arrowLength = strength * DIRECTION_HANDLE_UNIT_PX * this.hooks.dpr();
      return { center, direction: screenDirection, arrow: { x: center.x + screenDirection.x * arrowLength, y: center.y + screenDirection.y * arrowLength } };
    }
    _layerAtTime(sticks, times, time, fallback = "behind") {
      if (!sticks.length) return fallback;
      if (sticks.length === 1 || time <= times[0]) return sticks[0].layer || fallback;
      if (time >= times.at(-1)) return sticks.at(-1).layer || fallback;
      let index = 0;
      while (index + 1 < times.length && time > times[index + 1]) index += 1;
      const span = Math.max(0.0001, times[index + 1] - times[index]);
      const phase = clamp((time - times[index]) / span, 0, 1, 0);
      return phase < 0.5 ? (sticks[index].layer || fallback) : (sticks[index + 1].layer || fallback);
    }
    _triangleTouchesLayer(sticks, times, triangleTimes, fallback, layer) {
      // A transition triangle belongs to both render passes. This one-cell
      // overlap closes the antialias/occlusion seam without pulling the rest
      // of the behind trail in front of the character.
      return triangleTimes.some((time) => this._layerAtTime(sticks, times, time, fallback) === layer);
    }
    _hermite(a, ta, b, tb, t) {
      const t2 = t * t, t3 = t2 * t, h00 = 2 * t3 - 3 * t2 + 1, h10 = t3 - 2 * t2 + t, h01 = -2 * t3 + 3 * t2, h11 = t3 - t2;
      return { x: h00 * a.x + h10 * ta.x + h01 * b.x + h11 * tb.x, y: h00 * a.y + h10 * ta.y + h01 * b.y + h11 * tb.y };
    }

    _distanceAtTime(state, time) { return this._interpolateSamples(state.samples, "time", "distance", time); }
    _timeAtDistance(state, distance) { return this._interpolateSamples(state.samples, "distance", "time", distance); }
    _interpolateSamples(samples, key, valueKey, target) {
      target = clamp(target, samples[0][key], samples.at(-1)[key], samples[0][key]);
      let low = 0, high = samples.length - 1;
      while (low + 1 < high) { const middle = (low + high) >> 1; if (samples[middle][key] <= target) low = middle; else high = middle; }
      const span = samples[high][key] - samples[low][key]; const f = span <= 1e-8 ? 0 : (target - samples[low][key]) / span;
      return samples[low][valueKey] + (samples[high][valueKey] - samples[low][valueKey]) * f;
    }

    _drawSegment(segment, alpha, layer, frameSlice = null, fixedPreviewElapsed = null) {
      const image = this.images.get(segment.texture.path);
      if (!image) {
        this.hooks.loadTexture(segment.texture).then((loaded) => { this.images.set(segment.texture.path, loaded); this.hooks.draw(); }).catch(() => {});
        return;
      }
      const state = this._pathState(segment);
      let currentPathTime, currentDistance, collapsePhase, tails;
      if (Number.isFinite(fixedPreviewElapsed)) {
        const totalDuration = DRAW_PREVIEW_DURATION_MS / 1000;
        if (fixedPreviewElapsed < 0 || fixedPreviewElapsed >= totalDuration) return;
        const ratio = DRAW_PREVIEW_TAIL_HEAD_SPEED_RATIO;
        const headDuration = totalDuration * ratio / (1 + ratio);
        const tailDuration = totalDuration - headDuration;
        const headProgress = clamp(fixedPreviewElapsed / Math.max(0.000001, headDuration), 0, 1, 0);
        currentDistance = state.total * headProgress;
        currentPathTime = this._timeAtDistance(state, currentDistance);
        const tailProgress = clamp((fixedPreviewElapsed - headDuration) / Math.max(0.000001, tailDuration), 0, 1, 0);
        collapsePhase = tailProgress;
        tails = this._tailDistances(state, currentDistance, tailProgress);
      } else if (frameSlice) {
        const tailProgress = clamp(frameSlice.tailProgress, 0, 1, 0);
        const headProgress = clamp(frameSlice.headProgress, tailProgress, 1, 1);
        currentDistance = state.total * headProgress;
        currentPathTime = this._timeAtDistance(state, currentDistance);
        collapsePhase = 0;
        tails = new Array(Math.max(4, segment.tailSamples || 5)).fill(state.total * tailProgress);
        if (currentDistance - state.total * tailProgress <= 0.01) return;
      } else {
        const local = this.hooks.animationElapsed() - state.timing.absolute[0];
        const duration = state.timing.motionDuration;
        const totalDuration = state.timing.totalDuration;
        if (local < 0 || local >= totalDuration) return;
        const motionTime = Math.min(local, duration);
        const selectedGuidePathTime = this._selectedGuidePreviewPathTime(segment, state.timing);
        currentPathTime = Number.isFinite(selectedGuidePathTime)
          ? selectedGuidePathTime
          : this._headPathTime(segment, state.timing, motionTime);
        currentDistance = this._distanceAtTime(state, currentPathTime);
        const tailProgress = clamp((local - duration) / Math.max(0.000001, state.timing.tailDuration), 0, 1, 0);
        collapsePhase = tailProgress;
        tails = this._tailDistances(state, currentDistance, tailProgress);
      }
      // A fully collapsed trail is only the mesh's zero-area cross-section.
      // Do not expose that implementation detail as a visible line at either
      // the beginning or the end of the effect.
      if (currentDistance <= 0.01) return;
      const columns = Math.min(192, Math.max(16, Math.round(segment.pathColumns) * 2));
      // Tail speed samples describe lag only. They are deliberately not the
      // visible cross-section tessellation: five mesh rows turn a curved head
      // into a diamond-shaped point.
      const rows = Math.max(TRAIL_MESH_WIDTH_ROWS, tails.length);
      const pathPivot = this._pathPivot(segment.sticks);
      const currentPose = this._widthPose(
        this._pathScalePose(
          this._pose(segment.sticks, state.timing.times, currentPathTime),
          segment,
          pathPivot,
        ),
        segment,
      );
      const rawHeadDirection = this._directionAtTime(segment.sticks, state.timing.times, currentPathTime);
      const scaledHeadDirection = {
        x: rawHeadDirection.x * segment.pathScaleX,
        y: rawHeadDirection.y * segment.pathScaleY,
      };
      const scaledHeadLength = Math.max(0.001, Math.hypot(scaledHeadDirection.x, scaledHeadDirection.y));
      const headDirection = {
        x: scaledHeadDirection.x / scaledHeadLength,
        y: scaledHeadDirection.y / scaledHeadLength,
      };
      const headHalfWidth = Math.hypot(currentPose.bottom.x - currentPose.top.x, currentPose.bottom.y - currentPose.top.y) * 0.5;
      // Preserve the complete brush in the terminal cap. Its depth must keep
      // the curved hard head from folding through the authored rough tail.
      const terminalCapDepth = Math.max(
        2,
        headHalfWidth * (Math.abs(segment.headCurvature) + FINAL_HEAD_CAP_MARGIN_RATIO),
      ) * (1 - collapsePhase);
      const terminalCapBlend = this._terminalHeadCapBlend(
        currentDistance,
        tails,
        terminalCapDepth,
        collapsePhase,
      );
      const grid = [], gridTimes = [];
      const centerTailDistance = this._meshTailDistance(tails, 0.5);
      for (let row = 0; row < rows; row += 1) {
        const v = row / (rows - 1);
        const authoredTailDistance = this._meshTailDistance(tails, v);
        const rowTailDistance = centerTailDistance
          + (authoredTailDistance - centerTailDistance) * segment.widthChaseStrength;
        const line = [], lineTimes = [];
        for (let column = 0; column < columns; column += 1) {
          const u = column / (columns - 1); let localPoint, sampleTime;
          const distance = currentDistance + (rowTailDistance - currentDistance) * u;
          sampleTime = this._timeAtDistance(state, distance);
          const pose = this._widthPose(
            this._pathScalePose(
              this._pose(segment.sticks, state.timing.times, sampleTime),
              segment,
              pathPivot,
            ),
            segment,
          );
          localPoint = { x: pose.top.x + (pose.bottom.x - pose.top.x) * v, y: pose.top.y + (pose.bottom.y - pose.top.y) * v };
          const headProfile = this._headCurveProfile(v) * this._headCurveBlend(u);
          const bulge = segment.headCurvature * headHalfWidth * headProfile;
          localPoint.x -= headDirection.x * bulge;
          localPoint.y -= headDirection.y * bulge;
          if (terminalCapBlend > 0) {
            const capBase = {
              x: currentPose.top.x + (currentPose.bottom.x - currentPose.top.x) * v,
              y: currentPose.top.y + (currentPose.bottom.y - currentPose.top.y) * v,
            };
            const capOffset = bulge + terminalCapDepth * u;
            const capPoint = {
              x: capBase.x - headDirection.x * capOffset,
              y: capBase.y - headDirection.y * capOffset,
            };
            localPoint.x += (capPoint.x - localPoint.x) * terminalCapBlend;
            localPoint.y += (capPoint.y - localPoint.y) * terminalCapBlend;
            if (terminalCapBlend >= 0.5) sampleTime = currentPathTime;
          }
          line.push(this.hooks.localToScreen(localPoint));
          lineTimes.push(sampleTime);
        }
        grid.push(line);
        gridTimes.push(lineTimes);
      }
      const materialImages = {};
      for (const [layerId, material] of Object.entries(segment.materialLayers || {})) {
        if (material?.enabled === false || !material?.texture?.path) continue;
        const materialImage = this.images.get(material.texture.path);
        if (!materialImage) {
          this.hooks.loadTexture(material.texture).then((loaded) => {
            this.images.set(material.texture.path, loaded);
            this.hooks.draw();
          }).catch(() => {});
          continue;
        }
        materialImages[layerId] = materialImage;
      }
      const breakupMask = segment.materialLayers?.breakup;
      const bodyTexture = this._processedBodyTexture(
        image,
        segment,
        breakupMask?.enabled !== false ? materialImages.breakup : null,
        breakupMask,
      );
      const materialTextures = {};
      for (const layerId of ["streaks", "core"]) {
        const material = segment.materialLayers?.[layerId];
        const materialImage = materialImages[layerId];
        if (!material || !materialImage) continue;
        materialTextures[layerId] = this._processedMaterialLayerTexture(materialImage, material, segment, layerId, image);
      }
      const ctx = this.hooks.ctx;
      if (this.gpuRenderer && !this.gpuRenderer.gl.isContextLost()) {
        const compositeGpuSurface = (surface, compositeOperation, passAlpha, filter = "none") => {
          ctx.save();
          ctx.globalCompositeOperation = compositeOperation;
          ctx.globalAlpha = clamp(passAlpha, 0, 1, 0);
          ctx.filter = filter;
          ctx.drawImage(surface, 0, 0);
          ctx.restore();
          return true;
        };
        const renderGpuTexture = (texture) => (
          this._drawGpuMesh(texture, grid, gridTimes, segment, state, layer, ctx.canvas.width, ctx.canvas.height)
        );
        let rendered = false;
        const coreMaterial = segment.materialLayers?.core;
        let coreSurface = null;
        let glowSurface = null;
        if (materialTextures.core && coreMaterial?.enabled !== false && renderGpuTexture(materialTextures.core)) {
          if (this.gpuCoreCanvas.width !== this.gpuCanvas.width || this.gpuCoreCanvas.height !== this.gpuCanvas.height) {
            this.gpuCoreCanvas.width = this.gpuCanvas.width;
            this.gpuCoreCanvas.height = this.gpuCanvas.height;
            this.gpuGlowCanvas.width = this.gpuCanvas.width;
            this.gpuGlowCanvas.height = this.gpuCanvas.height;
          }
          this.gpuCoreContext.setTransform(1, 0, 0, 1, 0, 0);
          this.gpuCoreContext.globalCompositeOperation = "copy";
          this.gpuCoreContext.drawImage(this.gpuCanvas, 0, 0);
          coreSurface = this.gpuCoreCanvas;
          this.gpuGlowContext.setTransform(1, 0, 0, 1, 0, 0);
          this.gpuGlowContext.globalCompositeOperation = "copy";
          this.gpuGlowContext.drawImage(coreSurface, 0, 0);
          this.gpuGlowContext.globalCompositeOperation = "lighter";
          this.gpuGlowContext.drawImage(coreSurface, 0, 0);
          this.gpuGlowContext.globalCompositeOperation = "source-in";
          this.gpuGlowContext.fillStyle = segment.glowColor;
          this.gpuGlowContext.fillRect(0, 0, this.gpuGlowCanvas.width, this.gpuGlowCanvas.height);
          this.gpuGlowContext.globalCompositeOperation = "source-over";
          glowSurface = this.gpuGlowCanvas;
        }
        if (renderGpuTexture(bodyTexture)) {
          rendered = compositeGpuSurface(this.gpuCanvas, "source-over", alpha) || rendered;
        }
        const streaks = segment.materialLayers?.streaks;
        if (materialTextures.streaks && streaks?.enabled !== false && streaks.strength > 0
          && renderGpuTexture(materialTextures.streaks)) {
          rendered = compositeGpuSurface(
            this.gpuCanvas,
            this._blendCompositeOperation(streaks.blendMode),
            alpha * streaks.strength,
          ) || rendered;
        }
        // The blurred fluorescent halo and the sharp bright edge are separate
        // controls even though they share the same authored contour texture.
        if (coreSurface && glowSurface && coreMaterial?.enabled !== false) {
          if (segment.glowStrength > 0 && segment.glowRadius > 0) {
            const glowRadius = segment.glowRadius * this.hooks.dpr();
            rendered = compositeGpuSurface(
              glowSurface,
              "lighter",
              alpha * segment.glowStrength * 0.6,
              `blur(${glowRadius}px)`,
            ) || rendered;
            rendered = compositeGpuSurface(
              glowSurface,
              "lighter",
              alpha * segment.glowStrength * 0.95,
              `blur(${Math.max(1, glowRadius * 0.42)}px)`,
            ) || rendered;
          }
          if (coreMaterial.strength > 0) {
            rendered = compositeGpuSurface(
              coreSurface,
              this._blendCompositeOperation(coreMaterial.blendMode),
              alpha * coreMaterial.strength,
            ) || rendered;
          }
        }
        if (rendered) return;
      }
      const texture = bodyTexture;
      if (this.meshCanvas.width !== ctx.canvas.width || this.meshCanvas.height !== ctx.canvas.height) {
        this.meshCanvas.width = ctx.canvas.width;
        this.meshCanvas.height = ctx.canvas.height;
        this.meshMaskCanvas.width = ctx.canvas.width;
        this.meshMaskCanvas.height = ctx.canvas.height;
        this.meshSeamCanvas.width = ctx.canvas.width;
        this.meshSeamCanvas.height = ctx.canvas.height;
        this.meshRepairCanvas.width = ctx.canvas.width;
        this.meshRepairCanvas.height = ctx.canvas.height;
      }
      const meshCtx = this.meshContext;
      const maskCtx = this.meshMaskContext;
      meshCtx.setTransform(1, 0, 0, 1, 0, 0);
      meshCtx.globalCompositeOperation = "source-over";
      meshCtx.clearRect(0, 0, this.meshCanvas.width, this.meshCanvas.height);
      maskCtx.setTransform(1, 0, 0, 1, 0, 0);
      maskCtx.globalCompositeOperation = "lighter";
      maskCtx.clearRect(0, 0, this.meshMaskCanvas.width, this.meshMaskCanvas.height);
      maskCtx.fillStyle = "#fff";
      const seamCtx = this.meshSeamContext;
      seamCtx.setTransform(1, 0, 0, 1, 0, 0);
      seamCtx.globalCompositeOperation = "source-over";
      seamCtx.clearRect(0, 0, this.meshSeamCanvas.width, this.meshSeamCanvas.height);
      seamCtx.strokeStyle = "#fff";
      seamCtx.lineWidth = 1.8 * this.hooks.dpr();
      seamCtx.lineCap = "round";
      seamCtx.lineJoin = "round";
      for (let row = 0; row < rows - 1; row += 1) for (let column = 0; column < columns - 1; column += 1) {
        const u0 = column / (columns - 1) * texture.width;
        const u1 = (column + 1) / (columns - 1) * texture.width;
        const v0 = row / (rows - 1) * texture.height, v1 = (row + 1) / (rows - 1) * texture.height;
        const triangles = [
          { source: [{ x: u0, y: v0 }, { x: u1, y: v0 }, { x: u1, y: v1 }], target: [grid[row][column], grid[row][column + 1], grid[row + 1][column + 1]], times: [gridTimes[row][column], gridTimes[row][column + 1], gridTimes[row + 1][column + 1]] },
          { source: [{ x: u0, y: v0 }, { x: u1, y: v1 }, { x: u0, y: v1 }], target: [grid[row][column], grid[row + 1][column + 1], grid[row + 1][column]], times: [gridTimes[row][column], gridTimes[row + 1][column + 1], gridTimes[row + 1][column]] },
        ];
        let cellVisible = false;
        for (const triangle of triangles) {
          if (!this._triangleTouchesLayer(
            segment.sticks,
            state.timing.times,
            triangle.times,
            segment.layer,
            layer,
          )) continue;
          cellVisible = true;
          this._fillTriangle(maskCtx, triangle.target);
          this._drawTriangle(meshCtx, texture, triangle.source, triangle.target);
        }
        if (cellVisible) {
          this._strokeSeam(seamCtx, grid[row][column], grid[row + 1][column + 1]);
          if (column > 0) this._strokeSeam(seamCtx, grid[row][column], grid[row + 1][column]);
          if (row > 0) this._strokeSeam(seamCtx, grid[row][column], grid[row][column + 1]);
        }
      }
      meshCtx.globalCompositeOperation = "destination-in";
      meshCtx.drawImage(this.meshMaskCanvas, 0, 0);
      meshCtx.globalCompositeOperation = "source-over";
      const repairCtx = this.meshRepairContext;
      repairCtx.setTransform(1, 0, 0, 1, 0, 0);
      repairCtx.globalCompositeOperation = "source-over";
      repairCtx.filter = "none";
      repairCtx.globalAlpha = 1;
      repairCtx.clearRect(0, 0, this.meshRepairCanvas.width, this.meshRepairCanvas.height);
      repairCtx.filter = `blur(${1.15 * this.hooks.dpr()}px)`;
      repairCtx.drawImage(this.meshCanvas, 0, 0);
      repairCtx.filter = "none";
      repairCtx.globalCompositeOperation = "destination-in";
      repairCtx.drawImage(this.meshSeamCanvas, 0, 0);
      repairCtx.globalCompositeOperation = "destination-in";
      repairCtx.drawImage(this.meshMaskCanvas, 0, 0);
      repairCtx.globalCompositeOperation = "source-over";
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.drawImage(this.meshCanvas, 0, 0);
      ctx.globalAlpha = alpha * 0.92;
      ctx.drawImage(this.meshRepairCanvas, 0, 0);
      ctx.restore();
    }

    _tailDistances(state, currentDistance, tailProgress) {
      const progress = clamp(tailProgress, 0, 1, 0);
      const distances = state.speeds.map((factor) => {
        const widthFactor = 1 + (factor - 1) * TAIL_WIDTH_SPEED_INFLUENCE;
        const endpointSafeWobble = (widthFactor - 1) * 4 * progress * (1 - progress);
        const tailProgress = clamp(progress + endpointSafeWobble, 0, 1, progress);
        return Math.min(currentDistance, state.total * tailProgress);
      });
      return this._guardTailEdgeProgress(distances);
    }

    _guardTailEdgeProgress(distances) {
      if (distances.length <= 2) return distances;
      const interior = distances.slice(1, -1);
      const interiorMean = interior.reduce((sum, value) => sum + value, 0) / interior.length;
      // The top and bottom edge may trail slightly, but may never outrun the
      // interior compression and draw a geometric round cap over the texture.
      distances[0] = Math.min(distances[0], interiorMean);
      distances[distances.length - 1] = Math.min(distances.at(-1), interiorMean);
      return distances;
    }

    _meshTailDistance(tails, v) {
      if (tails.length <= 1) return Number(tails[0] || 0);
      const scaled = clamp(v, 0, 1, 0) * (tails.length - 1);
      const index = Math.min(tails.length - 2, Math.floor(scaled));
      const phase = scaled - index;
      const smoothPhase = phase * phase * (3 - 2 * phase);
      return tails[index] + (tails[index + 1] - tails[index]) * smoothPhase;
    }

    _terminalHeadCapBlend(currentDistance, tails, capDepth, collapsePhase) {
      if (collapsePhase <= 0 || capDepth <= 0.001) return 0;
      const maximumLag = tails.reduce(
        (maximum, distance) => Math.max(maximum, Math.abs(currentDistance - distance)),
        0,
      );
      const phase = clamp(1 - maximumLag / Math.max(0.001, capDepth), 0, 1, 0);
      return phase * phase * (3 - 2 * phase);
    }

    _headCurveProfile(v) {
      // The midpoint is the fixed nose of the head: it stays exactly on the
      // original straight leading edge. Only the upper and lower portions
      // recede into the texture, following a circular-cap profile.
      const centered = clamp(v, 0, 1, 0.5) * 2 - 1;
      return 1 - Math.sqrt(Math.max(0, 1 - centered * centered));
    }

    _headCurveBlend(u) {
      const phase = clamp(u / 0.35, 0, 1, 1);
      return 1 - phase * phase * (3 - 2 * phase);
    }

    _createGpuRenderer() {
      try {
        const gl = this.gpuCanvas.getContext("webgl", {
          alpha: true,
          antialias: false,
          depth: false,
          stencil: false,
          premultipliedAlpha: true,
          preserveDrawingBuffer: true,
          powerPreference: "high-performance",
        });
        if (!gl) return null;
        const compile = (type, source) => {
          const shader = gl.createShader(type);
          gl.shaderSource(shader, source);
          gl.compileShader(shader);
          if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            const message = gl.getShaderInfoLog(shader) || "WebGL shader compile failed";
            gl.deleteShader(shader);
            throw new Error(message);
          }
          return shader;
        };
        const vertexShader = compile(gl.VERTEX_SHADER, `
          attribute vec2 a_position;
          attribute vec2 a_uv;
          uniform vec2 u_resolution;
          varying vec2 v_uv;
          void main() {
            vec2 clip = (a_position / u_resolution) * 2.0 - 1.0;
            gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
            v_uv = a_uv;
          }
        `);
        const fragmentShader = compile(gl.FRAGMENT_SHADER, `
          precision mediump float;
          uniform sampler2D u_texture;
          varying vec2 v_uv;
          void main() {
            gl_FragColor = texture2D(u_texture, v_uv);
          }
        `);
        const program = gl.createProgram();
        gl.attachShader(program, vertexShader);
        gl.attachShader(program, fragmentShader);
        gl.linkProgram(program);
        gl.deleteShader(vertexShader);
        gl.deleteShader(fragmentShader);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
          const message = gl.getProgramInfoLog(program) || "WebGL program link failed";
          gl.deleteProgram(program);
          throw new Error(message);
        }
        return {
          gl,
          program,
          vertexBuffer: gl.createBuffer(),
          indexBuffer: gl.createBuffer(),
          position: gl.getAttribLocation(program, "a_position"),
          uv: gl.getAttribLocation(program, "a_uv"),
          resolution: gl.getUniformLocation(program, "u_resolution"),
          texture: gl.getUniformLocation(program, "u_texture"),
        };
      } catch (error) {
        console.warn("Attack trail WebGL preview unavailable; using Canvas fallback.", error);
        return null;
      }
    }

    _gpuTexture(source) {
      const renderer = this.gpuRenderer;
      if (!renderer) return null;
      const cached = this.gpuTextures.get(source);
      if (cached) return cached;
      const { gl } = renderer;
      const texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      // Canvas images use a top-left origin while WebGL textures use a
      // bottom-left origin. Flip on upload so mesh v=0 remains the authored
      // stick top and v=1 remains the stick bottom (the rotation-center side).
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
      this.gpuTextures.set(source, texture);
      return texture;
    }

    _drawGpuMesh(textureSource, grid, gridTimes, segment, state, layer, width, height) {
      const renderer = this.gpuRenderer;
      if (!renderer || renderer.gl.isContextLost()) return false;
      const rows = grid.length;
      const columns = grid[0]?.length || 0;
      if (rows < 2 || columns < 2 || rows * columns > 65535) return false;
      if (this.gpuCanvas.width !== width || this.gpuCanvas.height !== height) {
        this.gpuCanvas.width = width;
        this.gpuCanvas.height = height;
      }
      const vertices = new Float32Array(rows * columns * 4);
      let vertexOffset = 0;
      for (let row = 0; row < rows; row += 1) {
        const v = row / (rows - 1);
        for (let column = 0; column < columns; column += 1) {
          const point = grid[row][column];
          vertices[vertexOffset++] = point.x;
          vertices[vertexOffset++] = point.y;
          vertices[vertexOffset++] = column / (columns - 1);
          vertices[vertexOffset++] = v;
        }
      }
      const indices = new Uint16Array((rows - 1) * (columns - 1) * 6);
      let indexOffset = 0;
      const appendTriangle = (a, b, c, timeA, timeB, timeC) => {
        if (!this._triangleTouchesLayer(
          segment.sticks,
          state.timing.times,
          [timeA, timeB, timeC],
          segment.layer,
          layer,
        )) return;
        indices[indexOffset++] = a;
        indices[indexOffset++] = b;
        indices[indexOffset++] = c;
      };
      for (let row = 0; row < rows - 1; row += 1) {
        for (let column = 0; column < columns - 1; column += 1) {
          const topLeft = row * columns + column;
          const topRight = topLeft + 1;
          const bottomLeft = topLeft + columns;
          const bottomRight = bottomLeft + 1;
          appendTriangle(topLeft, topRight, bottomRight,
            gridTimes[row][column], gridTimes[row][column + 1], gridTimes[row + 1][column + 1]);
          appendTriangle(topLeft, bottomRight, bottomLeft,
            gridTimes[row][column], gridTimes[row + 1][column + 1], gridTimes[row + 1][column]);
        }
      }
      const gpuTexture = this._gpuTexture(textureSource);
      if (!gpuTexture) return false;
      const { gl } = renderer;
      gl.viewport(0, 0, width, height);
      gl.disable(gl.CULL_FACE);
      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.SCISSOR_TEST);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(renderer.program);
      gl.uniform2f(renderer.resolution, width, height);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, gpuTexture);
      gl.uniform1i(renderer.texture, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, renderer.vertexBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(renderer.position);
      gl.vertexAttribPointer(renderer.position, 2, gl.FLOAT, false, 16, 0);
      gl.enableVertexAttribArray(renderer.uv);
      gl.vertexAttribPointer(renderer.uv, 2, gl.FLOAT, false, 16, 8);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, renderer.indexBuffer);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices.subarray(0, indexOffset), gl.DYNAMIC_DRAW);
      if (indexOffset) gl.drawElements(gl.TRIANGLES, indexOffset, gl.UNSIGNED_SHORT, 0);
      // Three material passes reuse this offscreen WebGL canvas immediately.
      // Wait for each pass before Canvas2D snapshots it, otherwise the browser
      // may occasionally composite the next cleared pass and make the trail
      // appear to flicker or disappear after a UI redraw/scroll.
      gl.finish();
      return true;
    }

    _strokeSeam(context, a, b) {
      context.beginPath();
      context.moveTo(a.x, a.y);
      context.lineTo(b.x, b.y);
      context.stroke();
    }

    _fillTriangle(context, target) {
      const [a, b, c] = target;
      context.beginPath();
      context.moveTo(a.x, a.y);
      context.lineTo(b.x, b.y);
      context.lineTo(c.x, c.y);
      context.closePath();
      context.fill();
    }

    _blendCompositeOperation(value) {
      return {
        add: "lighter",
        screen: "screen",
        normal: "source-over",
        multiply: "multiply",
      }[normalizeBlendMode(value)] || "lighter";
    }

    _previewTextureDimensions(image) {
      const width = Math.max(1, Number(image?.width || 1));
      const height = Math.max(1, Number(image?.height || 1));
      const scale = Math.min(1, PREVIEW_TEXTURE_MAX_SIZE / Math.max(width, height));
      return {
        width: Math.max(1, Math.round(width * scale)),
        height: Math.max(1, Math.round(height * scale)),
      };
    }

    _processedBodyTexture(image, segment, maskImage = null, maskMaterial = null) {
      const key = [
        "body",
        segment.texture.assetHash,
        segment.texture.path,
        segment.invertTexture === true,
        segment.colorMode,
        segment.color,
        JSON.stringify(segment.gradientStops),
        segment.bodyOpacityFloor,
        segment.bodyDetailStrength,
        segment.bodyWhiteThreshold,
        segment.tailFadeStart,
        maskMaterial?.enabled !== false && maskImage ? maskMaterial.texture.assetHash || maskMaterial.texture.path : "",
        maskMaterial?.enabled !== false && maskImage ? maskMaterial.strength : "",
        maskMaterial?.enabled !== false && maskImage ? maskMaterial.invert === true : "",
        maskMaterial?.enabled !== false && maskImage ? maskMaterial.threshold : "",
        maskMaterial?.enabled !== false && maskImage ? maskMaterial.softness : "",
        maskMaterial?.enabled !== false && maskImage ? maskMaterial.expansion : "",
      ].join(":");
      if (this.processed.has(key)) return this.processed.get(key);
      const previewSize = this._previewTextureDimensions(image);
      const sourceCanvas = document.createElement("canvas");
      sourceCanvas.width = previewSize.width;
      sourceCanvas.height = previewSize.height;
      const sourceContext = sourceCanvas.getContext("2d", { willReadFrequently: true });
      sourceContext.drawImage(image, 0, 0);
      const pixels = sourceContext.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height);
      let maskPixels = null;
      if (maskImage && maskMaterial?.enabled !== false) {
        const maskCanvas = document.createElement("canvas");
        maskCanvas.width = previewSize.width;
        maskCanvas.height = previewSize.height;
        const maskContext = maskCanvas.getContext("2d", { willReadFrequently: true });
        maskContext.drawImage(maskImage, 0, 0);
        maskPixels = maskContext.getImageData(0, 0, maskCanvas.width, maskCanvas.height);
      }
      const body = document.createElement("canvas");
      body.width = previewSize.width;
      body.height = previewSize.height;
      const bodyContext = body.getContext("2d", { willReadFrequently: true });
      const bodyPixels = bodyContext.createImageData(body.width, body.height);
      const solidTint = colorChannels(segment.color);
      for (let index = 0; index < pixels.data.length; index += 4) {
        const pixel = index / 4;
        const x = pixel % sourceCanvas.width;
        const y = Math.floor(pixel / sourceCanvas.width);
        const u = sourceCanvas.width <= 1 ? 0 : x / (sourceCanvas.width - 1);
        const v = sourceCanvas.height <= 1 ? 0.5 : y / (sourceCanvas.height - 1);
        const sourceLuma = (pixels.data[index] * 0.2126 + pixels.data[index + 1] * 0.7152 + pixels.data[index + 2] * 0.0722) / 255;
        const luma = segment.invertTexture === true ? 1 - sourceLuma : sourceLuma;
        const fadeU = clamp((u - segment.tailFadeStart) / Math.max(0.001, 1 - segment.tailFadeStart), 0, 1, 0);
        const fade = 1 - Math.pow(fadeU, TAIL_ALPHA_EXPONENT);
        const sourceAlpha = pixels.data[index + 3] / 255;
        let breakupAlpha = 1;
        if (maskPixels) {
          const maskX = Math.min(maskPixels.width - 1, Math.round(u * Math.max(0, maskPixels.width - 1)));
          const maskY = Math.min(maskPixels.height - 1, Math.round(v * Math.max(0, maskPixels.height - 1)));
          const maskLumaAt = (sampleY) => {
            const sampleIndex = (sampleY * maskPixels.width + maskX) * 4;
            return (
              maskPixels.data[sampleIndex] * 0.2126
              + maskPixels.data[sampleIndex + 1] * 0.7152
              + maskPixels.data[sampleIndex + 2] * 0.0722
            ) / 255;
          };
          const expansionPixels = Math.round(maskMaterial.expansion * Math.max(0, maskPixels.height - 1));
          let rawMask = maskLumaAt(maskY);
          if (expansionPixels > 0) {
            rawMask = Math.max(
              rawMask,
              maskLumaAt(Math.max(0, maskY - expansionPixels)),
              maskLumaAt(Math.min(maskPixels.height - 1, maskY + expansionPixels)),
            );
          }
          const rawMaskLuma = maskMaterial.invert === true ? 1 - rawMask : rawMask;
          const maskLuma = maskResponse(rawMaskLuma, maskMaterial.threshold, maskMaterial.softness);
          breakupAlpha = 1 - clamp(maskMaterial.strength, 0, 1, 0.72) * (1 - maskLuma);
        }
        if (segment.colorMode !== "original") {
          const gradientPosition = sourceCanvas.height <= 1 ? 0.5 : 1 - y / (sourceCanvas.height - 1);
          const tint = segment.colorMode === "gradient" ? this._gradientColorAt(segment.gradientStops, gradientPosition) : solidTint;
          const authoredDetail = 0.44 + 0.5 * luma;
          const detail = 1 + (authoredDetail - 1) * segment.bodyDetailStrength;
          const authoredWhite = segment.bodyWhiteThreshold < 0.999
            ? smoothstep(segment.bodyWhiteThreshold, Math.min(1, segment.bodyWhiteThreshold + 0.18), luma)
            : 0;
          const headWhite = authoredWhite * (1 - smoothstep(
            segment.headWhiteLength * 0.72,
            Math.max(0.0001, segment.headWhiteLength),
            u,
          ));
          const whiteAmount = Math.max(headWhite, authoredWhite * segment.bodyDetailStrength);
          bodyPixels.data[index] = tint[0] * detail * (1 - whiteAmount) + 255 * whiteAmount;
          bodyPixels.data[index + 1] = tint[1] * detail * (1 - whiteAmount) + 255 * whiteAmount;
          bodyPixels.data[index + 2] = tint[2] * detail * (1 - whiteAmount) + 255 * whiteAmount;
          const bodyMask = segment.bodyOpacityFloor + (1 - segment.bodyOpacityFloor) * luma;
          bodyPixels.data[index + 3] = 255 * sourceAlpha * bodyMask * fade * breakupAlpha;
        } else {
          bodyPixels.data[index] = segment.invertTexture === true ? 255 - pixels.data[index] : pixels.data[index];
          bodyPixels.data[index + 1] = segment.invertTexture === true ? 255 - pixels.data[index + 1] : pixels.data[index + 1];
          bodyPixels.data[index + 2] = segment.invertTexture === true ? 255 - pixels.data[index + 2] : pixels.data[index + 2];
          bodyPixels.data[index + 3] = 255 * sourceAlpha * fade * breakupAlpha;
        }
      }
      bodyContext.putImageData(bodyPixels, 0, 0);
      this.processed.set(key, body);
      return body;
    }

    _processedMaterialLayerTexture(image, material, segment, layerId, bodyImage = null) {
      const key = [
        "material",
        layerId,
        material.texture.assetHash,
        material.texture.path,
        material.color,
        material.invert === true,
        material.threshold,
        material.softness,
        material.expansion,
        segment.tailFadeStart,
        layerId === "core" ? segment.coreEdge : "",
        layerId === "core" ? segment.headLightBoost : "",
        layerId === "streaks" ? segment.headWhitePreserve : "",
        layerId === "streaks" ? segment.headWhiteLength : "",
        layerId === "streaks" ? segment.bodyWhiteThreshold : "",
        layerId === "streaks" ? segment.texture.assetHash || segment.texture.path : "",
      ].join(":");
      if (this.processed.has(key)) return this.processed.get(key);
      const previewSize = this._previewTextureDimensions(image);
      const sourceCanvas = document.createElement("canvas");
      sourceCanvas.width = previewSize.width;
      sourceCanvas.height = previewSize.height;
      const sourceContext = sourceCanvas.getContext("2d", { willReadFrequently: true });
      sourceContext.drawImage(image, 0, 0);
      const pixels = sourceContext.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height);
      const output = document.createElement("canvas");
      output.width = previewSize.width;
      output.height = previewSize.height;
      const outputContext = output.getContext("2d", { willReadFrequently: true });
      const outputPixels = outputContext.createImageData(output.width, output.height);
      const tint = colorChannels(material.color);
      let bodyPixels = null;
      if (layerId === "streaks" && bodyImage && segment.headWhitePreserve > 0) {
        const bodyCanvas = document.createElement("canvas");
        bodyCanvas.width = previewSize.width;
        bodyCanvas.height = previewSize.height;
        const bodyContext = bodyCanvas.getContext("2d", { willReadFrequently: true });
        bodyContext.drawImage(bodyImage, 0, 0, bodyCanvas.width, bodyCanvas.height);
        bodyPixels = bodyContext.getImageData(0, 0, bodyCanvas.width, bodyCanvas.height);
      }
      const sampleLuma = (sampleIndex) => {
        const sourceLuma = (
          pixels.data[sampleIndex] * 0.2126
          + pixels.data[sampleIndex + 1] * 0.7152
          + pixels.data[sampleIndex + 2] * 0.0722
        ) / 255;
        return material.invert === true ? 1 - sourceLuma : sourceLuma;
      };
      const expandedLuma = (x, y) => {
        const expansionPixels = Math.round(material.expansion * Math.max(0, sourceCanvas.height - 1));
        const lumaAt = (sampleY) => sampleLuma((sampleY * sourceCanvas.width + x) * 4);
        let value = lumaAt(y);
        if (expansionPixels > 0) {
          value = Math.max(
            value,
            lumaAt(Math.max(0, y - expansionPixels)),
            lumaAt(Math.min(sourceCanvas.height - 1, y + expansionPixels)),
          );
        }
        return value;
      };
      for (let index = 0; index < pixels.data.length; index += 4) {
        const pixel = index / 4;
        const x = pixel % sourceCanvas.width;
        const y = Math.floor(pixel / sourceCanvas.width);
        const u = sourceCanvas.width <= 1 ? 0 : x / (sourceCanvas.width - 1);
        const fadeU = clamp((u - segment.tailFadeStart) / Math.max(0.001, 1 - segment.tailFadeStart), 0, 1, 0);
        const fade = 1 - Math.pow(fadeU, TAIL_ALPHA_EXPONENT);
        const sourceAlpha = pixels.data[index + 3] / 255;
        let luma = maskResponse(expandedLuma(x, y), material.threshold, material.softness);
        if (layerId === "core" && segment.coreEdge !== "top") {
          const mirroredLuma = maskResponse(expandedLuma(x, sourceCanvas.height - 1 - y), material.threshold, material.softness);
          luma = segment.coreEdge === "both" ? Math.max(luma, mirroredLuma) : mirroredLuma;
        }
        const headBoost = layerId === "core"
          ? 1 + segment.headLightBoost * (1 - smoothstep(0, 0.24, u))
          : 1;
        let headWhiteProtection = 0;
        if (bodyPixels && u <= segment.headWhiteLength) {
          const bodyLuma = (
            bodyPixels.data[index] * 0.2126
            + bodyPixels.data[index + 1] * 0.7152
            + bodyPixels.data[index + 2] * 0.0722
          ) / 255;
          const alongHead = 1 - smoothstep(segment.headWhiteLength * 0.72, segment.headWhiteLength, u);
          headWhiteProtection = segment.headWhitePreserve
            * alongHead
            * smoothstep(segment.bodyWhiteThreshold, Math.min(1, segment.bodyWhiteThreshold + 0.18), bodyLuma);
        }
        const layerAlpha = clamp(sourceAlpha * luma * fade * headBoost * (1 - headWhiteProtection), 0, 1, 0);
        outputPixels.data[index] = tint[0];
        outputPixels.data[index + 1] = tint[1];
        outputPixels.data[index + 2] = tint[2];
        outputPixels.data[index + 3] = 255 * layerAlpha;
      }
      outputContext.putImageData(outputPixels, 0, 0);
      this.processed.set(key, output);
      return output;
    }

    _drawTriangle(context, image, source, target) {
      const [s0, s1, s2] = source, [d0, d1, d2] = target;
      const denominator = s0.x * (s1.y - s2.y) + s1.x * (s2.y - s0.y) + s2.x * (s0.y - s1.y);
      if (Math.abs(denominator) < 1e-6) return;
      const center = { x: (d0.x + d1.x + d2.x) / 3, y: (d0.y + d1.y + d2.y) / 3 };
      const overlap = 1.15 * this.hooks.dpr();
      const expand = (vertex) => {
        const dx = vertex.x - center.x, dy = vertex.y - center.y;
        const length = Math.max(0.001, Math.hypot(dx, dy));
        return { x: vertex.x + dx / length * overlap, y: vertex.y + dy / length * overlap };
      };
      const [c0, c1, c2] = [d0, d1, d2].map(expand);
      const a = (d0.x * (s1.y - s2.y) + d1.x * (s2.y - s0.y) + d2.x * (s0.y - s1.y)) / denominator;
      const c = (d0.x * (s2.x - s1.x) + d1.x * (s0.x - s2.x) + d2.x * (s1.x - s0.x)) / denominator;
      const e = (d0.x * (s1.x * s2.y - s2.x * s1.y) + d1.x * (s2.x * s0.y - s0.x * s2.y) + d2.x * (s0.x * s1.y - s1.x * s0.y)) / denominator;
      const b = (d0.y * (s1.y - s2.y) + d1.y * (s2.y - s0.y) + d2.y * (s0.y - s1.y)) / denominator;
      const d = (d0.y * (s2.x - s1.x) + d1.y * (s0.x - s2.x) + d2.y * (s1.x - s0.x)) / denominator;
      const f = (d0.y * (s1.x * s2.y - s2.x * s1.y) + d1.y * (s2.x * s0.y - s0.x * s2.y) + d2.y * (s0.x * s1.y - s1.x * s0.y)) / denominator;
      context.save();
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";
      context.beginPath(); context.moveTo(c0.x, c0.y); context.lineTo(c1.x, c1.y); context.lineTo(c2.x, c2.y); context.closePath(); context.clip();
      context.setTransform(a, b, c, d, e, f); context.drawImage(image, 0, 0); context.restore();
    }

    _normalizeData(raw) {
      const bindings = {};
      const sourceSchema = Math.max(0, Math.round(Number(raw?.schemaVersion || 0)));
      const presets = [];
      const presetIds = new Set();
      const addPreset = (value, key = "preset/global") => {
        const preset = this._normalizeSegment({
          ...clone(value || {}),
          generated: false,
          presetOnly: true,
          sticks: [],
        }, presets.length, key, sourceSchema);
        if (presetIds.has(preset.id)) return;
        presetIds.add(preset.id);
        presets.push(preset);
      };
      for (const preset of Array.isArray(raw?.presets) ? raw.presets : []) {
        addPreset(preset, `${preset?.profileId || "preset"}/${preset?.animationId || "global"}`);
      }
      for (const [key, values] of Object.entries(raw?.bindings || {})) {
        if (!Array.isArray(values) || !key.includes("/")) continue;
        const segments = [];
        for (const value of values) {
          const segment = this._normalizeSegment(value, segments.length, key, sourceSchema);
          if (segment.presetOnly) addPreset(segment, key);
          else segments.push(segment);
        }
        if (segments.length) bindings[key] = segments;
      }
      const presetTexture = normalizeBodyTexture(raw?.presetTexture);
      return { schemaVersion: ATTACK_TRAIL_SCHEMA_VERSION, presetTexture, presets, bindings };
    }
    _normalizeSegment(value = {}, index, key, sourceSchema = ATTACK_TRAIL_SCHEMA_VERSION) {
      const [profileId, animationId] = key.split("/");
      const segmentLayer = value.layer === "front" ? "front" : "behind";
      const color = normalizeColor(value.color);
      const frameSlices = normalizeFrameSlices(value.frameSlices ?? value.frame_slices);
      const presetOnly = value.presetOnly === true && (!Array.isArray(value.sticks) || value.sticks.length === 0);
      const forceFrameSlices = this._usesFrameSlicesOnly() && !presetOnly;
      const materialLayers = normalizeMaterialLayers(value.materialLayers ?? value.material_layers, value);
      const glowStrength = clamp(value.glowStrength ?? value.glow_strength, 0, 3, DEFAULT_GLOW_STRENGTH);
      const segment = {
        id: String(value.id || `trail_${index + 1}`), name: normalizeTrailName(value.name, index), profileId: String(value.profileId || profileId), animationId: String(value.animationId || animationId),
        enabled: true, generated: value.generated !== false, presetOnly, coordinateSpace: "group", layer: segmentLayer,
        texture: normalizeBodyTexture(value.texture),
        invertTexture: value.invertTexture === true || value.invert_texture === true,
        colorMode: normalizeColorMode(value.colorMode || value.color_mode || "solid"), color,
        gradientStops: normalizeGradientStops(value.gradientStops ?? value.gradient_stops, color),
        bodyOpacityFloor: clamp(value.bodyOpacityFloor ?? value.body_opacity_floor, 0, 1, 0),
        bodyDetailStrength: clamp(value.bodyDetailStrength ?? value.body_detail_strength, 0, 1, 1),
        bodyWhiteThreshold: clamp(value.bodyWhiteThreshold ?? value.body_white_threshold, 0, 1, 1),
        materialLayers,
        coreEdge: normalizeCoreEdge(value.coreEdge ?? value.core_edge),
        glowColor: normalizeColor(value.glowColor ?? value.glow_color, fluorescentHaloColor(materialLayers.core.color)),
        glowStrength,
        glowRadius: clamp(value.glowRadius ?? value.glow_radius, 0, 60, DEFAULT_GLOW_RADIUS),
        headLightBoost: clamp(value.headLightBoost ?? value.head_light_boost, 0, 2, DEFAULT_HEAD_LIGHT_BOOST),
        headWhitePreserve: clamp(value.headWhitePreserve ?? value.head_white_preserve, 0, 1, 0),
        headWhiteLength: clamp(value.headWhiteLength ?? value.head_white_length, 0, 0.5, 0.18),
        widthMode: (value.widthMode ?? value.width_mode) === "fixed" ? "fixed" : "authored",
        fixedWidth: clamp(value.fixedWidth ?? value.fixed_width, 8, 600, 160),
        widthScale: clamp(value.widthScale ?? value.width_scale, 0.1, 3, 1),
        widthOffset: clamp(value.widthOffset ?? value.width_offset, -1, 1, 0),
        widthChaseStrength: clamp(value.widthChaseStrength ?? value.width_chase_strength, 0, 1, 1),
        pathScaleX: clamp(value.pathScaleX ?? value.path_scale_x, 0.25, 3, 1),
        pathScaleY: clamp(value.pathScaleY ?? value.path_scale_y, 0.25, 3, 1),
        totalDurationMs: Math.round(clamp(value.totalDurationMs ?? value.total_duration_ms, 0, 60000, 0)),
        tailHeadSpeedRatio: this._tailHeadSpeedRatio(value, sourceSchema),
        tailSamples: Math.round(clamp(value.tailSamples, 4, 8, 5)),
        tailFadeStart: clamp(value.tailFadeStart, 0, 0.95, 0.6),
        headCurvature: clamp(value.headCurvature, -1, 1, 0),
        speedVariation: clamp(value.speedVariation, 0, 0.25, 0.008), stableSeed: Math.round(clamp(value.stableSeed, 0, 2147483647, 73129)), pathColumns: Math.round(clamp(value.pathColumns, 8, 96, DEFAULT_PATH_COLUMNS)), pathCacheSamples: Math.round(clamp(value.pathCacheSamples, 32, 512, 192)), collapsedWidth: clamp(value.collapsedWidth, 0.25, 32, 2),
        sticks: (Array.isArray(value.sticks) ? value.sticks : []).map((stick, stickIndex) => this._normalizeStick(stick, stickIndex, segmentLayer)),
        ...(frameSlices || forceFrameSlices ? { frameSlices: frameSlices || {} } : {}),
      };
      this._renumberAndAutoPhase(segment);
      this._updateGenerated(segment);
      return segment;
    }
    _tailHeadSpeedRatio(value, sourceSchema = ATTACK_TRAIL_SCHEMA_VERSION) {
      const direct = value?.tailHeadSpeedRatio ?? value?.tail_head_speed_ratio;
      if (direct !== undefined && direct !== null && direct !== "") {
        return clamp(direct, 0.01, 0.9, DEFAULT_TAIL_HEAD_SPEED_RATIO);
      }
      const hasLegacyTiming = [
        "beforeStopChaseMultiplier", "before_stop_chase_multiplier",
        "afterStopChaseMultiplier", "after_stop_chase_multiplier",
        "beforeStopChaseSpeed", "before_stop_chase_speed",
        "afterStopChaseSpeed", "after_stop_chase_speed",
      ].some((key) => Object.prototype.hasOwnProperty.call(value || {}, key));
      if (sourceSchema <= 9 && hasLegacyTiming) {
        const before = this._chaseMultiplier(value, "before", 0, 1, sourceSchema);
        const after = this._chaseMultiplier(value, "after", 0.1, 20, sourceSchema);
        return clamp(1 / (1 + Math.max(0, 1 - before) / Math.max(0.0001, after)), 0.01, 0.9, DEFAULT_TAIL_HEAD_SPEED_RATIO);
      }
      return DEFAULT_TAIL_HEAD_SPEED_RATIO;
    }
    _chaseMultiplier(value, phase, min, max, sourceSchema = 6) {
      const before = phase === "before";
      const direct = before
        ? value?.beforeStopChaseMultiplier ?? value?.before_stop_chase_multiplier
        : value?.afterStopChaseMultiplier ?? value?.after_stop_chase_multiplier;
      const fallback = before ? DEFAULT_BEFORE_CHASE_MULTIPLIER : DEFAULT_AFTER_CHASE_MULTIPLIER;
      if (direct !== undefined && direct !== null && direct !== "") {
        const normalized = clamp(direct, min, max, fallback);
        if (before && sourceSchema < 6 && Math.abs(normalized - 0.7) < 0.000001) return DEFAULT_BEFORE_CHASE_MULTIPLIER;
        return normalized;
      }
      const legacy = Number(before
        ? value?.beforeStopChaseSpeed ?? value?.before_stop_chase_speed
        : value?.afterStopChaseSpeed ?? value?.after_stop_chase_speed);
      if (!Number.isFinite(legacy)) return fallback;
      const legacyDefault = before ? LEGACY_BEFORE_CHASE_SPEED : LEGACY_AFTER_CHASE_SPEED;
      return clamp(legacy / legacyDefault * fallback, min, max, fallback);
    }
    _normalizeStick(value = {}, index, defaultLayer = "behind") {
      return { id: String(value.id || `stick_${index + 1}`), order: index, frame: Math.max(0, Math.round(Number(value.frame || 0))), framePhase: clamp(value.framePhase, 0, 1, 0.5), phaseMode: value.phaseMode === "manual" ? "manual" : "auto", headFrame: (value.headFrame ?? value.head_frame) !== false, headFrameMode: String(value.headFrameMode || value.head_frame_mode || "manual") === "auto" ? "auto" : "manual", top: point(value.top, { x: -60, y: -120 }), bottom: point(value.bottom, { x: 60, y: 120 }), reverseDirection: value.reverseDirection === true, directionOffset: clamp(value.directionOffset, -180, 180, 0), tangentStrength: clamp(value.tangentStrength, 0, 4, 0.8), layer: String(value.layer || defaultLayer) === "front" ? "front" : "behind" };
    }
    _texturePreviewSource(image, segment) {
      if (segment?.invertTexture !== true) return image;
      const key = `preview-invert:${segment.texture?.assetHash || segment.texture?.path || ""}`;
      if (this.processed.has(key)) return this.processed.get(key);
      const canvas = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      context.drawImage(image, 0, 0);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
      for (let index = 0; index < pixels.data.length; index += 4) {
        pixels.data[index] = 255 - pixels.data[index];
        pixels.data[index + 1] = 255 - pixels.data[index + 1];
        pixels.data[index + 2] = 255 - pixels.data[index + 2];
      }
      context.putImageData(pixels, 0, 0);
      this.processed.set(key, canvas);
      return canvas;
    }
    _renderTexturePreview(segment) {
      const canvas = this.els.attackTrailTexturePreview;
      if (!canvas) return;
      const texturePath = segment?.texture?.path;
      if (!texturePath) { canvas.hidden = true; return; }
      const image = this.images.get(texturePath);
      if (!image) {
        canvas.hidden = false;
        this.hooks.loadTexture(segment.texture).then((loaded) => {
          this.images.set(texturePath, loaded);
          if (this._segment()?.texture?.path === texturePath) this._renderTexturePreview(this._segment());
        }).catch(() => { canvas.hidden = true; });
        return;
      }
      canvas.hidden = false;
      const previewImage = this._texturePreviewSource(image, segment);
      const context = canvas.getContext("2d");
      const width = canvas.width, height = canvas.height;
      context.clearRect(0, 0, width, height);
      const drawHeight = height - 20;
      const straightWidth = Math.min(width * 0.72, drawHeight * previewImage.width / Math.max(1, previewImage.height));
      const curvePad = Math.max(18, straightWidth * 0.24);
      const baseX = (width - straightWidth) * 0.5 + curvePad * 0.5;
      const rightX = baseX + straightWidth - curvePad * 0.5;
      const topY = 5;
      const rows = 16;
      const columns = 8;
      context.imageSmoothingEnabled = true;
      const sourcePoint = (u, v) => ({ x: previewImage.width * u, y: previewImage.height * v });
      const previewPoint = (u, v) => ({
        x: baseX + (rightX - baseX) * u + segment.headCurvature * curvePad * this._headCurveProfile(v) * this._headCurveBlend(u),
        y: topY + drawHeight * v,
      });
      for (let row = 0; row < rows; row += 1) {
        const v0 = row / rows, v1 = (row + 1) / rows;
        for (let column = 0; column < columns; column += 1) {
          const u0 = column / columns, u1 = (column + 1) / columns;
          const source00 = sourcePoint(u0, v0), source10 = sourcePoint(u1, v0), source01 = sourcePoint(u0, v1), source11 = sourcePoint(u1, v1);
          const target00 = previewPoint(u0, v0), target10 = previewPoint(u1, v0), target01 = previewPoint(u0, v1), target11 = previewPoint(u1, v1);
          this._drawTriangle(context, previewImage, [source00, source10, source11], [target00, target10, target11]);
          this._drawTriangle(context, previewImage, [source00, source11, source01], [target00, target11, target01]);
        }
      }
      context.save();
      context.setLineDash([5, 5]);
      context.strokeStyle = "rgba(255, 214, 78, .9)";
      context.lineWidth = 2;
      context.beginPath(); context.moveTo(baseX, topY); context.lineTo(baseX, topY + drawHeight); context.stroke();
      context.setLineDash([]);
      context.strokeStyle = "rgba(65, 225, 210, .95)";
      context.beginPath();
      for (let step = 0; step <= 48; step += 1) {
        const v = step / 48;
        const x = baseX + segment.headCurvature * curvePad * this._headCurveProfile(v);
        const y = topY + drawHeight * v;
        if (!step) context.moveTo(x, y); else context.lineTo(x, y);
      }
      context.stroke(); context.restore();
    }
    _syncGuideToggle(supported = true) {
      const button = this.els.attackTrailGuideToggle;
      if (!button) return;
      const drawing = supported && this.enabled && this.workspaceMode === "draw";
      button.hidden = !drawing;
      button.disabled = !drawing;
      button.classList.toggle("active", this.guidesVisible);
      button.setAttribute("aria-pressed", this.guidesVisible ? "true" : "false");
      button.title = this.guidesVisible ? "隐藏攻击拖尾棍子" : "显示攻击拖尾棍子";
      this._syncToolbar(supported);
    }
    _syncToolbar(supported = true) {
      const activeWorkspace = supported && this.enabled && Boolean(this.workspaceMode);
      const pathButton = this.els.attackTrailPathToggle;
      if (pathButton) {
        pathButton.hidden = !activeWorkspace;
        pathButton.disabled = !activeWorkspace;
        pathButton.classList.toggle("active", this.pathVisible);
        pathButton.setAttribute("aria-pressed", this.pathVisible ? "true" : "false");
        pathButton.title = this.pathVisible ? "隐藏拖尾轨迹虚线" : "显示拖尾轨迹虚线";
      }
      const previewButton = this.els.attackTrailPreview;
      if (previewButton) {
        const drawing = activeWorkspace && this.workspaceMode === "draw";
        previewButton.hidden = !drawing;
        previewButton.disabled = !drawing || (this._segment()?.sticks.length || 0) < 2;
        previewButton.classList.toggle("active", this.previewing);
        previewButton.textContent = this.previewing ? "停止预览" : "拖尾预览";
      }
    }
    _readDataUrl(file) { return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result || "")); reader.onerror = () => reject(reader.error || new Error("读取失败")); reader.readAsDataURL(file); }); }
    _escape(value) { return String(value || "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character])); }
  }

  AttackTrailEditor.smoothSticks = smoothTrailSticks;
  AttackTrailEditor.lifecycleOrigin = attackTrailLifecycleOrigin;
  if (typeof window !== "undefined") window.AttackTrailEditor = AttackTrailEditor;
  if (typeof module !== "undefined" && module.exports) module.exports = {
    applyAttackTrailPresetStyle,
    attackTrailLifecycleOrigin,
    preferredAttackTrailSegment,
    resolveAttackTrailContextSegmentId,
    smoothTrailSticks,
    upsertAttackTrailPresetByName,
  };
}());
