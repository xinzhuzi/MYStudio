/**
 * 统一 AI Manager（门面）
 * 项目内所有「对话/文本、图像、视频、TTS」的 AI 对接逐步收口到这里。
 * P0：text() 委托现有 electronAPI.textCompletion；resolve() 桥接两套绑定（Agent 部署 / 功能绑定）。
 */
import { getAIConfigStore, type AgentDeploymentKey } from "@/lib/ai/config/store-adapter";
import type { AIFeature } from "@/lib/ai/feature-definitions";
import type { IProvider } from "@/lib/ai/core";
import type {
  TextCompletionMessage,
  TextCompletionStopReason,
  TextCompletionUsage,
} from "@/lib/ai/text-completion";
import {
  generateCharacterImage,
  generatePropImage,
  generateSceneImage,
  submitGridImageRequest,
  type ImageGenerationParams,
  type ImageGenerationResult,
} from "@/lib/ai/image-generator";
import { getWorkerBridge, initializeWorkerBridge, type AIWorkerBridge } from "@/lib/ai/worker-bridge";
import { extractStyleTokens } from "@/lib/ai/style-extractor";
import { generateImage as _engineGenerateImage } from "@/lib/ai/image-generation-engine";
import { generateVideo as _engineGenerateVideo } from "@/lib/ai/video-generation-engine";
import { callVideoGenerationApi } from "@/lib/ai/video-generator";
import { generateSpeech } from "@/lib/tts/client";
import {
  callFeatureAPI,
  callFeatureMultimodalAPI,
  getFeatureConfig,
  getFeatureNotConfiguredMessage,
} from "@/lib/ai/feature-router";
import type { TtsGenerateRequest, TtsGenerateResponse } from "@/types/tts";

/** 绑定：可来自 studio 的 Agent 部署，或 AI core 的功能绑定。 */
export type AIBinding = { agent: AgentDeploymentKey } | { feature: AIFeature };

export interface ResolvedModel {
  provider: IProvider;
  model: string;
  temperature?: number;
  maxTokens?: number;
}

export interface AITextRequest {
  binding: AIBinding;
  messages: TextCompletionMessage[];
  temperature?: number;
  maxTokens?: number;
  /** 解析不到绑定时是否回退到通用AI，默认 true */
  fallbackToUniversal?: boolean;
  /** 整体调用超时（穿透到主进程 SDK/HTTP 两层）；缺省走各层默认 */
  timeoutMs?: number;
  /** 关闭思考型模型深度思考(1013 提取空文本修;结构化任务用,SDK/HTTP 两层同注) */
  disableThinking?: boolean;
  /**
   * 显式模型覆写(D20,10-19 轮3 已裁采纳):提供时覆写 binding 解析出的
   * resolved.model;provider/密钥仍走 binding 解析(含回退链),覆写不绕过
   * 绑定校验。用途=全书提取对比模式(glm-5.3-flash 旁路跑)等显式点名场景。
   */
  model?: string;
}

export interface AITextResult {
  success: boolean;
  text?: string;
  error?: string;
  // 1011 欠账③:主进程结构化终态(stopReason/usage)原先在 text/textStream 返回处被收窄丢弃,
  // 渲染层零消费方可取——此处放宽为可选透传,IPC 与 HTTP 回退腿带回多少透多少,缺省腿不填。
  stopReason?: TextCompletionStopReason;
  usage?: TextCompletionUsage;
}

/** 统一绑定解析：Agent → getResolvedAgentModel；Feature → feature-router（含多模型轮询/key 轮换/兼容旧配置）。 */
export function resolve(binding: AIBinding): ResolvedModel | null {
  if ("agent" in binding) {
    const r = getAIConfigStore().getResolvedAgentModel(binding.agent);
    if (!r) return null;
    // 1013 烤问收口:不再回传 deployment.maxOutputTokens——部署对象沿袭 API_AGENT_DEPLOYMENT_DEFAULTS
    // 自带小额默认(导演规划 4096 等),旧合并式 Math.max(部署值,请求值)||兜底 下小值恒赢、64K 单一真源
    // 永不生效(实弹:75cd03cf 后导演规划仍实发 4096 被思考独占零正文)。max_tokens 统一走 maxTokensFloor。
    return { provider: r.provider, model: r.model, temperature: r.deployment.temperature };
  }
  const cfg = getFeatureConfig(binding.feature);
  if (!cfg) return null;
  return { provider: cfg.provider, model: cfg.model };
}

function resolveOrFallback(binding: AIBinding, fallback: boolean): ResolvedModel | null {
  return resolve(binding) ?? (fallback ? resolve({ agent: "universalAi" }) : null);
}

/** 用户常设令(1013 终裁):max_tokens 兜底单一真源——最大输出 64K,截断比浪费贵。
 * 演进史:8192 旧帽→16384→200K(被 anthropic 口参数校验拒,code 1210)→131072(服务端声明区间上界)→用户终裁 65536(实测最大输出 64K,云端本地统一)。云端与本地统一 65536。
 * 显式调用位点一律不传 maxTokens,统一走本兜底(配置一次)。 */
function maxTokensFloor(_provider: IProvider): number {
  return 65536;
}

async function text(req: AITextRequest): Promise<AITextResult> {
  if (!window.electronAPI?.textCompletion) return { success: false, error: "当前环境不支持模型调用" };
  const resolved = resolveOrFallback(req.binding, req.fallbackToUniversal !== false);
  if (!resolved) return { success: false, error: "未配置可用模型，请到设置的云端AI绑定对应 Agent 或通用AI" };
  const result = await window.electronAPI.textCompletion({
    provider: resolved.provider,
    model: req.model ?? resolved.model, // D20:显式覆写只换 model,provider/密钥仍走 binding 解析
    messages: req.messages,
    disableThinking: req.disableThinking,
    temperature: resolved.temperature ?? req.temperature ?? 0.6,
    maxTokens: Math.max(req.maxTokens ?? 0, maxTokensFloor(resolved.provider)), // 64K 硬地板:显式请求值只能抬高(宁大勿小),部署级小值不再参战
    timeoutMs: req.timeoutMs,
  });
  // 欠账③:stopReason/usage 透传(原收窄丢弃,见 AITextResult 注释);非流式回退腿共用本返回。
  return { success: result.success, text: result.text, error: result.error, stopReason: result.stopReason, usage: result.usage };
}
/** 流式增量种类(1011 thinking 进流):text=正文增量,thinking=思考增量(思考型模型思考期反馈)。 */
export type AITextStreamChunkKind = "text" | "thinking";

/** 流式文本：增量经 onChunk(delta, kind) 回调;环境不支持流式时回退一次性并整段回调一次。 */
async function textStream(req: AITextRequest, onChunk: (delta: string, kind: AITextStreamChunkKind) => void): Promise<AITextResult> {
  if (!window.electronAPI?.textCompletionStream) {
    const fallback = await text(req);
    if (fallback.success && fallback.text) onChunk(fallback.text, "text");
    return fallback;
  }
  const resolved = resolveOrFallback(req.binding, req.fallbackToUniversal !== false);
  if (!resolved) return { success: false, error: "未配置可用模型，请到设置的云端AI绑定对应 Agent 或通用AI" };
  const result = await window.electronAPI.textCompletionStream({
    provider: resolved.provider,
    model: req.model ?? resolved.model, // D20:显式覆写只换 model,provider/密钥仍走 binding 解析
    messages: req.messages,
    disableThinking: req.disableThinking,
    temperature: resolved.temperature ?? req.temperature ?? 0.6,
    maxTokens: Math.max(req.maxTokens ?? 0, maxTokensFloor(resolved.provider)), // 64K 硬地板:显式请求值只能抬高(宁大勿小),部署级小值不再参战
    // 流式 IPC 整体预算（SDK 流式+HTTP 回退共享）；缺省主进程走 300s。
    // B+ 剧本长输出若不传，回退一次性 39k 级 prompt 实弹可超 300s（10-11 GLM 超时根因之一）。
    timeoutMs: req.timeoutMs,
  }, onChunk);
  // 欠账③:流式终态 stopReason/usage 透传(SDK stream.finishReason/usage 与 HTTP 回退分类同源)。
  return { success: result.success, text: result.text, error: result.error, stopReason: result.stopReason, usage: result.usage };
}

/** 图像生成（角色/场景/道具）：委托 image-generator（内部按功能绑定解析）；出错抛异常，返回 {imageUrl,taskId?}。 */
async function image(params: ImageGenerationParams, kind: "character" | "scene" | "prop" = "character"): Promise<ImageGenerationResult> {
  if (kind === "scene") return generateSceneImage(params);
  if (kind === "prop") return generatePropImage(params);
  return generateCharacterImage(params);
}

/** 网格/多图生成：调用方已解析好 model/apiKey/baseUrl。 */
async function imageGrid(params: Parameters<typeof submitGridImageRequest>[0]) {
  return submitGridImageRequest(params);
}

/** AI core 工作线程（导演 剧本→场景→图像→视频 流水线，事件式长任务）。同步取单例。 */
function worker(): AIWorkerBridge {
  return getWorkerBridge();
}

/** 确保 AI core 工作线程已初始化后返回（异步）。 */
function initWorker(): Promise<AIWorkerBridge> {
  return initializeWorkerBridge();
}

/** 语音合成（本地 TTS sidecar）：提交生成任务，返回任务信息。 */
function tts(payload: TtsGenerateRequest): Promise<TtsGenerateResponse> {
  return generateSpeech(payload);
}

/** 功能绑定的一次性文本调用（feature-router，含多 key 轮换/思考模式）。 */
function featureText(...args: Parameters<typeof callFeatureAPI>): Promise<string> {
  return callFeatureAPI(...args);
}

/** 功能绑定配置查询：业务层优先从 AI Manager 进入，不直接依赖 feature-router。 */
function featureConfig(feature: AIFeature) {
  return getFeatureConfig(feature);
}

function featureNotConfiguredMessage(feature: AIFeature) {
  return getFeatureNotConfiguredMessage(feature);
}

/** 功能绑定的多模态 chat（文本+图片），返回内容字符串；调用方自行构建 messages 与解析。 */
function chatMultimodal(...args: Parameters<typeof callFeatureMultimodalAPI>): Promise<string> {
  return callFeatureMultimodalAPI(...args);
}

/** 视觉/图片理解：从文本+参考图提取风格 tokens（image_understanding 功能）。 */
function vision(...args: Parameters<typeof extractStyleTokens>) {
  return extractStyleTokens(...args);
}

/** 自由板块图片生成。 */
function generateImage(...args: Parameters<typeof _engineGenerateImage>) {
  return _engineGenerateImage(...args);
}

/** 自由板块视频生成。 */
function generateVideo(...args: Parameters<typeof _engineGenerateVideo>) {
  return _engineGenerateVideo(...args);
}

/** 视频生成（统一直连视频 API：提交+轮询，支持 kling/grok/minimax/luma/runway/wan/vidu 等）。 */
function video(...args: Parameters<typeof callVideoGenerationApi>) {
  return callVideoGenerationApi(...args);
}

export const aiManager = {
  resolve,
  text,
  textStream,
  image,
  imageGrid,
  worker,
  initWorker,
  tts,
  featureConfig,
  featureNotConfiguredMessage,
  featureText,
  chatMultimodal,
  vision,
  generateImage,
  generateVideo,
  video,
};
