param(
  [ValidateSet("full", "lite")]
  [string]$Mode = "full"
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  Write-Error "Node.js was not found in PATH. Install Node.js 20 or newer first."
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
