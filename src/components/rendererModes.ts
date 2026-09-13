export function rendererModes(platform?: string) {
  const system = platform === 'darwin' ? 'macOS' : platform === 'win32' ? 'Windows' : platform === 'linux' ? 'Linux' : 'system';
  return [
    { value: 'standard', label: 'Browser playback',
      help: 'Built-in video playback with color controls.' },
    { value: 'webgl', label: 'GPU processing (WebGL)',
      help: 'GPU color controls and FSR upscaling in SDR.' },
    { value: 'native', label: `Direct capture (${system})`,
      help: 'Direct device capture with GPU processing and FSR. HDR with compatible hardware.' },
  ];
}
