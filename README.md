<div align="center">
  <img src="src/assets/icons/icon.png" alt="CapturePlayer Icon" width="64" height="64">
  <h1>CapturePlayer</h1>
</div>

A minimalist capture card viewer for PC gaming and Discord streaming. Built for Nintendo Switch and other consoles. Now available for **Windows, Linux and macOS (Apple Silicon)**.

## What's New in v0.3.3

- **Right-Click Settings** - Open settings via right-click directly at the cursor position; the settings window is now movable
- **Drag Out of Fullscreen** - Grab the top drag zone to pull the window out of fullscreen
- **Native Fullscreen & Smoother Video** - Glitch-free video presentation and native fullscreen mode; no more overlay glitch at capture start
- **Under the Hood** - Updated to Electron 42

<details>
<summary>v0.3.2</summary>

- **VSync Setting** - New Advanced option: keep it on for 60 Hz displays, turn it off on high-refresh monitors (ideally with G-Sync/FreeSync) for the most responsive picture (takes effect after restart)
- **Redesigned Settings** - Compact tabs with short hover tooltips instead of info boxes, new "Advanced" section
- **WebGL Renderer (experimental)** - Optional alternative render path with shader-based color controls
- **Linux & macOS Support** - Official builds for Linux (AppImage) and macOS (Apple Silicon)
- **Fixes** - Capture no longer starts misplaced in a corner; flicker-free HUD and settings rendering

</details>

## Measured Performance

Latency was measured with a screen-mirror stopwatch test (same source, same conditions, averaged over 10+ loops):

| Viewer | 165 Hz monitor |
|---|---|
| **CapturePlayer** | **~25 ms / loop** |
| TackleCast (native Rust viewer) | ~41 ms / loop |
| OBS preview (virtual camera) | ~41-48 ms / loop |

On fixed 60 Hz displays all viewers are limited by the display itself; turning the new VSync setting off closes the gap to native viewers there too (at the cost of possible tearing without G-Sync/FreeSync).

## The Problem

When you want to play Nintendo Switch games on your PC monitor through a capture card and stream it on Discord, OBS is unnecessarily complicated:
- You need to configure audio routing
- Set up the preview projector to show only the video
- Deal with UI elements you don't need
- Navigate through complex menus just to view your console

## The Solution

CapturePlayer does one thing perfectly: **Shows your capture card feed. Nothing else.**

## Key Features

### Clean Viewing Experience
- Only the capture card image is displayed - no buttons, no toolbars
- Controls appear on hover and automatically hide themselves
- Perfect for gaming without distractions

### Performance
- Optimized low latency video processing
- GPU-accelerated rendering pipeline
- Synchronized audio and video
- Lightweight on system resources

### Smart Display & Customization
- Automatic aspect ratio detection - window adapts to your input signal
- **Custom aspect ratio presets** - create and save your own ratios
- Fullscreen mode with **zoom control** (Ctrl + Mouse Wheel)
- Always on Top option to keep window visible
- **Color adjustment presets** - save your favorite brightness, contrast, saturation & hue settings

### Simple Configuration
- Quick device switching in settings
- **Autostart function** - automatically starts capture when app launches
- **Preset management** - save and load your favorite settings combinations
- No complex setup required
- Works immediately after connecting your capture card

## Perfect For

- Playing Nintendo Switch on your PC monitor
- Streaming console games on Discord
- Quick capture card viewing without streaming software overhead
- Anyone who finds OBS overkill for simple capture viewing

## Installation

Download the latest release from [GitHub Releases](https://github.com/galusperes/CapturePlayer/releases/latest):

- **Windows Installer:** `CapturePlayer.Setup.x.x.x.exe` - Standard Windows installation
- **Windows Portable:** `CapturePlayer.x.x.x.portable.exe` - No installation needed
- **Linux:** `CapturePlayer.x.x.x.AppImage` - Make it executable (`chmod +x`) and run
- **macOS (Apple Silicon):** `CapturePlayer.x.x.x.arm64.dmg` - On first launch, right-click the app and choose "Open" (build is not notarized)

## How to Use

1. Connect your capture card to your PC
2. Launch CapturePlayer
3. Click "Start Capture" or enable autostart in settings
4. **Customize your experience:** Create aspect ratio and color presets in settings
5. **Zoom in/out:** Hold Ctrl + scroll mouse wheel (works in fullscreen too)
6. Play your game!

**For Discord streaming:** Share your screen and select the CapturePlayer window

## Screenshots

![Main Window](./screenshot_main.png)
*Clean display with auto-hiding controls*

![Settings](./screenshot_settings.png)
*Simple device and color adjustment settings*

## Tested With

- Elgato HD60 S+
- Nintendo Switch 2
- Windows 11
- macOS (Apple Silicon, M1)

## Why Not OBS?

OBS is great for streaming, but CapturePlayer gives you instant, clean capture card viewing. The video appears directly in the correct aspect ratio as a window with sound - no buttons, no UI, just clean video. Perfect for gaming and Discord streaming without preview workarounds.

## License

MIT License

---

Built for gamers who just want to play. Created by [galusperes](https://github.com/galusperes)# Force Contributors Refresh
