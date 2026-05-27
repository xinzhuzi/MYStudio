import type { TtsEngine, VoiceProfile } from "@/types/tts";

export interface TtsPresetVoiceOption {
  id: string;
  name: string;
  gender: "female" | "male";
  language: string;
  description?: string;
}

export const QWEN_CUSTOM_VOICES: TtsPresetVoiceOption[] = [
  { id: "Vivian", name: "Vivian", gender: "female", language: "zh", description: "明亮、年轻的女声" },
  { id: "Serena", name: "Serena", gender: "female", language: "zh", description: "温暖、柔和的女声" },
  { id: "Uncle_Fu", name: "Uncle Fu", gender: "male", language: "zh", description: "低沉、成熟的男声" },
  { id: "Dylan", name: "Dylan", gender: "male", language: "zh", description: "清晰自然的年轻男声" },
  { id: "Eric", name: "Eric", gender: "male", language: "zh", description: "略带沙哑的活泼男声" },
  { id: "Ryan", name: "Ryan", gender: "male", language: "en", description: "节奏感强的英文男声" },
  { id: "Aiden", name: "Aiden", gender: "male", language: "en", description: "清亮的美式男声" },
  { id: "Ono_Anna", name: "Ono Anna", gender: "female", language: "ja", description: "轻盈的日文女声" },
  { id: "Sohee", name: "Sohee", gender: "female", language: "ko", description: "情绪丰富的韩文女声" },
];

export const KOKORO_VOICES: TtsPresetVoiceOption[] = [
  { id: "af_heart", name: "Heart", gender: "female", language: "en" },
  { id: "af_bella", name: "Bella", gender: "female", language: "en" },
  { id: "am_adam", name: "Adam", gender: "male", language: "en" },
  { id: "am_echo", name: "Echo", gender: "male", language: "en" },
  { id: "bf_alice", name: "Alice", gender: "female", language: "en" },
  { id: "bm_daniel", name: "Daniel", gender: "male", language: "en" },
  { id: "ef_dora", name: "Dora", gender: "female", language: "es" },
  { id: "ff_siwis", name: "Siwis", gender: "female", language: "fr" },
  { id: "jf_alpha", name: "Alpha", gender: "female", language: "ja" },
  { id: "jm_kumo", name: "Kumo", gender: "male", language: "ja" },
  { id: "zf_xiaobei", name: "Xiaobei", gender: "female", language: "zh" },
  { id: "zf_xiaoni", name: "Xiaoni", gender: "female", language: "zh" },
  { id: "zf_xiaoxiao", name: "Xiaoxiao", gender: "female", language: "zh" },
  { id: "zf_xiaoyi", name: "Xiaoyi", gender: "female", language: "zh" },
];

const PRESET_VOICES: Partial<Record<TtsEngine, TtsPresetVoiceOption[]>> = {
  qwen_custom_voice: QWEN_CUSTOM_VOICES,
  kokoro: KOKORO_VOICES,
};

const DEFAULT_MODEL_SIZE: Partial<Record<TtsEngine, string>> = {
  qwen: "0.6B",
  qwen_custom_voice: "0.6B",
  tada: "1B",
};

const REFERENCE_AUDIO_ENGINES = new Set<TtsEngine>([
  "qwen",
  "luxtts",
  "chatterbox",
  "chatterbox_turbo",
  "tada",
]);

export function getVoiceProfileType(engine: TtsEngine): VoiceProfile["type"] {
  return PRESET_VOICES[engine] ? "preset" : "reference";
}

export function getPresetVoiceOptions(engine: TtsEngine, language?: string) {
  const voices = PRESET_VOICES[engine] ?? [];
  if (!language) return voices;
  const matching = voices.filter((voice) => voice.language === language);
  return matching.length > 0 ? matching : voices;
}

export function getDefaultPresetVoiceId(engine: TtsEngine, language = "zh") {
  return getPresetVoiceOptions(engine, language)[0]?.id;
}

export function getDefaultModelSizeForEngine(engine: TtsEngine) {
  return DEFAULT_MODEL_SIZE[engine];
}

export function supportsVoiceInstruction(engine: TtsEngine) {
  return engine === "qwen_custom_voice";
}

export function validateVoiceProfileForGeneration(profile: VoiceProfile): string | null {
  if (getVoiceProfileType(profile.defaultEngine) === "preset") {
    const voices = getPresetVoiceOptions(profile.defaultEngine);
    if (!profile.presetVoiceId) return "请先为声线 profile 选择预设音色";
    if (voices.length > 0 && !voices.some((voice) => voice.id === profile.presetVoiceId)) {
      return `预设音色 ${profile.presetVoiceId} 不属于 ${profile.defaultEngine}`;
    }
    return null;
  }

  if (REFERENCE_AUDIO_ENGINES.has(profile.defaultEngine) && !profile.referenceAudioPath?.trim()) {
    return "请先为声线 profile 上传参考音频";
  }

  if (profile.defaultEngine === "qwen" && !profile.referenceText?.trim()) {
    return "Qwen 声线克隆需要填写参考音频对应的参考文本";
  }

  return null;
}
