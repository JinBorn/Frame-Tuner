(function portableExport() {
  "use strict";
  const SCHEMA = "frame-tuner-package-v1";
  let activeOperation = null;
  let statusMessage = { key: "ready", values: {} };
  const messages = {
    zh: {
      title: "导出资源包", description: "透明烘焙 · 时序、框体、音效与可编辑源数据", padding: "边距 px", columns: "图集列数", destination: "导出方式",
      download: "下载 ZIP", directory: "选择目录保存 ZIP", sequence: "PNG 序列", sheet: "Sheet + JSON", cocos: "Cocos 3.8.8", legacyTitle: "兼容：直接导出到目录",
      ready: "导出全部素材集与动作，禁用帧保留在源数据中。", choosingDirectory: "请选择 ZIP 保存目录…", preparing: "准备导出…",
      measuring: "测量画布 · {name} · {frame}/{frames}", baking: "烘焙 {animation}/{animations} · {name} · {frame}/{frames}", packaging: "打包原始数据与烘焙资源…",
      saving: "保存 ZIP · {filename}", downloading: "正在发起 ZIP 下载 · {filename}", saved: "已保存 {count} 个动作 · {filename}", downloadStarted: "已发起下载，包含 {count} 个动作 · {filename}", packaged: "资源包已就绪，包含 {count} 个动作 · {filename}",
      cancelled: "已取消导出", failed: "导出失败：{error}", busy: "正在导出，请等待当前任务结束。", editorBusy: "请等待项目保存或加载完成后再导出。", missingApi: "编辑器导出接口尚未加载。", missingProject: "请先创建项目并导入帧序列。", projectNotReady: "项目尚未就绪，请等待加载或先导入帧序列。",
      unsupportedFormat: "不支持的导出格式：{format}", decodeFailed: "无法解码烘焙 PNG。", geometryTooLarge: "素材或挂件超出 8192 px 探测范围，已阻止不完整导出。",
      noPixels: "8192 px 范围内没有可见的动画像素，请检查素材与变换。", canvasTooLarge: "烘焙画布超过 8192 px，请减小素材或变换范围。", clipped: "可见范围超出 8192 px，已阻止裁切导出。",
      noFrames: "项目没有可播放帧；禁用帧不参与烘焙。", audioReadFailed: "无法读取音效：{name}", sheetTooLarge: "{name} 的图集 {width}×{height} 过大，请改用 PNG 序列。",
      missingMetadata: "编辑器未提供帧变换与框体元数据，已阻止不完整导出。", missingAudio: "帧音效缺少打包资源。", directoryUnavailable: "当前浏览器不支持目录选择，请使用下载 ZIP。",
    },
    en: {
      title: "Export package", description: "Transparent frames · timing, boxes, audio and editable source", padding: "Padding px", columns: "Sheet columns", destination: "Destination",
      download: "Download ZIP", directory: "Save ZIP to a folder", sequence: "PNG sequence", sheet: "Sheet + JSON", cocos: "Cocos 3.8.8", legacyTitle: "Legacy: export files to a folder",
      ready: "Exports every profile and animation. Disabled frames remain in the editable source.", choosingDirectory: "Choose a folder for the ZIP…", preparing: "Preparing export…",
      measuring: "Measuring canvas · {name} · {frame}/{frames}", baking: "Baking {animation}/{animations} · {name} · {frame}/{frames}", packaging: "Packaging source data and baked assets…",
      saving: "Saving ZIP · {filename}", downloading: "Starting ZIP download · {filename}", saved: "Saved {count} animation{plural} · {filename}", downloadStarted: "Download started with {count} animation{plural} · {filename}", packaged: "Package ready with {count} animation{plural} · {filename}",
      cancelled: "Export cancelled", failed: "Export failed: {error}", busy: "An export is in progress. Wait for it to finish.", editorBusy: "Wait for the project to finish saving or loading before exporting.", missingApi: "The editor export API has not loaded.", missingProject: "Create a project and import frames first.", projectNotReady: "The project is not ready. Wait for loading or import frames first.",
      unsupportedFormat: "Unsupported export format: {format}", decodeFailed: "Could not decode the baked PNG.", geometryTooLarge: "An image or attachment exceeds the 8192 px probe. Incomplete export was prevented.",
      noPixels: "No visible animation pixels within 8192 px. Check the assets and transforms.", canvasTooLarge: "The baked canvas exceeds 8192 px. Reduce the asset size or transform range.", clipped: "Visible content exceeds 8192 px. Cropped export was prevented.",
      noFrames: "The project has no playable frames. Disabled frames are excluded from baking.", audioReadFailed: "Could not read audio: {name}", sheetTooLarge: "The {name} sheet is too large ({width}×{height}). Export a PNG sequence instead.",
      missingMetadata: "Frame transform and box metadata is missing. Incomplete export was prevented.", missingAudio: "A frame audio event has no packaged asset.", directoryUnavailable: "This browser does not support choosing a folder. Use Download ZIP instead.",
    },
  };
  function t(key, values = {}) {
    const language = document.documentElement.lang.startsWith("en") ? "en" : "zh";
    return String(messages[language][key] || key).replace(/\{(\w+)\}/g, (_, name) => {
      if (name === "plural") return Number(values.count) === 1 ? "" : "s";
      const value = values[name];
      return value?.portableTranslation ? t(value.portableTranslation.key, value.portableTranslation.values) : String(value?.message ?? value ?? "");
    });
  }
  function exportError(key, values = {}) {
    const error = new Error(t(key, values));
    error.portableTranslation = { key, values };
    return error;
  }
  const busy = () => activeOperation !== null;
  function checkEditorOperation(current) {
    if (current?.saving || current?.loading) throw exportError("editorBusy");
  }
  const selectExportGroup = (api, groupId) => api.selectGroup(groupId, { exportOperation: true });
  function beginOperation() {
    if (busy()) throw exportError("busy");
    activeOperation = Symbol("export");
    setButtonsDisabled(true);
    window.dispatchEvent(new CustomEvent("frame-tuner-export-state", { detail: { busy: true } }));
    return activeOperation;
  }
  function endOperation(operation) {
    if (activeOperation !== operation) return;
    activeOperation = null;
    setButtonsDisabled(false);
    window.dispatchEvent(new CustomEvent("frame-tuner-export-state", { detail: { busy: false } }));
  }
  const safe = (value) => String(value || "animation").replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").replace(/^\.+|\.+$/g, "").slice(0, 100) || "animation";
  const clamp = (value, min, max, fallback) => Number.isFinite(Number(value)) ? Math.max(min, Math.min(max, Number(value))) : fallback;
  function renderStatus() { const element = document.querySelector("#portableExportStatus"); if (element) element.textContent = t(statusMessage.key, statusMessage.values); }
  function notify(key, values = {}, callback) { statusMessage = { key, values }; renderStatus(); callback?.(t(key, values)); }
  function unionBounds(a, b) {
    if (!b) return a;
    return a ? { left: Math.min(a.left, b.left), top: Math.min(a.top, b.top), right: Math.max(a.right, b.right), bottom: Math.max(a.bottom, b.bottom) } : { ...b };
  }
  async function toDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(reader.error); reader.readAsDataURL(blob);
    });
  }
  async function decodeImage(data) {
    const image = new Image();
    const ready = new Promise((resolve, reject) => { image.onload = () => resolve(image); image.onerror = () => reject(exportError("decodeFailed")); });
    image.src = data;
    return ready;
  }

  async function measure(api, targets, padding, progress) {
    let width = 1024, height = 1024;
    while (width <= 8192) {
      let bounds = null, geometry = null;
      for (const target of targets) {
        await selectExportGroup(api, target.groupId);
        for (const sample of target.samples) {
          notify("measuring", { name: target.name, frame: sample.index + 1, frames: target.samples.length }, progress);
          const measured = await api.measureFrame(sample, { width, height, originPixelX: width / 2, originPixelY: height / 2, excludeSceneScale: true, allowProjectExport: true, bakedComposite: true, measureGeometry: true });
          bounds = unionBounds(bounds, measured && "pixels" in measured ? measured.pixels : measured);
          geometry = unionBounds(geometry, measured?.geometryBounds);
        }
      }
      // A fully off-canvas sprite/prop has no pixels to touch the probe edge.
      // Geometry tells us to enlarge the probe before treating it as transparent.
      if (geometry && (geometry.left <= 2 || geometry.top <= 2 || geometry.right >= width - 3 || geometry.bottom >= height - 3)) {
        if (width >= 8192) throw exportError("geometryTooLarge");
        width *= 2; height *= 2;
        continue;
      }
      if (!bounds) {
        if (width >= 8192) throw exportError("noPixels");
        width *= 2; height *= 2;
        continue;
      }
      if (bounds.left > 2 && bounds.top > 2 && bounds.right < width - 3 && bounds.bottom < height - 3) {
        const result = { width: Math.ceil(bounds.right - bounds.left + 1 + padding * 2), height: Math.ceil(bounds.bottom - bounds.top + 1 + padding * 2), originPixelX: width / 2 - bounds.left + padding, originPixelY: height / 2 - bounds.top + padding, padding };
        if (result.width > 8192 || result.height > 8192) throw exportError("canvasTooLarge");
        return result;
      }
      width *= 2; height *= 2;
    }
    throw exportError("clipped");
  }

  async function collectPayload(options = {}) {
    if (busy()) throw exportError("busy");
    const api = window.XsxbFrameTunerLite;
    if (!api) throw exportError("missingApi");
    // Initial editor loading must still be allowed to select its first group.
    if (api.ready) await api.ready;
    checkEditorOperation(api.current());
    const operation = beginOperation();
    try { return await collectPayloadContents(options); }
    finally { endOperation(operation); }
  }

  // Only operation owners call this function. Public collectPayload owns its
  // bake transaction; exportProject keeps its own lock through packaging/save.
  async function collectPayloadContents(options) {
    const api = window.XsxbFrameTunerLite;
    if (!api) throw exportError("missingApi");
    if (api.ready) await api.ready;
    const original = api.current();
    checkEditorOperation(original);
    if (!original.ready) throw exportError("missingProject");
    const format = options.format || "sequence";
    if (!["sequence", "sheet", "cocos"].includes(format)) throw exportError("unsupportedFormat", { format });
    const columns = Math.round(clamp(options.columns, 1, 64, 8));
    const padding = Math.round(clamp(options.padding, 0, 1024, 24));
    const files = [], targets = [];
    const manifest = {
      schema: SCHEMA, version: 1, projectId: original.projectId, format,
      generator: { name: "Frame Tuner", version: "1", renderer: "browser-canvas" },
      bakedVisual: true,
      coordinateSystem: { unit: "pixel", x: "right", y: "down", origin: "frame.origin in output pixels; boxes relative to origin", rotation: "degrees-clockwise" },
      animations: [],
    };
    const source = api.snapshotProject?.();
    api.stopPlayback?.();
    try {
      const groups = options.scope === "profile" ? api.exportGroups() : (api.groups?.() || api.exportGroups({ allProfiles: true }));
      for (const group of groups) {
        const selected = await selectExportGroup(api, group.groupId || group.uiId);
        const samples = api.timeline();
        if (!samples.length) continue;
        targets.push({ ...group, ...selected, groupId: selected.groupId || group.groupId, name: group.name || selected.animationId, samples, audio: api.audio(samples) });
      }
      if (!targets.length) throw exportError("noFrames");
      const layout = await measure(api, targets, padding, options.onProgress);
      manifest.canvas = { width: layout.width, height: layout.height, origin: { x: layout.originPixelX, y: layout.originPixelY }, padding };
      const renderOptions = { ...layout, excludeSceneScale: true, allowProjectExport: true, bakedComposite: true };
      const audioByKey = new Map(), audioBySource = new Map();
      for (const asset of targets.flatMap((target) => target.audio?.assets || [])) {
        const identity = String(asset.path || asset.source || asset.key);
        let packaged = audioBySource.get(identity);
        if (!packaged) {
          const response = await fetch(asset.source);
          if (!response.ok) throw exportError("audioReadFailed", { name: asset.name });
          const blob = await response.blob();
          const name = safe(String(asset.path || asset.name || "audio.wav").split(/[\\/]/).pop());
          packaged = { path: `audio/${audioBySource.size + 1}_${name}`, type: asset.type || blob.type, name: asset.name || name };
          files.push({ path: packaged.path, data: await toDataUrl(blob) });
          audioBySource.set(identity, packaged);
        }
        audioByKey.set(asset.key, packaged);
      }
      for (let targetIndex = 0; targetIndex < targets.length; targetIndex += 1) {
        const target = targets[targetIndex];
        const current = await selectExportGroup(api, target.groupId);
        const folder = `animations/${String(targetIndex + 1).padStart(3, "0")}_${safe(target.profileId)}_${safe(target.animationId)}`;
        const animation = { id: `${target.profileId}/${target.animationId}`, profileId: target.profileId, name: target.name, loop: current.loop !== false, sourceFacesLeft: current.sourceFacesLeft === true, frames: [] };
        const actualColumns = Math.min(columns, target.samples.length);
        const sheetWidth = layout.width * actualColumns, sheetHeight = layout.height * Math.ceil(target.samples.length / actualColumns);
        if (format === "sheet" && (sheetWidth > 16384 || sheetHeight > 16384 || sheetWidth * sheetHeight > 120000000)) throw exportError("sheetTooLarge", { name: target.name, width: sheetWidth, height: sheetHeight });
        const sheet = format === "sheet" ? document.createElement("canvas") : null;
        if (sheet) { sheet.width = sheetWidth; sheet.height = sheetHeight; }
        const sheetContext = sheet?.getContext("2d");
        const atlasEntries = {};
        let elapsedMs = 0;
        for (let index = 0; index < target.samples.length; index += 1) {
          const sample = target.samples[index];
          notify("baking", { animation: targetIndex + 1, animations: targets.length, name: target.name, frame: index + 1, frames: target.samples.length }, options.onProgress);
          const data = await api.renderFrame(sample, renderOptions);
          const metadata = api.frameMetadata?.(sample, renderOptions) || api.exportMetadata?.(sample, renderOptions);
          if (!metadata) throw exportError("missingMetadata");
          const filename = `frame_${String(index + 1).padStart(4, "0")}.png`;
          const audio = (target.audio?.events || []).filter((event) => event.outputFrameIndex === index).map((event) => {
            const asset = audioByKey.get(event.assetKey);
            if (!asset) throw exportError("missingAudio");
            return { path: asset.path, volume: clamp(event.volume, 0, 1, 1), timeMs: event.timeMs, sourceFrame: event.sourceFrameIndex };
          });
          const frame = { ...metadata, sourceFrame: metadata.sourceFrame ?? sample.frameIndex, durationMs: sample.durationMs, timeMs: elapsedMs, bakedSampleTimeMs: sample.time * 1000, disabled: false, path: format === "sheet" ? `${folder}/spritesheet.png` : `${folder}/${filename}`, width: layout.width, height: layout.height, origin: { x: layout.originPixelX, y: layout.originPixelY }, boxes: metadata.boxes || [], audio };
          if (format === "sheet") {
            const x = index % actualColumns * layout.width, y = Math.floor(index / actualColumns) * layout.height;
            sheetContext.drawImage(await decodeImage(data), x, y);
            frame.atlasRect = { x, y, width: layout.width, height: layout.height };
            atlasEntries[filename] = { frame: { x, y, w: layout.width, h: layout.height }, duration: sample.durationMs, sourceFrameIndex: frame.sourceFrame, rotated: false, trimmed: false };
          } else files.push({ path: frame.path, data });
          animation.frames.push(frame);
          elapsedMs += sample.durationMs;
        }
        if (sheet) {
          const usedAudioPaths = [...new Set(animation.frames.flatMap((frame) => frame.audio.map((event) => event.path)))];
          const audioFiles = usedAudioPaths.map((path, index) => {
            const asset = [...audioBySource.values()].find((entry) => entry.path === path);
            return { id: `audio_${index + 1}`, file: `../../${path}`, name: asset?.name || path.split("/").pop(), type: asset?.type || "" };
          });
          const audio = {
            schemaVersion: 1, files: audioFiles,
            events: animation.frames.flatMap((frame, index) => frame.audio.map((event) => {
              const asset = audioFiles[usedAudioPaths.indexOf(event.path)];
              return { outputFrameIndex: index, sourceFrameIndex: frame.sourceFrame, timeMs: frame.timeMs, assetId: asset.id, file: asset.file, volume: event.volume };
            })),
          };
          files.push({ path: `${folder}/spritesheet.png`, data: sheet.toDataURL("image/png") });
          files.push({ path: `${folder}/spritesheet.json`, encoding: "utf8", data: JSON.stringify({ frames: atlasEntries, meta: { app: "Frame Tuner", version: 1, image: "spritesheet.png", format: "RGBA8888", size: { w: sheetWidth, h: sheetHeight }, origin: manifest.canvas.origin }, audio }, null, 2) });
        }
        manifest.animations.push(animation);
      }
      return { projectId: original.projectId, format, manifest, files, source };
    } finally {
      if (original.groupId) await selectExportGroup(api, original.groupId).catch(() => {});
    }
  }

  async function requestPackage(payload) {
    const response = await fetch("/api/workbench/export", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
    if (!response.ok) {
      const text = await response.text();
      try { throw new Error(JSON.parse(text).error || text); } catch (error) { if (error instanceof SyntaxError) throw new Error(text); throw error; }
    }
    return { blob: await response.blob(), filename: `${safe(payload.projectId)}_${payload.format}.zip` };
  }

  async function exportProject(options = {}) {
    if (busy()) throw exportError("busy");
    try {
      const current = window.XsxbFrameTunerLite?.current();
      checkEditorOperation(current);
      if (!current?.ready) throw exportError("projectNotReady");
    } catch (error) {
      notify("failed", { error });
      throw error;
    }
    const operation = beginOperation();
    try {
      let directory = null;
      if (options.destination === "directory") {
        if (typeof window.showDirectoryPicker !== "function") throw exportError("directoryUnavailable");
        notify("choosingDirectory", {}, options.onProgress);
        // No asynchronous work may precede this call: keep browser activation.
        directory = await window.showDirectoryPicker({ mode: "readwrite", id: "frame-tuner-export" });
      }
      notify("preparing", {}, options.onProgress);
      const payload = await collectPayloadContents(options);
      notify("packaging", {}, options.onProgress);
      const result = await requestPackage(payload);
      let completed = "packaged";
      if (directory) {
        notify("saving", { filename: result.filename }, options.onProgress);
        const handle = await directory.getFileHandle(result.filename, { create: true });
        const writer = await handle.createWritable();
        try { await writer.write(result.blob); await writer.close(); }
        catch (error) { try { await writer.abort?.(); } catch {} throw error; }
        completed = "saved";
      } else if (options.download !== false) {
        notify("downloading", { filename: result.filename }, options.onProgress);
        const url = URL.createObjectURL(result.blob), anchor = document.createElement("a");
        try { anchor.href = url; anchor.download = result.filename; anchor.click(); }
        finally { setTimeout(() => URL.revokeObjectURL(url), 30000); }
        completed = "downloadStarted";
      }
      notify(completed, { count: payload.manifest.animations.length, filename: result.filename }, options.onProgress);
      return { ...result, manifest: payload.manifest };
    } catch (error) {
      notify(error.name === "AbortError" ? "cancelled" : "failed", { error });
      throw error;
    } finally {
      endOperation(operation);
    }
  }

  function setButtonsDisabled(disabled) {
    document.querySelectorAll("#portableExportPanel button, #portableExportPanel input, #portableExportPanel select").forEach((control) => { control.disabled = disabled; });
  }
  function localize() {
    document.querySelectorAll("#portableExportPanel [data-export-i18n]").forEach((element) => { element.textContent = t(element.dataset.exportI18n); });
    const legacyHeading = document.querySelector("#liteExportPanel summary h2");
    if (legacyHeading) legacyHeading.textContent = t("legacyTitle");
    renderStatus();
  }
  function initialize() {
    if (document.querySelector("#portableExportPanel")) { localize(); return; }
    const slot = document.querySelector("#exportPanelSlot");
    const save = document.querySelector("#save");
    if (!slot && !save) return;
    const panel = document.createElement("details");
    panel.id = "portableExportPanel"; panel.className = "panel portableExportPanel"; panel.open = true;
    panel.innerHTML = `<summary><h2 data-export-i18n="title"></h2></summary><div class="portableExportBody"><p class="muted" data-export-i18n="description"></p><div class="fieldRow"><label><span data-export-i18n="padding"></span><input id="portablePadding" type="number" min="0" max="1024" value="24"></label><label><span data-export-i18n="columns"></span><input id="portableColumns" type="number" min="1" max="64" value="8"></label></div><label><span data-export-i18n="destination"></span><select id="portableDestination"><option value="download" data-export-i18n="download"></option>${typeof window.showDirectoryPicker === "function" ? '<option value="directory" data-export-i18n="directory"></option>' : ""}</select></label><div class="portableExportActions"><button type="button" data-export-format="sequence" data-export-i18n="sequence"></button><button type="button" data-export-format="sheet" data-export-i18n="sheet"></button><button type="button" data-export-format="cocos" data-export-i18n="cocos"></button></div><p id="portableExportStatus" role="status" aria-live="polite"></p></div>`;
    if (slot) slot.append(panel); else save.before(panel);
    panel.querySelectorAll("[data-export-format]").forEach((button) => button.addEventListener("click", () => {
      exportProject({ format: button.dataset.exportFormat, padding: document.querySelector("#portablePadding").value, columns: document.querySelector("#portableColumns").value, destination: document.querySelector("#portableDestination").value }).catch(() => {});
    }));
    const oldPanel = document.querySelector("#liteExportPanel");
    if (oldPanel) {
      oldPanel.open = false;
    }
    localize();
    setButtonsDisabled(busy());
  }
  window.FrameTunerPortable = { schema: SCHEMA, busy, collectPayload, exportProject, requestPackage, initialize };
  window.addEventListener("xsxb-frame-tuner-config", initialize);
  new MutationObserver(localize).observe(document.documentElement, { attributes: true, attributeFilter: ["lang"] });
  initialize();
})();
