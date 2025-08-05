// src/components/DragBar.tsx - Draggable window area for frameless window
import React from 'react';

export default function DragBar() {
  return (
    <div
      // Make only the top bar draggable
      style={{ WebkitAppRegion: 'drag' } as any}
      className="absolute top-0 left-0 w-full h-8 bg-transparent z-50"
    />
  );
}