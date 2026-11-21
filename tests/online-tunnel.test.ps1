# Offline helper tests; no Pester installation or network required.
param([switch]$Integration, [switch]$FailureCases)
$ErrorActionPreference = 'Stop'
$path = Join-Path $PSScriptRoot '../scripts/online-tunnel.ps1'
$tokens = $null; $errors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($path, [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw ($errors | Out-String) }
$function = $ast.Find({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Find-TunnelUrl' }, $true)
. ([scriptblock]::Create($function.Extent.Text))
$cases = @(
    @('INF | https://sample-friends.trycloudflare.com |', 'https://sample-friends.trycloudflare.com'),
    @("stdout`nhttps://abc123.trycloudflare.com`nstderr", 'https://abc123.trycloudflare.com'),
    @('https://x.trycloudflare.com', 'https://x.trycloudflare.com'),
    @('https://sample.trycloudflare.com/', 'https://sample.trycloudflare.com'),
    @('https://sample.trycloudflare.com.evil.test', $null),
    @('https://sample.trycloudflare.com:123', $null),
    @('http://sample.trycloudflare.com', $null),
    @('https://-bad.trycloudflare.com', $null),
    @('https://bad-.trycloudflare.com', $null),
    @('https://api.cloudflare.com', $null),
    @('', $null)
)
foreach ($case in $cases) {
    $actual = Find-TunnelUrl $case[0]
    if ($actual -cne $case[1]) { throw "URL parse mismatch: $($case[0]) -> $actual" }
}
Write-Host "PASS: PowerShell parse; $($cases.Count) URL cases."

if (-not $Integration -and -not $FailureCases) { return }
# Generated fixtures stay in the workspace. Only the Desktop destination and
# repo discovery are substituted; the real build, HTTP, clipboard and jobs run.
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$fixture = Join-Path $repo 'test-results/online-tunnel-check'
New-Item -ItemType Directory -Force -Path $fixture | Out-Null
$desktop = Join-Path $fixture 'Desktop'
$env:LOCALAPPDATA = Join-Path $repo 'test-results/online-tunnel-local'
$source = [IO.File]::ReadAllText($path)
$source = $source.Replace('$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ''..''))', ('$repo = ''' + $repo.Replace("'", "''") + ''''))
$source = $source.Replace("[Environment]::GetFolderPath('Desktop')", ("'" + $desktop.Replace("'", "''") + "'"))
$fixtureScript = Join-Path $fixture 'online-tunnel.ps1'
[IO.File]::WriteAllText($fixtureScript, $source, [Text.Encoding]::ASCII)
$stub = Join-Path $fixture 'fake-cloudflared-v2.exe'
if (-not (Test-Path -LiteralPath $stub)) {
    Add-Type -OutputAssembly $stub -OutputType ConsoleApplication -TypeDefinition @'
using System;
using System.IO;
using System.Threading;
using System.Diagnostics;
public static class FakeTunnel {
    public static int Main(string[] args) {
        File.WriteAllText(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "stub-info.txt"),
            Process.GetCurrentProcess().Id + "\n" + string.Join(" ", args));
        Console.WriteLine("unrelated: https://api.cloudflare.com");
        bool silent = Environment.GetEnvironmentVariable("HAIRPIN_TUNNEL_TEST_MODE") == "silent";
        if (!silent) Console.Error.WriteLine("INF | https://sample-friends.trycloudflare.com |");
        Thread.Sleep(silent ? 70000 : 33000);
        return 7;
    }
}
'@
}
$browserRecord = Join-Path $fixture 'browser.txt'
$wrapper = @'
function Start-Process {
    param([string]$FilePath, [string[]]$ArgumentList, [string]$WorkingDirectory,
        [string]$WindowStyle, [switch]$PassThru, [string]$RedirectStandardOutput,
        [string]$RedirectStandardError)
    if ($FilePath -like 'https://*') {
        [IO.File]::WriteAllText('@@BROWSER@@', $FilePath)
        return
    }
    Microsoft.PowerShell.Management\Start-Process @PSBoundParameters
}
& '@@SCRIPT@@' -CloudflaredPath '@@STUB@@'
exit $LASTEXITCODE
'@
$wrapper = $wrapper.Replace('@@BROWSER@@', $browserRecord).Replace('@@SCRIPT@@', $fixtureScript).Replace('@@STUB@@', $stub)
$encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($wrapper))
# The stub URL never resolves: keep the public-address wait short.
$env:HAIRPIN_PUBLIC_WAIT_S = '0'
$beforeClipboard = Get-Clipboard -Raw
$occupied = New-Object Net.Sockets.TcpListener([Net.IPAddress]::Any, 8787)
try {
    # Verify free-port fallback, leaving the occupied socket untouched.
    $occupied.Start()
    & powershell -NoProfile -ExecutionPolicy Bypass -EncodedCommand $encoded 1> (Join-Path $fixture 'output.log') 2> (Join-Path $fixture 'error.log')
    if ($LASTEXITCODE -ne 1) { throw "Expected stub-exit failure, got $LASTEXITCODE." }
    $expected = 'https://sample-friends.trycloudflare.com'
    $address = Join-Path $desktop 'HAIRPIN GP/HAIRPIN GP Online Adres.txt'
    if ([IO.File]::ReadAllText($address).Trim() -cne $expected) { throw 'Address file mismatch.' }
    if ((Get-Clipboard -Raw).Trim() -cne $expected) { throw 'Clipboard mismatch.' }
    if ([IO.File]::ReadAllText($browserRecord) -cne $expected) { throw 'Browser call mismatch.' }
    $launcher = [IO.File]::ReadAllText((Join-Path $desktop 'HAIRPIN GP/HAIRPIN GP Online Sunucu.bat'))
    if ($launcher -notlike '*title HAIRPIN GP Online Sunucu*' -or $launcher -notlike '*-NoProfile -ExecutionPolicy Bypass -File*' -or $launcher -notlike '*pause*') { throw 'Launcher mismatch.' }
    $info = [IO.File]::ReadAllLines((Join-Path $fixture 'stub-info.txt'))
    if ($info[1] -notmatch '^tunnel --url http://localhost:(\d+) --no-autoupdate$') { throw 'Tunnel arguments mismatch.' }
    $port = [int]$Matches[1]
    if ($port -le 8787) { throw 'Occupied port was not skipped.' }
    if (Get-Process -Id ([int]$info[0]) -ErrorAction SilentlyContinue) { throw 'Stub survived cleanup.' }
    $reachable = $false
    try { Invoke-RestMethod "http://localhost:$port/health" -TimeoutSec 2 -Proxy $null | Out-Null; $reachable = $true } catch {}
    if ($reachable) { throw 'Server survived cleanup.' }
    $output = [IO.File]::ReadAllText((Join-Path $fixture 'output.log'))
    if ($output -notmatch '\[\d{2}:\d{2}:\d{2}\] /health') { throw '30-second status missing.' }
    Write-Host 'PASS: real cached server, occupied-port fallback, stderr URL, clipboard, address file, launcher, mocked browser, 30-second status and failure cleanup.'
} finally {
    $occupied.Stop()
    if ($beforeClipboard) { Set-Clipboard -Value $beforeClipboard }
}

if (-not $FailureCases) { return }
$typeCommand = $ast.Find({ param($node) $node -is [Management.Automation.Language.CommandAst] -and $node.GetCommandName() -eq 'Add-Type' }, $true)
if (-not ('HairpinTunnelJob' -as [type])) { Add-Type -TypeDefinition $typeCommand.CommandElements[2].Value }
$arguments = '-NoProfile -ExecutionPolicy Bypass -EncodedCommand ' + $encoded
$infoPath = Join-Path $fixture 'stub-info.txt'
$urlFile = Join-Path $desktop 'HAIRPIN GP/HAIRPIN GP Online Adres.txt'
$process = $null
try {
    Remove-Item -LiteralPath $infoPath,$urlFile -Force
    $process = [HairpinTunnelJob]::StartLogged('powershell', $arguments, $fixture, (Join-Path $fixture 'forced.out.log'), (Join-Path $fixture 'forced.err.log'))
    $deadline = [DateTime]::UtcNow.AddSeconds(25)
    while (-not (Test-Path -LiteralPath $urlFile)) {
        if ($process.HasExited -or [DateTime]::UtcNow -gt $deadline) { throw 'Forced-close fixture did not become ready.' }
        Start-Sleep -Milliseconds 200
    }
    $info = [IO.File]::ReadAllLines($infoPath)
    if ($info[1] -notmatch 'localhost:(\d+)') { throw 'Missing forced-close port.' }
    $port = [int]$Matches[1]
    $process.Kill(); $process.WaitForExit()
    $deadline = [DateTime]::UtcNow.AddSeconds(5)
    while ((Get-Process -Id ([int]$info[0]) -ErrorAction SilentlyContinue) -and [DateTime]::UtcNow -lt $deadline) { Start-Sleep -Milliseconds 100 }
    if (Get-Process -Id ([int]$info[0]) -ErrorAction SilentlyContinue) { throw 'Job left tunnel alive after parent termination.' }
    $reachable = $false
    try { Invoke-RestMethod "http://localhost:$port/health" -TimeoutSec 2 -Proxy $null | Out-Null; $reachable = $true } catch {}
    if ($reachable) { throw 'Job left server alive after parent termination.' }
    Write-Host 'PASS: force-killing the launcher also kills its server and tunnel.'
    $process.Dispose(); $process = $null

    $env:HAIRPIN_TUNNEL_TEST_MODE = 'silent'
    $process = [HairpinTunnelJob]::StartLogged('powershell', $arguments, $fixture, (Join-Path $fixture 'timeout.out.log'), (Join-Path $fixture 'timeout.err.log'))
    if (-not $process.WaitForExit(80000)) { throw '60-second URL timeout failed.' }
    $process.WaitForExit()
    if ($process.ExitCode -ne 1) { throw 'URL timeout should fail.' }
    $output = [IO.File]::ReadAllText((Join-Path $fixture 'timeout.out.log'))
    if ($output -notmatch '60 saniyede') { throw 'Missing Turkish URL timeout error.' }
    $info = [IO.File]::ReadAllLines($infoPath)
    if ($info[1] -notmatch 'localhost:(\d+)') { throw 'Missing timeout port.' }
    $port = [int]$Matches[1]
    if (Get-Process -Id ([int]$info[0]) -ErrorAction SilentlyContinue) { throw 'Timeout left tunnel alive.' }
    $reachable = $false
    try { Invoke-RestMethod "http://localhost:$port/health" -TimeoutSec 2 -Proxy $null | Out-Null; $reachable = $true } catch {}
    if ($reachable) { throw 'Timeout left server alive.' }
    Write-Host 'PASS: 60-second URL timeout reports a Turkish error and cleans both children.'
} finally {
    Remove-Item Env:HAIRPIN_TUNNEL_TEST_MODE -ErrorAction SilentlyContinue
    if ($process) { if (-not $process.HasExited) { $process.Kill() }; $process.Dispose() }
    if ($beforeClipboard) { Set-Clipboard -Value $beforeClipboard }
}
