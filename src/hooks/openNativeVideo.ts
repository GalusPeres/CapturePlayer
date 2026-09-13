import { createNativeVideoStream, markCompatibilityStream } from './nativeVideoStream';

// Capture transport and GPU presentation are independent. Legacy/virtual
// drivers can use Chromium's capture support while retaining NativeVideo,
// its color controls, zoom and FSR. Never label this SDR path as HDR.
export async function openNativeVideo(device: MediaDeviceInfo, constraints: MediaTrackConstraints,
  options: { width: number; height: number; fps: number; hdr: boolean }) {
  const label = device.label.replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)$/i, '');
  const virtualObs = /obs.*virtual|obs-camera/i.test(label);
  let nativeError: unknown;
  if (!virtualObs) {
    const native = createNativeVideoStream();
    try {
      if (!window.electronAPI.startNativeCapture) throw new Error('Native capture API is unavailable.');
      await window.electronAPI.startNativeCapture({ device: label, ...options });
      return native;
    } catch (error) {
      native.stop();
      await window.electronAPI.stopNativeCapture?.();
      if (options.hdr) throw error;
      nativeError = error;
    }
  }
  try {
    const stream = markCompatibilityStream(await navigator.mediaDevices.getUserMedia({ video: constraints, audio: false }));
    console.info('Native GPU renderer: compatibility capture (SDR)', label, nativeError ?? 'Virtual camera');
    return { stream, stop: () => stream.getTracks().forEach(track => track.stop()) };
  } catch (error) {
    throw new Error(`Cannot open ${label}. ${String(error)}${nativeError ? ` Native capture: ${String(nativeError)}.` : ''} Check the selected mode and whether another application is holding the device.`);
  }
}
