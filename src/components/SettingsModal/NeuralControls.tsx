import React, { useEffect, useRef, useState } from 'react';
import type { NeuralQuality, NeuralStatus } from '../../types/neural';
import { DEFAULT_NEURAL_TUNING } from '../../types/neural';
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
  const [tuningError, setTuningError] = useState('');
  const [busy, setBusy] = useState(false);
  const [importError, setImportError] = useState('');
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
  const enabled = status.enabled ?? (status.phase === 'active' || status.phase === 'starting');
  const importRuntime = async () => {
    setBusy(true); setImportError('');
    try {
      const result = await window.electronAPI.importNeuralRuntime?.();
      if (result?.error) setImportError(result.error);
      if (result?.status) setStatus(result.status);
    } catch { setImportError('Could not import the Neural runtime DLL.'); }
    finally { setBusy(false); }
  };
  const toggleDisabled = busy || (!enabled && (!status.available || !hasSignal));
  const compareDisabled = busy || !status.available || status.phase !== 'active';
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
    if (!enabled) await window.electronAPI.setNeuralQuality?.(next);
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
    if (compareDisabled) return;
    ++editVersion.current;
    setSplit(!split);
    void window.electronAPI.setNeuralSplit?.(!split);
  };
  const reset = async () => {
    ++editVersion.current;
    setBusy(true); setQuality('auto'); setStrength(100); setSplit(false);
    setTuningError('');
    try {
      await window.electronAPI.setNeuralTuning?.({ ...DEFAULT_NEURAL_TUNING });
      await window.electronAPI.setNeuralStrength?.(100);
      await window.electronAPI.setNeuralSplit?.(false);
      await window.electronAPI.setNeuralQuality?.('auto');
      if (enabled) { const next = await window.electronAPI.startNeural?.('auto', false, 100); if (next) setStatus(next); }
    } catch { setTuningError('Could not reset neural settings.'); }
    finally { setBusy(false); }
  };
  return <form id="neural-settings" data-neural-controls className="space-y-3" onSubmit={e => e.preventDefault()}
    onReset={e => { e.preventDefault(); void reset(); }}>
    <div className="flex items-center gap-3">
      <CheckButton checked={enabled} label="DLSS 5 Neural Rendering" disabled={toggleDisabled} onClick={() => void toggle()} />
      <InfoHint info={<>
        Experimental NVIDIA RTX neural rendering. Adds processing delay. Start capture to enable it.
        Native HDR is preserved by composition around the SDR model. Resizing temporarily shows the original image.
        <span className="block mt-1">{status.message}</span>
        {typeof status.processingMs === 'number' && <span className="block">Processing: {status.processingMs.toFixed(1)} ms · p95: {status.p95Ms?.toFixed(1)} ms. This excludes capture-card delay and display scanout.</span>}
        <span className="block mt-1">Stop: Ctrl + Alt + Backspace.</span>
      </>}>
        <span onClick={() => { if (!toggleDisabled) void toggle(); }} className={'text-sm text-white/90 select-none ' + (toggleDisabled ? 'opacity-40 cursor-help' : 'cursor-pointer')}>DLSS 5 Neural Rendering</span>
      </InfoHint>
      {window.electronAPI.importNeuralRuntime && <div className="ml-auto shrink-0">
        <InfoHint info="Select your nvngx_dlssnr.dll (tested version 310.8.0.0). CapturePlayer checks the file and stores it for future launches and updates. The DLL is not included in this installer. Turn Neural off before changing it.">
          <button type="button" disabled={busy || enabled || status.helpersAvailable === false}
            onClick={() => void importRuntime()}
            className="px-3 py-1.5 rounded-lg border border-zinc-600/60 bg-zinc-800 text-sm text-white/90 hover:bg-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap">
            {busy ? 'Please wait…' : status.runtimeInstalled ? 'Change DLL' : 'Select DLL'}
          </button>
        </InfoHint>
      </div>}
    </div>
    <fieldset disabled={busy || !status.available} className="space-y-3 disabled:opacity-40 min-w-0">
      <div>
        <div className="mb-1"><InfoHint info="Internal AI processing resolution. Lower settings reduce GPU work. Auto targets 60 FPS. The output keeps the physical window resolution."><span className="cursor-help">AI resolution:</span></InfoHint></div>
        <SimpleSelect ariaLabel="AI processing resolution" options={qualityOptions} value={quality} disabled={busy || !status.available} onChange={value => void changeQuality(value)} />
      </div>
      <div className="settings-slider-row">
        <InfoHint info="Mix the finished neural result with the original. Lowering this does not normally reduce model cost. 0% skips inference; turn Neural off to remove the extra capture/presentation stage."><label htmlFor="neural-strength" className="w-20 block cursor-help">Strength:</label></InfoHint>
        <input id="neural-strength" aria-label="Effect strength" type="range" min="0" max="100" value={strength} className="flex-1 min-w-0 volume-range" style={{ '--val': strength + '%' } as React.CSSProperties}
          onChange={e => { ++editVersion.current; const value = Number(e.target.value); setStrength(value); void window.electronAPI.setNeuralStrength?.(value); }} />
        <span>{strength}%</span>
      </div>
      <div className="flex items-center gap-3">
        <CheckButton checked={split} label="Compare original and neural" disabled={compareDisabled} onClick={toggleSplit} />
        <InfoHint info="Available while Neural Rendering is active. Original on the left, neural result on the right. Both use the same captured frame."><span onClick={toggleSplit} className={'text-sm select-none ' + (compareDisabled ? 'opacity-40 cursor-help' : 'cursor-pointer')}>Compare side by side</span></InfoHint>
      </div>
    </fieldset>
    {(importError || tuningError || status.phase === 'error') && <div role="alert" className="text-xs text-amber-200/90">{importError || tuningError || status.message}</div>}
  </form>;
}
