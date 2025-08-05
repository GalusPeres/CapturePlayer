// src/components/GlassTooltip.tsx - Glass morphism tooltip component
import React from 'react';
import { createPortal } from 'react-dom';

export type TooltipProps = {
  children: React.ReactNode;
  visible: boolean;
  /** Pass Tailwind classes like "right-[56px] bottom-[76px]" for positioning */
  animClass?: string;
};

export function GlassTooltip({
  children,
  visible,
  animClass = '',
}: TooltipProps) {
  if (!visible) return null;

  return createPortal(
    <div
      className={`
        fixed bottom-[80px]
        px-3 py-1 rounded-md
        bg-stone-600/50 backdrop-blur-[6px]
        border border-stone-600/30
        text-white text-xs shadow
        whitespace-pre pointer-events-none
        transition-all duration-150 ease-out
        ${animClass}
      `}
    >
      {children}
    </div>,
    document.body
  );
}