# Experimental native capture

Build on Windows with Visual Studio C++ Build Tools using `npm run native:build`.
The development app finds `.local/native-capture/CapturePlayerCapture.exe`.
Normal Windows release packaging now includes this helper and its C++ runtime.
For the new macOS/Linux native backends, build steps, and current verification
limits, see [native platforms](../docs/NATIVE-PLATFORMS.md).

Input uses Media Foundation's native P010 mode. For HDR10 select PQ / BT.2020
limited range, matching OBS's P010 / Rec. 2100 (PQ) / Limited configuration.
Disable capture-card HDR-to-SDR tone mapping when capturing this HDR input.
P010 alone does not identify HDR: HDR input selection is manual because the
tested Elgato driver reports unreliable transfer-function metadata.

The D3D11 shader expands limited-range 10-bit YUV, decodes PQ, converts linear
BT.2020 to BT.709 primaries and writes shared FP16 textures. Linear light is
relative to 203 nits. Electron imports this as linear RGB. WebGPU external
texture sampling converts it to extended sRGB. The `rgba16float` canvas is
also configured as sRGB and must receive those **encoded** values directly.
Half-float storage does not imply a linear canvas transfer function. Decoding
sRGB again caused crushed shadows, excessive contrast and clipped highlights.
Negative gamut values and values above SDR white must remain unclamped.

Run `npm run native:test` after building the helper. This opens a hidden test
window and uses synthetic P010 input without opening the capture card. Eight
patches exercise limited-range conversion, PQ, primaries, shared texture import
and the production HDR canvas shader. GPU readback checks 10/80/203/1000/4000-nit
grays and BT.2020 RGB primaries. This checks numerical encoding, not physical
screen luminance or end-to-end latency. Windows HDR, its SDR white level, and
the display's capabilities still affect actual presentation.

The tested Elgato 4K X P010 modes support 1440p60 and 4K30; this implementation
does not provide 4K60 HDR. FSR supports the HDR presenter; optional Windows Neural
processing preserves the HDR base around an SDR inference pass.
Brightness, contrast, saturation, hue and sharpness run in the existing HDR
GPU pass, retaining extended-range color values. The hidden test also checks
live adjustment of brightness, contrast and saturation without clipping HDR.
Zoom and normal player controls remain in the existing
Electron window. Capture includes a CPU-to-GPU upload; only the subsequent
shared-texture transport avoids JavaScript pixel copies. Three reusable slots
bound transport buffering. FPS/drop telemetry is not an input-latency measure.

Capture is drained on a separate thread into one replaceable latest-sample slot;
GPU stalls cannot accumulate a queue of outdated samples. GPU completion uses
a D3D11 fence event where supported, with a non-flushing query fallback. An
attempt at dynamic P010 upload falls back to UpdateSubresource if unsupported.
Timing telemetry separates capture, upload, GPU completion and sample age.
The sample-age counter assumes QPC-based capture timestamps (as observed with
the tested Elgato); it excludes console/controller latency and screen scanout.
