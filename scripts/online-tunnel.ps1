<#
 Windows PowerShell 5.1. Builds committed HEAD only; never downloads dependencies.
 -DryRun checks the local release and /health without starting a tunnel.
 -CloudflaredPath accepts an alternate executable (including an offline test stub).
 Source stays ASCII so Windows PowerShell can read it without a BOM.
#>
[CmdletBinding()]
param([switch]$DryRun, [string]$CloudflaredPath)
$ErrorActionPreference = 'Stop'
$tr = @'
{
 "build":"Temiz s\u00fcr\u00fcm haz\u0131rlan\u0131yor:",
 "reuse":"Haz\u0131r s\u00fcr\u00fcm kullan\u0131l\u0131yor:",
 "send":"Bu adresi arkada\u015flar\u0131na g\u00f6nder",
 "ready":"Yerel sunucu haz\u0131r:",
 "dry":"Yerel deneme ba\u015far\u0131l\u0131; t\u00fcnel a\u00e7\u0131lmad\u0131.",
 "waiting":"T\u00fcnel adresi bekleniyor (en fazla 60 saniye)...",
 "timeout":"60 saniyede t\u00fcnel adresi al\u0131namad\u0131. \u0130nternet ba\u011flant\u0131n\u0131z\u0131 kontrol edip yeniden ba\u015flat\u0131n.",
 "missing":"cloudflared bulunamad\u0131. Kurulumu veya -CloudflaredPath yolunu kontrol edin.",
 "clipboard":"Adres panoya kopyalanamad\u0131; konsoldan veya adres dosyas\u0131ndan kopyalay\u0131n.",
 "browser":"Taray\u0131c\u0131 a\u00e7\u0131lamad\u0131; adresi elle a\u00e7\u0131n.",
 "keep":"Oyun boyunca bu pencere ve bilgisayar a\u00e7\u0131k kals\u0131n. Durdurmak i\u00e7in Ctrl+C.",
 "bye":"Sunucu ve t\u00fcnel durduruldu. G\u00f6r\u00fc\u015f\u00fcr\u00fcz!",
 "error":"Hata:",
 "serverExit":"Yerel sunucu beklenmedik \u015fekilde kapand\u0131.",
 "tunnelExit":"T\u00fcnel kapand\u0131. Yeni adres almak i\u00e7in yeniden ba\u015flat\u0131n.",
 "healthTimeout":"Yerel sunucu 60 saniyede haz\u0131r olmad\u0131.",
 "preparing":"Adres haz\u0131rlan\u0131yor\u2026",
 "dnsHint":"Adres internette haz\u0131r ama bu bilgisayar hen\u00fcz bulam\u0131yor (modem DNS \u00f6nbelle\u011fi). Birka\u00e7 dakika bekleyin, 'ipconfig /flushdns' \u00e7al\u0131\u015ft\u0131r\u0131n veya DNS olarak 1.1.1.1 kullan\u0131n. Arkada\u015flar\u0131n\u0131z genelde etkilenmez.",
 "notReady":"Adres hen\u00fcz yan\u0131t vermiyor; bir dakika sonra tekrar deneyin.",
 "busy":"Bu s\u00fcr\u00fcm ba\u015fka bir pencerede derleniyor. Biraz sonra yeniden deneyin."
}
'@ | ConvertFrom-Json

function Find-TunnelUrl([string]$Text) {
    $match = [regex]::Match($Text, 'https://[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.trycloudflare\.com(?![a-z0-9.:-])', 'IgnoreCase')
    if ($match.Success) { return $match.Value }
    return $null
}

$job = $null
$node = $null
$tunnel = $null
$mutex = $null
$locked = $false
$worktree = $null
$buildRepo = $null
$stage = $null
$session = $null
$exitCode = 0
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$root = [IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'HAIRPIN-GP-Server'))
$releaseParent = Join-Path $repo 'test-results'

try {
# A job owns only our children. Windows closes its handle even when the console
# is closed or PowerShell is terminated, killing these children and descendants.
# Native close callback avoids running PowerShell on an unmanaged callback thread.
if (-not ('HairpinTunnelJob' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
public sealed class HairpinTunnelJob : IDisposable {
    [StructLayout(LayoutKind.Sequential)] struct Basic {
        public long processTime, jobTime; public uint flags;
        public UIntPtr minWorking, maxWorking; public uint active;
        public UIntPtr affinity; public uint priority, scheduling;
    }
    [StructLayout(LayoutKind.Sequential)] struct Io {
        public ulong readOps, writeOps, otherOps, readBytes, writeBytes, otherBytes;
    }
    [StructLayout(LayoutKind.Sequential)] struct Extended {
        public Basic basic; public Io io;
        public UIntPtr processMemory, jobMemory, peakProcess, peakJob;
    }
    delegate bool Handler(uint signal);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode)] static extern IntPtr CreateJobObject(IntPtr attr, string name);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool SetInformationJobObject(IntPtr job, int info, ref Extended data, uint size);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll")] static extern bool SetConsoleCtrlHandler(Handler handler, bool add);
    IntPtr handle; Handler handler; string goodbye;
    public HairpinTunnelJob(string message) {
        goodbye = message; handle = CreateJobObject(IntPtr.Zero, null);
        if (handle == IntPtr.Zero) throw new Win32Exception();
        var data = new Extended(); data.basic.flags = 0x2000;
        if (!SetInformationJobObject(handle, 9, ref data, (uint)Marshal.SizeOf(data))) {
            CloseHandle(handle); handle = IntPtr.Zero; throw new Win32Exception();
        }
        handler = OnClose; SetConsoleCtrlHandler(handler, true);
    }
    public void Add(IntPtr process) {
        if (!AssignProcessToJobObject(handle, process)) throw new Win32Exception();
    }
    public static void ConfigureEnvironment(ProcessStartInfo start) {
        // Framework rejects duplicate PATH/Path entries from some launch hosts.
        try { var unused = start.EnvironmentVariables; } catch (ArgumentException) {}
        var variables = start.EnvironmentVariables; variables.Clear();
        foreach (System.Collections.DictionaryEntry entry in Environment.GetEnvironmentVariables())
            variables[(string)entry.Key] = (string)entry.Value;
    }
    public static Process StartLogged(string file, string args, string cwd, string stdout, string stderr) {
        var start = new ProcessStartInfo(file, args) {
            WorkingDirectory = cwd, UseShellExecute = false, CreateNoWindow = true,
            RedirectStandardOutput = true, RedirectStandardError = true
        };
        ConfigureEnvironment(start);
        File.WriteAllText(stdout, ""); File.WriteAllText(stderr, "");
        var process = new Process { StartInfo = start };
        process.OutputDataReceived += (sender, e) => {
            if (e.Data != null) try { File.AppendAllText(stdout, e.Data + Environment.NewLine); } catch {}
        };
        process.ErrorDataReceived += (sender, e) => {
            if (e.Data != null) try { File.AppendAllText(stderr, e.Data + Environment.NewLine); } catch {}
        };
        try {
            process.Start(); process.BeginOutputReadLine(); process.BeginErrorReadLine();
            return process;
        } catch { try { process.Kill(); } catch {} process.Dispose(); throw; }
    }
    bool OnClose(uint signal) {
        if (signal == 2 || signal == 5 || signal == 6) {
            Dispose(); try { Console.WriteLine(goodbye); } catch {};
        }
        return false;
    }
    public void Dispose() {
        var old = System.Threading.Interlocked.Exchange(ref handle, IntPtr.Zero);
        if (old != IntPtr.Zero) CloseHandle(old);
        SetConsoleCtrlHandler(handler, false);
    }
}
'@
}

    $job = New-Object HairpinTunnelJob $tr.bye
    $fullCommit = (& git -C $repo rev-parse HEAD).Trim()
    if ($LASTEXITCODE -ne 0) { throw 'HEAD okunamadi.' }
    $commit = (& git -C $repo rev-parse --short $fullCommit).Trim()
    if ($LASTEXITCODE -ne 0 -or $commit -notmatch '^[a-f0-9]{7,40}$') { throw 'HEAD okunamadi.' }
    $nodePath = (Get-Command node -CommandType Application -ErrorAction Stop).Source
    New-Item -ItemType Directory -Force -Path $root | Out-Null
    $release = Join-Path $root $commit
    $marker = Join-Path $release 'build-complete.txt'
    $mutex = New-Object Threading.Mutex($false, ('Local\HairpinOnlineBuild-' + $commit))
    try { $locked = $mutex.WaitOne(0) } catch [Threading.AbandonedMutexException] { $locked = $true }
    if (-not $locked) { throw $tr.busy }
    $finished = (Test-Path -LiteralPath $marker -PathType Leaf) -and
        (Test-Path -LiteralPath (Join-Path $release 'dist/index.html') -PathType Leaf) -and
        (Test-Path -LiteralPath (Join-Path $release 'apex-server.mjs') -PathType Leaf)
    if ($finished) { $finished = ([IO.File]::ReadAllText($marker).Trim() -eq $fullCommit) }
    if (-not $finished) {
        Write-Host "$($tr.build) $commit"
        if (-not (Test-Path -LiteralPath (Join-Path $repo 'node_modules') -PathType Container)) { throw 'node_modules bulunamadi; hazir bagimliliklar gerekiyor.' }
        New-Item -ItemType Directory -Force -Path $releaseParent | Out-Null
        $worktree = Join-Path $releaseParent ('online-release-' + [guid]::NewGuid().ToString('N'))
        $buildRepo = Join-Path $releaseParent ('online-git-' + [guid]::NewGuid().ToString('N'))
        $stage = Join-Path $root ($commit + '-' + [guid]::NewGuid().ToString('N') + '.tmp')
        # Private local metadata: the checkout's common git directory may be
        # outside this workspace. --shared reads existing objects, never a network.
        & git clone --bare --shared --quiet -- $repo $buildRepo
        if ($LASTEXITCODE -ne 0) { throw 'Yerel derleme deposu olusturulamadi.' }
        & git -C $buildRepo worktree add --quiet --detach $worktree $fullCommit
        if ($LASTEXITCODE -ne 0) { throw 'Temiz worktree olusturulamadi.' }
        New-Item -ItemType Junction -Path (Join-Path $worktree 'node_modules') -Target (Join-Path $repo 'node_modules') | Out-Null
        $config = "import { mergeConfig } from 'vite';`nimport base from './vite.config';`nexport default mergeConfig(base, { resolve: { preserveSymlinks: true } });`n"
        [IO.File]::WriteAllText((Join-Path $worktree 'vite.release.config.ts'), $config, (New-Object Text.UTF8Encoding $false))
        Push-Location $worktree
        try {
            & (Join-Path $worktree 'node_modules/.bin/vite.cmd') build --config vite.release.config.ts --configLoader runner
            if ($LASTEXITCODE -ne 0) { throw 'Istemci derlemesi basarisiz.' }
            & (Join-Path $worktree 'node_modules/.bin/vite.cmd') build --config server/vite.config.ts --configLoader runner
            if ($LASTEXITCODE -ne 0) { throw 'Sunucu derlemesi basarisiz.' }
        } finally { Pop-Location }
        if (-not (Test-Path -LiteralPath (Join-Path $worktree 'dist/index.html')) -or
            -not (Test-Path -LiteralPath (Join-Path $worktree 'server/dist/apex-server.mjs'))) { throw 'Derleme ciktilari eksik.' }
        New-Item -ItemType Directory -Path $stage | Out-Null
        Copy-Item -LiteralPath (Join-Path $worktree 'dist') -Destination (Join-Path $stage 'dist') -Recurse
        Copy-Item -LiteralPath (Join-Path $worktree 'server/dist/apex-server.mjs') -Destination $stage
        [IO.File]::WriteAllText((Join-Path $stage 'build-complete.txt'), $fullCommit)
        if (Test-Path -LiteralPath $release) {
            if ([IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($release)) -ne $root) { throw 'Guvenli olmayan surum yolu.' }
            Remove-Item -LiteralPath $release -Recurse -Force
        }
        if ([IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($stage)) -ne $root) { throw 'Guvenli olmayan gecici yol.' }
        Move-Item -LiteralPath $stage -Destination $release
        $stage = $null
    } else { Write-Host "$($tr.reuse) $commit" }
    # Remove the junction before asking git to remove this one private worktree.
    if ($worktree) {
        if ([IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($worktree)) -ne $releaseParent) { throw 'Guvenli olmayan worktree yolu.' }
        $junction = Join-Path $worktree 'node_modules'
        if (Test-Path -LiteralPath $junction) { [IO.Directory]::Delete($junction) }
        & git -C $buildRepo worktree remove --force $worktree
        if ($LASTEXITCODE -ne 0) { throw 'Gecici worktree kaldirilamadi.' }
        $worktree = $null
    }
    if ($buildRepo) {
        if ([IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($buildRepo)) -ne $releaseParent) { throw 'Guvenli olmayan derleme deposu yolu.' }
        Remove-Item -LiteralPath $buildRepo -Recurse -Force
        $buildRepo = $null
    }
    $mutex.ReleaseMutex(); $locked = $false

    $port = 8787
    for (; $port -le 65535; $port++) {
        $listener = New-Object Net.Sockets.TcpListener([Net.IPAddress]::Any, $port)
        try { $listener.Start(); break } catch [Net.Sockets.SocketException] {} finally { $listener.Stop() }
    }
    if ($port -gt 65535) { throw 'Bos TCP portu bulunamadi.' }
    $localUrl = "http://localhost:$port"
    $session = Join-Path $root ('run-' + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $session | Out-Null
    # Child-only environment: never mutate the caller's PORT/CERT_DIR/etc.
    $start = New-Object Diagnostics.ProcessStartInfo
    $start.FileName = $nodePath
    $start.Arguments = 'apex-server.mjs'
    $start.WorkingDirectory = $release
    $start.UseShellExecute = $false
    $start.CreateNoWindow = $true
    [HairpinTunnelJob]::ConfigureEnvironment($start)
    $childEnvironment = $start.EnvironmentVariables
    $childEnvironment['PORT'] = [string]$port
    $childEnvironment['TRUST_PROXY'] = 'cloudflare'
    $childEnvironment['DATA_DIR'] = Join-Path $root 'data'
    $childEnvironment['DIST_DIR'] = Join-Path $release 'dist'
    $childEnvironment.Remove('CERT_DIR')
    # The release contains no certs directory; HTTP remains loopback tunnel input.
    $node = [Diagnostics.Process]::Start($start)
    $job.Add($node.Handle)
    $deadline = [DateTime]::UtcNow.AddSeconds(60)
    $health = $null
    while ([DateTime]::UtcNow -lt $deadline) {
        if ($node.HasExited) { throw $tr.serverExit }
        try { $health = Invoke-RestMethod -Uri "$localUrl/health" -TimeoutSec 2 -Proxy $null; break } catch { Start-Sleep -Milliseconds 250 }
    }
    if (-not $health) { throw $tr.healthTimeout }
    Write-Host "$($tr.ready) $localUrl/health"
    Write-Host ($health | ConvertTo-Json -Compress -Depth 5)
    if ($DryRun) { Write-Host $tr.dry; return }

    if (-not $CloudflaredPath) {
        $CloudflaredPath = Join-Path ${env:ProgramFiles(x86)} 'cloudflared/cloudflared.exe'
        if (-not (Test-Path -LiteralPath $CloudflaredPath -PathType Leaf)) {
            $command = Get-Command cloudflared -CommandType Application -ErrorAction SilentlyContinue
            if ($command) { $CloudflaredPath = $command.Source }
        }
    }
    if (-not (Test-Path -LiteralPath $CloudflaredPath -PathType Leaf)) { throw $tr.missing }
    $CloudflaredPath = (Resolve-Path -LiteralPath $CloudflaredPath).ProviderPath
    $tunnelOut = Join-Path $session 'tunnel.out.log'
    $tunnelErr = Join-Path $session 'tunnel.err.log'
    $tunnel = [HairpinTunnelJob]::StartLogged($CloudflaredPath, "tunnel --url $localUrl --no-autoupdate", $session, $tunnelOut, $tunnelErr)
    $job.Add($tunnel.Handle)
    Write-Host $tr.waiting
    $deadline = [DateTime]::UtcNow.AddSeconds(60)
    $url = $null
    while ([DateTime]::UtcNow -lt $deadline) {
        if ($node.HasExited) { throw $tr.serverExit }
        $output = (Get-Content -LiteralPath $tunnelOut,$tunnelErr -Raw -ErrorAction SilentlyContinue) -join "`n"
        $url = Find-TunnelUrl $output
        if ($url) { break }
        if ($tunnel.HasExited) { throw $tr.tunnelExit }
        Start-Sleep -Milliseconds 200
    }
    if (-not $url) { throw $tr.timeout }
    # The new name needs some seconds before it exists in DNS. Asking the system resolver too early makes the home modem (and
    # Windows) cache "not found" for minutes, so wait on Cloudflare's resolver first, then check the address end to end.
    Write-Host $tr.preparing
    $publicWait = 60
    if ($env:HAIRPIN_PUBLIC_WAIT_S -match '^\d+$') { $publicWait = [int]$env:HAIRPIN_PUBLIC_WAIT_S }
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
    $tunnelHost = ([Uri]$url).Host
    $publicDns = $false; $localDns = $false; $publicOk = $false; $flushed = $false
    $deadline = [DateTime]::UtcNow.AddSeconds($publicWait)
    while ([DateTime]::UtcNow -lt $deadline) {
        if ($node.HasExited) { throw $tr.serverExit }
        if ($tunnel.HasExited) { throw $tr.tunnelExit }
        if (-not $publicDns) {
            try { Resolve-DnsName -Name $tunnelHost -Server 1.1.1.1 -Type A -DnsOnly -QuickTimeout -ErrorAction Stop | Out-Null; $publicDns = $true } catch {}
        }
        if ($publicDns) {
            $localDns = $false
            try { [Net.Dns]::GetHostAddresses($tunnelHost) | Out-Null; $localDns = $true } catch {}
            if ($localDns) {
                try { $publicOk = (Invoke-WebRequest -UseBasicParsing -Uri "$url/health" -TimeoutSec 5).StatusCode -eq 200 } catch {}
                if ($publicOk) { break }
            } elseif (-not $flushed) {
                # A negative answer cached by Windows itself can be dropped without admin rights.
                ipconfig /flushdns | Out-Null
                $flushed = $true
            }
        }
        Start-Sleep -Seconds 2
    }
    if (-not $publicOk) { if ($publicDns -and -not $localDns) { Write-Warning $tr.dnsHint } else { Write-Warning $tr.notReady } }
    $desktopFolder = Join-Path (Split-Path $repo -Parent) 'HAIRPIN GP'
    New-Item -ItemType Directory -Force -Path $desktopFolder | Out-Null
    $addressFile = Join-Path $desktopFolder 'HAIRPIN GP Online Adres.txt'
    $launcher = @(
        '@echo off',
        'title HAIRPIN GP Online Sunucu',
        ('powershell -NoProfile -ExecutionPolicy Bypass -File "' + $PSCommandPath + '" %*'),
        'set "HAIRPIN_EXIT=%ERRORLEVEL%"',
        'pause',
        'exit /b %HAIRPIN_EXIT%'
    ) -join "`r`n"
    [IO.File]::WriteAllText((Join-Path $desktopFolder 'HAIRPIN GP Online Sunucu.bat'), ($launcher + "`r`n"), [Text.Encoding]::ASCII)
    [IO.File]::WriteAllText($addressFile, ($url + "`r`n"), (New-Object Text.UTF8Encoding $false))
    Write-Host "`n============================================================" -ForegroundColor Cyan
    Write-Host $tr.send -ForegroundColor Yellow
    Write-Host "`n  $url`n" -ForegroundColor Green
    Write-Host '============================================================' -ForegroundColor Cyan
    Write-Host $addressFile
    try { Set-Clipboard -Value $url } catch { Write-Warning $tr.clipboard }
    try { Start-Process $url } catch { Write-Warning $tr.browser }
    Write-Host $tr.keep
    $nextHealth = [DateTime]::UtcNow.AddSeconds(30)
    while ($true) {
        if ($node.HasExited) { throw $tr.serverExit }
        if ($tunnel.HasExited) { throw $tr.tunnelExit }
        if ([DateTime]::UtcNow -ge $nextHealth) {
            $health = Invoke-RestMethod -Uri "$localUrl/health" -TimeoutSec 3 -Proxy $null
            Write-Host ("[{0:HH:mm:ss}] /health {1}" -f (Get-Date), ($health | ConvertTo-Json -Compress -Depth 5))
            $nextHealth = [DateTime]::UtcNow.AddSeconds(30)
        }
        Start-Sleep -Milliseconds 250
    }
} catch {
    $exitCode = 1
    Write-Host "$($tr.error) $($_.Exception.Message)" -ForegroundColor Red
    Write-Host $_.ScriptStackTrace
    if ($session) {
        Get-ChildItem -LiteralPath $session -Filter '*.log' | ForEach-Object {
            Get-Content -LiteralPath $_.FullName -Tail 12 -ErrorAction SilentlyContinue | Write-Host
        }
    }
} finally {
    # Explicit PID cleanup also covers a failure while assigning a child to the job.
    foreach ($child in @($tunnel, $node)) {
        if ($child) {
            try { if (-not $child.HasExited) { $child.Kill() }; if ($child.WaitForExit(5000)) { $child.WaitForExit() } } catch { Write-Warning $_ }
            $child.Dispose()
        }
    }
    if ($job) { $job.Dispose() }
    if ($worktree -and -not (Test-Path -LiteralPath $worktree)) { $worktree = $null }
    if ($worktree -and ([IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($worktree)) -eq $releaseParent)) {
        try {
            $junction = Join-Path $worktree 'node_modules'
            if (Test-Path -LiteralPath $junction) { [IO.Directory]::Delete($junction) }
            & git -C $buildRepo worktree remove --force $worktree
            if ($LASTEXITCODE -eq 0) { $worktree = $null }
        } catch { Write-Warning $_ }
    }
    if ($buildRepo -and -not $worktree -and ([IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($buildRepo)) -eq $releaseParent)) {
        try { Remove-Item -LiteralPath $buildRepo -Recurse -Force } catch { Write-Warning $_ }
    }
    foreach ($temporary in @($stage, $session)) {
        if ($temporary -and ([IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($temporary)) -eq $root)) {
            try { if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Recurse -Force } } catch { Write-Warning $_ }
        }
    }
    if ($locked) { $mutex.ReleaseMutex() }
    if ($mutex) { $mutex.Dispose() }
    Write-Host $tr.bye
}
exit $exitCode
