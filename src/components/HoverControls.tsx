// src/components/HoverControls.tsx
// Buttons shift dynamically when the Pin button is removed in fullscreen.
// We compute right offsets in 56px steps from the right edge so spacing stays consistent.

import React from 'react';
import HudButton from './HudButton';

import playArrow  from '../assets/icons/play.png';
import stopIcon   from '../assets/icons/stop.svg';
import fullscreen from '../assets/icons/fullscreen.svg';
import settings   from '../assets/icons/settings.svg';
import pinIcon    from '../assets/icons/pin.svg';
import closeIcon  from '../assets/icons/close.svg';

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
}: Props) {
  const animClass = visible ? 'animate-slide-up-fast' : 'animate-slide-down-fast';

  // 56px grid from the right: close=56, then 112, 168, 224, 280, 336, ...
  const STEP = 56;
  const rightPx = (i: number) => STEP * (i + 1); // i = zero-based index from the right

  // Right-to-left order; Pin is hidden in fullscreen, Live is shown only when running
  // order indices (from right): close(0), pin(1), settings(2), fullscreen(3), play(4), live(5)
  const order: Array<
    | { key: 'close'     ; show: boolean }
    | { key: 'pin'       ; show: boolean }
    | { key: 'settings'  ; show: boolean }
    | { key: 'fullscreen'; show: boolean }
    | { key: 'play'      ; show: boolean }
    | { key: 'live'      ; show: boolean }
  > = [
    { key: 'close',      show: true },
    { key: 'pin',        show: !isFullscreen }, // hide in fullscreen
    { key: 'settings',   show: true },
    { key: 'fullscreen', show: true },
    { key: 'play',       show: true },
    { key: 'live',       show: running },
  ];

  const visibleOrder = order.filter(o => o.show);
  const rightIndex = (key: typeof order[number]['key']) =>
    visibleOrder.findIndex(o => o.key === key);

  return (
    <>
      {/* Live badge follows the same grid */}
      {running && (
        <div
          className={`
            absolute bottom-6 no-drag ${animClass}
            backdrop-filter backdrop-blur-[6px]
            bg-gradient-to-br from-blue-500/70 to-green-600/70
            px-4 h-12 rounded-full
            flex items-center justify-center cursor-default
            border border-green-500/70
          `}
          style={{
            pointerEvents: visible ? 'auto' : 'none',
            right: rightPx(rightIndex('live')),
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
