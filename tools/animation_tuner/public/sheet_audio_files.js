(function exposeSheetAudioFiles(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.FrameTunerSheetAudioFiles = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createSheetAudioFiles() {
  "use strict";

  const types = Object.freeze({ wav: "audio/wav", mp3: "audio/mpeg", ogg: "audio/ogg", opus: "audio/ogg", m4a: "audio/mp4", aac: "audio/aac", flac: "audio/flac", webm: "audio/webm" });
  const normalize = (value) => String(value).replace(/\\/g, "/").replace(/^(\.\/)+/, "");
  const basename = (value) => normalize(value).split("/").at(-1);
  const mimeType = (value) => types[String(value).split(".").at(-1).toLowerCase()] || "";
  function fail(code, files = []) {
    const error = new Error(code);
    error.code = code;
    error.files = files;
    throw error;
  }

  // File inputs normally expose basenames only. Keep each JSON reference intact
  // for the API, and never assign one selected file to two different references.
  function match(sheet, selected) {
    if (!sheet?.audio) return [];
    const descriptors = sheet.audio.files ?? [], events = sheet.audio.events ?? [];
    if (!Array.isArray(descriptors) || !Array.isArray(events) || (!descriptors.length && events.length)) fail("invalid_sheet_audio_files");
    const references = new Set(), ids = new Set();
    const entries = descriptors.map((descriptor) => {
      const file = descriptor?.file;
      if (typeof file !== "string" || !file || /^[a-z][a-z0-9+.-]*:/i.test(file) || /^[\\/]/.test(file) || !mimeType(file) || references.has(file) || (descriptor.id && ids.has(String(descriptor.id)))) fail("invalid_sheet_audio_files");
      references.add(file);
      if (descriptor.id) ids.add(String(descriptor.id));
      return { file, normalized: normalize(file), selected: null };
    });
    const candidates = Array.from(selected || []).map((file) => ({ file, path: normalize(file.webkitRelativePath || file.name), used: false }));
    for (const entry of entries) {
      const exact = candidates.filter((candidate) => candidate.path === entry.normalized);
      if (exact.length > 1 || (exact.length === 1 && exact[0].used)) fail("ambiguous_sheet_audio_files", [entry.file]);
      if (exact.length === 1) { entry.selected = exact[0].file; exact[0].used = true; }
    }
    const remaining = entries.filter((entry) => !entry.selected);
    for (const entry of remaining) {
      const name = basename(entry.file);
      const options = candidates.filter((candidate) => !candidate.used && basename(candidate.path) === name);
      const sameNameReferences = remaining.filter((reference) => basename(reference.file) === name);
      if (!options.length) fail("missing_sheet_audio_files", [entry.file]);
      if (options.length !== 1 || sameNameReferences.length !== 1) fail("ambiguous_sheet_audio_files", sameNameReferences.map((reference) => reference.file));
      entry.selected = options[0].file;
      options[0].used = true;
    }
    return entries.map((entry) => ({ file: entry.file, selected: entry.selected, mimeType: mimeType(entry.file) }));
  }

  return { match, mimeType };
});
