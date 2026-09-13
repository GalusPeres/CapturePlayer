export function rendererModes(platform?: string) {
  const system = platform === 'darwin' ? 'macOS' : platform === 'win32' ? 'Windows' : platform === 'linux' ? 'Linux' : 'system';
  const capture = platform === 'darwin' ? 'AVFoundation and IOSurface' : platform === 'win32' ? 'Media Foundation and shared Direct3D textures' : 'V4L2 and DMA-BUF';
  return [
    { value: 'standard', label: 'Browser playback', description: 'Built-in video player with color adjustments.',
      help: 'The browser handles capture, playback and color filters. It can use hardware acceleration; this is not a CPU-only mode. FSR and the dedicated HDR capture path are unavailable in this mode.' },
    { value: 'webgl', label: 'GPU processing (WebGL)', description: 'GPU color adjustments and FSR upscaling.',
      help: 'The browser captures the video. CapturePlayer processes color, zoom and FSR on the GPU using WebGL and a short frame queue. This capture path is SDR.' },
    { value: 'native', label: `Direct capture (${system})`, description: 'System capture interface · experimental.',
      help: `CapturePlayer accesses the device through ${capture} and passes frames to its GPU presenter. Color, zoom and FSR remain available. HDR requires a compatible signal, capture driver and display. Unsupported SDR devices use compatible browser capture. This experimental mode is not guaranteed to be faster on every device.` },
  ];
}
