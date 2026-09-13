type AudioStats = { state: string; latencyMs?: number; recoveries: number };
let currentStats: AudioStats = { state: 'Off', recoveries: 0 };
export const audioDiagnostics = () => ({ ...currentStats });

export const audioConstraints = (device?: string): MediaTrackConstraints => ({
  ...(device ? { deviceId: { exact: device } } : {}),
  sampleRate: 48000, channelCount: 2,
  echoCancellation: false, noiseSuppression: false, autoGainControl: false,
});

// Owns audio only. Recovery never changes the video track or MediaStream identity.
export class AudioPlayback {
  private context?: AudioContext;
  private source?: MediaStreamAudioSourceNode;
  private gain?: GainNode;
  private generation = 0;
  private stopped = false;
  private attempts = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private pending = false;
  private listeners: Array<() => void> = [];
  private volume: number;
  private recoveries = 0;

  constructor(private media: MediaStream, private device: string | undefined, volume: number,
    private platform = window.electronAPI?.platform) {
    this.volume = volume;
    window.addEventListener('focus', this.wake);
    window.addEventListener('pointerdown', this.wake);
    document.addEventListener('visibilitychange', this.wake);
    navigator.mediaDevices.addEventListener('devicechange', this.wake);
    this.watchTracks();
    this.connect();
  }
  private report(state: string) {
    const context = this.context;
    currentStats = { state, recoveries: this.recoveries, latencyMs: context
      ? ((context.baseLatency || 0) + (context.outputLatency || 0)) * 1000 : undefined };
  }
  private healthyTracks() {
    const tracks = this.media.getAudioTracks();
    return tracks.length > 0 && tracks.every(track => track.readyState === 'live' && !track.muted);
  }
  private wake = () => {
    if (this.stopped || this.device === '' || document.hidden) return;
    if (this.healthyTracks() && this.context?.state === 'running') return;
    this.attempts = 0;
    this.schedule(100);
  };
  private watchTracks() {
    this.listeners.splice(0).forEach(remove => remove());
    for (const track of this.media.getAudioTracks()) {
      const changed = () => {
        if (this.healthyTracks()) {
          clearTimeout(this.timer); this.timer = undefined; this.attempts = 0;
          this.report(this.context?.state === 'running' ? 'Playing' : 'Interrupted');
          if (this.context?.state !== 'running') this.schedule();
        } else {
          this.report('Input interrupted');
          // Brief device mutes are normal; silence in a game is not a mute event.
          this.schedule(track.readyState === 'ended' ? 250 : 2000);
        }
      };
      for (const event of ['ended', 'mute', 'unmute']) {
        track.addEventListener(event, changed);
        this.listeners.push(() => track.removeEventListener(event, changed));
      }
    }
  }
  private disconnect() {
    const context = this.context; this.context = undefined;
    if (context) context.onstatechange = null;
    try { this.source?.disconnect(); this.gain?.disconnect(); } catch { /* Already disconnected. */ }
    this.source = undefined; this.gain = undefined;
    if (context && context.state !== 'closed') void context.close().catch(() => {});
  }
  private connect() {
    this.disconnect();
    if (this.device === '') { this.report('Off'); return; }
    if (!this.media.getAudioTracks().length) { this.report('Input unavailable'); this.schedule(); return; }
    try {
      // Let the Linux audio backend choose its low-latency buffer instead of
      // forcing 5 ms on PipeWire/PulseAudio configurations that cannot sustain it.
      const context = new AudioContext({ latencyHint: this.platform === 'linux' ? 'interactive' : 0.005, sampleRate: 48000 });
      this.context = context;
      this.source = context.createMediaStreamSource(this.media);
      this.gain = context.createGain(); this.setVolume(this.volume);
      this.source.connect(this.gain); this.gain.connect(context.destination);
      context.onstatechange = () => {
        if (this.stopped || this.context !== context) return;
        this.report(context.state === 'running' ? 'Playing' : 'Output interrupted');
        if (context.state !== 'running') this.schedule();
      };
      this.report(context.state === 'running' ? 'Playing' : 'Output interrupted');
      if (context.state !== 'running') this.schedule(0);
    } catch (error) {
      console.warn('Audio output unavailable:', error);
      this.disconnect(); this.report('Output unavailable'); this.schedule();
    }
  }
  private schedule(delay = Math.min(4000, 500 * 2 ** this.attempts)) {
    if (this.stopped || this.device === '' || this.timer !== undefined || this.attempts >= 3) return;
    this.timer = setTimeout(() => { this.timer = undefined; void this.recover(); }, delay);
  }
  private async recover() {
    if (this.pending || this.stopped || this.device === '') return;
    this.pending = true; ++this.attempts;
    const generation = this.generation;
    try {
      if (!this.healthyTracks()) {
        await this.replaceInput(this.device, generation);
      } else if (!this.context || this.context.state === 'closed') {
        this.connect();
      }
      const context = this.context;
      if (context && context.state !== 'running') {
        // A browser resume promise may remain pending during an OS interruption.
        let timeout: ReturnType<typeof setTimeout> | undefined;
        try { await Promise.race([context.resume(), new Promise((_, reject) => {
          timeout = setTimeout(() => reject(new Error('Audio resume timed out')), 1500);
        })]); } finally { clearTimeout(timeout); }
      }
      if (generation !== this.generation || this.stopped) return;
      if (this.healthyTracks() && this.context?.state === 'running') {
        ++this.recoveries; this.attempts = 0; this.report('Playing');
      } else this.report('Audio interrupted');
    } catch (error) {
      if (generation === this.generation && !this.stopped) {
        console.warn('Audio recovery failed:', error); this.report('Audio unavailable');
      }
    } finally {
      this.pending = false;
      if (generation === this.generation && (!this.healthyTracks() || this.context?.state !== 'running')) this.schedule();
    }
  }
  private async replaceInput(device: string | undefined, generation: number) {
    const incoming = device === '' ? undefined : await navigator.mediaDevices.getUserMedia({ video: false, audio: audioConstraints(device) });
    if (generation !== this.generation || this.stopped) {
      incoming?.getTracks().forEach(track => track.stop()); return;
    }
    if (device !== '' && !incoming?.getAudioTracks().length) throw new Error('Selected audio device returned no audio');
    this.disconnect();
    this.listeners.splice(0).forEach(remove => remove());
    for (const track of this.media.getAudioTracks()) { this.media.removeTrack(track); track.stop(); }
    for (const track of incoming?.getAudioTracks() ?? []) { track.contentHint = 'music'; this.media.addTrack(track); }
    this.device = device; this.watchTracks(); this.connect();
  }
  async changeDevice(device: string) {
    const generation = ++this.generation;
    clearTimeout(this.timer); this.timer = undefined; this.attempts = 0;
    await this.replaceInput(device, generation);
  }
  setVolume(volume: number) {
    this.volume = volume;
    if (this.gain) this.gain.gain.value = volume / 100;
  }
  stop() {
    this.stopped = true; ++this.generation; clearTimeout(this.timer);
    this.listeners.splice(0).forEach(remove => remove()); this.disconnect();
    window.removeEventListener('focus', this.wake);
    window.removeEventListener('pointerdown', this.wake);
    document.removeEventListener('visibilitychange', this.wake);
    navigator.mediaDevices.removeEventListener('devicechange', this.wake);
    this.report('Off');
  }
}
