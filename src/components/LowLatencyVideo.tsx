// src/components/LowLatencyVideo.tsx - OBS-style low-latency preview path.
// Pulls VideoFrames straight off the capture track via MediaStreamTrackProcessor
// (maxBufferSize 1 = stale frames are dropped, never queued) and presents each
// one immediately on a desynchronized WebGL canvas instead of a <video> element.
import React, { useEffect, useRef } from 'react';
import { createGlVideoPipeline } from './glVideoPipeline';
import type { GlFilterState, GlVideoPipeline } from './glVideoPipeline';

export type FrameStats = {
  width: number;
  height: number;
  trackFps?: number;
  displayFps: number;
  lastFrameMs: number;
  maxFrameMs: number;
  idleMs: number;
  stallCount: number;
  presentedFrames: number;
  stalled: boolean;
  captureDelayMs?: number;
  maxCaptureDelayMs?: number;
  // 'absolute' = measured against a capture timestamp on the shared clock;
  // 'queue' = pipeline delay relative to the fastest recently observed frame
  // (the frame timestamps on this path use an unknown epoch).
  captureDelayKind?: 'absolute' | 'queue';
  // Whether the canvas got the desynchronized (direct-present) path.
  desynchronized?: boolean;
};

export function isLowLatencySupported(): boolean {
  return typeof MediaStreamTrackProcessor !== 'undefined';
}

type VideoFrameWithMetadata = VideoFrame & {
  metadata?: () => { captureTime?: number } | undefined;
};

type Props = {
  stream: MediaStream;
  zoomLevel: number;
  filters: GlFilterState;
  diagnosticsEnabled: boolean;
  onResolution?: (res: { w: number; h: number; fps?: number } | null) => void;
  onDebugInfo?: (info: FrameStats | null) => void;
  onFallback: (reason: string) => void;
};

const LowLatencyVideo: React.FC<Props> = ({
  stream,
  zoomLevel,
  filters,
  diagnosticsEnabled,
  onResolution,
  onDebugInfo,
  onFallback
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Mutable inputs live in refs so settings/zoom changes do not restart the frame loop.
  const filtersRef = useRef(filters);
  filtersRef.current = filters;
  const zoomRef = useRef(zoomLevel);
  zoomRef.current = zoomLevel;
  const onResolutionRef = useRef(onResolution);
  onResolutionRef.current = onResolution;
  const onDebugInfoRef = useRef(onDebugInfo);
  onDebugInfoRef.current = onDebugInfo;
  const diagnosticsEnabledRef = useRef(diagnosticsEnabled);
  diagnosticsEnabledRef.current = diagnosticsEnabled;
  const onFallbackRef = useRef(onFallback);
  onFallbackRef.current = onFallback;

  useEffect(() => {
    const canvas = canvasRef.current;
    const track = stream.getVideoTracks()[0];
    if (!canvas || !track) return undefined;

    let disposed = false;
    const fail = (reason: string) => {
      if (!disposed) onFallbackRef.current(reason);
    };

    let reader: ReadableStreamDefaultReader<VideoFrame>;
    try {
      const processor = new MediaStreamTrackProcessor({ track, maxBufferSize: 1 });
      reader = processor.readable.getReader();
    } catch (error) {
      console.warn('MediaStreamTrackProcessor init failed:', error);
      fail('track-processor-init');
      return undefined;
    }

    // The pipeline is created lazily on the first frame: the canvas backing
    // store is fixed to the source resolution and CSS (object-contain) does
    // the scaling to the window. Resizing a desynchronized canvas after
    // context creation left the presented surface stuck at its initial size
    // (frame glued to the top-left corner on startup).
    let pipeline: GlVideoPipeline | null = null;

    const onContextLost = (event: Event) => {
      event.preventDefault();
      fail('webgl-context-lost');
    };
    canvas.addEventListener('webglcontextlost', onContextLost);

    // Frame statistics shared between the read loop and the publish interval.
    let lastFrameNow = 0;
    let lastFrameMs = 0;
    let maxFrameMs = 0;
    let stallCount = 0;
    let presentedFrames = 0;
    let frameCount = 0;
    let windowStart = performance.now();
    let captureDelayMs: number | undefined;
    let maxCaptureDelayMs = 0;
    let captureDelayKind: 'absolute' | 'queue' | undefined;
    // Rotating two-bucket minimum of (now - frame timestamp) so the queue-delay
    // baseline adapts to clock drift instead of being pinned to session start.
    let minOffsetCurrent = Infinity;
    let minOffsetPrevious = Infinity;
    let minOffsetWindowStart = performance.now();
    let width = 0;
    let height = 0;
    let measuredFps: number | undefined;
    let fpsWindowStart = performance.now();
    let fpsFrameCount = 0;
    let lastSignature: string | null = null;

    const trackFps = () => {
      const frameRate = track.getSettings?.().frameRate;
      return frameRate ? Math.round(frameRate) : undefined;
    };

    const expectedFrameMs = () => 1000 / (measuredFps || trackFps() || 60);

    const reportResolution = () => {
      const next = width && height ? { w: width, h: height, fps: trackFps() ?? measuredFps } : null;
      const signature = next ? `${next.w}x${next.h}@${next.fps ?? 0}` : 'null';
      if (signature !== lastSignature) {
        lastSignature = signature;
        onResolutionRef.current?.(next);
      }
    };

    const publishStats = () => {
      if (disposed || !pipeline) return;

      const elapsed = performance.now() - windowStart;
      const displayFps = elapsed > 0 ? (frameCount / elapsed) * 1000 : 0;
      const idleMs = lastFrameNow ? performance.now() - lastFrameNow : 0;
      const stalled = idleMs > Math.max(50, expectedFrameMs() * 2.5);

      const stats: FrameStats = {
        width,
        height,
        trackFps: trackFps(),
        displayFps,
        lastFrameMs,
        maxFrameMs,
        idleMs,
        stallCount,
        presentedFrames,
        stalled,
        captureDelayMs,
        maxCaptureDelayMs: maxCaptureDelayMs || undefined,
        captureDelayKind,
        desynchronized: pipeline.desynchronized
      };

      onDebugInfoRef.current?.(stats);
      pipeline.setDiagnostics(
        diagnosticsEnabledRef.current
          ? [
              `${stats.width}x${stats.height}${stats.trackFps ? ` @${stats.trackFps} src` : ''}`,
              'renderer: webgl low-latency',
              `present: ${stats.desynchronized ? 'direct (desync)' : 'compositor'}`,
              `display: ${stats.displayFps.toFixed(1)} fps`,
              `frame: ${stats.lastFrameMs.toFixed(1)} ms`,
              `max gap: ${stats.maxFrameMs.toFixed(1)} ms`,
              ...(typeof stats.captureDelayMs === 'number'
                ? [`${stats.captureDelayKind === 'queue' ? 'queue' : 'delay'}: ${stats.captureDelayMs.toFixed(1)} ms`]
                : []),
              ...(typeof stats.maxCaptureDelayMs === 'number'
                ? [
                    `max ${stats.captureDelayKind === 'queue' ? 'queue' : 'delay'}: ${stats.maxCaptureDelayMs.toFixed(
                      1
                    )} ms`
                  ]
                : []),
              `idle: ${stats.idleMs.toFixed(1)} ms`,
              `stalls: ${stats.stallCount}`,
              `state: ${stats.stalled ? 'stalled' : 'ok'}`
            ]
          : null
      );

      windowStart = performance.now();
      frameCount = 0;
      maxFrameMs = 0;
      stallCount = 0;
      maxCaptureDelayMs = 0;
    };
    const statsIntervalId = window.setInterval(publishStats, 1000);

    const readLoop = async () => {
      try {
        for (;;) {
          const { value: frame, done } = await reader.read();
          if (done || disposed) {
            frame?.close();
            break;
          }

          const now = performance.now();
          if (lastFrameNow !== 0) {
            lastFrameMs = now - lastFrameNow;
            maxFrameMs = Math.max(maxFrameMs, lastFrameMs);
            if (lastFrameMs > Math.max(50, expectedFrameMs() * 2.5)) {
              stallCount += 1;
            }
          }
          lastFrameNow = now;
          frameCount += 1;
          presentedFrames += 1;
          fpsFrameCount += 1;

          const fpsElapsed = now - fpsWindowStart;
          if (fpsElapsed >= 1500) {
            measuredFps = Math.round((fpsFrameCount / fpsElapsed) * 1000);
            fpsWindowStart = now;
            fpsFrameCount = 0;
          }

          width = frame.displayWidth;
          height = frame.displayHeight;

          if (!pipeline) {
            canvas.width = width;
            canvas.height = height;
            try {
              pipeline = createGlVideoPipeline(canvas);
              console.log(`🎞️ Low-latency renderer active, desynchronized canvas: ${pipeline.desynchronized}`);
            } catch (error) {
              console.warn('Low-latency WebGL pipeline init failed:', error);
              frame.close();
              fail('webgl-init');
              break;
            }
          } else if (canvas.width !== width || canvas.height !== height) {
            // Source format changed (rare) - resize to the new native resolution.
            canvas.width = width;
            canvas.height = height;
          }

          const metadata = (frame as VideoFrameWithMetadata).metadata?.();
          const timestampMs = Number.isFinite(frame.timestamp) ? frame.timestamp / 1000 : undefined;

          if (metadata && typeof metadata.captureTime === 'number') {
            // Best case: a real capture timestamp on the performance.now() clock.
            captureDelayMs = now - metadata.captureTime;
            captureDelayKind = 'absolute';
          } else if (timestampMs !== undefined) {
            const offset = now - timestampMs;
            if (Math.abs(offset) < 10000) {
              // Timestamp shares the page clock - treat as a real capture time.
              captureDelayMs = offset;
              captureDelayKind = 'absolute';
            } else {
              // Unknown epoch: report queueing delay relative to the fastest
              // delivery observed in the last ~10s instead.
              if (now - minOffsetWindowStart >= 5000) {
                minOffsetPrevious = minOffsetCurrent;
                minOffsetCurrent = Infinity;
                minOffsetWindowStart = now;
              }
              minOffsetCurrent = Math.min(minOffsetCurrent, offset);
              captureDelayMs = offset - Math.min(minOffsetCurrent, minOffsetPrevious);
              captureDelayKind = 'queue';
            }
          } else {
            captureDelayMs = undefined;
            captureDelayKind = undefined;
          }
          if (captureDelayMs !== undefined) {
            maxCaptureDelayMs = Math.max(maxCaptureDelayMs, captureDelayMs);
          }

          try {
            pipeline.render(frame, filtersRef.current, zoomRef.current / 100);
          } finally {
            frame.close();
          }
          reportResolution();
        }
      } catch (error) {
        if (!disposed) {
          console.warn('Low-latency frame loop failed:', error);
          fail('frame-loop');
        }
      }
    };
    void readLoop();

    return () => {
      disposed = true;
      window.clearInterval(statsIntervalId);
      canvas.removeEventListener('webglcontextlost', onContextLost);
      reader.cancel().catch(() => undefined);
      pipeline?.dispose();
      onResolutionRef.current?.(null);
      onDebugInfoRef.current?.(null);
    };
  }, [stream]);

  return <canvas ref={canvasRef} className="block w-full h-full object-contain" />;
};

export default LowLatencyVideo;
