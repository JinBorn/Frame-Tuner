const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");

const SKILL_NAME = "xsxb-frame-tuner";
const RECEIPT = ".frame-tuner-install.json";
const CLIENTS = Object.freeze({ codex: ".agents", "claude-code": ".claude", cursor: ".cursor", "deepseek-harness": ".dsh" });

function resolveTarget(options = {}, env = process.env, home = os.homedir()) {
  if (options.client && !Object.hasOwn(CLIENTS, options.client) && options.client !== "generic") {
    throw new Error(`Unknown client: ${options.client}. Use codex, claude-code, cursor, deepseek-harness, or generic.`);
  }
  if (options.scope && !["project", "user"].includes(options.scope)) throw new Error("Scope must be project or user.");
  if (options.target) return path.resolve(options.target);
  if (!options.client || options.client === "generic") throw new Error("Select --client or provide --target <exact-skill-directory>.");
  const scope = options.scope || "project";
  const base = scope === "user" ? home : path.resolve(options.projectRoot || process.cwd());
  const root = scope === "user" && options.client === "deepseek-harness" && String(env.DSH_HOME || "").trim()
    ? path.resolve(env.DSH_HOME.trim()) : path.join(base, CLIENTS[options.client]);
  return path.join(root, "skills", SKILL_NAME);
}

function digest(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function readFiles(directory, prefix = "") {
  const files = {};
  for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!prefix && entry.name === RECEIPT) continue;
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    const absolute = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Skill contains a symbolic link: ${relative}`);
    if (entry.isDirectory()) Object.assign(files, readFiles(absolute, relative));
    else if (entry.isFile()) files[relative] = fs.readFileSync(absolute);
    else throw new Error(`Unsupported skill entry: ${relative}`);
  }
  return files;
}

function hashes(files) {
  return Object.fromEntries(Object.entries(files).map(([name, data]) => [name, digest(data)]));
}

function sameFiles(left, right) {
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every((key) => left[key] === right[key]);
}

function installSkill(options = {}) {
  const source = path.resolve(options.source || path.join(__dirname, "..", "skills", SKILL_NAME));
  const target = resolveTarget(options, options.env, options.home);
  if (source === target || target.startsWith(`${source}${path.sep}`) || source.startsWith(`${target}${path.sep}`)) {
    throw new Error("The installed skill and bundled source must be separate directories.");
  }
  const files = readFiles(source);
  if (!files["SKILL.md"]) throw new Error(`Bundled skill is missing SKILL.md: ${source}`);
  const nextHashes = hashes(files);
  const exists = fs.existsSync(target);
  if (exists) {
    if (!fs.lstatSync(target).isDirectory() || fs.lstatSync(target).isSymbolicLink()) throw new Error(`Refusing to replace a non-directory or linked target: ${target}`);
    let receipt;
    try { receipt = JSON.parse(fs.readFileSync(path.join(target, RECEIPT), "utf8")); } catch { /* Unmanaged destinations are never replaced. */ }
    if (receipt?.installer !== "frame-tuner" || receipt.skill !== SKILL_NAME || receipt.version !== 1 || !receipt.files) {
      throw new Error(`Destination exists and is not managed by this installer: ${target}. Choose a new --target.`);
    }
    const existingHashes = hashes(readFiles(target));
    if (!sameFiles(existingHashes, receipt.files)) throw new Error(`Installed skill has local edits or additional files: ${target}. Preserve them and choose a new --target.`);
    if (sameFiles(existingHashes, nextHashes)) return { ok: true, changed: false, target, source, files: Object.keys(files).length };
    if (!options.replace) throw new Error(`An older managed skill exists: ${target}. Use --replace to update it.`);
  }
  if (options.dryRun) return { ok: true, changed: false, plannedAction: exists ? "update" : "install", target, source, files: Object.keys(files).length };

  const parent = path.dirname(target);
  fs.mkdirSync(parent, { recursive: true });
  const staging = fs.mkdtempSync(path.join(parent, `.${SKILL_NAME}.install-`));
  const backup = `${staging}.backup`;
  let moved = false;
  try {
    for (const [name, contents] of Object.entries(files)) {
      const destination = path.join(staging, name);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.writeFileSync(destination, contents);
    }
    fs.writeFileSync(path.join(staging, RECEIPT), `${JSON.stringify({ installer: "frame-tuner", skill: SKILL_NAME, version: 1, files: nextHashes }, null, 2)}\n`);
    if (exists) { fs.renameSync(target, backup); moved = true; }
    fs.renameSync(staging, target);
    if (moved) fs.rmSync(backup, { recursive: true, force: true });
  } catch (error) {
    if (fs.existsSync(staging)) fs.rmSync(staging, { recursive: true, force: true });
    if (moved && !fs.existsSync(target) && fs.existsSync(backup)) fs.renameSync(backup, target);
    throw error;
  }
  return { ok: true, changed: true, target, source, files: Object.keys(files).length };
}

function parseArgs(argv) {
  const options = {};
  const values = { "--client": "client", "--scope": "scope", "--project-root": "projectRoot", "--target": "target" };
  for (let i = 0; i < argv.length; i += 1) {
    const argument = argv[i];
    if (argument === "--replace") options.replace = true;
    else if (argument === "--dry-run") options.dryRun = true;
    else if (argument === "--help" || argument === "-h") options.help = true;
    else if (Object.hasOwn(values, argument)) {
      if (!argv[i + 1] || argv[i + 1].startsWith("--")) throw new Error(`Missing value for ${argument}`);
      options[values[argument]] = argv[++i];
    } else throw new Error(`Unknown option: ${argument}`);
  }
  return options;
}

function main(argv = process.argv.slice(2)) {
  try {
    const options = parseArgs(argv);
    const result = options.help ? {
      usage: "node tools/install_skill.js --client <codex|claude-code|cursor|deepseek-harness> [--scope project|user] [--project-root DIR] [--dry-run] [--replace]",
      custom: "node tools/install_skill.js --target <exact-skill-directory> [--dry-run] [--replace]",
      defaultScope: "project",
      note: "Copies only this skill. Existing unmanaged or locally modified instructions are never overwritten.",
    } : installSkill(options);
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(JSON.stringify({ ok: false, error: error.message }));
    process.exitCode = 1;
  }
}

if (require.main === module) main();
module.exports = { CLIENTS, RECEIPT, SKILL_NAME, installSkill, parseArgs, resolveTarget };
