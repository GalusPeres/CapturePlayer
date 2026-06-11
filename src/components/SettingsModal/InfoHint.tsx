// src/components/SettingsModal/InfoHint.tsx - Wraps a label so its help text
// appears in a tooltip while hovering it. The tooltip is rendered into
// document.body via a portal with fixed positioning - inside the modal it
// would grow the scroll area and get clipped at the edges.
import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

type Props = {
  info: React.ReactNode;
  children: React.ReactNode;
};

const TOOLTIP_WIDTH = 260;
const EDGE_MARGIN = 8;
const FLIP_THRESHOLD = 180; // open above the trigger when closer than this to the bottom edge
const HOVER_DELAY_MS = 500;

export function InfoHint({ info, children }: Props) {
  const triggerRef = useRef<HTMLSpanElement>(null);
  const delayRef = useRef<number>();
  const [pos, setPos] = useState<{ left: number; top: number; above: boolean } | null>(null);

  useEffect(() => {
    return () => clearTimeout(delayRef.current);
  }, []);

  const show = () => {
    clearTimeout(delayRef.current);
    delayRef.current = window.setTimeout(() => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const left = Math.max(EDGE_MARGIN, Math.min(rect.left, window.innerWidth - TOOLTIP_WIDTH - EDGE_MARGIN));
      const above = rect.bottom + FLIP_THRESHOLD > window.innerHeight;
      setPos({ left, top: above ? rect.top - EDGE_MARGIN : rect.bottom + EDGE_MARGIN, above });
    }, HOVER_DELAY_MS);
  };

  const hide = () => {
    clearTimeout(delayRef.current);
    setPos(null);
  };

  return (
    <span ref={triggerRef} onMouseEnter={show} onMouseLeave={hide} className="inline-flex">
      {children}
      {pos &&
        createPortal(
          <span
            style={{
              position: 'fixed',
              left: pos.left,
              top: pos.top,
              width: 'max-content',
              maxWidth: TOOLTIP_WIDTH,
              zIndex: 9999,
              transform: pos.above ? 'translateY(-100%)' : undefined
            }}
            className="
              block text-xs leading-relaxed text-white/80
              bg-zinc-900 px-3 py-2 rounded-md border border-zinc-700 shadow-xl
              pointer-events-none
            "
          >
            {info}
          </span>,
          document.body
        )}
    </span>
  );
}

export default InfoHint;
