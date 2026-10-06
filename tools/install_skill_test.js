const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { test } = require("node:test");
const { installSkill, resolveTarget, parseArgs, SKILL_NAME } = require("./install_skill");
const { trustedRemote, updateBlockReason, inspectLocalRepository } = require("./updater");

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "frame-tuner-skill-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, "source");
  fs.mkdirSync(path.join(source, "references"), { recursive: true });
  fs.writeFileSync(path.join(source, "SKILL.md"), "---\nname: xsxb-frame-tuner\ndescription: Test fixture\n---\n# Test\n");
  fs.writeFileSync(path.join(source, "references", "data.md"), "version one\n");
  return { root, source, target: path.join(root, "client", "skills", SKILL_NAME) };
}

test("client targets are explicit, documented, and independent of CODEX_HOME", () => {
  const home = path.resolve("test-home");
  const projectRoot = path.resolve("test-project");
  for (const [client, directory] of [["codex", ".agents"], ["claude-code", ".claude"], ["cursor", ".cursor"], ["deepseek-harness", ".dsh"]]) {
    assert.equal(resolveTarget({ client, projectRoot }, {}, home), path.join(projectRoot, directory, "skills", SKILL_NAME));
    assert.equal(resolveTarget({ client, scope: "user" }, { CODEX_HOME: path.resolve("unrelated-codex") }, home), path.join(home, directory, "skills", SKILL_NAME));
  }
  const dshHome = path.resolve("custom-dsh");
  assert.equal(resolveTarget({ client: "deepseek-harness", scope: "user" }, { DSH_HOME: dshHome }, home), path.join(dshHome, "skills", SKILL_NAME));
  assert.throws(() => resolveTarget({}), /Select --client/);
  assert.throws(() => resolveTarget({ client: "unknown" }), /Unknown client/);
  assert.throws(() => resolveTarget({ client: "generic" }), /Select --client/);
  assert.equal(resolveTarget({ client: "generic", target: "specific" }), path.resolve("specific"));
});

test("dry-run has no side effects and repeated installation is idempotent", (t) => {
  const f = fixture(t);
  const dry = installSkill({ ...f, dryRun: true });
  assert.equal(dry.plannedAction, "install");
  assert.equal(fs.existsSync(path.dirname(f.target)), false);
  assert.equal(installSkill(f).changed, true);
  assert.equal(fs.readFileSync(path.join(f.target, "references", "data.md"), "utf8"), "version one\n");
  assert.equal(installSkill(f).changed, false);
  assert.equal(fs.existsSync(path.join(f.root, ".codex")), false);
});

test("an explicit update replaces only an unchanged managed skill", (t) => {
  const f = fixture(t);
  installSkill(f);
  fs.writeFileSync(path.join(f.source, "references", "data.md"), "version two\n");
  assert.throws(() => installSkill(f), /--replace/);
  assert.equal(fs.readFileSync(path.join(f.target, "references", "data.md"), "utf8"), "version one\n");
  const plan = installSkill({ ...f, replace: true, dryRun: true });
  assert.equal(plan.plannedAction, "update");
  assert.equal(installSkill({ ...f, replace: true }).changed, true);
  assert.equal(fs.readFileSync(path.join(f.target, "references", "data.md"), "utf8"), "version two\n");
  assert.deepEqual(fs.readdirSync(path.dirname(f.target)), [SKILL_NAME]);
});

test("local edits and extra files survive even a requested update", (t) => {
  const f = fixture(t);
  installSkill(f);
  const instruction = path.join(f.target, "SKILL.md");
  fs.appendFileSync(instruction, "\nUser instruction\n");
  assert.throws(() => installSkill({ ...f, replace: true }), /local edits/);
  assert.match(fs.readFileSync(instruction, "utf8"), /User instruction/);
  fs.copyFileSync(path.join(f.source, "SKILL.md"), instruction);
  fs.writeFileSync(path.join(f.target, "personal.txt"), "keep");
  assert.throws(() => installSkill({ ...f, replace: true }), /additional files/);
  assert.equal(fs.readFileSync(path.join(f.target, "personal.txt"), "utf8"), "keep");
});

test("unmanaged existing instructions and linked directories cannot be overwritten", (t) => {
  const f = fixture(t);
  fs.mkdirSync(f.target, { recursive: true });
  fs.writeFileSync(path.join(f.target, "SKILL.md"), "personal skill");
  assert.throws(() => installSkill({ ...f, replace: true }), /not managed/);
  assert.equal(fs.readFileSync(path.join(f.target, "SKILL.md"), "utf8"), "personal skill");
  const link = path.join(f.root, "linked");
  fs.symlinkSync(f.target, link, process.platform === "win32" ? "junction" : "dir");
  assert.throws(() => installSkill({ ...f, target: link, replace: true }), /linked target/);
});

test("CLI supports a quoted path with spaces and reports invalid options", (t) => {
  const f = fixture(t);
  const script = path.join(__dirname, "install_skill.js");
  const result = spawnSync(process.execPath, [script, "--client", "deepseek-harness", "--target", path.join(f.root, "path with spaces", SKILL_NAME), "--dry-run"], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).plannedAction, "install");
  const invalid = spawnSync(process.execPath, [script, "--client"], { encoding: "utf8" });
  assert.equal(invalid.status, 1);
  assert.equal(JSON.parse(invalid.stderr).ok, false);
  assert.throws(() => parseArgs(["--anything"]), /Unknown option/);
});

test("updater trusts only the fork and does not resolve or create a skill target", (t) => {
  const f = fixture(t);
  for (const remote of ["https://github.com/JinBorn/Frame-Tuner.git", "git@github.com:JinBorn/Frame-Tuner.git", "ssh://git@github.com/JinBorn/Frame-Tuner"]) assert.equal(trustedRemote(remote), true);
  for (const remote of ["https://github.com/sparklecatta-lang/XSXB-Frame-Tuner.git", "https://evilgithub.com/JinBorn/Frame-Tuner", "https://github.com/JinBorn/Frame-Tuner-other"]) assert.equal(trustedRemote(remote), false);
  const local = inspectLocalRepository(f.root);
  assert.equal(Object.hasOwn(local, "skillTarget"), false);
  assert.equal(updateBlockReason({ supported: true, remoteTrusted: true, branch: "main", trackedDirty: true }, true), "tracked_changes");
  assert.equal(updateBlockReason({ supported: true, remoteTrusted: true, branch: "feature", trackedDirty: false }, true), "wrong_branch");
});
