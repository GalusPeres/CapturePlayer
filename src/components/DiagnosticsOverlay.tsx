import React, { useEffect, useState } from 'react';
import type { FrameStats } from './LowLatencyVideo';
import { rendererModes } from './rendererModes';
import { audioDiagnostics } from '../hooks/audioPlayback';

export default function DiagnosticsOverlay({ mode, hdr = false, stats, transport, dropped, state }: {
  mode: 'standard' | 'webgl' | 'native'; hdr?: boolean; stats: FrameStats | null;
  transport?: string; dropped?: number; state?: string;
}) {
  const [audio, setAudio] = useState(audioDiagnostics);
  const [pipeline, setPipeline] = useState({ format: '—', output: '—', fsr: 'Off' });
  useEffect(() => {
    const update = () => {
      setAudio(audioDiagnostics());
      const canvas = document.querySelector<HTMLCanvasElement>(mode === 'native' ? '[data-native-renderer]' : '[data-low-latency-renderer]');
      setPipeline({ format: canvas?.dataset.frameFormat || (mode === 'standard' ? 'Browser managed' : '—'),
        output: canvas ? `${canvas.width} × ${canvas.height}` : 'Browser managed',
        fsr: canvas?.dataset.upscaler === 'supersampling' ? `${canvas.dataset.fsrInternalSize} · supersampling`
          : canvas?.dataset.upscaler === 'fsr1' ? `${canvas.dataset.fsrInternalSize} · upscaling` : 'Off / bypassed' });
    };
    update();
    const timer = window.setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [mode]);
  const number = (value: number | undefined, unit = '') =>
    typeof value === 'number' && Number.isFinite(value) ? `${value.toFixed(1)}${unit}` : '—';
  const rows = [
    ['Video mode', rendererModes(window.electronAPI?.platform).find(item => item.value === mode)!.label],
    ['Capture path', transport ?? 'Browser capture'],
    ['Signal', stats?.width ? `${stats.width} × ${stats.height} · ${hdr ? 'HDR' : 'SDR'}` : 'Waiting'],
    ['Pixel format', pipeline.format],
    ['Render target', pipeline.output],
    ['FSR processing', pipeline.fsr],
    ['Source rate', number(stats?.trackFps, ' FPS')],
    ['Preview delivery', number(stats?.displayFps, ' FPS')],
    ['Last interval', number(stats?.lastFrameMs, ' ms')],
    ['Longest interval', number(stats?.maxFrameMs, ' ms')],
    ['Timing estimate', number(stats?.captureDelayMs, ' ms') + (stats?.captureDelayMs === undefined ? '' : stats.captureDelayKind === 'queue' ? ' · relative queue' : ' · capture age')],
    ['Gaps > 50 ms', stats ? String(stats.stallCount) : '—'],
    ['Dropped frames', dropped === undefined ? '—' : String(dropped)],
    ['Video state', state ?? (stats ? stats.stalled ? 'Waiting for frames' : 'Active' : 'Measuring')],
    ['Audio', audio.state],
    ['Audio output buffer', number(audio.latencyMs, ' ms')],
    ['Audio recoveries', String(audio.recoveries)],
  ];
  return <div data-diagnostics-overlay data-mode={mode}
    className="absolute top-4 left-4 z-40 px-3 py-2 rounded-md bg-black/80 border border-white/10 text-white/90 text-xs font-mono leading-relaxed pointer-events-none max-w-[calc(100%-2rem)]">
    <dl className="grid grid-cols-[auto_1fr] gap-x-4">
      {rows.map(([label, value]) => <React.Fragment key={label}>
        <dt className="text-white/60">{label}</dt><dd className="m-0 text-right">{value}</dd>
      </React.Fragment>)}
    </dl>
    <div className="mt-1 text-white/50">Software timing · not controller-to-screen latency</div>
  </div>;
}
