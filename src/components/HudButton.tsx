// src/components/HudButton.tsx
// Reusable HUD button with blur style, hover scale, tooltip delay and disabled state.
// NOTE: This component only handles the common visuals and tooltip.
// Position (absolute + right/bottom) is passed in via props.

import React, { useRef, useState } from 'react';
import { HudTooltip } from './HudTooltip';

type Variant = 'gray' | 'green' | 'red' | 'blue';

export type HudButtonProps = {
  icon: string;
  tooltip: string;
  onClick?: () => void;

  /** Absolute positioning classes (e.g. "absolute bottom-6 no-drag <animClass>") */
  positionClass: string;

  /** Extra style overrides (we use this to pass computed `right: px`) */
  style?: React.CSSProperties;

  /** Controls pointer-events enabling/disabling for the whole HUD row */
  visible: boolean;

  /** Color variants (same mapping you used before) */
  variant?: Variant;
  active?: boolean;
  disabled?: boolean;

  /** Icon size override */
  iconSize?: 'small' | 'normal' | 'large';

  /** Tooltip options */
  tooltipPlacement?: 'top' | 'bottom';
  tooltipDelayMs?: number;
};

export default function HudButton({
  icon,
  tooltip,
  onClick,
  positionClass,
  style,
  visible,
  variant = 'gray',
  active = false,
  disabled = false,
  iconSize = 'normal',
  tooltipPlacement = 'top',
  tooltipDelayMs = 700,
}: HudButtonProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Tooltip show/hide with delay (matches your previous behavior)
  const [hover, setHover] = useState(false);
  const [tipVisible, setTipVisible] = useState(false);
  const delayRef = useRef<number>();

  const onEnter = () => {
    clearTimeout(delayRef.current);
    delayRef.current = window.setTimeout(() => setTipVisible(true), tooltipDelayMs);
    setHover(true);
  };
  const onLeave = () => {
    clearTimeout(delayRef.current);
    setTipVisible(false);
    setHover(false);
  };

  // Base HUD button style (blurred background + rounded + centered icon)
  const baseHud = `
    w-12 h-12 rounded-full flex items-center justify-center
    backdrop-filter backdrop-blur-[6px]
    transition-transform duration-200 ease-out
    group
  `;

  // Color variants (same look as before)
  const variantClass: Record<Variant, string> = {
    gray: 'bg-zinc-800/50 hover:bg-zinc-800/60 border border-zinc-700/30',
    green: active
      ? 'bg-gradient-to-br from-orange-500/70 to-red-600/70 hover:from-orange-500/80 hover:to-red-600/80 border border-red-500/30'
      : 'bg-gradient-to-br from-blue-500/70 to-green-600/70 hover:from-blue-500/80 hover:to-green-600/80 border border-green-500/30',
    red: 'bg-red-600/70 hover:bg-red-600/80 border border-red-500/30',
    blue: active
      ? 'bg-gradient-to-br from-purple-500/70 to-blue-600/70 hover:from-purple-500/80 hover:to-blue-600/80 border border-blue-500/30'
      : 'bg-zinc-800/50 hover:bg-zinc-800/60 border border-zinc-700/30',
  };

  // Clear disabled look (darker, desaturated, no hover scale)
  const disabledClass = `
    bg-zinc-900/80 border border-zinc-800/50 opacity-50 cursor-not-allowed saturate-0
  `;

  const containerHoverScale = disabled ? '' : 'hover:scale-110';
  const cursorClass = disabled ? 'cursor-not-allowed' : 'cursor-pointer';
  const iconHoverScale = disabled ? '' : 'group-hover:scale-125';
  const iconDisabledStyle = disabled ? 'opacity-40 saturate-0' : '';
  
  // Icon size classes
  const iconSizeClass = {
    small: 'w-5 h-5',
    normal: 'w-6 h-6',
    large: 'w-8 h-8',
  }[iconSize];

  return (
    <>
      <div
        ref={containerRef}
        onMouseEnter={onEnter}
        onMouseLeave={onLeave}
        onClick={!disabled ? onClick : undefined}
        className={`${positionClass} ${baseHud} ${containerHoverScale} ${cursorClass} ${
          disabled ? disabledClass : variantClass[variant]
        }`}
        style={{ ...(style || {}), pointerEvents: visible ? 'auto' : 'none' }}
        aria-disabled={disabled || undefined}
      >
        <img
          src={icon}
          className={`${iconSizeClass} transition-all duration-150 ease-out ${iconHoverScale} ${iconDisabledStyle}`}
          key={icon} // Force immediate re-render when icon changes
        />
      </div>

      <HudTooltip
        visible={tipVisible && hover && visible}
        targetRef={containerRef}
        placement={tooltipPlacement}
      >
        {tooltip}
      </HudTooltip>
    </>
  );
}
