import type { TtsEngine, TtsSpeakerId } from "@/types/tts";

/** 音色分配输入：来自角色库的轻量画像。 */
export interface VoiceAssignerCharacter {
  id: string;
  name: string;
  gender?: string;
  age?: string;
  personality?: string;
}

export interface VoiceAssignment {
  characterId: string;
  speakerId: TtsSpeakerId;
  presetVoiceId: string;
  engine: TtsEngine;
  reason: string;
}

/** huobao voice_assigner 思路：性别+年龄+性格 → 中文 Qwen 预设音色（确定性映射）。 */
const VOICE_ENGINE: TtsEngine = "qwen_custom_voice";

const MALE_HINTS = ["男", "male", "man", "boy", "公"];
const FEMALE_HINTS = ["女", "female", "woman", "girl", "母"];
const OLD_HINTS = ["老", "年迈", "暮年", "老年", "花甲", "古稀"];
const GENTLE_HINTS = ["温柔", "慈", "柔和", "温和", "和善", "婉约"];
const HUSKY_HINTS = ["沙哑", "粗犷", "豪迈", "活泼", "痞", "玩世"];

function matches(text: string | undefined, hints: string[]): boolean {
  if (!text) return false;
  return hints.some((hint) => text.includes(hint));
}

function classifyGender(gender: string | undefined): "male" | "female" | "unknown" {
  if (matches(gender, FEMALE_HINTS)) return "female";
  if (matches(gender, MALE_HINTS)) return "male";
  return "unknown";
}

/**
 * 给单个角色分配音色。规则（确定性、可复算）：
 * - 男 + 老年 / 沉稳 → Uncle_Fu（低沉成熟）
 * - 男 + 沙哑活泼 → Eric；其余男 → Dylan（清晰年轻）
 * - 女 + 温柔慈和 → Serena（温暖柔和）；其余女 → Vivian（明亮年轻）
 * - 性别未知 → 取中性可用默认 Vivian，并在 reason 标注需人工确认
 */
export function assignVoiceForCharacter(character: VoiceAssignerCharacter): VoiceAssignment {
  const speakerId: TtsSpeakerId = `character:${character.id}`;
  const gender = classifyGender(character.gender);
  const isOld = matches(character.age, OLD_HINTS) || matches(character.personality, ["威严", "沉稳", "老成"]);
  const isGentle = matches(character.personality, GENTLE_HINTS);
  const isHusky = matches(character.personality, HUSKY_HINTS);

  let presetVoiceId: string;
  let reason: string;

  if (gender === "male") {
    if (isOld) {
      presetVoiceId = "Uncle_Fu";
      reason = "男·成熟/威严 → 低沉成熟男声 Uncle Fu";
    } else if (isHusky) {
      presetVoiceId = "Eric";
      reason = "男·活泼/沙哑 → 略带沙哑的活泼男声 Eric";
    } else {
      presetVoiceId = "Dylan";
      reason = "男·青年默认 → 清晰自然的年轻男声 Dylan";
    }
  } else if (gender === "female") {
    if (isGentle) {
      presetVoiceId = "Serena";
      reason = "女·温柔慈和 → 温暖柔和的女声 Serena";
    } else {
      presetVoiceId = "Vivian";
      reason = "女·默认/明媚 → 明亮年轻的女声 Vivian";
    }
  } else {
    presetVoiceId = "Vivian";
    reason = "性别未知 → 暂用中性默认 Vivian，建议人工确认";
  }

  return { characterId: character.id, speakerId, presetVoiceId, engine: VOICE_ENGINE, reason };
}

export function assignVoicesForCharacters(characters: VoiceAssignerCharacter[]): VoiceAssignment[] {
  return characters.map((character) => assignVoiceForCharacter(character));
}
