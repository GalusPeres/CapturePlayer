// src/components/SettingsModal/BasicTab.tsx - Device selection and media controls
import React, { useState, useEffect, useMemo } from 'react';
import { useSettings } from '../../context/SettingsContext';
import { SimpleSelectOption, SimpleSelect } from '../SimpleSelect';

type SignalInfo = { w: number, h: number, fps?: number } | null;

type Props = {
  localVideo: string;
  setLocalVideo: (value: string) => void;
  localAudio: string;
  setLocalAudio: (value: string) => void;
  signalInfo?: SignalInfo;
};

// Clean device labels by removing hardware IDs in parentheses
function cleanLabel(label: string): string {
  return label.replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)\s*$/i, '').trim();
}

export default function BasicTab({ localVideo, setLocalVideo, localAudio, setLocalAudio, signalInfo }: Props) {
  const settings = useSettings();
  
  const [videoDevices, setVideoDevices] = useState<MediaDeviceInfo[]>([]);
  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([]);

  // Device detection on component mount
  useEffect(() => {
    navigator.mediaDevices
      .getUserMedia({ video: true, audio: true })
      .then((stream) => {
        // Stop all tracks immediately - we just needed permission
        stream.getTracks().forEach((track) => track.stop());
        return navigator.mediaDevices.enumerateDevices();
      })
      .then((devices) => {
        setVideoDevices(devices.filter((d) => d.kind === 'videoinput'));
        setAudioDevices(devices.filter((d) => d.kind === 'audioinput'));
      })
      .catch(console.error);
  }, []);

  // Filter and format video devices for dropdown
  const filteredVideo = useMemo<SimpleSelectOption[]>(
    () => {
      const devices = videoDevices
        .filter((d) => !/^Default\b/i.test(d.label || ''))
        .map((d, i) => ({
          value: d.deviceId,
          label: cleanLabel(d.label || `Camera ${i + 1}`),
        }));
      
      return [
        { value: '', label: 'No video device' },
        ...devices
      ];
    },
    [videoDevices]
  );

  // Filter and format audio devices for dropdown
  const filteredAudio = useMemo<SimpleSelectOption[]>(
    () => {
      const devices = audioDevices
        .filter((d) => !/^Default\b/i.test(d.label || ''))
        .map((d, i) => ({
          value: d.deviceId,
          label: cleanLabel(d.label || `Microphone ${i + 1}`),
        }));
      
      return [
        { value: '', label: 'No audio device' },
        ...devices
      ];
    },
    [audioDevices]
  );

  // Format signal info display text
  let signalTxt = signalInfo?.w && signalInfo?.h ? `Source: ${signalInfo.w}×${signalInfo.h}` : '';
  if (signalInfo?.fps) signalTxt += `@${signalInfo.fps}FPS`;

  return (
    <>
      {/* Video Device Selection */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <label>Video Device:</label>
          {signalTxt && (
            <span className="
              inline-block px-1.5 py-0.5
              border border-white/20
              rounded-md text-xs text-white/70
              font-mono tracking-wide
              ml-2
            ">
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
            ['--brand' as any]: '#22c55e',
          }}
        />
        <span className="w-10 text-right shrink-0">{settings.volume}</span>
      </div>

      {/* Autostart with Devices */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <label>Autostart on App Launch:</label>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => {
              const newValue = !settings.autostartWithDevices;
              settings.setAutostartWithDevices(newValue);
              // Disable autostart when devices change
              if (newValue && (localVideo !== settings.videoDevice || localAudio !== settings.audioDevice)) {
                // Will be disabled automatically on apply since devices are different
              }
            }}
            className={`
              w-6 h-6 rounded-md border-2 flex items-center justify-center transition-all
              ${settings.autostartWithDevices 
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
          <span 
            onClick={() => settings.setAutostartWithDevices(!settings.autostartWithDevices)}
            className="text-sm text-white/90 cursor-pointer select-none"
          >
            Start capture (using last selected devices)
          </span>
        </div>
      </div>
    </>
  );
}
