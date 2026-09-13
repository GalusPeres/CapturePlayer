export type NeuralQuality = 'auto' | '720p' | '900p' | '1080p' | '1440p';
export type NeuralTuning = { intensity: number; tone: number; structure: number; skin: number };
// -1 asks the runtime for its default skin treatment, preserving the old image.
export const DEFAULT_NEURAL_TUNING: NeuralTuning = { intensity: 100, tone: 100, structure: 100, skin: -1 };
export function normalizeNeuralTuning(value: unknown): NeuralTuning {
  const input = value && typeof value === 'object' ? value as Partial<NeuralTuning> : {};
  const result = { ...DEFAULT_NEURAL_TUNING };
  for (const key of Object.keys(result) as (keyof NeuralTuning)[]) {
    const n = input[key];
    if (typeof n === 'number' && Number.isFinite(n)) {
      result[key] = key === 'skin' && n === -1 ? -1 : Math.round(Math.max(0, Math.min(100, n)));
    }
  }
  return result;
}
export type NeuralStatus = {
  phase: 'off' | 'starting' | 'active' | 'error';
  available: boolean;
  helpersAvailable?: boolean;
  runtimeInstalled?: boolean;
  message: string;
  quality?: string;
  selectedQuality?: NeuralQuality;
  strength?: number;
  tuning?: NeuralTuning;
  appliedTuning?: NeuralTuning;
  split?: boolean;
  outputWidth?: number;
  outputHeight?: number;
  fps?: number;
  processingMs?: number;
  p95Ms?: number;
  gpuMs?: number;
  hdrOutput?: boolean;
  captureWhiteScale?: number;
  vsync?: boolean;
  presentGapP95Ms?: number;
  presentGapMaxMs?: number;
  presentGapsOver25Ms?: number;
};
