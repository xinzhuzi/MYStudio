import type { EditingAudioDuckingSettings } from "@/types/editing";

export const DEFAULT_EDITING_AUDIO_DUCKING: Readonly<EditingAudioDuckingSettings> = {
  reductionDb: -12,
  attackUs: 120_000,
  releaseUs: 400_000,
};

export function resolveEditingAudioDucking(
  value?: EditingAudioDuckingSettings,
): EditingAudioDuckingSettings {
  return value
    ? { ...value }
    : { ...DEFAULT_EDITING_AUDIO_DUCKING };
}
