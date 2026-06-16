// App.tsx - CapturePlayer main application with fullscreen always-on-top fix
import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useCaptureStream } from './hooks/useCaptureStream';
import { useSettings } from './context/SettingsContext';
import VideoCanvas from './components/VideoCanvas';
import DragBar from './components/DragBar';
import HoverControls from './components/HoverControls';
import SettingsModal from './components/SettingsModal';

declare global {
  interface Window {
    electronAPI: {
      isAlwaysOnTop: () => Promise<boolean>;
      setAlwaysOnTop: (enabled: boolean) => Promise<boolean>;
      closeApp: () => void;
      setAspectRatio?: (ratio: number | null) => void;
      setFullscreen?: (enabled: boolean) => Promise<void>;
      onFullscreenChanged?: (callback: (fullscreen: boolean) => void) => () => void;
      beginFullscreenDrag?: (cursor: { x: number; y: number }) => Promise<void>;
      fullscreenDragMove?: (cursor: { x: number; y: number }) => void;
      fullscreenDragEnd?: () => void;
      openExternal?: (url: string) => Promise<{ success: boolean; error?: string }>;
      debugFrameStats?: (payload: unknown) => void;
      debugAudioStats?: (payload: unknown) => void;
      getDisableGpuVsync?: () => Promise<{ enabled: boolean; active: boolean }>;
      setDisableGpuVsync?: (enabled: boolean) => Promise<boolean>;
      relaunchApp?: () => Promise<boolean>;
    };
  }
}

export default function App() {
  const { stream, start, stop } = useCaptureStream();
  const settings = useSettings();

  const [running, setRunning] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [hideCursor, setHideCursor] = useState(false);
  const [mouseInside, setMouseInside] = useState(true);
  const [alwaysOnTop, setAlwaysOnTop] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showZoomIndicator, setShowZoomIndicator] = useState(false);
  const [fullscreenZoom, setFullscreenZoom] = useState(100);
  const [isInitializing, setIsInitializing] = useState(true);
  // Right-click opens at the cursor and makes that the new remembered
  // position. The HUD button reuses it, including after an app restart.
  const [settingsAnchor, setSettingsAnchor] = useState<{ x: number; y: number } | null>(null);
  // Hides the picture for a few frames around native fullscreen switches.
  const [fsHidden, setFsHidden] = useState(false);
  const isFullscreenRef = useRef(false);
  const fsRevealTimeoutRef = useRef<number>();

  const timeoutRef = useRef<number>();
  const processingTimeoutRef = useRef<number>();
  const zoomIndicatorTimeoutRef = useRef<number>();
  const cursorRafRef = useRef<number | null>(null);
  const hideCursorRef = useRef(false);
  const mouseInsideRef = useRef(true);

  // Signal info (Resolution + FPS)
  const [resolution, setResolution] = useState<{ w: number; h: number; fps?: number } | null>(null);

  // Current device selection (may differ from saved settings)
  const [currentVideoDevice, setCurrentVideoDevice] = useState(settings.videoDevice);
  const [currentAudioDevice, setCurrentAudioDevice] = useState(settings.audioDevice);

  // Currently active devices in the running stream (for Apply button logic)
  const [activeVideoDevice, setActiveVideoDevice] = useState(settings.videoDevice);
  const [activeAudioDevice, setActiveAudioDevice] = useState(settings.audioDevice);
  const [activeCaptureResolution, setActiveCaptureResolution] = useState(settings.captureResolution);
  const [activeCaptureFrameRate, setActiveCaptureFrameRate] = useState(settings.captureFrameRate);

  useEffect(() => {
    hideCursorRef.current = hideCursor;
  }, [hideCursor]);

  useEffect(() => {
    mouseInsideRef.current = mouseInside;
  }, [mouseInside]);

  // Update current devices when settings change
  useEffect(() => {
    setCurrentVideoDevice(settings.videoDevice);
    setCurrentAudioDevice(settings.audioDevice);
  }, [settings.videoDevice, settings.audioDevice]);

  const setAlwaysOnTopState = useCallback(async (enabled: boolean) => {
    try {
      const pinned = await window.electronAPI.setAlwaysOnTop(enabled);
      setAlwaysOnTop(pinned);
      console.log(`📌 Always-on-top: ${pinned ? 'enabled' : 'disabled'}`);
    } catch (error) {
      console.error('❌ Always-on-top update failed:', error);
    }
  }, []);

  useEffect(() => {
    window.electronAPI.isAlwaysOnTop().then(setAlwaysOnTop);
    // Force reset zoom indicator on app start
    setShowZoomIndicator(false);

    // Autostart with devices if enabled and at least one device is selected
    if (settings.autostartWithDevices && !running && !(settings.videoDevice === '' && settings.audioDevice === '')) {
      console.log('🚀 Autostarting with saved devices...');
      // Add delay to ensure cleanup is complete
      setTimeout(() => {
        handleToggle();
        setIsInitializing(false);
      }, 500);
    } else {
      // No autostart, show UI immediately
      setIsInitializing(false);
    }

    // Cleanup zoom timeout only on unmount
    return () => {
      clearTimeout(zoomIndicatorTimeoutRef.current);
    };
  }, []);

  // Native fullscreen events from the main process. The picture is hidden
  // around the switch (see handleFullscreen) and revealed two frames after the
  // new geometry is in place, so the abrupt window resize never shows a
  // misplaced frame.
  useEffect(() => {
    const unsubscribe = window.electronAPI.onFullscreenChanged?.((isNowFullscreen) => {
      isFullscreenRef.current = isNowFullscreen;
      setIsFullscreen(isNowFullscreen);

      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          clearTimeout(fsRevealTimeoutRef.current);
          setFsHidden(false);
        });
      });

      if (isNowFullscreen && alwaysOnTop) {
        void setAlwaysOnTopState(false);
      }
    });

    return () => unsubscribe?.();
  }, [alwaysOnTop, setAlwaysOnTopState]);

  // Reset cursor hide timer on any activity - only when running
  const resetCursorTimer = useCallback(() => {
    if (!running) return;

    if (hideCursorRef.current) {
      hideCursorRef.current = false;
      setHideCursor(false);
    }

    if (!mouseInsideRef.current) {
      mouseInsideRef.current = true;
      setMouseInside(true);
    }

    clearTimeout(timeoutRef.current);
    timeoutRef.current = window.setTimeout(() => {
      hideCursorRef.current = true;
      setHideCursor(true);
    }, 5000);
  }, [running]);

  const handlePointerEnter = useCallback(() => {
    if (!mouseInsideRef.current) {
      mouseInsideRef.current = true;
      setMouseInside(true);
    }
  }, []);

  const handlePointerLeave = useCallback(() => {
    if (!running) return;

    if (cursorRafRef.current !== null) {
      window.cancelAnimationFrame(cursorRafRef.current);
      cursorRafRef.current = null;
    }

    if (!hideCursorRef.current) {
      hideCursorRef.current = true;
      setHideCursor(true);
    }

    if (mouseInsideRef.current) {
      mouseInsideRef.current = false;
      setMouseInside(false);
    }
  }, [running]);

  // Handle zoom with Ctrl+Mouse Wheel
  const handleZoom = useCallback(
    (e: WheelEvent) => {
      if (e.ctrlKey) {
        e.preventDefault();
        const zoomStep = 5;
        const delta = e.deltaY > 0 ? -zoomStep : zoomStep;

        if (isFullscreen) {
          const newZoom = Math.max(50, Math.min(300, fullscreenZoom + delta));
          setFullscreenZoom(newZoom);
        } else {
          const newZoom = Math.max(50, Math.min(300, settings.zoomLevel + delta));
          settings.setZoomLevel(newZoom);
        }

        // Show zoom indicator for 2 seconds (reduced from 3)
        setShowZoomIndicator(true);
        clearTimeout(zoomIndicatorTimeoutRef.current);
        zoomIndicatorTimeoutRef.current = window.setTimeout(() => {
          setShowZoomIndicator(false);
        }, 2000);
      }
    },
    [settings, isFullscreen, fullscreenZoom]
  );

  useEffect(() => {
    const onMove = () => {
      if (cursorRafRef.current !== null) return;
      cursorRafRef.current = window.requestAnimationFrame(() => {
        cursorRafRef.current = null;
        resetCursorTimer();
      });
    };
    const onClick = resetCursorTimer;
    const onLeave = handlePointerLeave;

    // Only add mouse listeners when running
    if (running) {
      window.addEventListener('mousemove', onMove);
      window.addEventListener('click', onClick);
      window.addEventListener('mouseleave', onLeave);
      resetCursorTimer();
    }

    // Always listen for zoom (works regardless of running state)
    window.addEventListener('wheel', handleZoom, { passive: false });

    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('click', onClick);
      window.removeEventListener('mouseleave', onLeave);
      window.removeEventListener('wheel', handleZoom);
      if (cursorRafRef.current !== null) {
        window.cancelAnimationFrame(cursorRafRef.current);
        cursorRafRef.current = null;
      }
      clearTimeout(timeoutRef.current);
      clearTimeout(processingTimeoutRef.current);
    };
  }, [resetCursorTimer, handleZoom, running, handlePointerLeave]);

  // Safety timeout for processing state
  const setProcessingWithTimeout = (processing: boolean) => {
    setIsProcessing(processing);

    if (processing) {
      clearTimeout(processingTimeoutRef.current);
      processingTimeoutRef.current = window.setTimeout(() => {
        console.warn('⚠️ Processing timeout - forcing unlock!');
        setIsProcessing(false);
      }, 5000);
    } else {
      clearTimeout(processingTimeoutRef.current);
    }
  };

  const handleToggle = useCallback(async () => {
    console.log(`🎯 Toggle clicked: ${running ? 'stopping' : 'starting'}`);

    if (isProcessing) {
      console.log('⏳ Already processing, ignoring click...');
      return;
    }

    setProcessingWithTimeout(true);

    try {
      if (running) {
        await stop();
        setRunning(false);
        console.log('✅ Capture stopped successfully');
      } else {
        // When starting, use current device selection and update active devices
        await start({ videoDevice: currentVideoDevice, audioDevice: currentAudioDevice });
        setActiveVideoDevice(currentVideoDevice);
        setActiveAudioDevice(currentAudioDevice);
        setActiveCaptureResolution(settings.captureResolution);
        setActiveCaptureFrameRate(settings.captureFrameRate);
        setRunning(true);
        console.log('✅ Capture started successfully');
      }
    } catch (error) {
      console.error('❌ Toggle failed:', error);
      setRunning(false);
    } finally {
      setProcessingWithTimeout(false);
    }
  }, [
    currentAudioDevice,
    currentVideoDevice,
    isProcessing,
    running,
    settings.captureResolution,
    settings.captureFrameRate,
    start,
    stop
  ]);

  const handleAlwaysOnTop = useCallback(() => {
    if (isFullscreen) {
      console.log('⚠️ Always-on-top blocked in fullscreen mode');
      return;
    }
    void setAlwaysOnTopState(!alwaysOnTop);
  }, [alwaysOnTop, isFullscreen, setAlwaysOnTopState]);

  const handleFullscreen = useCallback(() => {
    // Hide the picture, let the hide reach the screen (two frames), then
    // switch natively - the switch itself is instant.
    setFsHidden(true);
    clearTimeout(fsRevealTimeoutRef.current);
    // Safety net: never stay dark if the fullscreen event does not arrive.
    fsRevealTimeoutRef.current = window.setTimeout(() => setFsHidden(false), 800);

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        void window.electronAPI.setFullscreen?.(!isFullscreenRef.current);
      });
    });
  }, []);

  useEffect(() => {
    return () => clearTimeout(fsRevealTimeoutRef.current);
  }, []);

  useEffect(() => {
    const handleEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return;

      if (showSettings) {
        event.preventDefault();
        setShowSettings(false);
        return;
      }

      if (isFullscreenRef.current) {
        event.preventDefault();
        handleFullscreen();
      }
    };

    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [handleFullscreen, showSettings]);

  const handleClose = useCallback(() => window.electronAPI.closeApp(), []);

  const handleOpenSettings = useCallback(() => {
    setSettingsAnchor(null);
    setShowSettings(true);
  }, []);

  // Apply device changes
  const handleApplyDevices = useCallback(
    async (videoDev: string, audioDev: string) => {
      console.log('🔧 Applying new devices:', { video: videoDev, audio: audioDev });

      if (isProcessing) {
        console.log('⏳ Stream operation in progress, skipping device change...');
        return;
      }

      setProcessingWithTimeout(true);

      try {
        if (running) {
          console.log('⏹️ Stopping current capture...');
          setRunning(false);
          await stop();
          await new Promise<void>((resolve) => {
            setTimeout(resolve, 300);
          });
        }

        console.log('💾 Updating settings...');

        settings.setVideoDevice(videoDev);
        settings.setAudioDevice(audioDev);

        // Note: Autostart stays enabled even if devices change

        await new Promise<void>((resolve) => {
          setTimeout(resolve, 100);
        });

        console.log('▶️ Starting capture with new devices...');
        await start({ videoDevice: videoDev, audioDevice: audioDev });
        setActiveVideoDevice(videoDev);
        setActiveAudioDevice(audioDev);
        setActiveCaptureResolution(settings.captureResolution);
        setActiveCaptureFrameRate(settings.captureFrameRate);
        setRunning(true);

        console.log('✅ Device switch successful!');
      } catch (error) {
        console.error('❌ Device switch failed:', error);

        try {
          console.log('🔄 Attempting fallback to previous devices...');
          await start();
          setRunning(true);
        } catch (fallbackError) {
          console.error('❌ Fallback also failed:', fallbackError);
          setRunning(false);
        }
      } finally {
        setProcessingWithTimeout(false);
      }
    },
    [isProcessing, running, settings, start, stop]
  );

  const hideControls = !showSettings && running && (hideCursor || !mouseInside);
  const hideAppCursor = !showSettings && running && hideCursor;

  // Forward aspect ratio settings to Electron
  useEffect(() => {
    if (!window.electronAPI.setAspectRatio) return;
    let ratio: number | null = null;

    if (settings.autoAspectRatio && resolution?.w && resolution?.h) {
      ratio = resolution.w / resolution.h;
    } else if (!settings.autoAspectRatio) {
      switch (settings.manualAspectRatio) {
        case '16:9':
          ratio = 16 / 9;
          break;
        case '4:3':
          ratio = 4 / 3;
          break;
        case '1:1':
          ratio = 1;
          break;
        case '21:9':
          ratio = 21 / 9;
          break;
        case 'free':
          ratio = 0;
          break;
        default: {
          // Check if it's a custom ratio
          const customRatio = settings.customRatios.find((cr) => cr.id === settings.manualAspectRatio);
          ratio = customRatio ? customRatio.ratio : 16 / 9;
        }
      }
    }
    window.electronAPI.setAspectRatio(ratio);
  }, [settings.autoAspectRatio, settings.manualAspectRatio, settings.customRatios, resolution]);

  return (
    <div
      className={`
        w-screen h-screen bg-black relative select-none overflow-hidden
        ${hideAppCursor ? 'cursor-none' : ''}
      `}
      onMouseEnter={handlePointerEnter}
      onMouseLeave={handlePointerLeave}
      // Right-click opens the settings at the cursor (or moves them there if
      // already open) - closing is done via X, Escape or clicking outside.
      onContextMenu={(e) => {
        e.preventDefault();
        setSettingsAnchor({ x: e.clientX, y: e.clientY });
        setShowSettings(true);
      }}
    >
      <DragBar isFullscreen={isFullscreen} />

      <VideoCanvas
        stream={stream}
        setResolution={setResolution}
        zoomLevel={isFullscreen ? fullscreenZoom : settings.zoomLevel}
        isFullscreen={isFullscreen}
        running={running}
        isProcessing={isProcessing}
        isInitializing={isInitializing}
        onDoubleClick={handleFullscreen}
        dimmed={fsHidden}
      />

      {/* Zoom Indicator - Top Right - Always shows for 3s when zooming */}
      {showZoomIndicator && (
        <div
          className="
            absolute top-4 right-4 z-50
            px-3 py-2 rounded-md
            bg-stone-700/80
            border border-stone-600/30
            text-white text-sm font-medium shadow
            pointer-events-none
            transition-all duration-150 ease-out
          "
        >
          {isFullscreen ? fullscreenZoom : settings.zoomLevel}%
        </div>
      )}

      <HoverControls
        running={running}
        onToggle={handleToggle}
        onFullscreen={handleFullscreen}
        onSettings={handleOpenSettings}
        onAlwaysOnTop={handleAlwaysOnTop}
        onClose={handleClose}
        alwaysOnTop={alwaysOnTop}
        visible={!hideControls}
        isFullscreen={isFullscreen}
        canStart={!(currentVideoDevice === '' && currentAudioDevice === '')}
      />

      <SettingsModal
        visible={showSettings}
        onClose={() => setShowSettings(false)}
        running={running}
        onToggle={handleToggle}
        onApplyDevices={handleApplyDevices}
        signalInfo={resolution}
        isFullscreen={isFullscreen}
        fullscreenZoom={fullscreenZoom}
        setFullscreenZoom={setFullscreenZoom}
        onDeviceSelectionChange={(video, audio) => {
          setCurrentVideoDevice(video);
          setCurrentAudioDevice(audio);
        }}
        activeVideoDevice={activeVideoDevice}
        activeAudioDevice={activeAudioDevice}
        activeCaptureResolution={activeCaptureResolution}
        activeCaptureFrameRate={activeCaptureFrameRate}
        anchor={settingsAnchor}
      />
    </div>
  );
}
