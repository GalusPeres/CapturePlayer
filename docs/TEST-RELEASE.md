CapturePlayer **0.5.0-beta.2** is an experimental test release, not a stable update.

- Windows x64: Setup installer and portable executable, with the native Media Foundation capture renderer.
- macOS Apple Silicon (M1 and newer): DMG with the new AVFoundation/IOSurface native backend.
- Linux x64: AppImage with the new V4L2/DMA-BUF native backend.
- Shared color, zoom/aspect and FSR controls; platform-aware settings hide unavailable Neural controls and check HDR capture formats.
- Native Windows NV12 support and compatible SDR capture for OBS Virtual Camera and legacy drivers, using the same GPU presenter. Audio selection changes no longer restart video.
- Clear video mode names: Browser playback, GPU processing (WebGL), and Direct capture (Windows/macOS/Linux). The dropdown uses compact single-line entries; hover over Video mode for a short explanation of all three modes.
- Performance diagnostics are included in installed builds under View. All three modes use the same layout, showing frame delivery, long frame intervals, actual FSR processing resolution and audio state. These are software measurements, not controller-to-screen latency.
- Audio resumes after output interruptions and retries the selected input after disconnects. Recovery leaves video running, respects No audio device and uses bounded retries. Linux uses the audio backend's interactive buffer policy.
- Mac/Linux texture delivery keeps only the latest waiting frame when Electron is busy. This is covered by simulated transport/ownership tests; actual M1 latency still needs measurement on the device.

Select **Settings → View → Video mode → Direct capture** to test the new backend. It remains opt-in. The Windows package includes the Neural helpers. Under **Effects → DLSS 5 Neural Rendering → Select DLL**, import your separately obtained `nvngx_dlssnr.dll` (tested version 310.8.0.0). CapturePlayer validates its x64 PE format and known checksum, stores it in the app data folder and reuses it after restart/update. No NVIDIA model DLL is bundled or downloaded by the app. Import does not establish permission to use or distribute the file. This experimental Neural integration is Windows/NVIDIA only; it is not implemented on Linux or macOS. FSR is available on all three platforms.

HDR requires a compatible capture signal, driver, GPU/compositor and display. macOS verifies tagged 10-bit PQ/HLG frames; Elgato documents that 4K X HDR USB capture is unavailable on macOS. HDMI HDR passthrough is separate. Linux direct native capture requires uncompressed NV12/P010 with DMA-BUF export; incompatible SDR formats use browser capture feeding the GPU presenter. Hardware HDR failures remain explicit. OBS Virtual Camera uses SDR.

The packages are unsigned. Native Mac/Linux capture, HDR output and sustained performance still need real hardware testing. Successful builds and ownership tests do not establish zero latency or stutter-free playback.

Please report OS, GPU, capture card, input resolution/FPS, HDR state and whether Native/FSR are enabled when reporting a problem. SHA-256 checksums are included with the downloads.

When comparing 1440p and 4K, test with FSR off first. At matching 1440p source/output sizes, FSR adds a 4K supersampling-and-resolve step; at 4K the higher tier is capped. The two settings can therefore have different processing costs. The diagnostics show the actual internal resolution. No change to this supersampling behavior is claimed in beta 2.
