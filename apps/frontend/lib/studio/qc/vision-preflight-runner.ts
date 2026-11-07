/**
 * AC4 审片预审 runner。
 *
 * 一次 provider 调用要么送 1 张主进程已缩放的探针帧(仅检查可见的装配/形体/文字),
 * 要么送 2 张相邻镜中帧(跨镜一致:漂移是关系判定,单帧没有对照物)。
 * 边界任务把 pre/blend/post 绑到同一份转场决策上下文,但仍逐帧发。
 * kind="face" 是人脸框头部特写(1107 吸收件②),单独一条 prompt 与单独的码白名单。
 */

import type { ChapterQcFindingV1 } from "@rendering/plugins/videoqc/chapter-qc-types";
import type { MultimodalCaller } from "./semantic-runner";

export type VisionPreflightFrameKind = "mid" | "pre" | "blend" | "post" | "face";

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

/** 口型码保留供解释历史报告；单帧预审不生成此码。 */
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

/**
 * 头部特写组(1107 吸收件②):裁片里只有头,能判的只有五官。
 * 放手/文字/装配码进来等于允许模型对看不见的部位签发结论——那是假证据,不是加分。
 */
export const FACE_CROP_ISSUE_CODES: readonly VisionPreflightIssueCode[] = ["face-anomaly"];

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
  status: "pass" | "fail" | "unverified" | "unparsed" | "skipped";
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

const SINGLE_FRAME_ISSUE_CODES = [
  ...ASSEMBLY_ISSUE_CODES,
  ...CHARACTER_INTEGRITY_ISSUE_CODES.filter((code) => code !== "lip-sync-suspect"),
  ...TEXT_INTEGRITY_ISSUE_CODES,
];

const SINGLE_FRAME_CHECKS =
  "逐项观察：黑屏/花屏；字幕遮挡关键人物、动作或信息；装饰遮挡、堆叠或喧宾夺主；blend 帧的转场是否造成内容断裂或与前后镜描述明显不协调；"
  + "五官是否错位、重复、缺失或糊成一团(face-anomaly)；可见手掌与手指是否多指、融合、扭曲或长在错误位置(hand-anomaly)；"
  + "肢体是否额外生长、连接错误、解剖不可能或穿模(pose-anomaly)；"
  + "画面内招牌/书信/匾额上的字是不是不成字的伪字或乱码(text-garbled)。";

export function buildVisionPreflightPrompt(task: VisionPreflightTask, frame: VisionPreflightFrameInput): string {
  const transition = task.decision?.outgoingTransition;
  const effects = (task.decision?.effects ?? [])
    .map((effect) => effect.template ? `${effect.effectId}:${effect.template}` : effect.effectId)
    .join(", ") || "无显式镜级效果";
  return [
    `这是成片第 ${frame.ordinal} 镜 ${frame.kind} 探针帧，时间码 ${frame.tS.toFixed(3)}s。`,
    `本镜描述：${(frame.ordinal === task.nextDecision?.ordinal ? task.nextDecision : task.decision)?.description ?? "未提供"}`,
    `本镜效果决策：${effects}`,
    transition
      ? `出镜转场：${transition.effectId}，时长 ${transition.durationS.toFixed(3)}s，下一镜 #${transition.toOrdinal}（${task.nextDecision?.description ?? "未提供描述"}）。`
      : "本帧无出镜转场决策。",
    SINGLE_FRAME_CHECKS,
    "先辨认实际可见的人物、脸、手和肢体，再检查连接关系与局部细节；不要先假定有问题或没问题。",
    "看不清的细节不要硬判：模糊、小脸、遮挡导致无法判断时 pass=null，并在 reason 写缺什么证据。确认画面没有人物/手/文字时，不为缺席对象报错。",
    "侧脸、背影、正常遮挡、透视缩短、二维风格化和有意运动模糊不等于畸形；只有可见结构明显矛盾才报异常。",
    "本次只有单帧，没有音频或连续嘴部画面，不能判断口型同步，也不能判断跨镜身份漂移。不要推断未提供的导演意图。",
    "可见适用项都能判断且无异常才 pass=true；已发现异常用 pass=false；证据不足用 pass=null（已发现的异常仍须保留在 issues）。只回答 JSON：",
    `{"pass":true或false或null,"issues":[{"code":"${SINGLE_FRAME_ISSUE_CODES.join("|")}","severity":"warn|blocker","reason":"指出可见部位与具体问题"}],"reason":"pass=null时必填缺证原因"}。`,
  ].join("\n");
}

/**
 * 头部特写调用(1107 吸收件②)。
 *
 * 为什么要单独一条 prompt:1102 标定同一章 1080P 出片的脸原生中位只有 71px,整帧探针限宽 1280 后
 * 剩 ~47px,模型对手/脸的统一回话是「太小看不清不判」。裁片把这一镜里脸实际占的那几十像素整份送到
 * 输入视野,判据从「猜有没有崩」变成「看这五官对不对」。
 */
export function buildFaceCropPrompt(frame: VisionPreflightFrameInput, decision?: VisionPreflightDecisionInput): string {
  return [
    `这是成片第 ${frame.ordinal} 镜(${frame.tS.toFixed(3)}s)按人脸框裁出的头部特写,原始分辨率裁片,不是整帧缩略。`,
    `本镜描述：${decision?.description ?? "未提供"}`,
    "只检查五官与头部连接：眼/眉/鼻/嘴的数量、位置与左右关系是否符合解剖；"
      + "眼珠、牙齿、嘴唇是否缺失、重复、糊成一团或长错位置；皮肤与五官边界是否有融合、重影、局部扭曲；"
      + "脖颈与头、肩的连接是否连续、无穿模(face-anomaly)。",
    "本图里没有手、全身、字幕和画面文字,不要对这些部位下任何结论；跨镜身份漂移需要两帧对照,单张不判。",
    "侧脸、背影、正常遮挡、二维风格化与有意虚化不等于畸形；只有可见结构明显矛盾才报 face-anomaly。",
    "小脸经插值放大不会新增细节：仍然不可辨时 pass=null 并在 reason 写缺什么证据,「看不清」不是「没问题」。",
    "可见项都能判断且无异常才 pass=true；已发现异常用 pass=false；证据不足用 pass=null（已发现的异常仍须保留在 issues）。只回答 JSON：",
    `{"pass":true或false或null,"issues":[{"code":"${FACE_CROP_ISSUE_CODES.join("|")}","severity":"warn|blocker","reason":"指出具体哪个部位怎么错"}],"reason":"pass=null时必填缺证原因"}。`,
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
    "身份对应关系不明、人物太小或遮挡而无法比较时 pass=null，不把不同人物硬判为换脸，也不把无法比较当通过。",
    "可比较且无异常用 pass=true；可见异常用 pass=false；证据不足用 pass=null，已发现的异常仍保留在 issues。只回答 JSON：",
    `{"pass":true或false或null,"issues":[{"code":"${COHERENCE_ISSUE_CODES.join("|")}","severity":"warn|blocker","reason":"指出具体差异"}],"reason":"pass=null时必填缺证原因"}。`,
  ].join("\n");
}

/** 一次 provider 调用 = 一帧(装配/形体/文字)或两帧(跨镜一致)。 */
export function buildVisionPreflightCalls(
  frames: readonly VisionPreflightFrameInput[],
  decisions: readonly VisionPreflightDecisionInput[],
): VisionPreflightCall[] {
  const decisionByOrdinal = new Map(decisions.map((decision) => [decision.ordinal, decision]));
  const calls: VisionPreflightCall[] = [];
  const assignedFrames = new Set<VisionPreflightFrameInput>();
  for (const task of buildVisionPreflightTasks(frames, decisions)) {
    for (const frame of task.frames) {
      calls.push({
        id: `${task.id}:${frame.kind}`,
        kind: "frame",
        frames: [frame],
        prompt: buildVisionPreflightPrompt(task, frame),
      });
      assignedFrames.add(frame);
    }
  }
  for (const frame of frames) {
    if (assignedFrames.has(frame)) continue;
    const decision = decisionByOrdinal.get(frame.ordinal);
    const task: VisionPreflightTask = {
      id: `shot:${frame.ordinal}`,
      kind: "shot",
      ordinal: frame.ordinal,
      frames: [frame],
      decision,
      nextDecision: decision?.outgoingTransition
        ? decisionByOrdinal.get(decision.outgoingTransition.toOrdinal)
        : undefined,
    };
    // 头部特写走自己的 prompt:整帧那套「顺手/文字/装配」清单送到一张只有头的裁片上,只会换来一串「看不见故不判」。
    calls.push({
      id: `${task.id}:${frame.kind}`,
      kind: "frame",
      frames: [frame],
      prompt: frame.kind === "face" ? buildFaceCropPrompt(frame, decision) : buildVisionPreflightPrompt(task, frame),
    });
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

export function parseVisionPreflightReply(content: string): { pass: boolean | null; issues: VisionPreflightIssue[]; reason?: string } | null {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(content);
  const candidate = fenced?.[1] ?? content;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(candidate.slice(start, end + 1)) as { pass?: unknown; issues?: unknown; reason?: unknown };
    if ((typeof parsed.pass !== "boolean" && parsed.pass !== null) || !Array.isArray(parsed.issues)) return null;
    const reason = typeof parsed.reason === "string" ? parsed.reason.trim().slice(0, 200) : undefined;
    if (parsed.pass === null && !reason) return null;
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
    if ((parsed.pass === true && issues.length > 0) || (parsed.pass === false && issues.length === 0)) return null;
    return { pass: parsed.pass, issues, ...(parsed.pass === null ? { reason } : {}) };
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
      try {
        const dataUrl = await options.readFrameDataUrl(frame.frameUrl);
        if (dataUrl) images.push(dataUrl);
      } catch {
        break;
      }
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
        const allowedCodes = callUnit.frames[0]?.kind === "face"
          ? FACE_CROP_ISSUE_CODES
          : callUnit.kind === "pair" ? COHERENCE_ISSUE_CODES : SINGLE_FRAME_ISSUE_CODES;
        if (parsed && parsed.issues.some((issue) => !allowedCodes.includes(issue.code))) {
          parsed = {
            pass: null,
            issues: parsed.issues.filter((issue) => allowedCodes.includes(issue.code)),
            reason: [parsed.reason, "模型返回本次帧证据不支持的判断，已排除这些判断并保留可验证的异常"].filter(Boolean).join("；"),
          };
        }
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
        status: parsed.pass === null ? "unverified" : parsed.pass ? "pass" : "fail",
        ...(parsed.reason ? { reason: parsed.reason } : {}),
        ...(parsed.issues.length > 0 ? { issues: parsed.issues } : {}),
      });
    }
  }

  const findings: ChapterQcFindingV1[] = [];
  for (const result of results) {
    const anchor = result.kind === "pair" ? result.frames[result.frames.length - 1] : result.frames[0];
    if (result.reason) {
      findings.push({
        code: "chapter-qc.vision.preflight.incomplete",
        layer: "vision",
        severity: "info",
        shotId: anchor.shotId,
        shotOrdinal: anchor.ordinal,
        message: `第 ${anchor.ordinal} 镜视觉预审缺证：${result.reason}`,
        evidence: {
          source: "vision-preflight", callId: result.callId, frameKind: anchor.kind, tS: anchor.tS,
          ...(result.kind === "pair" ? { pairTs: [result.frames[0].tS, anchor.tS] } : {}),
        },
      });
    }
    for (const issue of result.issues ?? []) {
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
  const skipped = results.length - checked;
  return { results, findings, stats: { checked, passed, failed, skipped } };
}
