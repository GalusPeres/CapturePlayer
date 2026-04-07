// src/components/VideoCanvas.tsx - Video display with color filters and resolution detection
import React, { useRef, useEffect } from 'react';
import { useSettings } from '../context/SettingsContext';
import playIcon from '../assets/icons/play.png';
import settingsIcon from '../assets/icons/settings.svg';

export type Props = {
  stream: MediaStream | null;
  setResolution?: (res: { w: number; h: number; fps?: number } | null) => void;
  zoomLevel?: number;
  isFullscreen?: boolean;
  running?: boolean;
  isProcessing?: boolean;
  isInitializing?: boolean;
};

const VideoCanvas: React.FC<Props> = ({
  stream,
  setResolution,
  zoomLevel = 100,
  isFullscreen = false,
  running = false,
  isProcessing = false,
  isInitializing = false
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const settings = useSettings();

  // Image Enhancement Modes - GPU-accelerated, zero-latency
  const getEnhancementConfig = (mode: string) => {
    switch (mode) {
      case 'enhanced':
        return {
          imageRendering: 'crisp-edges' as const
        };
      case 'custom1':
      case 'custom2':
        return {
          imageRendering: 'auto' as const
        };
      default: // 'off'
        return {
          imageRendering: 'auto' as const
        };
    }
  };

  // Calculate sharpness filter values
  const getSharpnessFilter = (sharpness: number) => {
    if (sharpness <= 100) {
      // For values <= 100, use blur for softness
      const blurAmount = Math.max(0, (100 - sharpness) / 50);
      return `blur(${blurAmount}px)`;
    }
    // For values > 100, use SVG convolution filter for sharpening
    const sharpenAmount = (sharpness - 100) / 100; // 0 to 1 for 100-200%
    const filterId = `sharpen-${Math.round(sharpenAmount * 100)}`;
    return `url(#${filterId})`;
  };

  // Measure video resolution and frame rate while the stream is running.
  // This lets auto-aspect react to live signal changes without forcing a restart.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !stream) {
      setResolution?.(null);
      return;
    }

    let isActive = true;
    let lastSignature: string | null = null;

    const updateResolution = (next: { w: number; h: number; fps?: number } | null) => {
      const signature = next ? `${next.w}x${next.h}@${next.fps ?? 0}` : 'null';
      if (signature !== lastSignature) {
        lastSignature = signature;
        setResolution?.(next);
      }
    };

    const measureVideoInfo = () => {
      if (!isActive) return;

      const track = stream.getVideoTracks()[0];
      if (!track || track.readyState !== 'live') {
        updateResolution(null);
        return;
      }

      const trackSettings = track.getSettings?.();
      const fps = trackSettings?.frameRate ? Math.round(trackSettings.frameRate) : undefined;
      const width = video.videoWidth || trackSettings?.width;
      const height = video.videoHeight || trackSettings?.height;

      if (width && height) {
        updateResolution({ w: width, h: height, fps });
      } else {
        updateResolution(null);
      }
    };

    const onMetadata = () => measureVideoInfo();
    const onResize = () => measureVideoInfo();

    video.addEventListener('loadedmetadata', onMetadata);
    video.addEventListener('resize', onResize);

    // Initial check plus lightweight fallback polling in case the backend does
    // not emit a resize event when the capture signal changes.
    measureVideoInfo();
    const timeoutId = window.setTimeout(measureVideoInfo, 200);
    const intervalId = window.setInterval(measureVideoInfo, 750);

    return () => {
      isActive = false;
      video.removeEventListener('loadedmetadata', onMetadata);
      video.removeEventListener('resize', onResize);
      clearTimeout(timeoutId);
      clearInterval(intervalId);
    };
  }, [setResolution, stream]);

  // Set video stream source with cleanup
  useEffect(() => {
    const video = videoRef.current;
    if (video && stream) {
      video.srcObject = stream;
    }

    // Cleanup previous stream
    return () => {
      if (video && video.srcObject !== stream) {
        video.srcObject = null;
      }
    };
  }, [stream]);

  // Get Enhancement configuration
  const enhanceConfig = getEnhancementConfig(settings.fsrMode);
  // Use settings values (which get updated by presets) instead of preset overrides
  const effectiveSharpness = settings.sharpness;
  const effectiveContrast = settings.contrast;
  const sharpenAmount = effectiveSharpness > 100 ? (effectiveSharpness - 100) / 100 : 0;
  const filterId = `sharpen-${Math.round(sharpenAmount * 100)}`;

  // Calculate scale factor from zoom level
  const getScaleFactor = () => {
    return zoomLevel / 100; // Base zoom from Ctrl+Mouse Wheel
  };

  return (
    <>
      {/* SVG Filter for Sharpening */}
      <svg width="0" height="0" style={{ position: 'absolute' }}>
        <defs>
          <filter id={filterId}>
            <feConvolveMatrix
              kernelMatrix={`
                0 -${sharpenAmount} 0
                -${sharpenAmount} ${1 + 4 * sharpenAmount} -${sharpenAmount}
                0 -${sharpenAmount} 0
              `}
              edgeMode="duplicate"
            />
          </filter>
        </defs>
      </svg>

      <div className="w-full h-full flex items-center justify-center bg-black relative">
        <video
          ref={videoRef}
          autoPlay
          muted
          className="w-full h-full object-contain"
          style={{
            imageRendering: enhanceConfig.imageRendering as any,
            filter: `
              brightness(${settings.brightness}%)
              contrast(${effectiveContrast}%)
              saturate(${settings.saturation}%)
              hue-rotate(${settings.hue}deg)
              ${getSharpnessFilter(effectiveSharpness)}
            `,
            transform: `scale(${getScaleFactor()})`
          }}
        />

        {/* Info overlay when not running or no video device while live - but not during processing or initializing */}
        {!isInitializing && !isProcessing && (!running || (running && settings.videoDevice === '')) && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-center text-white/60">
              {running && settings.videoDevice === '' ? (
                <div className="text-lg leading-relaxed">
                  <div>No video device selected</div>
                  <div className="flex items-center justify-center gap-2 mt-2">
                    <span>Press</span>
                    <img src={settingsIcon} className="w-5 h-5" alt="" />
                    <span>to select video device</span>
                  </div>
                </div>
              ) : (
                <div className="text-lg leading-relaxed">
                  <div className="flex items-center justify-center gap-2">
                    <span>Press</span>
                    <img src={playIcon} className="w-5 h-5" alt="" />
                    <span>to start capture</span>
                  </div>
                  <div className="flex items-center justify-center gap-2 mt-2">
                    <span>or press</span>
                    <img src={settingsIcon} className="w-5 h-5" alt="" />
                    <span>to change devices</span>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </>
  );
};

export default React.memo(VideoCanvas, (prevProps, nextProps) => {
  return (
    prevProps.stream === nextProps.stream &&
    prevProps.zoomLevel === nextProps.zoomLevel &&
    prevProps.isFullscreen === nextProps.isFullscreen &&
    prevProps.running === nextProps.running &&
    prevProps.isProcessing === nextProps.isProcessing &&
    prevProps.isInitializing === nextProps.isInitializing
  );
});
