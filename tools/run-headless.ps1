param(
  [Parameter(Mandatory=$true)][string]$ConfigPath,
  [int]$Port = 8787,
  [string]$HostAddress = "127.0.0.1",
  [int]$RestartLimit = 3,
  [int]$BackoffSeconds = 21600
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$cli = Join-Path $repoRoot "dist\src\cli.js"
$config = [System.IO.Path]::GetFullPath($ConfigPath)

if (-not (Test-Path -LiteralPath $config)) { throw "CONFIG_NOT_FOUND: $config" }
if (-not (Test-Path -LiteralPath $cli)) { throw "BUILD_NOT_FOUND: run npm run build" }
if ($Port -lt 1 -or $Port -gt 65535) { throw "INVALID_PORT" }
if ($RestartLimit -lt 1 -or $RestartLimit -gt 10) { throw "INVALID_RESTART_LIMIT" }

$node = (Get-Command node -ErrorAction Stop).Source
$logRoot = Join-Path $repoRoot ".flop\logs"
New-Item -ItemType Directory -Path $logRoot -Force | Out-Null
$consecutive = 0
while ($true) {
  $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
  $stdout = Join-Path $logRoot "serve-$stamp.out.log"
  $stderr = Join-Path $logRoot "serve-$stamp.err.log"
  $args = @("`"$cli`"", "serve", "--config", "`"$config`"", "--port", [string]$Port, "--host", "`"$HostAddress`"")

  $started = Get-Date
  $process = Start-Process -FilePath $node -ArgumentList $args -PassThru -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr
  try { $process.PriorityClass = "BelowNormal" } catch {}
  Wait-Process -Id $process.Id
  $runtimeSeconds = ((Get-Date) - $started).TotalSeconds

  if ($runtimeSeconds -ge 600) { $consecutive = 0 }
  $consecutive += 1
  if ($consecutive -ge $RestartLimit) {
    Start-Sleep -Seconds $BackoffSeconds
    $consecutive = 0
  } else {
    Start-Sleep -Seconds 5
  }
}