/**
 * 旁白声音策略（用户指令：旁白恒用木成，按台词情境换声音片段）。
 *
 * 背景：旁白 speaker=narrator 未绑定时走全库自动匹配（打分+AI 语义），
 * 库内容或 AI 判断变化即换声音——不稳定。音色库中有木成家族参考音频
 * （木成·平静/悲伤/兴奋/愤怒，各带参考文本）。
 *
 * 策略两层：
 *  - 绑定层（稳定）：旁白只从木成家族选基准片段（确定性取「平静」），
 *    不再全库漂移；历史绑定若已不是木成且家族可用，视为过期重新绑定。
 *  - 生成层（情境）：逐镜按情绪（emotion 字段 + 文本关键词）在木成家族内
 *    换参考片段——基准 profile 复制后仅覆盖参考音频与参考文本，
 *    绑定/校验体系不动。
 */

import type { VoiceProfile } from "@/types/tts";

/** 默认旁白音色家族（音色库资产命名前缀）。用户可通过 workflowConfig.narratorVoiceFamily 更换。 */
export interface RoleAudioCandidate {
  id: string;
  name: string;
  filePath: string;
  referenceText?: string;
  sourceLabel?: string;
}

export const DEFAULT_NARRATOR_VOICE_FAMILY = "木成";

/** 家族名 → 匹配正则（默认木成额外兼容资产路径里的拼音 mucheng；其他家族按名称匹配）。 */
export function narratorFamilyPattern(family: string = DEFAULT_NARRATOR_VOICE_FAMILY): RegExp {
  const escaped = family.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (family === DEFAULT_NARRATOR_VOICE_FAMILY) return /木成|mucheng/i;
  return new RegExp(escaped, "i");
}

export type NarratorVariant = "calm" | "sad" | "excited" | "angry";

/** 家族名 → 变体关键词（资产命名如「木成·悲伤｜平铺直叙·旁白」）。 */
const VARIANT_NAME_KEYWORDS: Record<NarratorVariant, readonly string[]> = {
  calm: ["平静", " calm"],
  sad: ["悲伤", "悲"],
  excited: ["兴奋", "喜"],
  angry: ["愤怒", "怒", "愤"],
};

/** 情境关键词（优先级：悲伤 > 愤怒 > 兴奋 > 平静默认）。 */
const VARIANT_TEXT_KEYWORDS: ReadonlyArray<{ variant: NarratorVariant; keywords: readonly string[] }> = [
  { variant: "sad", keywords: ["悲", "哀", "泪", "恸", "哽咽", "泣", "逝", "墓", "痛"] },
  { variant: "angry", keywords: ["怒", "愤", "喝道", "吼", "斥", "杀气", "暴喝"] },
  { variant: "excited", keywords: ["喜", "笑", "惊", "奋", "激动", "狂喜", "哈哈"] },
];

/** 筛选旁白家族候选（资产名或文件路径命中家族名；默认木成额外兼容 mucheng 路径）。 */
export function filterNarratorVoiceFamily(
  candidates: readonly RoleAudioCandidate[],
  family: string = DEFAULT_NARRATOR_VOICE_FAMILY,
): RoleAudioCandidate[] {
  const pattern = narratorFamilyPattern(family);
  return candidates.filter((candidate) =>
    pattern.test(candidate.name)
    || pattern.test(candidate.filePath),
  );
}

/** 旁白基准片段：确定性优先「平静」，家族为空返回 undefined（回落既有全库行为）。 */
export function pickNarratorVoiceBase(
  family: readonly RoleAudioCandidate[],
): RoleAudioCandidate | undefined {
  if (family.length === 0) return undefined;
  return (
    family.find((candidate) => VARIANT_NAME_KEYWORDS.calm.some((kw) => candidate.name.includes(kw.trim())))
    ?? family[0]
  );
}

/** 由情绪字段与台词文本判定情境变体（默认平静）。 */
export function detectNarratorVariant(input: {
  emotion?: string;
  text: string;
}): NarratorVariant {
  const haystack = `${input.emotion ?? ""}\n${input.text}`;
  for (const rule of VARIANT_TEXT_KEYWORDS) {
    if (rule.keywords.some((keyword) => haystack.includes(keyword))) return rule.variant;
  }
  return "calm";
}

/** 家族内按变体选片段（命名关键词匹配；未命中回落基准片段）。 */
export function pickNarratorClipForVariant(
  family: readonly RoleAudioCandidate[],
  variant: NarratorVariant,
): RoleAudioCandidate | undefined {
  if (family.length === 0) return undefined;
  const base = pickNarratorVoiceBase(family);
  if (variant === "calm") return base;
  const matched = family.find((candidate) =>
    VARIANT_NAME_KEYWORDS[variant].some((keyword) => candidate.name.includes(keyword.trim())),
  );
  return matched ?? base;
}

/** 生成层逐镜覆盖：复制基准 profile，仅换参考音频与参考文本（绑定/校验不动）。 */
export function buildNarratorShotProfile(
  base: VoiceProfile,
  clip: RoleAudioCandidate,
): VoiceProfile {
  return {
    ...base,
    referenceAudioPath: clip.filePath,
    referenceText: clip.referenceText?.trim() || base.referenceText,
    instruct: base.instruct,
  };
}

/**
 * 旁白逐镜 profile 解析：家族可用且基准为参考型 profile 时按情境换片段；
 * 否则原样返回基准（家族缺失/基准非参考型时不干预，保持既有行为）。
 */
export function resolveNarratorShotProfile(
  base: VoiceProfile,
  input: { emotion?: string; text: string },
  family: readonly RoleAudioCandidate[],
): VoiceProfile {
  if (family.length === 0 || base.type !== "reference") return base;
  const variant = detectNarratorVariant(input);
  const clip = pickNarratorClipForVariant(family, variant);
  if (!clip) return base;
  if (clip.filePath === base.referenceAudioPath) return base;
  return buildNarratorShotProfile(base, clip);
}

/** 既有旁白绑定是否已偏离指定家族（名与路径都不含家族标识）。 */
export function isNarratorProfileOffFamily(
  profile: VoiceProfile,
  family: string = DEFAULT_NARRATOR_VOICE_FAMILY,
): boolean {
  const pattern = narratorFamilyPattern(family);
  const name = profile.name ?? "";
  const path = profile.referenceAudioPath ?? "";
  return !pattern.test(name) && !pattern.test(path);
}
