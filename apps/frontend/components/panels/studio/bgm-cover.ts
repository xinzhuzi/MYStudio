// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

/**
 * 工作台 BGM「翻唱·记谱线」纯逻辑(09-20):
 * - 参考曲:项目内音频资产(studioAssets.list type=audio)→ asset-file:// 读址 →
 *   b64 → /comfy/execute 的 images 注入口 "30.audio"(LoadAudio;引擎 /upload/image
 *   对音频字节安全,落引擎家 input/ 后回写文件名——复用既有上传链,零新端点)。
 * - 记谱保旋律:库工作流 yue2-翻唱-记谱版.api.json 固化
 *   SheetSage2AudioToABC(mode=melody)→ YuE2GenerateMusic(mode=melody 直喂 abc)
 *   的配对铁律,前端只注入 style/lyrics/参考曲,不碰 mode。
 * - 面板状态机:idle → loading-assets → ready(选参考曲/填新风格)→ generating →
 *   done(产物已落项目,组件侧绑定 BGM)| error;绑定为组件职责(与单发 BGM 同链)。
 * - 编排器 generateBgmCover:库取工作流/读参考曲/execute/持久化全走依赖注入——
 *   组件里接真引擎,测试里全 mock 不真跑。
 */
import { unwrapComfyApiGraph } from "@/lib/assist/image-studio/comfy-workflow-import";
import type { ComfyExecuteJobReply, ComfyExecutePayload, ComfyExecuteProgress } from "@/lib/assist/image-studio/comfy-execute";
import type { StudioAssetSummary } from "@/types/studio-assets";
import { YUE2_BGM_LYRICS_IRON, flacDurationSecondsFromB64 } from "./bgm-batch";

/** 库内 YuE2 翻唱记谱线 API 工作流(repo 源只读 id;桥模板格式,画布侧栏不可见)。 */
export const YUE2_COVER_API_WORKFLOW_ID = "repo:3_声音/Yue2/yue2-翻唱-记谱版.api.json";
/** 参考曲上传注入口:LoadAudio(节点 30).audio——引擎收音频字节落 input/ 后回写文件名。 */
export const YUE2_COVER_AUDIO_INPUT_KEY = "30.audio";
/** 音频长任务的执行/轮询上限(记谱+重渲同为分钟级,与 BGM 单发/抽卡同口径)。 */
export const YUE2_COVER_EXECUTE_TIMEOUT_S = 1200;
export const YUE2_COVER_POLL_TIMEOUT_MS = 1_230_000;

// ---------------------------------------------------------------------------
// 参考曲资产选项(纯映射)
// ---------------------------------------------------------------------------

/** 面板可选的一路参考曲(项目内音频资产 → 可读地址 + 上传文件名)。 */
export interface BgmCoverAssetOption {
  id: string;
  name: string;
  /** asset-file:// 读址(读 b64 上传引擎用)。 */
  url: string;
  /** 上传引擎用的文件名(保留音频扩展名,LoadAudio 按名引用)。 */
  filename: string;
}

/** 资产清单 → 参考曲选项(纯函数):无 previewUrl 读址的资产读不了字节,不进选项;
 *  上传文件名取读址尾段(带原扩展名),取不到回退资产名。 */
export function toBgmCoverAssetOptions(items: StudioAssetSummary[]): BgmCoverAssetOption[] {
  const options: BgmCoverAssetOption[] = [];
  for (const item of items) {
    const url = item.previewUrl?.trim();
    if (!url) continue;
    const lastSegment = url.split(/[?#]/)[0]?.split("/").pop() ?? "";
    let filename = item.name;
    try {
      filename = decodeURIComponent(lastSegment) || item.name;
    } catch {
      filename = lastSegment || item.name;
    }
    options.push({ id: item.id, name: item.name, url, filename });
  }
  return options;
}

/** 翻唱文本注入面(只 22 一个文本节点——记谱线没有 YuE2GenerateABC,无 23 同源对)。 */
export function buildBgmCoverStringInputs(style: string, lyrics: string): Record<string, string> {
  return { "22.style": style, "22.lyrics": lyrics };
}

// ---------------------------------------------------------------------------
// 面板状态机(纯 reducer)
// ---------------------------------------------------------------------------

export type BgmCoverPhase = "idle" | "loading-assets" | "ready" | "generating" | "done" | "error";

/** 已落项目的翻唱产物(persistComfyAudio 产物;duration 由 FLAC 头解析,未知为 null)。 */
export interface BgmCoverResult {
  filename: string;
  filePath: string;
  url: string | null;
  durationSeconds: number | null;
}

export interface BgmCoverState {
  phase: BgmCoverPhase;
  assets: BgmCoverAssetOption[];
  selectedAssetId: string | null;
  error: string | null;
  result: BgmCoverResult | null;
}

export type BgmCoverAction =
  | { type: "load-assets" }
  | { type: "assets-loaded"; assets: BgmCoverAssetOption[] }
  | { type: "select-asset"; assetId: string | null }
  | { type: "start" }
  | { type: "complete"; result: BgmCoverResult }
  | { type: "fail"; error: string }
  | { type: "reset" };

export const bgmCoverInitialState: BgmCoverState = {
  phase: "idle",
  assets: [],
  selectedAssetId: null,
  error: null,
  result: null,
};

/** 状态机转移(纯函数):assets-loaded 只在列举期收、select 只在 ready 期收、
 *  complete 只在生成期收(防陈旧回调);fail 除 done 外不设门槛,done 不被迟到失败覆写;
 *  重新列举清空选择与结果(资产清单已变,旧选择不可信)。 */
export function bgmCoverReducer(state: BgmCoverState, action: BgmCoverAction): BgmCoverState {
  switch (action.type) {
    case "load-assets":
      return { ...bgmCoverInitialState, phase: "loading-assets" };
    case "assets-loaded":
      if (state.phase !== "loading-assets") return state;
      return { ...state, phase: "ready", assets: action.assets };
    case "select-asset":
      if (state.phase !== "ready") return state;
      return { ...state, selectedAssetId: action.assetId };
    case "start":
      // 与 bgmBatchReducer 同口径:start 仅拒 generating(防重入),其余相位放行;
      // ...state 保留参考曲清单与选择(生成期面板仍要展示所选资产)——编排器以
      // 组件基线态(deps.initialState)起步,该保留在接线路径上才真正生效。
      if (state.phase === "generating") return state;
      return { ...state, phase: "generating", error: null, result: null };
    case "complete":
      if (state.phase !== "generating") return state;
      return { ...state, phase: "done", result: action.result };
    case "fail":
      // 与 bgmBatchReducer 同口径:fail 不设相位门槛(列举/生成/校验失败都进 error),
      // 唯一被保护的是 done——迟到的失败不得覆写已成功的产物展示。
      if (state.phase === "done") return state;
      return { ...state, phase: "error", error: action.error };
    case "reset":
      return bgmCoverInitialState;
  }
}

/** 面板提示文案(纯函数):ready 期缺参考曲/空资产给指引;其余空串=不展示。 */
export function formatBgmCoverHint(state: BgmCoverState): string {
  if (state.phase === "loading-assets") return "正在列举项目音频资产…";
  if (state.phase === "ready") {
    if (state.assets.length === 0) return "项目内暂无音频资产(先在资产库导入音频再翻唱)";
    if (!state.selectedAssetId) return "选择参考曲并填写新风格后生成";
  }
  return "";
}

/** 时长展示(纯函数):复用抽卡同款口径。 */
export { formatBgmBatchDuration as formatBgmCoverDuration } from "./bgm-batch";

// ---------------------------------------------------------------------------
// 编排器(依赖注入;组件接真引擎,测试全 mock)
// ---------------------------------------------------------------------------

export type BgmCoverExecuteFn = (
  payload: ComfyExecutePayload,
  onProgress?: (progress: ComfyExecuteProgress) => void,
  options?: { pollTimeoutMs?: number },
) => Promise<NonNullable<ComfyExecuteJobReply["result"]>>;

export interface BgmCoverGenerateInput {
  workflowId: string;
  style: string;
  /** 空串/纯空白回退纯音乐铁律五标签(纯音乐翻唱:保旋律无人声)。 */
  lyrics: string;
  asset: BgmCoverAssetOption;
}

export interface BgmCoverGenerateDeps {
  fetchWorkflowText: (workflowId: string) => Promise<string>;
  /** 参考曲读址(asset-file://)→ 纯 b64;组件侧接 projectFiles.readAsBase64 通道。 */
  readAudioB64: (url: string) => Promise<string>;
  execute: BgmCoverExecuteFn;
  persistAudio: (b64: string, engineFilename: string) => Promise<{ filePath: string; url: string | null }>;
  /** 状态机起点基线:组件传现态(参考曲清单+选择随 start 保留,生成期面板仍展示
   *  所选资产,done 后二次翻唱无需重选);缺省 bgmCoverInitialState(测试/无面板)。 */
  initialState?: BgmCoverState;
  /** 引擎进度逐次回报(message 为引擎原文)。 */
  onProgress?: (message: string) => void;
  /** 状态机快照逐次回报(组件直接 setState 展示;整体回推,故基线必须先带清单)。 */
  onStateChange?: (state: BgmCoverState) => void;
}

/**
 * 翻唱生成编排(单发):库取工作流 → 读参考曲 b64 → execute(参考曲走 images 注入口
 * 上传引擎 input/,style/lyrics 走 strings 注入)→ persistComfyAudio 落项目 → 收产物。
 * 不直接抛错:终态经返回值/状态机给出(error 字段),busy 释放由调用方 finally 兜底。
 */
export async function generateBgmCover(
  input: BgmCoverGenerateInput,
  deps: BgmCoverGenerateDeps,
): Promise<BgmCoverState> {
  // 从组件基线态起步派发 start:清单/选择随 ...state 保留,onStateChange 整体回推
  // 不再清空组件的参考曲清单与选中项(生成期下拉照常展示,done 后二次翻唱免重选)。
  let state = bgmCoverReducer(deps.initialState ?? bgmCoverInitialState, { type: "start" });
  deps.onStateChange?.(state);
  try {
    const style = input.style.trim();
    if (!style) throw new Error("请先填写翻唱新风格描述");
    const lyrics = input.lyrics.trim() || YUE2_BGM_LYRICS_IRON;
    const workflowText = await deps.fetchWorkflowText(input.workflowId);
    const parsed = unwrapComfyApiGraph(JSON.parse(workflowText));
    if (!parsed.ok) throw new Error(parsed.error);
    const audioB64 = await deps.readAudioB64(input.asset.url);
    const result = await deps.execute(
      {
        graph: parsed.graph,
        inputs: {
          strings: buildBgmCoverStringInputs(style, lyrics),
          images: [{ key: YUE2_COVER_AUDIO_INPUT_KEY, name: input.asset.filename, b64: audioB64 }],
        },
        timeoutS: YUE2_COVER_EXECUTE_TIMEOUT_S,
      },
      (progress) => deps.onProgress?.(progress.message),
      { pollTimeoutMs: YUE2_COVER_POLL_TIMEOUT_MS },
    );
    const audio = result.audios?.[0];
    if (!audio) throw new Error("工作流已完成但没有输出音频(缺 SaveAudio 类输出节点?)");
    const saved = await deps.persistAudio(audio.b64, audio.filename ?? "cover.flac");
    state = bgmCoverReducer(state, {
      type: "complete",
      result: {
        filename: saved.filePath.split(/[\\/]/).pop() || audio.filename || "cover.flac",
        filePath: saved.filePath,
        url: saved.url,
        durationSeconds: flacDurationSecondsFromB64(audio.b64),
      },
    });
    deps.onStateChange?.(state);
    return state;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    state = bgmCoverReducer(state, { type: "fail", error: message });
    deps.onStateChange?.(state);
    return state;
  }
}
