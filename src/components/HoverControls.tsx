// src/components/HoverControls.tsx
// Buttons shift dynamically when the Pin button is removed in fullscreen.
// We compute right offsets in 56px steps from the right edge so spacing stays consistent.

import React, { useEffect, useState } from 'react';
import HudButton from './HudButton';
import { DEVICE_ICON_OPTIONS, getDeviceColorGradient, getUniqueDeviceColors } from '../utils/deviceColors';

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
  hoverDeviceColors: Record<string, string>;
  hoverDeviceNames: Record<string, string>;
  hoverDeviceIcons: Record<string, string>;
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
  hoverDeviceColors,
  hoverDeviceNames,
  hoverDeviceIcons,
  onSelectVideoDevice,
  deviceSelectionDisabled = false
}: Props) {
  const [videoDevices, setVideoDevices] = useState<Array<{ deviceId: string; label: string }>>([]);
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

  const availableVideoDevices = videoDevices.filter((device) => !excludedHoverDevices.includes(device.deviceId));
  const deviceColors = getUniqueDeviceColors(
    videoDevices.map((device) => device.deviceId),
    hoverDeviceColors
  );

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
        role="group"
        aria-label="Capture devices"
        className={`absolute top-5 left-1/2 z-20 flex max-w-[min(90vw,48rem)] -translate-x-1/2 flex-wrap justify-center gap-2 no-drag transition-all duration-200 ${
          visible ? 'translate-y-0 opacity-100' : '-translate-y-2 opacity-0 pointer-events-none'
        }`}
        style={{ pointerEvents: visible ? 'auto' : 'none' }}
      >
        {availableVideoDevices.map((device) => {
          const icon = DEVICE_ICON_OPTIONS.find((option) => option.value === hoverDeviceIcons[device.deviceId]);
          const label = hoverDeviceNames[device.deviceId]?.trim() || device.label;

          return (
            <button
              type="button"
              aria-pressed={device.deviceId === selectedVideoDevice}
              key={device.deviceId}
              title={label}
              disabled={deviceSelectionDisabled}
              onClick={() => onSelectVideoDevice(device.deviceId)}
              style={{ backgroundImage: getDeviceColorGradient(deviceColors[device.deviceId]) }}
              className={`max-w-[min(18rem,80vw)] truncate rounded-full border border-white/30 px-4 py-2 text-sm text-white shadow-[0_8px_24px_rgba(0,0,0,0.75)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60 ${
                device.deviceId === selectedVideoDevice ? 'ring-2 ring-white ring-offset-2 ring-offset-black/50' : ''
              }`}
            >
              {icon?.icon ?? DEVICE_ICON_OPTIONS[0].icon} {label}
            </button>
          );
        })}
        {availableVideoDevices.length === 0 && videoDevices.length === 0 && (
          <span className="rounded-full border border-white/20 bg-zinc-900/90 px-4 py-2 text-sm text-white/70 shadow-lg">
            No capture devices
          </span>
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
