// src/hooks/useCaptureStream.ts - Custom hook for managing capture card media streams
import { useState, useCallback, useRef, useEffect } from 'react';
import { useSettings } from '../context/SettingsContext';

type DeviceOverrides = {
  videoDevice?: string;
  audioDevice?: string;
};

export function useCaptureStream() {
  const settings = useSettings();
  const [stream, setStream] = useState<MediaStream | null>(null);

  const audioCtxRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const gainRef = useRef<GainNode | null>(null);
  const startingRef = useRef<boolean>(false);

  // Improved cleanup function for audio resources
  const cleanup = useCallback(() => {
    // console.log('🧹 Cleaning up audio resources...');

    // 1) First disconnect audio graph
    try {
      if (sourceRef.current) {
        sourceRef.current.disconnect();
        sourceRef.current = null;
      }
      if (gainRef.current) {
        gainRef.current.disconnect();
        gainRef.current = null;
      }
    } catch (e) {
      console.warn('Error disconnecting audio nodes:', e);
    }

    // 2) Close AudioContext (with timeout for safety)
    if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
      const ctx = audioCtxRef.current;
      audioCtxRef.current = null;

      // Wait briefly, then close
      setTimeout(() => {
        try {
          ctx.close();
        } catch (e) {
          console.warn('Error closing AudioContext:', e);
        }
      }, 100);
    }
  }, []);

  const stop = useCallback(() => {
    console.log('🛑 Stopping capture stream...');

    // 1) Cache current stream reference
    const currentStream = stream;

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
  }, [stream, cleanup]);

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

        // Always request 1080p60 (ideal): without an explicit frameRate the
        // browser may pick the capture card's default mode, which can be 30 fps.
        const videoConstraints =
          videoDev === ''
            ? false
            : {
                ...(videoDev ? { deviceId: { exact: videoDev } } : {}),
                width: { ideal: 1920 },
                height: { ideal: 1080 },
                frameRate: { ideal: 60 }
              };

        const audioConstraints =
          audioDev === ''
            ? false
            : {
                ...(audioDev ? { deviceId: { exact: audioDev } } : {}),
                sampleRate: 48000,
                channelCount: 2,
                echoCancellation: false,
                noiseSuppression: false,
                autoGainControl: false,
                latency: 0
              };

        if (videoConstraints) {
          pendingVideoMedia = await navigator.mediaDevices.getUserMedia({
            video: videoConstraints,
            audio: false
          });
        }

        if (audioConstraints) {
          pendingAudioMedia = await navigator.mediaDevices.getUserMedia({
            video: false,
            audio: audioConstraints
          });
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

        // 2) Set stream state
        setStream(media);

        // 3) Set up AudioContext + GainNode (with error handling)
        try {
          const ac = new AudioContext({
            latencyHint: 0.005,
            sampleRate: 48000
          });

          console.log('🔊 Created AudioContext, state:', ac.state);

          audioCtxRef.current = ac;
          const src = ac.createMediaStreamSource(media);
          sourceRef.current = src;

          const gain = ac.createGain();
          gain.gain.value = settings.volume / 100;
          gainRef.current = gain;

          // Connect audio graph
          src.connect(gain);
          gain.connect(ac.destination);

          // Resume AudioContext if suspended
          if (ac.state === 'suspended') {
            console.log('🎵 Resuming suspended AudioContext...');
            await ac.resume();
          }

          console.log('✅ Audio setup complete, final state:', ac.state);
        } catch (audioError) {
          console.error('❌ Audio setup failed:', audioError);
          // Audio errors should not crash the entire stream
        }

        return media;
      } catch (error) {
        console.error('❌ Capture stream start failed:', error);
        pendingVideoMedia?.getTracks().forEach((track) => track.stop());
        pendingAudioMedia?.getTracks().forEach((track) => track.stop());
        // Cleanup on error
        cleanup();
        setStream(null);
        throw error;
      } finally {
        startingRef.current = false;
      }
    },
    [settings.videoDevice, settings.audioDevice, settings.volume, stream, stop, cleanup]
  );

  // Dynamically adjust volume (with error handling)
  useEffect(() => {
    if (gainRef.current) {
      try {
        gainRef.current.gain.value = settings.volume / 100;
        console.log('🔊 Volume updated to:', settings.volume);
      } catch (e) {
        console.warn('Error updating volume:', e);
      }
    }
  }, [settings.volume]);

  useEffect(() => {
    if (!import.meta.env.DEV || !stream || !settings.showDiagnosticsOverlay) return undefined;

    const intervalId = window.setInterval(() => {
      const ac = audioCtxRef.current;
      if (!ac) return;

      window.electronAPI?.debugAudioStats?.({
        state: ac.state,
        sampleRate: ac.sampleRate,
        currentTime: Number(ac.currentTime.toFixed(3)),
        baseLatencyMs: Number((ac.baseLatency * 1000).toFixed(1)),
        outputLatencyMs: typeof ac.outputLatency === 'number' ? Number((ac.outputLatency * 1000).toFixed(1)) : undefined
      });
    }, 2000);

    return () => {
      clearInterval(intervalId);
    };
  }, [settings.showDiagnosticsOverlay, stream]);

  // Cleanup on unmount with memory management
  useEffect(() => {
    return () => {
      // console.log('🧹 Component unmounting, cleaning up...');
      cleanup();

      // Force garbage collection if available (dev only)
      if (process.env.NODE_ENV === 'development' && typeof window !== 'undefined' && (window as any).gc) {
        (window as any).gc();
      }
    };
  }, [cleanup]);

  return { stream, start, stop };
}
