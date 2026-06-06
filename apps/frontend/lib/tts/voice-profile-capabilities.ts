import type { TtsEngine, VoiceProfile } from "@/types/tts";

export interface TtsPresetVoiceOption {
  id: string;
  name: string;
  gender: "female" | "male";
  language: string;
  description?: string;
}

export const QWEN_CUSTOM_VOICES: TtsPresetVoiceOption[] = [
  { id: "Vivian", name: "薇薇安", gender: "female", language: "zh", description: "明亮、年轻的女声" },
  { id: "Serena", name: "塞丽娜", gender: "female", language: "zh", description: "温暖、柔和的女声" },
  { id: "Uncle_Fu", name: "福伯", gender: "male", language: "zh", description: "低沉、成熟的男声" },
  { id: "Dylan", name: "迪伦", gender: "male", language: "zh", description: "清晰自然的年轻男声" },
  { id: "Eric", name: "艾瑞克", gender: "male", language: "zh", description: "略带沙哑的活泼男声" },
  { id: "Ryan", name: "瑞恩", gender: "male", language: "zh", description: "节奏感强的英文男声（多语）" },
  { id: "Aiden", name: "艾登", gender: "male", language: "zh", description: "清亮的美式男声（多语）" },
  { id: "Ono_Anna", name: "小野安娜", gender: "female", language: "zh", description: "轻盈的日文女声（多语）" },
  { id: "Sohee", name: "昭熙", gender: "female", language: "zh", description: "情绪丰富的韩文女声（多语）" },
];

export const KOKORO_VOICES: TtsPresetVoiceOption[] = [
  { id: "zf_xiaobei", name: "小蓓", gender: "female", language: "zh", description: "普通话女声" },
  { id: "zf_xiaoni", name: "小妮", gender: "female", language: "zh", description: "普通话女声" },
  { id: "zf_xiaoxiao", name: "小小", gender: "female", language: "zh", description: "普通话女声" },
  { id: "zf_xiaoyi", name: "小艺", gender: "female", language: "zh", description: "普通话女声" },
];

/**
 * 全部 TTS 引擎 + 中文展示名（覆盖后端 10 个 TTS 引擎）
 * voiceClone 类引擎没有预设音色，需要用户上传参考音频
 * 设为 language: "zh" 是为了显示在中文筛选中（同时提示需要上传参考）
 */
export const TTS_ENGINE_CATALOG: Array<{
  engine: TtsEngine;
  displayName: string;
  purpose: "presetVoice" | "voiceClone" | "longAudio";
  modelSize?: string;
  voices: TtsPresetVoiceOption[];
  description: string;
}> = [
  {
    engine: "qwen_custom_voice",
    displayName: "Qwen 预设音色",
    purpose: "presetVoice",
    modelSize: "0.6B",
    voices: QWEN_CUSTOM_VOICES.filter((v) => v.language === "zh"),
    description: "Qwen 官方 9 个预设音色，1.7B/0.6B 可选",
  },
  {
    engine: "kokoro",
    displayName: "Kokoro 82M",
    purpose: "presetVoice",
    voices: KOKORO_VOICES.filter((v) => v.language === "zh"),
    description: "轻量预设音色模型，4 个中文音色",
  },
  {
    engine: "qwen",
    displayName: "Qwen 声音克隆",
    purpose: "voiceClone",
    modelSize: "0.6B",
    voices: [],
    description: "上传参考音频即可克隆任意声音（需提供参考文本）",
  },
  {
    engine: "chatterbox",
    displayName: "Chatterbox 多语种",
    purpose: "voiceClone",
    voices: [],
    description: "Resemble AI 多语种克隆引擎（12 种语言）",
  },
  {
    engine: "chatterbox_turbo",
    displayName: "Chatterbox 极速版",
    purpose: "voiceClone",
    voices: [],
    description: "轻量 Chatterbox，英文克隆速度更快",
  },
  {
    engine: "luxtts",
    displayName: "LuxTTS 高速克隆",
    purpose: "voiceClone",
    voices: [],
    description: "ZipVoice 架构，英文克隆速度极快",
  },
  {
    engine: "tada",
    displayName: "TADA 1B",
    purpose: "voiceClone",
    modelSize: "1B",
    voices: [],
    description: "HumeAI 英文语音语言模型",
  },
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

// =============================================================================
// 统一音色库视图（隐藏引擎）
// 角色 / 声线库只暴露"音色"，引擎降级为音色的内部元数据
// =============================================================================

/**
 * 统一音色条目（声线库对外暴露的最小单位）
 * 引擎字段仅用于内部 routing，对用户不可见
 */
export interface UnifiedVoiceOption {
  /** 全局唯一 ID，格式 `${engine}:${voiceId}` */
  id: string;
  /** 内部 routing 元数据（用户不可见） */
  engine: TtsEngine;
  /** 该引擎内的原 voiceId */
  voiceId: string;
  /** 中文展示名（用户看到的） */
  name: string;
  gender: "female" | "male";
  language: string;
  description?: string;
  /** 来源分组，决定 UI 分组标签 */
  source: "preset";
  /** 该音色所属引擎的中文展示名（仅当 UI 需要时展示，例如 tooltip） */
  engineLabel: string;
}

/**
 * 拉取所有引擎的预设音色，按语言过滤
 * 同一 voiceId 跨语言时只返回语言匹配项；多语种音色（language="zh" 但实际多语）会被 zh 过滤命中
 */
export function getAllPresetVoices(language = "zh"): UnifiedVoiceOption[] {
  const list: UnifiedVoiceOption[] = [];
  for (const entry of TTS_ENGINE_CATALOG) {
    if (entry.purpose !== "presetVoice") continue;
    for (const v of entry.voices) {
      if (v.language !== language) continue;
      list.push({
        id: `${entry.engine}:${v.id}`,
        engine: entry.engine,
        voiceId: v.id,
        name: v.name,
        gender: v.gender,
        language: v.language,
        description: v.description,
        source: "preset",
        engineLabel: entry.displayName,
      });
    }
  }
  return list;
}

/**
 * 从统一 ID 解析回引擎 + 音色 ID
 * UI 不应直接用，统一走此函数
 */
export function resolveUnifiedVoiceId(id: string): { engine: TtsEngine; voiceId: string } | null {
  if (!id || !id.includes(":")) return null;
  const idx = id.indexOf(":");
  const engine = id.slice(0, idx) as TtsEngine;
  const voiceId = id.slice(idx + 1);
  if (!voiceId) return null;
  return { engine, voiceId };
}

/**
 * 解析统一 ID 并回填出创建 VoiceProfile 所需的最小元数据
 */
export function resolvePresetVoiceSelection(id: string, fallbackLanguage = "zh") {
  const resolved = resolveUnifiedVoiceId(id);
  if (!resolved) return null;
  return {
    engine: resolved.engine,
    voiceId: resolved.voiceId,
    modelSize: getDefaultModelSizeForEngine(resolved.engine) ?? undefined,
    language: fallbackLanguage,
  };
}
