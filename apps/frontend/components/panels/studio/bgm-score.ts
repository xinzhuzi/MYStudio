// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

/**
 * 工作台 BGM「先出谱→改谱→按谱渲染」纯逻辑(09-20):
 * - 出谱:库取 ABC-only API 工作流(yue2-出谱-abc版)→ /comfy/execute →
 *   result.texts[0] 即 ABC 谱文本(PreviewAny ui.text 内联,无需 /view)。
 * - 按谱渲染:复用 yue2-bgm API 工作流,注入 "22.abc"(链接位改字面量,
 *   并剪掉孤岛节点 14/23——不剪则 PreviewAny 牵着 YuE2GenerateABC 整场重跑,
 *   与 09-20 实弹定稿的单发口径只差 abc 来源——谱来自上一步产物或用户改谱)。
 * - 状态机:idle → scoring → editing(谱文本可编辑+预览)→ rendering →
 *   回 editing;fail 保谱文本(改完可重渲染),reset 清空。
 * busy 态与单发/抽卡共用(组件里 bgmGenerating + chapterAudioBusy 同锁)。
 */
import { unwrapComfyApiGraph } from "@/lib/assist/image-studio/comfy-workflow-import";
import type { ComfyExecuteJobReply, ComfyExecutePayload, ComfyExecuteProgress } from "@/lib/assist/image-studio/comfy-execute";

/** 库内 ABC-only 出谱 API 工作流(repo 源只读 id;桥模板格式,画布侧栏不可见)。 */
export const YUE2_ABC_API_WORKFLOW_ID = "repo:3_声音/Yue2/yue2-出谱-abc版.api.json";
/** 按谱渲染复用的 BGM API 工作流(与单发/抽卡同源;注入点叠加 22.abc)。 */
export const YUE2_BGM_RENDER_API_WORKFLOW_ID = "repo:3_声音/Yue2/yue2-bgm-纯音乐-lora版.api.json";
/** YuE2GenerateABC 节点号(yue2-出谱-abc版 图内;style/lyrics/seed 注入面)。 */
export const YUE2_SCORE_ABC_NODE_ID = "23";
/** YuE2GenerateMusic 直喂 abc 的注入键(BGM api 图内 22 号节点)。 */
export const YUE2_RENDER_ABC_INJECT_KEY = "22.abc";
/** 出谱(LLM 生成 ABC)执行/轮询上限:秒~分钟级,低于整曲渲染档。 */
export const YUE2_SCORE_EXECUTE_TIMEOUT_S = 600;
export const YUE2_SCORE_POLL_TIMEOUT_MS = 630_000;
/** 按谱渲染与整曲单发同档(1200s)。 */
export const YUE2_RENDER_EXECUTE_TIMEOUT_S = 1200;
export const YUE2_RENDER_POLL_TIMEOUT_MS = 1_230_000;

/** 出谱注入面(纯函数):style/lyrics 进 23 号 YuE2GenerateABC;seed 可选注入。 */
export function buildScoreInputs(
  style: string,
  lyrics: string,
  seed?: number,
): Record<string, string> {
  const inputs: Record<string, string> = {
    [`${YUE2_SCORE_ABC_NODE_ID}.style`]: style,
    [`${YUE2_SCORE_ABC_NODE_ID}.lyrics`]: lyrics,
  };
  if (Number.isInteger(seed)) inputs[`${YUE2_SCORE_ABC_NODE_ID}.seed`] = String(seed);
  return inputs;
}

/** 按谱渲染注入面(纯函数):只注 22 一节(style/lyrics/abc 直喂)。
 *  22.abc 直喂后库图的 23(YuE2GenerateABC)成孤岛并被剪枝(见 pruneRenderByScoreGraph),
 *  不再注 23.*(单发 buildBgmStringInputs 的双节点同源是整曲口径,按谱渲染不适用)。 */
export function buildRenderByScoreInputs(
  style: string,
  lyrics: string,
  abc: string,
): Record<string, string> {
  return { "22.style": style, "22.lyrics": lyrics, [YUE2_RENDER_ABC_INJECT_KEY]: abc };
}

/** 按谱渲染要剪掉的字段/孤岛节点:14=PreviewAny(OUTPUT_NODE,展示谱)、
 *  23=YuE2GenerateABC(整场 LLM 出谱)。22.abc 直喂后 23 除喂 14 外无人消费,但
 *  PreviewAny 是输出节点——不剪则 23 仍整场重跑(600s 量级白付),产物全被丢弃。 */
export const YUE2_RENDER_PRUNE_NODE_IDS: readonly string[] = ["14", "23"];

/** 按谱渲染图剪枝(纯函数):深拷贝图后删孤岛节点(14/23),原图不动。
 *  节点缺失时静默通过(库工作流改版不炸;注入面也不再引用这两个节点号)。 */
export function pruneRenderByScoreGraph(graph: ComfyExecutePayload["graph"]): ComfyExecutePayload["graph"] {
  const next = JSON.parse(JSON.stringify(graph)) as ComfyExecutePayload["graph"];
  for (const nodeId of YUE2_RENDER_PRUNE_NODE_IDS) delete next[nodeId];
  return next;
}

/** 出谱结果取谱文本(纯函数):texts[0].text;无文本产物给 null(调用方报大白话)。 */
export function firstScoreText(
  result: NonNullable<ComfyExecuteJobReply["result"]>,
): string | null {
  const first = result.texts?.[0];
  return typeof first?.text === "string" ? first.text : null;
}

/** 谱文本可渲染判定(纯函数,类型谓词):trim 后非空才算有谱(空白 abc 会静默退化,先拦)。 */
export function isRenderableAbc(abc: string | null | undefined): abc is string {
  return typeof abc === "string" && abc.trim().length > 0;
}

// ---------------------------------------------------------------------------
// 出谱/按谱渲染编排(依赖注入;组件接真引擎,测试全 mock)
// ---------------------------------------------------------------------------

export type ComfyExecuteFn = (
  payload: ComfyExecutePayload,
  onProgress?: (progress: ComfyExecuteProgress) => void,
  options?: { pollTimeoutMs?: number },
) => Promise<NonNullable<ComfyExecuteJobReply["result"]>>;

/** execute 结果里的单条音频产物(与 ComfyExecuteJobReply.result.audios 元素同形)。 */
export interface ComfyExecuteAudioOutput {
  nodeId?: string;
  filename?: string;
  b64: string;
}

export interface BgmScoreGenerateDeps {
  /** Stop new submissions and stale progress after an origin/operation switch. */
  isCurrent?: () => boolean;
  fetchWorkflowText: (workflowId: string) => Promise<string>;
  execute: ComfyExecuteFn;
  onProgress?: (message: string) => void;
}

/**
 * 出谱编排:库取 ABC-only 工作流 → 注入 style/lyrics(/seed)→ execute →
 * texts[0] 谱文本。谱文本缺失抛大白话(工作流缺 PreviewAny 类输出口)。
 */
export async function generateBgmScore(
  input: { workflowId: string; style: string; lyrics: string; seed?: number },
  deps: BgmScoreGenerateDeps,
): Promise<string> {
  if (deps.isCurrent?.() === false) throw new Error("BGM 操作已失效");
  const workflowText = await deps.fetchWorkflowText(input.workflowId);
  if (deps.isCurrent?.() === false) throw new Error("BGM 操作已失效");
  const parsed = JSON.parse(workflowText) as unknown;
  const graph = unwrapGraphOrThrow(parsed);
  const result = await deps.execute(
    {
      graph,
      inputs: { strings: buildScoreInputs(input.style, input.lyrics, input.seed), images: [] },
      timeoutS: YUE2_SCORE_EXECUTE_TIMEOUT_S,
    },
    (progress) => { if (deps.isCurrent?.() !== false) deps.onProgress?.(progress.message); },
    { pollTimeoutMs: YUE2_SCORE_POLL_TIMEOUT_MS },
  );
  if (deps.isCurrent?.() === false) throw new Error("BGM 操作已失效");
  const abc = firstScoreText(result);
  if (abc === null) {
    throw new Error("出谱工作流已完成但没有谱文本(缺 PreviewAny 类输出节点?)");
  }
  return abc;
}

/**
 * 按谱渲染编排:复用 BGM api 工作流 → 剪掉孤岛节点 14/23(abc 已直喂 22,不重跑
 * 整场 LLM 出谱)→ 注入 22.style/22.lyrics/22.abc → execute → 首音频产物返回
 * (audios[0];持久化/绑定由调用方接 persistComfyAudio 链)。
 */
export async function renderBgmByScore(
  input: { workflowId: string; style: string; lyrics: string; abc: string },
  deps: BgmScoreGenerateDeps,
): Promise<ComfyExecuteAudioOutput> {
  if (deps.isCurrent?.() === false) throw new Error("BGM 操作已失效");
  if (!isRenderableAbc(input.abc)) throw new Error("谱文本为空,先出谱或粘贴一段 ABC 谱再渲染");
  const workflowText = await deps.fetchWorkflowText(input.workflowId);
  if (deps.isCurrent?.() === false) throw new Error("BGM 操作已失效");
  const parsed = JSON.parse(workflowText) as unknown;
  const graph = pruneRenderByScoreGraph(unwrapGraphOrThrow(parsed));
  const result = await deps.execute(
    {
      graph,
      inputs: { strings: buildRenderByScoreInputs(input.style, input.lyrics, input.abc), images: [] },
      timeoutS: YUE2_RENDER_EXECUTE_TIMEOUT_S,
    },
    (progress) => { if (deps.isCurrent?.() !== false) deps.onProgress?.(progress.message); },
    { pollTimeoutMs: YUE2_RENDER_POLL_TIMEOUT_MS },
  );
  const audio = result.audios?.[0];
  if (!audio) throw new Error("按谱渲染已完成但没有输出音频(缺 SaveAudio 类输出节点?)");
  return audio;
}

/** 桥模板解包(库 JSON 原文 → graph;复用 unwrapComfyApiGraph 的全量校验)。 */
function unwrapGraphOrThrow(parsed: unknown): ComfyExecutePayload["graph"] {
  const unwrapped = unwrapComfyApiGraph(parsed);
  if (!unwrapped.ok) throw new Error(unwrapped.error);
  return unwrapped.graph;
}

// ---------------------------------------------------------------------------
// 面板状态机(纯 reducer)
// ---------------------------------------------------------------------------

export type BgmScorePhase = "idle" | "scoring" | "editing" | "rendering" | "error";

export interface BgmScoreState {
  phase: BgmScorePhase;
  /** 当前谱文本(出谱产物/用户改谱后的现值;idle 为 null)。 */
  abcText: string | null;
  error: string | null;
}

export type BgmScoreAction =
  | { type: "score-start" }
  | { type: "score-done"; abcText: string }
  | { type: "abc-edit"; abcText: string }
  | { type: "render-start" }
  | { type: "render-done" }
  | { type: "fail"; error: string }
  | { type: "reset" };

export const bgmScoreInitialState: BgmScoreState = { phase: "idle", abcText: null, error: null };

/** 状态机转移(纯函数):scoring/rendering 中不收新动作(防陈旧回调覆盖);
 *  fail 保谱文本(error 态可改谱回 editing,也可直接重试渲染)。 */
export function bgmScoreReducer(state: BgmScoreState, action: BgmScoreAction): BgmScoreState {
  switch (action.type) {
    case "score-start":
      if (state.phase === "scoring" || state.phase === "rendering") return state;
      return { ...state, phase: "scoring", error: null };
    case "score-done":
      if (state.phase !== "scoring") return state;
      return { phase: "editing", abcText: action.abcText, error: null };
    case "abc-edit":
      if (state.phase !== "editing" && state.phase !== "error") return state;
      return { ...state, phase: "editing", abcText: action.abcText, error: null };
    case "render-start":
      if (state.phase !== "editing" && state.phase !== "error") return state;
      return { ...state, phase: "rendering", error: null };
    case "render-done":
      if (state.phase !== "rendering") return state;
      return { ...state, phase: "editing", error: null };
    case "fail":
      if (state.phase === "idle") return state;
      return { ...state, phase: "error", error: action.error };
    case "reset":
      return bgmScoreInitialState;
  }
}

/** 出谱/渲染按钮的统一禁用判定(纯函数):生成类进行中(含单发/抽卡共用 busy)全锁。 */
export function isScoreBusy(state: BgmScoreState, sharedBusy: boolean): boolean {
  return sharedBusy || state.phase === "scoring" || state.phase === "rendering";
}
