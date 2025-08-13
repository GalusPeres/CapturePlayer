// src/context/SettingsContext.tsx - Global settings management with localStorage persistence
import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';

export type Settings = {
  videoDevice: string;
  audioDevice: string;
  volume: number;
  brightness: number;
  contrast: number;
  saturation: number;
  hue: number;
  temperature: number;
  sharpness: number;
  fsrMode: string;
  colorProfiles: Array<{id: string, name: string, brightness: number, contrast: number, saturation: number, hue: number, sharpness: number}>;
  cropHorizontal: number;
  cropVertical: number;
  zoomLevel: number;

  autoAspectRatio: boolean;
  manualAspectRatio: string;
  customAspectPresets: Array<{id: string, name: string, zoomLevel: number, aspectRatio: number}>;
  
  // Custom aspect ratios for Free mode
  customRatios: Array<{id: string, ratio: number}>;
  autostartWithDevices: boolean;
  
  setAutoAspectRatio(v: boolean): void;
  setManualAspectRatio(v: string): void;
  setCustomAspectPresets(v: Array<{id: string, name: string, zoomLevel: number, aspectRatio: number}>): void;
  
  // Custom ratios setter
  setCustomRatios(v: Array<{id: string, ratio: number}>): void;
  setAutostartWithDevices(v: boolean): void;

  setVideoDevice(v: string): void;
  setAudioDevice(a: string): void;
  setVolume(v: number): void;
  setBrightness(v: number): void;
  setContrast(v: number): void;
  setSaturation(v: number): void;
  setHue(v: number): void;
  setTemperature(v: number): void;
  setSharpness(v: number): void;
  setFsrMode(v: string): void;
  setColorProfiles(v: Array<{id: string, name: string, brightness: number, contrast: number, saturation: number, hue: number, sharpness: number}>): void;
  setCropHorizontal(v: number): void;
  setCropVertical(v: number): void;
  setZoomLevel(v: number): void;
};

const SettingsContext = createContext<Settings | null>(null);

// Optimized localStorage operations - batch load all settings at once
const loadAllSettings = () => {
  try {
    const stored = localStorage.getItem('capturePlayerSettings');
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (error) {
    console.warn('Failed to load settings from localStorage:', error);
  }
  return {};
};

// Default settings
const DEFAULT_SETTINGS = {
  videoDevice: '',
  audioDevice: '',
  volume: 100,
  brightness: 100,
  contrast: 100,
  saturation: 100,
  hue: 0,
  temperature: 0,
  sharpness: 100,
  fsrMode: 'off',
  colorProfiles: [],
  cropHorizontal: 0,
  cropVertical: 0,
  zoomLevel: 100,
  autoAspectRatio: true,
  manualAspectRatio: '16:9',
  customAspectPresets: [],
  customRatios: [],
  autostartWithDevices: false,
};

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  // Load all settings at once during initialization
  const [allSettings, setAllSettings] = useState(() => {
    const loaded = loadAllSettings();
    return { ...DEFAULT_SETTINGS, ...loaded };
  });

  // Extract individual settings from the main state
  const {
    videoDevice, audioDevice, volume, brightness, contrast, saturation, hue,
    temperature, sharpness, fsrMode, colorProfiles, cropHorizontal, cropVertical,
    zoomLevel, autoAspectRatio, manualAspectRatio, customAspectPresets, customRatios,
    autostartWithDevices
  } = allSettings;

  // Debounced save function to batch localStorage writes
  const debouncedSave = useMemo(() => {
    let timeoutId: number;
    return (settings: typeof allSettings) => {
      clearTimeout(timeoutId);
      timeoutId = window.setTimeout(() => {
        try {
          localStorage.setItem('capturePlayerSettings', JSON.stringify(settings));
        } catch (error) {
          console.warn('Failed to save settings to localStorage:', error);
        }
      }, 100); // 100ms debounce
    };
  }, []);

  // Save settings whenever they change (debounced)
  useEffect(() => {
    debouncedSave(allSettings);
  }, [allSettings, debouncedSave]);

  // Optimized setter functions that update the entire settings object
  const createSetter = useCallback(<K extends keyof typeof allSettings>(
    key: K
  ) => {
    return (value: typeof allSettings[K]) => {
      setAllSettings(prev => ({ ...prev, [key]: value }));
    };
  }, []);

  const setVideoDevice = useMemo(() => createSetter('videoDevice'), [createSetter]);
  const setAudioDevice = useMemo(() => createSetter('audioDevice'), [createSetter]);
  const setVolume = useMemo(() => createSetter('volume'), [createSetter]);
  const setBrightness = useMemo(() => createSetter('brightness'), [createSetter]);
  const setContrast = useMemo(() => createSetter('contrast'), [createSetter]);
  const setSaturation = useMemo(() => createSetter('saturation'), [createSetter]);
  const setHue = useMemo(() => createSetter('hue'), [createSetter]);
  const setTemperature = useMemo(() => createSetter('temperature'), [createSetter]);
  const setSharpness = useMemo(() => createSetter('sharpness'), [createSetter]);
  const setFsrMode = useMemo(() => createSetter('fsrMode'), [createSetter]);
  const setColorProfiles = useMemo(() => createSetter('colorProfiles'), [createSetter]);
  const setCropHorizontal = useMemo(() => createSetter('cropHorizontal'), [createSetter]);
  const setCropVertical = useMemo(() => createSetter('cropVertical'), [createSetter]);
  const setZoomLevel = useMemo(() => createSetter('zoomLevel'), [createSetter]);
  const setAutoAspectRatio = useMemo(() => createSetter('autoAspectRatio'), [createSetter]);
  const setManualAspectRatio = useMemo(() => createSetter('manualAspectRatio'), [createSetter]);
  const setCustomAspectPresets = useMemo(() => createSetter('customAspectPresets'), [createSetter]);
  const setCustomRatios = useMemo(() => createSetter('customRatios'), [createSetter]);
  const setAutostartWithDevices = useMemo(() => createSetter('autostartWithDevices'), [createSetter]);

  const value: Settings = useMemo(() => ({
    videoDevice, audioDevice, volume,
    brightness, contrast, saturation, hue, temperature, sharpness, fsrMode, colorProfiles, cropHorizontal, cropVertical, zoomLevel,
    autoAspectRatio, manualAspectRatio, customAspectPresets,
    customRatios, autostartWithDevices,
    setVideoDevice, setAudioDevice, setVolume,
    setBrightness, setContrast, setSaturation, setHue, setTemperature, setSharpness, setFsrMode, setColorProfiles, setCropHorizontal, setCropVertical, setZoomLevel,
    setAutoAspectRatio, setManualAspectRatio, setCustomAspectPresets,
    setCustomRatios, setAutostartWithDevices,
  }), [
    videoDevice, audioDevice, volume, brightness, contrast, saturation, hue, temperature, sharpness, fsrMode, colorProfiles, cropHorizontal, cropVertical, zoomLevel,
    autoAspectRatio, manualAspectRatio, customAspectPresets, customRatios, autostartWithDevices,
    setVideoDevice, setAudioDevice, setVolume, setBrightness, setContrast, setSaturation, setHue, setTemperature, setSharpness, setFsrMode, setColorProfiles, setCropHorizontal, setCropVertical, setZoomLevel,
    setAutoAspectRatio, setManualAspectRatio, setCustomAspectPresets, setCustomRatios, setAutostartWithDevices
  ]);

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