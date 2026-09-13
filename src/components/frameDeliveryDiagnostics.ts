import type { FrameStats } from './LowLatencyVideo';

// Preserve every sub-window when the UI samples more slowly than the renderer.
// A hitch in the first half of a sample must not disappear in a smooth second half.
export function mergeFrameStats(previous: FrameStats | null, next: FrameStats | null): FrameStats | null {
  if (!previous || !next || previous.width !== next.width || previous.height !== next.height) return next;
  const before = previous.sampleDurationMs ?? 0, after = next.sampleDurationMs ?? 0;
  return { ...next, sampleDurationMs: before + after,
    displayFps: before + after > 0 ? (previous.displayFps * before + next.displayFps * after) / (before + after) : next.displayFps,
    maxFrameMs: Math.max(previous.maxFrameMs, next.maxFrameMs),
    stallCount: previous.stallCount + next.stallCount,
    maxCaptureDelayMs: previous.maxCaptureDelayMs === undefined ? next.maxCaptureDelayMs : next.maxCaptureDelayMs === undefined
      ? previous.maxCaptureDelayMs : Math.max(previous.maxCaptureDelayMs, next.maxCaptureDelayMs),
  };
}

// No DOM events, allocations or GPU readbacks in the frame loop. With the
// overlay closed the set is empty, so diagnostics do no per-frame measuring.
const listeners = new Set<(timestamp: number) => void>();
export function reportFrameDelivery(timestamp: number) {
  for (const listener of listeners) listener(timestamp);
}
export function subscribeFrameDelivery(listener: (timestamp: number) => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
