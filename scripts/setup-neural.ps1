param([switch]$HelpersOnly)
$ErrorActionPreference = 'Stop'
if ($env:OS -ne 'Windows_NT') { throw 'The neural preview requires Windows.' }
$projectRoot = Split-Path $PSScriptRoot -Parent
$buildRoot = Join-Path $projectRoot '.local/neural-build'
$runtimeRoot = Join-Path $projectRoot '.local/neural-runtime'
$revision = '9f5cf8650b865e46e74587a18c3146990852c348'
$baseUrl = "https://raw.githubusercontent.com/perseval-BLR/DLSS5-NeuralScreen/$revision"
New-Item -ItemType Directory -Force $buildRoot,$runtimeRoot | Out-Null
$tree = Invoke-RestMethod "https://api.github.com/repos/perseval-BLR/DLSS5-NeuralScreen/git/trees/$revision`?recursive=1"
$files = @('native/dlss5-feed-host64.cpp','native/ns_forwarder.cpp','native/src/feed_ipc.h','LICENSE','native/lib/Windows_x86_64/x64/nvsdk_ngx_d.lib')
$files += @($tree.tree | Where-Object { $_.path -like 'native/include/*.h' -and $_.path -notlike 'native/include/spout/*' } | ForEach-Object { $_.path })
foreach ($relative in $files) {
    $destination = Join-Path $buildRoot $relative
    New-Item -ItemType Directory -Force (Split-Path $destination -Parent) | Out-Null
    if (!(Test-Path -LiteralPath $destination)) { Invoke-WebRequest "$baseUrl/$relative" -OutFile $destination }
}
Copy-Item -LiteralPath (Join-Path $buildRoot 'LICENSE') -Destination (Join-Path $runtimeRoot 'NeuralScreen-LICENSE.txt')
node (Join-Path $PSScriptRoot 'patch-neural-worker.mjs') $buildRoot
if ($LASTEXITCODE -ne 0) { throw 'Worker patch failed.' }
$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio/Installer/vswhere.exe'
$vsPath = & $vswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if (!$vsPath) { throw 'Install Visual Studio C++ Build Tools and Windows SDK first.' }
$vcvars = Join-Path $vsPath 'VC/Auxiliary/Build/vcvars64.bat'
$nativeRoot = Join-Path $buildRoot 'native'
$commands = @"
@echo off
call "$vcvars" >nul
if errorlevel 1 exit /b 1
cd /d "$nativeRoot"
cl /nologo /O2 /EHsc /W3 /MD /std:c++17 /Iinclude /LD ns_forwarder.cpp /Fe:"$runtimeRoot\nvngx.dll_ns-forwarder.dll" /link kernel32.lib d3d12.lib
if errorlevel 1 exit /b 1
cl /nologo /O2 /EHsc /W3 /MD /std:c++20 /Iinclude CapturePlayerNeural.cpp /Fe:"$runtimeRoot\CapturePlayerNeural.exe" /link lib\Windows_x86_64\x64\nvsdk_ngx_d.lib version.lib kernel32.lib user32.lib gdi32.lib advapi32.lib ole32.lib d3d11.lib d3d12.lib dxgi.lib d3dcompiler.lib WindowsApp.lib dwmapi.lib
exit /b %errorlevel%
"@
$commandFile = Join-Path $buildRoot 'compile.cmd'
Set-Content -LiteralPath $commandFile -Value $commands -Encoding ASCII
& $env:ComSpec /d /c "`"$commandFile`""
if ($LASTEXITCODE -ne 0) { throw 'Native compilation failed.' }
& (Join-Path $PSScriptRoot 'stage-windows-redist.ps1') -Destination $runtimeRoot
if ($HelpersOnly) {
    Write-Output "Neural helpers built without downloading the NVIDIA runtime: $runtimeRoot"
    exit 0
}

# This is an explicitly installed, local experimental runtime. It is never
# copied into a normal release or committed. See docs/DLSS5-EXPERIMENT.md.
$archive = Join-Path $buildRoot 'neuralscreen-v1.7.0-full.zip'
$cachedArchive = Join-Path $projectRoot '.local/dlss5-research/neuralscreen-v1.7.0-full.zip'
if (!(Test-Path -LiteralPath $archive)) {
    if (Test-Path -LiteralPath $cachedArchive) { Copy-Item -LiteralPath $cachedArchive -Destination $archive }
    else { Invoke-WebRequest 'https://github.com/perseval-BLR/DLSS5-NeuralScreen/releases/download/v1.7.0/neuralscreen-v1.7.0-full.zip' -OutFile $archive }
}
$expected = '301b351383020d98d5c521c288371b43661d741d719cbb9b43bede63331e32de'
$archiveStream = [IO.File]::OpenRead($archive)
$sha = [Security.Cryptography.SHA256]::Create()
try { $actual = [BitConverter]::ToString($sha.ComputeHash($archiveStream)).Replace('-', '').ToLowerInvariant() }
finally { $archiveStream.Dispose(); $sha.Dispose() }
if ($actual -ne $expected) { throw 'Runtime archive hash mismatch.' }
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [IO.Compression.ZipFile]::OpenRead($archive)
try {
    $entries = @($zip.Entries | Where-Object { $_.FullName -match '(^|/)native/nvngx_dlssnr\.dll$' })
    if ($entries.Count -ne 1) { throw 'Expected exactly one neural runtime in the pinned archive.' }
    [IO.Compression.ZipFileExtensions]::ExtractToFile($entries[0], (Join-Path $runtimeRoot 'nvngx_dlssnr.dll'), $true)
} finally { $zip.Dispose() }
Write-Output "Neural preview built: $runtimeRoot"
