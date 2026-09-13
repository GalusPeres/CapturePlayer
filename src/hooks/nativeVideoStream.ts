type Receiver = (frame: VideoFrame) => void;
let receiver: Receiver | undefined;
// Installed before capture starts; frames without a presenter are closed.
window.addEventListener('message', event => {
  if (event.source !== window) return;
  if (event.data?.type !== 'captureplayer:native-frame') return;
  const frame = event.data.frame;
  if (!(frame instanceof VideoFrame)) return;
  try { receiver?.(frame); } finally { frame.close(); }
});
export function subscribeNativeFrames(next: Receiver) {
  receiver = next;
  return () => { if (receiver === next) receiver = undefined; };
}
export function createNativeVideoStream() {
  const Generator = (window as any).MediaStreamTrackGenerator;
  if (!Generator) throw new Error('Native video track marker is unavailable.');
  // Only marks an active video source for existing controls. Actual frames go
  // directly to the presenter, bypassing WebRTC video format conversion.
  const track = new Generator({ kind: 'video' });
  return { stream: new MediaStream([track]), stop: () => track.stop() };
}
