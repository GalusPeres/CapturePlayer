AMD FidelityFX FSR 1 headers, unmodified, from:
https://github.com/GPUOpen-Effects/FidelityFX-FSR/tree/a21ffb8f6c13233ba336352bdff293894c706575/ffx-fsr

MIT license: LICENSE.txt (included in packaged applications).

The adapter in src/components/fsrUpscaler.ts targets GLSL ES 3.00:
- Explicit unsigned constant assignments and equivalent bitfield operations.
- Clamped texelFetch calls emulate textureGather, unavailable in WebGL2.
- EASU writes a current-frame GPU texture; RCAS is fused into the final
  color/presentation shader. No previous or future video frames are used.
- Upscaling is bypassed when the source covers the output.
