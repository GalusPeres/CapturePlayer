import React, { useEffect, useState } from 'react';
import { useSettings } from '../../context/SettingsContext';
import InfoHint from './InfoHint';

export default function NativeCaptureControls() {
  const settings = useSettings();
  const [status, setStatus] = useState({ available: false, phase: 'off', message: 'Checking native renderer…', fps: 0 });
  useEffect(() => {
    let live = true;
    const refresh = async () => { const next = await window.electronAPI.getNativeCaptureStatus?.(); if (live && next) setStatus({ ...next, fps: next.fps ?? 0 }); };
    void refresh(); const timer = setInterval(() => void refresh(), 1000);
    return () => { live = false; clearInterval(timer); };
  }, []);
  const row = (label: string, checked: boolean, change: () => void, info: string, disabled = false) =>
    <div className="flex items-center gap-3">
      <button type="button" role="switch" aria-label={label} aria-checked={checked} disabled={disabled} onClick={change}
        className={`w-6 h-6 shrink-0 rounded-md border-2 flex items-center justify-center transition-all disabled:opacity-40 ${checked ? 'bg-gradient-to-br from-blue-600 to-indigo-500 border-blue-500' : 'bg-gradient-to-br from-zinc-800/50 to-zinc-700/50 border-zinc-600/50 hover:border-zinc-500/70'} focus:outline-none focus:ring-2 focus:ring-blue-500/50`}>
        {checked && <svg aria-hidden="true" className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>}
      </button>
      <InfoHint info={info}><span className="text-sm text-white/90 cursor-help">{label}</span></InfoHint>
    </div>;
  return <div className="space-y-3">
    {row('Native capture renderer (experimental)', settings.nativeRenderer, () => settings.setNativeRenderer(!settings.nativeRenderer),
      'Direct Windows P010 capture using shared GPU textures. Restarts capture when changed. Uses the existing player controls. Elgato 4K X supports 1440p60 or 4K30 in this mode; Auto selects 1440p60.', !status.available)}
    {settings.nativeRenderer && <div className="ml-9 space-y-2">
      {row('HDR10 input', settings.nativeHdr, () => settings.setNativeHdr(!settings.nativeHdr),
        'P010, Rec. 2100 (PQ), limited range. Enable only when the console outputs HDR10 and capture-card HDR tone mapping is off. The driver does not reliably identify HDR. Requires Windows HDR and an HDR display. Color controls and FSR work on the GPU. Neural changes are composited over the original HDR image; the model itself processes SDR.')}
      <div className={`text-xs ${status.phase === 'error' ? 'text-red-300' : 'text-white/50'}`} role="status">
        {status.message}{status.fps > 0 ? ` · ${status.fps.toFixed(1)} FPS` : ''}
      </div>
    </div>}
  </div>;
}
