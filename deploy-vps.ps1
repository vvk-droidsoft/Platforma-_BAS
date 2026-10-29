# Deploy LIS tests to VPS 45.38.3.49
# Usage:
#   $env:VPS_PASSWORD = "your-root-password"
#   .\deploy-vps.ps1
# Or with key already on server:
#   .\deploy-vps.ps1 -UseKey
#
# Discipline: commit (+ push) before deploy. Working tree must be clean and
# local commits must be on origin. Emergency only: -AllowDirty

param(
  [string]$HostName = "45.38.3.49",
  [string]$User = "root",
  [string]$RemoteDir = "/opt/lis-tests",
  [switch]$UseKey,
  [switch]$AllowDirty
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Key = Join-Path $env:USERPROFILE ".ssh\lis_vps"
$Tar = Join-Path $env:TEMP "lis-tests-deploy.tgz"

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

Write-Host "==> Packing project..."
if (Test-Path $Tar) { Remove-Item $Tar -Force }
Push-Location $Root
try {
  $htmlFiles = @(Get-ChildItem -File -Filter "*.html" | Where-Object {
    $_.Name -notin @("index.html") -and $_.Name -notmatch "^_" 
  } | ForEach-Object { $_.Name })
  # root tools + index
  $extra = @("index.html") | Where-Object { Test-Path $_ }
  $packList = @("server", "Dockerfile", "docker-compose.yml", "nginx.conf", "start-server.bat", "smoke_check.py") + $htmlFiles + $extra
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

Write-Host "==> Ensuring remote dir..."
Invoke-Remote "mkdir -p $RemoteDir"

Write-Host "==> Uploading..."
$remoteArchive = if ($Tar.EndsWith(".zip")) { "/tmp/lis-tests-deploy.zip" } else { "/tmp/lis-tests-deploy.tgz" }
Send-File $Tar $remoteArchive

Write-Host "==> Extract + restart (code is mounted, image is not rebuilt)..."
if ($Tar.EndsWith(".zip")) {
  Invoke-Remote "cd $RemoteDir && apt-get update -qq && apt-get install -y -qq unzip >/dev/null 2>&1; unzip -o $remoteArchive -d $RemoteDir >/dev/null && docker compose up -d --force-recreate"
} else {
  Invoke-Remote "cd $RemoteDir && tar -xzf $remoteArchive -C $RemoteDir && docker compose up -d --force-recreate"
}

Write-Host "==> Health check..."
Start-Sleep -Seconds 4
$nav = Invoke-Remote "test -f $RemoteDir/server/static/lis-nav.js && grep -q lis-nav.js $RemoteDir/server/app.py && echo NAV_OK || echo NAV_MISSING"
if ($nav -match "NAV_OK") {
  Write-Host "    OK: lis-nav.js is on disk and wired in app.py"
} else {
  Write-Host "    WARN: lis-nav wiring missing ($nav)"
}

Write-Host "==> Smoke check..."
$smokeBase = "http://${HostName}:8080"
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
  throw "Smoke check failed (exit $smokeExit). Site may be up but checks did not pass."
}

Write-Host "Done. Open http://${HostName}:8080/admin (Ctrl+F5)"
