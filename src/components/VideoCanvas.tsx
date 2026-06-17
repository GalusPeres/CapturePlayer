// src/components/VideoCanvas.tsx - Video display with color filters and resolution detection
import React, { useRef, useEffect, useState, useCallback } from 'react';
import { useSettings } from '../context/SettingsContext';
import LowLatencyVideo, { isLowLatencySupported } from './LowLatencyVideo';
import type { FrameStats } from './LowLatencyVideo';
import type { GlFilterState } from './glVideoPipeline';
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
  onDoubleClick?: () => void;
  // Keeps the video off the hardware overlay during window geometry changes
  // (fullscreen transitions) - see videoWarmup.
  overlayGuard?: boolean;
  // Fades the picture to black around fullscreen transitions so the abrupt
  // window resize has nothing bright to misplace.
  dimmed?: boolean;
};

const VideoCanvas: React.FC<Props> = ({
  stream,
  setResolution,
  zoomLevel = 100,
  isFullscreen = false,
  running = false,
  isProcessing = false,
  isInitializing = false,
  onDoubleClick,
  overlayGuard = false,
  dimmed = false
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const settings = useSettings();
  const [debugInfo, setDebugInfo] = useState<FrameStats | null>(null);
  const [glFailed, setGlFailed] = useState(false);
  const [videoWarmup, setVideoWarmup] = useState(false);
  const isDev = import.meta.env.DEV;

  // Prefer the low-latency WebGL path (MediaStreamTrackProcessor + desynchronized
  // canvas); fall back to the classic <video> element if it is unavailable or fails.
  const hasVideoTrack = !!stream && stream.getVideoTracks().length > 0;
  const useGlRenderer = settings.lowLatencyRenderer && !glFailed && hasVideoTrack && isLowLatencySupported();

  // Image Enhancement Modes - CSS image-rendering hint, applied by the browser compositor
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

  const handleGlFallback = useCallback((reason: string) => {
    console.warn('⚠️ Low-latency renderer unavailable, falling back to <video> element:', reason);
    setGlFailed(true);
  }, []);

  useEffect(() => {
    setGlFailed(false);
  }, [settings.lowLatencyRenderer, stream]);

  // Overlay warmup window for the <video> path (see videoStyle below).
  useEffect(() => {
    if (useGlRenderer || !stream) return undefined;

    setVideoWarmup(true);
    const timeoutId = window.setTimeout(() => setVideoWarmup(false), 1500);
    return () => {
      clearTimeout(timeoutId);
      setVideoWarmup(false);
    };
  }, [stream, useGlRenderer]);

  useEffect(() => {
    if (!import.meta.hot) return undefined;

    const resetGlFallback = () => setGlFailed(false);
    import.meta.hot.on('vite:afterUpdate', resetGlFallback);

    return () => {
      import.meta.hot?.off('vite:afterUpdate', resetGlFallback);
    };
  }, []);

  // Measure video resolution and frame rate while the stream is running.
  // This lets auto-aspect react to live signal changes without forcing a restart.
  // Only used on the <video> fallback path - the WebGL path reports per frame.
  useEffect(() => {
    if (useGlRenderer) return undefined;

    const video = videoRef.current;
    if (!video || !stream) {
      setResolution?.(null);
      return undefined;
    }

    let isActive = true;
    let lastSignature: string | null = null;
    let frameRequestId = 0;
    let fpsWindowStart = performance.now();
    let fpsFrameCount = 0;
    let measuredFps: number | undefined;

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
      const fps = trackSettings?.frameRate ? Math.round(trackSettings.frameRate) : measuredFps;
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

    const onFrame: VideoFrameRequestCallback = () => {
      if (!isActive) return;

      fpsFrameCount += 1;
      const elapsed = performance.now() - fpsWindowStart;

      if (elapsed >= 1500) {
        measuredFps = Math.round((fpsFrameCount / elapsed) * 1000);
        fpsWindowStart = performance.now();
        fpsFrameCount = 0;
        measureVideoInfo();
      }

      frameRequestId = video.requestVideoFrameCallback(onFrame);
    };

    if ('requestVideoFrameCallback' in HTMLVideoElement.prototype) {
      frameRequestId = video.requestVideoFrameCallback(onFrame);
    }

    return () => {
      isActive = false;
      video.removeEventListener('loadedmetadata', onMetadata);
      video.removeEventListener('resize', onResize);
      clearTimeout(timeoutId);
      clearInterval(intervalId);
      if ('cancelVideoFrameCallback' in video && frameRequestId) {
        video.cancelVideoFrameCallback(frameRequestId);
      }
    };
  }, [setResolution, stream, useGlRenderer]);

  // Dev-only video timing overlay to diagnose frame pacing and stalls.
  // Only used on the <video> fallback path - the WebGL path reports via callback.
  useEffect(() => {
    const video = videoRef.current;
    if (useGlRenderer || !video || !stream || !isDev) {
      if (!useGlRenderer) setDebugInfo(null);
      return undefined;
    }

    if (!('requestVideoFrameCallback' in HTMLVideoElement.prototype)) {
      setDebugInfo(null);
      return undefined;
    }

    let cancelled = false;
    let frameRequestId = 0;
    let lastFrameNow = 0;
    let windowStart = performance.now();
    let frameCount = 0;
    let lastFrameMs = 0;
    let maxFrameMs = 0;
    let stallCount = 0;
    let presentedFrames = 0;
    let captureDelayMs: number | undefined;
    let maxCaptureDelayMs = 0;
    let lastLoggedAt = 0;

    const publishStats = () => {
      if (cancelled) return;

      const track = stream.getVideoTracks()[0];
      const trackSettings = track?.getSettings?.();
      const trackFps = trackSettings?.frameRate ? Math.round(trackSettings.frameRate) : undefined;
      const elapsed = performance.now() - windowStart;
      const displayFps = elapsed > 0 ? (frameCount / elapsed) * 1000 : 0;
      const idleMs = lastFrameNow ? performance.now() - lastFrameNow : 0;
      const expectedFrameMs = trackFps ? 1000 / trackFps : 16.7;
      const stalled = idleMs > Math.max(50, expectedFrameMs * 2.5);

      const nextStats: FrameStats = {
        width: video.videoWidth || trackSettings?.width || 0,
        height: video.videoHeight || trackSettings?.height || 0,
        trackFps,
        displayFps,
        lastFrameMs,
        maxFrameMs,
        idleMs,
        stallCount,
        presentedFrames,
        stalled,
        captureDelayMs,
        maxCaptureDelayMs: maxCaptureDelayMs || undefined,
        captureDelayKind: 'absolute'
      };

      setDebugInfo(nextStats);

      const shouldLog = settings.showDiagnosticsOverlay && (stalled || performance.now() - lastLoggedAt >= 2000);
      if (shouldLog) {
        window.electronAPI.debugFrameStats?.({
          ...nextStats,
          displayFps: Number(nextStats.displayFps.toFixed(1)),
          lastFrameMs: Number(nextStats.lastFrameMs.toFixed(1)),
          maxFrameMs: Number(nextStats.maxFrameMs.toFixed(1)),
          idleMs: Number(nextStats.idleMs.toFixed(1))
        });
        lastLoggedAt = performance.now();
      }

      windowStart = performance.now();
      frameCount = 0;
      maxFrameMs = 0;
      stallCount = 0;
      maxCaptureDelayMs = 0;
    };

    const onFrame: VideoFrameRequestCallback = (now, metadata) => {
      if (cancelled) return;

      if (lastFrameNow !== 0) {
        lastFrameMs = now - lastFrameNow;
        maxFrameMs = Math.max(maxFrameMs, lastFrameMs);

        const expectedFrameMs =
          metadata.presentedFrames > 1 && metadata.mediaTime > 0
            ? 1000 / Math.max(1, Math.round(metadata.presentedFrames / metadata.mediaTime))
            : 16.7;

        if (lastFrameMs > Math.max(50, expectedFrameMs * 2.5)) {
          stallCount += 1;
        }
      }

      if (typeof metadata.captureTime === 'number') {
        captureDelayMs = now - metadata.captureTime;
        maxCaptureDelayMs = Math.max(maxCaptureDelayMs, captureDelayMs);
      } else {
        captureDelayMs = undefined;
      }

      lastFrameNow = now;
      frameCount += 1;
      presentedFrames = metadata.presentedFrames;
      frameRequestId = video.requestVideoFrameCallback(onFrame);
    };

    frameRequestId = video.requestVideoFrameCallback(onFrame);
    const publishIntervalId = window.setInterval(publishStats, 500);

    return () => {
      cancelled = true;
      clearInterval(publishIntervalId);
      if ('cancelVideoFrameCallback' in video && frameRequestId) {
        video.cancelVideoFrameCallback(frameRequestId);
      }
    };
  }, [isDev, settings.showDiagnosticsOverlay, stream, useGlRenderer]);

  // Set video stream source with cleanup (<video> fallback path only)
  useEffect(() => {
    if (useGlRenderer) return undefined;

    const video = videoRef.current;
    if (!video) return undefined;

    let cancelled = false;
    let assignedStream: MediaStream | null = null;

    const ensurePlayback = async () => {
      if (cancelled || !video.srcObject) return;

      try {
        if (video.paused || video.readyState >= HTMLMediaElement.HAVE_METADATA) {
          await video.play();
        }
      } catch {
        // Autoplay/playback issues should not break the preview pipeline.
      }
    };

    const onLoadedMetadata = () => {
      void ensurePlayback();
    };

    const onCanPlay = () => {
      void ensurePlayback();
    };

    const onVisibilityChange = () => {
      if (!document.hidden) {
        void ensurePlayback();
      }
    };

    const onFocus = () => {
      void ensurePlayback();
    };

    video.addEventListener('loadedmetadata', onLoadedMetadata);
    video.addEventListener('canplay', onCanPlay);
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('focus', onFocus);

    if (stream) {
      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack) {
        assignedStream = new MediaStream([videoTrack]);
        video.srcObject = assignedStream;
        void ensurePlayback();
      } else {
        video.srcObject = null;
      }
    } else if (video.srcObject) {
      video.srcObject = null;
    }

    // Cleanup previous stream
    return () => {
      cancelled = true;
      video.removeEventListener('loadedmetadata', onLoadedMetadata);
      video.removeEventListener('canplay', onCanPlay);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('focus', onFocus);
      if (video.srcObject === assignedStream || (!assignedStream && !stream)) {
        video.srcObject = null;
      }
    };
  }, [stream, useGlRenderer]);

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

  // Shader-side filter state for the WebGL renderer (same semantics as the CSS filters).
  const glFilters: GlFilterState = {
    brightness: settings.brightness / 100,
    contrast: effectiveContrast / 100,
    saturation: settings.saturation / 100,
    hueDeg: settings.hue,
    blurPx: effectiveSharpness < 100 ? Math.max(0, (100 - effectiveSharpness) / 50) : 0,
    sharpen: effectiveSharpness > 100 ? (effectiveSharpness - 100) / 100 : 0,
    crisp: false
  };

  // Fallback <video> styling. Filters are only applied when they do something
  // (a no-op filter blocks the fast hardware-overlay path) - EXCEPT during the
  // short warmup right after capture starts: promoting the video to an overlay
  // while layout and playback are still settling showed the picture misplaced
  // in a corner for about a second. A neutral filter keeps the video composited
  // until things have settled, then the fast path takes over.
  const filterParts: string[] = [];
  if (settings.brightness !== 100) filterParts.push(`brightness(${settings.brightness}%)`);
  if (effectiveContrast !== 100) filterParts.push(`contrast(${effectiveContrast}%)`);
  if (settings.saturation !== 100) filterParts.push(`saturate(${settings.saturation}%)`);
  if (settings.hue !== 0) filterParts.push(`hue-rotate(${settings.hue}deg)`);
  if (effectiveSharpness !== 100) filterParts.push(getSharpnessFilter(effectiveSharpness));

  const videoStyle: React.CSSProperties = {
    imageRendering: enhanceConfig.imageRendering as any
  };
  // Always carry a (possibly neutral) filter: it keeps the picture on the
  // regular compositing path. The hardware-overlay fast path caused the
  // misplaced frame on startup, the flash when entering fullscreen and the
  // late left-shift after leaving it - with no measured latency benefit.
  videoStyle.filter = filterParts.length > 0 ? filterParts.join(' ') : 'brightness(100%)';
  if (zoomLevel !== 100) {
    videoStyle.transform = `scale(${getScaleFactor()})`;
  }

  return (
    <>
      {/* SVG Filter for Sharpening (used by the <video> fallback path) */}
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

      <div
        className="w-full h-full flex items-center justify-center bg-black relative"
        onDoubleClick={onDoubleClick}
        style={{ opacity: dimmed ? 0 : 1, transition: dimmed ? 'none' : 'opacity 70ms ease-out' }}
      >
        {useGlRenderer && stream ? (
          <LowLatencyVideo
            stream={stream}
            zoomLevel={zoomLevel}
            filters={glFilters}
            diagnosticsEnabled={isDev && settings.showDiagnosticsOverlay && running}
            onResolution={setResolution}
            onFallback={handleGlFallback}
          />
        ) : (
          <video
            ref={videoRef}
            autoPlay
            muted
            playsInline
            className="w-full h-full object-contain"
            style={videoStyle}
          />
        )}

        {isDev && settings.showDiagnosticsOverlay && running && !useGlRenderer && debugInfo && (
          <div
            className="
              absolute top-4 left-4 z-40
              px-3 py-2 rounded-md
              bg-black/70 border border-white/10
              text-white/90 text-xs font-mono leading-relaxed
              pointer-events-none
            "
          >
            <div>
              {debugInfo.width}x{debugInfo.height}
              {debugInfo.trackFps ? ` @${debugInfo.trackFps} src` : ''}
            </div>
            <div>renderer: video element</div>
            <div>display: {debugInfo.displayFps.toFixed(1)} fps</div>
            <div>frame: {debugInfo.lastFrameMs.toFixed(1)} ms</div>
            <div>max gap: {debugInfo.maxFrameMs.toFixed(1)} ms</div>
            {typeof debugInfo.captureDelayMs === 'number' && (
              <div>
                {debugInfo.captureDelayKind === 'queue' ? 'queue' : 'delay'}: {debugInfo.captureDelayMs.toFixed(1)} ms
              </div>
            )}
            {typeof debugInfo.maxCaptureDelayMs === 'number' && (
              <div>
                max {debugInfo.captureDelayKind === 'queue' ? 'queue' : 'delay'}:{' '}
                {debugInfo.maxCaptureDelayMs.toFixed(1)} ms
              </div>
            )}
            <div>idle: {debugInfo.idleMs.toFixed(1)} ms</div>
            <div>stalls: {debugInfo.stallCount}</div>
            <div>state: {debugInfo.stalled ? 'stalled' : 'ok'}</div>
          </div>
        )}

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
    prevProps.isInitializing === nextProps.isInitializing &&
    prevProps.onDoubleClick === nextProps.onDoubleClick &&
    prevProps.overlayGuard === nextProps.overlayGuard &&
    prevProps.dimmed === nextProps.dimmed
  );
});
