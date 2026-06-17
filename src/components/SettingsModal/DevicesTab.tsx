// src/components/SettingsModal/BasicTab.tsx - Device selection and media controls
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useSettings } from '../../context/SettingsContext';
import { SimpleSelectOption, SimpleSelect } from '../SimpleSelect';
import InfoHint from './InfoHint';

type SignalInfo = { w: number; h: number; fps?: number } | null;

type Props = {
  localVideo: string;
  setLocalVideo: (value: string) => void;
  localAudio: string;
  setLocalAudio: (value: string) => void;
  signalInfo?: SignalInfo;
  running: boolean;
};

const captureResolutionOptions: SimpleSelectOption[] = [
  { value: 'auto', label: 'Auto' },
  { value: '3840x2160', label: '3840x2160 (4K)' },
  { value: '2560x1440', label: '2560x1440' },
  { value: '1920x1080', label: '1920x1080' },
  { value: '1280x720', label: '1280x720' }
];

const captureFrameRateOptions: SimpleSelectOption[] = [
  { value: 'auto', label: 'Auto' },
  { value: '30', label: '30 FPS' },
  { value: '60', label: '60 FPS' },
  { value: '120', label: '120 FPS' },
  { value: '144', label: '144 FPS' }
];

// Clean device labels by removing hardware IDs in parentheses
function cleanLabel(label: string): string {
  return label.replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)\s*$/i, '').trim();
}

function hasDeviceLabels(devices: MediaDeviceInfo[]) {
  return devices.some(
    (device) => (device.kind === 'videoinput' || device.kind === 'audioinput') && device.label.trim() !== ''
  );
}

export default function BasicTab({ localVideo, setLocalVideo, localAudio, setLocalAudio, signalInfo, running }: Props) {
  const settings = useSettings();
  const { captureResolution, captureFrameRate, setCaptureResolution, setCaptureFrameRate } = settings;

  const [videoDevices, setVideoDevices] = useState<MediaDeviceInfo[]>([]);
  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([]);

  const updateDeviceLists = useCallback((devices: MediaDeviceInfo[]) => {
    setVideoDevices(devices.filter((d) => d.kind === 'videoinput'));
    setAudioDevices(devices.filter((d) => d.kind === 'audioinput'));
  }, []);

  // Device detection when the devices tab is shown.
  // While capture is already running, avoid probing getUserMedia again because
  // re-opening the device can briefly disturb the active audio path.
  useEffect(() => {
    let cancelled = false;

    const loadDevices = async () => {
      try {
        let devices = await navigator.mediaDevices.enumerateDevices();
        if (cancelled) return;

        updateDeviceLists(devices);

        // Only do a one-time permission probe when nothing is running and labels
        // are still unavailable. When capture is already live, enumerateDevices()
        // is enough and avoids a short audio glitch.
        if (!running && !hasDeviceLabels(devices)) {
          const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
          stream.getTracks().forEach((track) => track.stop());

          devices = await navigator.mediaDevices.enumerateDevices();
          if (cancelled) return;

          updateDeviceLists(devices);
        }
      } catch (error) {
        console.error(error);
      }
    };

    loadDevices();

    return () => {
      cancelled = true;
    };
  }, [running, updateDeviceLists]);

  // Filter and format video devices for dropdown
  const filteredVideo = useMemo<SimpleSelectOption[]>(() => {
    const devices = videoDevices
      .filter((d) => !/^Default\b/i.test(d.label || ''))
      .map((d, i) => ({
        value: d.deviceId,
        label: cleanLabel(d.label || `Camera ${i + 1}`)
      }));

    return [{ value: '', label: 'No video device' }, ...devices];
  }, [videoDevices]);

  // Filter and format audio devices for dropdown
  const filteredAudio = useMemo<SimpleSelectOption[]>(() => {
    const devices = audioDevices
      .filter((d) => !/^Default\b/i.test(d.label || ''))
      .map((d, i) => ({
        value: d.deviceId,
        label: cleanLabel(d.label || `Microphone ${i + 1}`)
      }));

    return [{ value: '', label: 'No audio device' }, ...devices];
  }, [audioDevices]);

  useEffect(() => {
    if (!captureResolutionOptions.some((option) => option.value === captureResolution)) {
      setCaptureResolution('auto');
    }

    if (!captureFrameRateOptions.some((option) => option.value === captureFrameRate)) {
      setCaptureFrameRate('auto');
    }
  }, [captureFrameRate, captureResolution, setCaptureFrameRate, setCaptureResolution]);

  // Format signal info display text
  let signalTxt = signalInfo?.w && signalInfo?.h ? `Source: ${signalInfo.w}x${signalInfo.h}` : '';
  if (signalInfo?.fps) signalTxt += `@${signalInfo.fps}FPS`;

  return (
    <>
      {/* Video Device Selection */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <label>Video Device:</label>
          {signalTxt && (
            <span
              className="
              inline-block px-1.5 py-0.5
              border border-white/20
              rounded-md text-xs text-white/70
              font-mono tracking-wide
              ml-2
            "
            >
              {signalTxt}
            </span>
          )}
        </div>
        <SimpleSelect
          options={filteredVideo}
          value={localVideo}
          onChange={(value) => {
            setLocalVideo(value);
            settings.setVideoDevice(value); // Sofort speichern
          }}
        />
      </div>

      {/* Capture Format Selection */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block mb-1">Resolution:</label>
          <SimpleSelect
            options={captureResolutionOptions}
            value={captureResolution}
            onChange={(value) => setCaptureResolution(value)}
          />
        </div>
        <div>
          <label className="block mb-1">FPS:</label>
          <SimpleSelect
            options={captureFrameRateOptions}
            value={captureFrameRate}
            onChange={(value) => setCaptureFrameRate(value)}
          />
        </div>
      </div>

      {/* Audio Device Selection */}
      <div>
        <label className="block mb-1">Audio Device:</label>
        <SimpleSelect
          options={filteredAudio}
          value={localAudio}
          onChange={(value) => {
            setLocalAudio(value);
            settings.setAudioDevice(value); // Sofort speichern
          }}
        />
      </div>

      {/* Volume Control */}
      <div className="flex items-center gap-3">
        <label className="w-20 shrink-0">Volume:</label>
        <input
          type="range"
          min={0}
          max={100}
          value={settings.volume}
          onChange={(e) => {
            const v = Number(e.target.value);
            settings.setVolume(v);
            // Set filled part for WebKit (CSS var controls background-size)
            (e.currentTarget as HTMLInputElement).style.setProperty('--val', `${v}%`);
          }}
          className="flex-1 volume-range"
          // Initial value + brand color (can be set centrally)
          style={{
            ['--val' as any]: `${settings.volume}%`,
            ['--brand' as any]: '#22c55e'
          }}
        />
        <span className="w-10 text-right shrink-0">{settings.volume}</span>
      </div>

      {/* Autostart with Devices */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => settings.setAutostartWithDevices(!settings.autostartWithDevices)}
          className={`
            w-6 h-6 rounded-md border-2 flex items-center justify-center transition-all
            ${
              settings.autostartWithDevices
                ? 'bg-gradient-to-br from-blue-600 to-indigo-500 border-blue-500'
                : 'bg-gradient-to-br from-zinc-800/50 to-zinc-700/50 border-zinc-600/50 hover:from-zinc-700/70 hover:to-zinc-600/70 hover:border-zinc-500/70'
            }
            focus:outline-none focus:ring-2 focus:ring-blue-500/50
          `}
        >
          {settings.autostartWithDevices && (
            <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
            </svg>
          )}
        </button>
        <InfoHint info={<>Uses the last selected devices</>}>
          <span
            onClick={() => settings.setAutostartWithDevices(!settings.autostartWithDevices)}
            className="text-sm text-white/90 cursor-pointer select-none"
          >
            Start capture on app launch
          </span>
        </InfoHint>
      </div>
    </>
  );
}
