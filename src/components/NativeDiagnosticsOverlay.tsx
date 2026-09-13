import React, { useEffect, useState } from 'react';
import DiagnosticsOverlay from './DiagnosticsOverlay';
import type { FrameStats } from './LowLatencyVideo';

// Mounted only while diagnostics are visible. Counts delivery events without
// retaining VideoFrames or reading GPU pixels back to the CPU.
export default function NativeDiagnosticsOverlay({ hdr, compatibility = false }: { hdr: boolean; compatibility?: boolean }) {
  const [stats, setStats] = useState<FrameStats | null>(null);
  const [dropped, setDropped] = useState<number>();
  useEffect(() => {
    let live = true, pending = false;
    let start = performance.now(), last = 0, count = 0, maxGap = 0, interval = 0, gaps = 0;
    let minimum = Infinity, previousMinimum = Infinity, baselineStart = performance.now(), delay: number | undefined;
    const onFrame = (event: Event) => {
      const now = performance.now();
      if (last) { interval = now - last; maxGap = Math.max(maxGap, interval); if (interval > 50) ++gaps; }
      last = now; ++count;
      const timestamp = (event as CustomEvent<{ timestamp?: number }>).detail?.timestamp;
      if (typeof timestamp === 'number' && Number.isFinite(timestamp)) {
        if (now - baselineStart >= 5000) { previousMinimum = minimum; minimum = Infinity; baselineStart = now; }
        const offset = now - timestamp / 1000;
        minimum = Math.min(minimum, offset);
        // Capture timestamps need not share the page's clock. This measures
        // extra queuing against recent best delivery, never physical latency.
        delay = Math.max(0, offset - Math.min(minimum, previousMinimum));
      }
    };
    const publish = async () => {
      if (pending) return;
      pending = true;
      const now = performance.now();
      const canvas = document.querySelector<HTMLCanvasElement>('[data-native-renderer]');
      const next: FrameStats = {
        width: Number(canvas?.dataset.sourceWidth) || 0, height: Number(canvas?.dataset.sourceHeight) || 0,
        displayFps: count * 1000 / Math.max(1, now - start), lastFrameMs: interval, maxFrameMs: maxGap,
        idleMs: last ? now - last : now - start, stallCount: gaps, presentedFrames: Number(canvas?.dataset.nativeFrames) || 0,
        stalled: (last ? now - last : now - start) > 50,
        captureDelayMs: delay, captureDelayKind: 'queue',
      };
      start = now; count = 0; maxGap = 0; gaps = 0;
      try {
        const capture = compatibility ? undefined : await window.electronAPI.getNativeCaptureStatus?.();
        if (live) { setStats({ ...next, trackFps: capture?.fps }); setDropped(capture?.dropped); }
      } catch {
        if (live) setStats(next);
      } finally { pending = false; }
    };
    window.addEventListener('captureplayer:frame-delivered', onFrame);
    const timer = window.setInterval(() => void publish(), 1000);
    return () => { live = false; clearInterval(timer); window.removeEventListener('captureplayer:frame-delivered', onFrame); };
  }, [compatibility]);

  return <DiagnosticsOverlay mode="native" hdr={hdr} stats={stats} dropped={dropped}
    transport={compatibility ? 'Browser compatibility' : 'Shared GPU texture'} />;
}
