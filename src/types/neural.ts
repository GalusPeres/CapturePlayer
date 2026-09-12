export type NeuralQuality = 'auto' | '720p' | '900p' | '1080p' | '1440p';
export type NeuralStatus = {
  phase: 'off' | 'starting' | 'active' | 'error';
  available: boolean;
  message: string;
  quality?: string;
  selectedQuality?: NeuralQuality;
  strength?: number;
  split?: boolean;
  outputWidth?: number;
  outputHeight?: number;
  fps?: number;
  processingMs?: number;
  p95Ms?: number;
  gpuMs?: number;
  presentGapP95Ms?: number;
  presentGapMaxMs?: number;
  presentGapsOver25Ms?: number;
};
