// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

/**
 * B3 A1 新字段推导式填充最小版(2026-09-29,跨镜连续性规范 §七P2 后续):
 * 纯函数 + advisory——由分镜既有结构推导 ShotContinuityState 三个新可选字段的
 * 建议值,并给出「推导建议 vs 实际字段」差异报告。**零 store 写入、零 UI 接线、
 * 不改入参**:输出仅建议值,落字段永远由人/上游层决定(本模块不得 import 任何
 * store)。新字段不入内容指纹的决策在 visual-continuity.ts
 * visualContinuityFingerprint 处(照 inputFingerprint 先例显式剔除),本模块
 * 只读消费同口径,不触碰指纹。
 *
 * 编号真源=apps/build/chapter_video/dialogue_cue_numbering.py(A7a,§五/§七P4):
 * 本文件是其在 TS 侧的逐字同源移植(常量/正则/拆分算法/报错语义一比一),
 * 断言值由 A7a 实跑输出锁定(见同名 test);两侧格式不一致即测试红。
 * 长度语义按码点计数(python len 语义),拆分符留在左段、收尾引号跟随左段。
 */

import { effectiveKeyframes } from "@/lib/studio/keyframes";
import type {
  ShotFrameReferencePresence,
  StoryboardItem,
} from "@/types/studio";

/** A7a DEFAULT_MAX_SEGMENT_CHARS 逐字镜像(超长拆段阈值,台词容量口径)。 */
export const DEFAULT_MAX_SEGMENT_CHARS = 30;
/** A7a SENTENCE_END_CHARS 逐字镜像(句末标点,超长优先按此拆)。 */
export const SENTENCE_END_CHARS = "。！？!?…";
/** A7a CLOSING_CHARS 逐字镜像(收尾引号,切分后跟随左段)。 */
export const CLOSING_CHARS = "」』”’)】";
/** A7a BREATH_CHARS 逐字镜像(换气/停顿符,句拆后仍超长按此拆)。 */
export const BREATH_CHARS = "，、；：,;:";
/** A7a UNIT_SEPARATOR_RE 逐字镜像(台词单元=store 既有 <br> 分隔约定)。 */
const UNIT_SEPARATOR_RE = /<br\s*\/?>/i;
/** A7a PRIMARY_SPEAKER_PREFIX_RE 逐字镜像(lines 的「名：」主说话人前缀)。 */
const PRIMARY_SPEAKER_PREFIX_RE = /^[^：:<>\n]{1,12}[：:]\s*/;
/** A7a CUE_ID_PATTERN 逐字镜像(编号格式:S{镜号≥2位}-D{台词序}{小写段序})。 */
export const CUE_ID_PATTERN = /^S\d{2,}-D\d+[a-z]$/;

/** 单条台词 cue(键集与 A7a build_shot_cues 产物一比一)。 */
export interface DialogueCue {
  cueId: string;
  shot: number;
  unit: number;
  segment: string;
  text: string;
}

/** A7a segment_letter 镜像:段序字母 a..z;越界显式抛错(单元过长属异常输入)。 */
export function segmentLetter(index: number): string {
  if (index < 1 || index > 26) {
    throw new Error(`段序超出 a-z 范围: ${index}(单元过长或停顿符异常)`);
  }
  return String.fromCharCode("a".charCodeAt(0) + index - 1);
}

/** A7a split_dialogue_units 镜像:按 <br> 分单元、单元 strip、空单元丢弃。 */
export function splitDialogueUnits(text: unknown): string[] {
  const raw = String(text ?? "");
  return raw
    .split(UNIT_SEPARATOR_RE)
    .map((unit) => unit.trim())
    .filter((unit) => unit.length > 0);
}

/** A7a strip_primary_speaker_prefix 镜像:剥一次「名：」前缀(镜内换人保留)。 */
export function stripPrimarySpeakerPrefix(text: string): string {
  return text.replace(PRIMARY_SPEAKER_PREFIX_RE, "");
}

/** A7a _split_after_runs 镜像:在 cutChars 连续 run(+后随收尾引号)之后切,
 *  切分符留在左段;码点语义(python 逐字符=逐码点)。 */
function splitAfterRuns(part: string, cutChars: string): string[] {
  const chars = Array.from(part);
  const cutSet = new Set(Array.from(cutChars));
  const closingSet = new Set(Array.from(CLOSING_CHARS));
  const pieces: string[] = [];
  let start = 0;
  let index = 0;
  while (index < chars.length) {
    if (cutSet.has(chars[index]!)) {
      let end = index + 1;
      while (end < chars.length && (cutSet.has(chars[end]!) || closingSet.has(chars[end]!))) {
        end += 1;
      }
      pieces.push(chars.slice(start, end).join(""));
      start = end;
      index = end;
    } else {
      index += 1;
    }
  }
  if (start < chars.length) {
    pieces.push(chars.slice(start).join(""));
  }
  return pieces;
}

/** A7a split_overlong_unit 镜像:≤阈值不拆;超长先按句末标点,仍超长按换气符;
 *  无停顿不硬切(防断词),整段保留;空段滤除,全空回退原文。 */
export function splitOverlongUnit(unit: string, maxSegmentChars = DEFAULT_MAX_SEGMENT_CHARS): string[] {
  const text = unit.trim();
  if (Array.from(text).length <= maxSegmentChars) {
    return [text];
  }
  const segments: string[] = [];
  for (const sentence of splitAfterRuns(text, SENTENCE_END_CHARS)) {
    if (Array.from(sentence).length <= maxSegmentChars) {
      segments.push(sentence);
      continue;
    }
    segments.push(...splitAfterRuns(sentence, BREATH_CHARS));
  }
  const pieces = segments.filter((piece) => piece.trim().length > 0);
  return pieces.length > 0 ? pieces : [text];
}

/** A7a build_shot_cues 镜像:镜内编号 S{镜号:02d}-D{台词序}{段序};单元序密集、
 *  段序 a 起;镜号两位零填充(≥100 自然三位)。 */
export function buildShotCues(
  shotIndex: number,
  text: unknown,
  maxSegmentChars = DEFAULT_MAX_SEGMENT_CHARS,
): DialogueCue[] {
  const cues: DialogueCue[] = [];
  const paddedShot = String(shotIndex).padStart(2, "0");
  splitDialogueUnits(text).forEach((unit, unitIndex) => {
    splitOverlongUnit(unit, maxSegmentChars).forEach((segment, segmentIndex) => {
      cues.push({
        cueId: `S${paddedShot}-D${unitIndex + 1}${segmentLetter(segmentIndex + 1)}`,
        shot: shotIndex,
        unit: unitIndex + 1,
        segment: segmentLetter(segmentIndex + 1),
        text: segment,
      });
    });
  });
  return cues;
}

/** A7a _shot_index 镜像:index 为正整数优先;运行时缺失则从 id 尾号解析;
 *  双失败显式抛错(边界数据兜底,分镜类型层 index 恒在)。 */
function shotIndex(storyboard: Pick<StoryboardItem, "id" | "index">): number {
  if (typeof storyboard.index === "number" && Number.isInteger(storyboard.index) && storyboard.index > 0) {
    return storyboard.index;
  }
  const match = /-(\d+)$/.exec(String(storyboard.id ?? ""));
  if (match) {
    return Number.parseInt(match[1]!, 10);
  }
  throw new Error(`分镜缺 index 且 id 无镜号可解析: ${storyboard.id}`);
}

type DialogueSource = Pick<StoryboardItem, "id" | "index" | "line" | "lines" | "ttsSpokenText">;

/** A7a story_cues_from_shot 镜像(分镜表侧):line 优先,缺则 lines 剥主说话人前缀。 */
export function deriveDialogueCues(storyboard: DialogueSource, maxSegmentChars = DEFAULT_MAX_SEGMENT_CHARS): DialogueCue[] {
  const text = storyboard.line !== undefined && storyboard.line !== null
    ? storyboard.line
    : stripPrimarySpeakerPrefix(String(storyboard.lines ?? ""));
  return buildShotCues(shotIndex(storyboard), text, maxSegmentChars);
}

/** A7a tts_cues_from_shot 镜像(TTS 绑定侧):ttsSpokenText 链值,缺失=空(零 cue)。 */
export function deriveTtsCues(storyboard: DialogueSource, maxSegmentChars = DEFAULT_MAX_SEGMENT_CHARS): DialogueCue[] {
  return buildShotCues(shotIndex(storyboard), storyboard.ttsSpokenText, maxSegmentChars);
}

/** §一⑦ dialogueCueId 建议值:本镜首条 cue 编号;无台词=undefined(无可建议)。 */
export function deriveDialogueCueId(storyboard: DialogueSource): string | undefined {
  return deriveDialogueCues(storyboard)[0]?.cueId;
}

/** §一⑦ dialogueText 建议值:本镜完整台词文字(store <br> 约定合回);无台词=undefined。 */
export function deriveDialogueText(storyboard: DialogueSource): string | undefined {
  const units = splitDialogueUnits(
    storyboard.line !== undefined && storyboard.line !== null
      ? storyboard.line
      : stripPrimarySpeakerPrefix(String(storyboard.lines ?? "")),
  );
  return units.length > 0 ? units.join("<br>") : undefined;
}

/**
 * §一⑧ frameReferencePresence 建议值:首/尾帧三态,按 I1-I4 不变式实据推导——
 *  - 帧读取一律经 effectiveKeyframes 归一(keyframes.ts:禁止直读 keyframes):
 *    无 keyframes 旧数据由 mediaRef 合成单帧;两者皆无=该镜尚无任何画面;
 *  - present=帧有 mediaRef 且路径非空且过 I4 受管协议纪律(data:/blob:/http/file
 *    =无实际可用受管图,按 missing 计,keyframes.ts I4 同源口径);
 *  - pending=空槽(帧规划器建槽待补,合法中间态:「待补」可查询化正是 §一⑧);
 *  - missing=无任何可推导画面载体;
 *  - 尾帧=生效帧序列末帧(单帧镜首尾同图,与 I2V 单图语义一致,不另造语义)。
 */
export function deriveFrameReferencePresence(
  storyboard: Pick<StoryboardItem, "keyframes" | "mediaRef">,
): { first: ShotFrameReferencePresence; last: ShotFrameReferencePresence } {
  const frames = effectiveKeyframes(storyboard);
  if (frames.length === 0) {
    return { first: "missing", last: "missing" };
  }
  return {
    first: frameReferencePresence(frames[0]!.mediaRef),
    last: frameReferencePresence(frames[frames.length - 1]!.mediaRef),
  };
}

function frameReferencePresence(mediaRef: StoryboardItem["mediaRef"]): ShotFrameReferencePresence {
  const path = mediaRef?.path ?? "";
  if (!mediaRef?.kind || !path) return "pending";
  if (/^(?:data:|blob:|https?:|file:)/.test(path)) return "missing";
  return "present";
}

/** 差异报告覆盖的推导字段(worldAnchor 无既有结构可推导,§一① 缺口本体,不在列)。 */
export type ContinuityDerivedFieldKey = "dialogueCueId" | "dialogueText" | "frameReferencePresence";

export type ContinuityDerivedFieldStatus =
  /** 实际字段与推导一致。 */
  | "match"
  /** 实际字段缺省而推导有建议值(可填机会;advisory,不代填)。 */
  | "absent-actual"
  /** 实际字段与推导分歧(含「字段有值而结构无来源」)。 */
  | "divergent-actual";

export interface ContinuityDerivedFieldDiff {
  storyboardId: string;
  field: ContinuityDerivedFieldKey;
  status: ContinuityDerivedFieldStatus;
  derived?: string | { first: ShotFrameReferencePresence; last: ShotFrameReferencePresence };
  actual?: string | { first: ShotFrameReferencePresence; last: ShotFrameReferencePresence };
}

/**
 * 「推导建议 vs 实际字段」差异报告(advisory 只读):给
 * visual-continuity.ts continuityStateExtendedFieldIssues 消费处旁挂的对照器——
 * 守卫机检判「字段合法与否」,本报告判「字段与既有结构一致与否」。只读消费:
 * 不写 store、不改入参、不产生 VisualContinuityIssue(不进审计红绿)。
 * 条目产出规则:推导有建议值或实际字段有值才产出;两者皆无(如无台词且无值)
 * 不产出。frameReferencePresence 恒可推导,恒产出。
 */
export function continuityDerivedFieldDiff(
  storyboard: Pick<StoryboardItem, "id" | "index" | "line" | "lines" | "ttsSpokenText" | "keyframes" | "mediaRef" | "continuityState">,
): ContinuityDerivedFieldDiff[] {
  const continuity = storyboard.continuityState;
  const derivedPresence = deriveFrameReferencePresence(storyboard);
  const entries: ContinuityDerivedFieldDiff[] = [];
  const push = (
    field: ContinuityDerivedFieldKey,
    derived: ContinuityDerivedFieldDiff["derived"],
    actual: ContinuityDerivedFieldDiff["actual"],
  ): void => {
    if (derived === undefined && actual === undefined) return;
    const equal = typeof derived === "string" || typeof actual === "string"
      ? derived === actual
      : derived !== undefined
        && actual !== undefined
        && derived.first === actual.first
        && derived.last === actual.last;
    entries.push({
      storyboardId: storyboard.id,
      field,
      status: actual === undefined ? "absent-actual" : equal ? "match" : "divergent-actual",
      ...(derived !== undefined ? { derived } : {}),
      ...(actual !== undefined ? { actual } : {}),
    });
  };
  push("dialogueCueId", deriveDialogueCueId(storyboard), continuity?.dialogueCueId);
  push("dialogueText", deriveDialogueText(storyboard), continuity?.dialogueText);
  push("frameReferencePresence", derivedPresence, continuity?.frameReferencePresence);
  return entries;
}
