param([string]$OutputDirectory = (Join-Path (Split-Path $PSScriptRoot -Parent) '.local/native-capture'))
$ErrorActionPreference = 'Stop'
if ($env:OS -ne 'Windows_NT') { throw 'This native capture backend requires Windows.' }
$projectRoot = Split-Path $PSScriptRoot -Parent
$buildRoot = [IO.Path]::GetFullPath($OutputDirectory)
New-Item -ItemType Directory -Force $buildRoot | Out-Null
$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio/Installer/vswhere.exe'
$vsPath = & $vswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if (!$vsPath) { throw 'Visual Studio C++ Build Tools are required.' }
$vcvars = Join-Path $vsPath 'VC/Auxiliary/Build/vcvars64.bat'
$commandFile = Join-Path $buildRoot 'compile.cmd'
@"
@echo off
call "$vcvars" >nul
if errorlevel 1 exit /b 1
cd /d "$buildRoot"
cl /nologo /O2 /EHsc /W3 /MD /std:c++17 "$projectRoot\native\CapturePlayerCapture.cpp" /Fe:CapturePlayerCapture.exe /link mfplat.lib mf.lib mfreadwrite.lib mfuuid.lib ole32.lib d3d11.lib dxgi.lib d3dcompiler.lib avrt.lib
exit /b %errorlevel%
"@ | Set-Content -LiteralPath $commandFile -Encoding ASCII
& $env:ComSpec /d /c "`"$commandFile`""
if ($LASTEXITCODE -ne 0) { throw 'Native capture compilation failed.' }
& (Join-Path $PSScriptRoot 'stage-windows-redist.ps1') -Destination $buildRoot
