# FSR 1 spatial upscaling

Settings → View → Advanced → **FSR 1 upscaler (experimental)** enables
the WebGL VideoFrame renderer. Sharpness controls RCAS (0% skips it).
The DLSS experiment remains the last entry in Advanced.

The pinned, MIT-licensed AMD FSR 1 implementation runs EASU in an intermediate
GPU texture and RCAS together with the existing final color/presentation pass.
Only the current VideoFrame is used: no optical flow, history, future frames,
neural runtime or additional frame queue. The track processor retains at most
one frame and closes it after submitting the draw. GPU processing still costs
time; this is not a claim of zero input-to-photon latency.

The source is never secretly downscaled to enable FSR. Upscaling runs only
when the output image is larger than the captured source. A 4K input on a
1440p screen therefore bypasses it. To try actual enlargement on this setup,
select 1920×1080 / 60 FPS capture and use fullscreen on the 1440p display.
3840×2160 output textures have also been tested. That does not make the
current physical 1440p display a 4K display.

The existing WebGL source-sized fast path is preserved when no enlargement
is needed. An attempted 4K → smaller canvas optimization did **not** improve
GPU time on this driver and was not adopted as the general path. FSR shaders
and intermediate textures are created lazily only for actual enlargement.
Track settings queries are cached for one second instead of being repeated
for every video frame. New canvases are created after settled size changes
while upscaling, avoiding live resizing of a desynchronized surface.
Video-only capture no longer starts an unused AudioContext. Failed audio
initialization also releases its audio resources while video keeps running.

## Local validation, 2026-09-12

RTX 4080, ANGLE/D3D11, Elgato 4K X, actual 60 FPS card frames. Eight seconds
per case, first two seconds discarded; 359 samples per measured interval.
GPU times use asynchronous EXT_disjoint_timer_query_webgl2 around upload
and rendering. Disjoint samples are ignored. CPU submission and delivery
cadence are recorded separately. Tests do not use gl.finish or pixel readback
in the timed loop. Short sequential scenes are not a controlled image-quality
comparison and may have different GPU clocks.

| Mode | Mean GPU work | GPU p95 | Mean CPU submission | Delivery gap p95 |
| --- | ---: | ---: | ---: | ---: |
| Previous 4K source/canvas | 0.35 ms | 0.57 ms | 0.47 ms | 16.9 ms |
| Experimental 4K → 1440p canvas (not adopted generally) | 0.60 ms | 2.15 ms | 0.47 ms | 16.9 ms |
| 1080p → 1440p bilinear | 0.21 ms | 0.19 ms | 0.13 ms | 16.8 ms |
| 1080p → 1440p FSR 1 | 0.61 ms | 1.29 ms | 0.14 ms | 16.8 ms |
| 1080p → 4K FSR 1 | 1.00 ms | 2.54 ms | 0.14 ms | 16.8 ms |

These are whole GPU render-loop timings, not solely the FSR overhead, and
exclude earlier card latency, compositor scheduling and display scanout.
Delivery cadence is measured at the VideoFrame consumer, not on the panel.

Static GPU pixel checks passed for RGB channel order/orientation, a visible
EASU difference from bilinear, the RCAS sharpness control, and identical
pixels after toggling back to the same FSR settings (no stale program state).

The headers include their MIT license; the packaged application includes
`src/vendor/fsr1/LICENSE.txt`. This spatial upscaler does not require the
proprietary runtime used by the separate neural-rendering experiment.

Sources:
- [AMD FSR 1 technique](https://gpuopen.com/manuals/fidelityfx_sdk/techniques/super-resolution-spatial/)
- [Pinned shader source](https://github.com/GPUOpen-Effects/FidelityFX-FSR/tree/a21ffb8f6c13233ba336352bdff293894c706575/ffx-fsr)

Checks:
```powershell
npm run build
npx tsc --noEmit
node scripts/test-upscaler.mjs --app
node scripts/test-upscaler.mjs --card
```

`--app` uses a fake camera and a separate profile, checking active frame
delivery after FSR toggles, window resizing and fullscreen, plus the
sharpness control. `--card` explicitly opens the connected Elgato 4K X and
writes `.local/upscaler-benchmark.json`; close other players for a clean
measurement. The baseline is extracted from commit
`cfc3d31ab6ec7524730f57cb31e3f000005531f4` before bundling, so later commits
do not change the reference renderer. That commit must be available locally.
