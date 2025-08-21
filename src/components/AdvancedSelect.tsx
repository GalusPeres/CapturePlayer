// src/components/AdvancedSelect.tsx - Advanced dropdown with tabs and thumbnails
import React, { useState, useEffect, useRef } from 'react';

export type AdvancedSelectOption = { 
  value: string; 
  label: string; 
  thumbnail?: string | null;
  category: 'devices' | 'screens' | 'apps';
};

type Props = {
  options: AdvancedSelectOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  getSelectedLabel?: (value: string, options: AdvancedSelectOption[]) => string;
};

export default function AdvancedSelect({ 
  options, 
  value, 
  onChange, 
  placeholder = 'Select...',
  getSelectedLabel 
}: Props) {
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'devices' | 'screens' | 'apps'>('devices');
  const ref = useRef<HTMLDivElement>(null);

  // Close when clicking outside
  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    window.addEventListener('mousedown', onClickOutside);
    return () => window.removeEventListener('mousedown', onClickOutside);
  }, []);

  // Get display label for selected value
  const getDisplayLabel = () => {
    if (getSelectedLabel) {
      return getSelectedLabel(value, options);
    }
    const option = options.find(o => o.value === value);
    return option?.label || placeholder;
  };

  // Separate options by category
  const deviceOptions = options.filter(o => o.category === 'devices');
  const screenOptions = options.filter(o => o.category === 'screens');
  const appOptions = options.filter(o => o.category === 'apps');

  const handleSelect = (selectedValue: string) => {
    onChange(selectedValue);
    setOpen(false);
  };

  return (
    <div ref={ref} className="relative w-full">
      {/* Custom scrollbar styles */}
      <style>
        {`
          .custom-scroll::-webkit-scrollbar {
            width: 4px;
            height: 4px;
          }
          .custom-scroll::-webkit-scrollbar-track {
            background: transparent;
          }
          .custom-scroll::-webkit-scrollbar-thumb {
            background-color: #52525b;
            border-radius: 2px;
          }
          .custom-scroll {
            scrollbar-gutter: stable;
          }
        `}
      </style>

      {/* Trigger Button */}
      <button
        onClick={() => setOpen(!open)}
        className="w-full bg-zinc-900/60 border border-zinc-700 text-white text-sm p-2 rounded flex justify-between items-center focus:outline-none"
      >
        <span className="block truncate">{getDisplayLabel()}</span>
        <svg className="w-4 h-4 ml-2 shrink-0" viewBox="0 0 20 20" fill="currentColor">
          <path d="M5 8l5 5 5-5H5z" />
        </svg>
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute z-10 mt-1 w-full border border-zinc-700 rounded overflow-hidden shadow-xl" style={{
          background: 'linear-gradient(135deg, #1e3a8a 0%, #14532d 100%)',
          boxShadow: 'inset 0 0 0 1000px rgba(39, 39, 42, 0.85)'
        }}>
          {/* Tabs */}
          <div className="flex">
            <button
              onClick={() => setActiveTab('devices')}
              className={`flex-1 px-3 py-2 text-xs transition-colors ${
                activeTab === 'devices' 
                  ? 'bg-zinc-900 text-white rounded-tr-md border-r border-zinc-600' 
                  : 'text-zinc-400 hover:text-white border-b border-zinc-600'
              }`}
            >
              Devices
            </button>
            <button
              onClick={() => setActiveTab('screens')}
              className={`flex-1 px-3 py-2 text-xs transition-colors ${
                activeTab === 'screens' 
                  ? 'bg-zinc-900 text-white rounded-t-md border-x border-zinc-600' 
                  : 'text-zinc-400 hover:text-white border-b border-zinc-600'
              }`}
            >
              Screens
            </button>
            <button
              onClick={() => setActiveTab('apps')}
              className={`flex-1 px-3 py-2 text-xs transition-colors ${
                activeTab === 'apps' 
                  ? 'bg-zinc-900 text-white rounded-tl-md border-l border-zinc-600' 
                  : 'text-zinc-400 hover:text-white border-b border-zinc-600'
              }`}
            >
              Apps
            </button>
          </div>

          {/* Content */}
          {activeTab === 'devices' ? (
            <ul className="max-h-48 overflow-auto text-sm leading-tight custom-scroll bg-zinc-900">
              {deviceOptions.map((option) => (
                <li
                  key={option.value}
                  onClick={() => handleSelect(option.value)}
                  className={`mx-1 px-3 py-1 cursor-pointer rounded-sm ${
                    value === option.value
                      ? 'bg-gradient-to-r from-blue-600 to-indigo-500 text-white'
                      : 'text-zinc-200 hover:bg-zinc-700 hover:text-white'
                  }`}
                >
                  <span className="block truncate">{option.label}</span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="max-h-48 overflow-auto custom-scroll bg-zinc-900">
              {/* Screens Tab */}
              {activeTab === 'screens' && (
                <div className="p-2">
                  <div className="grid grid-cols-2 gap-2">
                    {screenOptions.map((option) => (
                      <div key={option.value} className="text-center">
                        <button
                          onClick={() => handleSelect(option.value)}
                          className={`
                            w-full aspect-video rounded-xl border transition-all overflow-hidden block
                            ${value === option.value
                              ? 'border-blue-400'
                              : 'border-zinc-600 hover:border-zinc-500'
                            }
                          `}
                        >
                          {option.thumbnail ? (
                            <img 
                              src={option.thumbnail} 
                              alt={option.label}
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <div className="w-full h-full bg-gradient-to-br from-zinc-700 to-zinc-800 flex items-center justify-center text-xl">
                              🖥️
                            </div>
                          )}
                        </button>
                        <div className="text-xs text-white/80 mt-1 truncate">
                          {option.label}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Applications Tab */}
              {activeTab === 'apps' && (
                <div className="p-2">
                  <div className="grid grid-cols-2 gap-2">
                    {appOptions.map((option) => (
                      <div key={option.value} className="text-center">
                        <button
                          onClick={() => handleSelect(option.value)}
                          className={`
                            w-full aspect-video rounded-xl border transition-all overflow-hidden block
                            ${value === option.value
                              ? 'border-blue-400'
                              : 'border-zinc-600 hover:border-zinc-500'
                            }
                          `}
                        >
                          {option.thumbnail ? (
                            <img 
                              src={option.thumbnail} 
                              alt={option.label}
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <div className="w-full h-full bg-gradient-to-br from-zinc-700 to-zinc-800 flex items-center justify-center text-xl">
                              📱
                            </div>
                          )}
                        </button>
                        <div className="text-xs text-white/80 mt-1 truncate">
                          {option.label}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}