// src/components/SettingsModal/DisplayTab.tsx - Aspect ratio and zoom controls
import React from 'react';
import { useSettings } from '../../context/SettingsContext';

const aspectModes = [
  { value: 'auto', label: 'Auto' },
  { value: '16:9', label: '16:9' },
  { value: '4:3', label: '4:3' },
  { value: 'free', label: 'Free' },
];

type Props = {
  signalInfo?: { w: number, h: number, fps?: number } | null;
  isFullscreen?: boolean;
  fullscreenZoom?: number;
  setFullscreenZoom?: (zoom: number) => void;
};

export function DisplayTab({ signalInfo, isFullscreen = false, fullscreenZoom = 100, setFullscreenZoom = () => {} }: Props = {}) {
  const settings = useSettings();

  // Determine current aspect ratio mode
  let aspectMode: string = settings.autoAspectRatio ? 'auto' : settings.manualAspectRatio;
  if (!['auto', '16:9', '4:3', 'free'].includes(aspectMode) && 
      !aspectMode.startsWith('custom-') && 
      !settings.customRatios.some(cr => cr.id === aspectMode)) {
    aspectMode = 'auto';
  }

  // Handle aspect ratio selection
  const handleAspectRatioChange = (value: string) => {
    if (value === 'auto') {
      settings.setAutoAspectRatio(true);
    } else {
      settings.setAutoAspectRatio(false);
      settings.setManualAspectRatio(value);
    }
  };


  // Custom aspect ratio management
  const createCustomRatio = () => {
    const windowWidth = window.innerWidth;
    const windowHeight = window.innerHeight;
    if (!windowWidth || !windowHeight) return;
    
    const currentRatio = windowWidth / windowHeight;
    const newCustomRatio = {
      id: `ratio-${Date.now()}`,
      ratio: currentRatio
    };
    
    settings.setCustomRatios([...settings.customRatios, newCustomRatio]);
    // Automatically switch to the new custom ratio
    settings.setAutoAspectRatio(false);
    settings.setManualAspectRatio(newCustomRatio.id);
  };

  const deleteCustomRatio = (ratioId: string) => {
    settings.setCustomRatios(settings.customRatios.filter(cr => cr.id !== ratioId));
    // If currently selected ratio is deleted, switch to auto
    if (settings.manualAspectRatio === ratioId) {
      settings.setAutoAspectRatio(true);
    }
  };

  return (
    <>

      {/* Aspect Ratio Presets */}
      <div>
        <div className="mb-1">Aspect Ratio Presets:</div>
        <div className="flex flex-wrap gap-2">
          {aspectModes.map(opt => (
            <button
              key={opt.value}
              className={`px-3 py-1 rounded-full border text-sm ${
                aspectMode === opt.value
                  ? 'bg-gradient-to-br from-blue-600 to-indigo-500 border-blue-500 text-white'
                  : 'bg-gradient-to-br from-zinc-800/50 to-zinc-700/50 border-zinc-600/50 text-white/80 hover:text-white hover:from-zinc-700/70 hover:to-zinc-600/70'
              } focus:outline-none transition-all`}
              onClick={() => handleAspectRatioChange(opt.value)}
            >
              {opt.label}
            </button>
          ))}
          
          {/* Custom Aspect Ratio Buttons */}
          {settings.customRatios.map(customRatio => (
            <button
              key={customRatio.id}
              className={`px-3 py-1 rounded-full border text-sm ${
                aspectMode === customRatio.id
                  ? 'bg-gradient-to-br from-purple-500 to-blue-600 border-purple-500 text-white'
                  : 'bg-gradient-to-br from-purple-500/20 to-blue-600/20 border-purple-500/30 text-white/80 hover:text-white hover:from-purple-500/40 hover:to-blue-600/40'
              } focus:outline-none transition-all`}
              onClick={() => handleAspectRatioChange(customRatio.id)}
            >
              {customRatio.ratio.toFixed(2)}
            </button>
          ))}
        </div>
        
        {/* Info text */}
        <div className="mt-2">
          <div className="text-xs text-white/60 bg-zinc-800/50 px-3 py-2 rounded-md border border-zinc-700">
            <span className="text-white">💡</span> To create <span className="text-white">custom</span> aspect ratios: select <span className="text-white">"Free"</span> mode, resize window with mouse, then click <span className="text-white">"Create ..."</span> button. <span className="text-white">Presets</span> have fixed aspect ratios and can be deleted with <span className="text-white">"Delete ..."</span> button when selected.
          </div>
        </div>
      </div>

      {/* Zoom Control */}
      <div>
        <div className="flex items-center gap-3">
          <label className="w-20 shrink-0">Zoom:</label>
          <input
            type="range"
            min={50}
            max={300}
            step={5}
            value={isFullscreen ? fullscreenZoom : settings.zoomLevel}
            onChange={(e) => {
              const value = Number(e.target.value);
              if (isFullscreen) {
                setFullscreenZoom(value);
              } else {
                settings.setZoomLevel(value);
              }
            }}
            className="flex-1 volume-range"
            style={{
              ['--val' as any]: `${((isFullscreen ? fullscreenZoom : settings.zoomLevel) - 50) / (300 - 50) * 100}%`,
            }}
            onInput={(e) => {
              const val = Number((e.target as HTMLInputElement).value);
              const percentage = ((val - 50) / (300 - 50)) * 100;
              (e.target as HTMLInputElement).style.setProperty('--val', `${percentage}%`);
            }}
          />
          <span className="w-12 text-right shrink-0">{isFullscreen ? fullscreenZoom : settings.zoomLevel}%</span>
        </div>
        
        {/* Info text */}
        <div className="mt-2">
          <div className="text-xs text-white/60 bg-zinc-800/50 px-3 py-2 rounded-md border border-zinc-700">
            <span className="text-white">💡</span> Use <span className="text-white">Ctrl+Mouse Wheel</span> to zoom while streaming
          </div>
        </div>
      </div>
    </>
  );
}

// Export functions for SettingsModal to use in footer
export function useViewTabActions(isFullscreen = false, fullscreenZoom = 100, setFullscreenZoom = (z: number) => {}) {
  const settings = useSettings();

  const createCustomRatio = () => {
    // Check max limit of 4 custom ratios
    if (settings.customRatios.length >= 4) return;
    
    const windowWidth = window.innerWidth;
    const windowHeight = window.innerHeight;
    if (!windowWidth || !windowHeight) return;
    
    const currentRatio = windowWidth / windowHeight;
    const newCustomRatio = {
      id: `ratio-${Date.now()}`,
      ratio: currentRatio
    };
    
    settings.setCustomRatios([...settings.customRatios, newCustomRatio]);
    settings.setAutoAspectRatio(false);
    settings.setManualAspectRatio(newCustomRatio.id);
  };

  const deleteCustomRatio = () => {
    const currentRatio = settings.manualAspectRatio;
    if (settings.autoAspectRatio || ['16:9', '4:3', 'free'].includes(currentRatio)) return;
    
    const customRatio = settings.customRatios.find(cr => cr.id === currentRatio);
    if (!customRatio) return;
    
    settings.setCustomRatios(settings.customRatios.filter(cr => cr.id !== currentRatio));
    settings.setAutoAspectRatio(true);
  };

  const resetView = () => {
    settings.setAutoAspectRatio(true);
    if (isFullscreen) {
      setFullscreenZoom(100);
    } else {
      settings.setZoomLevel(100);
    }
  };

  const canCreateCustom = settings.manualAspectRatio === 'free' && settings.customRatios.length < 4;
  const canDeleteCustom = !settings.autoAspectRatio && 
    !['16:9', '4:3', 'free'].includes(settings.manualAspectRatio) &&
    settings.customRatios.some(cr => cr.id === settings.manualAspectRatio);

  // Get current ratio for display in create button
  const getCurrentRatio = () => {
    const windowWidth = window.innerWidth;
    const windowHeight = window.innerHeight;
    if (windowWidth && windowHeight) {
      return (windowWidth / windowHeight).toFixed(2);
    }
    return 'Current';
  };

  // Get selected custom ratio for display in delete button
  const getSelectedRatio = () => {
    if (canDeleteCustom) {
      const customRatio = settings.customRatios.find(cr => cr.id === settings.manualAspectRatio);
      return customRatio ? customRatio.ratio.toFixed(2) : '';
    }
    return '';
  };

  return {
    createCustomRatio,
    deleteCustomRatio,
    resetView,
    canCreateCustom,
    canDeleteCustom,
    getCurrentRatio,
    getSelectedRatio
  };
}

export default DisplayTab;