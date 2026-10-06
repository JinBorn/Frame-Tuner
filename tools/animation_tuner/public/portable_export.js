(function portableExport() {
  "use strict";
  const SCHEMA = "frame-tuner-package-v1";
  let busy = false;
  const selectExportGroup = (api, groupId) => api.selectGroup(groupId, { exportOperation: true });
  function setBusy(value) {
    busy = value;
    window.dispatchEvent(new CustomEvent("frame-tuner-export-state", { detail: { busy } }));
  }
  const safe = (value) => String(value || "animation").replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").replace(/^\.+|\.+$/g, "").slice(0, 100) || "animation";
  const clamp = (value, min, max, fallback) => Number.isFinite(Number(value)) ? Math.max(min, Math.min(max, Number(value))) : fallback;
  const status = (message) => { const element = document.querySelector("#portableExportStatus"); if (element) element.textContent = message; };
  function notify(message, callback) { status(message); callback?.(message); }
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
    const ready = new Promise((resolve, reject) => { image.onload = () => resolve(image); image.onerror = () => reject(new Error("无法解码烘焙 PNG。")); });
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
          notify(`测量画布 · ${target.name} · ${sample.index + 1}/${target.samples.length}`, progress);
          const measured = await api.measureFrame(sample, { width, height, originPixelX: width / 2, originPixelY: height / 2, excludeSceneScale: true, allowProjectExport: true, bakedComposite: true, measureGeometry: true });
          bounds = unionBounds(bounds, measured && "pixels" in measured ? measured.pixels : measured);
          geometry = unionBounds(geometry, measured?.geometryBounds);
        }
      }
      // A fully off-canvas sprite/prop has no pixels to touch the probe edge.
      // Geometry tells us to enlarge the probe before treating it as transparent.
      if (geometry && (geometry.left <= 2 || geometry.top <= 2 || geometry.right >= width - 3 || geometry.bottom >= height - 3)) {
        if (width >= 8192) throw new Error("素材或挂件超出 8192 px 探测范围，已阻止不完整导出。");
        width *= 2; height *= 2;
        continue;
      }
      if (!bounds) {
        if (width >= 8192) throw new Error("8192 px 范围内没有可见的动画像素，请检查素材与变换。");
        width *= 2; height *= 2;
        continue;
      }
      if (bounds.left > 2 && bounds.top > 2 && bounds.right < width - 3 && bounds.bottom < height - 3) {
        const result = { width: Math.ceil(bounds.right - bounds.left + 1 + padding * 2), height: Math.ceil(bounds.bottom - bounds.top + 1 + padding * 2), originPixelX: width / 2 - bounds.left + padding, originPixelY: height / 2 - bounds.top + padding, padding };
        if (result.width > 8192 || result.height > 8192) throw new Error("烘焙画布超过 8192 px，请减小素材或变换范围。");
        return result;
      }
      width *= 2; height *= 2;
    }
    throw new Error("可见范围超出 8192 px，已阻止裁切导出。");
  }

  async function collectPayload(options = {}) {
    if (busy) throw new Error("正在导出，请等待当前任务结束。");
    const api = window.XsxbFrameTunerLite;
    if (!api) throw new Error("编辑器导出接口尚未加载。");
    if (api.ready) await api.ready;
    if (busy) throw new Error("正在导出，请等待当前任务结束。");
    const original = api.current();
    if (!original.ready) throw new Error("请先创建项目并导入帧序列。");
    const format = options.format || "sequence";
    if (!["sequence", "sheet", "cocos"].includes(format)) throw new Error(`不支持的导出格式：${format}`);
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
    setBusy(true);
    setButtonsDisabled(true);
    api.stopPlayback?.();
    try {
      const groups = options.scope === "profile" ? api.exportGroups() : (api.groups?.() || api.exportGroups({ allProfiles: true }));
      for (const group of groups) {
        const selected = await selectExportGroup(api, group.groupId || group.uiId);
        const samples = api.timeline();
        if (!samples.length) continue;
        targets.push({ ...group, ...selected, groupId: selected.groupId || group.groupId, name: group.name || selected.animationId, samples, audio: api.audio(samples) });
      }
      if (!targets.length) throw new Error("项目没有可播放帧；禁用帧不参与烘焙。");
      const layout = await measure(api, targets, padding, options.onProgress);
      manifest.canvas = { width: layout.width, height: layout.height, origin: { x: layout.originPixelX, y: layout.originPixelY }, padding };
      const renderOptions = { ...layout, excludeSceneScale: true, allowProjectExport: true, bakedComposite: true };
      const audioByKey = new Map(), audioBySource = new Map();
      for (const asset of targets.flatMap((target) => target.audio?.assets || [])) {
        const identity = String(asset.path || asset.source || asset.key);
        let packaged = audioBySource.get(identity);
        if (!packaged) {
          const response = await fetch(asset.source);
          if (!response.ok) throw new Error(`无法读取音效：${asset.name}`);
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
        if (format === "sheet" && (sheetWidth > 16384 || sheetHeight > 16384 || sheetWidth * sheetHeight > 120000000)) throw new Error(`${target.name} 的图集 ${sheetWidth}×${sheetHeight} 过大，请改用 PNG 序列。`);
        const sheet = format === "sheet" ? document.createElement("canvas") : null;
        if (sheet) { sheet.width = sheetWidth; sheet.height = sheetHeight; }
        const sheetContext = sheet?.getContext("2d");
        const atlasEntries = {};
        let elapsedMs = 0;
        for (let index = 0; index < target.samples.length; index += 1) {
          const sample = target.samples[index];
          notify(`烘焙 ${targetIndex + 1}/${targets.length} · ${target.name} · ${index + 1}/${target.samples.length}`, options.onProgress);
          const data = await api.renderFrame(sample, renderOptions);
          const metadata = api.frameMetadata?.(sample, renderOptions) || api.exportMetadata?.(sample, renderOptions);
          if (!metadata) throw new Error("编辑器未提供帧变换与框体元数据，已阻止不完整导出。");
          const filename = `frame_${String(index + 1).padStart(4, "0")}.png`;
          const audio = (target.audio?.events || []).filter((event) => event.outputFrameIndex === index).map((event) => {
            const asset = audioByKey.get(event.assetKey);
            if (!asset) throw new Error("帧音效缺少打包资源。");
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
      setBusy(false); setButtonsDisabled(false);
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
    // Request the directory while the button still has browser user activation.
    const directory = options.destination === "directory" ? await window.showDirectoryPicker({ mode: "readwrite", id: "frame-tuner-export" }) : null;
    const payload = await collectPayload(options);
    notify("打包原始数据与烘焙资源…", options.onProgress);
    const result = await requestPackage(payload);
    if (directory) {
      const handle = await directory.getFileHandle(result.filename, { create: true });
      const writer = await handle.createWritable();
      try { await writer.write(result.blob); } finally { await writer.close(); }
    } else if (options.download !== false) {
      const url = URL.createObjectURL(result.blob), anchor = document.createElement("a");
      anchor.href = url; anchor.download = result.filename; anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    }
    notify(`已导出 ${payload.manifest.animations.length} 个动作 · ${result.filename}`, options.onProgress);
    return { ...result, manifest: payload.manifest };
  }

  function setButtonsDisabled(disabled) {
    document.querySelectorAll("#portableExportPanel button").forEach((button) => { button.disabled = disabled; });
  }
  function initialize() {
    if (document.querySelector("#portableExportPanel")) return;
    const slot = document.querySelector("#exportPanelSlot");
    const save = document.querySelector("#save");
    if (!slot && !save) return;
    const panel = document.createElement("details");
    panel.id = "portableExportPanel"; panel.className = "panel portableExportPanel"; panel.open = true;
    panel.innerHTML = `<summary><h2>导出资源包</h2></summary><div class="portableExportBody"><p class="muted">透明烘焙 · 时序、框体、音效与可编辑源数据</p><div class="fieldRow"><label>边距 px<input id="portablePadding" type="number" min="0" max="1024" value="24"></label><label>图集列数<input id="portableColumns" type="number" min="1" max="64" value="8"></label></div><label>导出方式<select id="portableDestination"><option value="download">下载 ZIP</option>${typeof window.showDirectoryPicker === "function" ? '<option value="directory">选择目录保存 ZIP</option>' : ""}</select></label><div class="portableExportActions"><button type="button" data-export-format="sequence">PNG 序列</button><button type="button" data-export-format="sheet">Sheet + JSON</button><button type="button" data-export-format="cocos">Cocos 3.8.8</button></div><p id="portableExportStatus" role="status" aria-live="polite">导出全部素材集与动作，禁用帧保留在源数据中。</p></div>`;
    if (slot) slot.append(panel); else save.before(panel);
    panel.querySelectorAll("[data-export-format]").forEach((button) => button.addEventListener("click", () => {
      exportProject({ format: button.dataset.exportFormat, padding: document.querySelector("#portablePadding").value, columns: document.querySelector("#portableColumns").value, destination: document.querySelector("#portableDestination").value }).catch((error) => status(error.name === "AbortError" ? "已取消导出" : `导出失败：${error.message}`));
    }));
    const oldPanel = document.querySelector("#liteExportPanel");
    if (oldPanel) {
      oldPanel.open = false;
      const heading = oldPanel.querySelector("summary h2");
      if (heading) heading.textContent = "兼容：直接导出到目录";
    }
  }
  window.FrameTunerPortable = { schema: SCHEMA, busy: () => busy, collectPayload, exportProject, requestPackage, initialize };
  window.addEventListener("xsxb-frame-tuner-config", initialize);
  initialize();
})();
