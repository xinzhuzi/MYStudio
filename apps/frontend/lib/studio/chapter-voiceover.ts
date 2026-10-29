import type { StoryboardSpeechUtterance } from "@/types/studio-storyboard-types";
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
  speechUtterances?: StoryboardSpeechUtterance[];
  lines?: string;
  speechSpeakerFallback?: "narrator";
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
  const parsed = parseStoryboardSpeech(input.lines, input.description);
  const speechUtterances = parsed.map((speech) => {
    let speakerId: TtsSpeakerId;
    try {
      speakerId = resolveCanonicalSpeakerId(speech.speaker, input.characters);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      if (input.unknownSpeaker === "narrator" && reason.includes("无法解析到角色资产")) speakerId = "narrator";
      else throw new Error(`分镜 ${input.storyboardId} speaker 解析失败: ${reason}`);
    }
    const text = normalizeTtsSpokenText(speech.line);
    if (!text) throw new Error(`分镜 ${input.storyboardId} 的口播文本为空`);
    return { speaker: speech.speaker, speakerId, text };
  });
  const speech = parsed[0];
  const speakerId = speechUtterances[0].speakerId;
  const ttsSpokenText = speechUtterances.map((part) => part.text).join(" ");

  return {
    ...normalizeSourceIdentity(input),
    ...(input.chapterId ? { chapterId: input.chapterId } : {}),
    storyboardId: input.storyboardId,
    index: input.index,
    speaker: speech.speaker,
    speakerId,
    line: parsed.map((part) => part.line).join("\n"),
    speechUtterances,
    ...(input.unknownSpeaker ? { speechSpeakerFallback: input.unknownSpeaker } : {}),
    lines: input.lines,
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

/** 情绪注记后缀（角色名后的「（凶横）/（低哑）」等 1-12 字括注，1029 耳感笔触约定）——
 * 剥注记得纯角色名；剥空/整段是括注则不成候选（防「（凶横）：」误当旁白）。 */
const MOOD_ANNOTATION_RE = /[（(【\[][^\s()（）【】\[\]]{1,12}[)）\]】]\s*$/;
export function stripMoodAnnotation(speaker: string): string {
  return speaker.trim().replace(MOOD_ANNOTATION_RE, "").trim();
}

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

  const voStripped = value.replace(VOICEOVER_SUFFIX_RE, "").trim();
  const candidates = [...new Set([value, voStripped, stripMoodAnnotation(voStripped)].filter(Boolean))];
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
    if (item.speechUtterances) {
      if (item.speechUtterances[0]?.speakerId !== item.speakerId || item.speechUtterances[0]?.speaker !== item.speaker) errors.push(`分镜 ${item.storyboardId} 首个声音身份不匹配`);
      for (const part of item.speechUtterances) speakerIds.add(part.speakerId);
      if (missing.length === 0) {
        try { assertStoryboardSpeech(item); } catch (error) { errors.push(`分镜 ${item.storyboardId} ${error instanceof Error ? error.message : String(error)}`); }
      }
    } else if (item.speakerId) speakerIds.add(item.speakerId);
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

export function parseStoryboardSpeech(lines: string | undefined, description: string) {
  const raw = lines?.trim() ?? "";
  if (EMPTY_SPEECH.has(raw)) return [buildNarration(description)];
  const parts: { speaker: string; line: string }[] = [];
  for (const line of raw.split(/\r?\n/).map((value) => value.trim()).filter(Boolean)) {
    // A label occupies the start of a line; colons in its body remain speech.
    const match = line.match(/^([^:：。！？，“”「」]{1,64})[:：](.*)$/);
    if (match) parts.push({ speaker: match[1].trim(), line: match[2].trim() });
    else if (parts.length) parts[parts.length - 1].line += ` ${line}`;
    else parts.push({ speaker: "旁白", line });
  }
  if (parts.length === 1 && EMPTY_SPEECH.has(parts[0].line)) return [buildNarration(description)];
  if (parts.length > 1 && parts.some((part) => EMPTY_SPEECH.has(part.line))) {
    throw new Error("混合声音包含空白或占位台词");
  }
  return parts;
}

/** Validate persisted structured speech against original lines before any service call. */
export function assertStoryboardSpeech(input: {
  lines?: string; speaker?: string; speakerId?: TtsSpeakerId; ttsSpokenText?: string;
  speechUtterances?: StoryboardSpeechUtterance[]; speechSpeakerFallback?: "narrator";
}, characters?: VoiceoverCharacterIdentity[]): void {
  const parts = input.speechUtterances;
  const raw = input.lines?.trim() && /^([^:：。！？，“”「」]{1,64})[:：]/m.test(input.lines) ? parseStoryboardSpeech(input.lines, input.ttsSpokenText ?? "") : undefined;
  if (!parts) {
    if (raw && raw.length > 1) throw new Error("混合声音缺少 speechUtterances");
    if (raw && characters) {
      const canonical = resolveCanonicalSpeakerId(raw[0].speaker, characters);
      // narrator 代读形态(1029 存量主形态):镜 speaker 字段就是该角色、speakerId 走
      // narrator 通道(配音经 tts.json 档案而非 speakerId 选声)——标签与镜字段
      // 指向同一角色即视为一致;仅当两边各指不同角色才算不匹配。
      const fieldCanonical = input.speaker?.trim()
        ? resolveCanonicalSpeakerId(input.speaker, characters)
        : undefined;
      if (canonical !== input.speakerId && canonical !== fieldCanonical) {
        throw new Error("声音 speakerId 与原始标签不匹配");
      }
    }
    return;
  }
  if (!parts.length || parts.some((part) => !part.text?.trim() || !part.speaker?.trim() || !/^(narrator|character:.+)$/.test(part.speakerId))) throw new Error("speechUtterances 无效");
  if (parts[0].speakerId !== input.speakerId || parts[0].speaker !== input.speaker) throw new Error("首个声音 speakerId 不匹配");
  if (parts.map((part) => part.text).join(" ") !== input.ttsSpokenText) throw new Error("speechUtterances 文本不匹配");
  if (raw && (raw.length !== parts.length || raw.some((part, i) => part.speaker !== parts[i].speaker || normalizeTtsSpokenText(part.line) !== parts[i].text))) throw new Error("speechUtterances 与原始声音顺序/文本不匹配");
  for (const part of parts) {
    if (characters) {
      let canonical: TtsSpeakerId;
      try { canonical = resolveCanonicalSpeakerId(part.speaker, characters); }
      catch (error) {
        if (input.speechSpeakerFallback === "narrator" && error instanceof Error && error.message.includes("无法解析到角色资产")) canonical = "narrator";
        else throw error;
      }
      if (canonical !== part.speakerId) throw new Error("声音 speakerId 与原始标签不匹配");
    }
    if (isNarratorSpeaker(part.speaker) && part.speakerId !== "narrator") throw new Error("旁白身份不匹配");
    if (!isNarratorSpeaker(part.speaker) && part.speakerId === "narrator" && input.speechSpeakerFallback !== "narrator") throw new Error("角色身份不能隐式归旁白");
  }
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

/** 10-11 音频分工:导出复用——外挂旁白拆行(externalNarratorSpokenText)与
 * 本文件共用同一规整口径(剥离 markdown 记号/舞台指示括注/折叠空白)。 */
export function normalizeTtsSpokenText(line: string) {
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
