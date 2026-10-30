# Deploy LIS tests to VPS 45.38.3.49
# Usage:
#   $env:VPS_PASSWORD = "your-root-password"
#   .\deploy-vps.ps1
# Or with key already on server:
#   .\deploy-vps.ps1 -UseKey
#
# Targets:
#   (default)     prod  http://HOST:8080
#   -Staging      only staging http://HOST:8081
#   -Both         prod + staging (same code upload, two restarts)
#
# Discipline: commit (+ push) before deploy. Working tree must be clean and
# local commits must be on origin. Emergency only: -AllowDirty

param(
  [string]$HostName = "45.38.3.49",
  [string]$User = "root",
  [string]$RemoteDir = "/opt/lis-tests",
  [switch]$UseKey,
  [switch]$AllowDirty,
  [switch]$Staging,
  [switch]$Both
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Key = Join-Path $env:USERPROFILE ".ssh\lis_vps"
$Tar = Join-Path $env:TEMP "lis-tests-deploy.tgz"

if ($Both -and $Staging) {
  Write-Host "==> WARN: -Both already includes staging; ignoring lone -Staging" -ForegroundColor Yellow
}

$deployProd = (-not $Staging) -or $Both
$deployStaging = $Staging -or $Both

function Assert-GitReadyForDeploy {
  Push-Location $Root
  try {
    if (-not (Test-Path (Join-Path $Root ".git"))) {
      Write-Host "==> WARN: no .git here - deploy without version baseline" -ForegroundColor Yellow
      return
    }
    if ($AllowDirty) {
      Write-Host "==> WARN: -AllowDirty - deploying with dirty/unpushed git state" -ForegroundColor Yellow
      return
    }

    $porcelain = & git status --porcelain 2>$null
    if ($LASTEXITCODE -ne 0) {
      throw "Deploy blocked: git status failed. Fix git or pass -AllowDirty."
    }
    if ($porcelain) {
      Write-Host "Uncommitted changes:" -ForegroundColor Red
      $porcelain | ForEach-Object { Write-Host "  $_" -ForegroundColor Red }
      throw "Deploy blocked: commit (and push) before deploy. Order: change -> commit -> push -> deploy. Emergency only: -AllowDirty"
    }

    # '@{u}' must be single-quoted: in double quotes PowerShell treats @{...} as a hashtable
    $upstream = & git rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>$null
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($upstream)) {
      throw "Deploy blocked: no upstream branch. Push once with: git push -u origin HEAD. Emergency only: -AllowDirty"
    }

    $ahead = (& git rev-list --count ($upstream + '..HEAD') 2>$null)
    if ($LASTEXITCODE -ne 0) {
      throw "Deploy blocked: cannot compare with upstream '$upstream'. Emergency only: -AllowDirty"
    }
    if ([int]$ahead -gt 0) {
      throw "Deploy blocked: $ahead local commit(s) not on remote ($upstream). Push first, then deploy. Emergency only: -AllowDirty"
    }

    $behind = (& git rev-list --count ('HEAD..' + $upstream) 2>$null)
    if ($LASTEXITCODE -eq 0 -and [int]$behind -gt 0) {
      Write-Host "==> WARN: local is $behind commit(s) behind $upstream - pull when you can" -ForegroundColor Yellow
    }

    $head = (& git rev-parse --short HEAD 2>$null)
    Write-Host "==> Git OK for deploy (HEAD $head = $upstream)"
  }
  finally {
    Pop-Location
  }
}

Assert-GitReadyForDeploy

$targets = @()
if ($deployProd) { $targets += "prod:8080" }
if ($deployStaging) { $targets += "staging:8081" }
Write-Host ("==> Targets: " + ($targets -join ", "))

Write-Host "==> Packing project..."
if (Test-Path $Tar) { Remove-Item $Tar -Force }
Push-Location $Root
try {
  $htmlFiles = @(Get-ChildItem -File -Filter "*.html" | Where-Object {
    $_.Name -notin @("index.html") -and $_.Name -notmatch "^_" 
  } | ForEach-Object { $_.Name })
  # root tools + index
  $extra = @("index.html") | Where-Object { Test-Path $_ }
  $packList = @(
    "server", "Dockerfile", "docker-compose.yml", "docker-compose.staging.yml",
    "nginx.conf", "start-server.bat", "smoke_check.py"
  ) + $htmlFiles + $extra
  $packList = $packList | Where-Object { Test-Path $_ } | Select-Object -Unique

  $packArgs = @("-czf", $Tar, "--exclude=.git", "--exclude=data", "--exclude=__pycache__", "--exclude=.venv", "--exclude=*.pyc") + $packList
  & tar @packArgs 2>$null
  if (-not (Test-Path $Tar)) {
    $Zip = Join-Path $env:TEMP "lis-tests-deploy.zip"
    if (Test-Path $Zip) { Remove-Item $Zip -Force }
    Compress-Archive -Path $packList -DestinationPath $Zip -Force
    $Tar = $Zip
  }
}
finally {
  Pop-Location
}
$tarMb = [math]::Round(((Get-Item $Tar).Length / 1MB), 2)
Write-Host "    archive: $Tar ($tarMb MB)"

$sshBase = @("-o", "StrictHostKeyChecking=accept-new")
if ($UseKey -or -not $env:VPS_PASSWORD) {
  if (-not (Test-Path $Key)) { throw "No key at $Key" }
  $sshBase += @("-i", $Key)
}

function Invoke-Remote([string]$Cmd) {
  if ($env:VPS_PASSWORD -and -not $UseKey) {
    py -3 "$Root\deploy_ssh.py" --host $HostName --user $User --password $env:VPS_PASSWORD --cmd $Cmd
  } else {
    & ssh @sshBase "${User}@${HostName}" $Cmd
  }
}

function Send-File([string]$Local, [string]$Remote) {
  if ($env:VPS_PASSWORD -and -not $UseKey) {
    py -3 "$Root\deploy_ssh.py" --host $HostName --user $User --password $env:VPS_PASSWORD --put $Local --remote $Remote
  } else {
    & scp @sshBase $Local "${User}@${HostName}:$Remote"
  }
}

function Invoke-Smoke([int]$Port, [string]$Label) {
  Write-Host "==> Smoke check ($Label)..."
  $smokeBase = "http://${HostName}:${Port}"
  $smokePass = if ($env:ADMIN_PASSWORD) { $env:ADMIN_PASSWORD } elseif ($env:LIS_SMOKE_PASSWORD) { $env:LIS_SMOKE_PASSWORD } else { "admin" }
  $smokeLogin = if ($env:LIS_SMOKE_LOGIN) { $env:LIS_SMOKE_LOGIN } else { "admin" }
  $smokeArgs = @("$Root\smoke_check.py", "--base", $smokeBase, "--login", $smokeLogin, "--password", $smokePass)
  $smokeExit = 1
  $ran = $false
  foreach ($exe in @("py", "python")) {
    if ($ran) { break }
    try {
      if ($exe -eq "py") {
        & py -3 @smokeArgs
      } else {
        & python @smokeArgs
      }
      $smokeExit = $LASTEXITCODE
      $ran = $true
    } catch {
      Write-Host "    WARN: $exe not available" -ForegroundColor Yellow
    }
  }
  if (-not $ran) {
    throw "Smoke check could not run: need py or python on PATH"
  }
  if ($smokeExit -ne 0) {
    throw "Smoke check failed on $Label (exit $smokeExit). Site may be up but checks did not pass."
  }
}

Write-Host "==> Ensuring remote dir..."
Invoke-Remote "mkdir -p $RemoteDir"

Write-Host "==> Uploading..."
$remoteArchive = if ($Tar.EndsWith(".zip")) { "/tmp/lis-tests-deploy.zip" } else { "/tmp/lis-tests-deploy.tgz" }
Send-File $Tar $remoteArchive

Write-Host "==> Extract + restart (code is mounted, image is not rebuilt)..."
$extract = if ($Tar.EndsWith(".zip")) {
  "cd $RemoteDir && apt-get update -qq && apt-get install -y -qq unzip >/dev/null 2>&1; unzip -o $remoteArchive -d $RemoteDir >/dev/null"
} else {
  "cd $RemoteDir && tar -xzf $remoteArchive -C $RemoteDir"
}
Invoke-Remote $extract

if ($deployProd) {
  Write-Host "==> Restart prod (8080)..."
  Invoke-Remote "cd $RemoteDir && docker compose -f docker-compose.yml up -d --force-recreate"
}
if ($deployStaging) {
  Write-Host "==> Restart staging (8081)..."
  # образ уже должен быть (с prod). Если нет — поднимем без build: возьмёт lis-tests:2.1
  Invoke-Remote "cd $RemoteDir && docker compose -p lis-staging -f docker-compose.staging.yml up -d --force-recreate"
}

Write-Host "==> Health check..."
Start-Sleep -Seconds 4
$nav = Invoke-Remote "test -f $RemoteDir/server/static/lis-nav.js && grep -q lis-nav.js $RemoteDir/server/app.py && echo NAV_OK || echo NAV_MISSING"
if ($nav -match "NAV_OK") {
  Write-Host "    OK: lis-nav.js is on disk and wired in app.py"
} else {
  Write-Host "    WARN: lis-nav wiring missing ($nav)"
}
$stgFile = Invoke-Remote "test -f $RemoteDir/docker-compose.staging.yml && echo STG_FILE_OK || echo STG_FILE_MISSING"
if ($deployStaging) {
  if ($stgFile -match "STG_FILE_OK") {
    Write-Host "    OK: docker-compose.staging.yml on server"
  } else {
    Write-Host "    WARN: staging compose missing on server" -ForegroundColor Yellow
  }
}

if ($deployProd) { Invoke-Smoke -Port 8080 -Label "prod" }
if ($deployStaging) { Invoke-Smoke -Port 8081 -Label "staging" }

if ($deployProd -and $deployStaging) {
  Write-Host "Done. Prod http://${HostName}:8080/admin · Staging http://${HostName}:8081/admin (Ctrl+F5)"
} elseif ($deployStaging) {
  Write-Host "Done. Staging http://${HostName}:8081/admin (Ctrl+F5)"
} else {
  Write-Host "Done. Open http://${HostName}:8080/admin (Ctrl+F5)"
}
