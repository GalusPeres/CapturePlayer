// src/components/VideoCanvas.tsx - Video display with color filters and resolution detection
import React, { useRef, useEffect } from 'react';
import { useSettings } from '../context/SettingsContext';

export type Props = {
  stream: MediaStream | null;
  setResolution?: (res: { w: number; h: number; fps?: number } | null) => void;
  zoomLevel?: number;
  isFullscreen?: boolean;
};

const VideoCanvas: React.FC<Props> = ({ stream, setResolution, zoomLevel = 100, isFullscreen = false }) => {
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
    } else {
      // For values > 100, use SVG convolution filter for sharpening
      const sharpenAmount = (sharpness - 100) / 100; // 0 to 1 for 100-200%
      const filterId = `sharpen-${Math.round(sharpenAmount * 100)}`;
      return `url(#${filterId})`;
    }
  };

  // Measure video resolution and frame rate
  useEffect(() => {
    if (!videoRef.current) return;
    let rafId: number;

    function measureVideoInfo() {
      const video = videoRef.current!;
      const track = (video.srcObject as MediaStream | null)?.getVideoTracks?.()?.[0];
      if (track) {
        const trackSettings = track.getSettings?.();
        let fps: number | undefined = undefined;
        if (trackSettings?.frameRate) fps = Math.round(trackSettings.frameRate);
        if (trackSettings?.width && trackSettings?.height) {
          setResolution?.({ w: trackSettings.width, h: trackSettings.height, fps });
        } else {
          setResolution?.(null);
        }
      } else {
        setResolution?.(null);
      }
      rafId = requestAnimationFrame(measureVideoInfo);
    }
    measureVideoInfo();
    return () => {
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [setResolution]);

  // Set video stream source
  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
    }
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
            transform: `scale(${getScaleFactor()})`,
          }}
        />
      </div>
    </>
  );
};

export default VideoCanvas;