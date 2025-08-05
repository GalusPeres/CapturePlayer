// src/context/SettingsContext.tsx - Global settings management with localStorage persistence
import React, { createContext, useContext, useState, useEffect } from 'react';

export type Settings = {
  videoDevice: string;
  audioDevice: string;
  volume: number;
  brightness: number;
  contrast: number;
  saturation: number;
  hue: number;
  temperature: number;

  autoAspectRatio: boolean;
  manualAspectRatio: string;
  setAutoAspectRatio(v: boolean): void;
  setManualAspectRatio(v: string): void;

  setVideoDevice(v: string): void;
  setAudioDevice(a: string): void;
  setVolume(v: number): void;
  setBrightness(v: number): void;
  setContrast(v: number): void;
  setSaturation(v: number): void;
  setHue(v: number): void;
  setTemperature(v: number): void;
};

const SettingsContext = createContext<Settings | null>(null);

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [videoDevice, setVideoDevice] = useState(
    localStorage.getItem('videoDevice') || ''
  );
  const [audioDevice, setAudioDevice] = useState(
    localStorage.getItem('audioDevice') || ''
  );
  const [volume, setVolume] = useState(
    Number(localStorage.getItem('volume')) || 100
  );
  const [brightness, setBrightness] = useState(
    Number(localStorage.getItem('brightness')) || 100
  );
  const [contrast, setContrast] = useState(
    Number(localStorage.getItem('contrast')) || 100
  );
  const [saturation, setSaturation] = useState(
    Number(localStorage.getItem('saturation')) || 100
  );
  const [hue, setHue] = useState(Number(localStorage.getItem('hue')) || 0);
  const [temperature, setTemperature] = useState(
    Number(localStorage.getItem('temperature')) || 0
  );

  // Aspect ratio settings
  const [autoAspectRatio, setAutoAspectRatio] = useState(
    localStorage.getItem('autoAspectRatio') === 'false' ? false : true
  );
  const [manualAspectRatio, setManualAspectRatio] = useState(
    localStorage.getItem('manualAspectRatio') || '16:9'
  );

  // Persist settings to localStorage
  useEffect(() => { localStorage.setItem('videoDevice', videoDevice); }, [videoDevice]);
  useEffect(() => { localStorage.setItem('audioDevice', audioDevice); }, [audioDevice]);
  useEffect(() => { localStorage.setItem('volume', volume.toString()); }, [volume]);
  useEffect(() => { localStorage.setItem('brightness', brightness.toString()); }, [brightness]);
  useEffect(() => { localStorage.setItem('contrast', contrast.toString()); }, [contrast]);
  useEffect(() => { localStorage.setItem('saturation', saturation.toString()); }, [saturation]);
  useEffect(() => { localStorage.setItem('hue', hue.toString()); }, [hue]);
  useEffect(() => { localStorage.setItem('temperature', temperature.toString()); }, [temperature]);
  useEffect(() => { localStorage.setItem('autoAspectRatio', autoAspectRatio.toString()); }, [autoAspectRatio]);
  useEffect(() => { localStorage.setItem('manualAspectRatio', manualAspectRatio); }, [manualAspectRatio]);

  const value: Settings = {
    videoDevice, audioDevice, volume,
    brightness, contrast, saturation, hue, temperature,
    autoAspectRatio, manualAspectRatio,
    setVideoDevice, setAudioDevice, setVolume,
    setBrightness, setContrast, setSaturation, setHue, setTemperature,
    setAutoAspectRatio, setManualAspectRatio,
  };

  return (
    <SettingsContext.Provider value={value}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings(): Settings {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('SettingsProvider is missing');
  return ctx;
}