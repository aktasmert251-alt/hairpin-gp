# HAIRPIN GP - Oracle Always Free ARM (A1.Flex) otomatik deneme betigi.
# "Out of host capacity" hatasi gelince bekleyip tekrar dener; makine acilinca IP'yi yazar ve durur.
# Yalnizca Always Free sekli (VM.Standard.A1.Flex) ister, zaten bir A1 makinesi varsa hic denemez.
#
# Kullanim:
#   powershell -ExecutionPolicy Bypass -File oci-retry.ps1 -DryRun   # hicbir sey olusturmaz, ayarlari kontrol eder
#   powershell -ExecutionPolicy Bypass -File oci-retry.ps1           # denemeye baslar
param(
  [switch]$DryRun,
  [int]$IntervalSec = 90,
  [string]$SubnetName = 'public subnet-hairpingp-vcn',
  [string]$InstanceName = 'hairpingp',
  [string]$SshKeyFile = "$HOME\.ssh\apexgp.pub"
)

$ErrorActionPreference = 'Stop'
$env:OCI_CLI_SUPPRESS_FILE_PERMISSIONS_WARNING = 'True'
$Desktop = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..\..\..\HAIRPIN GP\Oracle'))
New-Item -ItemType Directory -Force $Desktop | Out-Null
$LogFile = Join-Path $Desktop 'ORACLE-DENEME-KAYIT.txt'
$WorkDir = Join-Path $env:LOCALAPPDATA 'HairpinGP-Oracle'
New-Item -ItemType Directory -Force $WorkDir | Out-Null
# Windows App Control blocks uv's unsigned oci.exe launcher, so run the CLI through its own (signed) python.exe.
$Oci = Join-Path $env:APPDATA 'uv\tools\oci-cli\Scripts\python.exe'
$OciRun = Join-Path $WorkDir 'oci_run.py'
[IO.File]::WriteAllText($OciRun, "import sys`nfrom oci_cli.cli import cli`nsys.argv[0] = 'oci'`nsys.exit(cli())`n", (New-Object Text.UTF8Encoding $false))

# Denenecek boyutlar (siradan): once 2 cekirdek / 12 GB, olmazsa 1 cekirdek / 6 GB. Ucretsiz sinir 4 / 24.
$Sizes = @(@{ ocpus = 2; memoryInGBs = 12 }, @{ ocpus = 1; memoryInGBs = 6 })

function Log([string]$msg, [string]$color = 'Gray') {
  $line = '{0:yyyy-MM-dd HH:mm:ss}  {1}' -f (Get-Date), $msg
  Write-Host $line -ForegroundColor $color
  Add-Content -Path $LogFile -Value $line -Encoding UTF8
}

# OCI CLI'yi calistirir; ciktiyi ve hata metnini dondurur (istisna atmaz).
function Invoke-Oci([string[]]$OciArgs) {
  $outFile = Join-Path $WorkDir 'out.txt'
  $errFile = Join-Path $WorkDir 'err.txt'
  $p = Start-Process -FilePath $Oci -ArgumentList (@((Q $OciRun)) + $OciArgs) -NoNewWindow -Wait -PassThru `
    -RedirectStandardOutput $outFile -RedirectStandardError $errFile
  [pscustomobject]@{
    Code = $p.ExitCode
    Out  = (Get-Content $outFile -Raw -ErrorAction SilentlyContinue)
    Err  = (Get-Content $errFile -Raw -ErrorAction SilentlyContinue)
  }
}

function Get-Json([string[]]$OciArgs, [string]$what) {
  $r = Invoke-Oci $OciArgs
  if ($r.Code -ne 0) { throw "$what alinamadi: $($r.Err)" }
  if ([string]::IsNullOrWhiteSpace($r.Out)) { return $null }
  return ($r.Out | ConvertFrom-Json)
}

function Q([string]$s) { '"' + $s + '"' }

# --- On kontroller -------------------------------------------------------------------------------
$ConfigFile = "$HOME\.oci\config"
if (-not (Test-Path $Oci)) { Log "OCI CLI bulunamadi: $Oci" 'Red'; exit 1 }
if (-not (Test-Path $ConfigFile)) { Log "Oracle ayar dosyasi yok: $ConfigFile  (ORACLE-API-ANAHTARI.txt adimlarini yap)" 'Red'; exit 1 }
if (-not (Test-Path $SshKeyFile)) { Log "SSH acik anahtari yok: $SshKeyFile" 'Red'; exit 1 }

$cfg = Get-Content $ConfigFile -Raw
$tenancy = ([regex]::Match($cfg, '(?m)^\s*tenancy\s*=\s*(\S+)')).Groups[1].Value
$region = ([regex]::Match($cfg, '(?m)^\s*region\s*=\s*(\S+)')).Groups[1].Value
if (-not $tenancy) { Log 'config dosyasinda tenancy= satiri yok.' 'Red'; exit 1 }
Log "Bolge: $region" 'Cyan'

try {
  $ads = (Get-Json @('iam', 'availability-domain', 'list', '--compartment-id', $tenancy) 'Availability domain listesi').data | ForEach-Object { $_.name }
  Log ("Availability domain: " + ($ads -join ', ')) 'Cyan'

  $subnets = (Get-Json @('network', 'subnet', 'list', '--compartment-id', $tenancy, '--all') 'Alt ag listesi').data
  $subnet = $subnets | Where-Object { $_.'display-name' -eq $SubnetName } | Select-Object -First 1
  if (-not $subnet) { Log "Alt ag bulunamadi: '$SubnetName'. Var olanlar: $(($subnets | ForEach-Object { $_.'display-name' }) -join ', ')" 'Red'; exit 1 }
  Log "Alt ag: $SubnetName" 'Cyan'

  $images = (Get-Json @('compute', 'image', 'list', '--compartment-id', $tenancy, '--operating-system', (Q 'Canonical Ubuntu'),
      '--operating-system-version', '24.04', '--shape', 'VM.Standard.A1.Flex', '--sort-by', 'TIMECREATED', '--sort-order', 'DESC', '--all') 'Ubuntu imaji').data
  $image = $images | Select-Object -First 1
  if (-not $image) { Log 'Ubuntu 24.04 ARM imaji bulunamadi.' 'Red'; exit 1 }
  Log "Imaj: $($image.'display-name')" 'Cyan'

  $existing = (Get-Json @('compute', 'instance', 'list', '--compartment-id', $tenancy, '--all') 'Makine listesi').data |
    Where-Object { $_.shape -eq 'VM.Standard.A1.Flex' -and $_.'lifecycle-state' -notin @('TERMINATED', 'TERMINATING') }
  if ($existing) { Log "Hesapta zaten bir A1 makinesi var ($($existing[0].'display-name'), $($existing[0].'lifecycle-state')). Yenisi denenmeyecek." 'Yellow'; exit 0 }
} catch {
  Log "On kontrol hatasi: $($_.Exception.Message)" 'Red'; exit 1
}

if ($DryRun) { Log 'DENEME MODU: ayarlar dogru gorunuyor. Hicbir sey olusturulmadi.' 'Green'; exit 0 }

# --- Deneme dongusu ------------------------------------------------------------------------------
$wait = $IntervalSec
$attempt = 0
Log "Basliyor. Her $IntervalSec sn'de bir denenecek. Durdurmak icin pencereyi kapat." 'Green'
while ($true) {
  foreach ($size in $Sizes) {
    foreach ($ad in $ads) {
      $attempt++
      $shapeFile = Join-Path $WorkDir 'shape.json'
      ($size | ConvertTo-Json -Compress) | Set-Content -Path $shapeFile -Encoding ASCII
      Log ("Deneme #{0}: {1} cekirdek / {2} GB, {3}" -f $attempt, $size.ocpus, $size.memoryInGBs, $ad)
      # --no-retry: otherwise the CLI silently retries "Out of host capacity" (HTTP 500) for ~100 s per attempt.
      $r = Invoke-Oci @('--no-retry', 'compute', 'instance', 'launch', '--availability-domain', $ad, '--compartment-id', $tenancy,
        '--shape', 'VM.Standard.A1.Flex', '--shape-config', ('file://' + $shapeFile), '--image-id', $image.id,
        '--subnet-id', $subnet.id, '--assign-public-ip', 'true', '--display-name', $InstanceName,
        '--ssh-authorized-keys-file', (Q $SshKeyFile))
      if ($r.Code -eq 0) {
        $inst = ($r.Out | ConvertFrom-Json).data
        Log "MAKINE OLUSTURULDU: $($inst.id). Calisir duruma gelmesi bekleniyor..." 'Green'
        $ip = $null
        for ($i = 0; $i -lt 40 -and -not $ip; $i++) {
          Start-Sleep -Seconds 15
          try {
            $vn = (Get-Json @('compute', 'instance', 'list-vnics', '--instance-id', $inst.id) 'VNIC').data | Select-Object -First 1
            if ($vn) { $ip = $vn.'public-ip' }
          } catch { }
        }
        $ready = Join-Path $Desktop 'ORACLE-SUNUCU-HAZIR.txt'
        @(
          'HAIRPIN GP - Oracle sunucusu olusturuldu',
          ('Tarih      : {0:yyyy-MM-dd HH:mm}' -f (Get-Date)),
          "Bolge      : $region",
          "Boyut      : $($size.ocpus) cekirdek / $($size.memoryInGBs) GB",
          "Public IP  : $ip",
          '',
          'Claude''a sadece Public IP, DuckDNS adi ve bolgeyi gonder.',
          'DuckDNS sayfasinda "current ip" kutusuna bu IP''yi yazip "update ip" yap.'
        ) | Set-Content -Path $ready -Encoding UTF8
        Log "Public IP: $ip  (masaustu: ORACLE-SUNUCU-HAZIR.txt)" 'Green'
        for ($k = 0; $k -lt 5; $k++) { [System.Media.SystemSounds]::Exclamation.Play(); Start-Sleep -Milliseconds 700 }
        Add-Type -AssemblyName System.Windows.Forms
        [System.Windows.Forms.MessageBox]::Show("Oracle sunucusu olustu!`nPublic IP: $ip", 'HAIRPIN GP') | Out-Null
        exit 0
      }
      $err = "$($r.Err)"
      if ($err -match 'Out of host capacity|OutOfCapacity|InternalError') {
        Log 'Yer yok (Out of host capacity).' 'DarkGray'
        $wait = $IntervalSec
      } elseif ($err -match 'TooManyRequests|429') {
        $wait = [Math]::Min($wait * 2, 900)
        Log "Oracle cok sik istek dedi; bekleme $wait sn'ye cikti." 'Yellow'
      } elseif ($err -match 'LimitExceeded|QuotaExceeded') {
        Log "Ucretsiz sinir asilir gorunuyor, durduruldu. Ayrinti: $err" 'Red'; exit 1
      } elseif ($err -match 'NotAuthenticated|NotAuthorized|Unauthorized') {
        Log "Kimlik dogrulama hatasi, durduruldu (API anahtari/config). Ayrinti: $err" 'Red'; exit 1
      } else {
        $wait = [Math]::Min([Math]::Max($wait, $IntervalSec) * 2, 900)
        Log ("Beklenmeyen hata, tekrar denenecek ({0} sn): {1}" -f $wait, ($err -replace '\s+', ' ').Substring(0, [Math]::Min(300, $err.Length))) 'Yellow'
      }
    }
  }
  Start-Sleep -Seconds $wait
}
