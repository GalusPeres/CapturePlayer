param([string]$Destination = (Join-Path (Split-Path $PSScriptRoot -Parent) '.local/windows-redist'))
$ErrorActionPreference = 'Stop'
if ($env:OS -ne 'Windows_NT') { throw 'Windows redistributables require a Windows build host.' }
$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio/Installer/vswhere.exe'
$vsPath = & $vswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if (!$vsPath) { throw 'Visual Studio C++ Build Tools are required.' }
$crt = Get-ChildItem (Join-Path $vsPath 'VC/Redist/MSVC') -Directory |
    Where-Object { $_.Name -match '^\d+\.' } |
    Sort-Object { [version]$_.Name } -Descending |
    ForEach-Object { Get-ChildItem (Join-Path $_.FullName 'x64') -Directory -Filter 'Microsoft.VC*.CRT' -ErrorAction SilentlyContinue } |
    Select-Object -ExpandProperty FullName -First 1
if (!$crt) { throw 'Release x64 VC++ redistributables not found.' }
New-Item -ItemType Directory -Force $Destination | Out-Null
foreach ($file in @('msvcp140.dll', 'msvcp140_1.dll', 'msvcp140_2.dll', 'msvcp140_atomic_wait.dll', 'msvcp140_codecvt_ids.dll', 'vcruntime140.dll', 'vcruntime140_1.dll')) {
    Copy-Item -LiteralPath (Join-Path $crt $file) -Destination (Join-Path $Destination $file)
}
