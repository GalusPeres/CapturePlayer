$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
Push-Location $projectRoot
try {
    npm run build
    if ($LASTEXITCODE -ne 0) { throw 'Application build failed.' }
    npx electron-builder --dir --win --x64 '--config.productName=CapturePlayer Neural Test' '--config.extraMetadata.name=captureplayer-neural-test' '--config.extraMetadata.productName=CapturePlayer Neural Test' '--config.directories.output=.local/neural-package' '--config.win.signAndEditExecutable=false'
    if ($LASTEXITCODE -ne 0) { throw 'Packaging failed.' }
    $destination = Join-Path $projectRoot '.local/neural-package/win-unpacked/neural-runtime'
    New-Item -ItemType Directory -Force $destination | Out-Null
    foreach ($file in @('CapturePlayerNeural.exe','nvngx.dll_ns-forwarder.dll','nvngx_dlssnr.dll','NeuralScreen-LICENSE.txt')) {
        Copy-Item -LiteralPath (Join-Path $projectRoot ".local/neural-runtime/$file") -Destination (Join-Path $destination $file)
    }
    Copy-Item -LiteralPath (Join-Path $projectRoot 'docs/DLSS5-EXPERIMENT.md') -Destination (Join-Path $projectRoot '.local/neural-package/win-unpacked/DLSS5-EXPERIMENT.md')
    Write-Output 'Ready: .local/neural-package/win-unpacked/CapturePlayer Neural Test.exe'
} finally { Pop-Location }
