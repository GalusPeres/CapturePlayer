import React, { memo, useEffect, useMemo } from 'react';
import DiagnosticsOverlay, { type DiagnosticsSample } from './DiagnosticsOverlay';
import type { FrameStats } from './LowLatencyVideo';
import { subscribeFrameDelivery } from './frameDeliveryDiagnostics';

export default memo(function NativeDiagnosticsOverlay({ hdr, compatibility = false }: { hdr: boolean; compatibility?: boolean }) {
  const measurement = useMemo(() => {
    let start = performance.now(), last = 0, count = 0, total = 0, maxGap = 0, interval = 0, gaps = 0;
    let minimum = Infinity, previousMinimum = Infinity, baselineStart = performance.now(), delay: number | undefined;
    return {
      onFrame(timestamp: number) {
        const now = performance.now();
        if (last) { interval = now - last; maxGap = Math.max(maxGap, interval); if (interval > 50) ++gaps; }
        last = now; ++count; ++total;
        if (Number.isFinite(timestamp)) {
          if (now - baselineStart >= 5000) { previousMinimum = minimum; minimum = Infinity; baselineStart = now; }
          const offset = now - timestamp / 1000;
          minimum = Math.min(minimum, offset);
          // Different clock origins: only an increase over recent best delivery.
          delay = Math.max(0, offset - Math.min(minimum, previousMinimum));
        }
      },
      async readSample(): Promise<DiagnosticsSample> {
        const now = performance.now();
        const canvas = document.querySelector<HTMLCanvasElement>('[data-native-renderer]');
        const stats: FrameStats = {
          width: Number(canvas?.dataset.sourceWidth) || 0, height: Number(canvas?.dataset.sourceHeight) || 0,
          displayFps: count * 1000 / Math.max(1, now - start), lastFrameMs: interval, maxFrameMs: maxGap,
          idleMs: last ? now - last : now - start, stallCount: gaps, presentedFrames: total,
          stalled: (last ? now - last : now - start) > 50,
          captureDelayMs: delay, captureDelayKind: 'queue',
        };
        start = now; count = 0; maxGap = 0; gaps = 0;
        const capture = compatibility ? undefined : await window.electronAPI.getNativeCaptureStatus?.().catch(() => undefined);
        stats.trackFps = capture?.fps;
        return { stats, dropped: capture?.dropped, transport: compatibility ? 'Browser compatibility' : 'Shared GPU texture' };
      },
    };
  }, [compatibility]);
  useEffect(() => subscribeFrameDelivery(measurement.onFrame), [measurement]);
  return <DiagnosticsOverlay mode="native" hdr={hdr} readSample={measurement.readSample} />;
});
