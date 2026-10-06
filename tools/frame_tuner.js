#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const net = require("node:net");
const { spawn } = require("node:child_process");
const { createWorkbenchService } = require("./workbench_service");
const { buildExportPackage, writePackageDirectory } = require("./export_package");
const { validateAttackTrails } = require("./attack_trails");

const HELP = {
  commands: {
    list: "list",
    create: "create --name NAME [--id ID]",
    import: "import --project ID --input PNG_DIRECTORY --profile PROFILE --animation ANIMATION [--fps 12] [--replace] (sheet: --input SHEET.png --json SHEET.json)",
    validate: "validate --project ID",
    export: "export --project ID --format sequence|sheet|cocos --out DIRECTORY [--zip] [--browser EXECUTABLE] [--padding 24] [--columns 8]",
  },
  environment: { FRAME_TUNER_ROOT: "Data and workspace root; defaults to this repository.", FRAME_TUNER_BROWSER: "Chrome, Edge or Chromium executable used by the canvas exporter." },
  output: "JSON on stdout; diagnostics on stderr; nonzero exit status on failure.",
  exportDependency: "Visual exports run the actual browser canvas compositor through playwright-core. Install dependencies with npm install and install Chrome/Edge/Chromium, or provide --browser.",
};

function parseArgs(argv) {
  const [command = "help", ...rest] = argv;
  const args = {};
  const boolean = new Set(["replace", "zip", "help"]);
  const known = new Set(["name", "id", "project", "input", "json", "profile", "animation", "fps", "format", "out", "browser", "padding", "columns", ...boolean]);
  for (let index = 0; index < rest.length; index += 1) {
    const item = rest[index];
    if (!item.startsWith("--")) throw new Error(`Unexpected argument: ${item}`);
    const key = item.slice(2);
    if (!known.has(key)) throw new Error(`Unknown option: --${key}`);
    if (boolean.has(key)) args[key] = true;
    else {
      if (rest[index + 1] === undefined || rest[index + 1].startsWith("--")) throw new Error(`Missing value for --${key}`);
      args[key] = rest[++index];
    }
  }
  return { command, args };
}
function required(args, key) {
  if (!args[key]) throw new Error(`--${key} is required.`);
  return args[key];
}

function validateProject(service, projectId) {
  const data = service.projectData(projectId);
  const errors = [];
  let frameCount = 0, animationCount = 0;
  if (!Array.isArray(data.manifest.profiles)) errors.push("manifest.profiles must be an array.");
  const profiles = data.manifest.profiles || [], ids = new Set();
  for (const profile of profiles) {
    if (ids.has(profile.id)) errors.push(`Duplicate profile: ${profile.id}`);
    ids.add(profile.id);
    const animations = new Set();
    for (const animation of profile.animations || []) {
      animationCount += 1;
      const id = `${profile.id}/${animation.id || animation.name}`;
      if (animations.has(id)) errors.push(`Duplicate animation: ${id}`);
      animations.add(id);
      if (!Number.isFinite(Number(animation.fps)) || Number(animation.fps) <= 0) errors.push(`${id}: FPS must be positive.`);
      if (!animation.frames?.length) errors.push(`${id}: no frames.`);
      for (const frame of animation.frames || []) {
        frameCount += 1;
        const full = path.resolve(service.root, String(frame.path || ""));
        const relative = path.relative(service.root, full);
        if (relative.startsWith("..") || path.isAbsolute(relative)) { errors.push(`${id}: asset outside workspace: ${frame.path}`); continue; }
        if (!fs.existsSync(full) || !fs.statSync(full).isFile()) { errors.push(`${id}: missing asset: ${frame.path}`); continue; }
        const buffer = fs.readFileSync(full);
        if (buffer.length < 24 || !buffer.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) { errors.push(`${id}: invalid PNG: ${frame.path}`); continue; }
        const width = buffer.readUInt32BE(16), height = buffer.readUInt32BE(20);
        if (!(Number(frame.duration ?? 1) > 0)) errors.push(`${id}: frame duration must be positive.`);
        const crop = frame.crop;
        if (crop && (![crop.x, crop.y, crop.width, crop.height].every(Number.isFinite) || crop.x < 0 || crop.y < 0 || crop.width <= 0 || crop.height <= 0 || crop.x + crop.width > width || crop.y + crop.height > height)) errors.push(`${id}: invalid crop: ${frame.name || frame.id}`);
      }
    }
  }
  for (const [key, value] of Object.entries(data.tuning.frame_playback_overrides || {})) {
    if (value?.duration !== undefined && !(Number(value.duration) > 0)) errors.push(`${key}: playback duration must be positive.`);
  }
  const validateAssetRecords = (value, label) => {
    if (Array.isArray(value)) { value.forEach((entry) => validateAssetRecords(entry, label)); return; }
    if (!value || typeof value !== "object") return;
    for (const [key, entry] of Object.entries(value)) {
      if (["path", "file"].includes(key) && typeof entry === "string" && entry) {
        let full = path.resolve(service.root, entry);
        const relative = path.relative(service.root, full);
        if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) { errors.push(`${label}: asset outside workspace: ${entry}`); continue; }
        if (!fs.existsSync(full) && entry.replaceAll("\\", "/").startsWith("tools/animation_tuner/public/")) full = path.resolve(__dirname, "..", entry);
        if (!fs.existsSync(full) || !fs.statSync(full).isFile()) errors.push(`${label}: missing asset: ${entry}`);
      } else validateAssetRecords(entry, label);
    }
  };
  validateAssetRecords(data.frameAudioBindings, "audio");
  validateAssetRecords(data.frameImageAttachments, "attachment");
  validateAssetRecords(data.attackTrails, "trail");
  errors.push(...validateAttackTrails(data.attackTrails, { profiles }));
  return { ok: errors.length === 0, projectId: data.project.id, profiles: profiles.length, animations: animationCount, frames: frameCount, errors };
}

function findBrowser(preferred) {
  const candidates = [preferred, process.env.FRAME_TUNER_BROWSER];
  if (process.platform === "win32") {
    for (const base of [process.env.PROGRAMFILES, process.env["PROGRAMFILES(X86)"], process.env.LOCALAPPDATA].filter(Boolean)) {
      candidates.push(path.join(base, "Google", "Chrome", "Application", "chrome.exe"), path.join(base, "Microsoft", "Edge", "Application", "msedge.exe"));
    }
  } else if (process.platform === "darwin") {
    candidates.push("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge", "/Applications/Chromium.app/Contents/MacOS/Chromium");
  } else {
    candidates.push("/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome", "/usr/bin/microsoft-edge");
  }
  if (preferred && !fs.existsSync(preferred)) throw new Error(`Browser executable not found: ${preferred}`);
  const found = candidates.find((candidate) => candidate && fs.existsSync(candidate));
  if (!found) throw new Error("Visual export requires Chrome, Edge or Chromium. Install one or set --browser / FRAME_TUNER_BROWSER to its executable.");
  return found;
}

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => { const port = server.address().port; server.close((error) => error ? reject(error) : resolve(port)); });
  });
}

async function startExportServer(root) {
  const port = await freePort();
  const child = spawn(process.execPath, [path.join(__dirname, "animation_tuner", "server.js")], { env: { ...process.env, FRAME_TUNER_ROOT: root, PORT: String(port), FRAME_TUNER_CODEX_PETS: "0" }, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  try {
    await new Promise((resolve, reject) => {
      let stderr = "", stdout = "";
      const timer = setTimeout(() => reject(new Error(`Export server did not start. ${stderr}`)), 30000);
      const finish = (callback, result) => { clearTimeout(timer); callback(result); };
      child.on("error", (error) => finish(reject, error));
      child.on("exit", (code) => finish(reject, new Error(`Export server exited (${code}). ${stderr}`)));
      child.stderr.on("data", (chunk) => { stderr = `${stderr}${chunk}`.slice(-8000); });
      child.stdout.on("data", (chunk) => { stdout += chunk; if (stdout.includes("running at")) finish(resolve); });
    });
    return { child, url: `http://127.0.0.1:${port}` };
  } catch (error) { child.kill(); throw error; }
}

async function exportHeadless(service, args) {
  const format = required(args, "format"), output = path.resolve(required(args, "out"));
  if (!["sequence", "sheet", "cocos"].includes(format)) throw new Error(`Unsupported format: ${format}`);
  if (fs.existsSync(output) && (args.zip || !fs.statSync(output).isDirectory() || fs.readdirSync(output).length)) throw new Error(`Output must be a new ZIP file or empty directory: ${output}`);
  const projectId = required(args, "project");
  const validation = validateProject(service, projectId);
  if (!validation.ok) throw new Error(validation.errors.join("\n"));
  if (!validation.frames) throw new Error("Project has no frames to export.");
  const executablePath = findBrowser(args.browser);
  let chromium;
  try { ({ chromium } = require("playwright-core")); } catch { throw new Error("Visual export requires playwright-core. Run npm install in the Frame Tuner directory."); }
  const server = await startExportServer(service.root);
  let browser;
  try {
    process.stderr.write(`Baking ${projectId} with ${path.basename(executablePath)}…\n`);
    browser = await chromium.launch({ executablePath, headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1 });
    page.on("pageerror", (error) => process.stderr.write(`Browser: ${error.message}\n`));
    await page.goto(`${server.url}/?project=${encodeURIComponent(projectId)}&export=1`, { waitUntil: "networkidle", timeout: 30000 });
    await page.waitForFunction(() => window.FrameTunerPortable && window.XsxbFrameTunerLite?.current().ready, null, { timeout: 30000 });
    const payload = await page.evaluate(async (options) => window.FrameTunerPortable.collectPayload(options), { format, padding: args.padding === undefined ? 24 : Number(args.padding), columns: args.columns === undefined ? 8 : Number(args.columns) });
    const result = await buildExportPackage(payload, { root: service.root, projectData: service.projectData(projectId) });
    if (args.zip) { fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, result.buffer, { flag: "wx" }); }
    else writePackageDirectory(output, result.files);
    return { ok: true, projectId, format, output, archive: Boolean(args.zip), files: result.files.size, animations: payload.manifest.animations.length, frames: payload.manifest.animations.reduce((sum, animation) => sum + animation.frames.length, 0), renderer: "browser-canvas", browser: executablePath };
  } finally {
    try { await browser?.close(); } finally { server.child.kill(); }
  }
}

async function run(argv = process.argv.slice(2), options = {}) {
  const { command, args } = parseArgs(argv);
  if (["help", "--help", "-h"].includes(command) || args.help) return { ok: true, ...HELP };
  const service = options.service || createWorkbenchService({ root: options.root });
  switch (command) {
    case "list": return { ok: true, projects: service.listProjects() };
    case "create": return service.createProject({ label: required(args, "name"), id: args.id });
    case "import": {
      const input = path.resolve(required(args, "input"));
      const filenames = fs.statSync(input).isDirectory() ? fs.readdirSync(input).filter((name) => /\.png$/i.test(name)).map((name) => path.join(input, name)) : [input];
      if (!filenames.length) throw new Error(`No PNG files found in ${input}`);
      const files = filenames.map((filename) => ({ name: path.basename(filename), data: `data:image/png;base64,${fs.readFileSync(filename).toString("base64")}` }));
      const jsonPath = args.json ? path.resolve(args.json) : null;
      const sheetJson = jsonPath ? JSON.parse(fs.readFileSync(jsonPath, "utf8").replace(/^\uFEFF/, "")) : undefined;
      const mime = { ".wav": "audio/wav", ".mp3": "audio/mpeg", ".ogg": "audio/ogg", ".opus": "audio/ogg", ".m4a": "audio/mp4", ".aac": "audio/aac", ".flac": "audio/flac", ".webm": "audio/webm" };
      const audioFiles = (sheetJson?.audio?.files || []).map((descriptor) => {
        if (typeof descriptor.file !== "string" || !descriptor.file || path.isAbsolute(descriptor.file) || /^[a-z]+:/i.test(descriptor.file)) throw new Error("Sheet audio references must be relative file paths.");
        const full = path.resolve(path.dirname(jsonPath), descriptor.file), type = mime[path.extname(full).toLowerCase()];
        if (!type || !fs.existsSync(full) || !fs.statSync(full).isFile()) throw new Error(`Sheet audio file not found or unsupported: ${descriptor.file}`);
        return { file: descriptor.file, name: descriptor.name || path.basename(full), type, data: `data:${type};base64,${fs.readFileSync(full).toString("base64")}` };
      });
      return service.importAnimation({ projectId: required(args, "project"), profileId: required(args, "profile"), animationId: required(args, "animation"), fps: args.fps === undefined ? 12 : Number(args.fps), files, sheetJson, audioFiles, replace: args.replace === true });
    }
    case "validate": return validateProject(service, required(args, "project"));
    case "export": return exportHeadless(service, args);
    default: throw new Error(`Unknown command: ${command}. Use help for available commands.`);
  }
}

if (require.main === module) {
  run().then((result) => { process.stdout.write(`${JSON.stringify(result, null, 2)}\n`); if (result.ok === false) { process.stderr.write(`${(result.errors || ["Validation failed"]).join("\n")}\n`); process.exitCode = 1; } }).catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.stdout.write(`${JSON.stringify({ ok: false, error: error.message, code: error.code || "command_failed" })}\n`);
    process.exitCode = 1;
  });
}
module.exports = { HELP, parseArgs, validateProject, findBrowser, startExportServer, exportHeadless, run };
