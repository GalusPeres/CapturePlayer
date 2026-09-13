import React, { useEffect, useState } from 'react';

type Stats = {
  fps: number; maxGapMs: number; idleMs: number;
  captureFps?: number; dropped?: number; message: string;
};

// Mounted only while diagnostics are visible. Counts delivery events without
// retaining VideoFrames or reading GPU pixels back to the CPU.
export default function NativeDiagnosticsOverlay({ hdr }: { hdr: boolean }) {
  const [stats, setStats] = useState<Stats | null>(null);
  useEffect(() => {
    let live = true, pending = false;
    let start = performance.now(), last = 0, count = 0, maxGap = 0;
    const onFrame = (event: MessageEvent) => {
      if (event.source !== window || event.data?.type !== 'captureplayer:native-frame') return;
      const now = performance.now();
      if (last) maxGap = Math.max(maxGap, now - last);
      last = now; ++count;
    };
    const publish = async () => {
      if (pending) return;
      pending = true;
      const now = performance.now();
      const next = {
        fps: count * 1000 / Math.max(1, now - start),
        maxGapMs: maxGap, idleMs: last ? now - last : now - start
      };
      start = now; count = 0; maxGap = 0;
      try {
        const capture = await window.electronAPI.getNativeCaptureStatus?.();
        if (live) setStats({ ...next, captureFps: capture?.fps, dropped: capture?.dropped,
          message: capture?.phase ?? 'unavailable' });
      } catch {
        if (live) setStats({ ...next, message: 'Capture status unavailable' });
      } finally { pending = false; }
    };
    window.addEventListener('message', onFrame);
    const timer = window.setInterval(() => void publish(), 1000);
    return () => { live = false; clearInterval(timer); window.removeEventListener('message', onFrame); };
  }, []);

  return <div data-native-diagnostics className="absolute top-4 left-4 z-40 px-3 py-2 rounded-md bg-black/70 border border-white/10 text-white/90 text-xs font-mono leading-relaxed pointer-events-none">
    <div>renderer: native · {hdr ? 'HDR' : 'SDR'}</div>
    {stats ? <>
      <div>capture: {stats.captureFps?.toFixed(1) ?? '—'} fps</div>
      <div>delivery: {stats.fps.toFixed(1)} fps</div>
      <div>max delivery gap: {stats.maxGapMs.toFixed(1)} ms</div>
      <div>idle: {stats.idleMs.toFixed(1)} ms</div>
      <div>dropped: {stats.dropped ?? '—'}</div>
      <div>state: {stats.message}</div>
    </> : <div>Waiting for measurements…</div>}
    <div>Software timing · excludes controller/display latency</div>
  </div>;
}
