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
    () =>
      videoDevices
        .filter((d) => !/^Default\b/i.test(d.label || ''))
        .map((d, i) => ({
          value: d.deviceId,
          label: cleanLabel(d.label || `Camera ${i + 1}`),
        })),
    [videoDevices]
  );

  // Filter and format audio devices for dropdown
  const filteredAudio = useMemo<SimpleSelectOption[]>(
    () =>
      audioDevices
        .filter((d) => !/^Default\b/i.test(d.label || ''))
        .map((d, i) => ({
          value: d.deviceId,
          label: cleanLabel(d.label || `Microphone ${i + 1}`),
        })),
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
          onChange={setLocalVideo}
        />
      </div>

      {/* Audio Device Selection */}
      <div>
        <label className="block mb-1">Audio Device:</label>
        <SimpleSelect
          options={filteredAudio}
          value={localAudio}
          onChange={setLocalAudio}
        />
      </div>

      {/* Volume Control */}
      <div>
        <label className="block mb-1">Volume: {settings.volume}</label>
        <input
          type="range"
          min={0}
          max={100}
          value={settings.volume}
          onChange={(e) => settings.setVolume(Number(e.target.value))}
          className="w-full focus:outline-none"
        />
      </div>
    </>
  );
}