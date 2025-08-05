// src/components/VideoCanvas.tsx - Video display with color filters and resolution detection
import React, { useRef, useEffect } from 'react';
import { useSettings } from '../context/SettingsContext';

export type Props = {
  stream: MediaStream | null;
  setResolution?: (res: { w: number; h: number; fps?: number } | null) => void;
};

const VideoCanvas: React.FC<Props> = ({ stream, setResolution }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const settings = useSettings();

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

  return (
    <video
      ref={videoRef}
      autoPlay
      muted
      className="w-full h-full object-contain"
      style={{
        filter: `
          brightness(${settings.brightness}%)
          contrast(${settings.contrast}%)
          saturate(${settings.saturation}%)
          hue-rotate(${settings.hue}deg)
        `,
      }}
    />
  );
};

export default VideoCanvas;