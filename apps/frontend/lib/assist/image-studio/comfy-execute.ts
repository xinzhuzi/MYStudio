// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

/**
 * ComfyUI 执行通道(09-08 二期/三期收官,流X):
 * - HTTP:渲染层直连本地生图 sidecar 的 POST /comfy/execute(job 化)+
 *   GET /comfy/jobs/{id} 轮询 + GET /comfy/engine/object-info?class=X 单类
 *   schema 拉取(传输细节照 comfy-sidecar-bridge 同款:探活门禁+Bearer+超时)。
 * - 纯函数:工作流节点上游收集(prompt 正负极性分流/图沿边收集)与执行计划
 *   构建(graph 解析+widget 值回填+注入点规划),单测覆盖。
 * - 落盘:输出图按成图节点 mediaRef 模式写项目 media/ai-image/(project-file://)
 *   + 媒体库条目 + 磁盘 ledger(照 run-node-generation 治理口径)。
 */

import { unwrapComfyApiGraph, type ComfyApiWorkflow } from "@/lib/assist/image-studio/comfy-workflow-import";
import {
  appendProjectLedger,
  ledgerFilenameOf,
  ledgerMonthFolderOf,
} from "@/lib/assist/image-studio/history-records";
import { getProjectFilesBridge } from "@/lib/bridge/project-files";
import { readImageAsBase64 } from "@/lib/media/image-storage";
import { saveToMediaLibrary } from "@/lib/ai/generation-media";
import { useProjectStore } from "@/stores/project/project-store";
import type { ImageWorkflowComfyWorkflowNode, ImageWorkflowGraph } from "@/types/studio";

const COMFY_SIDECAR_BASE_URL = "http://127.0.0.1:17595";
const COMFY_SIDECAR_TOKEN = "manying-local-image";
const DEFAULT_TIMEOUT_MS = 15_000;
/** 执行 job 轮询:间隔与总上限(后端执行超时 300s,前端放宽到 330s 收尾)。 */
const JOB_POLL_INTERVAL_MS = 1_500;
const JOB_POLL_TIMEOUT_MS = 330_000;

/** 引擎无鉴权但 sidecar 有(固定本地令牌,与 comfy-sidecar-bridge 同源) */
export interface ComfySidecarJsonOptions {
  body?: unknown;
  query?: Record<string, string>;
  timeoutMs?: number;
}

/** sidecar 探活门禁(照 comfy-sidecar-bridge:未运行零 fetch,避免渲染层网络错误日志) */
async function sidecarLikelyUp(): Promise<boolean> {
  try {
    const bridge = (window as { imageGenRuntime?: { status?: () => Promise<{ running?: boolean }> } })
      .imageGenRuntime;
    if (bridge?.status) return Boolean((await bridge.status())?.running);
  } catch {
    return false;
  }
  return false;
}

/** sidecar 统一 JSON 请求(探活+Bearer+超时+大白话错误)。 */
export async function comfySidecarJson<T>(
  method: "GET" | "POST" | "DELETE",
  path: string,
  options: ComfySidecarJsonOptions = {},
): Promise<T> {
  if (typeof window !== "undefined" && !(await sidecarLikelyUp())) {
    throw new Error("本地生图服务未运行,请先在 设置→本地配置 完成「准备运行时」");
  }
  const url = new URL(`${COMFY_SIDECAR_BASE_URL}${path}`);
  for (const [key, value] of Object.entries(options.query ?? {})) {
    url.searchParams.set(key, value);
  }
  let response: Response;
  try {
    response = await fetch(url.toString(), {
      method,
      headers: {
        ...(options.body !== undefined ? { "Content-Type": "application/json" } : {}),
        Authorization: `Bearer ${COMFY_SIDECAR_TOKEN}`,
      },
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
      signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
  } catch (error) {
    if (error instanceof DOMException && (error.name === "TimeoutError" || error.name === "AbortError")) {
      throw new Error("本地生图服务响应超时,请稍后重试");
    }
    throw new Error("无法连接本地生图服务,请先在 设置→本地配置 完成「准备运行时」后重试");
  }
  const json = (await response.json().catch(() => null)) as
    | (T & { error?: { message?: string } })
    | null;
  if (!response.ok) {
    throw new Error(json?.error?.message || `请求失败(HTTP ${response.status})`);
  }
  if (!json) {
    throw new Error("本地生图服务应答格式异常");
  }
  return json;
}

// ---------------------------------------------------------------------------
// 执行契约类型与 job 轮询
// ---------------------------------------------------------------------------

/** /comfy/execute 的注入图片(引擎上传后写回文件名) */
export interface ComfyExecuteImageInput {
  key: string;
  name: string;
  b64: string;
}

export interface ComfyExecutePayload {
  graph: ComfyApiWorkflow;
  inputs: {
    strings: Record<string, string>;
    images: ComfyExecuteImageInput[];
  };
  /** 执行超时秒数(后端默认 300;音频整曲类长任务放宽,上限 1200)。 */
  timeoutS?: number;
}

/** 后端 job 轮询应答(engine_manager jobs 形状) */
export interface ComfyExecuteJobReply {
  id?: string;
  kind?: string;
  status?: "running" | "complete" | "error";
  step?: string;
  message?: string | null;
  error?: string | null;
  result?: {
    promptId?: string;
    images?: Array<{
      nodeId?: string;
      filename?: string;
      b64: string;
    }>;
    /** SaveAudio 类节点产物(09-20 YuE2 BGM 接线;与 images 同收集链) */
    audios?: Array<{
      nodeId?: string;
      filename?: string;
      b64: string;
    }>;
  } | null;
}

export type ComfyExecuteStage = "upload" | "queue" | "running" | "collect";

export interface ComfyExecuteProgress {
  stage: ComfyExecuteStage | "unknown";
  message: string;
}

function stageOf(step: unknown): ComfyExecuteStage | "unknown" {
  return step === "upload" || step === "queue" || step === "running" || step === "collect" ? step : "unknown";
}

/** 提交执行 job → 轮询到终态;onProgress 逐阶段回报(上传/排队/执行中/收图)。
 * options.pollTimeoutMs:轮询总上限(默认 330s 收尾;音频整曲类长任务按
 * payload.timeoutS 放宽时同步放宽,建议 pollTimeoutMs ≥ timeoutS*1000+30s)。 */
export async function runComfyExecute(
  payload: ComfyExecutePayload,
  onProgress?: (progress: ComfyExecuteProgress) => void,
  options: { pollTimeoutMs?: number } = {},
): Promise<NonNullable<ComfyExecuteJobReply["result"]>> {
  const { jobId } = await comfySidecarJson<{ jobId: string }>("POST", "/comfy/execute", {
    body: payload as unknown as Record<string, unknown>,
    timeoutMs: 20_000,
  });
  const pollTimeoutMs = options.pollTimeoutMs ?? JOB_POLL_TIMEOUT_MS;
  const deadline = Date.now() + pollTimeoutMs;
  for (;;) {
    const job = await comfySidecarJson<ComfyExecuteJobReply>(
      "GET",
      `/comfy/jobs/${encodeURIComponent(jobId)}`,
      { timeoutMs: 10_000 },
    );
    if (job.status === "error") {
      throw new Error(job.error || job.message || "ComfyUI 执行失败");
    }
    if (job.status === "complete" && job.result) {
      return job.result;
    }
    if (Date.now() >= deadline) {
      throw new Error(`ComfyUI 执行超时(${Math.round(pollTimeoutMs / 1000)} 秒),请检查引擎队列后重试`);
    }
    onProgress?.({
      stage: stageOf(job.step),
      message: job.message ?? "引擎执行中…",
    });
    await new Promise((resolve) => setTimeout(resolve, JOB_POLL_INTERVAL_MS));
  }
}

// ---------------------------------------------------------------------------
// 纯函数:上游收集与执行计划(单测覆盖)
// ---------------------------------------------------------------------------

/** 工作流节点上游收集产物(prompt 正负分流 + 图 URL 序列) */
export interface ComfyUpstreamCollectResult {
  positivePrompt: string;
  negativePrompt: string;
  hasPromptSource: boolean;
  imageUrls: string[];
  /** 连了图边但源图缺失(空参考图/未生成的上游)——运行前阻断指路用 */
  missingImageCount: number;
}

/** 源节点可提取的图地址(reference.imageUrl / generated.uncloth/comfy*.resultUrl) */
export function comfyUpstreamImageUrlOf(node: ImageWorkflowGraph["nodes"][number] | undefined): string | undefined {
  if (!node) return undefined;
  if (node.type === "reference") return node.imageUrl || undefined;
  if (
    node.type === "generated" || node.type === "uncloth"
    || node.type === "comfy-workflow" || node.type === "comfy-generic"
  ) {
    return node.resultUrl || undefined;
  }
  return undefined;
}

/**
 * 沿边收集上游输入(纯函数):提示词按 prompt 节点的正/负极性分流
 * (双出口裁定:正口/整节点=正负都供,负口=只供负向);图按边序收集。
 */
export function collectComfyUpstream(
  graph: ImageWorkflowGraph,
  nodeId: string,
): ComfyUpstreamCollectResult {
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  const incoming = graph.edges.filter((edge) => edge.target === nodeId);
  let positivePrompt = "";
  let negativePrompt = "";
  let hasPromptSource = false;
  const imageUrls: string[] = [];
  let missingImageCount = 0;
  for (const edge of incoming) {
    const source = nodesById.get(edge.source);
    if (!source) continue;
    if (source.type === "prompt") {
      hasPromptSource = true;
      const onlyNegative = edge.sourceHandle === "negative";
      if (!onlyNegative && source.prompt.trim()) {
        positivePrompt = positivePrompt ? `${positivePrompt}\n${source.prompt.trim()}` : source.prompt.trim();
      }
      const negativeText = (source.negativePrompt ?? "").trim();
      if (negativeText) {
        negativePrompt = negativePrompt
          ? `${negativePrompt}\n${negativeText}`
          : negativeText;
      }
      continue;
    }
    const imageUrl = comfyUpstreamImageUrlOf(source);
    if (imageUrl) imageUrls.push(imageUrl);
    else if (source.type === "reference" || source.type === "generated" || source.type === "uncloth"
      || source.type === "comfy-workflow" || source.type === "comfy-generic") {
      missingImageCount += 1;
    }
  }
  return { positivePrompt, negativePrompt, hasPromptSource, imageUrls, missingImageCount };
}

/** 工作流节点执行计划(payload 雏形;图源=库内容 JSON 原文) */
export type ComfyWorkflowExecutionPlan =
  | {
      ok: true;
      graph: ComfyApiWorkflow;
      strings: Record<string, string>;
      /** 待上传图槽位(源 URL 由调用方转 b64) */
      imageSlots: Array<{ key: string; name: string; sourceUrl: string }>;
    }
  | { ok: false; error: string };

/**
 * 构建执行计划(纯函数):库 JSON → 图深拷贝 → widget 现值回填 → 边界口
 * 注入规划(prompt-text 口按极性吃上游文本;image 口按序吃上游图)。
 * 未注入的口保持工作流原值(默认值不动即可跑——二期裁定)。
 */
export function planComfyWorkflowExecution(
  workflowText: string,
  node: Pick<ImageWorkflowComfyWorkflowNode, "descriptor" | "widgetValues">,
  upstream: ComfyUpstreamCollectResult,
): ComfyWorkflowExecutionPlan {
  let parsed: unknown;
  try {
    parsed = JSON.parse(workflowText);
  } catch {
    return { ok: false, error: "工作流库内容不是有效 JSON(库条目可能损坏,请重新导入)" };
  }
  const unwrapped = unwrapComfyApiGraph(parsed);
  if (!unwrapped.ok) return { ok: false, error: unwrapped.error };
  const graph: ComfyApiWorkflow = JSON.parse(JSON.stringify(unwrapped.graph));

  // widget 现值回填(id=节点号.字段名;缺项保持工作流原值)
  for (const [widgetId, value] of Object.entries(node.widgetValues ?? {})) {
    const dot = widgetId.indexOf(".");
    if (dot <= 0 || value === null || typeof value === "object") continue;
    const target = graph[widgetId.slice(0, dot)];
    if (target) {
      target.inputs[widgetId.slice(dot + 1)] = value;
    }
  }

  // 边界口注入规划(prompt-text 按极性;image 按序)
  const strings: Record<string, string> = {};
  const imageSlots: Array<{ key: string; name: string; sourceUrl: string }> = [];
  let imagePortIndex = 0;
  for (const port of node.descriptor.ports) {
    if (port.type === "prompt-text") {
      const text = port.polarity === "negative" ? upstream.negativePrompt : upstream.positivePrompt;
      if (text.trim()) strings[port.id] = text.trim();
    } else {
      const sourceUrl = upstream.imageUrls[imagePortIndex];
      imagePortIndex += 1;
      if (sourceUrl) {
        imageSlots.push({ key: port.id, name: `mystudio-${port.inputKey}.png`, sourceUrl });
      }
    }
  }
  return { ok: true, graph, strings, imageSlots };
}

// ---------------------------------------------------------------------------
// 图片地址 → b64 与落盘(mediaRef 模式)
// ---------------------------------------------------------------------------

/** 应用侧图片地址(local-image:// / project-file:// / data: / http)→ 纯 b64 */
export async function comfyImageUrlToB64(url: string): Promise<string> {
  // project-file/asset-file 同一读 IPC(09-09 阶段2 批3 双 scheme 扩展)
  if (url.startsWith("project-file://") || url.startsWith("asset-file://")) {
    const result = await getProjectFilesBridge()?.readAsBase64(url);
    if (!result?.success || !result.base64) {
      throw new Error(`项目内图片读取失败:${result?.error || url}`);
    }
    const base64 = result.base64;
    return base64.startsWith("data:") ? base64.slice(base64.indexOf(",") + 1) : base64;
  }
  const dataUrl = await readImageAsBase64(url);
  if (!dataUrl) {
    throw new Error(`图片读取失败(不在应用存储内或已失效):${url.slice(0, 80)}`);
  }
  const comma = dataUrl.indexOf(",");
  return comma >= 0 && dataUrl.startsWith("data:") ? dataUrl.slice(comma + 1) : dataUrl;
}

/** b64 → 项目 media/ai-image/ 受管地址 + 媒体库条目 + 磁盘 ledger(失败不阻断回显) */
export async function persistComfyImage(
  b64: string,
  title: string,
  options: { source?: string; prompt?: string; negativePrompt?: string | null } = {},
): Promise<{ url: string | null; mediaId?: string; persisted: boolean }> {
  const projectId = useProjectStore.getState().activeProjectId;
  const now = new Date();
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const seed = title.slice(0, 24).replace(/[^\w\u4e00-\u9fff]+/g, "_").slice(0, 24) || "comfy";
  const filename = `comfy_${seed}_${Date.now()}.png`;
  let stableUrl: string | null = null;
  if (projectId) {
    const projectFiles = getProjectFilesBridge();
    if (projectFiles?.saveImage) {
      const saved = await projectFiles
        .saveImage({
          projectId,
          relativePath: `media/ai-image/${month}/${filename}`,
          source: `data:image/png;base64,${b64}`,
        })
        .catch(() => undefined);
      if (saved?.success && saved.url) stableUrl = saved.url;
    }
  }
  const finalUrl = stableUrl ?? `data:image/png;base64,${b64}`;
  const mediaId = saveToMediaLibrary(finalUrl, title, "ai-image");
  if (projectId && stableUrl) {
    void appendProjectLedger({
      projectId,
      relativePath: `media/ai-image/${ledgerMonthFolderOf(stableUrl)}/ledger.json`,
      entry: {
        ts: Date.now(),
        prompt: options.prompt ?? title,
        model: "comfy",
        file: `${ledgerMonthFolderOf(stableUrl)}/${ledgerFilenameOf(stableUrl)}`,
        negativePrompt: options.negativePrompt ?? null,
        aspectRatio: "",
        resolution: null,
        references: [],
        source: options.source ?? "comfy-node",
      },
    }).catch(() => undefined);
  }
  return { url: stableUrl, mediaId, persisted: stableUrl !== null };
}

/**
 * b64 音频 → 项目 media/audio/<月>/ 受管文件(09-20 YuE2 BGM 接线)。
 * 返回绝对 filePath(供 remotionChapterManifest.importAudio 的 sourcePath)+
 * project-file:// url;无项目/写失败给大白话错误。
 */
export async function persistComfyAudio(
  b64: string,
  engineFilename: string,
): Promise<{ filePath: string; url: string | null }> {
  const projectId = useProjectStore.getState().activeProjectId;
  const projectFiles = getProjectFilesBridge();
  if (!projectId || !projectFiles?.writeBinary) {
    throw new Error("当前环境无法写入项目音频(需在桌面应用的项目内使用)");
  }
  const extension = (engineFilename.split(".").pop() ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const now = new Date();
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const filename = `bgm_yue2_${Date.now()}.${extension || "flac"}`;
  const binary = Uint8Array.from(atob(b64), (char) => char.charCodeAt(0));
  const bytes = new ArrayBuffer(binary.byteLength);
  new Uint8Array(bytes).set(binary);
  const saved = await projectFiles.writeBinary({
    projectId,
    relativePath: `media/audio/${month}/${filename}`,
    bytes,
  });
  if (!saved?.success || !saved.filePath) {
    throw new Error(`生成的音频写入项目失败:${saved?.error || engineFilename}`);
  }
  return { filePath: saved.filePath, url: saved.url ?? null };
}

// ---------------------------------------------------------------------------
// 工作流节点运行编排(卡上「运行」按钮的执行核;状态回写由调用方落 store)
// ---------------------------------------------------------------------------

export interface RunComfyWorkflowNodeResult {
  /** 回填地址:优先项目内受管地址;落盘失败降级 data:(内存预览,持久化时剥离) */
  imageUrl: string;
  mediaId?: string;
  persisted: boolean;
  imageCount: number;
  promptId?: string;
}

/**
 * 运行工作流节点端到端:库取原文 → 上游收集 → 计划 → b64 转换 → /comfy/execute
 * → 首图落盘(mediaRef 模式)。进度经 onStage 回报给卡面状态行。
 */
export async function runComfyWorkflowNode(
  graph: ImageWorkflowGraph,
  nodeId: string,
  options: {
    /** 工作流库内容通道(真实=sidecar HTTP;测试=内存 mock) */
    fetchWorkflowText: (workflowId: string) => Promise<string>;
    onProgress?: (progress: ComfyExecuteProgress) => void;
  },
): Promise<RunComfyWorkflowNodeResult> {
  const node = graph.nodes.find(
    (item): item is ImageWorkflowComfyWorkflowNode => item.id === nodeId && item.type === "comfy-workflow",
  );
  if (!node) throw new Error("工作流节点不存在");
  const upstream = collectComfyUpstream(graph, nodeId);
  if (upstream.missingImageCount > 0) {
    throw new Error(
      `有 ${upstream.missingImageCount} 张上游图还没准备好(空参考图或未生成):先上传/生成,或断开连线再运行`,
    );
  }
  const workflowText = await options.fetchWorkflowText(node.workflowId);
  const plan = planComfyWorkflowExecution(workflowText, node, upstream);
  if (!plan.ok) throw new Error(plan.error);
  const images: ComfyExecuteImageInput[] = [];
  for (const slot of plan.imageSlots) {
    images.push({ key: slot.key, name: slot.name, b64: await comfyImageUrlToB64(slot.sourceUrl) });
  }
  const result = await runComfyExecute(
    { graph: plan.graph, inputs: { strings: plan.strings, images } },
    options.onProgress,
  );
  const outputs = result.images ?? [];
  if (outputs.length === 0) {
    throw new Error("工作流已完成但没有输出图片(缺 SaveImage 类输出节点?)");
  }
  const title = node.title || "ComfyUI 工作流";
  const persisted = await persistComfyImage(outputs[0].b64, title);
  return {
    imageUrl: persisted.url ?? `data:image/png;base64,${outputs[0].b64}`,
    mediaId: persisted.mediaId,
    persisted: persisted.persisted,
    imageCount: outputs.length,
    promptId: result.promptId,
  };
}
