import type { TtsSpeakerId } from "@/types/tts";
import type { StudioSourceIdentity } from "@/types/studio";

const NARRATOR_LABELS = new Set(["旁白", "vo", "画外音", "解说"]);
const EMPTY_SPEECH = new Set(["", "—", "-", "无", "无台词", "无对白"]);

export interface VoiceoverCharacterIdentity {
  characterId: string;
  name: string;
  aliases: string[];
}

export interface StoryboardVoiceoverInput extends StudioSourceIdentity {
  chapterId?: string;
  storyboardId: string;
  index: number;
  description: string;
  lines?: string;
  duration: number;
  emotion?: string;
  characters: VoiceoverCharacterIdentity[];
  /** 未注册说话人（群演等）兜底策略：narrator=归旁白音色，台词保留原说话人署名。缺省严格抛错。 */
  unknownSpeaker?: "narrator";
}

export interface StoryboardVoiceoverItem extends StudioSourceIdentity {
  chapterId?: string;
  storyboardId: string;
  index: number;
  speaker: string;
  speakerId: TtsSpeakerId;
  line: string;
  ttsSpokenText: string;
  durationTarget: number;
  voiceStyle: string;
  requiresFixedVoice: true;
}

export interface ChapterVoiceoverAudit {
  passed: boolean;
  errors: string[];
  speakerIds: TtsSpeakerId[];
}

export interface ChapterVoiceoverAuditExpectation extends StudioSourceIdentity {
  chapterId?: string;
}

export function buildStoryboardVoiceoverItem(
  input: StoryboardVoiceoverInput,
): StoryboardVoiceoverItem {
  const speech = parseStoryboardSpeech(input.lines, input.description);
  let speakerId: TtsSpeakerId;
  try {
    speakerId = resolveCanonicalSpeakerId(speech.speaker, input.characters);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    // 群演兜底：仅「未注册说话人」可归旁白；一对多冲突是资产数据问题，恒抛错
    const unresolved = error instanceof Error && error.message.includes("无法解析到角色资产");
    if (input.unknownSpeaker === "narrator" && unresolved) {
      speakerId = "narrator";
    } else {
      throw new Error(`分镜 ${input.storyboardId} speaker 解析失败: ${reason}`);
    }
  }
  const ttsSpokenText = normalizeTtsSpokenText(speech.line);
  if (!ttsSpokenText) {
    throw new Error(`分镜 ${input.storyboardId} 的口播文本为空`);
  }

  return {
    ...normalizeSourceIdentity(input),
    ...(input.chapterId ? { chapterId: input.chapterId } : {}),
    storyboardId: input.storyboardId,
    index: input.index,
    speaker: speech.speaker,
    speakerId,
    line: speech.line,
    ttsSpokenText,
    durationTarget: resolveDurationTarget(input.duration, ttsSpokenText),
    voiceStyle: buildVoiceStyle(speakerId, input.emotion),
    requiresFixedVoice: true,
  };
}

/** 画外音记法后缀（角色名后的 OS / V.S. / V.O. / 画外音，含括号形态）——确定性归一，非模糊匹配。 */
const VOICEOVER_MARKER = String.raw`(?:O\.?S\.?|V\.?S\.?|V\.?O\.?|OS|VS|VO|画外音)`;
const VOICEOVER_SUFFIX_RE = new RegExp(
  String.raw`[\s(（\[【]*${VOICEOVER_MARKER}[\s)）\]】.]*$`,
  "i",
);

export function isNarratorSpeaker(speaker: string): boolean {
  return NARRATOR_LABELS.has(speaker.trim().toLocaleLowerCase("zh-Hans-CN"));
}

export function resolveCanonicalSpeakerId(
  speaker: string,
  characters: VoiceoverCharacterIdentity[],
): TtsSpeakerId {
  const value = speaker.trim();
  if (isNarratorSpeaker(value)) {
    return "narrator";
  }

  if (value.startsWith("character:")) {
    const characterId = value.slice("character:".length);
    const matches = characters.filter((character) => character.characterId === characterId);
    return requireUniqueCharacter(value, matches);
  }

  const stripped = value.replace(VOICEOVER_SUFFIX_RE, "").trim();
  const candidates = stripped && stripped !== value ? [value, stripped] : [value];
  const nameMatches = characters.filter((character) =>
    candidates.includes(character.name.trim()),
  );
  if (nameMatches.length > 0) return requireUniqueCharacter(value, nameMatches);

  const aliasMatches = characters.filter((character) =>
    character.aliases.some((alias) => candidates.includes(alias.trim())),
  );
  return requireUniqueCharacter(value, aliasMatches);
}

export function auditChapterVoiceoverPlan(
  items: StoryboardVoiceoverItem[],
  sourceStoryboardCount: number,
  expected: ChapterVoiceoverAuditExpectation = {},
): ChapterVoiceoverAudit {
  const errors: string[] = [];
  if (!(sourceStoryboardCount > 0)) errors.push("源分镜数量必须大于 0");
  if (items.length !== sourceStoryboardCount) {
    errors.push(`口播数量与源分镜不一致: ${items.length}/${sourceStoryboardCount}`);
  }

  const speakerIds = new Set<TtsSpeakerId>();
  for (const item of items) {
    if (expected.chapterId && item.chapterId !== expected.chapterId) {
      errors.push(`分镜 ${item.storyboardId} chapterId 与期望不一致: ${item.chapterId ?? "缺失"}/${expected.chapterId}`);
    }
    if (expected.sourceId && item.sourceId !== expected.sourceId) {
      errors.push(`分镜 ${item.storyboardId} sourceId 与期望不一致: ${item.sourceId ?? "缺失"}/${expected.sourceId}`);
    }
    if (expected.revision !== undefined && item.revision !== expected.revision) {
      errors.push(`分镜 ${item.storyboardId} revision 与期望不一致: ${item.revision ?? "缺失"}/${expected.revision}`);
    }
    const missing = [
      ["speaker", item.speaker],
      ["speakerId", item.speakerId],
      ["line", item.line],
      ["ttsSpokenText", item.ttsSpokenText],
      ["voiceStyle", item.voiceStyle],
    ].filter(([, value]) => !String(value ?? "").trim());
    if (missing.length > 0) {
      errors.push(
        `分镜 ${item.storyboardId} 缺少 ${missing.map(([field]) => field).join(", ")}`,
      );
    }
    if (!(item.durationTarget > 0)) {
      errors.push(`分镜 ${item.storyboardId} durationTarget 必须大于 0`);
    }
    if (item.requiresFixedVoice !== true) {
      errors.push(`分镜 ${item.storyboardId} requiresFixedVoice 必须为 true`);
    }
    if (item.speakerId) speakerIds.add(item.speakerId);
  }

  return {
    passed: errors.length === 0,
    errors,
    speakerIds: [...speakerIds].sort(),
  };
}

export function assertChapterVoiceoverPlan(
  items: StoryboardVoiceoverItem[],
  sourceStoryboardCount: number,
  expected: ChapterVoiceoverAuditExpectation = {},
) {
  const audit = auditChapterVoiceoverPlan(items, sourceStoryboardCount, expected);
  if (!audit.passed) throw new Error(audit.errors.join("；"));
  return audit;
}

function normalizeSourceIdentity(identity: StudioSourceIdentity): StudioSourceIdentity {
  const sourceId = identity.sourceId?.trim();
  const revision = identity.revision;
  return {
    ...(sourceId ? { sourceId } : {}),
    ...(typeof revision === "number" && Number.isInteger(revision) && revision > 0 ? { revision } : {}),
  };
}

function parseStoryboardSpeech(lines: string | undefined, description: string) {
  const raw = lines?.trim() ?? "";
  if (EMPTY_SPEECH.has(raw)) return buildNarration(description);

  const colonIndex = raw.search(/[:：]/);
  if (colonIndex < 0) {
    return {
      speaker: "旁白",
      line: raw,
    };
  }

  const speaker = raw.slice(0, colonIndex).trim();
  const line = raw.slice(colonIndex + 1).trim();
  if (!speaker || EMPTY_SPEECH.has(line)) return buildNarration(description);
  return { speaker, line };
}

function buildNarration(description: string) {
  const compact = description.replace(/\s+/g, " ").trim();
  if (!compact) throw new Error("无对白分镜缺少可生成旁白的画面描述");
  const sentence = compact.match(/^.{1,48}?[。！？]/)?.[0] ?? compact.slice(0, 48);
  return {
    speaker: "旁白",
    line: /[。！？]$/.test(sentence) ? sentence : `${sentence}。`,
  };
}

function normalizeTtsSpokenText(line: string) {
  return line
    .replace(/[`*_#]/g, "")
    .replace(/[\[【][^\]】]*(?:动作|画面|音效|字幕|提示)[^\]】]*[\]】]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function resolveDurationTarget(duration: number, spokenText: string) {
  const sourceDuration = Number.isFinite(duration) ? duration : 0;
  if (sourceDuration > 0) return sourceDuration;
  return Math.max(Math.ceil(spokenText.length / 4) + 0.4, 1);
}

function buildVoiceStyle(speakerId: TtsSpeakerId, emotion?: string) {
  const mood = emotion?.trim() || "克制自然";
  if (speakerId === "narrator") {
    return `电影级中文旁白，${mood}，厚重克制，停顿自然。`;
  }
  return `中文角色对白，${mood}，贴合人物身份，停顿自然。`;
}

function requireUniqueCharacter(
  speaker: string,
  matches: VoiceoverCharacterIdentity[],
): TtsSpeakerId {
  if (matches.length === 0) {
    throw new Error(`speaker 无法解析到角色资产: ${speaker}`);
  }
  if (matches.length > 1) {
    throw new Error(
      `speaker 对应多个角色资产: ${speaker} -> ${matches
        .map((character) => character.characterId)
        .join(", ")}`,
    );
  }
  return `character:${matches[0]!.characterId}`;
}
