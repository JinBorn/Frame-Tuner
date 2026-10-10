param(
  [ValidateSet("full", "lite")]
  [string]$Mode = "full"
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  Write-Error "Node.js was not found in PATH. Install Node.js 20.9 or newer first."
  exit 1
}

$target = if ($Mode -eq "lite") {
  @{
    Name = "XSXB Frame Tuner Lite"
    Port = 5180
    Script = "tools\frame_tuner_lite\server.js"
  }
} else {
  @{
    Name = "XSXB Frame Tuner"
    Port = 5179
    Script = "tools\animation_tuner\server.js"
  }
}

# The server reads these same variables. Check and open its actual port rather
# than the default when launching an isolated or custom-port workspace.
$configuredPort = if ($Mode -eq "lite") { $env:LITE_PORT } else { $env:PORT }
if (-not [string]::IsNullOrEmpty($configuredPort)) {
  $parsedPort = 0
  if (-not [int]::TryParse($configuredPort.Trim(), [ref]$parsedPort) -or $parsedPort -lt 1 -or $parsedPort -gt 65535) {
    Write-Error "Invalid server port '$configuredPort'. Use an integer from 1 through 65535."
    exit 1
  }
  $target.Port = $parsedPort
}

# Do not terminate an existing session or another checkout when launching.
$listeners = Get-NetTCPConnection -State Listen -LocalPort $target.Port -ErrorAction SilentlyContinue
if ($listeners) {
  $owners = ($listeners.OwningProcess | Sort-Object -Unique) -join ", "
  Write-Error "Port $($target.Port) is already in use (PID: $owners). Stop the existing server before launching again."
  exit 1
}

$url = "http://127.0.0.1:$($target.Port)/"
# Only the browser opener runs in a job. Node stays attached to this console so
# Ctrl+C / closing the launcher window also stops the server and shows its logs.
$browserJob = Start-Job -ArgumentList $url -ScriptBlock {
  param($url)
  for ($attempt = 0; $attempt -lt 50; $attempt += 1) {
    try {
      $response = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 1
      if ($response.StatusCode -eq 200) {
        Start-Process $url
        return
      }
    } catch {
      Start-Sleep -Milliseconds 120
    }
  }
}

Write-Output "$($target.Name): $url"
Write-Output "Keep this window open while editing. Save your work, then press Ctrl+C or close this window to stop."
Push-Location $projectRoot
$previousForeground = $env:FRAME_TUNER_FOREGROUND
$env:FRAME_TUNER_FOREGROUND = "1"
try {
  do {
    & $node.Source (Join-Path $projectRoot $target.Script)
    $serverExitCode = $LASTEXITCODE
    # Exit 75 is requested only by the explicit web update operation.
  } while ($serverExitCode -eq 75)
} finally {
  $env:FRAME_TUNER_FOREGROUND = $previousForeground
  Stop-Job -Job $browserJob -ErrorAction SilentlyContinue
  Remove-Job -Job $browserJob -Force -ErrorAction SilentlyContinue
  Pop-Location
}
exit $serverExitCode
