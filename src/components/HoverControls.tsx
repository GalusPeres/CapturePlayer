// src/components/HoverControls.tsx - Hover control buttons with fullscreen always-on-top disabled
import React, { useState, useRef } from 'react';
import { GlassTooltip } from './GlassTooltip';

import playArrow  from '../assets/icons/play_arrow.svg';
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
};

export default function HoverControls({
  running,
  onToggle,
  onFullscreen,
  onSettings,
  onAlwaysOnTop,
  onClose,
  alwaysOnTop,
  visible,
  isFullscreen,
}: Props) {
  const animClass = visible
    ? 'animate-slide-up-fast'
    : 'animate-slide-down-fast';

  const btnInner = `
    w-full h-full flex items-center justify-center
    focus:outline-none transform transition-transform
    duration-200 ease-out hover:scale-130 cursor-pointer
  `;

  // Disabled button style for fullscreen mode
  const btnInnerDisabled = `
    w-full h-full flex items-center justify-center
    opacity-40 cursor-not-allowed
  `;

  const [tipPlay, setTipPlay]         = useState(false);
  const [tipFs, setTipFs]             = useState(false);
  const [tipSettings, setTipSettings] = useState(false);
  const [tipPin, setTipPin]           = useState(false);
  const [tipClose, setTipClose]       = useState(false);

  // Timeout refs for delayed tooltips
  const playTimeoutRef     = useRef<number>();
  const fsTimeoutRef       = useRef<number>();
  const settingsTimeoutRef = useRef<number>();
  const pinTimeoutRef      = useRef<number>();
  const closeTimeoutRef    = useRef<number>();

  const playRef     = useRef<HTMLDivElement>(null);
  const fsRef       = useRef<HTMLDivElement>(null);
  const settingsRef = useRef<HTMLDivElement>(null);
  const pinRef      = useRef<HTMLDivElement>(null);
  const closeRef    = useRef<HTMLDivElement>(null);

  // Helper functions for delayed tooltips
  const showTooltipDelayed = (setter: (show: boolean) => void, timeoutRef: React.MutableRefObject<number | undefined>) => {
    clearTimeout(timeoutRef.current);
    timeoutRef.current = window.setTimeout(() => setter(true), 700);
  };

  const hideTooltipImmediate = (setter: (show: boolean) => void, timeoutRef: React.MutableRefObject<number | undefined>) => {
    clearTimeout(timeoutRef.current);
    setter(false);
  };

  // Always-on-Top handler with fullscreen check
  const handleAlwaysOnTopClick = () => {
    if (isFullscreen) return; // Block in fullscreen
    onAlwaysOnTop();
  };

  // Tooltip position: bottom-6 (24px) + h-12 (48px) + 4px spacing = 76px
  const tooltipPos = 'bottom-[76px]';

  return (
    <>
      {/* LIVE Badge */}
      {running && (
        <div
          className={`
            group
            absolute bottom-6 right-[336px] no-drag ${animClass}
            backdrop-filter backdrop-blur-[6px]
            bg-green-600/70
            px-4 h-12 rounded-full
            flex items-center justify-center cursor-default
            border border-green-500/70
          `}
          style={{ pointerEvents: visible ? 'auto' : 'none' }}
        >
          <span className="text-white text-sm">Live</span>
        </div>
      )}

      {/* Play/Stop Button */}
      <div
        ref={playRef}
        onMouseEnter={() => showTooltipDelayed(setTipPlay, playTimeoutRef)}
        onMouseLeave={() => hideTooltipImmediate(setTipPlay, playTimeoutRef)}
        onClick={onToggle}
        className={`
          absolute bottom-6 right-[280px] no-drag ${animClass}
          backdrop-filter backdrop-blur-[6px]
          ${running
            ? 'bg-red-600/70 hover:bg-red-600/80 border border-red-500/30'
            : 'bg-green-700/70 hover:bg-green-700/80 border border-green-600/30'}
          w-12 h-12 rounded-full flex items-center justify-center cursor-pointer
        `}
        style={{ pointerEvents: visible ? 'auto' : 'none' }}
      >
        <button className={btnInner}>
          <img src={running ? stopIcon : playArrow} className="w-6 h-6" />
        </button>
      </div>
      <GlassTooltip
        visible={tipPlay && visible}
        animClass={`${animClass} right-[calc(280px-22px)] ${tooltipPos}`}
      >
        {running ? 'Stop Capture' : 'Start Capture'}
      </GlassTooltip>

      {/* Fullscreen Button */}
      <div
        ref={fsRef}
        onMouseEnter={() => showTooltipDelayed(setTipFs, fsTimeoutRef)}
        onMouseLeave={() => hideTooltipImmediate(setTipFs, fsTimeoutRef)}
        onClick={onFullscreen}
        className={`
          absolute bottom-6 right-[224px] no-drag ${animClass}
          backdrop-filter backdrop-blur-[6px]
          bg-zinc-800/50 hover:bg-zinc-800/60 border border-zinc-700/30
          w-12 h-12 rounded-full flex items-center justify-center cursor-pointer
        `}
        style={{ pointerEvents: visible ? 'auto' : 'none' }}
      >
        <button className={btnInner}>
          <img src={fullscreen} className="w-6 h-6" />
        </button>
      </div>
      <GlassTooltip
        visible={tipFs && visible}
        animClass={`${animClass} right-[calc(224px-35px)] ${tooltipPos}`}
      >
        {isFullscreen ? 'Exit Fullscreen' : 'Enter Fullscreen'}
      </GlassTooltip>

      {/* Settings Button */}
      <div
        ref={settingsRef}
        onMouseEnter={() => showTooltipDelayed(setTipSettings, settingsTimeoutRef)}
        onMouseLeave={() => hideTooltipImmediate(setTipSettings, settingsTimeoutRef)}
        onClick={onSettings}
        className={`
          absolute bottom-6 right-[168px] no-drag ${animClass}
          backdrop-filter backdrop-blur-[6px]
          bg-zinc-800/50 hover:bg-zinc-800/60 border border-zinc-700/30
          w-12 h-12 rounded-full flex items-center justify-center cursor-pointer
        `}
        style={{ pointerEvents: visible ? 'auto' : 'none' }}
      >
        <button className={btnInner}>
          <img src={settings} className="w-6 h-6" />
        </button>
      </div>
      <GlassTooltip
        visible={tipSettings && visible}
        animClass={`${animClass} right-[calc(168px-25px)] ${tooltipPos}`}
      >
        Open Settings
      </GlassTooltip>

      {/* Always on Top Button - With fullscreen logic */}
      <div
        ref={pinRef}
        onMouseEnter={() => !isFullscreen && showTooltipDelayed(setTipPin, pinTimeoutRef)}
        onMouseLeave={() => hideTooltipImmediate(setTipPin, pinTimeoutRef)}
        onClick={handleAlwaysOnTopClick}
        className={`
          absolute bottom-6 right-[112px] no-drag ${animClass}
          backdrop-filter backdrop-blur-[6px]
          ${isFullscreen 
            ? 'bg-zinc-900/50 border border-zinc-800/30' // Disabled style
            : alwaysOnTop
              ? 'bg-blue-700/70 hover:bg-blue-700/80 border border-blue-600/30'
              : 'bg-zinc-800/50 hover:bg-zinc-800/60 border border-zinc-700/30'
          }
          w-12 h-12 rounded-full flex items-center justify-center
          ${isFullscreen ? 'cursor-not-allowed' : 'cursor-pointer'}
        `}
        style={{ pointerEvents: visible ? 'auto' : 'none' }}
      >
        <button className={isFullscreen ? btnInnerDisabled : btnInner}>
          <img src={pinIcon} className="w-6 h-6" />
        </button>
      </div>
      <GlassTooltip
        visible={tipPin && visible && !isFullscreen}
        animClass={`${animClass} right-[calc(112px-46px)] ${tooltipPos}`}
      >
        {alwaysOnTop ? 'Disable Always on Top' : 'Enable Always on Top'}
      </GlassTooltip>
      
      {/* Disabled tooltip in fullscreen */}
      <GlassTooltip
        visible={tipPin && visible && isFullscreen}
        animClass={`${animClass} right-[calc(112px-80px)] ${tooltipPos}`}
      >
        Always on Top disabled in fullscreen
      </GlassTooltip>

      {/* Close Button */}
      <div
        ref={closeRef}
        onMouseEnter={() => showTooltipDelayed(setTipClose, closeTimeoutRef)}
        onMouseLeave={() => hideTooltipImmediate(setTipClose, closeTimeoutRef)}
        onClick={onClose}
        className={`
          absolute bottom-6 right-[56px] no-drag ${animClass}
          backdrop-filter backdrop-blur-[6px]
          bg-zinc-800/50 hover:bg-zinc-800/60 border border-zinc-700/30
          w-12 h-12 rounded-full flex items-center justify-center cursor-pointer
        `}
        style={{ pointerEvents: visible ? 'auto' : 'none' }}
      >
        <button className={btnInner}>
          <img src={closeIcon} className="w-6 h-6" />
        </button>
      </div>
      <GlassTooltip
        visible={tipClose && visible}
        animClass={`${animClass} right-[calc(56px-37px)] ${tooltipPos}`}
      >
        Close Application
      </GlassTooltip>
    </>
  );
}