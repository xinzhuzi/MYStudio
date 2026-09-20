// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

/**
 * 工作台 BGM「批量抽卡」纯逻辑(09-20):
 * - 种子派生:第 i 首 = 42+i(基值与库工作流「种子 42 固定」同源);同题同派生恒同值,可复现。
 * - 面板状态机:idle → generating(逐首串行,进度「第 i/N 首」)→ selecting(点选绑定)→
 *   error;中途失败保留已产出候选(文件已 persist 落项目,仍可点选)。
 * - FLAC 时长解析:产物 b64 直接解 STREAMINFO,列表面「文件名+时长」零额外 IO。
 * - 编排器 generateBgmBatch:库取工作流/execute/持久化全走依赖注入——组件里接真
 *   引擎(复用 generateLocalBgm 同一机制),测试里全 mock 不真跑。
 */
import { unwrapComfyApiGraph, type ComfyApiWorkflow } from "@/lib/assist/image-studio/comfy-workflow-import";
import type { ComfyExecuteJobReply, ComfyExecutePayload, ComfyExecuteProgress } from "@/lib/assist/image-studio/comfy-execute";

/** 种子基值:与库工作流存量口径同源(YuE2 双生成节点 + KSampler 均为 42)。 */
export const BGM_BATCH_BASE_SEED = 42;
/** 带 seed 输入的节点号(22=YuE2GenerateMusic/23=YuE2GenerateABC/8=KSampler),
 *  与单发 generateLocalBgm 的 "22.style"/"23.style" 注入口同一批节点号。 */
export const BGM_BATCH_SEED_NODE_IDS: readonly string[] = ["22", "23", "8"];
/** 抽卡张数档位(用户可选 2/4/8 连抽)。 */
export const YUE2_BGM_BATCH_COUNT_OPTIONS = [2, 4, 8] as const;
export type BgmBatchCount = (typeof YUE2_BGM_BATCH_COUNT_OPTIONS)[number];
/** 纯音乐铁律:五标签逐行(09-20 实弹定稿;空歌词回退此值,加词会退回出人声)。 */
export const YUE2_BGM_LYRICS_IRON = "[intro]\n[verse]\n[chorus]\n[bridge]\n[outro]";
/** 音频整曲长任务的执行/轮询上限(与单发 generateLocalBgm 同口径)。 */
export const YUE2_BGM_EXECUTE_TIMEOUT_S = 1200;
export const YUE2_BGM_POLL_TIMEOUT_MS = 1_230_000;

/** 种子派生(纯函数):count 首 → [42, 43, …](seed_i = 42+i,i 从 0 起)。
 *  只依赖序号不依赖题面:同题同派生(idx)恒同种子,天然可复现;非法入参给空数组。 */
export function deriveBgmBatchSeeds(count: number): number[] {
  if (!Number.isInteger(count) || count <= 0) return [];
  return Array.from({ length: count }, (_, idx) => BGM_BATCH_BASE_SEED + idx);
}

/** 图种子注入(纯函数):深拷贝图,把 seed 节点的 inputs.seed 统一改派生种子。
 *  原图不动(每首独立拷贝防串味);节点/字段缺失时保持工作流原值,不炸。 */
export function withBgmBatchSeed(graph: ComfyApiWorkflow, seed: number): ComfyApiWorkflow {
  const next = JSON.parse(JSON.stringify(graph)) as ComfyApiWorkflow;
  for (const nodeId of BGM_BATCH_SEED_NODE_IDS) {
    const node = next[nodeId];
    if (node && typeof node === "object" && "seed" in node.inputs) {
      node.inputs.seed = seed;
    }
  }
  return next;
}

/** 单发/抽卡共用的字符串注入面(一处改两节点同源:22/23 双节点同值)。 */
export function buildBgmStringInputs(style: string, lyrics: string): Record<string, string> {
  return { "22.style": style, "23.style": style, "22.lyrics": lyrics, "23.lyrics": lyrics };
}

/** FLAC STREAMINFO 时长解析(纯函数):b64 → 秒;非 FLAC/信息不全给 null。
 *  只读头部元数据,不解码音频;供抽卡结果列「文件名+时长」。 */
export function flacDurationSecondsFromB64(b64: string): number | null {
  let bytes: Uint8Array;
  try {
    bytes = Uint8Array.from(atob(b64), (char) => char.charCodeAt(0));
  } catch {
    return null;
  }
  if (bytes.length < 8 || bytes[0] !== 0x66 || bytes[1] !== 0x4c || bytes[2] !== 0x61 || bytes[3] !== 0x43) return null; // "fLaC"
  let offset = 4;
  for (let guard = 0; guard < 64; guard += 1) {
    if (offset + 4 > bytes.length) return null;
    const blockType = bytes[offset] & 0x7f;
    const isLastBlock = (bytes[offset] & 0x80) !== 0;
    const blockLength = (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3];
    offset += 4;
    if (blockType === 0) {
      // STREAMINFO(34 字节):bit10-17 打包 sampleRate(20b)/channels(3b)/bps(5b)/totalSamples(36b)
      if (blockLength < 34 || offset + 34 > bytes.length) return null;
      const sampleRate = (bytes[offset + 10] << 12) | (bytes[offset + 11] << 4) | (bytes[offset + 12] >> 4);
      const totalSamples = ((bytes[offset + 13] & 0x0f) * 2 ** 32)
        + (((bytes[offset + 14] << 24) | (bytes[offset + 15] << 16) | (bytes[offset + 16] << 8) | bytes[offset + 17]) >>> 0);
      if (sampleRate <= 0 || totalSamples <= 0) return null;
      return totalSamples / sampleRate;
    }
    if (isLastBlock) return null;
    offset += blockLength;
  }
  return null;
}

// ---------------------------------------------------------------------------
// 面板状态机(纯 reducer)
// ---------------------------------------------------------------------------

export type BgmBatchPhase = "idle" | "generating" | "selecting" | "error";

/** 一首已落项目的候选(persistComfyAudio 产物;duration 由 FLAC 头解析,未知为 null)。 */
export interface BgmBatchCandidate {
  seed: number;
  filename: string;
  filePath: string;
  url: string | null;
  durationSeconds: number | null;
}

export interface BgmBatchState {
  phase: BgmBatchPhase;
  /** 连抽总首数 N。 */
  total: number;
  /** 已完成首数(生成中的当前首 = done+1,封顶 total)。 */
  done: number;
  candidates: BgmBatchCandidate[];
  error: string | null;
}

export type BgmBatchAction =
  | { type: "start"; total: number }
  | { type: "complete-one"; candidate: BgmBatchCandidate }
  | { type: "finish" }
  | { type: "fail"; error: string }
  | { type: "reset" };

export const bgmBatchInitialState: BgmBatchState = { phase: "idle", total: 0, done: 0, candidates: [], error: null };

/** 状态机转移(纯函数):非生成态不收料(防陈旧回调);中途失败保留已产出候选
 *  (文件已落项目,仍可点选绑定);全灭才进 error。 */
export function bgmBatchReducer(state: BgmBatchState, action: BgmBatchAction): BgmBatchState {
  switch (action.type) {
    case "start":
      return { phase: "generating", total: action.total, done: 0, candidates: [], error: null };
    case "complete-one":
      if (state.phase !== "generating") return state;
      return { ...state, done: state.done + 1, candidates: [...state.candidates, action.candidate] };
    case "finish":
      if (state.phase !== "generating") return state;
      return state.candidates.length > 0
        ? { ...state, phase: "selecting" }
        : { ...state, phase: "error", error: state.error ?? "批量抽卡没有产出任何曲目" };
    case "fail":
      return {
        ...state,
        phase: state.candidates.length > 0 ? "selecting" : "error",
        error: action.error,
      };
    case "reset":
      return bgmBatchInitialState;
  }
}

/** 进度文案(纯函数):生成期「第 i/N 首」;点选期给收口提示;空串=不展示。 */
export function formatBgmBatchProgress(state: BgmBatchState): string {
  if (state.phase === "generating") {
    return `第 ${Math.min(state.done + 1, state.total)}/${state.total} 首`;
  }
  if (state.phase === "selecting") {
    return `已产出 ${state.candidates.length}/${state.total} 首,点选一首绑定本章 BGM`;
  }
  return "";
}

/** 时长展示(纯函数):秒 → m:ss;未知给「时长未知」。 */
export function formatBgmBatchDuration(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) return "时长未知";
  const total = Math.round(seconds);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// 编排器(依赖注入;组件接真引擎,测试全 mock)
// ---------------------------------------------------------------------------

export type BgmBatchExecuteFn = (
  payload: ComfyExecutePayload,
  onProgress?: (progress: ComfyExecuteProgress) => void,
  options?: { pollTimeoutMs?: number },
) => Promise<NonNullable<ComfyExecuteJobReply["result"]>>;

export interface BgmBatchGenerateInput {
  workflowId: string;
  style: string;
  /** 空串/纯空白回退纯音乐铁律五标签。 */
  lyrics: string;
  count: number;
}

export interface BgmBatchGenerateDeps {
  fetchWorkflowText: (workflowId: string) => Promise<string>;
  execute: BgmBatchExecuteFn;
  persistAudio: (b64: string, engineFilename: string) => Promise<{ filePath: string; url: string | null }>;
  /** 逐首进度(index 从 1 起,message 为引擎原文)。 */
  onProgress?: (progress: { index: number; total: number; seed: number; message: string }) => void;
  /** 状态机快照逐次回报(组件直接 setState 展示)。 */
  onStateChange?: (state: BgmBatchState) => void;
}

/**
 * 批量抽卡编排(逐首串行):库取工作流一次 → 每首独立拷贝图注入派生种子 →
 * execute → persistComfyAudio 落项目 → 收候选;首内出错即停,已产出候选保留。
 * 不直接抛错:终态经返回值/状态机给出(error 字段),busy 释放由调用方 finally 兜底。
 */
export async function generateBgmBatch(
  input: BgmBatchGenerateInput,
  deps: BgmBatchGenerateDeps,
): Promise<BgmBatchState> {
  const seeds = deriveBgmBatchSeeds(input.count);
  let state = bgmBatchReducer(bgmBatchInitialState, { type: "start", total: seeds.length });
  deps.onStateChange?.(state);
  try {
    const style = input.style.trim();
    if (!style) throw new Error("请先填写 BGM 风格描述");
    const lyrics = input.lyrics.trim() || YUE2_BGM_LYRICS_IRON;
    const workflowText = await deps.fetchWorkflowText(input.workflowId);
    const parsed = unwrapComfyApiGraph(JSON.parse(workflowText));
    if (!parsed.ok) throw new Error(parsed.error);
    for (let idx = 0; idx < seeds.length; idx += 1) {
      const seed = seeds[idx];
      const result = await deps.execute(
        {
          graph: withBgmBatchSeed(parsed.graph, seed),
          inputs: { strings: buildBgmStringInputs(style, lyrics), images: [] },
          timeoutS: YUE2_BGM_EXECUTE_TIMEOUT_S,
        },
        (progress) => deps.onProgress?.({ index: idx + 1, total: seeds.length, seed, message: progress.message }),
        { pollTimeoutMs: YUE2_BGM_POLL_TIMEOUT_MS },
      );
      const audio = result.audios?.[0];
      if (!audio) throw new Error(`第 ${idx + 1}/${seeds.length} 首:工作流已完成但没有输出音频(缺 SaveAudio 类输出节点?)`);
      const saved = await deps.persistAudio(audio.b64, audio.filename ?? "bgm.flac");
      state = bgmBatchReducer(state, {
        type: "complete-one",
        candidate: {
          seed,
          filename: saved.filePath.split(/[\\/]/).pop() || audio.filename || "bgm.flac",
          filePath: saved.filePath,
          url: saved.url,
          durationSeconds: flacDurationSecondsFromB64(audio.b64),
        },
      });
      deps.onStateChange?.(state);
    }
    state = bgmBatchReducer(state, { type: "finish" });
    deps.onStateChange?.(state);
    return state;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    state = bgmBatchReducer(state, { type: "fail", error: message });
    deps.onStateChange?.(state);
    return state;
  }
}
