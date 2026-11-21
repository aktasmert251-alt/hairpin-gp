<#
 HAIRPIN GP: fills in the public GitHub repo details (description, website, topics) and creates the first release.
 Run it by double-clicking "GitHub Ayarla.bat". It installs GitHub CLI (gh) if missing, asks YOU to sign in once in the
 browser (this script never sees your password), then applies the settings. Safe to run again.
 -DryRun: only prints what would be sent. Windows PowerShell 5.1; this file is UTF-8 with BOM on purpose.
#>
[CmdletBinding()]
param([string]$Owner = 'aktasmert251-alt', [string]$Repo = 'hairpin-gp', [switch]$DryRun)
# gh writes normal messages (e.g. 'not logged in') to stderr; Windows PowerShell 5.1 would turn that into a terminating error with 'Stop'.
# Native exit codes are checked explicitly below.
$ErrorActionPreference = 'Continue'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$full = "$Owner/$Repo"
$pageUrl = "https://$Owner.github.io/$Repo/"

$description = 'Tarayıcıda ücretsiz yarış oyunu / Free browser racing game: 10 circuits, AI rivals, pit stops, safety car, keyboard-gamepad-touch controls, serverless online rooms. Fictional teams and sponsors.'
$topics = @('racing-game', 'browser-game', 'threejs', 'typescript', 'webgl', 'webrtc', 'peer-to-peer', 'multiplayer', 'gamepad-support', 'mobile-friendly', 'turkish')
$tag = 'v0.2.0'
$releaseTitle = 'HAIRPIN GP 0.2 - first public release'
$notes = @"
İlk herkese açık sürüm / First public release

**TR**
- 10 pist: İstanbul, Lombardiya Park, Boğaz Sahil, Ardenler Ormanı, Alp Dağ Geçidi, Eifel Orman Ring, Kapadokya Vadisi, Çöl Uçurumu, Ege Adaları, Ecelle Dans – Volkan Ağzı
- Zamana karşı, hızlı yarış, pit stop, güvenlik aracı, geri sarma
- Sunucusuz çevrim içi odalar (davet koduyla); klavye, Xbox kumandası ve telefon dokunmatik kontrolleri
- Oyna: $pageUrl

**EN**
- 10 circuits, time trial, quick race, pit stops, safety car, flashback
- Serverless online rooms (invite codes); keyboard, Xbox-style gamepad and phone touch controls
- Play: $pageUrl

Tüm takımlar, sürücüler ve sponsorlar kurgusaldır / All teams, drivers and sponsors are fictional.
"@

function Utf8File([string]$name, [string]$text) {
  $p = Join-Path $env:TEMP $name
  [IO.File]::WriteAllText($p, $text, (New-Object Text.UTF8Encoding $false))
  return $p
}
$bodyRepo = @{ description = $description; homepage = $pageUrl; has_issues = $true } | ConvertTo-Json
$bodyTopics = @{ names = $topics } | ConvertTo-Json
$fRepo = Utf8File 'hp-repo.json' $bodyRepo
$fTopics = Utf8File 'hp-topics.json' $bodyTopics
$fNotes = Utf8File 'hp-notes.md' $notes

if ($DryRun) {
  Write-Host "[DryRun] repo: $full"; Write-Host $bodyRepo; Write-Host $bodyTopics; Write-Host "release: $tag - $releaseTitle"; Write-Host $notes
  return
}

# 1. GitHub CLI
$gh = (Get-Command gh -ErrorAction SilentlyContinue).Source
if (-not $gh) { $gh = Join-Path $env:ProgramFiles 'GitHub CLI\gh.exe' }
if (-not (Test-Path $gh)) {
  Write-Host 'GitHub CLI (gh) kuruluyor (winget)...' -ForegroundColor Cyan
  winget install --id GitHub.cli -e --source winget --accept-package-agreements --accept-source-agreements
  $gh = Join-Path $env:ProgramFiles 'GitHub CLI\gh.exe'
  if (-not (Test-Path $gh)) { throw 'gh kurulamadi. https://cli.github.com adresinden elle kurup bu dosyayi yeniden calistirin.' }
}
# 2. Sign in (interactive, in the browser; credentials stay with gh)
& $gh auth status 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) {
  Write-Host 'GitHub giris: tarayici acilacak, ekrandaki kodu girip onaylayin.' -ForegroundColor Cyan
  & $gh auth login --hostname github.com --git-protocol https --web
  if ($LASTEXITCODE -ne 0) { throw 'GitHub girisi tamamlanmadi.' }
}
$me = (& $gh api user --jq .login).Trim()
Write-Host "Giris yapilan hesap: $me" -ForegroundColor Green
if ($me -ne $Owner) { Write-Warning "Depo sahibi $Owner ama giris yapan hesap $me. Yetkiniz yoksa islem basarisiz olur." }

# 3. Repo details, topics, release
Write-Host 'Aciklama ve web sitesi ayarlaniyor...'
& $gh api -X PATCH "repos/$full" --input $fRepo | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Depo ayarlari guncellenemedi.' }
Write-Host 'Konu etiketleri ayarlaniyor...'
& $gh api -X PUT "repos/$full/topics" -H 'Accept: application/vnd.github+json' --input $fTopics | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Konu etiketleri guncellenemedi.' }
& $gh release view $tag --repo $full 2>$null | Out-Null
if ($LASTEXITCODE -eq 0) {
  Write-Host "Surum $tag zaten var, atlandi."
} else {
  Write-Host "Ilk surum ($tag) olusturuluyor..."
  & $gh release create $tag --repo $full --target main --title $releaseTitle --notes-file $fNotes
  if ($LASTEXITCODE -ne 0) { throw 'Surum olusturulamadi.' }
}
Write-Host ''
Write-Host "Tamam. Depo: https://github.com/$full" -ForegroundColor Green
Write-Host "Oyun:  $pageUrl" -ForegroundColor Green