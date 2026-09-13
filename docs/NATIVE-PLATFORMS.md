# Native capture on macOS and Linux — implementation status

Updated 2026-09-13 for CapturePlayer 0.5.0. These are experimental backends,
not certified platform releases. The new code retains the existing React UI,
NativeVideo presenter, color/zoom/aspect controls and FSR passes.

| Platform | Native capture and transport | Verification in this workspace |
| --- | --- | --- |
| Windows x64 | Media Foundation NV12/P010 / D3D11 helper, FP16 shared NT handles | RTX 4080 / Elgato live measurements; HDR and NV12 color tests; OBS compatibility capture at 1440p, SDR, no audio |
| Linux x64 | New V4L2 streaming backend; exported linear NV12/P010 DMA-BUF planes | Compiled in isolated Alpine Linux; N-API buffer ownership tests passed. No real capture/GPU import/display test |
| macOS Apple Silicon | New AVFoundation backend; retained CVPixelBuffer / IOSurface; NV12 or P010 | TypeScript integration and simulated menu tests passed. Apple SDK compilation and ownership tests are required by the release workflow; M1 capture/display validation remains pending |

The OS backends are in `native/portable/`. `electron/nativeCaptureFactory.ts`
selects the matching implementation. The portable addon uses stable N-API 8,
not Electron-specific V8 bindings. `npm run native:build` compiles for the current
host. Build a macOS arm64 addon on a macOS arm64 runner; Windows executables
cannot be repackaged as native Mac/Linux code.

## Frame ownership and latency

- Capture callbacks transfer handles and metadata, never complete pixel arrays
  through JavaScript. Actual GPU import support depends on Electron and its driver.
- The native bridge allows at most three outstanding image buffers across old
  and new sessions and only one queued JS callback. Producers never wait for JS.
- macOS discards late AVFoundation samples. The Linux thread drains completed
  V4L2 buffers and selects the newest before delivery.
- A capture buffer is retained until Electron reports `allReferencesReleased`.
  Closing settings or restarting capture must not let the driver overwrite a
  texture that Chromium still uses. Old-generation callbacks are discarded.
- There is no per-frame status IPC polling. Counters update once per second;
  a one-second watchdog detects a stopped input after three seconds.
- Color, zoom and FSR remain GPU operations in the existing presenter. FSR
  supersampling is optional and adds GPU cost, especially on a fanless M1 Air.

These design choices bound application buffering. They do **not** prove zero
controller-to-photon latency, zero CPU load or stutter-free playback. USB capture,
GPU scheduling and display scanout still take time. No M1 performance figures
have been measured here.

## HDR and format limits

macOS accepts native P010 only for HDR and verifies incoming BT.2020 plus PQ/HLG
tags. It does not convert an SDR buffer to ten bits and call it HDR. Linux currently
accepts linear, contiguous, single-planar V4L2 NV12 or P010; HDR explicitly means
limited-range BT.2020/PQ, as in the Windows HDR10 input mode. Multi-planar V4L2,
MJPEG/YUYV conversion, drivers without DMA-BUF export, and tiled capture buffers
are not implemented in the direct backend. Unsupported SDR capture falls back
to Chromium capture and feeds VideoFrames to the same GPU presenter, using a
single-frame TrackProcessor queue. No frame pixel arrays are copied through JS.
HDR failures remain explicit; SDR fallback is not presented as HDR. OBS Virtual
Camera always uses compatibility SDR capture. Diagnostics identify the transport.

Changing only the audio selection keeps the video track and capture device open.
No audio device means no microphone request or audio processing graph.

The shared HDR presenter requests an extended-range FP16 WebGPU canvas. Actual
HDR presentation still requires a compatible OS compositor, GPU driver and display.
An M1 processor does not make every connected display HDR-capable. Evaluate the
MacBook Air's internal panel separately from an external HDR display.

Elgato documents that 4K X HDR USB capture is unavailable on macOS and that its HDR
video is converted to SDR there; HDMI HDR passthrough is a separate path. This
backend cannot recover HDR data that the card/driver does not deliver.
[Elgato supported formats](https://help.elgato.com/hc/en-us/articles/23479175821069-Elgato-Game-Capture-4K-X-Supported-Resolutions-and-Frame-Rates).

The menu hides the current Windows-only Neural section on macOS and Linux.
FSR remains available. HDR checks native device formats; unsupported HDR is
disabled with the reason in the existing tooltip. An active HDR option remains
switchable off even after unplugging the card. FSR Reset works without a Neural
form. Native capture does not offer the unsupported 144 FPS setting.

## Builds and validation

The release workflow now builds the native backend before packaging on each OS.
Windows includes its C++ runtime; Linux/macOS include `captureplayer.node` in
resources. The package hook fails if the platform binary is missing. The Mac
package includes camera and microphone usage descriptions. Neural runtime
distribution remains separate from the normal release configuration.

```
npm ci
npm run native:build
node scripts/test-portable-native.mjs # Linux/macOS, no capture hardware needed
npx tsc --noEmit
npm run build
node scripts/test-platform-settings.mjs # hidden Electron window
node scripts/test-capture-compatibility.mjs # hidden, simulated devices
node scripts/test-capture-compatibility.mjs --obs # optional live OBS, no hardware card opened
node scripts/test-native-nv12.mjs # Windows hidden GPU color test
```

The native ownership test builds a mock producer against the actual N-API bridge.
It checks invalid inputs, failed startup, a three-buffer ceiling, retained buffers
across restart, release recovery, stale-generation suppression and device errors.
It is not a camera test. The hidden React test simulates macOS/Linux/Windows and
checks Neural visibility, FSR/Reset and HDR device capability changes.

Before making native capture the default on the M1 or Linux: run the produced
package on that host, test actual device formats and permissions, verify live
SDR/HDR color and GPU texture import, then measure sustained 720p/1080p/1440p/4K
frame pacing, CPU/energy, reconnects, resolution switches, sleep and display moves.
Compare FSR off/on separately. Measure physical delay against HDMI passthrough;
callback timestamps alone are not an input-latency measurement.

API references: [Electron shared textures](https://www.electronjs.org/docs/latest/api/structures/shared-texture-handle),
[V4L2 DMA-BUF export](https://www.kernel.org/doc/html/latest/userspace-api/media/v4l/vidioc-expbuf.html),
[Apple IOSurface buffers](https://developer.apple.com/documentation/corevideo/cvpixelbuffergetiosurface(_:)).
