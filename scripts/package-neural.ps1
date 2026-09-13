param([switch]$Setup)
$ErrorActionPreference = 'Stop'
if ($env:OS -ne 'Windows_NT') { throw 'This package requires Windows.' }
$projectRoot = Split-Path $PSScriptRoot -Parent
Push-Location $projectRoot
try {
    foreach ($relative in @('.local/native-capture/CapturePlayerCapture.exe', '.local/neural-runtime/CapturePlayerNeural.exe', '.local/neural-runtime/nvngx.dll_ns-forwarder.dll', '.local/neural-runtime/nvngx_dlssnr.dll', '.local/neural-runtime/NeuralScreen-LICENSE.txt')) {
        if (!(Test-Path -LiteralPath (Join-Path $projectRoot $relative))) { throw "Missing $relative. Build the native and neural helpers first." }
    }
    # App-local CRT DLLs let both native helpers start without a separate VC++
    # installer. Use the release redistributables shipped with the build tools.
    $vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio/Installer/vswhere.exe'
    $vsPath = & $vswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
    if (!$vsPath) { throw 'Visual Studio C++ redistributables are required to package the helpers.' }
    $crt = Get-ChildItem (Join-Path $vsPath 'VC/Redist/MSVC') -Directory | Where-Object { $_.Name -match '^\d+\.' } | Sort-Object { [version]$_.Name } -Descending | ForEach-Object { Join-Path $_.FullName 'x64/Microsoft.VC143.CRT' } | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
    if (!$crt) { throw 'Release x64 VC++ redistributables not found.' }
    $redist = Join-Path $projectRoot '.local/windows-redist'
    New-Item -ItemType Directory -Force $redist | Out-Null
    foreach ($file in @('msvcp140.dll', 'msvcp140_1.dll', 'msvcp140_2.dll', 'msvcp140_atomic_wait.dll', 'msvcp140_codecvt_ids.dll', 'vcruntime140.dll', 'vcruntime140_1.dll')) {
        Copy-Item -LiteralPath (Join-Path $crt $file) -Destination (Join-Path $redist $file)
    }
    npm run build
    if ($LASTEXITCODE -ne 0) { throw 'Application build failed.' }
    if ($Setup) {
        npx electron-builder --win nsis --x64 --publish never --config scripts/electron-builder-neural.cjs '--config.directories.output=dist/windows-neural'
    } else {
        npx electron-builder --dir --win --x64 --publish never --config scripts/electron-builder-neural.cjs
    }
    if ($LASTEXITCODE -ne 0) { throw 'Packaging failed.' }
    if ($Setup) { Write-Output 'Windows setup ready: dist/windows-neural' }
    else { Write-Output 'Ready: .local/neural-package/win-unpacked/CapturePlayer Neural Test.exe' }
} finally { Pop-Location }
