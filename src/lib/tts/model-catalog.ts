import type {
  BackendModelStatus,
  TtsModelDefinition,
  TtsModelGroup,
  TtsModelPurpose,
  TtsModelRow,
} from "@/types/tts";

const QWEN_LANGUAGES = ["zh", "en", "ja", "ko", "de", "fr", "ru", "pt", "es", "it"];

const voiceCloneModels: TtsModelDefinition[] = [
  {
    modelName: "qwen-tts-1.7B",
    displayName: "Qwen TTS 1.7B",
    engine: "qwen",
    hfRepoId: "mlx-community/Qwen3-TTS-12Hz-1.7B-Base-bf16",
    modelSize: "1.7B",
    sizeMb: 3500,
    languages: QWEN_LANGUAGES,
    purpose: "voiceClone",
    description: "Voicebox Qwen3-TTS base model for multilingual voice cloning.",
  },
  {
    modelName: "qwen-tts-0.6B",
    displayName: "Qwen TTS 0.6B",
    engine: "qwen",
    hfRepoId: "mlx-community/Qwen3-TTS-12Hz-0.6B-Base-bf16",
    modelSize: "0.6B",
    sizeMb: 1200,
    languages: QWEN_LANGUAGES,
    purpose: "voiceClone",
    description: "Lightweight Qwen3-TTS model for first-run narrator generation on Apple Silicon.",
  },
  {
    modelName: "luxtts",
    displayName: "LuxTTS",
    engine: "luxtts",
    hfRepoId: "YatharthS/LuxTTS",
    sizeMb: 300,
    languages: ["en"],
    purpose: "voiceClone",
    description: "ZipVoice based cloning model focused on fast 48kHz English speech.",
  },
  {
    modelName: "chatterbox-tts",
    displayName: "Chatterbox TTS",
    engine: "chatterbox",
    hfRepoId: "ResembleAI/chatterbox",
    sizeMb: 3200,
    languages: ["zh", "en", "ja", "ko", "de", "fr", "ru", "pt", "es", "it", "ar", "hi"],
    purpose: "voiceClone",
    description: "Resemble AI multilingual cloning engine with expressive prosody controls.",
  },
  {
    modelName: "chatterbox-turbo",
    displayName: "Chatterbox Turbo",
    engine: "chatterbox_turbo",
    hfRepoId: "ResembleAI/chatterbox-turbo",
    sizeMb: 1500,
    languages: ["en"],
    purpose: "voiceClone",
    description: "Smaller English Chatterbox engine for faster local cloning.",
  },
  {
    modelName: "tada-1b",
    displayName: "TADA 1B",
    engine: "tada",
    hfRepoId: "HumeAI/tada-1b",
    modelSize: "1B",
    sizeMb: 4000,
    languages: ["en"],
    purpose: "voiceClone",
    description: "HumeAI TADA English speech-language model for coherent long-form speech.",
  },
];

const presetVoiceModels: TtsModelDefinition[] = [
  {
    modelName: "qwen-custom-voice-1.7B",
    displayName: "Qwen CustomVoice 1.7B",
    engine: "qwen_custom_voice",
    hfRepoId: "Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice",
    modelSize: "1.7B",
    sizeMb: 3500,
    languages: QWEN_LANGUAGES,
    purpose: "presetVoice",
    description: "Qwen3-TTS preset voice model with instruct-based style control.",
    supportsInstruct: true,
  },
  {
    modelName: "qwen-custom-voice-0.6B",
    displayName: "Qwen CustomVoice 0.6B",
    engine: "qwen_custom_voice",
    hfRepoId: "Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice",
    modelSize: "0.6B",
    sizeMb: 1200,
    languages: QWEN_LANGUAGES,
    purpose: "presetVoice",
    description: "Lightweight Qwen CustomVoice preset model.",
    supportsInstruct: true,
  },
  {
    modelName: "kokoro",
    displayName: "Kokoro 82M",
    engine: "kokoro",
    hfRepoId: "hexgrad/Kokoro-82M",
    sizeMb: 350,
    languages: ["en", "es", "fr", "hi", "it", "pt", "ja", "zh"],
    purpose: "presetVoice",
    description: "Small preset-voice TTS engine suitable for fast previews and light narrator work.",
  },
];

const longAudioModels: TtsModelDefinition[] = [
  {
    modelName: "tada-3b-ml",
    displayName: "TADA 3B Multilingual",
    engine: "tada",
    hfRepoId: "HumeAI/tada-3b-ml",
    modelSize: "3B",
    sizeMb: 8000,
    languages: ["en", "ar", "zh", "de", "es", "fr", "it", "ja", "pl", "pt"],
    purpose: "longAudio",
    description: "TADA multilingual long-form model for extended narration segments.",
  },
];

export const TTS_MODEL_GROUPS: TtsModelGroup[] = [
  {
    id: "voiceClone",
    title: "声线克隆",
    description: "使用参考音频生成旁白或角色声线。",
    models: voiceCloneModels,
  },
  {
    id: "presetVoice",
    title: "预设音色",
    description: "不依赖参考音频，适合快速创建旁白预览。",
    models: presetVoiceModels,
  },
  {
    id: "longAudio",
    title: "情绪/长音频",
    description: "面向长文本口播和更强连续性。",
    models: longAudioModels,
  },
];

const ALL_TTS_MODELS = TTS_MODEL_GROUPS.flatMap((group) => group.models);

export function groupTtsModelsByPurpose() {
  return TTS_MODEL_GROUPS.reduce(
    (groups, group) => {
      groups[group.id] = group;
      return groups;
    },
    {} as Record<TtsModelPurpose, TtsModelGroup>,
  );
}

export function getTtsModelByName(modelName: string) {
  return ALL_TTS_MODELS.find((model) => model.modelName === modelName);
}

export function getDefaultTtsModel() {
  return getTtsModelByName("qwen-tts-0.6B") ?? ALL_TTS_MODELS[0]!;
}

export function applyModelStatuses(statuses: BackendModelStatus[] = []): TtsModelRow[] {
  const statusByName = new Map(statuses.map((status) => [status.model_name, status]));

  return ALL_TTS_MODELS.map((model) => {
    const status = statusByName.get(model.modelName);
    return {
      ...model,
      downloaded: status?.downloaded ?? false,
      downloading: status?.downloading ?? false,
      loaded: status?.loaded ?? false,
      sizeMb: status?.size_mb ?? model.sizeMb,
      backendDisplayName: status?.display_name,
      backendRepoId: status?.hf_repo_id,
    };
  });
}
