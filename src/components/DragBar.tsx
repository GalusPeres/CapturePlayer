// src/components/DragBar.tsx - Draggable window area for frameless window
import React, { useRef, useState } from 'react';

type Props = {
  isFullscreen?: boolean;
};

export default function DragBar({ isFullscreen = false }: Props) {
  // In fullscreen the native app-region drag does nothing, so the bar handles
  // the pointer itself: pulling it exits fullscreen and keeps the window in
  // hand, like dragging a maximized window in Windows. While such a manual
  // drag runs, the region must stay no-drag even after fullscreen ends -
  // app-region:drag would swallow the pointer events mid-drag.
  const dragState = useRef<{ startX: number; startY: number; dragging: boolean } | null>(null);
  const [manualDrag, setManualDrag] = useState(false);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isFullscreen || e.button !== 0) return;
    dragState.current = { startX: e.screenX, startY: e.screenY, dragging: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const state = dragState.current;
    if (!state) return;

    if (!state.dragging) {
      if (Math.abs(e.screenX - state.startX) + Math.abs(e.screenY - state.startY) < 6) return;
      state.dragging = true;
      setManualDrag(true);
      void window.electronAPI.beginFullscreenDrag?.({ x: e.screenX, y: e.screenY });
      return;
    }

    window.electronAPI.fullscreenDragMove?.({ x: e.screenX, y: e.screenY });
  };

  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragState.current) return;
    dragState.current = null;
    setManualDrag(false);
    window.electronAPI.fullscreenDragEnd?.();
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  return (
    <div
      // Native drag region in windowed mode; manual handling in fullscreen.
      style={{ WebkitAppRegion: isFullscreen || manualDrag ? 'no-drag' : 'drag' } as any}
      className="absolute top-0 left-0 w-full h-8 bg-transparent z-50"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    />
  );
}
