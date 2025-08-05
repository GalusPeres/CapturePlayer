// src/components/SettingsModal/SettingsModal.tsx - Main Container
import React, { useState, useRef, KeyboardEvent } from 'react';
import { useSettings } from '../../context/SettingsContext';
import BasicTab from './BasicTab';
import AdvancedTab from './AdvancedTab';
import AboutTab from './AboutTab';

type SignalInfo = { w: number, h: number, fps?: number } | null;

type Props = {
  visible: boolean;
  onClose(): void;
  running: boolean;
  onToggle(): void;
  onApplyDevices(videoDev: string, audioDev: string): void;
  signalInfo?: SignalInfo;
};

export default function SettingsModal({
  visible,
  onClose,
  running,
  onToggle,
  onApplyDevices,
  signalInfo,
}: Props) {
  const settings = useSettings();
  const [tab, setTab] = useState<'basic' | 'advanced' | 'about'>('basic');
  const [localVideo, setLocalVideo] = useState(settings.videoDevice);
  const [localAudio, setLocalAudio] = useState(settings.audioDevice);
  
  const basicRef = useRef<HTMLButtonElement>(null);
  const advRef = useRef<HTMLButtonElement>(null);

  const onTabKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      if (tab === 'basic') setTab('advanced');
      else if (tab === 'advanced') setTab('about');
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      if (tab === 'about') setTab('advanced');
      else if (tab === 'advanced') setTab('basic');
    }
  };

  // Footer Actions
  const applyDevices = () => onApplyDevices(localVideo, localAudio);
  const resetColors = () => {
    settings.setBrightness(100);
    settings.setContrast(100);
    settings.setSaturation(100);
    settings.setHue(0);
  };

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
          bg-zinc-900/80
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
        {/* Header */}
        <div className="flex justify-between items-center px-6 py-4 border-b border-zinc-700 no-drag relative">
          <h3 className="text-white text-lg">Settings</h3>
          <button
            onClick={onClose}
            className="p-1 no-drag text-white/80 hover:text-white focus:outline-none"
          >
            ✕
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="flex border-b border-zinc-700 no-drag" role="tablist" onKeyDown={onTabKeyDown}>
          <button
            ref={basicRef}
            role="tab"
            aria-selected={tab === 'basic'}
            onClick={() => setTab('basic')}
            className={`flex-1 py-2 text-center ${
              tab === 'basic'
                ? 'text-white border-b-2 border-blue-500'
                : 'text-white/60 hover:text-white'
            } focus:outline-none`}
          >
            Basic
          </button>
          <button
            ref={advRef}
            role="tab"
            aria-selected={tab === 'advanced'}
            onClick={() => setTab('advanced')}
            className={`flex-1 py-2 text-center ${
              tab === 'advanced'
                ? 'text-white border-b-2 border-blue-500'
                : 'text-white/60 hover:text-white'
            } focus:outline-none`}
          >
            Advanced
          </button>
          <button
            role="tab"
            aria-selected={tab === 'about'}
            onClick={() => setTab('about')}
            className={`flex-1 py-2 text-center ${
              tab === 'about'
                ? 'text-white border-b-2 border-blue-500'
                : 'text-white/60 hover:text-white'
            } focus:outline-none`}
          >
            About
          </button>
        </div>

        {/* Tab Content - Scrollable */}
        <div className="p-6 flex-1 overflow-auto text-white space-y-6 scrollbar-thin">
          {tab === 'basic' ? (
            <BasicTab
              localVideo={localVideo}
              setLocalVideo={setLocalVideo}
              localAudio={localAudio}
              setLocalAudio={setLocalAudio}
              signalInfo={signalInfo}
            />
          ) : tab === 'advanced' ? (
            <AdvancedTab />
          ) : (
            <AboutTab />
          )}
        </div>

        {/* Footer - Always Visible */}
        <div className="px-6 py-4 border-t border-zinc-700 flex justify-center space-x-4 no-drag">
          {tab === 'basic' ? (
            <>
              {hasDeviceChanges && (
                <button
                  onClick={applyDevices}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-full focus:outline-none"
                >
                  Apply Devices
                </button>
              )}
              <button
                onClick={onToggle}
                className={`px-4 py-2 ${
                  running ? 'bg-red-600 hover:bg-red-700' : 'bg-green-600 hover:bg-green-700'
                } text-white rounded-full focus:outline-none`}
              >
                {running ? 'Stop Stream' : 'Start Stream'}
              </button>
            </>
          ) : tab === 'advanced' ? (
            <button
              onClick={resetColors}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-full focus:outline-none"
            >
              Reset to Default
            </button>
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