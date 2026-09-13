import React, { memo, useEffect, useState } from 'react';
import type { FrameStats } from './LowLatencyVideo';
import type { NeuralStatus } from '../types/neural';
import { rendererModes } from './rendererModes';
import { audioDiagnostics } from '../hooks/audioPlayback';

export type DiagnosticsSample = { stats: FrameStats | null; transport?: string; dropped?: number; state?: string };
type Snapshot = DiagnosticsSample & {
  neural?: NeuralStatus; audio: ReturnType<typeof audioDiagnostics>;
  format: string; output: string; fsr: string;
};

export default memo(function DiagnosticsOverlay({ mode, hdr = false, readSample }: {
  mode: 'standard' | 'webgl' | 'native'; hdr?: boolean;
  readSample: () => DiagnosticsSample | Promise<DiagnosticsSample>;
}) {
  const [snapshot, setSnapshot] = useState<Snapshot>(() => ({ stats: null, audio: audioDiagnostics(), format: '—', output: '—', fsr: '—' }));
  useEffect(() => {
    let live = true;
    let timer: number;
    const update = async () => {
      // One batched paint per sample; no independent frame/audio/neural timers.
      // The next poll starts after completion, so IPC calls cannot pile up.
      const [sample, neural] = await Promise.all([
        Promise.resolve().then(readSample).catch(() => ({ stats: null } as DiagnosticsSample)),
        Promise.resolve().then(() => window.electronAPI?.getNeuralStatus?.()).catch(() => undefined),
      ]);
      if (!live) return;
      const canvas = document.querySelector<HTMLCanvasElement>(mode === 'native' ? '[data-native-renderer]' : '[data-low-latency-renderer]');
      setSnapshot({ ...sample, neural, audio: audioDiagnostics(),
        format: canvas?.dataset.frameFormat || (mode === 'standard' ? 'Browser managed' : '—'),
        output: canvas ? `${canvas.width} × ${canvas.height}` : 'Browser managed',
        fsr: canvas?.dataset.upscaler === 'supersampling' ? `${canvas.dataset.fsrInternalSize} · supersampling`
          : canvas?.dataset.upscaler === 'fsr1' ? `${canvas.dataset.fsrInternalSize} · upscaling` : 'Off / bypassed' });
      timer = window.setTimeout(update, 2000);
    };
    void update();
    return () => { live = false; clearTimeout(timer); };
  }, [mode, readSample]);
  const { stats, audio, neural } = snapshot;
  const active = neural?.phase === 'active';
  const number = (value: number | undefined, unit = '') =>
    typeof value === 'number' && Number.isFinite(value) ? `${value.toFixed(1)}${unit}` : '—';
  const rows = [
    ['Video mode', rendererModes(window.electronAPI?.platform).find(item => item.value === mode)!.label],
    ['Capture path', snapshot.transport ?? 'Browser capture'],
    ['Signal', stats?.width ? `${stats.width} × ${stats.height} · ${hdr ? 'HDR' : 'SDR'}` : 'Waiting'],
    ['Pixel format', snapshot.format],
    ['Render target', snapshot.output],
    ['FSR processing', snapshot.fsr],
    ['Source rate', number(stats?.trackFps, ' FPS')],
    ['Preview delivery', number(stats?.displayFps, ' FPS')],
    ['Last / longest interval', `${number(stats?.lastFrameMs)} / ${number(stats?.maxFrameMs, ' ms')}`],
    ['Relative queue increase', stats?.captureDelayKind === 'queue' ? number(stats.captureDelayMs, ' ms') : '—'],
    ['Capture timestamp age', stats?.captureDelayKind === 'absolute' ? number(stats.captureDelayMs, ' ms') : '—'],
    ['Gaps > 50 ms', stats ? String(stats.stallCount) : '—'],
    ['Dropped frames', snapshot.dropped === undefined ? 'Not reported' : String(snapshot.dropped)],
    ['Video state', snapshot.state ?? (stats ? stats.stalled ? 'Waiting for frames' : 'Active' : 'Measuring')],
    ['DLSS 5 Neural', neural ? active ? neural.strength === 0 ? 'Bypassed · strength 0%' : 'Active' : neural.phase === 'starting' ? 'Starting / waiting' : neural.phase === 'error' ? 'Error' : neural.enabled ? 'Enabled · waiting for capture' : 'Off' : 'Unavailable'],
    ['Neural resolution', active ? neural.quality ?? '—' : '—'],
    ['Neural output', active ? `${neural.outputWidth ?? '—'} × ${neural.outputHeight ?? '—'} · ${neural.hdrOutput ? 'HDR' : 'SDR'}` : '—'],
    ['Neural output rate', number(active ? neural.fps : undefined, ' FPS')],
    ['Neural stage avg / p95', active ? `${number(neural.processingMs)} / ${number(neural.p95Ms, ' ms')}` : '—'],
    ['Neural GPU evaluation', number(active && neural.strength !== 0 ? neural.gpuMs : undefined, ' ms')],
    ['Neural present p95 / max', active ? `${number(neural.presentGapP95Ms)} / ${number(neural.presentGapMaxMs, ' ms')}` : '—'],
    ['Neural gaps > 25 ms', active && neural.presentGapsOver25Ms !== undefined ? String(neural.presentGapsOver25Ms) : '—'],
    ['GPU utilization', 'Not measured'],
    ['Controller-to-screen lag', 'Not measured'],
    ['Audio', audio.state],
    ['Audio output buffer', number(audio.latencyMs, ' ms')],
    ['Audio recoveries', String(audio.recoveries)],
  ];
  return <div data-diagnostics-overlay data-mode={mode}
    style={{ contain: 'layout paint style', width: '34rem', fontVariantNumeric: 'tabular-nums' }}
    className="absolute top-4 left-4 z-40 px-3 py-2 rounded-md bg-black/80 border border-white/10 text-white/90 text-xs font-mono leading-relaxed pointer-events-none max-w-[calc(100%-2rem)]">
    <dl className="grid grid-cols-[auto_1fr] gap-x-4">
      {rows.map(([label, value]) => <React.Fragment key={label}>
        <dt className="text-white/60">{label}</dt><dd className="m-0 text-right">{value}</dd>
      </React.Fragment>)}
    </dl>
    <div className="mt-1 text-white/50">Updates every 2 s · Neural stage includes present wait.<br />Stage timing is not added controller-to-screen lag.</div>
  </div>;
});
