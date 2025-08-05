// src/components/SettingsModal/AdvancedTab.tsx - Aspect ratio and color controls
import React from 'react';
import { useSettings } from '../../context/SettingsContext';

const aspectModes = [
  { value: 'auto', label: 'Auto' },
  { value: '16:9', label: '16:9' },
  { value: '4:3', label: '4:3' },
  { value: 'free', label: 'Free' },
];

const colorControls = [
  {
    id: 'brightness',
    label: 'Brightness',
    min: 50,
    max: 200,
    key: 'brightness' as const,
  },
  {
    id: 'contrast',
    label: 'Contrast',
    min: 50,
    max: 300,
    key: 'contrast' as const,
  },
  {
    id: 'saturation',
    label: 'Saturation',
    min: 50,
    max: 400,
    key: 'saturation' as const,
  },
  {
    id: 'hue',
    label: 'Hue',
    min: -60,
    max: 60,
    key: 'hue' as const,
  },
];

export default function AdvancedTab() {
  const settings = useSettings();

  // Determine current aspect ratio mode
  let aspectMode: string = settings.autoAspectRatio ? 'auto' : settings.manualAspectRatio;
  if (!['auto', '16:9', '4:3', 'free'].includes(aspectMode)) aspectMode = 'auto';

  // Reset all color settings to defaults
  const resetColors = () => {
    settings.setBrightness(100);
    settings.setContrast(100);
    settings.setSaturation(100);
    settings.setHue(0);
  };

  // Handle aspect ratio selection
  const handleAspectRatioChange = (value: string) => {
    if (value === 'auto') {
      settings.setAutoAspectRatio(true);
    } else {
      settings.setAutoAspectRatio(false);
      settings.setManualAspectRatio(value);
    }
  };

  // Get setter function by color control key
  const getSetterByKey = (key: typeof colorControls[0]['key']) => {
    switch (key) {
      case 'brightness': return settings.setBrightness;
      case 'contrast': return settings.setContrast;
      case 'saturation': return settings.setSaturation;
      case 'hue': return settings.setHue;
      default: return () => {};
    }
  };

  // Get current value by color control key
  const getValueByKey = (key: typeof colorControls[0]['key']) => {
    switch (key) {
      case 'brightness': return settings.brightness;
      case 'contrast': return settings.contrast;
      case 'saturation': return settings.saturation;
      case 'hue': return settings.hue;
      default: return 0;
    }
  };

  return (
    <>
      {/* Aspect Ratio Selection */}
      <div>
        <div className="mb-1 font-medium">Aspect Ratio:</div>
        <div className="flex space-x-2">
          {aspectModes.map(opt => (
            <button
              key={opt.value}
              className={`px-4 py-1 rounded-full border ${
                aspectMode === opt.value
                  ? 'bg-blue-600 border-blue-600 text-white'
                  : 'bg-zinc-800 border-zinc-600 text-white/80 hover:text-white'
              } focus:outline-none transition`}
              onClick={() => handleAspectRatioChange(opt.value)}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Color Controls */}
      {colorControls.map(({ id, label, min, max, key }) => {
        const value = getValueByKey(key);
        const setter = getSetterByKey(key);
        
        return (
          <div key={id}>
            <label className="block mb-1">
              {label}: {value}
            </label>
            <input
              type="range"
              min={min}
              max={max}
              value={value}
              onChange={(e) => setter(Number(e.target.value))}
              className="w-full focus:outline-none"
            />
          </div>
        );
      })}
    </>
  );
}