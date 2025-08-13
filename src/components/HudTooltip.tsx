// src/components/HudTooltip.tsx
// Blur tooltip that auto-positions relative to a target ref.
// Text stays sharp by rendering it on a separate layer (no blur on the text layer).

import React, { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

type Placement = 'top' | 'bottom';

export type TooltipProps = {
  children: React.ReactNode;
  visible: boolean;
  targetRef: React.RefObject<HTMLElement>;
  placement?: Placement;
  offset?: number;
  delay?: number;
};

export function HudTooltip({
  children,
  visible,
  targetRef,
  placement = 'top',
  offset = 12,
  delay = 400, // same default delay as before
}: TooltipProps) {
  const [pos, setPos] = useState<{ left: number; top: number; transform: string } | null>(null);
  const [delayedVisible, setDelayedVisible] = useState(false);
  const raf = useRef<number>();
  const timerRef = useRef<number>();

  const measure = () => {
    const el = targetRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({
      left: Math.round(r.left + r.width / 2),
      top: Math.round(placement === 'top' ? r.top - offset : r.bottom + offset),
      transform: placement === 'top' ? 'translate(-50%,-100%)' : 'translate(-50%,0)',
    });
  };

  // Measure immediately when hover starts (prevents the “slide in from wrong spot” effect)
  useLayoutEffect(() => {
    if (visible) {
      measure();
      timerRef.current = window.setTimeout(() => setDelayedVisible(true), delay);
      raf.current = requestAnimationFrame(measure);
    } else {
      setDelayedVisible(false);
      if (timerRef.current) clearTimeout(timerRef.current);
    }

    const onResize = () => measure();
    const onScroll = () => measure();
    const onFs = () => {
      setPos(null);
      requestAnimationFrame(measure);
    };

    window.addEventListener('resize', onResize);
    window.addEventListener('scroll', onScroll, true);
    document.addEventListener('fullscreenchange', onFs);

    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
      if (timerRef.current) clearTimeout(timerRef.current);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', onScroll, true);
      document.removeEventListener('fullscreenchange', onFs);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, placement, offset, targetRef]);

  if (!delayedVisible || !pos) return null;

  return createPortal(
    <div
      className="fixed z-[50] pointer-events-none"
      style={{
        left: pos.left,
        top: pos.top,
        transform: pos.transform,
        opacity: delayedVisible ? 1 : 0,
        transition: 'opacity 150ms ease-out',
      }}
    >
      {/* Background layer with blur */}
      <div
        className="
          absolute inset-0 rounded-md
          bg-stone-600/50 backdrop-blur-[6px]
          border border-stone-600/30
        "
      />
      {/* Text layer kept separate so it stays crisp */}
      <div
        className="
          relative px-3 py-1 rounded-md
          text-white text-xs shadow
          whitespace-pre
        "
      >
        {children}
      </div>
    </div>,
    document.body
  );
}
