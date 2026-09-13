# DLSS 5 neural preview experiment

This branch adds an opt-in **Settings → Effects → DLSS 5 Neural Rendering**
preview for Windows and RTX GPUs. It runs actual NGX feature 18, using a
locally installed experimental community runtime. It is not an official
NVIDIA integration.

The native capture renderer now supports an experimental HDR composition
around the SDR model. FP16 window capture retains the original HDR base;
the neural difference is applied on the GPU and displayed with FP16 HDR output.
This is not native HDR inference. See [native renderer measurements and limits](NATIVE-RENDERER.md).

## Trying it

The Windows manual-import package includes `CapturePlayerNeural.exe`, the
forwarder, its source license and C++ dependencies, but excludes the NVIDIA
model DLL. Use **Effects → DLSS 5 Neural Rendering → Select DLL** and select
your separately obtained `nvngx_dlssnr.dll`. Currently only tested version
310.8.0.0 is accepted (SHA-256
`dcc0dc2414aedec4a8e084647070383be068554042587180c20c784d4772d36f`).
Import verifies the copied PE/x64 DLL and exact checksum without executing it.
The DLL is kept under the app's user data directory and revalidated at startup.
Cancelling or failing an import leaves the previous installation intact.
GPU initialization happens when Neural is enabled with a live capture signal.
Selecting a DLL does not establish its licensing or grant redistribution rights.

For a helpers-only build, run `scripts/setup-neural.ps1 -HelpersOnly`; this
does not download the NVIDIA model archive. `node scripts/test-neural-import.mjs`
uses the existing local test DLL to exercise validation, persistence and failure
recovery. The legacy local package below remains available for development.

Use the separate local **CapturePlayer Neural Test.exe** build, or run:

```powershell
npm run neural:setup
npm run dev
```

`npm run neural:package` creates the separate local test executable under
`.local/neural-package/win-unpacked`. It has its own app name and settings
profile. Keep its `neural-runtime` folder next to the executable.

`npm run neural:setup-exe` builds the Windows x64 NSIS installer at
`dist/windows-neural/CapturePlayer.NeuralTest.Setup.0.4.0.exe` (version follows
package.json). It includes both native helpers, the locally installed Neural
runtime, app-local release VC++ DLLs and the experiment documentation. The
installer uses a separate test app identity and is not automatically published.
Both commands expect `native:build` and `neural:setup` to have completed.

The setup needs Visual Studio C++ Build Tools and a Windows SDK. It compiles
the pinned native helper, verifies the pinned runtime archive's SHA-256,
and installs everything under `.local/neural-runtime`. Nothing is installed
into the driver or another application. The normal release configuration
bundles the helpers but excludes the NVIDIA model DLL.

1. Start the capture card with the desired source format, up to 4K/60.
2. Choose window/fullscreen size. The preview adapts automatically after resizing.
3. Open Settings → Effects, leave AI resolution at Auto, and turn DLSS 5 on.
4. Close Settings to inspect the picture. The comparison checkbox leaves
   the original on the left and puts the neural result on the right.
5. Turn it off with the same switch or **Ctrl+Alt+Backspace**.

The effect remains active on focus/mouse changes. Its native window is owned
by the player and follows the player's z-order. Resizing/fullscreen briefly
shows the original, then rebuilds the preview after 350 ms without further
size changes. Minimize pauses it; restore resumes. Manual stop cancels any
pending restart. Capture stop, page reload, worker failure or app exit stops
the effect. An unsupported/missing runtime is shown as unavailable;
the app never labels a plain shader or passthrough as active DLSS.

## What the prototype does

The existing player still acquires the capture card and plays its audio.
A native helper captures **only the CapturePlayer window** with Windows
Graphics Capture, shares that GPU texture between D3D11 and D3D12, runs
neural rendering, and presents a click-through preview over the same window.
Electron exchanges control packets and timing numbers, not full video frames.
The WGC frame pool is bounded and drained to the newest available image.
An arrival event avoids a polling delay. Where Windows supports it,
`MinUpdateInterval` removes WGC's default capture-rate restriction.

The output keeps the **physical window resolution**. On a 4K display in
fullscreen that is 3840×2160. A 4K card connected to a 1440p display does
not turn that display into a 4K display. At smaller window sizes, Windows
has already scaled the picture before this experimental stage receives it.

Auto starts with an AI processing size bounded by 1920×1080 and reduces through
1600×900 to 1280×720 after sustained processing above 17.5 ms. If that still exceeds
the budget, it restores the original. Manual 720p/900p/1080p/1440p modes also
restore the original under sustained overload. This is a processing-budget
guard, **not a guarantee of 60 source frames or zero stutters**.

The smaller neural result is combined with the original at the output
resolution using the upstream residual composite. The network is not
running at native 4K when the UI says AI 1080p.

The effect-strength slider controls a final 0–100% blend. At 0% the player
bypasses neural evaluation after warmup (window capture/presentation still
runs; switch Off to remove that extra stage). At intermediate values the
native-resolution original anchors the composite. Quality can be changed
while active; strength and comparison updates do not restart the worker.

### Fine tuning

View → DLSS 5 → Fine tuning exposes model intensity, light/color tone,
detail structure and skin structure (0–100%). These are evaluation parameters,
separate from the final Strength blend and from the player Color/FSR controls.
Defaults preserve the previous image: intensity/tone/structure 100%, skin Auto.
Manual skin values enable the runtime automatic mask; Auto restores its old
default (-1, mask off). Recognition of stylized characters is not guaranteed.
The mask can add GPU work, so a lower skin value is not a performance setting.

A 24-byte TUNE command is acknowledged at a frame boundary. Slider updates
are coalesced to the newest values without restarting the model, capture,
textures or presentation window. No additional image pass or pixel readback
is added. Settings are validated on both sides and saved in neural-tuning.json
in the app profile. Reset fine tuning affects only these four parameters.

`node scripts/test-neural-tuning.mjs` runs a hidden GPU test with pipe-only
input/output: actual output changes, exact reset, and rejection of non-finite
or out-of-range parameters. The skin comparison holds automatic masking on
for both endpoints to isolate the slider from the mask switch. This proves
parameter effects, not correct face segmentation on every game. Pixel readback
is confined to that test, never used in normal playback.

The optimized path writes the BGRA-to-RGBA compute result directly into the
input texture, removing a full-frame GPU copy. The zero 8×8 motion field is
uploaded once and reused until changed. The controller reuses its small
packet buffer. No GPU-to-CPU video readback is used in the player.

## Measurements on this computer

2026-09-12: RTX 4080, driver 616.64. Animated synthetic source on a 165 Hz
display; the test explicitly checks the WGC output dimensions, including
a real 3840×2160 window. Approximate averages from the last five reported
samples in each short run:

| Physical output | AI size | Processed frames/s | Processing mean | Processing p95 |
| --- | --- | ---: | ---: | ---: |
| 1280×720 | 1280×720 | 165 | 4.3 ms | 4.5 ms |
| 3840×2160 | 1280×720 | 165 | 5.6 ms | 6.0 ms |
| 3840×2160 | 1920×1080 | 138 | 7.0 ms | 7.4 ms |

These numbers establish GPU processing capacity for this synthetic scene.
They are **not a benchmark of a console, capture card, or button-to-photon
latency**. The normal app was additionally exercised with Chromium's fake
60 FPS camera: stream start, settings toggle, actual NR activation, toggle
off, focus changes, strength slider, resizing/fullscreen, minimize/restore,
live quality changes and cancelling a pending restart.

An immediate before/after synthetic comparison measured 4K output with 720p AI
at **5.62 → 5.19 ms mean processing**, about 8% lower, still limited to 165
source presentations/s. At 1080p AI the mean was essentially unchanged
(6.905 → 6.898 ms); network execution dominates there. These are short runs,
not a claim of a general 8% FPS improvement.

The real **Elgato 4K X / Switch 2 / Mario Kart** path was also exercised.
The negotiated and delivered video dimensions were 3840×2160 at 60 FPS,
with resizeMode `none`. At the current 2560×1440 monitor's fullscreen size,
900p AI presented about 60 FPS with roughly 5.7 ms processing. In one short
sample the original video's callback gaps averaged 16.66 ms, maximum
24.4 ms, with no gaps above 35 ms. A separate actual-card test confirmed
3840×2160 WGC/output textures with 900p and 1080p AI at about 60 FPS.
This does not establish the Switch game's internal rendering resolution.

The user still observed slight judder compared with Off. Average FPS alone
does not establish even presentation. The native helper now reports p95 and
maximum intervals between Present calls over 120 frames. These measure
submission cadence, not actual display scanout. A waitable DXGI swapchain
bounds the presentation queue to one image, waiting before capturing the
newest WGC frame. This avoids aging an already dequeued capture frame.
It is not a guarantee that all judder is removed.

On the live card at the current 1440p display size, the last 120-frame
window at 900p AI had a 25.5 ms p95 / 25.8 ms maximum submission gap.
720p AI reduced that to 19.2 / 19.4 ms, at roughly 60 FPS. A subsequent
720p run with the old unbounded presentation path was similar (18.7 /
18.9 ms): **these tests support the lower AI setting, not a claim that the
waitable queue itself cures judder**. Scene changes and GPU clocks mean
these short sequential runs are not controlled identical-scene trials.
The next interactive trial uses 720p AI and 60% strength. 900p/1080p remain
available if the user prefers detail over the measured timing margin.

The UI's processing time is measured natively from dequeueing the WGC
frame through submitting its presentation. It excludes the wait for a new
frame, earlier capture-card/Electron/compositor delay, display scanout, and
panel response. The FPS counter counts successful neural presentations;
it does not identify unique console frames. GPU time is measured with
D3D12 timestamps around the neural evaluation. p95 is a short rolling
processing-time sample, not a measurement of input lag.

## Remaining limitations

- The window capture stage adds latency beyond the existing player. A
  future direct capture-texture backend could remove that stage.
- SDR only. HDR preservation and tone mapping are not implemented here.
- This first prototype provides zero motion vectors and resets temporal
  history on each frame. Moving details can flicker or change appearance;
  temporal stability on real games still needs evaluation. No generated
  intermediate frames or future-frame buffering are used.
- The neural preview currently includes the visible player controls and
  settings. Close the settings while comparing gameplay.
- Sharing the original application window may capture the original image;
  the preview is a separate native window. Discord/PiP output has not been
  integrated with neural output.
- No test here establishes a zero-lag or stutter-free result. Test the
  actual console/card path at 4K/60 with rapid pans and input, and compare
  directly against Off. A high-speed camera/latency tester is needed for
  button-to-photon measurements.

## Source, licensing, and reproducibility

The helper is built from MIT-licensed
[NeuralScreen](https://github.com/perseval-BLR/DLSS5-NeuralScreen), pinned to
commit `9f5cf8650b865e46e74587a18c3146990852c348`. The source's complete
license is retained in the build and copied alongside the executable.
`scripts/patch-neural-worker.mjs` records all changes: no Spout dependency,
explicit failure on unsupported NR, distinguish idle replies, bounded
fresh-frame capture, frame-arrival waiting, fast capture interval,
processing telemetry, focus handling, and parent-exit cleanup.

The NVIDIA runtime is separate proprietary software. The pinned community
archive is `neuralscreen-v1.7.0-full.zip`, SHA-256
`301b351383020d98d5c521c288371b43661d741d719cbb9b43bede63331e32de`.
Upstream identifies its runtime as a leaked pre-release build; its licensing
is not covered by the MIT source license. It is installed only for this local
experiment. Review runtime sourcing and redistribution rights before any
public release.

Relevant primary sources:

- [Reference video's description](https://www.youtube.com/watch?v=RMOd04Yqf-8)
- [NeuralScreen implementation](https://github.com/perseval-BLR/DLSS5-NeuralScreen)
- [Microsoft WGC update interval API](https://learn.microsoft.com/en-us/uwp/api/windows.graphics.capture.graphicscapturesession.minupdateinterval)
- [Microsoft WinRT interface definitions](https://github.com/microsoft/windows-rs/blob/master/crates/libs/windows/src/Windows/Graphics/Capture/mod.rs)
- [Microsoft DXGI waitable swapchains](https://learn.microsoft.com/en-us/windows/uwp/gaming/reduce-latency-with-dxgi-1-3-swap-chains)

Checks:

```powershell
npm run build
npx tsc --noEmit
npm run neural:test
node scripts/test-neural.mjs --app
node scripts/test-neural.mjs --pixels
```

The hardware test opens temporary animated windows and closes them again.
Its report is `.local/neural-benchmark.json`. The app test uses a separate
temporary profile and fake camera; it does not change the user's saved
capture devices or settings.

The pixel regression uses static RGB patches and a scene at native and
scaled AI sizes. It verifies correct channel order, exact original pixels
at 0%, approximately half effect at 50%, and bit-identical neural pixels
between old and optimized GPU-copy paths. `CAPTUREPLAYER_FAST_PATH=0` keeps
the reference path available for tests. `CAPTUREPLAYER_WAITABLE_PRESENT=0`
allows presentation comparisons. Hardware tests are opt-in via
`CAPTUREPLAYER_TEST_DEVICE` set to the exact enumerated device label;
`node scripts/test-neural.mjs --card` without it only enumerates video inputs.
