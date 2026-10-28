# Deploy LIS tests to VPS 45.38.3.49
# Usage:
#   $env:VPS_PASSWORD = "your-root-password"
#   .\deploy-vps.ps1
# Or with key already on server:
#   .\deploy-vps.ps1 -UseKey

param(
  [string]$HostName = "45.38.3.49",
  [string]$User = "root",
  [string]$RemoteDir = "/opt/lis-tests",
  [switch]$UseKey
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Key = Join-Path $env:USERPROFILE ".ssh\lis_vps"
$Tar = Join-Path $env:TEMP "lis-tests-deploy.tgz"

Write-Host "==> Packing project..."
if (Test-Path $Tar) { Remove-Item $Tar -Force }
Push-Location $Root
try {
  $htmlFiles = @(Get-ChildItem -File -Filter "*.html" | Where-Object {
    $_.Name -notin @("index.html") -and $_.Name -notmatch "^_" 
  } | ForEach-Object { $_.Name })
  # root tools + index
  $extra = @("index.html") | Where-Object { Test-Path $_ }
  $packList = @("server", "Dockerfile", "docker-compose.yml", "nginx.conf", "start-server.bat") + $htmlFiles + $extra
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
Write-Host "    archive: $Tar ($([math]::Round((Get-Item $Tar).Length/1MB,2)) MB)"

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
$adminCode = curl.exe -s -o NUL -w "%{http_code}" "http://${HostName}:8080/admin"
if ($adminCode -eq "303" -or $adminCode -eq "302") {
  Write-Host "    OK: /admin without session redirects to login ($adminCode)"
} else {
  Write-Host "    WARN: /admin anonymous status $adminCode (expected 303)"
}
$nav = Invoke-Remote "test -f $RemoteDir/server/static/lis-nav.js && grep -q lis-nav.js $RemoteDir/server/app.py && echo NAV_OK || echo NAV_MISSING"
if ($nav -match "NAV_OK") {
  Write-Host "    OK: lis-nav.js is on disk and wired in app.py"
} else {
  Write-Host "    WARN: lis-nav wiring missing ($nav)"
}

Write-Host "Done. Open http://${HostName}:8080/admin (Ctrl+F5)"
