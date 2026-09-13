import React from 'react';
import { useSettings } from '../../context/SettingsContext';
import InfoHint from './InfoHint';

export default function UpscalerControls() {
  const settings = useSettings();
  const toggle = () => {
    if (!settings.spatialUpscaler && !settings.nativeRenderer) settings.setLowLatencyRenderer(true);
    settings.setSpatialUpscaler(!settings.spatialUpscaler);
  };
  return <div className="space-y-3">
    <div className="flex items-center gap-3">
      <button type="button" role="switch" aria-label="FSR 1 Upscaler" aria-checked={settings.spatialUpscaler} onClick={toggle}
        className={`w-6 h-6 shrink-0 rounded-md border-2 flex items-center justify-center transition-all
          ${settings.spatialUpscaler ? 'bg-gradient-to-br from-blue-600 to-indigo-500 border-blue-500' : 'bg-gradient-to-br from-zinc-800/50 to-zinc-700/50 border-zinc-600/50 hover:border-zinc-500/70'} focus:outline-none focus:ring-2 focus:ring-blue-500/50`}>
        {settings.spatialUpscaler && <svg aria-hidden="true" className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>}
      </button>
      <InfoHint info="AMD FSR 1 uses the current frame only. Enlarges lower-resolution capture. At matching source and output sizes, it supersamples through the next tier (for example, 1440p → 4K → 1440p), up to 4K internally. Can soften jagged edges; does not provide DLAA or recover missing game detail. Works with Native (including HDR) or WebGL. Extra GPU work, no extra frame queue.">
        <span onClick={toggle} className="text-sm text-white/90 cursor-pointer select-none">FSR 1 Upscaler</span>
      </InfoHint>
    </div>
    <fieldset disabled={!settings.spatialUpscaler} className="space-y-2 disabled:opacity-40 min-w-0">
      <div className="settings-slider-row">
        <InfoHint info="Adaptive sharpening after upscaling or supersampling. 0% disables sharpening. Lower values can keep edges softer. Capture resolution stays unchanged."><label htmlFor="upscale-sharpness" className="w-20 block cursor-help">Sharpness:</label></InfoHint>
        <input id="upscale-sharpness" type="range" min="0" max="100" step="1" value={settings.upscalerSharpness}
          onChange={e => settings.setUpscalerSharpness(Number(e.target.value))} className="volume-range flex-1 min-w-0"
          style={{ '--val': `${settings.upscalerSharpness}%` } as React.CSSProperties} />
        <span>{settings.upscalerSharpness}%</span>
      </div>
    </fieldset>
  </div>;
}
