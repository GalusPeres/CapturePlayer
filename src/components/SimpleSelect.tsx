// src/components/SimpleSelect.tsx - Custom dropdown select component
import React, { useState, useEffect, useRef } from 'react';

export type SimpleSelectOption = { value: string; label: string };

/**
 * Simple select component with custom styling and scrollbar
 */
export function SimpleSelect({
  options,
  value,
  onChange,
}: {
  options: SimpleSelectOption[];
  value: string;
  onChange(val: string): void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close menu when clicking outside
  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    window.addEventListener('mousedown', onClickOutside);
    return () => window.removeEventListener('mousedown', onClickOutside);
  }, []);

  const selected = options.find((o) => o.value === value);

  return (
    <div ref={ref} className="relative w-full">
      {/* Inject custom scrollbar styles */}
      <style>
        {`
          .custom-scroll::-webkit-scrollbar {
            width: 6px;
            height: 6px;
          }
          .custom-scroll::-webkit-scrollbar-track {
            background: #27272a;
          }
          .custom-scroll::-webkit-scrollbar-thumb {
            background-color: #52525b;
            border-radius: 3px;
          }
        `}
      </style>

      {/* Trigger Button */}
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full bg-zinc-900/60 border border-zinc-700 text-white text-sm p-2 rounded flex justify-between items-center focus:outline-none"
      >
        <span className="block truncate">{selected?.label || 'Select…'}</span>
        <svg className="w-4 h-4 ml-2 shrink-0" viewBox="0 0 20 20" fill="currentColor">
          <path d="M5 8l5 5 5-5H5z" />
        </svg>
      </button>

      {/* Options Dropdown */}
      {open && (
        <ul
          className="
            absolute z-10 mt-1 w-full bg-zinc-900 border border-zinc-700
            rounded max-h-48 overflow-auto text-sm leading-tight
            custom-scroll
          "
        >
          {options.map((o) => (
            <li
              key={o.value}
              onClick={() => {
                onChange(o.value);
                setOpen(false);
              }}
              title={o.label}
              className={`
                px-3 py-1 cursor-pointer
                ${o.value === value
                  ? 'bg-gradient-to-r from-blue-600 to-indigo-500 text-white'
                  : 'text-zinc-200 hover:bg-zinc-700 hover:text-white'}
              `}
            >
              <span className="block truncate">{o.label}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}