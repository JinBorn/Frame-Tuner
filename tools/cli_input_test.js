"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { parseArgs } = require("./frame_tuner");

for (const [flag, values] of [["padding", ["NaN", "Infinity", "-1", "1025", "1.5", ""]], ["columns", ["NaN", "0", "65", "2.5", " "]]]) {
  for (const value of values) {
    assert.throws(() => parseArgs(["export", `--${flag}`, value]), new RegExp(`--${flag} must be an integer`));
  }
}
assert.equal(parseArgs(["export", "--padding", "0", "--columns", "64"]).args.padding, "0");
assert.equal(parseArgs(["export", "--padding", "1024", "--columns", "1"]).args.columns, "1");
const failed = spawnSync(process.execPath, [path.join(__dirname, "frame_tuner.js"), "export", "--padding", "broken"], { encoding: "utf8", windowsHide: true });
assert.equal(failed.status, 1);
assert.equal(JSON.parse(failed.stdout).ok, false);
assert.match(JSON.parse(failed.stdout).error, /--padding must be an integer/);
console.log("CLI input checks passed: invalid export dimensions fail before opening a project or browser, with JSON and nonzero status.");
