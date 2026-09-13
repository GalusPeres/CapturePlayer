// src/hooks/useCaptureStream.ts - Custom hook for managing capture card media streams
import { useState, useCallback, useRef, useEffect } from 'react';
import { createNativeVideoStream } from './nativeVideoStream';
import { openNativeVideo } from './openNativeVideo';
import { AudioPlayback, audioConstraints } from './audioPlayback';
import { useSettings } from '../context/SettingsContext';

type DeviceOverrides = {
  videoDevice?: string;
  audioDevice?: string;
};

function parseCaptureResolution(value: string) {
  if (value === 'auto') return null;

  const [width, height] = value.split('x').map(Number);
  if (!width || !height) return null;

  return { width, height };
}

function parseCaptureFrameRate(value: string) {
  if (value === 'auto') return null;

  const fps = Number(value);
  return Number.isFinite(fps) && fps > 0 ? fps : null;
}

function createVideoConstraints(
  videoDev: string | undefined,
  captureResolution: string,
  captureFrameRate: string
): false | MediaTrackConstraints {
  if (videoDev === '') return false;

  const resolution = parseCaptureResolution(captureResolution);
  const fps = parseCaptureFrameRate(captureFrameRate);

  return {
    ...(videoDev ? { deviceId: { exact: videoDev } } : {}),
    ...(resolution
      ? {
          resizeMode: { ideal: 'none' },
          width: { exact: resolution.width },
          height: { exact: resolution.height }
        }
      : {}),
    ...(fps
      ? {
          frameRate: { ideal: fps }
        }
      : {})
  };
}

export function useCaptureStream() {
  const settings = useSettings();
  const [stream, setStream] = useState<MediaStream | null>(null);

  const nativeRef = useRef<ReturnType<typeof createNativeVideoStream> | null>(null);
  const audioRef = useRef<AudioPlayback | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const startingRef = useRef(false);
  const cleanup = useCallback(() => { audioRef.current?.stop(); audioRef.current = null; }, []);

  const stop = useCallback(() => {
    console.log('🛑 Stopping capture stream...');

    // 1) Cache current stream reference
    const currentStream = streamRef.current;
    streamRef.current = null;
    nativeRef.current?.stop(); nativeRef.current = null;
    void window.electronAPI.stopNativeCapture?.();

    // 2) Reset state immediately
    setStream(null);

    // 3) Cleanup audio resources
    cleanup();

    // 4) Stop all stream tracks (with small delay)
    setTimeout(() => {
      if (currentStream) {
        currentStream.getTracks().forEach((track) => {
          try {
            if (track.readyState !== 'ended') {
              track.stop();
              console.log(`📹 Stopped ${track.kind} track`);
            }
          } catch (e) {
            console.warn(`Error stopping ${track.kind} track:`, e);
          }
        });
      }
    }, 50);
  }, [cleanup]);

  // Audio selection is independent of video capture. In particular, choosing
  // no audio must not release/reopen a card that another app may also use.
  const changeAudio = useCallback(async (audioDevice: string) => {
    if (!streamRef.current || startingRef.current) return;
    await audioRef.current?.changeDevice(audioDevice);
  }, []);

  const start = useCallback(
    async (overrides: DeviceOverrides = {}) => {
      // Simple guard against multiple simultaneous starts
      if (startingRef.current) {
        console.log('⚠️ Already starting, ignoring');
        return;
      }

      console.log('▶️ Starting capture stream with overrides:', overrides);
      startingRef.current = true;
      let pendingVideoMedia: MediaStream | null = null;
      let pendingAudioMedia: MediaStream | null = null;

      try {
        // If stream is already running, stop it first and wait briefly
        if (stream) {
          console.log('🔄 Stopping existing stream before starting new one...');
          stop();
          // Brief pause for clean transition
          await new Promise<void>((resolve) => {
            setTimeout(resolve, 200);
          });
        }

        // Device IDs from overrides or settings
        const videoDev = overrides.videoDevice ?? settings.videoDevice;
        const audioDev = overrides.audioDevice ?? settings.audioDevice;

        console.log('🎥 Using devices:', { video: videoDev, audio: audioDev });

        const videoConstraints = createVideoConstraints(
          videoDev,
          settings.captureResolution,
          settings.captureFrameRate
        );

        const requestedAudio = audioDev === '' ? false : audioConstraints(audioDev);

        if (videoConstraints && settings.nativeRenderer) {
          const devices = await navigator.mediaDevices.enumerateDevices();
          const selected = devices.find(d => d.kind === 'videoinput' && d.deviceId === videoDev);
          if (!selected?.label) throw new Error('Select a named capture device before starting native capture.');
          const size = parseCaptureResolution(settings.captureResolution) ?? { width: 2560, height: 1440 };
          nativeRef.current = await openNativeVideo(selected, videoConstraints, {
            ...size, fps: parseCaptureFrameRate(settings.captureFrameRate) ?? 60, hdr: settings.nativeHdr });
          pendingVideoMedia = nativeRef.current.stream;
        } else if (videoConstraints) {
          pendingVideoMedia = await navigator.mediaDevices.getUserMedia({
            video: videoConstraints,
            audio: false
          });
        }

        if (requestedAudio) {
          try {
            pendingAudioMedia = await navigator.mediaDevices.getUserMedia({ video: false, audio: requestedAudio });
          } catch (error) {
            if (!pendingVideoMedia) throw error;
            console.warn('Audio input unavailable; keeping video active:', error);
          }
        }

        const media = new MediaStream([
          ...(pendingVideoMedia?.getVideoTracks() ?? []),
          ...(pendingAudioMedia?.getAudioTracks() ?? [])
        ]);

        if (media.getTracks().length === 0) {
          throw new Error('No media tracks available');
        }
        console.log(
          '📡 Got media stream:',
          media.getTracks().map((t) => `${t.kind}: ${t.label}`)
        );

        const videoTrack = media.getVideoTracks()[0];
        if (videoTrack && 'contentHint' in videoTrack) {
          try {
            videoTrack.contentHint = 'motion';
            console.log('ðŸŽ¬ Applied video contentHint:', videoTrack.contentHint);
          } catch (hintError) {
            console.warn('Failed to apply video contentHint:', hintError);
          }
        }

        const audioTrack = media.getAudioTracks()[0];
        if (audioTrack && 'contentHint' in audioTrack) {
          try {
            audioTrack.contentHint = 'music';
            console.log('ðŸŽ§ Applied audio contentHint:', audioTrack.contentHint);
          } catch (hintError) {
            console.warn('Failed to apply audio contentHint:', hintError);
          }
        }

        streamRef.current = media;
        setStream(media);
        audioRef.current = new AudioPlayback(media, audioDev, settings.volume);

        return media;
      } catch (error) {
        console.error('❌ Capture stream start failed:', error);
        nativeRef.current?.stop(); nativeRef.current = null;
        void window.electronAPI.stopNativeCapture?.();
        pendingVideoMedia?.getTracks().forEach((track) => track.stop());
        pendingAudioMedia?.getTracks().forEach((track) => track.stop());
        // Cleanup on error
        cleanup();
        streamRef.current = null;
        setStream(null);
        throw error;
      } finally {
        startingRef.current = false;
      }
    },
    [
      settings.nativeRenderer, settings.nativeHdr,
      settings.videoDevice,
      settings.audioDevice,
      settings.captureResolution,
      settings.captureFrameRate,
      settings.volume,
      stream,
      stop,
      cleanup
    ]
  );

  useEffect(() => { audioRef.current?.setVolume(settings.volume); }, [settings.volume]);

  // Cleanup on unmount with memory management
  useEffect(() => {
    return () => {
      // console.log('🧹 Component unmounting, cleaning up...');
      cleanup();
      streamRef.current?.getTracks().forEach(track => track.stop());
      streamRef.current = null;
      nativeRef.current?.stop();
      void window.electronAPI.stopNativeCapture?.();

      // Force garbage collection if available (dev only)
      if (process.env.NODE_ENV === 'development' && typeof window !== 'undefined' && (window as any).gc) {
        (window as any).gc();
      }
    };
  }, [cleanup]);

  return { stream, start, stop, changeAudio };
}
