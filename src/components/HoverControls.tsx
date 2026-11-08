// src/components/HoverControls.tsx
// Buttons shift dynamically when the Pin button is removed in fullscreen.
// We compute right offsets in 56px steps from the right edge so spacing stays consistent.

import React, { useEffect, useRef, useState } from 'react';
import HudButton from './HudButton';

import playArrow from '../assets/icons/play.png';
import stopIcon from '../assets/icons/stop.svg';
import fullscreen from '../assets/icons/fullscreen.svg';
import settings from '../assets/icons/settings.svg';
import pinIcon from '../assets/icons/pin.svg';
import closeIcon from '../assets/icons/close.svg';

type Props = {
  running: boolean;
  onToggle(): void;
  onFullscreen(): void;
  onSettings(): void;
  onAlwaysOnTop(): void;
  onClose(): void;
  alwaysOnTop: boolean;
  visible: boolean;
  isFullscreen: boolean;
  canStart?: boolean;
  selectedVideoDevice: string;
  excludedHoverDevices: string[];
  onSelectVideoDevice(deviceId: string): void;
  deviceSelectionDisabled?: boolean;
};

const HoverControls = React.memo(function HoverControls({
  running,
  onToggle,
  onFullscreen,
  onSettings,
  onAlwaysOnTop,
  onClose,
  alwaysOnTop,
  visible,
  isFullscreen,
  canStart = true,
  selectedVideoDevice,
  excludedHoverDevices,
  onSelectVideoDevice,
  deviceSelectionDisabled = false
}: Props) {
  const [videoDevices, setVideoDevices] = useState<Array<{ deviceId: string; label: string }>>([]);
  const [deviceMenuOpen, setDeviceMenuOpen] = useState(false);
  const deviceSelectorRef = useRef<HTMLDivElement>(null);
  const animClass = visible ? 'animate-slide-up-fast' : 'animate-slide-down-fast';

  useEffect(() => {
    let active = true;

    const updateDevices = async () => {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        if (!active) return;

        setVideoDevices(
          devices
            .filter((device) => device.kind === 'videoinput' && !/^Default\b/i.test(device.label || ''))
            .map((device, index) => ({
              deviceId: device.deviceId,
              label: device.label.replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)\s*$/i, '').trim() || `Camera ${index + 1}`
            }))
        );
      } catch (error) {
        console.error('Failed to enumerate capture devices:', error);
      }
    };

    void updateDevices();
    navigator.mediaDevices.addEventListener('devicechange', updateDevices);

    return () => {
      active = false;
      navigator.mediaDevices.removeEventListener('devicechange', updateDevices);
    };
  }, []);

  useEffect(() => {
    if (!visible || deviceSelectionDisabled) setDeviceMenuOpen(false);
  }, [deviceSelectionDisabled, visible]);

  useEffect(() => {
    if (!deviceMenuOpen) return undefined;

    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!deviceSelectorRef.current?.contains(event.target as Node)) setDeviceMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDeviceMenuOpen(false);
    };

    window.addEventListener('mousedown', closeOnOutsideClick);
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      window.removeEventListener('mousedown', closeOnOutsideClick);
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [deviceMenuOpen]);

  const availableVideoDevices = videoDevices.filter((device) => !excludedHoverDevices.includes(device.deviceId));
  const selectedLabel =
    videoDevices.find((device) => device.deviceId === selectedVideoDevice)?.label ??
    (selectedVideoDevice ? 'Selected camera' : 'Select capture device');

  // 56px grid from the right: close=56, then 112, 168, 224, 280, 336, ...
  const STEP = 56;
  const rightPx = (i: number) => STEP * (i + 1); // i = zero-based index from the right

  // Right-to-left order; Pin is hidden in fullscreen, Live is shown only when running
  // order indices (from right): close(0), pin(1), settings(2), fullscreen(3), play(4), live(5)
  const order: Array<
    | { key: 'close'; show: boolean }
    | { key: 'pin'; show: boolean }
    | { key: 'settings'; show: boolean }
    | { key: 'fullscreen'; show: boolean }
    | { key: 'play'; show: boolean }
    | { key: 'live'; show: boolean }
  > = [
    { key: 'close', show: true },
    { key: 'pin', show: !isFullscreen }, // hide in fullscreen
    { key: 'settings', show: true },
    { key: 'fullscreen', show: true },
    { key: 'play', show: true },
    { key: 'live', show: running }
  ];

  const visibleOrder = order.filter((o) => o.show);
  const rightIndex = (key: (typeof order)[number]['key']) => visibleOrder.findIndex((o) => o.key === key);

  return (
    <>
      <div
        ref={deviceSelectorRef}
        className={`absolute top-5 left-1/2 z-20 -translate-x-1/2 no-drag transition-all duration-200 ${
          visible ? 'translate-y-0 opacity-100' : '-translate-y-2 opacity-0 pointer-events-none'
        }`}
        style={{ pointerEvents: visible ? 'auto' : 'none' }}
      >
        <button
          type="button"
          aria-haspopup="listbox"
          aria-expanded={deviceMenuOpen}
          disabled={deviceSelectionDisabled || availableVideoDevices.length === 0}
          onClick={() => setDeviceMenuOpen((open) => !open)}
          className="flex max-w-[min(22rem,80vw)] items-center gap-2 rounded-full border border-white/20 bg-zinc-900/90 px-4 py-2 text-sm text-white shadow-[0_8px_24px_rgba(0,0,0,0.75)] transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
          title={selectedLabel}
        >
          <svg className="h-4 w-4 shrink-0 text-white/80" viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <rect x="3" y="6" width="13" height="12" rx="2" strokeWidth="2" />
            <path d="m16 10 5-3v10l-5-3" strokeWidth="2" strokeLinejoin="round" />
          </svg>
          <span className="truncate">
            {selectedVideoDevice
              ? selectedLabel
              : availableVideoDevices.length
                ? 'Select capture device'
                : videoDevices.length
                  ? 'No devices available'
                  : 'No capture devices'}
          </span>
          <svg className="h-4 w-4 shrink-0 text-white/70" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <path d="m5 7 5 5 5-5H5z" />
          </svg>
        </button>
        {deviceMenuOpen && (
          <div
            role="listbox"
            aria-label="Capture devices"
            className="absolute left-1/2 mt-2 max-h-64 w-72 max-w-[80vw] -translate-x-1/2 overflow-y-auto rounded-xl border border-zinc-700 bg-zinc-900 py-1 text-sm shadow-xl"
          >
            {availableVideoDevices.map((device) => (
              <button
                type="button"
                role="option"
                aria-selected={device.deviceId === selectedVideoDevice}
                key={device.deviceId}
                title={device.label}
                onClick={() => {
                  onSelectVideoDevice(device.deviceId);
                  setDeviceMenuOpen(false);
                }}
                className={`block w-full truncate px-4 py-2 text-left ${
                  device.deviceId === selectedVideoDevice ? 'bg-blue-600 text-white' : 'text-zinc-200 hover:bg-zinc-700'
                }`}
              >
                {device.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Live badge follows the same grid */}
      {running && (
        <div
          className={`
            absolute bottom-6 no-drag ${animClass}
            bg-gradient-to-br from-blue-500 to-green-600
            px-4 h-12 rounded-full
            flex items-center justify-center cursor-default
            border border-green-500/70
            shadow-[0_8px_24px_rgba(0,0,0,0.75)]
          `}
          style={{
            pointerEvents: visible ? 'auto' : 'none',
            right: rightPx(rightIndex('live'))
          }}
        >
          <span className="text-white text-sm">Live</span>
        </div>
      )}

      {/* Play / Stop */}
      <HudButton
        icon={running ? stopIcon : playArrow}
        tooltip={running ? 'Stop Capture' : canStart ? 'Start Capture' : 'No devices selected'}
        onClick={onToggle}
        positionClass={`absolute bottom-6 no-drag ${animClass}`}
        style={{ right: rightPx(rightIndex('play')) }}
        visible={visible}
        variant="green"
        active={running}
        disabled={!canStart && !running}
        iconSize="large"
        key={running ? 'stop' : 'play'} // Force re-render for instant icon change
      />

      {/* Fullscreen */}
      <HudButton
        icon={fullscreen}
        tooltip={isFullscreen ? 'Exit Fullscreen' : 'Enter Fullscreen'}
        onClick={onFullscreen}
        positionClass={`absolute bottom-6 no-drag ${animClass}`}
        style={{ right: rightPx(rightIndex('fullscreen')) }}
        visible={visible}
        variant="gray"
      />

      {/* Settings */}
      <HudButton
        icon={settings}
        tooltip="Open Settings"
        onClick={onSettings}
        positionClass={`absolute bottom-6 no-drag ${animClass}`}
        style={{ right: rightPx(rightIndex('settings')) }}
        visible={visible}
        variant="gray"
      />

      {/* Always on Top — not rendered in fullscreen */}
      {!isFullscreen && (
        <HudButton
          icon={pinIcon}
          tooltip={alwaysOnTop ? 'Disable Always on Top' : 'Enable Always on Top'}
          onClick={onAlwaysOnTop}
          positionClass={`absolute bottom-6 no-drag ${animClass}`}
          style={{ right: rightPx(rightIndex('pin')) }}
          visible={visible}
          variant="blue"
          active={alwaysOnTop}
        />
      )}

      {/* Close */}
      <HudButton
        icon={closeIcon}
        tooltip="Close Application"
        onClick={onClose}
        positionClass={`absolute bottom-6 no-drag ${animClass}`}
        style={{ right: rightPx(rightIndex('close')) }}
        visible={visible}
        variant="gray"
      />
    </>
  );
});

export default HoverControls;
