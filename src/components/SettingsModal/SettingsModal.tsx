// src/components/SettingsModal/SettingsModal.tsx - Main Container
import React, { useState, useRef, KeyboardEvent } from 'react';
import { useSettings } from '../../context/SettingsContext';
import BasicTab from './DevicesTab';
import DisplayTab, { useViewTabActions } from './ViewTab';
import ColorTab, { useColorTabActions } from './ColorTab';
import AboutTab from './AboutTab';
import playIcon from '../../assets/icons/play.png';
import stopIcon from '../../assets/icons/stop.svg';

type SignalInfo = { w: number, h: number, fps?: number } | null;

type Props = {
  visible: boolean;
  onClose(): void;
  running: boolean;
  onToggle(): void;
  onApplyDevices(videoDev: string, audioDev: string): void;
  signalInfo?: SignalInfo;
  isFullscreen?: boolean;
  fullscreenZoom?: number;
  setFullscreenZoom?: (zoom: number) => void;
};

export default function SettingsModal({
  visible,
  onClose,
  running,
  onToggle,
  onApplyDevices,
  signalInfo,
  isFullscreen = false,
  fullscreenZoom = 100,
  setFullscreenZoom = () => {},
}: Props) {
  const settings = useSettings();
  const [tab, setTab] = useState<'devices' | 'view' | 'color' | 'about'>('devices');
  const [localVideo, setLocalVideo] = useState(settings.videoDevice);
  const [localAudio, setLocalAudio] = useState(settings.audioDevice);
  
  const colorActions = useColorTabActions();
  const viewActions = useViewTabActions(isFullscreen, fullscreenZoom, setFullscreenZoom);
  
  const basicRef = useRef<HTMLButtonElement>(null);
  const advRef = useRef<HTMLButtonElement>(null);

  const onTabKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      if (tab === 'devices') setTab('view');
      else if (tab === 'view') setTab('color');
      else if (tab === 'color') setTab('about');
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      if (tab === 'about') setTab('color');
      else if (tab === 'color') setTab('view');
      else if (tab === 'view') setTab('devices');
    }
  };

  // Footer Actions
  const applyDevices = () => onApplyDevices(localVideo, localAudio);



  const hasDeviceChanges = localVideo !== settings.videoDevice || localAudio !== settings.audioDevice;

  if (!visible) return null;

  return (
    <div 
      className={`fixed inset-0 flex items-center justify-center z-50`} 
      onClick={onClose} 
      style={{ pointerEvents: 'auto' }}
    >
      <div
        className={`
          bg-gradient-to-br from-blue-900/30 to-indigo-900/30
          backdrop-blur-xl
          rounded-2xl
          border border-zinc-700
          shadow-[0_0_70px_rgba(0,0,0,0.8)]
          w-96 max-w-[90vw]
          h-[32rem] max-h-[90vh]
          flex flex-col overflow-hidden
          animate-fade-in
        `}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header + Tab Navigation */}
        <div className="relative">
          {/* Active tab overlay - darker background */}
          {tab === 'devices' && (
            <div className="absolute bottom-0 left-0 w-1/4 h-10 bg-zinc-900/75 rounded-tr-lg"></div>
          )}
          {tab === 'view' && (
            <div className="absolute bottom-0 left-1/4 w-1/4 h-10 bg-zinc-900/75 rounded-t-lg"></div>
          )}
          {tab === 'color' && (
            <div className="absolute bottom-0 left-1/2 w-1/4 h-10 bg-zinc-900/75 rounded-t-lg"></div>
          )}
          {tab === 'about' && (
            <div className="absolute bottom-0 left-3/4 w-1/4 h-10 bg-zinc-900/75 rounded-tl-lg"></div>
          )}
          {/* Header - Compact */}
          <div className="flex justify-between items-center px-6 py-3 no-drag relative">
            <h3 className="text-white text-lg">Settings</h3>
            <button
              onClick={onClose}
              className="p-1 no-drag text-white/80 hover:text-white focus:outline-none transform transition-transform duration-200 ease-out hover:scale-130 cursor-pointer"
            >
              ✕
            </button>
          </div>

          {/* Tab Navigation */}
          <div className="flex relative no-drag" role="tablist" onKeyDown={onTabKeyDown}>
          {/* Line segments - everywhere except under active tab */}
          {tab !== 'devices' && (
            <div className="absolute bottom-0 left-0 w-1/4 h-px bg-zinc-600/40"></div>
          )}
          {tab !== 'view' && (
            <div className="absolute bottom-0 left-1/4 w-1/4 h-px bg-zinc-600/40"></div>
          )}
          {tab !== 'color' && (
            <div className="absolute bottom-0 left-1/2 w-1/4 h-px bg-zinc-600/40"></div>
          )}
          {tab !== 'about' && (
            <div className="absolute bottom-0 left-3/4 w-1/4 h-px bg-zinc-600/40"></div>
          )}
          
          
          {/* Border frames for active tab */}
          {tab === 'devices' && (
            <div className="absolute top-0 left-0 w-1/4 h-full border-t border-r border-zinc-600/40 rounded-tr-lg"></div>
          )}
          {tab === 'view' && (
            <div className="absolute top-0 left-1/4 w-1/4 h-full border-t border-l border-r border-zinc-600/40 rounded-t-lg"></div>
          )}
          {tab === 'color' && (
            <div className="absolute top-0 left-1/2 w-1/4 h-full border-t border-l border-r border-zinc-600/40 rounded-t-lg"></div>
          )}
          {tab === 'about' && (
            <div className="absolute top-0 left-3/4 w-1/4 h-full border-t border-l border-zinc-600/40 rounded-tl-lg"></div>
          )}
          <button
            ref={basicRef}
            role="tab"
            aria-selected={tab === 'devices'}
            onClick={() => setTab('devices')}
            className={`flex-1 py-2 text-center ${
              tab === 'devices'
                ? 'text-white relative z-10 rounded-tr-lg'
                : 'text-white/60 hover:text-white hover:bg-zinc-700/20 rounded-tr-lg'
            } focus:outline-none transition-all`}
          >
            Devices
          </button>
          <button
            ref={advRef}
            role="tab"
            aria-selected={tab === 'view'}
            onClick={() => setTab('view')}
            className={`flex-1 py-2 text-center ${
              tab === 'view'
                ? 'text-white relative z-10'
                : 'text-white/60 hover:text-white hover:bg-zinc-700/20'
            } focus:outline-none transition-all rounded-t-lg`}
          >
            View
          </button>
          <button
            role="tab"
            aria-selected={tab === 'color'}
            onClick={() => setTab('color')}
            className={`flex-1 py-2 text-center ${
              tab === 'color'
                ? 'text-white relative z-10'
                : 'text-white/60 hover:text-white hover:bg-zinc-700/20'
            } focus:outline-none transition-all rounded-t-lg`}
          >
            Color
          </button>
          <button
            role="tab"
            aria-selected={tab === 'about'}
            onClick={() => setTab('about')}
            className={`flex-1 py-2 text-center ${
              tab === 'about'
                ? 'text-white relative z-10 rounded-tl-lg'
                : 'text-white/60 hover:text-white hover:bg-zinc-700/20 rounded-tl-lg'
            } focus:outline-none transition-all`}
          >
            About
          </button>
          </div>
        </div>

        {/* Tab Content - Expanded */}
        <div className="p-6 flex-1 overflow-auto text-white space-y-5 scrollbar-thin bg-zinc-900/75">
          {tab === 'devices' ? (
            <BasicTab
              localVideo={localVideo}
              setLocalVideo={setLocalVideo}
              localAudio={localAudio}
              setLocalAudio={setLocalAudio}
              signalInfo={signalInfo}
            />
          ) : tab === 'view' ? (
            <DisplayTab 
              signalInfo={signalInfo} 
              isFullscreen={isFullscreen}
              fullscreenZoom={fullscreenZoom}
              setFullscreenZoom={setFullscreenZoom}
            />
          ) : tab === 'color' ? (
            <ColorTab />
          ) : (
            <AboutTab />
          )}
        </div>

        {/* Footer - Always Visible */}
        <div className="px-6 py-4 relative flex justify-center space-x-4 no-drag bg-zinc-900/75">
          {/* Border line with spacing from edges */}
          <div className="absolute top-0 left-4 right-4 h-px bg-zinc-600/40"></div>
          {tab === 'devices' ? (
            <>
              {hasDeviceChanges && (
                <button
                  onClick={applyDevices}
                  className="px-4 py-2 bg-gradient-to-br from-blue-600 to-indigo-500 hover:from-blue-700 hover:to-indigo-600 border border-blue-500/30 text-white rounded-xl focus:outline-none transition-all"
                >
                  Apply Devices
                </button>
              )}
              <button
                onClick={onToggle}
                className={`px-4 py-2 ${
                  running 
                    ? 'bg-gradient-to-br from-orange-500 to-red-600 hover:from-orange-600 hover:to-red-700 border border-red-500/30' 
                    : 'bg-gradient-to-br from-blue-500 to-green-600 hover:from-blue-600 hover:to-green-700 border border-green-500/30'
                } text-white rounded-xl focus:outline-none flex items-center gap-2 transition-all`}
              >
                <img 
                  src={running ? stopIcon : playIcon} 
                  className="w-6 h-6" 
                  alt="" 
                />
                {running ? 'Stop Capture' : 'Start Capture'}
              </button>
            </>
          ) : tab === 'view' ? (
            <div className="flex gap-2">
              {viewActions.canCreateCustom && (
                <button
                  onClick={viewActions.createCustomRatio}
                  className="px-4 py-2 bg-gradient-to-br from-purple-500/60 to-blue-600/60 hover:from-purple-500/40 hover:to-blue-600/40 border border-purple-500/50 hover:border-purple-500/70 text-white rounded-xl focus:outline-none transition-all"
                >
                  Create {viewActions.getCurrentRatio()}
                </button>
              )}
              <button
                onClick={viewActions.resetView}
                className="px-4 py-2 bg-gradient-to-br from-blue-600 to-indigo-500 hover:from-blue-700 hover:to-indigo-600 border border-blue-500/30 text-white rounded-xl focus:outline-none transition-all"
              >
                Reset
              </button>
              {viewActions.canDeleteCustom && (
                <button
                  onClick={viewActions.deleteCustomRatio}
                  className="px-4 py-2 bg-gradient-to-br from-orange-500 to-red-600 hover:from-orange-600 hover:to-red-700 border border-red-500/30 text-white rounded-xl focus:outline-none transition-all"
                >
                  Delete {viewActions.getSelectedRatio()}
                </button>
              )}
            </div>
          ) : tab === 'color' ? (
            colorActions.isCustomProfile ? (
              <div className="flex gap-2">
                {colorActions.canCreateMore && (
                  <button
                    onClick={colorActions.createCustomProfile}
                    className="px-4 py-2 bg-gradient-to-br from-purple-500/60 to-blue-600/60 hover:from-purple-500/40 hover:to-blue-600/40 border border-purple-500/50 hover:border-purple-500/70 text-white rounded-xl focus:outline-none transition-all"
                  >
                    Create Preset
                  </button>
                )}
                <button
                  onClick={colorActions.resetCurrentProfile}
                  className="px-4 py-2 bg-gradient-to-br from-blue-600 to-indigo-500 hover:from-blue-700 hover:to-indigo-600 border border-blue-500/30 text-white rounded-xl focus:outline-none transition-all"
                >
                  Reset
                </button>
                <button
                  onClick={colorActions.deleteCustomProfile}
                  className="px-4 py-2 bg-gradient-to-br from-orange-500 to-red-600 hover:from-orange-600 hover:to-red-700 border border-red-500/30 text-white rounded-xl focus:outline-none transition-all"
                >
                  Delete
                </button>
              </div>
            ) : colorActions.isDefaultProfile ? (
              <div className="flex gap-2">
                {colorActions.canCreateMore && (
                  <button
                    onClick={colorActions.createCustomProfile}
                    className="px-4 py-2 bg-gradient-to-br from-purple-500/60 to-blue-600/60 hover:from-purple-500/40 hover:to-blue-600/40 border border-purple-500/50 hover:border-purple-500/70 text-white rounded-xl focus:outline-none transition-all"
                  >
                    Create Preset
                  </button>
                )}
                <button
                  onClick={colorActions.resetDefaultProfile}
                  className="px-4 py-2 bg-gradient-to-br from-blue-600 to-indigo-500 hover:from-blue-700 hover:to-indigo-600 border border-blue-500/30 text-white rounded-xl focus:outline-none transition-all"
                >
                  Reset
                </button>
              </div>
            ) : (
              colorActions.canCreateMore && (
                <button
                  onClick={colorActions.createCustomProfile}
                  className="px-4 py-2 bg-gradient-to-br from-purple-500/60 to-blue-600/60 hover:from-purple-500/40 hover:to-blue-600/40 border border-purple-500/50 hover:border-purple-500/70 text-white rounded-xl focus:outline-none transition-all"
                >
                  Create Preset
                </button>
              )
            )
          ) : (
            <div className="text-center text-white/40 text-xs space-y-2">
              <p>Licensed under <span className="text-white/60">MIT License</span></p>
              <p>© 2025 GalusPeres. All rights reserved.</p>
              <div className="flex justify-center space-x-4">
                <button
                  onClick={() => (window.electronAPI as any)?.openExternal?.('https://github.com/GalusPeres/CapturePlayer/blob/main/LICENSE')}
                  className="text-blue-400 hover:text-blue-300 underline transition-colors"
                >
                  View License
                </button>
                <button
                  onClick={() => (window.electronAPI as any)?.openExternal?.('https://github.com/GalusPeres/CapturePlayer/issues')}
                  className="text-blue-400 hover:text-blue-300 underline transition-colors"
                >
                  Report Bug
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}