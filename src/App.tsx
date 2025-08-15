// App.tsx - CapturePlayer main application with fullscreen always-on-top fix
import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useCaptureStream } from './hooks/useCaptureStream';
import { useSettings }      from './context/SettingsContext';
import VideoCanvas          from './components/VideoCanvas';
import DragBar              from './components/DragBar';
import HoverControls        from './components/HoverControls';
import SettingsModal        from './components/SettingsModal';

declare global {
  interface Window {
    electronAPI: {
      isAlwaysOnTop:     () => Promise<boolean>;
      toggleAlwaysOnTop: () => Promise<boolean>;
      closeApp:          () => void;
      setAspectRatio?:   (ratio: number | null) => void;
      openExternal?:     (url: string) => Promise<{ success: boolean; error?: string }>;
    };
  }
}

export default function App() {
  const { stream, start, stop } = useCaptureStream();
  const settings = useSettings();

  const [running, setRunning]           = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [hideCursor, setHideCursor]     = useState(false);
  const [mouseInside, setMouseInside]   = useState(true);
  const [alwaysOnTop, setAlwaysOnTop]   = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showZoomIndicator, setShowZoomIndicator] = useState(false);
  const [fullscreenZoom, setFullscreenZoom] = useState(100);
  const [isInitializing, setIsInitializing] = useState(true);
  
  const timeoutRef                      = useRef<number>();
  const processingTimeoutRef            = useRef<number>();
  const zoomIndicatorTimeoutRef         = useRef<number>();

  // Signal info (Resolution + FPS)
  const [resolution, setResolution] = useState<{ w: number, h: number, fps?: number } | null>(null);
  
  // Current device selection (may differ from saved settings)
  const [currentVideoDevice, setCurrentVideoDevice] = useState(settings.videoDevice);
  const [currentAudioDevice, setCurrentAudioDevice] = useState(settings.audioDevice);
  
  // Currently active devices in the running stream (for Apply button logic)
  const [activeVideoDevice, setActiveVideoDevice] = useState(settings.videoDevice);
  const [activeAudioDevice, setActiveAudioDevice] = useState(settings.audioDevice);
  
  // Update current devices when settings change
  useEffect(() => {
    setCurrentVideoDevice(settings.videoDevice);
    setCurrentAudioDevice(settings.audioDevice);
  }, [settings.videoDevice, settings.audioDevice]);

  useEffect(() => {
    window.electronAPI.isAlwaysOnTop().then(setAlwaysOnTop);
    // Force reset zoom indicator on app start
    setShowZoomIndicator(false);
    
    // Autostart with devices if enabled and at least one device is selected
    if (settings.autostartWithDevices && !running && 
        !(settings.videoDevice === '' && settings.audioDevice === '')) {
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

  // Fullscreen event listener
  useEffect(() => {
    const handleFullscreenChange = () => {
      const isNowFullscreen = !!document.fullscreenElement;
      setIsFullscreen(isNowFullscreen);
      
      // Optional: Automatically disable always-on-top when entering fullscreen
      if (isNowFullscreen && alwaysOnTop) {
        console.log('🔄 Fullscreen detected - disabling always-on-top');
        handleAlwaysOnTop(); // Toggle off
      }
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, [alwaysOnTop]);

  // Reset cursor hide timer on any activity - only when running
  const resetCursorTimer = useCallback(() => {
    if (!running) return;
    setHideCursor(false);
    setMouseInside(true);
    clearTimeout(timeoutRef.current);
    timeoutRef.current = window.setTimeout(() => setHideCursor(true), 5000);
  }, [running]);

  // Handle zoom with Ctrl+Mouse Wheel
  const handleZoom = useCallback((e: WheelEvent) => {
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
  }, [settings, isFullscreen, fullscreenZoom]);

  useEffect(() => {
    const onMove = resetCursorTimer;
    const onClick = resetCursorTimer;
    const onLeave = () => {
      if (!running) return;
      setHideCursor(true);
      setMouseInside(false);
    };
    
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
      clearTimeout(timeoutRef.current);
      clearTimeout(processingTimeoutRef.current);
    };
  }, [resetCursorTimer, handleZoom, running]);

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

  const handleToggle = async () => {
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
        setRunning(true);
        console.log('✅ Capture started successfully');
      }
    } catch (error) {
      console.error('❌ Toggle failed:', error);
      setRunning(false);
    } finally {
      setProcessingWithTimeout(false);
    }
  };

  const handleAlwaysOnTop = async () => {
    // Block always-on-top in fullscreen mode
    if (isFullscreen) {
      console.log('⚠️ Always-on-top blocked in fullscreen mode');
      return;
    }
    
    try {
      const pinned = await window.electronAPI.toggleAlwaysOnTop();
      setAlwaysOnTop(pinned);
      console.log(`📌 Always-on-top: ${pinned ? 'enabled' : 'disabled'}`);
    } catch (error) {
      console.error('❌ Always-on-top toggle failed:', error);
    }
  };

  const handleFullscreen = () =>
    document.fullscreenElement
      ? document.exitFullscreen()
      : document.documentElement.requestFullscreen();

  const handleClose = () => window.electronAPI.closeApp();

  // Apply device changes
  const handleApplyDevices = async (videoDev: string, audioDev: string) => {
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
        await new Promise(resolve => setTimeout(resolve, 300));
      }

      console.log('💾 Updating settings...');
      
      // Check if devices changed BEFORE updating settings
      const devicesChanged = videoDev !== settings.videoDevice || audioDev !== settings.audioDevice;
      
      settings.setVideoDevice(videoDev);
      settings.setAudioDevice(audioDev);
      
      // Note: Autostart stays enabled even if devices change
      
      await new Promise(resolve => setTimeout(resolve, 100));

      console.log('▶️ Starting capture with new devices...');
      await start({ videoDevice: videoDev, audioDevice: audioDev });
      setActiveVideoDevice(videoDev);
      setActiveAudioDevice(audioDev);
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
  };

  const hideControls  = !showSettings && running && (hideCursor || !mouseInside);
  const hideAppCursor = !showSettings && running && hideCursor;

  // Forward aspect ratio settings to Electron
  useEffect(() => {
    if (!window.electronAPI.setAspectRatio) return;
    let ratio: number | null = null;
    
    if (settings.autoAspectRatio && resolution?.w && resolution?.h) {
      ratio = resolution.w / resolution.h;
    } else if (!settings.autoAspectRatio) {
      switch (settings.manualAspectRatio) {
        case '16:9': ratio = 16 / 9; break;
        case '4:3':  ratio = 4 / 3; break;
        case '1:1':  ratio = 1; break;
        case '21:9': ratio = 21 / 9; break;
        case 'free': ratio = 0; break;
        default: 
          // Check if it's a custom ratio
          const customRatio = settings.customRatios.find(cr => cr.id === settings.manualAspectRatio);
          ratio = customRatio ? customRatio.ratio : 16 / 9;
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
      onMouseEnter={() => setMouseInside(true)}
      onMouseLeave={() => setMouseInside(false)}
    >
      <DragBar />

      <VideoCanvas 
        stream={stream} 
        setResolution={setResolution}
        zoomLevel={isFullscreen ? fullscreenZoom : settings.zoomLevel}
        isFullscreen={isFullscreen}
        running={running}
        isProcessing={isProcessing}
        isInitializing={isInitializing}
      />

      {/* Zoom Indicator - Top Right - Always shows for 3s when zooming */}
      {showZoomIndicator && (
        <div className="
          absolute top-4 right-4 z-50
          px-3 py-2 rounded-md
          bg-stone-600/50 backdrop-blur-[6px]
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
        onSettings={() => setShowSettings(true)}
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
      />
    </div>
  );
}