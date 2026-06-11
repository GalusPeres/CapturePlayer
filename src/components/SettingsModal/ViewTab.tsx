// src/components/SettingsModal/DisplayTab.tsx - Aspect ratio and zoom controls
import React, { useEffect, useState } from 'react';
import { useSettings } from '../../context/SettingsContext';
import InfoHint from './InfoHint';

const aspectModes = [
  { value: 'auto', label: 'Auto' },
  { value: '16:9', label: '16:9' },
  { value: '4:3', label: '4:3' },
  { value: 'free', label: 'Free' }
];

type Props = {
  signalInfo?: { w: number; h: number; fps?: number } | null;
  isFullscreen?: boolean;
  fullscreenZoom?: number;
  setFullscreenZoom?: (zoom: number) => void;
};

export function DisplayTab({
  signalInfo,
  isFullscreen = false,
  fullscreenZoom = 100,
  setFullscreenZoom = () => {}
}: Props = {}) {
  const settings = useSettings();
  const isDev = import.meta.env.DEV;

  // VSync launch flag. Lives in the main process (launch settings), not in
  // localStorage, because it must be applied before the app starts.
  // vsyncDisabled true = app starts with 'disable-gpu-vsync'.
  const [vsyncDisabled, setVsyncDisabled] = useState(false);
  const [vsyncDisabledActive, setVsyncDisabledActive] = useState(false);
  const [devRestartHint, setDevRestartHint] = useState(false);

  useEffect(() => {
    const readVsyncState = () => {
      window.electronAPI.getDisableGpuVsync?.().then((state) => {
        setVsyncDisabled(state.enabled);
        setVsyncDisabledActive(state.active);
      });
    };

    readVsyncState();
    // Re-read when the footer Reset button restores the vsync default.
    window.addEventListener('captureplayer:vsync-changed', readVsyncState);
    return () => window.removeEventListener('captureplayer:vsync-changed', readVsyncState);
  }, []);

  const toggleVsync = () => {
    const next = !vsyncDisabled;
    setVsyncDisabled(next);
    void window.electronAPI.setDisableGpuVsync?.(next);
  };

  const vsyncOn = !vsyncDisabled;
  const vsyncNeedsRestart = vsyncDisabled !== vsyncDisabledActive;

  // Determine current aspect ratio mode
  let aspectMode: string = settings.autoAspectRatio ? 'auto' : settings.manualAspectRatio;
  if (
    !['auto', '16:9', '4:3', 'free'].includes(aspectMode) &&
    !aspectMode.startsWith('custom-') &&
    !settings.customRatios.some((cr) => cr.id === aspectMode)
  ) {
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
    settings.setCustomRatios(settings.customRatios.filter((cr) => cr.id !== ratioId));
    // If currently selected ratio is deleted, switch to auto
    if (settings.manualAspectRatio === ratioId) {
      settings.setAutoAspectRatio(true);
    }
  };

  return (
    <>
      {/* Aspect Ratio Presets */}
      <div>
        <div className="mb-1">
          <InfoHint
            info={
              <>
                Custom ratio: pick <span className="text-white">"Free"</span>, resize the window, then click{' '}
                <span className="text-white">"Create ..."</span>
              </>
            }
          >
            <span className="cursor-help">Aspect Ratio Presets:</span>
          </InfoHint>
        </div>
        <div className="flex flex-wrap gap-2">
          {aspectModes.map((opt) => (
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
          {settings.customRatios.map((customRatio) => (
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
      </div>

      {/* Zoom Control */}
      <div>
        <div className="flex items-center gap-3">
          <InfoHint
            info={
              <>
                <span className="text-white">Ctrl + Mouse Wheel</span> zooms anytime
              </>
            }
          >
            <label className="shrink-0 cursor-help">Zoom:</label>
          </InfoHint>
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
              ['--val' as any]: `${(((isFullscreen ? fullscreenZoom : settings.zoomLevel) - 50) / (300 - 50)) * 100}%`
            }}
            onInput={(e) => {
              const val = Number((e.target as HTMLInputElement).value);
              const percentage = ((val - 50) / (300 - 50)) * 100;
              (e.target as HTMLInputElement).style.setProperty('--val', `${percentage}%`);
            }}
          />
          <span className="w-12 text-right shrink-0">{isFullscreen ? fullscreenZoom : settings.zoomLevel}%</span>
        </div>
      </div>

      {/* Advanced */}
      <div>
        <div className="mb-1">Advanced:</div>
        <div className="flex flex-col gap-2">
          {/* Low-latency renderer */}
          <div className="flex items-center gap-3">
            <button
              onClick={() => settings.setLowLatencyRenderer(!settings.lowLatencyRenderer)}
              className={`
                w-6 h-6 rounded-md border-2 flex items-center justify-center transition-all
                ${
                  settings.lowLatencyRenderer
                    ? 'bg-gradient-to-br from-blue-600 to-indigo-500 border-blue-500'
                    : 'bg-gradient-to-br from-zinc-800/50 to-zinc-700/50 border-zinc-600/50 hover:from-zinc-700/70 hover:to-zinc-600/70 hover:border-zinc-500/70'
                }
                focus:outline-none focus:ring-2 focus:ring-blue-500/50
              `}
            >
              {settings.lowLatencyRenderer && (
                <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                </svg>
              )}
            </button>
            <InfoHint
              info={
                <>
                  Alternative video renderer. Can reduce input lag on 60 Hz displays with VSync on. Turn off if you see
                  glitches.
                </>
              }
            >
              <span
                onClick={() => settings.setLowLatencyRenderer(!settings.lowLatencyRenderer)}
                className="text-sm text-white/90 cursor-pointer select-none"
              >
                WebGL renderer (experimental)
              </span>
            </InfoHint>
          </div>

          {/* VSync (launch flag, needs restart) */}
          <div className="flex items-center gap-3">
            <button
              onClick={toggleVsync}
              className={`
                w-6 h-6 rounded-md border-2 flex items-center justify-center transition-all
                ${
                  vsyncOn
                    ? 'bg-gradient-to-br from-blue-600 to-indigo-500 border-blue-500'
                    : 'bg-gradient-to-br from-zinc-800/50 to-zinc-700/50 border-zinc-600/50 hover:from-zinc-700/70 hover:to-zinc-600/70 hover:border-zinc-500/70'
                }
                focus:outline-none focus:ring-2 focus:ring-blue-500/50
              `}
            >
              {vsyncOn && (
                <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                </svg>
              )}
            </button>
            <InfoHint
              info={
                <>
                  <span className="block whitespace-nowrap">
                    <span className="text-white">On:</span> no tearing, best for 60 Hz
                  </span>
                  <span className="block whitespace-nowrap">
                    <span className="text-white">Off:</span> less input lag, for high-refresh/G-Sync
                  </span>
                </>
              }
            >
              <span onClick={toggleVsync} className="text-sm text-white/90 cursor-pointer select-none">
                VSync
              </span>
            </InfoHint>
          </div>

          {vsyncNeedsRestart && (
            <div className="flex items-center justify-between gap-3 text-xs bg-amber-900/30 border border-amber-700/40 text-amber-200/90 px-3 py-2 rounded-md">
              <span>
                {devRestartHint
                  ? 'Dev mode: restart npm run dev manually.'
                  : `Restart required to turn VSync ${vsyncOn ? 'on' : 'off'}.`}
              </span>
              {/* Self-relaunch only works in the packaged app; in dev the Vite
                  server dies with the process, so the click swaps to a hint. */}
              {!devRestartHint && (
                <button
                  onClick={async () => {
                    const ok = await window.electronAPI.relaunchApp?.();
                    if (ok === false) setDevRestartHint(true);
                  }}
                  className="shrink-0 px-3 py-1 rounded-md bg-gradient-to-br from-blue-600 to-indigo-500 hover:from-blue-700 hover:to-indigo-600 border border-blue-500/30 text-white focus:outline-none transition-all"
                >
                  Restart now
                </button>
              )}
            </div>
          )}

          {/* Diagnostics overlay (dev only) */}
          {isDev && (
            <div className="flex items-center gap-3">
              <button
                onClick={() => settings.setShowDiagnosticsOverlay(!settings.showDiagnosticsOverlay)}
                className={`
                  w-6 h-6 rounded-md border-2 flex items-center justify-center transition-all
                  ${
                    settings.showDiagnosticsOverlay
                      ? 'bg-gradient-to-br from-blue-600 to-indigo-500 border-blue-500'
                      : 'bg-gradient-to-br from-zinc-800/50 to-zinc-700/50 border-zinc-600/50 hover:from-zinc-700/70 hover:to-zinc-600/70 hover:border-zinc-500/70'
                  }
                  focus:outline-none focus:ring-2 focus:ring-blue-500/50
                `}
              >
                {settings.showDiagnosticsOverlay && (
                  <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </button>
              <span
                onClick={() => settings.setShowDiagnosticsOverlay(!settings.showDiagnosticsOverlay)}
                className="text-sm text-white/90 cursor-pointer select-none"
              >
                Show diagnostics overlay
              </span>
            </div>
          )}
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

    const customRatio = settings.customRatios.find((cr) => cr.id === currentRatio);
    if (!customRatio) return;

    settings.setCustomRatios(settings.customRatios.filter((cr) => cr.id !== currentRatio));
    settings.setAutoAspectRatio(true);
  };

  const resetView = () => {
    settings.setAutoAspectRatio(true);
    if (isFullscreen) {
      setFullscreenZoom(100);
    } else {
      settings.setZoomLevel(100);
    }
    // Advanced section defaults
    settings.setLowLatencyRenderer(false);
    settings.setShowDiagnosticsOverlay(false);
    void window.electronAPI.setDisableGpuVsync?.(false);
    // The vsync checkbox holds local state inside DisplayTab - tell it to re-read.
    window.dispatchEvent(new Event('captureplayer:vsync-changed'));
  };

  const canCreateCustom =
    !settings.autoAspectRatio && settings.manualAspectRatio === 'free' && settings.customRatios.length < 4;
  const canDeleteCustom =
    !settings.autoAspectRatio &&
    !['16:9', '4:3', 'free'].includes(settings.manualAspectRatio) &&
    settings.customRatios.some((cr) => cr.id === settings.manualAspectRatio);

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
      const customRatio = settings.customRatios.find((cr) => cr.id === settings.manualAspectRatio);
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
