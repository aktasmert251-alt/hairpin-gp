<#
 Publishes the CURRENT COMMITTED HEAD of this repo to the public GitHub repo as a clean snapshot commit
 (no private history): internal process notes are left out, local paths are scrubbed, and the commit is authored
 with a GitHub noreply address. Windows PowerShell 5.1; needs git + tar (Windows 10+). Source stays ASCII.
 -DryRun builds the snapshot and prints a report, it does not push.
 Credentials: git's own credential helper (Git Credential Manager) asks you in a browser window; nothing is stored here.
#>
[CmdletBinding()]
param(
  [string]$Remote = 'https://github.com/aktasmert251-alt/hairpin-gp.git',
  [string]$Branch = 'main',
  [string]$Message = '',
  [switch]$DryRun
)
$ErrorActionPreference = 'Stop'
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$sha = (git -C $repo rev-parse --short HEAD).Trim()
if (git -C $repo status --porcelain) { Write-Warning 'Uncommitted changes are NOT published (only HEAD is).' }
$work = Join-Path $env:TEMP ('hp-publish-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
$snap = Join-Path $work 'snap'; $clone = Join-Path $work 'clone'
New-Item -ItemType Directory -Force $snap | Out-Null
$tar = Join-Path $work 'head.tar'
git -C $repo archive HEAD --format=tar -o $tar
tar -xf $tar -C $snap

# 1. Leave out internal process material.
$drop = @('AGENTS.md', 'docs/team', 'docs/qa', 'docs/legal/audit.md', 'graphify-out', '.claude')
foreach ($d in $drop) { $p = Join-Path $snap $d; if (Test-Path $p) { Remove-Item $p -Recurse -Force } }

# 2. Scrub local machine paths from text files.
$exts = '.md', '.ts', '.json', '.html', '.txt', '.yml', '.ps1', '.mjs', '.js', '.css', '.sh'
$scrubbed = 0
Get-ChildItem $snap -Recurse -File -Force | Where-Object { $exts -contains $_.Extension.ToLower() -and $_.Length -lt 3MB -and $_.FullName -notmatch '[\\/]node_modules[\\/]' } | ForEach-Object {
  $t = [IO.File]::ReadAllText($_.FullName)
  $n = $t -replace 'C:\\Users\\ASUS\\Projects\\apex-gp[A-Za-z0-9_-]*', '<repo>' -replace 'C:\\Users\\ASUS\\AppData\\Local\\Python[^"''` ]*', '<python>' -replace 'C:\\Users\\ASUS\\(OneDrive\\Desktop|Projects)', '<home>' -replace 'C:\\Users\\ASUS', '<home>'
  if ($n -ne $t) { [IO.File]::WriteAllText($_.FullName, $n, (New-Object Text.UTF8Encoding $false)); $scrubbed++ }
}

# 3. Safety scan of the snapshot: refuse to publish anything that looks like a secret or a personal address.
$bad = Get-ChildItem $snap -Recurse -File -Force | Where-Object { $exts -contains $_.Extension.ToLower() -and $_.Length -lt 3MB -and $_.Name -ne 'publish-public.ps1' } | Select-String -Pattern 'BEGIN [A-Z ]*PRIVATE KEY', 'ghp_[A-Za-z0-9]{20,}', 'AKIA[0-9A-Z]{16}', 'aktasmert251@', 'mermerak', 'C:\\Users\\ASUS' | Select-Object -First 10
if ($bad) { $bad | ForEach-Object { Write-Host ('BLOCKED: ' + $_.Path + ':' + $_.LineNumber) }; throw 'Snapshot contains secrets or personal data; not publishing.' }
$count = (Get-ChildItem $snap -Recurse -File -Force | Measure-Object).Count
Write-Host ("Snapshot of {0}: {1} files, {2} text files scrubbed, work dir {3}" -f $sha, $count, $scrubbed, $work)
if ($DryRun) { Write-Host 'Dry run: nothing pushed.'; return }

# 4. Commit on top of whatever the public repo already holds, then push.
$ErrorActionPreference = 'Continue'   # git writes warnings (e.g. empty repository) to stderr
git clone --quiet $Remote $clone 2>$null
if ($LASTEXITCODE -ne 0) { throw 'git clone failed (does the repo exist, and are you signed in to GitHub?)' }
git -C $clone checkout -q -B $Branch 2>$null
Get-ChildItem $clone -Force | Where-Object { $_.Name -ne '.git' } | Remove-Item -Recurse -Force
Copy-Item (Join-Path $snap '*') $clone -Recurse -Force
Get-ChildItem $snap -Force -Filter '.*' | Where-Object { $_.Name -ne '.git' } | ForEach-Object { Copy-Item $_.FullName $clone -Recurse -Force }
git -C $clone add -A
if (-not (git -C $clone status --porcelain)) { Write-Host 'No changes to publish.'; return }
$msg = if ($Message) { $Message } else { "HAIRPIN GP snapshot $sha" }
git -C $clone -c user.name='Mert Aktas' -c user.email='aktasmert251-alt@users.noreply.github.com' commit -q -m $msg
git -C $clone push origin ("HEAD:" + $Branch)
if ($LASTEXITCODE -ne 0) { throw 'git push failed' }
Write-Host 'Pushed. GitHub Actions will build and deploy the page; follow it on the repo Actions tab.'