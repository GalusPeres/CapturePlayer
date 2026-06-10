// src/types/mediastream-track-processor.d.ts
// Minimal typing for MediaStreamTrackProcessor (mediacapture-transform, Chromium-only).
// Not part of lib.dom yet - remove once TypeScript ships it.

declare class MediaStreamTrackProcessor<T = VideoFrame> {
  constructor(init: { track: MediaStreamTrack; maxBufferSize?: number });

  readonly readable: ReadableStream<T>;
}
