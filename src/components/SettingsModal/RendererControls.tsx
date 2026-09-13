import React, { useEffect, useState } from 'react';
import { useSettings } from '../../context/SettingsContext';
import { SimpleSelect } from '../SimpleSelect';
import InfoHint from './InfoHint';

export default function RendererControls() {
  const settings = useSettings();
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    let live = true;
    void window.electronAPI.getNativeCaptureStatus?.().then(s => { if (live) setAvailable(s.available); });
    return () => { live = false; };
  }, []);
  const value = settings.nativeRenderer ? 'native' : settings.lowLatencyRenderer || settings.spatialUpscaler ? 'webgl' : 'standard';
  return <div className="flex items-center gap-3">
    <InfoHint info="Standard uses the browser video player. WebGL processes color and FSR on the GPU. Native uses Media Foundation, AVFoundation or V4L2, with compatible SDR capture for legacy and virtual cameras. HDR requires a compatible capture format, driver and display. Changing the renderer restarts capture.">
      <span className="cursor-help shrink-0">Renderer:</span>
    </InfoHint>
    <div className="flex-1 min-w-0"><SimpleSelect ariaLabel="Video renderer" value={value}
      options={[{ value: 'standard', label: 'Standard' }, { value: 'webgl', label: 'WebGL' }, ...(available || settings.nativeRenderer ? [{ value: 'native', label: 'Native (experimental)' }] : [])]}
      onChange={next => {
        settings.setNativeRenderer(next === 'native');
        settings.setLowLatencyRenderer(next === 'webgl');
        if (next === 'standard') settings.setSpatialUpscaler(false);
      }} /></div>
  </div>;
}

export function HdrControls() {
  const settings = useSettings();
  const portable = window.electronAPI?.platform === 'darwin' || window.electronAPI?.platform === 'linux';
  const key = `${settings.videoDevice}/${settings.captureResolution}/${settings.captureFrameRate}`;
  const [support, setSupport] = useState<{ key: string; possible: boolean; reason: string }>();
  const [virtualCameraKey, setVirtualCameraKey] = useState('');
  useEffect(() => {
    if (!settings.nativeRenderer) return;
    let live = true;
    const inspect = async () => {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const device = devices.find(d => d.kind === 'videoinput' && d.deviceId === settings.videoDevice);
        if (!device?.label) throw new Error('Select a capture device and grant camera access first.');
        const virtual = /obs.*virtual|obs-camera/i.test(device.label);
        if (live) setVirtualCameraKey(virtual ? key : '');
        if (virtual || !portable) return;
        const [width, height] = settings.captureResolution === 'auto' ? [2560, 1440] : settings.captureResolution.split('x').map(Number);
        const capabilities = await window.electronAPI.getNativeCaptureCapabilities?.({
          device: device.label.replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)$/i, ''), width, height,
          fps: settings.captureFrameRate === 'auto' ? 60 : Number(settings.captureFrameRate), hdr: false
        });
        if (live) setSupport({ key, possible: !!capabilities?.hdrInputPossible, reason: capabilities?.reason || 'Native HDR is unavailable.' });
      } catch (error) { if (live) setSupport({ key, possible: false, reason: String(error) }); }
    };
    void inspect();
    navigator.mediaDevices.addEventListener('devicechange', inspect);
    return () => { live = false; navigator.mediaDevices.removeEventListener('devicechange', inspect); };
  }, [portable, key, settings.nativeRenderer, settings.videoDevice, settings.captureResolution, settings.captureFrameRate]);
  const virtualCamera = virtualCameraKey === key;
  const unavailable = !settings.nativeRenderer || virtualCamera || (portable && (support?.key !== key || !support.possible));
  const checked = settings.nativeRenderer && settings.nativeHdr && !virtualCamera;
  // An already enabled mode can always be turned off, even after unplugging
  // a card or discovering that the driver cannot provide HDR.
  const disabled = unavailable && !checked;
  const toggle = () => { if (!disabled) settings.setNativeHdr(!settings.nativeHdr); };
  return <div className="flex items-center gap-3">
    <button type="button" role="switch" aria-label="HDR" aria-checked={checked}
      disabled={disabled} onClick={toggle}
      className={`w-6 h-6 shrink-0 rounded-md border-2 flex items-center justify-center transition-all disabled:opacity-40 ${checked ? 'bg-gradient-to-br from-blue-600 to-indigo-500 border-blue-500' : 'bg-gradient-to-br from-zinc-800/50 to-zinc-700/50 border-zinc-600/50 hover:border-zinc-500/70'} focus:outline-none focus:ring-2 focus:ring-blue-500/50`}>
      {checked && <svg aria-hidden="true" className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>}
    </button>
    <InfoHint info={<>
      Requires Native under View → Renderer. The capture card and driver must deliver real 10-bit HDR, with card tone mapping off. Windows and Linux use HDR10/PQ; macOS requires tagged PQ or HLG buffers. An HDR-capable display is needed to see HDR highlights. HDMI passthrough alone is insufficient.
      {virtualCamera ? <span className="block mt-1">OBS Virtual Camera delivers SDR. Your HDR preference is retained for compatible capture cards.</span> : portable && <span className="block mt-1">{support?.key === key ? support.reason : 'Checking capture formats…'}</span>}
    </>}>
      <span onClick={toggle} className={`text-sm select-none ${!disabled ? 'text-white/90 cursor-pointer' : 'text-white/40 cursor-help'}`}>HDR</span>
    </InfoHint>
  </div>;
}
