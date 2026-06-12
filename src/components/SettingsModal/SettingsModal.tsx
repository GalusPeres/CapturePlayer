// src/components/SettingsModal/SettingsModal.tsx - Main Container
import React, { useState, useRef, KeyboardEvent, useEffect } from 'react';
import { useSettings } from '../../context/SettingsContext';
import BasicTab from './DevicesTab';
import DisplayTab, { useViewTabActions } from './ViewTab';
import ColorTab, { useColorTabActions } from './ColorTab';
import AboutTab from './AboutTab';
import playIcon from '../../assets/icons/play.png';
import stopIcon from '../../assets/icons/stop.svg';

type SignalInfo = { w: number; h: number; fps?: number } | null;

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
  onDeviceSelectionChange?: (videoDev: string, audioDev: string) => void;
  activeVideoDevice?: string;
  activeAudioDevice?: string;
  // null = centered; otherwise the modal opens at this cursor position
  // (right-click), clamped to the window edges.
  anchor?: { x: number; y: number } | null;
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
  onDeviceSelectionChange,
  activeVideoDevice = '',
  activeAudioDevice = '',
  anchor = null
}: Props) {
  const settings = useSettings();
  const [tab, setTab] = useState<'devices' | 'view' | 'color' | 'about'>('devices');
  const [localVideo, setLocalVideo] = useState(settings.videoDevice);
  const [localAudio, setLocalAudio] = useState(settings.audioDevice);

  // Update local devices when settings change
  useEffect(() => {
    setLocalVideo(settings.videoDevice);
    setLocalAudio(settings.audioDevice);
  }, [settings.videoDevice, settings.audioDevice]);

  // Notify parent about device selection changes
  useEffect(() => {
    onDeviceSelectionChange?.(localVideo, localAudio);
  }, [localVideo, localAudio, onDeviceSelectionChange]);

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
  const applyDevices = () => {
    onApplyDevices(localVideo, localAudio);
    // After applying, the settings will be updated, so local values will sync
  };

  // Compare with currently active devices in stream, not saved settings
  const hasDeviceChanges = localVideo !== activeVideoDevice || localAudio !== activeAudioDevice;
  const bothDevicesDisabled = localVideo === '' && localAudio === '';

  // Dragging the modal via its title bar; a fresh open (or a new right-click
  // anchor) discards the previously dragged position.
  const panelRef = useRef<HTMLDivElement>(null);
  const headerDragRef = useRef<{ dx: number; dy: number } | null>(null);
  const [dragPosition, setDragPosition] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    setDragPosition(null);
  }, [visible, anchor]);

  if (!visible) return null;

  // Modal placement: default sits above the HUD buttons, right-aligned with
  // the close button; a right-click anchor opens it at the cursor; dragging
  // the title bar moves it freely - always clamped inside the window.
  const MODAL_WIDTH = 384; // w-96
  const MODAL_HEIGHT = 512; // h-[32rem]
  const EDGE = 8;
  // The top 32px belong to the window drag zone - the modal stays below it
  // so window dragging and modal dragging never fight over the same pixels.
  const TOP_EDGE = 40;
  const HUD_CLEARANCE = { right: 24, bottom: 84 }; // matches the hover buttons

  const clampPosition = (x: number, y: number) => {
    // Before the first paint the panel is not measurable yet - estimate its
    // size including the max-w/max-h caps so the position does not jump once
    // the real measurements arrive.
    const rect = panelRef.current?.getBoundingClientRect();
    const width = rect?.width ?? Math.min(MODAL_WIDTH, window.innerWidth * 0.9);
    const height = rect?.height ?? Math.min(MODAL_HEIGHT, window.innerHeight * 0.9);
    return {
      x: Math.max(EDGE, Math.min(x, window.innerWidth - width - EDGE)),
      y: Math.max(TOP_EDGE, Math.min(y, window.innerHeight - height - EDGE))
    };
  };

  const onHeaderPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest('button')) return;
    const rect = panelRef.current?.getBoundingClientRect();
    if (!rect) return;
    headerDragRef.current = { dx: e.clientX - rect.left, dy: e.clientY - rect.top };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onHeaderPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!headerDragRef.current) return;
    setDragPosition(clampPosition(e.clientX - headerDragRef.current.dx, e.clientY - headerDragRef.current.dy));
  };

  const onHeaderPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    headerDragRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  const panelStyle: React.CSSProperties = dragPosition
    ? { position: 'absolute', left: dragPosition.x, top: dragPosition.y }
    : anchor
      ? (() => {
          const clamped = clampPosition(anchor.x, anchor.y);
          return { position: 'absolute', left: clamped.x, top: clamped.y };
        })()
      : (() => {
          // Sit above the HUD buttons; in small windows overlap them rather
          // than getting clipped at the top edge.
          const height =
            panelRef.current?.getBoundingClientRect().height ?? Math.min(MODAL_HEIGHT, window.innerHeight * 0.9);
          const top = Math.max(TOP_EDGE, window.innerHeight - HUD_CLEARANCE.bottom - height);
          return { position: 'absolute', right: HUD_CLEARANCE.right, top };
        })();

  return (
    <div className="fixed inset-0 z-50" onClick={onClose} style={{ pointerEvents: 'auto' }}>
      <div
        ref={panelRef}
        style={panelStyle}
        className={`
          bg-gradient-to-br from-blue-950 to-green-950
          rounded-2xl
          border border-zinc-700
          shadow-[0_0_70px_rgba(0,0,0,0.8)]
          w-96 max-w-[90vw]
          h-[32rem] max-h-[90vh]
          flex flex-col overflow-hidden
          animate-fade-in
        `}
        onClick={(e) => e.stopPropagation()}
        onContextMenu={(e) => e.stopPropagation()}
      >
        {/* Header + Tab Navigation */}
        <div className="relative">
          {/* Header - Compact */}
          <div
            className="flex justify-between items-center px-6 py-3 no-drag relative select-none cursor-pointer"
            onPointerDown={onHeaderPointerDown}
            onPointerMove={onHeaderPointerMove}
            onPointerUp={onHeaderPointerUp}
            onPointerCancel={onHeaderPointerUp}
          >
            <h3 className="text-white text-lg">Settings</h3>
            <button
              onClick={onClose}
              className="p-1 no-drag text-white/80 hover:text-white focus:outline-none transform transition-transform duration-200 ease-out hover:scale-130 cursor-pointer"
            >
              ✕
            </button>
          </div>

          {/* Tab Navigation */}
          <div className="flex relative no-drag z-10" role="tablist" onKeyDown={onTabKeyDown}>
            <button
              ref={basicRef}
              role="tab"
              aria-selected={tab === 'devices'}
              onClick={() => setTab('devices')}
              className={`flex-1 py-2 text-center border border-transparent ${
                tab === 'devices'
                  ? 'text-white relative z-10 bg-zinc-900 border-t-zinc-600/40 border-r-zinc-600/40 rounded-tr-lg'
                  : 'text-white/60 hover:text-white hover:bg-zinc-700 border-b-zinc-600/40 rounded-tr-lg'
              } focus:outline-none transition-colors`}
            >
              Devices
            </button>
            <button
              ref={advRef}
              role="tab"
              aria-selected={tab === 'view'}
              onClick={() => setTab('view')}
              className={`flex-1 py-2 text-center border border-transparent ${
                tab === 'view'
                  ? 'text-white relative z-10 bg-zinc-900 border-t-zinc-600/40 border-r-zinc-600/40 border-l-zinc-600/40'
                  : 'text-white/60 hover:text-white hover:bg-zinc-700 border-b-zinc-600/40'
              } focus:outline-none transition-colors rounded-t-lg`}
            >
              View
            </button>
            <button
              role="tab"
              aria-selected={tab === 'color'}
              onClick={() => setTab('color')}
              className={`flex-1 py-2 text-center border border-transparent ${
                tab === 'color'
                  ? 'text-white relative z-10 bg-zinc-900 border-t-zinc-600/40 border-r-zinc-600/40 border-l-zinc-600/40'
                  : 'text-white/60 hover:text-white hover:bg-zinc-700 border-b-zinc-600/40'
              } focus:outline-none transition-colors rounded-t-lg`}
            >
              Color
            </button>
            <button
              role="tab"
              aria-selected={tab === 'about'}
              onClick={() => setTab('about')}
              className={`flex-1 py-2 text-center border border-transparent ${
                tab === 'about'
                  ? 'text-white relative z-10 bg-zinc-900 border-t-zinc-600/40 border-l-zinc-600/40 rounded-tl-lg'
                  : 'text-white/60 hover:text-white hover:bg-zinc-700 border-b-zinc-600/40 rounded-tl-lg'
              } focus:outline-none transition-colors`}
            >
              About
            </button>
          </div>
        </div>

        {/* Tab Content - Expanded */}
        <div className="relative px-6 pt-5 pb-6 flex-1 overflow-auto text-white space-y-3 scrollbar-thin bg-zinc-900">
          {tab === 'devices' ? (
            <BasicTab
              localVideo={localVideo}
              setLocalVideo={setLocalVideo}
              localAudio={localAudio}
              setLocalAudio={setLocalAudio}
              signalInfo={signalInfo}
              running={running}
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
        <div className="px-6 py-4 relative flex justify-center space-x-4 no-drag bg-zinc-900">
          {/* Border line with spacing from edges */}
          <div className="absolute top-0 left-4 right-4 h-px bg-zinc-600/40" />
          {tab === 'devices' ? (
            <>
              {running && hasDeviceChanges && !bothDevicesDisabled && (
                <button
                  onClick={applyDevices}
                  className="px-4 py-2 bg-gradient-to-br from-blue-600 to-indigo-500 hover:from-blue-700 hover:to-indigo-600 border border-blue-500/30 text-white rounded-xl focus:outline-none transition-all"
                >
                  Apply
                </button>
              )}
              <button
                onClick={onToggle}
                disabled={!running && bothDevicesDisabled}
                className={`px-4 py-2 ${
                  !running && bothDevicesDisabled
                    ? 'bg-gray-600 border border-gray-500/30 text-gray-400 cursor-not-allowed'
                    : running
                      ? 'bg-gradient-to-br from-orange-500 to-red-600 hover:from-orange-600 hover:to-red-700 border border-red-500/30'
                      : 'bg-gradient-to-br from-blue-500 to-green-600 hover:from-blue-600 hover:to-green-700 border border-green-500/30'
                } text-white rounded-xl focus:outline-none flex items-center gap-2 transition-all`}
              >
                <img src={running ? stopIcon : playIcon} className="w-6 h-6" alt="" />
                {running ? 'Stop' : 'Start'}
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
              <p>
                Licensed under <span className="text-white/60">MIT License</span>
              </p>
              <p>© 2025 GalusPeres. All rights reserved.</p>
              <div className="flex justify-center space-x-4">
                <button
                  onClick={() =>
                    (window.electronAPI as any)?.openExternal?.(
                      'https://github.com/GalusPeres/CapturePlayer/blob/main/LICENSE'
                    )
                  }
                  className="text-blue-400 hover:text-blue-300 underline transition-colors"
                >
                  View License
                </button>
                <button
                  onClick={() =>
                    (window.electronAPI as any)?.openExternal?.('https://github.com/GalusPeres/CapturePlayer/issues')
                  }
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
