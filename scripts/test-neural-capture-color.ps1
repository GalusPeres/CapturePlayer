param([switch]$Warp)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$testRoot = Join-Path $projectRoot '.local/neural-color-test'
New-Item -ItemType Directory -Force $testRoot | Out-Null
$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio/Installer/vswhere.exe'
$vsPath = & $vswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if (!$vsPath) { throw 'Visual Studio C++ Build Tools are required.' }
$vcvars = Join-Path $vsPath 'VC/Auxiliary/Build/vcvars64.bat'
$testArgument = if ($Warp) { '--warp' } else { '' }
$commands = @"
@echo off
call "$vcvars" >nul
if errorlevel 1 exit /b 1
cd /d "$testRoot"
cl /nologo /O2 /EHsc /W3 /MD /std:c++17 "$projectRoot\native\NeuralCaptureColorTest.cpp" /Fe:"$testRoot\NeuralCaptureColorTest.exe" /link d3d11.lib d3dcompiler.lib user32.lib
if errorlevel 1 exit /b 1
"$testRoot\NeuralCaptureColorTest.exe" $testArgument
exit /b %errorlevel%
"@
$commandFile = Join-Path $testRoot 'test.cmd'
Set-Content -LiteralPath $commandFile -Value $commands -Encoding ASCII
& $env:ComSpec /d /c "`"$commandFile`""
if ($LASTEXITCODE -ne 0) { throw 'Neural capture color GPU test failed.' }
