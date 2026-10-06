const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const OFFICIAL_REPOSITORY = "https://github.com/JinBorn/Frame-Tuner.git";
const OFFICIAL_BRANCH = "main";

function runGit(root, args, options = {}) {
  const result = spawnSync("git", args, {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
    timeout: options.timeout ?? 20000,
  });
  if (result.error) {
    if (options.allowFailure) return { ok: false, status: result.status, output: "", error: result.error.message };
    throw result.error;
  }
  const output = String(result.stdout || "").trim();
  const error = String(result.stderr || "").trim();
  if (result.status !== 0 && !options.allowFailure) {
    throw new Error(error || output || `git ${args.join(" ")} failed with exit code ${result.status}`);
  }
  return { ok: result.status === 0, status: result.status, output, error };
}

function trustedRemote(remote) {
  const value = String(remote || "").trim();
  return /^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)JinBorn\/Frame-Tuner(?:\.git)?\/?$/i.test(value);
}

function inspectLocalRepository(root) {
  const gitDir = path.join(root, ".git");
  if (!fs.existsSync(gitDir)) {
    return {
      supported: false,
      blockReason: "not_git_clone",
      currentCommit: "",
      branch: "",
      remote: "",
      remoteTrusted: false,
      trackedDirty: false,
    };
  }
  const currentCommit = runGit(root, ["rev-parse", "HEAD"]).output;
  const branch = runGit(root, ["branch", "--show-current"]).output;
  const remote = runGit(root, ["remote", "get-url", "origin"], { allowFailure: true }).output;
  const trackedStatus = runGit(root, ["status", "--porcelain", "--untracked-files=no"]).output;
  return {
    supported: true,
    blockReason: "",
    currentCommit,
    branch,
    remote,
    remoteTrusted: trustedRemote(remote),
    trackedDirty: Boolean(trackedStatus),
  };
}

function latestOfficialCommit() {
  const result = runGit(process.cwd(), ["ls-remote", OFFICIAL_REPOSITORY, `refs/heads/${OFFICIAL_BRANCH}`], { timeout: 15000 });
  const commit = String(result.output || "").split(/\s+/)[0];
  if (!/^[0-9a-f]{40}$/i.test(commit)) throw new Error("GitHub did not return a valid main-branch commit.");
  return commit;
}

function updateBlockReason(local, updateAvailable) {
  if (!local.supported) return "not_git_clone";
  if (!local.remoteTrusted) return "untrusted_remote";
  if (local.branch !== OFFICIAL_BRANCH) return "wrong_branch";
  if (local.trackedDirty) return "tracked_changes";
  return updateAvailable ? "" : "up_to_date";
}

function checkForUpdates(root) {
  const local = inspectLocalRepository(root);
  if (!local.supported) {
    return {
      ...local,
      latestCommit: "",
      updateAvailable: false,
      canUpdate: false,
      checkedAt: new Date().toISOString(),
    };
  }
  const latestCommit = latestOfficialCommit();
  const updateAvailable = latestCommit !== local.currentCommit;
  const blockReason = updateBlockReason(local, updateAvailable);
  return {
    ...local,
    latestCommit,
    updateAvailable,
    canUpdate: updateAvailable && !blockReason,
    blockReason,
    checkedAt: new Date().toISOString(),
  };
}

function performUpdate(root) {
  const before = inspectLocalRepository(root);
  const blockReason = updateBlockReason(before, true);
  if (blockReason) throw new Error(`Update blocked: ${blockReason}`);

  runGit(root, ["fetch", "--prune", "origin", OFFICIAL_BRANCH], { timeout: 120000 });
  const latestCommit = runGit(root, ["rev-parse", `origin/${OFFICIAL_BRANCH}`]).output;
  if (latestCommit !== before.currentCommit) {
    const ancestor = runGit(root, ["merge-base", "--is-ancestor", before.currentCommit, `origin/${OFFICIAL_BRANCH}`], { allowFailure: true });
    if (!ancestor.ok) throw new Error("Local main is not a fast-forward ancestor of origin/main.");
    runGit(root, ["merge", "--ff-only", `origin/${OFFICIAL_BRANCH}`], { timeout: 120000 });
  }

  const afterCommit = runGit(root, ["rev-parse", "HEAD"]).output;
  return {
    updated: afterCommit !== before.currentCommit,
    previousCommit: before.currentCommit,
    currentCommit: afterCommit,
    latestCommit,
    restartRequired: true,
  };
}

module.exports = {
  OFFICIAL_BRANCH,
  OFFICIAL_REPOSITORY,
  checkForUpdates,
  inspectLocalRepository,
  latestOfficialCommit,
  performUpdate,
  trustedRemote,
  updateBlockReason,
};
