import type { StoryboardItem, StoryboardKeyframe } from "@/types/studio";
import { KEYFRAME_MAX, buildKeyframeId } from "./keyframes";

/**
 * 帧规划器(design §2.5)——规则驱动,零 AI 成本。
 * 新章节分镜表落库后自动建帧槽;回接零候选镜/缺帧补生成走同一入口。
 * 产出空槽(mediaRef.path 为空,reason="plan" 写入),帧时刻描述供生图提示词
 * 组装帧差异段使用(M3)。
 *
 * 换帧点对齐台词句边界(2026-08-27 实测依据: 新38镜台词均值 1.9 字/s,
 * 9 镜 <1.5 字/s 属视觉叙事镜): 有台词镜按"逐句累计时长(字数/4字每秒 +
 * 句间停顿 0.4s)"推算句边界,中间帧 inUs 落在边界 ±0.5s 内吸附——
 * 避免台词念到一半叠化换构图;偏空镜退回等分。
 */

export const DIALOGUE_CHARS_PER_SECOND = 4;
export const INTER_LINE_PAUSE_US = 400_000;
export const DIALOGUE_SNAP_US = 500_000;
const FRAME_IN_US_STEP = 500_000; // 0.5s 取整步进(µs)

export interface FramePlannerInput {
  id: string;
  durationUs: number;
  videoDesc?: string;
  /** 原始台词列(多句以 <br> 或；分隔,含说话人前缀) */
  lines?: string;
  shotSemantics?: StoryboardItem["shotSemantics"];
}

/** 从台词原文拆出逐句正文(剥说话人前缀),用于句时长推算 */
export function splitDialogueLines(lines: string | undefined): string[] {
  if (!lines?.trim()) return [];
  return lines
    .split(/<br\s*\/?>|；|;/)
    .map((raw) => raw.trim())
    .filter(Boolean)
    .map((raw) => raw.replace(/^[^：:]{1,12}[：:]/, "").trim())
    .filter(Boolean);
}

function spokenChars(text: string): number {
  return text.replace(/[\s，。？！、：；—…""''「」『』（）]/g, "").length;
}

/** 逐句累计时长 → 句边界时间点(相对镜起点,ms,含 0 与句尾点) */
export function dialogueBoundaryPointsUs(lines: string | undefined): number[] {
  const spoken = splitDialogueLines(lines);
  if (!spoken.length) return [];
  const points: number[] = [0];
  let cursor = 0;
  for (const line of spoken) {
    cursor += (spokenChars(line) / DIALOGUE_CHARS_PER_SECOND) * 1_000_000;
    points.push(Math.round(cursor));
    cursor += INTER_LINE_PAUSE_US;
  }
  return points;
}

function snapToBoundary(inUs: number, boundaries: number[]): number {
  let best = inUs;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const boundary of boundaries) {
    const distance = Math.abs(boundary - inUs);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = boundary;
    }
  }
  return bestDistance <= DIALOGUE_SNAP_US ? best : inUs;
}

function roundToStep(valueUs: number): number {
  return Math.round(valueUs / FRAME_IN_US_STEP) * FRAME_IN_US_STEP;
}

function semanticsMomentText(
  semantics: FramePlannerInput["shotSemantics"],
  phase: "in" | "out",
): string {
  const actions = (semantics?.visibleCharacters ?? [])
    .map((character) => `${character.name}${phase === "in" ? character.actionIn : character.actionOut}`)
    .filter(Boolean);
  return actions.join("；");
}

function midDescription(videoDesc?: string): string {
  if (!videoDesc) return "中段动作";
  const clean = videoDesc.replace(/\s+/g, "");
  const mid = Math.floor(clean.length / 2);
  return clean.slice(Math.max(0, mid - 12), mid + 18);
}

/** 规划帧槽:≤10s 两帧(开场/收尾);>10s 三帧(+中段)。上限 KEYFRAME_MAX。 */
export function planStoryboardKeyframes(input: FramePlannerInput): StoryboardKeyframe[] {
  const durationUs = Math.max(1, Math.round(input.durationUs));
  const frameCount = durationUs <= 10_000_000 ? 2 : Math.min(3, KEYFRAME_MAX);
  const lastInUs = Math.max(0, durationUs - Math.min(2_000_000, durationUs * 0.1));
  const boundaries = dialogueBoundaryPointsUs(input.lines);

  const slots: StoryboardKeyframe[] = [];
  for (let index = 0; index < frameCount; index += 1) {
    const rawInUs =
      index === 0 ? 0 : index === frameCount - 1 ? lastInUs : Math.round(durationUs / frameCount) * index;
    const snapped = index === 0
      ? 0
      : Math.min(snapToBoundary(roundToStep(rawInUs), boundaries), lastInUs); // 先取整后吸附:边界点是台词推算精确值
    const isLast = index === frameCount - 1;
    const moment =
      index === 0
        ? `开场站位:${semanticsMomentText(input.shotSemantics, "in") || midDescription(input.videoDesc)}`
        : isLast
          ? `收尾态:${semanticsMomentText(input.shotSemantics, "out") || midDescription(input.videoDesc)}`
          : `中段:${midDescription(input.videoDesc)}`;
    slots.push({
      frameId: buildKeyframeId(input.id, index + 1),
      mediaRef: { kind: "image", path: "" },
      inUs: snapped,
      origin: { kind: "generated" },
      momentDescription: moment,
    });
  }
  // 保序去重(吸附可能撞点):同点后帧顺延一步
  for (let index = 1; index < slots.length; index += 1) {
    if (slots[index].inUs <= slots[index - 1].inUs) {
      slots[index] = { ...slots[index], inUs: slots[index - 1].inUs + FRAME_IN_US_STEP };
    }
  }
  return slots;
}
