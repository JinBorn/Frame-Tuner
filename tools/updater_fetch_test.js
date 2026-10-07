"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");
const { spawnSync } = require("node:child_process");
const { OFFICIAL_REPOSITORY } = require("./updater");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "frame-tuner-updater-"));
function git(cwd, ...args) {
  const result = spawnSync("git", ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", ...args], { cwd, encoding: "utf8", windowsHide: true, timeout: 15000 });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  return result.stdout.trim();
}
try {
  const upstream = path.join(root, "upstream"), checkout = path.join(root, "checkout");
  fs.mkdirSync(upstream);
  git(upstream, "init", "-b", "main");
  fs.writeFileSync(path.join(upstream, "version.txt"), "one\n");
  git(upstream, "add", "version.txt");
  git(upstream, "commit", "-m", "initial fixture");
  git(root, "clone", "--config", "core.autocrlf=false", upstream, checkout);
  // Keep the configured URL trusted, but substitute only the fetch transport
  // with this local repository. All Git history and merges remain real.
  git(checkout, "remote", "set-url", "origin", OFFICIAL_REPOSITORY);
  git(checkout, "config", "remote.origin.fetch", "+refs/heads/main:refs/remotes/origin/custom-main");
  const updaterPath = path.join(__dirname, "updater.js"), realRequire = createRequire(updaterPath);
  const context = { module: { exports: {} }, process, require: name => name === "node:child_process" ? {
    spawnSync(command, args, options) {
      if (command === "git" && args[0] === "fetch") args = args.map(arg => arg === "origin" ? upstream : arg);
      return spawnSync(command, args, options);
    },
  } : realRequire(name) };
  vm.runInNewContext(fs.readFileSync(updaterPath, "utf8"), context, { filename: updaterPath });
  const { performUpdate } = context.module.exports;
  fs.writeFileSync(path.join(upstream, "version.txt"), "two\n");
  git(upstream, "commit", "-am", "updated fixture");
  const expected = git(upstream, "rev-parse", "HEAD");
  const result = performUpdate(checkout);
  assert.equal(result.updated, true, "An explicitly fetched main must update even with a custom tracking refspec");
  assert.equal(result.currentCommit, expected);
  assert.equal(result.latestCommit, expected);
  assert.equal(fs.readFileSync(path.join(checkout, "version.txt"), "utf8"), "two\n");
  assert.equal(performUpdate(checkout).updated, false, "Repeating an up-to-date update is harmless");
  fs.writeFileSync(path.join(checkout, "version.txt"), "local edits\n");
  assert.throws(() => performUpdate(checkout), /tracked_changes/);
  assert.equal(fs.readFileSync(path.join(checkout, "version.txt"), "utf8"), "local edits\n");
  console.log("Updater fetch checks passed: actual local Git fetch with custom tracking ref, fast-forward, idempotency, and local-edit protection.");
} finally {
  assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
  assert.match(path.basename(root), /^frame-tuner-updater-/);
  fs.rmSync(root, { recursive: true, force: true });
}
