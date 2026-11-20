<#
.SYNOPSIS
  Inspider Web Visualizer - one command to build the data (if needed) and run both servers.

.USAGE
  .\run.ps1              build if missing, then start
  .\run.ps1 -Rebuild     rebuild the data from scratch, then start
  .\run.ps1 -Dev         use dev pseudo-embeddings (no API key; NOT meaningful)
  .\run.ps1 -BuildOnly   build the data and exit
  .\run.ps1 -Estimate    print token count and indicative cost, no API calls
  .\run.ps1 -Limit 2000  smoke test on a 2,000-verb sample

Requires: Python 3.11+, Node 18+.
#>
param(
  [switch]$Rebuild,
  [switch]$Dev,
  [switch]$BuildOnly,
  [switch]$Estimate,
  [int]$Limit = 0
)

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

function Step($msg) { Write-Host "`n== $msg" -ForegroundColor Cyan }

# --- .env -----------------------------------------------------------------
if (-not (Test-Path .env)) {
  Copy-Item .env.example .env
  Write-Host "Created .env from .env.example. Add your OPENAI_API_KEY to it for real embeddings." -ForegroundColor Yellow
}

# --- python ----------------------------------------------------------------
Step "Python environment"
if (-not (Test-Path .venv)) {
  python -m venv .venv
}
$py = Join-Path $PSScriptRoot ".venv\Scripts\python.exe"
& $py -m pip install -q --upgrade pip
& $py -m pip install -q -r requirements.txt
if ($LASTEXITCODE -ne 0) { throw "pip install failed" }

# --- data ------------------------------------------------------------------
$args_ = @()
if ($Dev)    { $args_ += @('--provider', 'dev') }
if ($Limit)  { $args_ += @('--limit', "$Limit") }

if ($Estimate) {
  Step "Cost estimate"
  if (-not (Test-Path data\verbs_glossed.parquet)) { & $py -m pipeline.build --only 01; & $py -m pipeline.build --only 02 }
  & $py -m pipeline.build --estimate
  exit 0
}

$needBuild = $Rebuild -or -not (Test-Path data\nodes.parquet)
if ($needBuild) {
  Step "Building the web (this downloads the verb sources on first run)"
  $envLines = Get-Content .env | Where-Object { $_ -match '^\s*OPENAI_API_KEY\s*=\s*\S' }
  if (-not $Dev -and -not $envLines) {
    Write-Host "No OPENAI_API_KEY in .env. Either add one, or run with -Dev for a smoke test." -ForegroundColor Red
    exit 1
  }
  if ($Rebuild) { $args_ += '--force' }
  & $py -m pipeline.build @args_
  if ($LASTEXITCODE -ne 0) { throw "pipeline failed" }
} else {
  Write-Host "Data present in data\ - skipping build (use -Rebuild to redo)."
}
if ($BuildOnly) { exit 0 }

# --- frontend deps ------------------------------------------------------------
Step "Frontend"
if (-not (Test-Path frontend\node_modules)) {
  Push-Location frontend
  npm install --no-audit --no-fund
  Pop-Location
}

# --- ports --------------------------------------------------------------------
$backendPort  = 8000
$frontendPort = 5174
foreach ($line in Get-Content .env) {
  if ($line -match '^\s*BACKEND_PORT\s*=\s*(\d+)')  { $backendPort  = [int]$Matches[1] }
  if ($line -match '^\s*FRONTEND_PORT\s*=\s*(\d+)') { $frontendPort = [int]$Matches[1] }
}

# --- servers ------------------------------------------------------------------
# Start-Process cannot launch the Unix `npm` shim on Windows ("%1 is not a valid
# Win32 application"). Resolve npm.cmd, the real cmd launcher.
$npmCmd = Get-Command npm.cmd -ErrorAction SilentlyContinue
if (-not $npmCmd) {
  throw "npm.cmd not found. Install Node.js 18+ and ensure it is on PATH."
}

function Get-Listeners([int]$Port) {
  @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
    Sort-Object OwningProcess -Unique)
}

function Stop-ProcessTree([int]$ProcessId) {
  if ($ProcessId -le 0) { return }
  # Native stderr becomes a terminating error when $ErrorActionPreference is Stop.
  $prev = $ErrorActionPreference
  $ErrorActionPreference = 'SilentlyContinue'
  try {
    & cmd.exe /c "taskkill /PID $ProcessId /T /F >nul 2>&1" | Out-Null
  } finally {
    $ErrorActionPreference = $prev
  }
}

function Stop-OurListener([int]$Port, [string]$Label) {
  foreach ($conn in Get-Listeners $Port) {
    $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$($conn.OwningProcess)" -ErrorAction SilentlyContinue
    if (-not $proc) { continue }
    $cmd = [string]$proc.CommandLine
    $ours = ($cmd -match 'uvicorn backend\.app') -or
            ($cmd -match [regex]::Escape($PSScriptRoot))
    if (-not $ours) {
      throw "Port $Port is in use by PID $($proc.ProcessId) ($($proc.Name)). Stop it and retry."
    }
    Write-Host "Stopping leftover $Label on :$Port (PID $($proc.ProcessId))." -ForegroundColor Yellow
    Stop-ProcessTree $proc.ProcessId
  }
}

function Test-Listening([int]$Port) {
  $null -ne (Get-Listeners $Port | Select-Object -First 1)
}

Stop-OurListener $backendPort 'backend'
Stop-OurListener $frontendPort 'frontend'
Start-Sleep -Milliseconds 400

Step "Starting backend on :$backendPort and frontend on :$frontendPort"
$backend = Start-Process -FilePath $py -ArgumentList @('-m', 'uvicorn', 'backend.app:app', '--host', '127.0.0.1', '--port', "$backendPort") -PassThru -NoNewWindow
$frontend = Start-Process -FilePath $npmCmd.Source -ArgumentList @('run', 'dev') -WorkingDirectory (Join-Path $PSScriptRoot 'frontend') -PassThru -NoNewWindow

Start-Sleep -Seconds 3
if (-not (Test-Listening $backendPort)) {
  throw "Backend failed to bind :$backendPort (is another process still using it?)."
}
if (-not (Test-Listening $frontendPort)) {
  throw "Frontend failed to bind :$frontendPort."
}

Start-Process "http://localhost:$frontendPort"
Write-Host "`nInspider Web Visualizer -> http://localhost:$frontendPort   (Ctrl+C to stop both)" -ForegroundColor Green

try {
  # npm.cmd often exits while Vite keeps listening, so wait on ports, not PIDs.
  while ((Test-Listening $backendPort) -or (Test-Listening $frontendPort)) {
    Start-Sleep -Seconds 1
  }
} finally {
  foreach ($p in @($backend, $frontend)) {
    if ($p) { Stop-ProcessTree $p.Id }
  }
  Stop-OurListener $backendPort 'backend'
  Stop-OurListener $frontendPort 'frontend'
}
