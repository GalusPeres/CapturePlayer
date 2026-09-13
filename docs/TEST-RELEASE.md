This is an experimental test release of CapturePlayer 0.5.0, not a stable update.

- Windows x64: Setup installer and portable executable, with the native Media Foundation capture renderer.
- macOS Apple Silicon (M1 and newer): DMG with the new AVFoundation/IOSurface native backend.
- Linux x64: AppImage with the new V4L2/DMA-BUF native backend.
- Shared color, zoom/aspect and FSR controls; platform-aware settings hide unavailable Neural controls and check HDR capture formats.

Select **Settings → View → Renderer → Native (experimental)** to test the new backend. It remains opt-in. This release includes native capture and FSR; it does **not** include the separately installed proprietary community Neural/DLSS runtime.

HDR requires a compatible capture signal, driver, GPU/compositor and display. macOS verifies tagged 10-bit PQ/HLG frames; Elgato documents that 4K X HDR USB capture is unavailable on macOS. HDMI HDR passthrough is separate. Linux currently requires uncompressed NV12/P010 capture with DMA-BUF export. Unsupported formats/drivers report an error rather than silently claiming HDR support.

The packages are unsigned. Native Mac/Linux capture, HDR output and sustained performance still need real hardware testing. Successful builds and ownership tests do not establish zero latency or stutter-free playback.

Please report OS, GPU, capture card, input resolution/FPS, HDR state and whether Native/FSR are enabled when reporting a problem. SHA-256 checksums are included with the downloads.
