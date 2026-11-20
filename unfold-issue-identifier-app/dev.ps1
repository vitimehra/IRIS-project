#Requires -Version 5.1
<#
.SYNOPSIS
  Start the UNFOLD frontend, backend, and local SQLite stack for testing.

.DESCRIPTION
  From the repo root:

    .\dev.ps1
    powershell -ExecutionPolicy Bypass -File .\dev.ps1

  Bootstraps .env, installs dependencies if needed, migrates SQLite, seeds
  researcher accounts on a first run, then launches the API (port 4000) and
  Vite app (port 5173). Ctrl+C in this window stops both.

.PARAMETER Install
  Always run npm install in backend and frontend, even if node_modules exists.

.PARAMETER SkipInstall
  Never install; fail if node_modules is missing.

.PARAMETER SeedAdmins
  Recreate/update the local researcher accounts (password rotation).

.PARAMETER SkipSeed
  Do not seed researcher accounts.

.PARAMETER NoLlm
  Force LLM_ENABLED=false for this session (rule-based extraction, no API credits).

.PARAMETER Force
  Kept for compatibility. Ports 4000 and 5173 are always freed if occupied.

.PARAMETER Open
  Open http://localhost:5173 in the default browser once the app is up.

.EXAMPLE
  .\dev.ps1 -Open -NoLlm
#>
[CmdletBinding()]
param(
  [switch]$Install,
  [switch]$SkipInstall,
  [switch]$SeedAdmins,
  [switch]$SkipSeed,
  [switch]$NoLlm,
  [switch]$Force,
  [switch]$Open
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$Root = $PSScriptRoot
$BackendDir = Join-Path $Root 'backend'
$FrontendDir = Join-Path $Root 'frontend'
$EnvFile = Join-Path $BackendDir '.env'
$EnvExample = Join-Path $BackendDir '.env.example'

$ApiPort = 4000
$AppPort = 5173
$ApiUrl = "http://localhost:$ApiPort"
$AppUrl = "http://localhost:$AppPort"

# Local-only defaults. Used when ADMIN_* passwords are not already in the environment or .env.
# Must be at least 4 characters (see backend/src/scripts/seedAdmins.js).
$DefaultVitiPassword = 'unfold-local-viti'
$DefaultSankarPassword = 'unfold-local-sankar'

$script:ChildProcesses = @()
$script:StartedServers = $false
$script:SeededWithDefaults = $false
$script:VitiPasswordForDisplay = $null
$script:SankarPasswordForDisplay = $null

function Write-Banner {
  param([string]$Message, [string]$Color = 'Cyan')
  Write-Host ''
  Write-Host "==> $Message" -ForegroundColor $Color
}

function Write-Ok {
  param([string]$Message)
  Write-Host "    $Message" -ForegroundColor DarkGray
}

function Get-DotEnvValue {
  param([string]$Path, [string]$Key)
  if (-not (Test-Path -LiteralPath $Path)) { return $null }
  foreach ($line in [System.IO.File]::ReadAllLines($Path)) {
    if ($line -match '^\s*#' -or $line -match '^\s*$') { continue }
    if ($line -match "^\s*$([regex]::Escape($Key))\s*=\s*(.*)$") {
      $value = $Matches[1].Trim()
      if (
        ($value.StartsWith('"') -and $value.EndsWith('"')) -or
        ($value.StartsWith("'") -and $value.EndsWith("'"))
      ) {
        $value = $value.Substring(1, $value.Length - 2)
      }
      return $value
    }
  }
  return $null
}

function Get-NpmCmd {
  $cmd = Get-Command npm.cmd -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  $cmd = Get-Command npm -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  throw 'npm was not found on PATH. Install Node.js 20+ from https://nodejs.org and reopen the terminal.'
}

function Assert-Node {
  Write-Banner 'Checking Node.js'
  $node = Get-Command node -ErrorAction SilentlyContinue
  if (-not $node) {
    throw 'Node.js was not found on PATH. Install Node.js 20+ from https://nodejs.org and reopen the terminal.'
  }
  $raw = (& node -v).Trim()
  if ($raw -notmatch '^v(\d+)\.') {
    throw "Could not parse Node version from '$raw'."
  }
  $major = [int]$Matches[1]
  if ($major -lt 20) {
    throw "UNFOLD needs Node 20+. Found $raw."
  }
  Write-Ok "Node $raw"
  Write-Ok "npm  $(Get-NpmCmd)"
}

function Ensure-BackendEnv {
  Write-Banner 'Checking backend/.env'
  if (-not (Test-Path -LiteralPath $EnvExample)) {
    throw "Missing $EnvExample"
  }
  if (-not (Test-Path -LiteralPath $EnvFile)) {
    Copy-Item -LiteralPath $EnvExample -Destination $EnvFile
    Write-Ok "Created backend/.env from .env.example"
  } else {
    Write-Ok 'backend/.env already exists'
  }

  $salt = Get-DotEnvValue -Path $EnvFile -Key 'IP_HASH_SALT'
  $placeholder = 'replace-with-a-long-random-string'
  if ([string]::IsNullOrWhiteSpace($salt) -or $salt -eq $placeholder) {
    $generated = (& node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))")
    $utf8 = New-Object System.Text.UTF8Encoding $false
    $content = [System.IO.File]::ReadAllText($EnvFile)
    if ($content.Contains("IP_HASH_SALT=$placeholder")) {
      $content = $content.Replace("IP_HASH_SALT=$placeholder", "IP_HASH_SALT=$generated")
    } elseif ($content -match '(?m)^IP_HASH_SALT=.*$') {
      $content = [regex]::Replace($content, '(?m)^IP_HASH_SALT=.*$', "IP_HASH_SALT=$generated")
    } else {
      $content = $content.TrimEnd() + "`r`nIP_HASH_SALT=$generated`r`n"
    }
    [System.IO.File]::WriteAllText($EnvFile, $content, $utf8)
    Write-Ok 'Generated a local IP_HASH_SALT'
  } else {
    Write-Ok 'IP_HASH_SALT is set'
  }

  $key = Get-DotEnvValue -Path $EnvFile -Key 'ANTHROPIC_API_KEY'
  if ([string]::IsNullOrWhiteSpace($key)) {
    Write-Ok 'No ANTHROPIC_API_KEY - extraction will use the rule-based fallback'
  } else {
    Write-Ok 'ANTHROPIC_API_KEY is set'
  }
}

function Install-WorkspaceDeps {
  if ($SkipInstall) {
    foreach ($pair in @(
      @{ Name = 'backend'; Dir = $BackendDir },
      @{ Name = 'frontend'; Dir = $FrontendDir }
    )) {
      if (-not (Test-Path -LiteralPath (Join-Path $pair.Dir 'node_modules'))) {
        throw "$($pair.Name)/node_modules is missing. Re-run without -SkipInstall."
      }
    }
    Write-Banner 'Skipping npm install'
    return
  }

  $npm = Get-NpmCmd
  foreach ($pair in @(
    @{ Name = 'backend'; Dir = $BackendDir },
    @{ Name = 'frontend'; Dir = $FrontendDir }
  )) {
    $modules = Join-Path $pair.Dir 'node_modules'
    $needsInstall = $Install -or -not (Test-Path -LiteralPath $modules)
    if (-not $needsInstall) {
      Write-Banner "Dependencies ($($pair.Name))"
      Write-Ok 'node_modules present - skip. Pass -Install to refresh.'
      continue
    }
    Write-Banner "npm install ($($pair.Name))"
    Push-Location $pair.Dir
    try {
      & $npm install
      if ($LASTEXITCODE -ne 0) {
        throw "npm install failed in $($pair.Name)/ (exit $LASTEXITCODE). If this is better-sqlite3 on Windows, install the Visual Studio C++ build tools and try again. See docs/DEPLOYMENT.md."
      }
    } finally {
      Pop-Location
    }
  }
}

function Get-ListeningPid {
  param([int]$Port)
  $found = @()
  $lines = & netstat -ano -p tcp 2>$null
  foreach ($line in $lines) {
    if ($line -match "[:.]$Port\s+\S+\s+LISTENING\s+(\d+)\s*$") {
      $found += [int]$Matches[1]
    }
  }
  return $found | Select-Object -Unique
}

function Stop-PortListeners {
  param([int[]]$Ports)
  foreach ($port in $Ports) {
    $pids = @(Get-ListeningPid -Port $port)
    if ($pids.Count -eq 0) { continue }
    foreach ($procId in $pids) {
      Write-Ok "Port $port is in use - stopping PID $procId"
      & taskkill.exe /PID $procId /T /F | Out-Null
    }
  }
}

function Invoke-Npm {
  param([string]$Directory, [string[]]$NpmArgs)
  $npm = Get-NpmCmd
  Push-Location $Directory
  try {
    & $npm @NpmArgs
    if ($LASTEXITCODE -ne 0) {
      throw "npm $($NpmArgs -join ' ') failed in $Directory (exit $LASTEXITCODE)."
    }
  } finally {
    Pop-Location
  }
}

function Invoke-Migrate {
  Write-Banner 'Migrating SQLite'
  Invoke-Npm -Directory $BackendDir -NpmArgs @('run', 'migrate')
}

function Get-AdminCount {
  Push-Location $BackendDir
  try {
    $js = 'import { getDb, closeDb } from "./src/db/index.js"; const n = getDb().prepare("SELECT COUNT(*) AS c FROM admin_users").get().c; closeDb(); process.stdout.write(String(n));'
    $raw = & node --input-type=module -e $js
    if ($LASTEXITCODE -ne 0) { return 0 }
    if ([string]::IsNullOrWhiteSpace($raw)) { return 0 }
    return [int]$raw
  } catch {
    return 0
  } finally {
    Pop-Location
  }
}

function Get-ProcessEnv {
  param([string]$Name)
  $item = Get-Item -Path "Env:$Name" -ErrorAction SilentlyContinue
  if ($item -and -not [string]::IsNullOrWhiteSpace($item.Value)) {
    return $item.Value
  }
  return $null
}

function Resolve-AdminPassword {
  param([string]$EnvName, [string]$Fallback)
  $fromProcess = Get-ProcessEnv -Name $EnvName
  if ($fromProcess) { return $fromProcess }
  $fromFile = Get-DotEnvValue -Path $EnvFile -Key $EnvName
  if ($fromFile) { return $fromFile }
  return $Fallback
}

function Invoke-SeedAdmins {
  if ($SkipSeed) {
    Write-Banner 'Skipping admin seed'
    return
  }

  $existing = Get-AdminCount
  $shouldSeed = $SeedAdmins -or ($existing -eq 0)
  if (-not $shouldSeed) {
    Write-Banner 'Researcher accounts'
    Write-Ok "$existing account(s) already in the database. Pass -SeedAdmins to reset passwords."
    return
  }

  Write-Banner 'Seeding researcher accounts'
  $viti = Resolve-AdminPassword -EnvName 'ADMIN_VITI_PASSWORD' -Fallback $DefaultVitiPassword
  $sankar = Resolve-AdminPassword -EnvName 'ADMIN_SANKAR_PASSWORD' -Fallback $DefaultSankarPassword

  $hadVitiInEnv = [bool](Get-ProcessEnv -Name 'ADMIN_VITI_PASSWORD')
  $hadSankarInEnv = [bool](Get-ProcessEnv -Name 'ADMIN_SANKAR_PASSWORD')
  $usedDefaults = (
    $viti -eq $DefaultVitiPassword -and
    $sankar -eq $DefaultSankarPassword -and
    -not $hadVitiInEnv -and
    -not $hadSankarInEnv -and
    -not (Get-DotEnvValue -Path $EnvFile -Key 'ADMIN_VITI_PASSWORD')
  )

  $previousViti = Get-ProcessEnv -Name 'ADMIN_VITI_PASSWORD'
  $previousSankar = Get-ProcessEnv -Name 'ADMIN_SANKAR_PASSWORD'
  try {
    $env:ADMIN_VITI_PASSWORD = $viti
    $env:ADMIN_SANKAR_PASSWORD = $sankar
    Invoke-Npm -Directory $BackendDir -NpmArgs @('run', 'seed:admins')
  } finally {
    if ($null -eq $previousViti) {
      Remove-Item -Path Env:ADMIN_VITI_PASSWORD -ErrorAction SilentlyContinue
    } else {
      $env:ADMIN_VITI_PASSWORD = $previousViti
    }
    if ($null -eq $previousSankar) {
      Remove-Item -Path Env:ADMIN_SANKAR_PASSWORD -ErrorAction SilentlyContinue
    } else {
      $env:ADMIN_SANKAR_PASSWORD = $previousSankar
    }
  }

  $script:SeededWithDefaults = $usedDefaults
  if ($usedDefaults) {
    $script:VitiPasswordForDisplay = $DefaultVitiPassword
    $script:SankarPasswordForDisplay = $DefaultSankarPassword
    Write-Ok 'Seeded local-only passwords (shown below). Do not use these in production.'
  } else {
    Write-Ok 'Seeded using ADMIN_* passwords from the environment / backend/.env'
  }
}

function Start-DevProcess {
  param([string]$Title, [string]$Directory)
  $proc = Start-Process -FilePath 'cmd.exe' -WorkingDirectory $Directory -PassThru -WindowStyle Normal -ArgumentList @(
    '/c',
    "title $Title & npm run dev"
  )
  if (-not $proc) { throw "Failed to start $Title" }
  $script:ChildProcesses += $proc
  Write-Ok "$Title started (PID $($proc.Id))"
  return $proc
}

function Wait-HttpReady {
  param([string]$Url, [string]$Label, [int]$TimeoutSeconds = 40)
  $deadline = [datetime]::UtcNow.AddSeconds($TimeoutSeconds)
  while ([datetime]::UtcNow -lt $deadline) {
    try {
      $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 2
      if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) {
        Write-Ok "$Label ready"
        return
      }
    } catch {
      Start-Sleep -Milliseconds 400
    }
  }
  throw "$Label did not become ready at $Url within ${TimeoutSeconds}s. Check the $Label window for errors."
}

function Stop-DevStack {
  if (-not $script:StartedServers -and $script:ChildProcesses.Count -eq 0) { return }
  Write-Host ''
  Write-Host 'Stopping UNFOLD local stack...' -ForegroundColor Yellow
  foreach ($proc in $script:ChildProcesses) {
    if (-not $proc) { continue }
    try {
      if (-not $proc.HasExited) {
        & taskkill.exe /PID $proc.Id /T /F 2>$null | Out-Null
      }
    } catch { }
  }
  foreach ($port in @($ApiPort, $AppPort)) {
    foreach ($procId in @(Get-ListeningPid -Port $port)) {
      & taskkill.exe /PID $procId /T /F 2>$null | Out-Null
    }
  }
}

function Show-Summary {
  $llmNote = 'rule-based fallback unless ANTHROPIC_API_KEY is set in backend/.env'
  if ($NoLlm) { $llmNote = 'forced off for this session (-NoLlm)' }

  Write-Host ''
  Write-Host 'UNFOLD is running locally' -ForegroundColor Green
  Write-Host "    App          $AppUrl"
  Write-Host "    Admin        $AppUrl/admin"
  Write-Host "    API health   $ApiUrl/api/health"
  Write-Host "    Extraction   $llmNote"
  if ($script:SeededWithDefaults) {
    Write-Host ''
    Write-Host '    Local researcher logins (not for production):' -ForegroundColor Yellow
    Write-Host "      viti     / $($script:VitiPasswordForDisplay)"
    Write-Host "      sankar   / $($script:SankarPasswordForDisplay)"
  } else {
    Write-Host '    Admin logins  usernames viti and sankar - passwords as last seeded'
  }
  Write-Host ''
  Write-Host '    Ctrl+C in this window stops both servers.' -ForegroundColor DarkGray
  Write-Host ''
}

try {
  Assert-Node
  Ensure-BackendEnv
  Write-Banner 'Checking ports 4000 and 5173'
  Stop-PortListeners -Ports @($ApiPort, $AppPort)
  Write-Ok 'Ports are free'
  Install-WorkspaceDeps
  Invoke-Migrate
  Invoke-SeedAdmins

  if ($NoLlm) {
    $env:LLM_ENABLED = 'false'
    Write-Banner 'LLM disabled for this session'
  }

  Write-Banner 'Starting servers'
  $script:StartedServers = $true
  $backend = Start-DevProcess -Title 'UNFOLD backend :4000' -Directory $BackendDir
  $frontend = Start-DevProcess -Title 'UNFOLD frontend :5173' -Directory $FrontendDir

  Wait-HttpReady -Url "$ApiUrl/api/health" -Label 'Backend'
  Wait-HttpReady -Url $AppUrl -Label 'Frontend'
  Show-Summary

  if ($Open) {
    Start-Process $AppUrl
  }

  Write-Host 'Watching child processes. Close this window or press Ctrl+C to stop.'
  while ($true) {
    Start-Sleep -Seconds 1
    $backend.Refresh()
    $frontend.Refresh()
    if ($backend.HasExited) { throw "Backend window exited (code $($backend.ExitCode))." }
    if ($frontend.HasExited) { throw "Frontend window exited (code $($frontend.ExitCode))." }
  }
} finally {
  Stop-DevStack
}
