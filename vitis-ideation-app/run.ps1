<#
.SYNOPSIS
  VITIS - one command to set up and run the backend and frontend locally.

.USAGE
  .\run.ps1              start (real AI providers, needs keys in .env)
  .\run.ps1 -Mock        start with canned AI output and placeholder images - rehearsal only
  .\run.ps1 -Seed        (re)create the two experimenter accounts from .env, then exit
  .\run.ps1 -Test        run the backend test suite, then exit

Requires: Python 3.11+, Node 18+, and a built Inspider web at INSPIDER_DATA_DIR.
#>
param([switch]$Mock, [switch]$Seed, [switch]$Test)

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
function Step($m) { Write-Host "`n== $m" -ForegroundColor Cyan }

if (-not (Test-Path .env)) {
  Copy-Item .env.example .env
  Write-Host "Created .env. Add ANTHROPIC_API_KEY, OPENAI_API_KEY, SECRET_SALT and the experimenter passwords, then run again." -ForegroundColor Yellow
  exit 1
}

Step "Python environment"
if (-not (Test-Path .venv)) { python -m venv .venv }
$py = Join-Path $PSScriptRoot ".venv\Scripts\python.exe"
& $py -m pip install -q --upgrade pip
& $py -m pip install -q -r backend\requirements.txt

if ($Test) {
  Step "Tests"
  Push-Location backend
  & $py -m pytest tests -q
  Pop-Location
  exit $LASTEXITCODE
}

if ($Seed) {
  Step "Seeding experimenter accounts"
  Push-Location backend
  & $py -m app.seed
  Pop-Location
  exit $LASTEXITCODE
}

# Fresh databases have no tables yet. Swallow that (and native stderr) so we
# can seed instead of aborting under ErrorActionPreference Stop.
Push-Location backend
$checkAccounts = @'
from sqlalchemy import inspect, select
from app.db import engine, SessionLocal
from app.models import Experimenter
print(1 if inspect(engine).has_table('experimenters') and SessionLocal().scalar(select(Experimenter.id).limit(1)) else 0)
'@
$prevEap = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
$hasAccounts = (& $py -c $checkAccounts 2>$null | Select-Object -Last 1)
$ErrorActionPreference = $prevEap
if ("$hasAccounts".Trim() -ne '1') {
  Step "No experimenter accounts yet - seeding from .env"
  & $py -m app.seed
  if ($LASTEXITCODE -ne 0) { Pop-Location; exit $LASTEXITCODE }
}
Pop-Location

Step "Frontend"
if (-not (Test-Path frontend\node_modules)) { Push-Location frontend; npm install --no-audit --no-fund; Pop-Location }

$backendPort = 8010; $frontendPort = 5175
foreach ($line in Get-Content .env) {
  if ($line -match '^\s*BACKEND_PORT\s*=\s*(\d+)')  { $backendPort  = [int]$Matches[1] }
  if ($line -match '^\s*FRONTEND_PORT\s*=\s*(\d+)') { $frontendPort = [int]$Matches[1] }
}
$npmCmd = (Get-Command npm.cmd -ErrorAction Stop).Source

function Get-PortPids([int]$Port) {
  $found = @()
  foreach ($line in @(netstat -ano)) {
    if ($line -match "[:.]$Port\s+\S+\s+LISTENING\s+(\d+)\s*$") {
      $found += [int]$Matches[1]
    }
  }
  @($found | Sort-Object -Unique)
}
function Stop-Tree([int]$ProcessId) { if ($ProcessId -gt 0) { & cmd.exe /c "taskkill /PID $ProcessId /T /F >nul 2>&1" | Out-Null } }
function Test-ProcessRunning($p) {
  if (-not $p) { return $false }
  $p.Refresh()
  return -not $p.HasExited
}
foreach ($port in @($backendPort, $frontendPort)) {
  foreach ($procId in Get-PortPids $port) {
    Write-Host "Stopping leftover process on :$port" -ForegroundColor Yellow
    Stop-Tree $procId
  }
}
Start-Sleep -Milliseconds 400

$env:AI_PROVIDER = if ($Mock) { 'mock' } else { $null }
Step "Starting backend :$backendPort and frontend :$frontendPort$(if ($Mock) { '   [MOCK MODE]' })"
$backend  = Start-Process -FilePath $py -ArgumentList @('-m','uvicorn','app.main:app','--host','127.0.0.1','--port',"$backendPort") -WorkingDirectory (Join-Path $PSScriptRoot 'backend') -PassThru -NoNewWindow
$frontend = Start-Process -FilePath $npmCmd -ArgumentList @('run','dev') -WorkingDirectory (Join-Path $PSScriptRoot 'frontend') -PassThru -NoNewWindow

Write-Host "Waiting for backend (first-run Inspider import can take a minute)..." -ForegroundColor DarkGray
$ready = $false
$deadline = [datetime]::UtcNow.AddMinutes(5)
while ([datetime]::UtcNow -lt $deadline -and (Test-ProcessRunning $backend)) {
  try {
    $health = Invoke-WebRequest -Uri "http://127.0.0.1:$backendPort/api/health" -UseBasicParsing -TimeoutSec 2
    if ($health.StatusCode -eq 200) { $ready = $true; break }
  } catch { }
  Start-Sleep -Seconds 1
}
if (-not $ready) {
  Write-Host "Backend is not responding on :$backendPort yet. Opening the UI anyway; refresh once startup finishes." -ForegroundColor Yellow
}

Start-Process "http://localhost:$frontendPort"
Write-Host "`nVITIS -> http://localhost:$frontendPort   console: /console   (Ctrl+C to stop)" -ForegroundColor Green
try {
  while ((Test-ProcessRunning $backend) -or (Test-ProcessRunning $frontend)) { Start-Sleep -Seconds 1 }
} finally {
  foreach ($p in @($backend, $frontend)) { if ($p) { Stop-Tree $p.Id } }
  foreach ($port in @($backendPort, $frontendPort)) { foreach ($procId in Get-PortPids $port) { Stop-Tree $procId } }
}
