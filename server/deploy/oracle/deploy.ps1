<#
.SYNOPSIS
  APEX GP: build the game + server bundle on this PC and deploy them to the Oracle VM (deploy doc section 1.2 step 5).

.EXAMPLE
  .\server\deploy\oracle\deploy.ps1 -Name apexgp
  .\server\deploy\oracle\deploy.ps1 -Name apexgp -Server 203.0.113.7 -SkipBuild

.NOTES
  Windows PowerShell 5.1. Needs the OpenSSH client (ssh/scp, built into Windows 10/11) and tar.exe (built in).
  Uses only the private key file ($HOME\.ssh\apexgp by default); no passwords or tokens are read or stored.
  The previous build stays on the VM as /opt/apex/dist.old and /opt/apex/app/apex-server.mjs.old.
#>
param(
  # DuckDNS name (the part before .duckdns.org).
  [Parameter(Mandatory = $true)][ValidatePattern('^[a-z0-9-]+$')][string]$Name,
  # SSH target if DNS is not set up yet (the public IP); defaults to <Name>.duckdns.org.
  [string]$Server = '',
  [string]$User = 'ubuntu',
  [string]$Key = "$HOME\.ssh\apexgp",
  [switch]$SkipBuild
)

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
$domain = "$Name.duckdns.org"
if ($Server -eq '') { $Server = $domain }
$target = "$User@$Server"
$sshOpts = @('-i', $Key, '-o', 'IdentitiesOnly=yes', '-o', 'StrictHostKeyChecking=accept-new', '-o', 'ConnectTimeout=15')

function Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Run($exe, [string[]]$argv) {
  & $exe @argv
  if ($LASTEXITCODE -ne 0) { throw "$exe failed (exit $LASTEXITCODE)" }
}

if (-not (Test-Path $Key)) { throw "SSH key not found: $Key (create it with: ssh-keygen -t ed25519 -f `$HOME\.ssh\apexgp)" }

Push-Location $root
try {
  if (-not $SkipBuild) {
    Step 'Build the game (npm run build)'
    Run 'npm.cmd' @('run', 'build')
    Step 'Build the server bundle (server/dist/apex-server.mjs)'
    Run 'npx.cmd' @('vite', 'build', '--config', 'server/vite.config.ts')
  }
  foreach ($f in @('dist\index.html', 'server\dist\apex-server.mjs')) {
    if (-not (Test-Path $f)) { throw "missing $f; run without -SkipBuild" }
  }

  Step 'Pack'
  $tgz = Join-Path $env:TEMP 'apex-deploy.tgz'
  if (Test-Path $tgz) { Remove-Item $tgz -Force }
  # One archive: dist/ (the game) + apex-server.mjs. --exclude keeps source maps out of the public server.
  Run 'tar.exe' @('-czf', $tgz, '--exclude=*.map', 'dist', '-C', 'server\dist', 'apex-server.mjs')
  Write-Host ("{0:N1} MB" -f ((Get-Item $tgz).Length / 1MB))

  Step "Upload to $target"
  Run 'scp.exe' ($sshOpts + @($tgz, "${target}:/tmp/apex-deploy.tgz"))

  Step 'Install and restart'
  # Unpack into a staging dir, then swap directories so the service never sees a half-copied dist/.
  $remote = @'
set -eu
S=/opt/apex/.staging
rm -rf "$S"; mkdir -p "$S"
tar -xzf /tmp/apex-deploy.tgz -C "$S"
test -f "$S/dist/index.html" && test -f "$S/apex-server.mjs"
chmod -R a+rX "$S"
rm -rf /opt/apex/dist.old
if [ -d /opt/apex/dist ]; then mv /opt/apex/dist /opt/apex/dist.old; fi
mv "$S/dist" /opt/apex/dist
if [ -f /opt/apex/app/apex-server.mjs ]; then cp -p /opt/apex/app/apex-server.mjs /opt/apex/app/apex-server.mjs.old; fi
mv "$S/apex-server.mjs" /opt/apex/app/apex-server.mjs
rm -rf "$S" /tmp/apex-deploy.tgz
sudo systemctl restart apex
sleep 2
systemctl is-active apex
'@
  # Pass the script base64-encoded with LF line endings (PowerShell 5.1 piping would add CRs, which bash rejects).
  $b64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($remote.Replace("`r`n", "`n")))
  & ssh.exe @sshOpts $target "echo $b64 | base64 -d | bash"
  if ($LASTEXITCODE -ne 0) { throw "remote install failed; see 'ssh $target journalctl -u apex -n 50'" }

  Step "Health check https://$domain/health"
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  $ok = $false
  for ($i = 1; $i -le 10 -and -not $ok; $i++) {
    try {
      $r = Invoke-WebRequest -Uri "https://$domain/health" -UseBasicParsing -TimeoutSec 10
      if ($r.StatusCode -eq 200) { $ok = $true; Write-Host $r.Content }
    } catch {
      Write-Host "  try $i/10: $($_.Exception.Message)"
      Start-Sleep -Seconds 2
    }
  }
  if (-not $ok) {
    throw "health check failed. If dns-cert.sh has not run yet the server speaks plain HTTP; check with: ssh $target 'curl -s http://localhost:443/health'"
  }
  Write-Host "`nDeployed: https://$domain" -ForegroundColor Green
}
finally {
  Pop-Location
}
