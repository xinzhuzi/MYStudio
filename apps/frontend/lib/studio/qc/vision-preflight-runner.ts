/**
 * AC4 审片预审 runner。
 *
 * 每次 provider 调用只发送一张主进程已缩放的 QC 帧；边界任务只负责把
 * pre/blend/post 绑定到同一份转场决策上下文，不在一次请求中搬运多图。
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

export type VisionPreflightIssueCode =
  | "black-or-garbled"
  | "subtitle-obstruction"
  | "decorative-clutter"
  | "transition-content-mismatch";

export interface VisionPreflightIssue {
  code: VisionPreflightIssueCode;
  severity: "warn" | "blocker";
  reason: string;
}

export interface VisionPreflightFrameResult {
  taskId: string;
  frame: VisionPreflightFrameInput;
  status: "pass" | "fail" | "unparsed" | "skipped";
  issues?: VisionPreflightIssue[];
  reason?: string;
}

const ISSUE_CODES = new Set<VisionPreflightIssueCode>([
  "black-or-garbled",
  "subtitle-obstruction",
  "decorative-clutter",
  "transition-content-mismatch",
]);

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
    "只检查：黑屏/花屏；字幕遮挡关键人物、动作或信息；装饰遮挡、堆叠或喧宾夺主；blend 帧的转场是否造成内容断裂或与前后镜描述明显不协调。",
    "不要推断未提供的导演意图。只回答 JSON：{\"pass\":true或false,\"issues\":[{\"code\":\"black-or-garbled|subtitle-obstruction|decorative-clutter|transition-content-mismatch\",\"severity\":\"warn|blocker\",\"reason\":\"不超过40字\"}]}。",
  ].join("\n");
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
  results: VisionPreflightFrameResult[];
  findings: ChapterQcFindingV1[];
  stats: { checked: number; passed: number; failed: number; skipped: number };
}> {
  const tasks = buildVisionPreflightTasks(options.frames, options.decisions);
  const reviewUnits = tasks.flatMap((task) => task.frames.map((frame) => ({ task, frame })));
  const maxCalls = options.maxCalls ?? reviewUnits.length + 5;
  const results: VisionPreflightFrameResult[] = [];
  let callsUsed = 0;

  for (const { task, frame } of reviewUnits) {
    const dataUrl = await options.readFrameDataUrl(frame.frameUrl);
    if (!dataUrl) {
      results.push({ taskId: task.id, frame, status: "skipped", reason: "探针帧读取失败" });
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
              { type: "image_url", image_url: { url: dataUrl } },
              { type: "text", text: buildVisionPreflightPrompt(task, frame) },
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
      results.push({ taskId: task.id, frame, status: "skipped", reason: providerFailed });
    } else if (!parsed) {
      results.push({ taskId: task.id, frame, status: "unparsed", reason: "模型回复无法解析或费用护栏触发" });
    } else {
      results.push({
        taskId: task.id,
        frame,
        status: parsed.pass ? "pass" : "fail",
        ...(parsed.issues.length > 0 ? { issues: parsed.issues } : {}),
      });
    }
  }

  const findings: ChapterQcFindingV1[] = [];
  for (const result of results) {
    for (const issue of result.issues ?? []) {
      findings.push({
        code: `chapter-qc.vision.preflight.${issue.code}`,
        layer: "vision",
        severity: issue.severity,
        shotId: result.frame.shotId,
        shotOrdinal: result.frame.ordinal,
        message: `第 ${result.frame.ordinal} 镜 ${result.frame.kind}：${issue.reason}`,
        evidence: {
          source: "vision-preflight",
          taskId: result.taskId,
          frameKind: result.frame.kind,
          tS: result.frame.tS,
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
