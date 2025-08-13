// src/components/SettingsModal/ColorTab.tsx - Color profile and adjustment controls
import React, { useState } from 'react';
import { useSettings } from '../../context/SettingsContext';

// Base enhancement modes
const baseEnhancementModes = [
  { value: 'off', label: 'Default', isCustom: false },
  { value: 'enhanced', label: 'Enhanced', isCustom: false },
];

// Enhancement presets
const getEnhancementPreset = (mode: string, settings: any) => {
  switch (mode) {
    case 'enhanced':
      return {
        brightness: 105,
        contrast: 115,
        saturation: 112,
        hue: 0,
        sharpness: 145,
      };
    default: // 'off'
      return {
        brightness: 100,
        contrast: 100,
        saturation: 100,
        hue: 0,
        sharpness: 100,
      };
  }
};

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
  {
    id: 'sharpness',
    label: 'Sharpness',
    min: 50,
    max: 200,
    key: 'sharpness' as const,
  },
];

export function ColorTab() {
  const settings = useSettings();
  const [editingProfile, setEditingProfile] = useState<string | null>(null);
  const [tempProfileName, setTempProfileName] = useState('');

  // Apply enhancement preset to all sliders
  const applyEnhancementPreset = (mode: string) => {
    const preset = getEnhancementPreset(mode, settings);
    settings.setBrightness(preset.brightness);
    settings.setContrast(preset.contrast);
    settings.setSaturation(preset.saturation);
    settings.setHue(preset.hue);
    settings.setSharpness(preset.sharpness);
    settings.setFsrMode(mode);
  };

  // Apply custom profile
  const applyCustomProfile = (profileId: string) => {
    const profile = settings.colorProfiles.find(p => p.id === profileId);
    if (!profile) return;
    
    settings.setBrightness(profile.brightness);
    settings.setContrast(profile.contrast);
    settings.setSaturation(profile.saturation);
    settings.setHue(profile.hue);
    settings.setSharpness(profile.sharpness);
    settings.setFsrMode(profileId);
  };

  // Create new custom profile
  const createCustomProfile = () => {
    if (settings.colorProfiles.length >= 4) return; // Max 4 custom profiles
    
    const nextNumber = settings.colorProfiles.length + 1;
    const newProfile = {
      id: `custom${nextNumber}`,
      name: `Preset ${nextNumber}`,
      brightness: settings.brightness,
      contrast: settings.contrast,
      saturation: settings.saturation,
      hue: settings.hue,
      sharpness: settings.sharpness,
    };
    
    settings.setColorProfiles([...settings.colorProfiles, newProfile]);
    settings.setFsrMode(newProfile.id);
  };

  // Delete custom profile
  const deleteCustomProfile = (profileId: string) => {
    settings.setColorProfiles(settings.colorProfiles.filter(p => p.id !== profileId));
    if (settings.fsrMode === profileId) {
      settings.setFsrMode('off');
      applyEnhancementPreset('off');
    }
  };

  // Auto-save current profile when values change
  const saveCurrentProfile = () => {
    if (settings.fsrMode.startsWith('custom')) {
      const currentValues = {
        brightness: settings.brightness,
        contrast: settings.contrast,
        saturation: settings.saturation,
        hue: settings.hue,
        sharpness: settings.sharpness,
      };
      
      settings.setColorProfiles(
        settings.colorProfiles.map(p => 
          p.id === settings.fsrMode 
            ? { ...p, ...currentValues }
            : p
        )
      );
    }
  };

  // Get current value by color control key
  const getValueByKey = (key: typeof colorControls[0]['key']) => {
    switch (key) {
      case 'brightness': return settings.brightness;
      case 'contrast': return settings.contrast;
      case 'saturation': return settings.saturation;
      case 'hue': return settings.hue;
      case 'sharpness': return settings.sharpness;
      default: return 0;
    }
  };

  // Get setter function by color control key
  const getSetterByKey = (key: typeof colorControls[0]['key']) => {
    switch (key) {
      case 'brightness': return settings.setBrightness;
      case 'contrast': return settings.setContrast;
      case 'saturation': return settings.setSaturation;
      case 'hue': return settings.setHue;
      case 'sharpness': return settings.setSharpness;
      default: return () => {};
    }
  };

  // Enhanced setter that auto-saves custom profiles
  const getEnhancedSetterByKey = (key: typeof colorControls[0]['key']) => {
    const originalSetter = getSetterByKey(key);
    return (value: number) => {
      originalSetter(value);
      setTimeout(saveCurrentProfile, 100);
    };
  };

  // Profile name editing
  const startEditingProfile = (profileId: string, currentName: string) => {
    setEditingProfile(profileId);
    setTempProfileName(currentName);
  };

  const saveProfileName = () => {
    if (editingProfile && tempProfileName.trim()) {
      settings.setColorProfiles(
        settings.colorProfiles.map(p => 
          p.id === editingProfile 
            ? { ...p, name: tempProfileName.trim() }
            : p
        )
      );
    }
    setEditingProfile(null);
    setTempProfileName('');
  };

  const cancelEditingProfile = () => {
    setEditingProfile(null);
    setTempProfileName('');
  };

  // Reset current custom profile to defaults
  const resetCurrentProfile = () => {
    if (settings.fsrMode.startsWith('custom')) {
      const defaultValues = {
        brightness: 100,
        contrast: 100,
        saturation: 100,
        hue: 0,
        sharpness: 100,
      };
      
      settings.setBrightness(defaultValues.brightness);
      settings.setContrast(defaultValues.contrast);
      settings.setSaturation(defaultValues.saturation);
      settings.setHue(defaultValues.hue);
      settings.setSharpness(defaultValues.sharpness);
      
      // Also save to the profile
      settings.setColorProfiles(
        settings.colorProfiles.map(p => 
          p.id === settings.fsrMode 
            ? { ...p, ...defaultValues }
            : p
        )
      );
    }
  };

  const isCustomProfile = settings.fsrMode.startsWith('custom');
  const canCreateMore = settings.colorProfiles.length < 4;

  return (
    <>
      {/* Color Presets */}
      <div>
        <div className="mb-1">Color Presets:</div>
        <div className="flex flex-wrap gap-2">
          {/* Base profiles */}
          {baseEnhancementModes.map(mode => (
            <button
              key={mode.value}
              className={`px-3 py-1 rounded-full border text-sm ${
                settings.fsrMode === mode.value
                  ? 'bg-gradient-to-br from-blue-600 to-indigo-500 border-blue-500 text-white'
                  : 'bg-gradient-to-br from-zinc-800/50 to-zinc-700/50 border-zinc-600/50 text-white/80 hover:text-white hover:from-zinc-700/70 hover:to-zinc-600/70'
              } focus:outline-none transition-all`}
              onClick={() => applyEnhancementPreset(mode.value)}
            >
              {mode.label}
            </button>
          ))}
          
          {/* Custom profiles */}
          {settings.colorProfiles.map(profile => {
            const isActive = settings.fsrMode === profile.id;
            const isEditing = editingProfile === profile.id;
            
            if (isEditing) {
              return (
                <div key={profile.id} className="flex items-center gap-1">
                  <input
                    type="text"
                    value={tempProfileName}
                    onChange={(e) => setTempProfileName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') saveProfileName();
                      else if (e.key === 'Escape') cancelEditingProfile();
                    }}
                    onBlur={saveProfileName}
                    className="px-3 py-1 rounded-full border border-blue-500 bg-zinc-800 text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50 min-w-[80px]"
                    placeholder="Preset name..."
                    autoFocus
                  />
                </div>
              );
            }
            
            return (
              <button
                key={profile.id}
                className={`px-3 py-1 rounded-full border text-sm ${
                  isActive
                    ? 'bg-gradient-to-br from-purple-500 to-blue-600 border-purple-500 text-white'
                    : 'bg-gradient-to-br from-purple-500/20 to-blue-600/20 border-purple-500/30 text-white/80 hover:text-white hover:from-purple-500/40 hover:to-blue-600/40'
                } focus:outline-none transition-all`}
                onClick={() => applyCustomProfile(profile.id)}
                onDoubleClick={() => startEditingProfile(profile.id, profile.name)}
                title="Double-click to rename"
              >
                {profile.name}
              </button>
            );
          })}
          
        </div>
        
        {/* Info text */}
        <div className="mt-2">
          <div className="text-xs text-white/60 bg-zinc-800/50 px-3 py-2 rounded-md border border-zinc-700">
            <span className="text-white">💡</span> You can <span className="text-white">doubleclick</span> on purple <span className="text-white">presets</span> to rename them. Everything is <span className="text-white">automatically saved</span>.
          </div>
        </div>
      </div>

      {/* Color Controls */}
      <div className="space-y-2">
        {colorControls.map(({ id, label, min, max, key }) => {
          const value = getValueByKey(key);
          const setter = getEnhancedSetterByKey(key);
          
          return (
            <div key={id} className="flex items-center gap-3">
              <label className="w-20 shrink-0">{label}:</label>
              <input
                type="range"
                min={min}
                max={max}
                value={value}
                onChange={(e) => setter(Number(e.target.value))}
                disabled={settings.fsrMode === 'enhanced'}
                className={`flex-1 volume-range ${
                  settings.fsrMode === 'enhanced' ? 'opacity-50 cursor-not-allowed' : ''
                }`}
                style={{
                  ['--val' as any]: `${((value - min) / (max - min)) * 100}%`,
                }}
                onInput={(e) => {
                  const val = Number((e.target as HTMLInputElement).value);
                  const percentage = ((val - min) / (max - min)) * 100;
                  (e.target as HTMLInputElement).style.setProperty('--val', `${percentage}%`);
                }}
              />
              <span className="w-10 text-right shrink-0">{value}</span>
            </div>
          );
        })}
      </div>

    </>
  );
}

// Export functions for SettingsModal to use in footer
export function useColorTabActions() {
  const settings = useSettings();

  const createCustomProfile = () => {
    if (settings.colorProfiles.length >= 4) return;
    
    const nextNumber = settings.colorProfiles.length + 1;
    const newProfile = {
      id: `custom${nextNumber}`,
      name: `Preset ${nextNumber}`,
      brightness: settings.brightness,
      contrast: settings.contrast,
      saturation: settings.saturation,
      hue: settings.hue,
      sharpness: settings.sharpness,
    };
    
    settings.setColorProfiles([...settings.colorProfiles, newProfile]);
    settings.setFsrMode(newProfile.id);
  };

  const deleteCustomProfile = () => {
    if (!settings.fsrMode.startsWith('custom')) return;
    
    settings.setColorProfiles(settings.colorProfiles.filter(p => p.id !== settings.fsrMode));
    settings.setFsrMode('off');
    
    // Reset to default values
    const defaultValues = {
      brightness: 100,
      contrast: 100,
      saturation: 100,
      hue: 0,
      sharpness: 100,
    };
    settings.setBrightness(defaultValues.brightness);
    settings.setContrast(defaultValues.contrast);
    settings.setSaturation(defaultValues.saturation);
    settings.setHue(defaultValues.hue);
    settings.setSharpness(defaultValues.sharpness);
  };

  const resetCurrentProfile = () => {
    if (!settings.fsrMode.startsWith('custom')) return;
    
    const defaultValues = {
      brightness: 100,
      contrast: 100,
      saturation: 100,
      hue: 0,
      sharpness: 100,
    };
    
    settings.setBrightness(defaultValues.brightness);
    settings.setContrast(defaultValues.contrast);
    settings.setSaturation(defaultValues.saturation);
    settings.setHue(defaultValues.hue);
    settings.setSharpness(defaultValues.sharpness);
    
    // Also save to the profile
    settings.setColorProfiles(
      settings.colorProfiles.map(p => 
        p.id === settings.fsrMode 
          ? { ...p, ...defaultValues }
          : p
      )
    );
  };

  const resetDefaultProfile = () => {
    if (settings.fsrMode === 'off') {
      // Reset default values
      const defaultValues = {
        brightness: 100,
        contrast: 100,
        saturation: 100,
        hue: 0,
        sharpness: 100,
      };
      
      settings.setBrightness(defaultValues.brightness);
      settings.setContrast(defaultValues.contrast);
      settings.setSaturation(defaultValues.saturation);
      settings.setHue(defaultValues.hue);
      settings.setSharpness(defaultValues.sharpness);
    }
  };

  const isCustomProfile = settings.fsrMode.startsWith('custom');
  const isDefaultProfile = settings.fsrMode === 'off';
  const canCreateMore = settings.colorProfiles.length < 4;

  return {
    createCustomProfile,
    deleteCustomProfile,
    resetCurrentProfile,
    resetDefaultProfile,
    isCustomProfile,
    isDefaultProfile,
    canCreateMore
  };
}

export default ColorTab;