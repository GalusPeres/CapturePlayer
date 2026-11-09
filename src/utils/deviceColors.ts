const toHex = (value: number) => Math.round(value).toString(16).padStart(2, '0');

export const DEVICE_ICON_OPTIONS = [
  { value: 'camera', icon: '📷', label: 'Camera' },
  { value: 'video', icon: '🎥', label: 'Video' },
  { value: 'display', icon: '🖥️', label: 'Display' },
  { value: 'game', icon: '🎮', label: 'Game' }
] as const;

export function getDeviceColorGradient(color: string): string {
  const red = parseInt(color.slice(1, 3), 16);
  const green = parseInt(color.slice(3, 5), 16);
  const blue = parseInt(color.slice(5, 7), 16);
  const darkerColor = `#${toHex(red * 0.62)}${toHex(green * 0.62)}${toHex(blue * 0.62)}`;

  return `linear-gradient(135deg, ${color}, ${darkerColor})`;
}

export function getDefaultDeviceColor(index: number): string {
  const hue = (index * 137.508) % 360;
  const saturation = 0.78;
  const lightness = 0.42;
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const hueSection = hue / 60;
  const secondary = chroma * (1 - Math.abs((hueSection % 2) - 1));
  const [red, green, blue] =
    hueSection < 1
      ? [chroma, secondary, 0]
      : hueSection < 2
        ? [secondary, chroma, 0]
        : hueSection < 3
          ? [0, chroma, secondary]
          : hueSection < 4
            ? [0, secondary, chroma]
            : hueSection < 5
              ? [secondary, 0, chroma]
              : [chroma, 0, secondary];
  const offset = lightness - chroma / 2;

  return `#${toHex((red + offset) * 255)}${toHex((green + offset) * 255)}${toHex((blue + offset) * 255)}`;
}

export function getDeviceColor(deviceId: string, index: number, colors: Record<string, string>): string {
  return colors[deviceId] ?? getDefaultDeviceColor(index);
}

export function getUniqueDeviceColors(
  deviceIds: string[],
  savedColors: Record<string, string>
): Record<string, string> {
  const deviceColors: Record<string, string> = {};
  const usedColors = new Set<string>();

  deviceIds.forEach((deviceId) => {
    const color = savedColors[deviceId];
    if (color && /^#[\da-f]{6}$/i.test(color) && !usedColors.has(color.toLowerCase())) {
      deviceColors[deviceId] = color;
      usedColors.add(color.toLowerCase());
    }
  });

  deviceIds.forEach((deviceId, index) => {
    if (deviceColors[deviceId]) return;

    let colorIndex = index;
    let color = getDefaultDeviceColor(colorIndex);
    while (usedColors.has(color.toLowerCase())) {
      colorIndex += 1;
      color = getDefaultDeviceColor(colorIndex);
    }

    deviceColors[deviceId] = color;
    usedColors.add(color.toLowerCase());
  });

  return deviceColors;
}
