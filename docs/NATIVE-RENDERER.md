# Native renderer: HDR, latency and platform work

The historical Windows measurements below predate the new portable backends.
See [native macOS/Linux implementation and validation](NATIVE-PLATFORMS.md)
for their current status and packaging. They are not yet hardware-validated.

Status: 2026-09-12. Experimental Windows implementation, tested with an RTX
4080, driver 616.64, Elgato 4K X and Switch 2. Windows HDR and VSync enabled;
the physical output is 2560×1440 at 165 Hz. Linux/macOS backends are not
implemented or tested. No claim of zero latency or superiority to other players.

## Implemented path

Media Foundation P010 → CPU upload → D3D11 limited-range YUV/PQ conversion →
shared FP16 texture → Electron sharedTexture → WebGPU presentation. JavaScript
receives frame handles, not pixel arrays. The upload still uses CPU memory:
this is not end-to-end zero-copy capture.

Single-buffer samples now use read-only IMF2DBuffer2 access when available,
retaining the real plane pitch instead of forcing a contiguous read/write
buffer. The live Elgato reports `bufferAccess: read-only-2d` and dynamic GPU
upload. Initial 1440p measurements reduced CPU-side buffer access/upload from
about 2.0 ms to 0.39 ms per frame; upload plus GPU completion was about 1.9 ms.
This is not a claim that total input latency dropped by the entire 1.6 ms.
See Microsoft's [2D buffer access guidance](https://learn.microsoft.com/en-us/windows/win32/api/mfobjects/nf-mfobjects-imf2dbuffer2-lock2dsize).

A capture thread continuously reads the source and keeps only its newest
unconsumed sample. Three shared GPU slots bound resource usage; they are not
a deliberate three-frame FIFO. GPU completion uses a fence/event instead of
repeated flushing/polling. Released slots can be reused only after Chromium
releases the imported image. Parent-owned NT handles are closed after producer
exit and release of every imported image.

The native HDR shader supports brightness, contrast, saturation, hue and
sharpness. FSR EASU uses an intermediate FP16 texture; RCAS and color adjustment
share the final pass. A reversible normalization accommodates negative and
above-SDR-white values. FSR runs only if the displayed image is larger than
the actual capture frame. Capture resolution changes require **Apply**.
The AI processing resolution does not change capture resolution.

Zoom uses a six-vertex rectangle. Scaling an oversized fullscreen triangle
previously exposed out-of-range texture coordinates when zooming out, causing
the diagonal image and smeared borders. The hidden GPU test checks 50% zoom.

## Neural HDR composition

The optional community neural model still processes SDR. Native HDR stays
unchanged in the player canvas. Windows Graphics Capture acquires that window
as FP16 scRGB; a GPU pass creates the normalized SDR model input. The final
pass adds the model's linear-light difference to the original FP16 HDR image,
using the inverse scale of the input mapping. A FP16 scRGB swapchain displays
that result. This is **HDR composition around SDR inference**, not native HDR
inference or an official NVIDIA HDR integration.

An unchanged SDR result reproduces the HDR base, including negative wide-gamut
components and values above SDR white. Strength zero bypasses inference and
presents the original FP16 capture. Comparison works because the unchanged
side contributes no neural difference. Neural output may still alter colors,
texture, text and UI; the procedure cannot guarantee artistic fidelity.

Windows SDR white is queried for the target monitor, with periodic refresh.
The Neural presenter now inherits the player's active VSync setting and uses
Present(1) when enabled. Its waitable swapchain is limited to one queued frame;
the wait occurs before acquiring the latest captured image. Earlier measurements
below predate this propagation fix (Electron VSync was on, Neural used Present(0)).
An earlier 8-bit WGC capture clipped HDR. A subsequent SDR-only workaround
removed HDR highlights. Both are superseded by the HDR composition path.
The user confirmed that the current live HDR output looks correct.

Microsoft recommends retaining FP16 throughout HDR capture to avoid clipped,
washed-out results: [screen capture documentation](https://learn.microsoft.com/en-us/windows/apps/develop/media-authoring-processing/screen-capture).

## Measurements and their limits

Use `node scripts/benchmark-native.mjs 19287 15 <label>` while the development
player exposes that local debugging port. It records JSON under
`.local/benchmarks`, including active source/canvas dimensions, FSR execution
mode, native/Neural telemetry, settings changes, frame delivery gaps, long tasks
and CPU time across the player's process tree. Nothing changes in the player.
Reject mixed settings/Neural-mode runs and warmup for comparisons. A checkbox
alone is not evidence that FSR executed: require canvas mode `fsr1`.

Short live runs on this machine, 15 seconds each:

| Actual capture → output | Effects | Frame delivery | Gap p95 | Largest gap | Player system CPU |
| --- | --- | ---: | ---: | ---: | ---: |
| 1440p → 1440p | Native HDR, Neural off, FSR bypass | 60.00 FPS | 18.0 ms | 19.4 ms | 2.58% |
| 720p → 1440p | Native HDR + actual FSR, Neural off | 60.00 FPS | 18.8 ms | 20.6 ms | 1.67% |
| 720p → 1440p | HDR + FSR + Neural 1440p / 50% | 60.00 FPS | 17.1 ms | 17.5 ms | 2.09% |

None of these runs recorded delivery gaps over 25 ms. CPU is normalized over all
16 logical processors and includes the Electron subprocesses and helpers,
not the whole machine. Other applications, scenes and GPU clocks were not
controlled; these are observations, not a general performance ranking.

After layout polling was replaced with ResizeObserver and unchanged diagnostic
DOM attributes stopped being rewritten, a 45-second run at 1440p capture/output,
HDR and Neural 1440p/50% produced 2,698 delivery intervals: 60.00 FPS, p95
17.2 ms, maximum 18.2 ms, no intervals over 25 ms and 2.71% player CPU.
It had no settings/Neural mode changes and no renderer long tasks. These data
do not isolate the performance effect of the layout change from GPU clocks
and scene changes. Later runs with controls changed during capture are excluded
from quality-mode comparisons.

In the live HDR composition test with 1440p AI and 50% strength, Neural
processing was approximately 9.7–10 ms, with GPU inference around 8.3–8.6 ms.
This includes a different AI size from the earlier 1080p measurements.
The exact per-run data is in the benchmark reports; do not compare the two
as if the HDR pass alone accounts for the difference.

Native `timing.gpu` measures CPU upload/submission plus the GPU completion
wait, not a GPU timestamp query. `sampleAge` uses the Elgato's observed
Media Foundation clock timestamps; it does not include unknown delay before
that timestamp. Neural `processingMs` starts at WGC dequeue and ends after
Present submission; it excludes earlier capture/composition and physical scanout.
`presentGap` records submission cadence, not when pixels became visible.
Do not add these numbers and call the result controller-to-photon latency.

A later 45-second baseline with the read-only buffer path and Neural VSync
actually enabled (1440p HDR capture/output, AI 1440p, Strength 61%, original
model parameters) recorded 2,699 delivery intervals: 60.00 FPS, p95 17.6 ms,
maximum 28.4 ms, two gaps over 25 ms, none over 40 ms and 2.11% player CPU.
Settings remained stable. This is evidence of occasional delivery outliers,
not proof of completely stutter-free playback. Raw report:
`.local/benchmarks/tuning-before-1789249417565.json`.

After adding live model tuning, a final unchanged 30-second run at 1440p HDR
capture/output, AI 1440p, Strength 100%, VSync on and default model parameters
recorded 1,799 delivery intervals: 60.00 FPS, p95 17.3 ms, maximum 17.9 ms,
no gaps over 25 ms and 2.21% player CPU. The last telemetry window reported
10.27 ms mean Neural processing, 10.85 ms p95 and 8.7 ms GPU inference.
However, earlier Neural telemetry windows in the SAME run reported submission
gaps of 26.67, 25.31 and 56.33 ms. Smooth input delivery did not guarantee smooth
Neural output. No renderer long tasks or native dropped frames were sampled,
so these observations locate the remaining issue after native frame delivery;
they do not isolate WGC, scheduling, GPU contention or the compositor as its
cause. The benchmark summary now exposes the maximum across all collected
Neural telemetry windows rather than hiding outliers behind the final window.
FSR was correctly bypassed for equal capture/output dimensions. The source
was the live Switch signal (the menu was visible during UI verification),
not a controlled moving-scene or controller-latency test. Two earlier runs
with Strength/skin changes are excluded from fixed-configuration comparisons.
Raw report: `.local/benchmarks/tuning-final-steady-1789250026409.json`.

All four fine-tuning controls were exercised through the actual React inputs;
the worker acknowledged their values without a PID/start-time change, and
HDR/VSync remained active. The UI reset preserved unrelated settings and
the persisted JSON matched the active parameters. Hidden pixel tests separately
confirmed model-output changes and exact reset. These checks do not establish
that every skin mask correctly identifies Nintendo characters.

PresentMon ETW collection was attempted without elevation and Windows denied
trace access. No display/scanout trace or physical input-latency measurement
has been collected. Administrator elevation has not been performed.

For an actual comparative latency test, use a 240 FPS or faster camera to
record the HDMI passthrough reference and the player display simultaneously,
showing a visible changing counter or repeatable response. Compare the same
event at the same vertical screen position, with identical capture resolution,
HDR mode, monitor refresh and display processing. Record at least 100 samples
per configuration and report median, p95 and worst case. At 240 FPS the camera
quantization is 4.17 ms; account for rolling shutter and reference-display delay.
Capture-player lag relative to passthrough is not the same as total controller
lag. Compare OBS/other players only after matching their buffering settings.

A 165 Hz display has a non-integer refresh ratio to 60 FPS. An additional
120 Hz comparison would separate refresh cadence effects from frame delivery
jitter; no display refresh setting was changed by these tests.

## Porting without rebuilding the interface

Keep the React player, settings, zoom/aspect controls and WGSL color/FSR passes.
Replace acquisition and GPU-handle transport behind a platform-specific capture
backend. Electron 42.4 already exposes Windows NT handles, macOS IOSurface and
Linux nativePixmap planes with DMA-BUF file descriptors in its
[shared texture handle API](https://raw.githubusercontent.com/electron/electron/v42.4.0/docs/api/structures/shared-texture-handle.md).
That is a transport primitive, not proof of working capture/HDR on every system.

| Platform | Acquisition / transport to implement | HDR and Neural constraints |
| --- | --- | --- |
| Windows | Current MF/D3D11 backend; add native NV12/other 8-bit formats for 4K60 SDR | FP16 HDR output and experimental Neural HDR composition implemented here |
| macOS | AVFoundation video output, CVPixelBuffer/IOSurface, Metal conversion; in-process native bridge for IOSurface ownership | EDR/HDR output must be verified per display. Elgato documents no HDR capture from 4K X on macOS. Current Neural Windows/D3D12 runtime has no macOS backend |
| Linux | V4L2 capture; DMA-BUF export/import where supported; GPU conversion and transfer of FDs via native IPC | Verify card P010 support, Vulkan/WebGPU import, driver and Wayland compositor color-management support. Current Neural runtime has no native Linux backend |

The Linux file descriptors and macOS IOSurface references cannot be sent as
arbitrary numbers from a separate process: ownership and native IPC transport
must be implemented. If the driver cannot export/import without copying,
provide a measured fallback and report that capability accurately.

References: [V4L2 buffer export](https://www.kernel.org/doc/html/latest/userspace-api/media/v4l/vidioc-expbuf.html),
[AVFoundation video output](https://developer.apple.com/documentation/avfoundation/avcapturevideodataoutput),
[Wayland color management](https://wayland.freedesktop.org/docs/book/Color.html).

FSR 1 is a spatial GPU algorithm and is not NVIDIA-specific. The current
experimental Neural helper depends on Windows capture, D3D12 and a locally
installed NVIDIA runtime. Do not infer Linux/macOS support from support for
other DLSS products. See [the runtime project](https://github.com/perseval-BLR/DLSS5-NeuralScreen).

## 4K X limits

Elgato lists P010 HDR capture at **1440p60 or 4K30**, not 4K60. Its NV12/MJPEG
paths can capture 4K60 SDR. An application cannot turn HDMI HDR passthrough
capability into unsupported USB HDR capture. 1440p60 HDR can instead be
upscaled to a 4K60 display, but that is not native 4K60 HDR capture.
Elgato also states that 4K X converts HDR to SDR before sending to macOS.
[Supported formats and platform restrictions](https://help.elgato.com/hc/en-us/articles/23479175821069-Elgato-Game-Capture-4K-X-Supported-Resolutions-and-Frame-Rates).

Next platform milestones: enumerate real devices/formats; deliver a bounded
stream with clean ownership; verify known HDR patches; pass zoom/color/FSR
tests on each backend; then measure the real card and physical display.
The existing Windows binaries cannot simply be copied into a Mac/Linux build.

## Verification

```
npx tsc --noEmit
npm run build
npm run native:build
npm run native:test
powershell -NoProfile -File scripts/test-neural-capture-color.ps1
node scripts/test-native-handles.mjs
```

Tests run without visible test-pattern windows. They cover PQ/limited range,
HDR color controls, FSR color preservation, zoom borders, Windows SDR-white
normalization, HDR-composite identity/bypass and signed/bright HDR samples.
They do not establish perceptual quality across all games or physical latency.
Normal release packaging now includes the platform's native capture backend.
The community Neural runtime remains separate from normal release packaging.
