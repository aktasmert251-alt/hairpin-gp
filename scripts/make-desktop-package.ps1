<#
 HAIRPIN GP desktop package: builds current HEAD in a clean git worktree and writes a
 self-extracting launcher ("HAIRPIN GP.bat") to the Desktop. Uncommitted work is NOT included.
 Usage: powershell -NoProfile -ExecutionPolicy Bypass -File scripts\make-desktop-package.ps1 [-OutDir <folder>]
#>
param([string]$OutDir = (Join-Path (Split-Path (Split-Path $PSScriptRoot -Parent) -Parent) 'HAIRPIN GP'))
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location $repo
$tr   = Join-Path $repo 'test-results'
$src  = Join-Path $tr 'release-src'
$dist = Join-Path $tr 'release-dist'
$zip  = Join-Path $tr 'release-dist.zip'
$commit = (git rev-parse --short HEAD).Trim()
$outBat = Join-Path $OutDir 'HAIRPIN GP.bat'
if (-not (Test-Path $OutDir)) { throw "OutDir not found: $OutDir (the HAIRPIN GP folder next to the repo is missing; pass -OutDir)" }

function Remove-ReleaseSrc {
  if (Test-Path (Join-Path $src 'node_modules')) { cmd /c rmdir "$src\node_modules" | Out-Null }  # junction first, never recurse into it
  if (Test-Path $src) {
    $ErrorActionPreference = 'Continue'
    git worktree remove --force $src 2>&1 | Out-Null
    $ErrorActionPreference = 'Stop'
    if (Test-Path $src) { Remove-Item -Recurse -Force $src }
  }
  git worktree prune
}

New-Item -ItemType Directory -Force $tr | Out-Null
Remove-ReleaseSrc
try {
  git worktree add --detach $src HEAD | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'git worktree add failed' }
  cmd /c mklink /J "$src\node_modules" "$repo\node_modules" | Out-Null
  @"
import { mergeConfig } from 'vite';
import base from './vite.config';
export default mergeConfig(base, { resolve: { preserveSymlinks: true } });
"@ | Set-Content -Encoding UTF8 (Join-Path $src 'vite.release.config.ts')

  if (Test-Path $dist) { Remove-Item -Recurse -Force $dist }
  Push-Location $src
  try { & cmd /c "node_modules\.bin\vite.cmd build --config vite.release.config.ts --outDir `"$dist`" --emptyOutDir"; if ($LASTEXITCODE -ne 0) { throw 'vite build failed' } }
  finally { Pop-Location }
  if (-not (Test-Path (Join-Path $dist 'index.html'))) { throw 'build produced no index.html' }

  if (Test-Path $zip) { Remove-Item -Force $zip }
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  [IO.Compression.ZipFile]::CreateFromDirectory($dist, $zip, [IO.Compression.CompressionLevel]::Optimal, $false)
  $b64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes($zip))

  $ps = @'
param($bat)
$ErrorActionPreference = 'Stop'
$Host.UI.RawUI.WindowTitle = 'HAIRPIN GP'
$commit = '@@COMMIT@@'
$root = Join-Path $env:LOCALAPPDATA 'HAIRPIN-GP'
$dir  = Join-Path $root $commit
if (-not (Test-Path (Join-Path $dir 'index.html'))) {
  Write-Host 'HAIRPIN GP: first run, unpacking...'
  $t = [IO.File]::ReadAllText($bat)
  $m = '::APEX_' + 'PAYLOAD::'
  $i = $t.LastIndexOf($m)
  $bytes = [Convert]::FromBase64String($t.Substring($i + $m.Length).Trim())
  $tmp = $dir + '.tmp'
  if (Test-Path $tmp) { Remove-Item -Recurse -Force $tmp }
  New-Item -ItemType Directory -Force $tmp | Out-Null
  $z = Join-Path $tmp 'p.zip'
  [IO.File]::WriteAllBytes($z, $bytes)
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  [IO.Compression.ZipFile]::ExtractToDirectory($z, $tmp)
  Remove-Item -Force $z
  if (Test-Path $dir) { Remove-Item -Recurse -Force $dir }
  Move-Item $tmp $dir
}
$mime = @{ '.html'='text/html; charset=utf-8'; '.js'='text/javascript; charset=utf-8'; '.mjs'='text/javascript; charset=utf-8'; '.css'='text/css; charset=utf-8'; '.json'='application/json'; '.map'='application/json'; '.png'='image/png'; '.jpg'='image/jpeg'; '.jpeg'='image/jpeg'; '.webp'='image/webp'; '.svg'='image/svg+xml'; '.ico'='image/x-icon'; '.glb'='model/gltf-binary'; '.gltf'='model/gltf+json'; '.wav'='audio/wav'; '.mp3'='audio/mpeg'; '.ogg'='audio/ogg'; '.wasm'='application/wasm'; '.woff'='font/woff'; '.woff2'='font/woff2'; '.txt'='text/plain; charset=utf-8'; '.bin'='application/octet-stream'; '.hdr'='application/octet-stream' }
$l = $null; $port = 8642
for ($p = 8642; $p -lt 8742; $p++) {
  $c = New-Object System.Net.HttpListener
  $c.Prefixes.Add("http://localhost:$p/")
  try { $c.Start(); $l = $c; $port = $p; break } catch { $c.Close() }
}
if (-not $l) { throw 'No free port in 8642-8741.' }
$url = "http://localhost:$port/"
Write-Host "HAIRPIN GP running at $url  (close this window to stop)"
if (-not $env:HAIRPIN_NOBROWSER) { Start-Process $url }
$full = [IO.Path]::GetFullPath($dir)
while ($l.IsListening) {
  $ctx = $l.GetContext()
  try {
    $rel = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath).TrimStart('/')
    if ($rel -eq '') { $rel = 'index.html' }
    $f = [IO.Path]::GetFullPath((Join-Path $full $rel))
    if (-not $f.StartsWith($full) -or -not (Test-Path -LiteralPath $f -PathType Leaf)) {
      $ctx.Response.StatusCode = 404
    } else {
      $ext = [IO.Path]::GetExtension($f).ToLower()
      $ct = $mime[$ext]; if (-not $ct) { $ct = 'application/octet-stream' }
      $b = [IO.File]::ReadAllBytes($f)
      $ctx.Response.ContentType = $ct
      $ctx.Response.ContentLength64 = $b.Length
      if ($ctx.Request.HttpMethod -ne 'HEAD') { $ctx.Response.OutputStream.Write($b, 0, $b.Length) }
    }
  } catch { try { $ctx.Response.StatusCode = 500 } catch {} }
  finally { try { $ctx.Response.Close() } catch {} }
}
'@
  $ps = $ps.Replace('@@COMMIT@@', $commit)
  $head = @(
    '@echo off',
    'title HAIRPIN GP',
    ('powershell -NoProfile -ExecutionPolicy Bypass -Command "$f=''%~f0''; $s=([IO.File]::ReadAllLines($f) | Where-Object { $_.StartsWith(''#PS '') } | ForEach-Object { $_.Substring(4) }) -join [char]10; & ([scriptblock]::Create($s)) $f"'),
    'exit /b',
    ':: HAIRPIN GP self-extracting launcher, build ' + $commit
  )
  $psl = ($ps -split "`r?`n") | % { '#PS ' + $_ }
  $text = (($head + $psl) -join "`r`n") + "`r`n::APEX_PAYLOAD::`r`n" + $b64 + "`r`n"
  [IO.File]::WriteAllText($outBat, $text, [Text.Encoding]::ASCII)
  $mb = [math]::Round((Get-Item $outBat).Length / 1MB, 2)
  Write-Host "OK: $outBat ($mb MB) built from commit $commit"
}
finally { Remove-ReleaseSrc }
