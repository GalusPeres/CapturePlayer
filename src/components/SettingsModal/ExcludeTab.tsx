import React, { useEffect, useState } from 'react';
import { useSettings } from '../../context/SettingsContext';
import { DEVICE_ICON_OPTIONS, getUniqueDeviceColors } from '../../utils/deviceColors';

type VideoDevice = {
  deviceId: string;
  label: string;
};

export default function ExcludeTab() {
  const {
    excludedHoverDevices,
    setExcludedHoverDevices,
    hoverDeviceColors,
    setHoverDeviceColors,
    hoverDeviceNames,
    setHoverDeviceNames,
    hoverDeviceIcons,
    setHoverDeviceIcons
  } = useSettings();
  const [devices, setDevices] = useState<VideoDevice[]>([]);
  const deviceColors = getUniqueDeviceColors(
    devices.map((device) => device.deviceId),
    hoverDeviceColors
  );

  useEffect(() => {
    let active = true;

    const updateDevices = async () => {
      try {
        const availableDevices = await navigator.mediaDevices.enumerateDevices();
        if (!active) return;

        setDevices(
          availableDevices
            .filter((device) => device.kind === 'videoinput' && !/^Default\b/i.test(device.label || ''))
            .map((device, index) => ({
              deviceId: device.deviceId,
              label: device.label.replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)\s*$/i, '').trim() || `Camera ${index + 1}`
            }))
        );
      } catch (error) {
        console.error('Failed to enumerate capture devices:', error);
      }
    };

    void updateDevices();
    navigator.mediaDevices.addEventListener('devicechange', updateDevices);

    return () => {
      active = false;
      navigator.mediaDevices.removeEventListener('devicechange', updateDevices);
    };
  }, []);

  const toggleDevice = (deviceId: string) => {
    const excluded = new Set(excludedHoverDevices);
    if (excluded.has(deviceId)) excluded.delete(deviceId);
    else excluded.add(deviceId);
    setExcludedHoverDevices(Array.from(excluded));
  };

  const changeDeviceColor = (deviceId: string, color: string) => {
    const conflictingDevice = devices.find(
      (device) => device.deviceId !== deviceId && deviceColors[device.deviceId].toLowerCase() === color.toLowerCase()
    );
    const nextColors = { ...hoverDeviceColors, [deviceId]: color };

    if (conflictingDevice) {
      nextColors[conflictingDevice.deviceId] = deviceColors[deviceId];
    }

    setHoverDeviceColors(nextColors);
  };

  return (
    <div className="space-y-3">
      <p className="text-sm text-white/70">
        Manage device names, icons, button colors, and visibility in the hover menu.
      </p>
      {devices.length ? (
        devices.map((device) => {
          const excluded = excludedHoverDevices.includes(device.deviceId);
          const icon = hoverDeviceIcons[device.deviceId] ?? 'camera';
          return (
            <div
              key={device.deviceId}
              className="space-y-2 rounded-lg border border-zinc-700/70 bg-zinc-800/50 px-3 py-2 hover:bg-zinc-800"
            >
              <div className="flex items-center gap-2">
                <select
                  aria-label={`Icon for ${device.label}`}
                  value={icon}
                  onChange={(event) =>
                    setHoverDeviceIcons({ ...hoverDeviceIcons, [device.deviceId]: event.target.value })
                  }
                  className="h-9 w-12 shrink-0 rounded border border-white/20 bg-zinc-900 px-1 text-center text-base text-white"
                >
                  {DEVICE_ICON_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.icon} {option.label}
                    </option>
                  ))}
                </select>
                <input
                  type="text"
                  aria-label={`Display name for ${device.label}`}
                  placeholder={device.label}
                  value={hoverDeviceNames[device.deviceId] ?? ''}
                  onChange={(event) =>
                    setHoverDeviceNames({ ...hoverDeviceNames, [device.deviceId]: event.target.value })
                  }
                  className="h-9 min-w-0 flex-1 rounded border border-white/20 bg-zinc-900 px-2 text-sm text-white placeholder:text-white/40"
                />
                <input
                  type="color"
                  aria-label={`Button color for ${device.label}`}
                  title="Choose button color"
                  value={deviceColors[device.deviceId]}
                  onChange={(event) => changeDeviceColor(device.deviceId, event.target.value)}
                  className="h-8 w-9 shrink-0 cursor-pointer rounded border border-white/20 bg-transparent p-0.5"
                />
              </div>
              <label className="flex cursor-pointer items-center gap-2 text-xs text-white/70">
                <input
                  type="checkbox"
                  checked={!excluded}
                  onChange={() => toggleDevice(device.deviceId)}
                  className="h-4 w-4 accent-blue-500"
                />
                Show in hover menu
              </label>
            </div>
          );
        })
      ) : (
        <p className="rounded-lg border border-zinc-700/70 bg-zinc-800/50 px-3 py-4 text-center text-sm text-white/50">
          No video devices found.
        </p>
      )}
    </div>
  );
}
