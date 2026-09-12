import React, { useEffect, useState } from 'react';
import { useSettings } from '../../context/SettingsContext';
import InfoHint from './InfoHint';

export default function UpscalerControls({ signalInfo }: { signalInfo?: { w: number; h: number } | null }) {
  const settings = useSettings();
  const [, resized] = useState(0);
  useEffect(() => {
    const update = () => resized(n => n + 1);
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);
  const toggle = () => {
    if (!settings.spatialUpscaler) settings.setLowLatencyRenderer(true);
    settings.setSpatialUpscaler(!settings.spatialUpscaler);
  };
  const smallerDisplay = signalInfo && signalInfo.w >= window.innerWidth * window.devicePixelRatio && signalInfo.h >= window.innerHeight * window.devicePixelRatio;
  return <div className="space-y-3">
    <div className="flex items-center gap-3">
      <button type="button" role="switch" aria-label="FSR 1 upscaler" aria-checked={settings.spatialUpscaler} onClick={toggle}
        className={`w-6 h-6 shrink-0 rounded-md border-2 flex items-center justify-center transition-all
          ${settings.spatialUpscaler ? 'bg-gradient-to-br from-blue-600 to-indigo-500 border-blue-500' : 'bg-gradient-to-br from-zinc-800/50 to-zinc-700/50 border-zinc-600/50 hover:border-zinc-500/70'} focus:outline-none focus:ring-2 focus:ring-blue-500/50`}>
        {settings.spatialUpscaler && <svg aria-hidden="true" className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>}
      </button>
      <InfoHint info="AMD FSR 1 spatial upscaling, using the current frame only. Enables the WebGL renderer and runs when the output is larger than the source. No extra frame queue; GPU work still adds processing time. Supports compatible NVIDIA, AMD and Intel GPUs.">
        <span onClick={toggle} className="text-sm text-white/90 cursor-pointer select-none">FSR 1 upscaler (experimental)</span>
      </InfoHint>
    </div>
    {settings.spatialUpscaler && <div className="ml-9 space-y-2">
      <div className="flex items-center gap-3 text-sm">
        <InfoHint info="Adaptive sharpening after upscaling. 0% disables sharpening. Capture resolution stays unchanged; for example, a 1080p signal can be enlarged to a 1440p or 4K output."><label htmlFor="upscale-sharpness" className="cursor-help">Sharpness:</label></InfoHint>
        <input id="upscale-sharpness" type="range" min="0" max="100" step="1" value={settings.upscalerSharpness}
          onChange={e => settings.setUpscalerSharpness(Number(e.target.value))} className="volume-range flex-1 min-w-0"
          style={{ '--val': `${settings.upscalerSharpness}%` } as React.CSSProperties} />
        <span className="w-10 text-right shrink-0">{settings.upscalerSharpness}%</span>
      </div>
      <div className="text-xs text-white/50">{smallerDisplay ? 'Source already covers the output; upscaling is bypassed.' : 'Upscales when the output is larger than the source.'}</div>
    </div>}
  </div>;
}
