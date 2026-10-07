(function initializeWorkbenchUi() {
  "use strict";

  const byId = (id) => document.getElementById(id);
  const projectSelect = byId("projectSelect");
  const groupSelect = byId("groupSelect");
  const profileSelect = byId("profileSelect");
  const projectDialog = byId("workbenchProjectDialog");
  const importDialog = byId("workbenchImportDialog");
  const manageDialog = byId("workbenchManageDialog");
  const replaceDialog = byId("workbenchReplaceDialog");
  const state = { files: [], busy: false, featureBusy: false, ready: false, projectKind: "", capabilities: null, queued: false };
  const translations = {
    zh: {
      canvasTransformHint: "选工具后拖动画布；缩放、旋转时左右拖动。中键平移视图；浏览模式保留框体和挂件编辑。", canvasBrowse: "浏览", canvasMove: "移动", canvasScale: "缩放", canvasRotate: "旋转", numericTransformHint: "输入数值后按 Enter 或移开焦点应用；Esc 取消输入。",
      manageProject: "管理项目", renameProject: "保存名称", removeProject: "从列表移除", removeProjectHint: "移除只影响项目列表，本地素材和调参文件仍保留。重新新建同名项目不会恢复这些数据。", removeConfirm: "从列表移除项目「{name}」？本地素材和调参文件将保留。", renamed: "项目名称已更新。", removed: "项目已从列表移除，本地文件已保留。",
      newProject: "新建项目", import: "导入素材", assets: "素材库", animationLibrary: "动画资源", animations: "动作",
      noAnimations: "还没有动画，导入一组序列帧开始创作。", noMatches: "没有匹配的动作，试试其他关键词。",
      engineNeutral: "自由创作，按需导出", engineNeutralHint: "本地项目 · 可选引擎适配", inspector: "属性检查器", transform: "变换",
      emptyTitle: "让每一帧，恰到好处", emptyDescription: "导入序列帧或图集，在同一个工作台完成预览、调参与导出。",
      createFirstProject: "创建第一个项目", importFirstAnimation: "导入第一组动画", timeline: "时间轴", timelineHint: "点击选帧 · Shift 连选 · 拖入音效或图片",
      localWorkspace: "本地工作台", save: "保存", newProjectHint: "素材与调参保存在本机。随时导出到你使用的游戏引擎。",
      projectName: "项目名称", cancel: "取消", createProject: "创建项目", importTo: "导入到", importFormat: "素材格式",
      pngSequence: "PNG 序列", pngSequenceHint: "多张图片，按文件名排序", spriteSheet: "PNG + JSON 图集", spriteSheetHint: "一张图集与帧描述文件",
      chooseFiles: "点击选择或拖入 PNG 图片", noFiles: "尚未选择文件", sheetJson: "图集 JSON", profileId: "角色 / 素材集", animationId: "动作名称", fps: "播放帧率",
      sheetAudio: "配套音频（JSON 引用时必选，可多选）", sheetAudioHint: "选择 JSON 引用的全部音频。文件名需唯一；有同名文件时请重命名并更新 JSON，或使用 CLI 按路径导入。",
      missing_sheet_audio_files: "缺少配套音频：{files}。请选择 JSON 引用的全部音频文件。", ambiguous_sheet_audio_files: "无法唯一匹配音频：{files}。请重命名同名文件并更新 JSON 引用，或使用 CLI 按路径导入。",
      invalid_sheet_audio_files: "图集音频描述无效。请检查 audio.files、audio.events 及音频文件的相对路径，文件与 ID 不可重复。",
      replaceTitle: "替换现有动作", keepExisting: "保留现有动作", replaceTarget: "角色「{profile}」中已存在动作「{animation}」。",
      replaceWarning: "替换会清除该动作的逐帧调参、框体、图片挂件、音效和动作拖尾，并导入新素材及配套音频。角色级和动作组级配置、其他动作保留。", replacementCancelled: "已保留现有动作；可修改名称后重新导入。",
      importHint: "图集中的独立帧时长会保留。已有同名动作时会提示，不会直接覆盖。", startImport: "开始导入",
      choosePng: "请选择 PNG 图片。", chooseSheet: "图集导入需要一张 PNG 和一个 JSON 描述文件。", duplicateNames: "所选图片存在重复文件名，请先重命名。",
      tooManyFiles: "每次最多导入 4096 张 PNG。", invalidJson: "无法读取图集 JSON，请检查文件格式。", emptyName: "请输入项目名称。",
      invalidNames: "请填写角色与动作名称。", invalidFps: "帧率需要大于 0 且不超过 240。", reading: "正在读取素材…", importing: "正在导入…", creating: "正在创建…",
      busy: "编辑器正在保存或加载，请稍后再试。", notReady: "编辑器尚未准备好，请稍后再试。", cancelled: "已取消，原有编辑保持不变。",
      exporting: "正在导出资源包，请完成后再新建项目或导入素材。",
      imported: "已导入 {count} 帧，可以开始调参。", created: "项目已创建，导入第一组动画开始创作。", reloadDeferred: "内容已写入；当前还有新的编辑，请保存后刷新动画列表。",
      exists: "此角色已有同名动作，请更换动作名称后再导入。", neutralOnly: "网页导入用于独立项目。请新建项目后导入；当前引擎项目继续保留原有接入方式。",
      close: "关闭", fileCount: "{count} 张 PNG · {size} MB", projectPlaceholder: "例如：森林冒险", requestFailed: "请求失败（{status}）",
      independentProject: "独立项目", localAssets: "本地素材", optionalFeatures: "可选功能", petsDescription: "启用后读取本机 Codex 宠物素材，并在项目列表中显示。",
      petsEnabled: "已启用 Codex Pets，可在项目列表中选择宠物。", petsDisabled: "已关闭 Codex Pets，宠物项目已从列表隐藏。", petsUpdating: "正在更新宠物功能…",
    },
    en: {
      canvasTransformHint: "Drag to transform; drag horizontally to scale or rotate. Middle-drag pans. Browse keeps box and attachment editing.", canvasBrowse: "Browse", canvasMove: "Move", canvasScale: "Scale", canvasRotate: "Rotate", numericTransformHint: "Press Enter or leave the field to apply. Esc cancels typing.",
      manageProject: "Manage project", renameProject: "Save name", removeProject: "Remove from list", removeProjectHint: "Removal only affects the project list. Local assets and settings are kept. Creating a new project with the same name will not restore them.", removeConfirm: "Remove project {name} from the list? Local assets and settings will be kept.", renamed: "Project renamed.", removed: "Project removed from the list. Local files were kept.",
      newProject: "New project", import: "Import assets", assets: "Assets", animationLibrary: "Animation library", animations: "Animations",
      noAnimations: "Import a sequence to start your first animation.", noMatches: "No matching animations. Try another search.",
      engineNeutral: "Create freely. Export anywhere.", engineNeutralHint: "Local project · Optional adapters", inspector: "Inspector", transform: "Transform",
      emptyTitle: "Make every frame feel right", emptyDescription: "Import a sequence or sprite sheet. Preview, fine-tune, and export in one workspace.",
      createFirstProject: "Create your first project", importFirstAnimation: "Import your first animation", timeline: "Timeline", timelineHint: "Select a frame · Shift to select a range · Drop audio or images",
      localWorkspace: "Local workspace", save: "Save", newProjectHint: "Keep assets and edits on your computer. Export to your game engine when you are ready.",
      projectName: "Project name", cancel: "Cancel", createProject: "Create project", importTo: "Import into", importFormat: "Asset format",
      pngSequence: "PNG sequence", pngSequenceHint: "Multiple images, sorted by filename", spriteSheet: "PNG + JSON sheet", spriteSheetHint: "One atlas and its frame metadata",
      chooseFiles: "Choose or drop PNG images", noFiles: "No files selected", sheetJson: "Sprite sheet JSON", profileId: "Character / asset set", animationId: "Animation name", fps: "Frame rate",
      sheetAudio: "Companion audio (required when referenced; select multiple)", sheetAudioHint: "Select every audio file referenced by the JSON. Filenames must be unique; rename duplicates and update the JSON, or use the CLI to import by path.",
      missing_sheet_audio_files: "Missing companion audio: {files}. Select every audio file referenced by the JSON.", ambiguous_sheet_audio_files: "Audio cannot be matched uniquely: {files}. Rename duplicate files and update the JSON references, or use the CLI to import by path.",
      invalid_sheet_audio_files: "Invalid sheet audio metadata. Check audio.files, audio.events, and relative audio paths; files and IDs must be unique.",
      replaceTitle: "Replace existing animation", keepExisting: "Keep existing animation", replaceTarget: "Character “{profile}” already has an animation named “{animation}”.",
      replaceWarning: "Replacement clears this animation’s per-frame tuning, boxes, image attachments, audio, and attack trail, then imports the new assets and companion audio. Character and animation-group settings, and other animations, are preserved.", replacementCancelled: "Existing animation kept. Change the name to import separately.",
      importHint: "Per-frame timings in the sheet are preserved. An existing animation will never be replaced without asking.", startImport: "Import animation",
      choosePng: "Choose PNG images to import.", chooseSheet: "A sheet import requires exactly one PNG and one JSON metadata file.", duplicateNames: "Some images have the same filename. Rename them before importing.",
      tooManyFiles: "Import up to 4096 PNG images at a time.", invalidJson: "Could not read the sprite sheet JSON. Check its format.", emptyName: "Enter a project name.",
      invalidNames: "Enter a character and animation name.", invalidFps: "Frame rate must be greater than 0 and at most 240.", reading: "Reading assets…", importing: "Importing…", creating: "Creating…",
      busy: "The editor is saving or loading. Please try again shortly.", notReady: "The editor is not ready yet. Please try again shortly.", cancelled: "Cancelled. Your current edits are unchanged.",
      exporting: "An export is in progress. Wait for it to finish before creating a project or importing assets.",
      imported: "Imported {count} frames. Ready to fine-tune.", created: "Project created. Import your first animation to begin.", reloadDeferred: "Content was written. Save your new edits, then refresh the animation list.",
      exists: "This character already has an animation with that name. Choose a different animation name.", neutralOnly: "Web imports use independent projects. Create a new project to import assets; bound engine projects keep their existing import workflow.",
      close: "Close", fileCount: "{count} PNG images · {size} MB", projectPlaceholder: "For example: Forest Adventure", requestFailed: "Request failed ({status})",
      independentProject: "Independent project", localAssets: "Local assets", optionalFeatures: "Optional features", petsDescription: "When enabled, local Codex pet assets are read and shown in the project list.",
      petsEnabled: "Codex Pets enabled. Select a pet project from the project list.", petsDisabled: "Codex Pets disabled. Pet projects are hidden from the list.", petsUpdating: "Updating pet integration…",
    },
  };
  const t = (key, values = {}) => {
    const language = document.documentElement.lang.startsWith("en") ? "en" : "zh";
    return String(translations[language][key] || key).replace(/\{(\w+)\}/g, (_, name) => String(values[name] ?? ""));
  };
  const activeProjectId = () => projectSelect.value || "";
  const mode = () => importDialog.querySelector('input[name="importMode"]:checked').value;
  const projectName = () => projectSelect.selectedOptions[0]?.textContent || activeProjectId();

  function notice(message) {
    const target = byId("status");
    target.textContent = message;
    target.title = message;
    target.hidden = !message;
  }

  function showError(id, error) {
    const target = byId(id);
    target.textContent = error?.code === "animation_exists" ? t("exists") : translations.zh[error?.code] ? t(error.code, { files: error.files?.join("、") || "" }) : String(error?.message || error || "");
    target.hidden = !target.textContent;
  }

  function applyLanguage() {
    document.querySelectorAll("[data-workbench-i18n]").forEach((node) => { node.textContent = t(node.dataset.workbenchI18n); });
    document.querySelectorAll("[data-close-dialog]").forEach((node) => {
      if (node.classList.contains("dialogClose")) node.setAttribute("aria-label", t("close"));
    });
    byId("workbenchProjectName").placeholder = t("projectPlaceholder");
    updateFileSummary();
    scheduleSync();
  }

  function updateFileSummary() {
    const total = state.files.reduce((sum, file) => sum + file.size, 0);
    const summary = state.files.length ? t("fileCount", { count: state.files.length, size: (total / 1048576).toFixed(1) }) : t("noFiles");
    byId("workbenchFileSummary").textContent = summary;
    byId("workbenchFileSummary").title = state.files.map((file) => file.name).join("\n");
  }

  function setFiles(files) {
    const selected = Array.from(files);
    state.files = [];
    updateFileSummary();
    if (selected.some((file) => !/\.png$/i.test(file.name))) throw new Error(t("choosePng"));
    if (selected.length > 4096) throw new Error(t("tooManyFiles"));
    if (mode() === "sheet" && selected.length > 1) throw new Error(t("chooseSheet"));
    if (new Set(selected.map((file) => file.name.toLowerCase())).size !== selected.length) throw new Error(t("duplicateNames"));
    state.files = selected.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    updateFileSummary();
    showError("workbenchImportError", "");
  }

  function setBusy(busy, progress = "") {
    state.busy = busy;
    for (const dialog of [projectDialog, importDialog, manageDialog]) {
      dialog.setAttribute("aria-busy", String(busy));
      dialog.querySelectorAll("button, input").forEach((element) => { element.disabled = busy; });
    }
    byId("workbenchImportProgress").textContent = progress;
    byId("workbenchProjectSubmit").textContent = busy && projectDialog.open ? t("creating") : t("createProject");
  }

  async function request(url, payload) {
    const response = await fetch(url, payload === undefined ? { cache: "no-store" } : {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(result.error || t("requestFailed", { status: response.status }));
      error.code = result.code;
      error.status = response.status;
      throw error;
    }
    return result;
  }

  async function acquireDiscardToken() {
    if (window.FrameTunerPortable?.busy?.()) throw new Error(t("exporting"));
    if (!window.FrameTunerWorkbench?.confirmDiscard || !window.FrameTunerWorkbench?.reload) throw new Error(t("notReady"));
    if (window.FrameTunerWorkbench.ready) await window.FrameTunerWorkbench.ready;
    return window.FrameTunerWorkbench.confirmDiscard();
  }

  async function reloadAfterWrite(projectId, token, message) {
    try {
      const loaded = await window.FrameTunerWorkbench.reload(projectId, { discardToken: token });
      notice(loaded ? message : t("reloadDeferred"));
      scheduleSync();
      return loaded;
    } catch (error) {
      // The write succeeded. Do not leave a submit action that would repeat it.
      notice(`${t("reloadDeferred")} ${error.message}`);
      return false;
    }
  }

  function openProjectDialog() {
    if (state.busy || state.featureBusy) return;
    if (window.FrameTunerPortable?.busy?.()) { notice(t("exporting")); return; }
    showError("workbenchProjectError", "");
    projectDialog.showModal();
    byId("workbenchProjectName").focus();
  }

  function openImportDialog() {
    if (state.busy || state.featureBusy) return;
    if (window.FrameTunerPortable?.busy?.()) { notice(t("exporting")); return; }
    if (!activeProjectId()) return openProjectDialog();
    if (state.projectKind && state.projectKind !== "frame_lite") {
      notice(t("neutralOnly"));
      return;
    }
    byId("workbenchImportProject").textContent = projectName();
    const profile = profileSelect.value;
    if (profile && profile !== "all") byId("workbenchProfileId").value = profile;
    showError("workbenchImportError", "");
    importDialog.showModal();
  }

  byId("workbenchManageProject").addEventListener("click", () => {
    if (state.busy || state.featureBusy || window.FrameTunerPortable?.busy?.()) return;
    const project = window.FrameTunerWorkbench.projects().find((entry) => entry.id === activeProjectId());
    if (!project || project.kind === "codex_pets") return;
    manageDialog.dataset.projectId = project.id;
    byId("workbenchManageName").value = project.label;
    showError("workbenchManageError", "");
    manageDialog.showModal();
    byId("workbenchManageName").focus();
  });
  async function manageProject(action) {
    if (state.busy) return;
    const projectId = manageDialog.dataset.projectId;
    const project = window.FrameTunerWorkbench.projects().find((entry) => entry.id === projectId);
    if (!project || projectId !== activeProjectId()) return;
    const label = byId("workbenchManageName").value.trim();
    if (action === "rename" && !label) { showError("workbenchManageError", t("emptyName")); return; }
    if (action === "remove" && !window.confirm(t("removeConfirm", { name: project.label }))) return;
    setBusy(true);
    try {
      if (await window.FrameTunerWorkbench.manageProject(action, { projectId, label })) {
        manageDialog.close();
        notice(t(action === "rename" ? "renamed" : "removed"));
      }
    } catch (error) { showError("workbenchManageError", error); }
    finally { setBusy(false); scheduleSync(); }
  }
  byId("workbenchManageForm").addEventListener("submit", (event) => { event.preventDefault(); void manageProject("rename"); });
  byId("workbenchRemoveProject").addEventListener("click", () => { void manageProject("remove"); });
  byId("workbenchNewProject").addEventListener("click", openProjectDialog);
  byId("canvasTransformTool").addEventListener("change", (event) => {
    byId("stage").style.cursor = event.target.value === "move" ? "move" : event.target.value === "pan" ? "grab" : "ew-resize";
  });
  byId("workbenchEmptyCreate").addEventListener("click", openProjectDialog);
  byId("workbenchImport").addEventListener("click", openImportDialog);
  byId("workbenchEmptyImport").addEventListener("click", openImportDialog);
  byId("workbenchPetsToggle").addEventListener("click", async () => {
    if (state.busy || state.featureBusy || state.capabilities?.features?.codexPetsToggle !== true) return;
    const enabled = state.capabilities.features.codexPets !== true;
    const message = byId("workbenchFeatureStatus");
    state.featureBusy = true;
    syncFeatureSwitch();
    try {
      const token = await acquireDiscardToken();
      if (!token) return;
      message.hidden = false;
      message.textContent = t("petsUpdating");
      const result = await request("/api/workbench/codex-pets", { enabled });
      applyCapabilities(result.capabilities);
      const selectedId = activeProjectId();
      const nextId = result.projects?.some((project) => project.id === selectedId) ? selectedId : result.activeProjectId || "";
      const text = t(enabled ? "petsEnabled" : "petsDisabled");
      const loaded = await reloadAfterWrite(nextId, token, text);
      message.textContent = loaded ? text : t("reloadDeferred");
    } catch (error) {
      message.hidden = false;
      message.textContent = error.message;
    } finally {
      state.featureBusy = false;
      syncFeatureSwitch();
    }
  });
  for (const dialog of [projectDialog, importDialog, manageDialog]) {
    dialog.addEventListener("cancel", (event) => { if (state.busy) event.preventDefault(); });
    dialog.querySelectorAll("[data-close-dialog]").forEach((button) => button.addEventListener("click", () => { if (!state.busy) dialog.close(); }));
  }

  byId("workbenchProjectForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (state.busy) return;
    const label = byId("workbenchProjectName").value.trim();
    try {
      if (!label) throw new Error(t("emptyName"));
      setBusy(true);
      const token = await acquireDiscardToken();
      if (!token) { notice(t("cancelled")); return; }
      showError("workbenchProjectError", "");
      const result = await request("/api/workbench/projects", { label });
      const loaded = await reloadAfterWrite(result.projectId, token, t("created"));
      projectDialog.close();
      byId("workbenchProjectName").value = "";
      setBusy(false);
      if (loaded) openImportDialog();
    } catch (error) {
      showError("workbenchProjectError", error);
    } finally {
      setBusy(false);
    }
  });

  importDialog.querySelectorAll('input[name="importMode"]').forEach((input) => input.addEventListener("change", () => {
    const sheet = mode() === "sheet";
    byId("workbenchSheetJsonField").hidden = !sheet;
    byId("workbenchSheetAudioField").hidden = !sheet;
    byId("workbenchImageFiles").multiple = !sheet;
    byId("workbenchImageFiles").value = "";
    byId("workbenchSheetJson").value = "";
    byId("workbenchSheetAudio").value = "";
    state.files = [];
    updateFileSummary();
    showError("workbenchImportError", "");
  }));
  byId("workbenchImageFiles").addEventListener("change", (event) => {
    try { setFiles(event.target.files); } catch (error) { showError("workbenchImportError", error); }
  });
  const dropZone = byId("workbenchFileDrop");
  for (const name of ["dragenter", "dragover"]) dropZone.addEventListener(name, (event) => {
    event.preventDefault();
    if (!state.busy) dropZone.classList.add("dragOver");
  });
  for (const name of ["dragleave", "drop"]) dropZone.addEventListener(name, (event) => {
    event.preventDefault();
    dropZone.classList.remove("dragOver");
  });
  dropZone.addEventListener("drop", (event) => {
    if (state.busy) return;
    try { setFiles(event.dataTransfer?.files || []); } catch (error) { showError("workbenchImportError", error); }
  });
  function readDataUrl(file, mimeType = "image/png") {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).replace(/^data:[^;]*;/, `data:${mimeType};`));
      reader.onerror = () => reject(reader.error || new Error(`Could not read ${file.name}`));
      reader.readAsDataURL(file);
    });
  }

  function confirmReplacement(payload) {
    byId("workbenchReplaceTarget").textContent = t("replaceTarget", { profile: payload.profileId, animation: payload.animationId });
    byId("workbenchImportProgress").textContent = "";
    replaceDialog.returnValue = "cancel";
    return new Promise((resolve) => {
      replaceDialog.addEventListener("close", () => resolve(replaceDialog.returnValue === "replace"), { once: true });
      replaceDialog.showModal();
      byId("workbenchReplaceCancel").focus();
    });
  }

  byId("workbenchImportForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (state.busy) return;
    try {
      if (!state.files.length) throw new Error(t("choosePng"));
      const projectId = activeProjectId();
      const profileId = byId("workbenchProfileId").value.trim();
      const animationId = byId("workbenchAnimationId").value.trim();
      const fps = Number(byId("workbenchImportFps").value);
      if (!profileId || !animationId) throw new Error(t("invalidNames"));
      if (!Number.isFinite(fps) || fps <= 0 || fps > 240) throw new Error(t("invalidFps"));
      setBusy(true, t("reading"));
      let sheetJson;
      let audioMatches = [];
      if (mode() === "sheet") {
        const jsonFile = byId("workbenchSheetJson").files[0];
        if (state.files.length !== 1 || !jsonFile) throw new Error(t("chooseSheet"));
        try { sheetJson = JSON.parse(await jsonFile.text()); } catch { throw new Error(t("invalidJson")); }
        audioMatches = window.FrameTunerSheetAudioFiles.match(sheetJson, byId("workbenchSheetAudio").files);
      }
      let token = await acquireDiscardToken();
      if (!token) { notice(t("cancelled")); return; }
      showError("workbenchImportError", "");
      const files = [];
      for (const file of state.files) files.push({ name: file.name, data: await readDataUrl(file) });
      const audioFiles = [];
      for (const entry of audioMatches) audioFiles.push({ file: entry.file, name: entry.selected.name, data: await readDataUrl(entry.selected, entry.mimeType) });
      const payload = { projectId, profileId, animationId, fps, files, ...(sheetJson !== undefined ? { sheetJson, audioFiles } : {}) };
      byId("workbenchImportProgress").textContent = t("importing");
      let result;
      try {
        result = await request("/api/workbench/import", payload);
      } catch (error) {
        if (error.status !== 409 || error.code !== "animation_exists") throw error;
        if (!await confirmReplacement(payload)) { notice(t("replacementCancelled")); return; }
        // Confirmation may stay open while editor state changes. Obtain a fresh
        // discard token before the explicit write; never reuse the initial one.
        token = await acquireDiscardToken();
        if (!token) { notice(t("cancelled")); return; }
        byId("workbenchImportProgress").textContent = t("importing");
        result = await request("/api/workbench/import", { ...payload, replace: true });
      }
      await reloadAfterWrite(result.projectId, token, t("imported", { count: result.frameCount }));
      importDialog.close();
      byId("workbenchImageFiles").value = "";
      byId("workbenchSheetJson").value = "";
      byId("workbenchSheetAudio").value = "";
      state.files = [];
      updateFileSummary();
    } catch (error) {
      showError("workbenchImportError", error);
    } finally {
      setBusy(false);
    }
  });

  function renderAnimationList() {
    const target = byId("workbenchAnimationList");
    const focusedGroupId = target.contains(document.activeElement) ? document.activeElement.dataset.groupId : null;
    const fragment = document.createDocumentFragment();
    let count = 0;
    for (const node of groupSelect.children) {
      if (node.tagName === "OPTGROUP") {
        const heading = document.createElement("div");
        heading.className = "animationListGroup";
        heading.textContent = node.label;
        fragment.appendChild(heading);
      }
      for (const option of node.tagName === "OPTGROUP" ? node.children : [node]) {
        if (!option.value || option.disabled) continue;
        count += 1;
        const button = document.createElement("button");
        button.type = "button";
        button.className = "animationListButton";
        button.dataset.groupId = option.value;
        button.disabled = Boolean(window.FrameTunerPortable?.busy?.());
        button.setAttribute("aria-current", String(option.value === groupSelect.value));
        button.title = option.textContent;
        button.innerHTML = '<svg viewBox="0 0 20 20" aria-hidden="true"><rect x="3" y="3" width="14" height="14" rx="3"/><path d="m8 6 5 4-5 4V6Z"/></svg><span class="animationName"></span><span class="animationCount">›</span>';
        button.querySelector(".animationName").textContent = option.textContent;
        button.addEventListener("click", () => {
          if (window.FrameTunerPortable?.busy?.()) { notice(t("exporting")); return; }
          if (groupSelect.value === option.value) return;
          groupSelect.value = option.value;
          groupSelect.dispatchEvent(new Event("change", { bubbles: true }));
          scheduleSync();
        });
        fragment.appendChild(button);
      }
    }
    target.replaceChildren(fragment);
    if (focusedGroupId) Array.from(target.querySelectorAll("button")).find((button) => button.dataset.groupId === focusedGroupId)?.focus({ preventScroll: true });
    byId("workbenchAnimationCount").textContent = String(count).padStart(2, "0");
    byId("workbenchListEmpty").hidden = count > 0;
    byId("workbenchListEmpty").textContent = t(byId("groupSearch").value ? "noMatches" : "noAnimations");
  }

  function syncShell() {
    state.queued = false;
    renderAnimationList();
    const hasProject = Boolean(activeProjectId());
    byId("workbenchManageProject").hidden = state.capabilities?.features?.manageProjects !== true;
    byId("workbenchManageProject").disabled = !hasProject || state.projectKind === "codex_pets";
    const current = window.FrameTunerWorkbench?.current?.();
    if (current?.projectKind) state.projectKind = current.projectKind;
    const adapter = state.capabilities?.adapters?.find((entry) => entry.id === state.projectKind);
    document.querySelector('[data-panel="scene-scale"]').hidden = adapter?.scenes === false;
    if (hasProject && state.projectKind === "frame_lite") {
      const bindingText = `${t("independentProject")} · ${t("localAssets")}`;
      if (byId("projectBinding").textContent !== bindingText) byId("projectBinding").textContent = bindingText;
    }
    const hasFrames = byId("filmstrip").childElementCount > 0;
    byId("canvasTransformTool").disabled = !hasFrames;
    byId("workbenchEmptyState").hidden = !state.ready || hasFrames;
    byId("workbenchEmptyCreate").hidden = hasProject;
    byId("workbenchEmptyImport").hidden = !hasProject;
    document.querySelector(".inspector").classList.toggle("isEmpty", !hasFrames);
    document.querySelector(".inspectorScroll").inert = !hasFrames;
    // The old Lite entry injects before #save; keep its panel in the inspector.
    const legacyExport = byId("liteExportPanel");
    if (legacyExport && legacyExport.parentElement !== byId("exportPanelSlot")) byId("exportPanelSlot").appendChild(legacyExport);
    byId("workbenchImport").title = state.projectKind && state.projectKind !== "frame_lite" ? t("neutralOnly") : t("import");
  }

  function scheduleSync() {
    if (state.queued) return;
    state.queued = true;
    queueMicrotask(syncShell);
  }
  function syncFeatureSwitch() {
    const features = state.capabilities?.features;
    byId("workbenchOptionalFeatures").hidden = features?.codexPetsToggle !== true;
    byId("workbenchPetsToggle").setAttribute("aria-checked", String(features?.codexPets === true));
    byId("workbenchPetsToggle").disabled = state.featureBusy || features?.codexPetsToggle !== true;
  }
  function applyCapabilities(capabilities) {
    if (!capabilities) return;
    state.capabilities = capabilities;
    byId("workbenchNewProject").disabled = capabilities.features?.createProject === false;
    byId("workbenchImport").disabled = capabilities.features?.importPng === false && capabilities.features?.importSheet === false;
    syncFeatureSwitch();
    scheduleSync();
  }
  new MutationObserver(scheduleSync).observe(groupSelect, { subtree: true, childList: true });
  new MutationObserver(scheduleSync).observe(projectSelect, { subtree: true, childList: true });
  new MutationObserver(scheduleSync).observe(byId("filmstrip"), { childList: true });
  new MutationObserver(scheduleSync).observe(document.querySelector(".saveControls"), { childList: true });
  new MutationObserver(applyLanguage).observe(document.documentElement, { attributes: true, attributeFilter: ["lang"] });
  groupSelect.addEventListener("change", scheduleSync);
  window.addEventListener("frame-tuner-export-state", scheduleSync);
  byId("workbenchAnimationList").addEventListener("keydown", (event) => {
    if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
    const buttons = Array.from(byId("workbenchAnimationList").querySelectorAll("button"));
    const current = buttons.indexOf(document.activeElement);
    if (current < 0) return;
    event.preventDefault();
    const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : Math.max(0, Math.min(buttons.length - 1, current + (event.key === "ArrowDown" ? 1 : -1)));
    buttons[next]?.focus();
  });
  window.addEventListener("xsxb-frame-tuner-config", (event) => {
    state.ready = true;
    state.projectKind = event.detail?.projectKind || "";
    scheduleSync();
  });
  if (window.FrameTunerWorkbench?.ready) {
    window.FrameTunerWorkbench.ready.then(() => {
      state.ready = true;
      state.projectKind = window.FrameTunerWorkbench.current()?.projectKind || state.projectKind;
      scheduleSync();
    }).catch(() => { /* The editor reports initial configuration errors in #status. */ });
  }
  new MutationObserver(() => { byId("status").title = byId("status").textContent; }).observe(byId("status"), { childList: true });
  request("/api/workbench/capabilities").then(applyCapabilities).catch(() => { /* Individual actions display actionable request failures. */ });
  applyLanguage();
})();
