import React, { useEffect, useRef, useState } from 'react';
import type { NeuralQuality, NeuralStatus } from '../../types/neural';
import InfoHint from './InfoHint';
import { SimpleSelect } from '../SimpleSelect';

const qualityOptions = [
  { value: 'auto', label: 'Auto · target 60 FPS' },
  { value: '720p', label: '720p · faster' },
  { value: '900p', label: '900p · balanced' },
  { value: '1080p', label: '1080p' },
  { value: '1440p', label: '1440p · higher quality' }
];

function CheckButton({ checked, label, disabled, onClick }: {
  checked: boolean; label: string; disabled?: boolean; onClick: () => void;
}) {
  return <button type="button" role="switch" aria-label={label} aria-checked={checked}
    disabled={disabled} onClick={onClick}
    className={`w-6 h-6 shrink-0 rounded-md border-2 flex items-center justify-center transition-all disabled:opacity-40
      ${checked ? 'bg-gradient-to-br from-blue-600 to-indigo-500 border-blue-500'
        : 'bg-gradient-to-br from-zinc-800/50 to-zinc-700/50 border-zinc-600/50 hover:from-zinc-700/70 hover:to-zinc-600/70 hover:border-zinc-500/70'}
      focus:outline-none focus:ring-2 focus:ring-blue-500/50`}>
    {checked && <svg aria-hidden="true" className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
    </svg>}
  </button>;
}

export default function NeuralControls({ hasSignal }: { hasSignal: boolean }) {
  const [status, setStatus] = useState<NeuralStatus>({ phase: 'off', available: false, message: 'Checking local runtime…' });
  const [quality, setQuality] = useState<NeuralQuality>('auto');
  const [split, setSplit] = useState(false);
  const [strength, setStrength] = useState(100);
  const [busy, setBusy] = useState(false);
  const editVersion = useRef(0);
  useEffect(() => {
    let mounted = true;
    let initial = true;
    const refresh = async () => {
      const version = editVersion.current;
      try {
        const next = await window.electronAPI.getNeuralStatus?.();
        if (mounted) setStatus(next || { phase: 'off', available: false, message: 'Requires the Windows desktop app.' });
        if (mounted && next && version === editVersion.current && (initial || next.phase === 'active' || next.phase === 'starting')) {
          setQuality(next.selectedQuality ?? 'auto');
          setSplit(next.split ?? false);
          setStrength(next.strength ?? 100);
          initial = false;
        }
      } catch {
        if (mounted) setStatus({ phase: 'error', available: false, message: 'Neural preview is unavailable.' });
      }
    };
    void refresh();
    const timer = window.setInterval(refresh, 1000);
    return () => { mounted = false; clearInterval(timer); };
  }, []);
  const enabled = status.phase === 'active' || status.phase === 'starting';
  const toggleDisabled = busy || (!enabled && (!status.available || !hasSignal));
  const toggle = async () => {
    ++editVersion.current;
    setBusy(true);
    try {
      const next = enabled ? await window.electronAPI.stopNeural?.() : await window.electronAPI.startNeural?.(quality, split, strength);
      if (next) setStatus(next);
    } catch {
      setStatus({ phase: 'error', available: true, message: 'Could not start the neural preview.' });
    } finally { setBusy(false); }
  };
  const changeQuality = async (value: string) => {
    ++editVersion.current;
    const next = value as NeuralQuality;
    setQuality(next);
    if (enabled) {
      setBusy(true);
      try {
        const updated = await window.electronAPI.startNeural?.(next, split, strength);
        if (updated) setStatus(updated);
      } catch {
        setStatus({ phase: 'error', available: true, message: 'Could not change the neural resolution.' });
      } finally { setBusy(false); }
    }
  };
  const toggleSplit = () => {
    ++editVersion.current;
    setSplit(!split);
    void window.electronAPI.setNeuralSplit?.(!split);
  };
  return (
    <div data-neural-controls className="space-y-3">
      <div className="flex items-center gap-3">
        <CheckButton checked={enabled} label="DLSS 5 Neural Rendering" disabled={toggleDisabled} onClick={() => void toggle()} />
        <InfoHint info={<>
          Experimental neural rendering for NVIDIA RTX, SDR only. Adds processing delay.
          Stays active when focus changes; resizing briefly shows the original while the preview adapts.
          <span className="block mt-1">Stop anytime with <span className="text-white">Ctrl + Alt + Backspace</span>.</span>
        </>}>
          <span onClick={() => { if (!toggleDisabled) void toggle(); }}
            className={`text-sm text-white/90 select-none ${toggleDisabled ? 'opacity-40 cursor-default' : 'cursor-pointer'}`}>
            DLSS 5 Neural Rendering (experimental)
          </span>
        </InfoHint>
      </div>
      {enabled && <div className="ml-9 space-y-3">
        <div>
          <div className="mb-1 text-sm text-white/90">
            <InfoHint info="Lower resolutions reduce GPU work. Auto reduces resolution if processing is too slow. The output keeps the physical window resolution; 4K output needs a 4K display.">
              <span className="cursor-help">AI resolution:</span>
            </InfoHint>
          </div>
          <SimpleSelect ariaLabel="AI processing resolution" options={qualityOptions} value={quality}
            disabled={busy} direction="up" onChange={value => void changeQuality(value)} />
        </div>
        <div className="flex items-center gap-3 text-sm">
          <InfoHint info="Mix the original and neural image. 0% shows the original; 100% applies the full effect. Use the main switch to remove the extra capture and processing stage completely.">
            <label htmlFor="neural-strength" className="shrink-0 cursor-help">Strength:</label>
          </InfoHint>
          <input id="neural-strength" aria-label="Effect strength" type="range" min="0" max="100" step="1" value={strength}
            className="flex-1 min-w-0 volume-range" style={{ '--val': `${strength}%` } as React.CSSProperties}
            onChange={e => {
              ++editVersion.current;
              const value = Number(e.target.value); setStrength(value);
              void window.electronAPI.setNeuralStrength?.(value);
            }} />
          <span className="w-10 text-right shrink-0 tabular-nums">{strength}%</span>
        </div>
        <div className="flex items-center gap-3">
          <CheckButton checked={split} label="Compare original and neural" onClick={toggleSplit} />
          <InfoHint info="Original on the left, neural image on the right. Both show the same captured frame.">
            <span onClick={toggleSplit} className="text-sm text-white/90 cursor-pointer select-none">Compare side by side</span>
          </InfoHint>
        </div>
        <div role="status" aria-live="polite" className="text-xs text-white/60">{status.message}</div>
        {typeof status.fps === 'number' && <InfoHint info={<>
          Processing excludes capture-card delay and display scanout; this is not total input lag.
          <span className="block mt-1">Processing p95: {status.p95Ms?.toFixed(1)} ms{typeof status.gpuMs === 'number' ? ` · GPU: ${status.gpuMs.toFixed(1)} ms` : ''}</span>
          {typeof status.presentGapP95Ms === 'number' && <span className="block">Submission interval p95: {status.presentGapP95Ms.toFixed(1)} ms · max: {status.presentGapMaxMs?.toFixed(1)} ms</span>}
        </>}>
          <span className="text-xs text-white/60 tabular-nums cursor-help">
            {status.outputWidth} × {status.outputHeight} · {status.fps.toFixed(1)} FPS · {status.processingMs?.toFixed(1)} ms
          </span>
        </InfoHint>}
      </div>}
      {!enabled && (status.phase === 'error' || !status.available || !hasSignal) &&
        <div role="status" className={`ml-9 text-xs ${status.phase === 'error' ? 'text-amber-200/90' : 'text-white/50'}`}>
          {status.phase === 'error' ? status.message : !status.available ? 'Local neural runtime unavailable.' : 'Start the capture first.'}
        </div>}
    </div>
  );
}
