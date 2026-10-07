"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

if (process.platform !== "win32") {
  console.log("Windows launcher port checks skipped on this platform.");
} else {
  const launcher = path.join(__dirname, "launch_tuner.ps1").replaceAll("'", "''");
  function launch(mode, port, litePort) {
    // Run the real launcher up to its occupied-port guard. These mocks ensure
    // the test never starts Node, a browser, or a background job.
    const script = `
      function Get-Command { [CmdletBinding()] param([string]$Name) [pscustomobject]@{ Source = 'unused-test-node' } }
      function Get-NetTCPConnection { [CmdletBinding()] param([string]$State, [int]$LocalPort) [pscustomobject]@{ OwningProcess = 12345 } }
      function Start-Job { throw 'Unexpected background job' }
      & '${launcher}' -Mode '${mode}'
    `;
    return spawnSync("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script], {
      encoding: "utf8", windowsHide: true, timeout: 15000,
      env: { ...process.env, PORT: port, LITE_PORT: litePort },
    });
  }
  for (const [mode, port, litePort, expected] of [
    ["full", "58431", "58432", 58431], ["lite", "58431", "58432", 58432],
    ["full", "", "58432", 5179], ["lite", "58431", "", 5180],
  ]) {
    const result = launch(mode, port, litePort);
    assert.equal(result.status, 1, result.error?.message || result.stdout);
    assert.match(result.stderr, new RegExp(`Port ${expected} is already in use`));
    assert.doesNotMatch(result.stderr, /Unexpected background job/);
  }
  for (const invalid of ["0", "65536", "not-a-port", "3.5", " "]) {
    const result = launch("full", invalid, "");
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Invalid server port/);
  }
  console.log("Launcher ports passed: full/Lite environment overrides, defaults, invalid-port rejection; no server/browser started.");
}
