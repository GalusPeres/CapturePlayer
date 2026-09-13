// At matching source/output sizes, reconstruct the next resolution tier and
// resolve it back to the output. This is spatial supersampling, not DLAA.
export function getFsrSize(sourceWidth: number, sourceHeight: number, outputWidth: number, outputHeight: number) {
  const width = Math.max(1, Math.min(4096, Math.round(outputWidth)));
  const height = Math.max(1, Math.min(2160, Math.round(outputHeight)));
  if (Math.abs(width - sourceWidth) <= 1 && Math.abs(height - sourceHeight) <= 1) {
    const tier = [720, 1080, 1440, 2160].find(h => h > sourceHeight);
    const scale = tier ? Math.min(tier / sourceHeight, 1.5, 4096 / sourceWidth) : 1;
    if (scale > 1) return { width: Math.round(sourceWidth * scale), height: Math.round(sourceHeight * scale),
      resolveWidth: width, resolveHeight: height, supersampling: true };
  }
  return { width, height, resolveWidth: width, resolveHeight: height, supersampling: false };
}
