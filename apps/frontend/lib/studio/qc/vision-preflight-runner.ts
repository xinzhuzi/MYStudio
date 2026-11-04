/**
 * AC4 审片预审 runner。
 *
 * 一次 provider 调用要么送 1 张主进程已缩放的探针帧(装配/形体/文字:这三维单帧看得全),
 * 要么送 2 张相邻镜中帧(跨镜一致:漂移是关系判定,单帧没有对照物)。
 * 边界任务把 pre/blend/post 绑到同一份转场决策上下文,但仍逐帧发。
 */

import type { ChapterQcFindingV1 } from "@rendering/plugins/videoqc/chapter-qc-types";
import type { MultimodalCaller } from "./semantic-runner";

export type VisionPreflightFrameKind = "mid" | "pre" | "blend" | "post";

export interface VisionPreflightFrameInput {
  shotId: string;
  ordinal: number;
  kind: VisionPreflightFrameKind;
  tS: number;
  frameUrl: string;
}

export interface VisionPreflightDecisionInput {
  shotId: string;
  ordinal: number;
  description?: string;
  effects: Array<{ effectId: string; template?: string }>;
  outgoingTransition?: {
    toShotId: string;
    toOrdinal: number;
    effectId: string;
    durationS: number;
  };
}

export interface VisionPreflightTask {
  id: string;
  kind: "shot" | "boundary";
  ordinal: number;
  frames: VisionPreflightFrameInput[];
  decision?: VisionPreflightDecisionInput;
  nextDecision?: VisionPreflightDecisionInput;
}

/**
 * 预审码表(1102 扩到角色形体与画面文字)。
 *
 * 分成两组是刻意的:前四条是 08-22 那批「成片装配」问题,后七条是「生成内容本身」
 * 的崩坏问题。三态板按组归行(character-integrity / text-integrity / cross-shot-coherence),
 * 一条 finding 只落一个需求行,免得同一个毛病在板上被数两次。
 *
 * 这七维为什么走模型而不是 ffmpeg:1102 实测 YuNet 在 608×352 的二维国风帧上
 * 五官几何比值自然区间是 noseOverEye 0.28–1.02(全属正常),任何几何线都会把
 * 风格当崩坏——手指/口型同理无法由信号过滤器判定,只能看。
 */
export type VisionPreflightIssueCode =
  | "black-or-garbled"
  | "subtitle-obstruction"
  | "decorative-clutter"
  | "transition-content-mismatch"
  | "face-anomaly"
  | "hand-anomaly"
  | "pose-anomaly"
  | "lip-sync-suspect"
  | "text-garbled"
  | "identity-drift"
  | "style-inconsistency";

/** 角色形体组:脸/手/姿势/口型——归 character-integrity 行。 */
export const CHARACTER_INTEGRITY_ISSUE_CODES: readonly VisionPreflightIssueCode[] = [
  "face-anomaly",
  "hand-anomaly",
  "pose-anomaly",
  "lip-sync-suspect",
];

/** 画面文字组:AI 伪字/乱码——归 text-integrity 行。 */
export const TEXT_INTEGRITY_ISSUE_CODES: readonly VisionPreflightIssueCode[] = ["text-garbled"];

/** 跨镜一致组:身份与画风——归 cross-shot-coherence 行(只有成对调用判得出「跨镜」)。 */
export const COHERENCE_ISSUE_CODES: readonly VisionPreflightIssueCode[] = [
  "identity-drift",
  "style-inconsistency",
];

/** 装配组:08-22 原有四条——留在 vision-reviewed 行。 */
export const ASSEMBLY_ISSUE_CODES: readonly VisionPreflightIssueCode[] = [
  "black-or-garbled",
  "subtitle-obstruction",
  "decorative-clutter",
  "transition-content-mismatch",
];

export const VISION_PREFLIGHT_ISSUE_CODES: readonly VisionPreflightIssueCode[] = [
  ...ASSEMBLY_ISSUE_CODES,
  ...CHARACTER_INTEGRITY_ISSUE_CODES,
  ...TEXT_INTEGRITY_ISSUE_CODES,
  ...COHERENCE_ISSUE_CODES,
];

export interface VisionPreflightIssue {
  code: VisionPreflightIssueCode;
  severity: "warn" | "blocker";
  reason: string;
}

export interface VisionPreflightCall {
  id: string;
  kind: "frame" | "pair";
  frames: VisionPreflightFrameInput[];
  prompt: string;
}

export interface VisionPreflightCallResult {
  callId: string;
  kind: VisionPreflightCall["kind"];
  frames: VisionPreflightFrameInput[];
  status: "pass" | "fail" | "unparsed" | "skipped";
  issues?: VisionPreflightIssue[];
  reason?: string;
}

const ISSUE_CODES = new Set<VisionPreflightIssueCode>(VISION_PREFLIGHT_ISSUE_CODES);

export function buildVisionPreflightTasks(
  frames: readonly VisionPreflightFrameInput[],
  decisions: readonly VisionPreflightDecisionInput[],
): VisionPreflightTask[] {
  const decisionByOrdinal = new Map(decisions.map((decision) => [decision.ordinal, decision]));
  const frameByKey = new Map(frames.map((frame) => [`${frame.ordinal}:${frame.kind}`, frame]));
  const tasks: VisionPreflightTask[] = frames
    .filter((frame) => frame.kind === "mid")
    .sort((left, right) => left.ordinal - right.ordinal)
    .map((frame) => ({
      id: `shot:${frame.ordinal}`,
      kind: "shot" as const,
      ordinal: frame.ordinal,
      frames: [frame],
      decision: decisionByOrdinal.get(frame.ordinal),
    }));

  for (const decision of [...decisions].sort((left, right) => left.ordinal - right.ordinal)) {
    const transition = decision.outgoingTransition;
    if (!transition) continue;
    const pre = frameByKey.get(`${decision.ordinal}:pre`);
    const blend = frameByKey.get(`${decision.ordinal}:blend`);
    const post = frameByKey.get(`${transition.toOrdinal}:post`);
    if (!pre || !blend || !post) continue;
    tasks.push({
      id: `boundary:${decision.ordinal}:${transition.toOrdinal}`,
      kind: "boundary",
      ordinal: decision.ordinal,
      frames: [pre, blend, post],
      decision,
      nextDecision: decisionByOrdinal.get(transition.toOrdinal),
    });
  }
  return tasks;
}

/** 单帧检查项:装配四条 + 角色形体四条 + 画面文字一条。 */
const SINGLE_FRAME_CHECKS =
  "只检查：黑屏/花屏；字幕遮挡关键人物、动作或信息；装饰遮挡、堆叠或喧宾夺主；blend 帧的转场是否造成内容断裂或与前后镜描述明显不协调；"
  + "五官是否错位/缺失/糊成一团(face-anomaly)；手与手指是否多指、融合、扭曲或长在错误位置(hand-anomaly)；"
  + "肢体与姿势是否解剖不可能、穿模、悬空(pose-anomaly)；人物在说话时口型是否与台词明显对不上(lip-sync-suspect)；"
  + "画面内招牌/书信/匾额上的字是不是不成字的伪字或乱码(text-garbled)。";

export function buildVisionPreflightPrompt(task: VisionPreflightTask, frame: VisionPreflightFrameInput): string {
  const transition = task.decision?.outgoingTransition;
  const effects = (task.decision?.effects ?? [])
    .map((effect) => effect.template ? `${effect.effectId}:${effect.template}` : effect.effectId)
    .join(", ") || "无显式镜级效果";
  return [
    `这是成片第 ${frame.ordinal} 镜 ${frame.kind} 探针帧，时间码 ${frame.tS.toFixed(3)}s。`,
    `本镜描述：${task.decision?.description ?? task.nextDecision?.description ?? "未提供"}`,
    `本镜效果决策：${effects}`,
    transition
      ? `出镜转场：${transition.effectId}，时长 ${transition.durationS.toFixed(3)}s，下一镜 #${transition.toOrdinal}（${task.nextDecision?.description ?? "未提供描述"}）。`
      : "本帧无出镜转场决策。",
    SINGLE_FRAME_CHECKS,
    "看不清的细节不要硬判，宁可回答 pass 也不要猜。画面里没有人物/手/文字时，对应 code 一律不报。",
    "不要推断未提供的导演意图。只回答 JSON：",
    `{"pass":true或false,"issues":[{"code":"${VISION_PREFLIGHT_ISSUE_CODES.join("|")}","severity":"warn|blocker","reason":"不超过40字"}]}。`,
  ].join("\n");
}

/**
 * 相邻镜成对任务:身份漂移与画风一致是「两帧同看」才判得出的关系,
 * 单帧调用里模型没有对照物——1102 实测单帧问「是否漂移」只会得到复读描述。
 */
export function buildVisionCoherencePairs(
  frames: readonly VisionPreflightFrameInput[],
  decisions: readonly VisionPreflightDecisionInput[],
): Array<{ from: VisionPreflightFrameInput; to: VisionPreflightFrameInput }> {
  const midByOrdinal = new Map(
    frames.filter((frame) => frame.kind === "mid").map((frame) => [frame.ordinal, frame]),
  );
  const ordinals = [...new Set(decisions.map((decision) => decision.ordinal))].sort((a, b) => a - b);
  const pairs: Array<{ from: VisionPreflightFrameInput; to: VisionPreflightFrameInput }> = [];
  for (let i = 0; i + 1 < ordinals.length; i += 1) {
    const from = midByOrdinal.get(ordinals[i]);
    const to = midByOrdinal.get(ordinals[i + 1]);
    if (from && to) pairs.push({ from, to });
  }
  return pairs;
}

export function buildVisionCoherencePrompt(
  pair: { from: VisionPreflightFrameInput; to: VisionPreflightFrameInput },
  decisionByOrdinal: ReadonlyMap<number, VisionPreflightDecisionInput>,
): string {
  const fromDecision = decisionByOrdinal.get(pair.from.ordinal);
  const toDecision = decisionByOrdinal.get(pair.to.ordinal);
  return [
    `这是同一部成片的相邻两镜：第 ${pair.from.ordinal} 镜(${pair.from.tS.toFixed(3)}s)与第 ${pair.to.ordinal} 镜(${pair.to.tS.toFixed(3)}s),两张图按先后顺序给出。`,
    `前镜描述：${fromDecision?.description ?? "未提供"} / 后镜描述：${toDecision?.description ?? "未提供"}`,
    "只检查跨镜一致性：同一角色在两镜里的长相、发型、服饰、体型是否发生可察觉漂移(identity-drift)；"
      + "两镜的画风/渲染质感/色调是否不属于同一部片(style-inconsistency)。",
    "不同角色出现在相邻两镜是正常叙事，不算漂移；只有描述指向同一角色、或同一人身形明显换脸换衣时才报。",
    "只回答 JSON：",
    `{"pass":true或false,"issues":[{"code":"${COHERENCE_ISSUE_CODES.join("|")}","severity":"warn|blocker","reason":"不超过40字"}]}。`,
  ].join("\n");
}

/** 一次 provider 调用 = 一帧(装配/形体/文字)或两帧(跨镜一致)。 */
export function buildVisionPreflightCalls(
  frames: readonly VisionPreflightFrameInput[],
  decisions: readonly VisionPreflightDecisionInput[],
): VisionPreflightCall[] {
  const decisionByOrdinal = new Map(decisions.map((decision) => [decision.ordinal, decision]));
  const calls: VisionPreflightCall[] = [];
  for (const task of buildVisionPreflightTasks([...frames], [...decisions])) {
    for (const frame of task.frames) {
      calls.push({
        id: `${task.id}:${frame.kind}`,
        kind: "frame",
        frames: [frame],
        prompt: buildVisionPreflightPrompt(task, frame),
      });
    }
  }
  for (const pair of buildVisionCoherencePairs(frames, decisions)) {
    calls.push({
      id: `pair:${pair.from.ordinal}:${pair.to.ordinal}`,
      kind: "pair",
      frames: [pair.from, pair.to],
      prompt: buildVisionCoherencePrompt(pair, decisionByOrdinal),
    });
  }
  return calls;
}

export function parseVisionPreflightReply(content: string): { pass: boolean; issues: VisionPreflightIssue[] } | null {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(content);
  const candidate = fenced?.[1] ?? content;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(candidate.slice(start, end + 1)) as { pass?: unknown; issues?: unknown };
    if (typeof parsed.pass !== "boolean" || !Array.isArray(parsed.issues)) return null;
    const issues: VisionPreflightIssue[] = [];
    for (const raw of parsed.issues) {
      if (typeof raw !== "object" || raw === null) return null;
      const issue = raw as { code?: unknown; severity?: unknown; reason?: unknown };
      if (typeof issue.code !== "string" || !ISSUE_CODES.has(issue.code as VisionPreflightIssueCode)) return null;
      if (issue.severity !== "warn" && issue.severity !== "blocker") return null;
      if (typeof issue.reason !== "string" || !issue.reason.trim()) return null;
      issues.push({
        code: issue.code as VisionPreflightIssueCode,
        severity: issue.severity,
        reason: issue.reason.trim().slice(0, 80),
      });
    }
    if ((parsed.pass && issues.length > 0) || (!parsed.pass && issues.length === 0)) return null;
    return { pass: parsed.pass, issues };
  } catch {
    return null;
  }
}

export interface RunVisionPreflightOptions {
  frames: VisionPreflightFrameInput[];
  decisions: VisionPreflightDecisionInput[];
  call: MultimodalCaller;
  readFrameDataUrl: (frameUrl: string) => Promise<string | null>;
  maxCalls?: number;
}

export async function runVisionPreflight(options: RunVisionPreflightOptions): Promise<{
  results: VisionPreflightCallResult[];
  findings: ChapterQcFindingV1[];
  stats: { checked: number; passed: number; failed: number; skipped: number };
}> {
  const calls = buildVisionPreflightCalls(options.frames, options.decisions);
  const maxCalls = options.maxCalls ?? calls.length + 5;
  const results: VisionPreflightCallResult[] = [];
  let callsUsed = 0;

  for (const callUnit of calls) {
    const images: string[] = [];
    for (const frame of callUnit.frames) {
      const dataUrl = await options.readFrameDataUrl(frame.frameUrl);
      if (dataUrl) images.push(dataUrl);
    }
    if (images.length !== callUnit.frames.length) {
      results.push({ callId: callUnit.id, kind: callUnit.kind, frames: callUnit.frames, status: "skipped", reason: "探针帧读取失败" });
      continue;
    }
    let parsed: ReturnType<typeof parseVisionPreflightReply> = null;
    let providerFailed: string | undefined;
    for (let attempt = 0; attempt < 2 && parsed === null && callsUsed < maxCalls; attempt += 1) {
      callsUsed += 1;
      try {
        const content = await options.call([
          {
            role: "user",
            content: [
              ...images.map((url) => ({ type: "image_url" as const, image_url: { url } })),
              { type: "text" as const, text: callUnit.prompt },
            ],
          },
        ]);
        parsed = parseVisionPreflightReply(content);
      } catch (error) {
        providerFailed = error instanceof Error ? error.message : String(error);
        break;
      }
    }
    if (providerFailed) {
      results.push({ callId: callUnit.id, kind: callUnit.kind, frames: callUnit.frames, status: "skipped", reason: providerFailed });
    } else if (!parsed) {
      results.push({ callId: callUnit.id, kind: callUnit.kind, frames: callUnit.frames, status: "unparsed", reason: "模型回复无法解析或费用护栏触发" });
    } else {
      results.push({
        callId: callUnit.id,
        kind: callUnit.kind,
        frames: callUnit.frames,
        status: parsed.pass ? "pass" : "fail",
        ...(parsed.issues.length > 0 ? { issues: parsed.issues } : {}),
      });
    }
  }

  const findings: ChapterQcFindingV1[] = [];
  for (const result of results) {
    for (const issue of result.issues ?? []) {
      // 成对调用把 finding 记在后一镜:漂移是「这一镜偏离了前一镜」
      const anchor = result.kind === "pair" ? result.frames[result.frames.length - 1] : result.frames[0];
      findings.push({
        code: `chapter-qc.vision.preflight.${issue.code}`,
        layer: "vision",
        severity: issue.severity,
        shotId: anchor.shotId,
        shotOrdinal: anchor.ordinal,
        message: result.kind === "pair"
          ? `第 ${result.frames[0].ordinal}→${anchor.ordinal} 镜跨镜一致：${issue.reason}`
          : `第 ${anchor.ordinal} 镜 ${anchor.kind}：${issue.reason}`,
        evidence: {
          source: "vision-preflight",
          callId: result.callId,
          frameKind: anchor.kind,
          tS: anchor.tS,
          ...(result.kind === "pair" ? { pairTs: [result.frames[0].tS, anchor.tS] } : {}),
        },
      });
    }
  }
  const checked = results.filter((result) => result.status === "pass" || result.status === "fail").length;
  const passed = results.filter((result) => result.status === "pass").length;
  const failed = results.filter((result) => result.status === "fail").length;
  const skipped = results.filter((result) => result.status === "skipped" || result.status === "unparsed").length;
  return { results, findings, stats: { checked, passed, failed, skipped } };
}
