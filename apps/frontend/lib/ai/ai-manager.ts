/**
 * 统一 AI Manager（门面）
 * 项目内所有「对话/文本、图像、视频、TTS」的 AI 对接逐步收口到这里。
 * P0：text() 委托现有 electronAPI.textCompletion；resolve() 桥接两套绑定（Agent 部署 / 功能绑定）。
 */
import { useAPIConfigStore, type AgentDeploymentKey, type AIFeature } from "@/stores/api-config-store";
import type { IProvider } from "@/lib/api-key-manager";
import type { TextCompletionMessage } from "@/lib/api-manager/text-completion";
import {
  generateCharacterImage,
  generateSceneImage,
  submitGridImageRequest,
  type ImageGenerationParams,
  type ImageGenerationResult,
} from "@/lib/ai/image-generator";
import { getWorkerBridge, initializeWorkerBridge, type AIWorkerBridge } from "@/lib/ai/worker-bridge";
import { generateSpeech } from "@/lib/tts/client";
import type { TtsGenerateRequest, TtsGenerateResponse } from "@/types/tts";

/** 绑定：可来自 studio 的 Agent 部署，或 ai-core 的功能绑定。 */
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
}

export interface AITextResult {
  success: boolean;
  text?: string;
  error?: string;
}

/** 统一绑定解析：Agent → getResolvedAgentModel；Feature → featureBindings 首选项 `vendorId:model`。 */
export function resolve(binding: AIBinding): ResolvedModel | null {
  const state = useAPIConfigStore.getState();
  if ("agent" in binding) {
    const r = state.getResolvedAgentModel(binding.agent);
    if (!r) return null;
    return { provider: r.provider, model: r.model, temperature: r.deployment.temperature, maxTokens: r.deployment.maxOutputTokens };
  }
  const first = state.featureBindings[binding.feature]?.[0];
  if (!first) return null;
  const idx = first.indexOf(":");
  if (idx <= 0) return null;
  const vendorId = first.slice(0, idx);
  const model = first.slice(idx + 1);
  if (!model) return null;
  const provider = state.providers.find((p) => p.id === vendorId || p.platform === vendorId);
  if (!provider) return null;
  return { provider, model };
}

function resolveOrFallback(binding: AIBinding, fallback: boolean): ResolvedModel | null {
  return resolve(binding) ?? (fallback ? resolve({ agent: "universalAi" }) : null);
}

async function text(req: AITextRequest): Promise<AITextResult> {
  if (!window.electronAPI?.textCompletion) return { success: false, error: "当前环境不支持模型调用" };
  const resolved = resolveOrFallback(req.binding, req.fallbackToUniversal !== false);
  if (!resolved) return { success: false, error: "未配置可用模型，请到设置的 API 管理绑定对应 Agent 或通用AI" };
  const result = await window.electronAPI.textCompletion({
    provider: resolved.provider,
    model: resolved.model,
    messages: req.messages,
    temperature: resolved.temperature ?? req.temperature ?? 0.6,
    maxTokens: resolved.maxTokens ?? req.maxTokens ?? 4096,
  });
  return { success: result.success, text: result.text, error: result.error };
}

/** 流式文本：增量经 onChunk 回调；环境不支持流式时回退一次性并整段回调一次。 */
async function textStream(req: AITextRequest, onChunk: (delta: string) => void): Promise<AITextResult> {
  if (!window.electronAPI?.textCompletionStream) {
    const fallback = await text(req);
    if (fallback.success && fallback.text) onChunk(fallback.text);
    return fallback;
  }
  const resolved = resolveOrFallback(req.binding, req.fallbackToUniversal !== false);
  if (!resolved) return { success: false, error: "未配置可用模型，请到设置的 API 管理绑定对应 Agent 或通用AI" };
  const result = await window.electronAPI.textCompletionStream({
    provider: resolved.provider,
    model: resolved.model,
    messages: req.messages,
    temperature: resolved.temperature ?? req.temperature ?? 0.6,
    maxTokens: resolved.maxTokens ?? req.maxTokens ?? 4096,
  }, onChunk);
  return { success: result.success, text: result.text, error: result.error };
}

/** 图像生成（角色/场景）：委托 image-generator（内部按功能绑定解析）；出错抛异常，返回 {imageUrl,taskId?}。 */
async function image(params: ImageGenerationParams, kind: "character" | "scene" = "character"): Promise<ImageGenerationResult> {
  return kind === "scene" ? generateSceneImage(params) : generateCharacterImage(params);
}

/** 网格/多图生成：调用方已解析好 model/apiKey/baseUrl。 */
async function imageGrid(params: Parameters<typeof submitGridImageRequest>[0]) {
  return submitGridImageRequest(params);
}

/** ai-core 工作线程（导演 剧本→场景→图像→视频 流水线，事件式长任务）。同步取单例。 */
function worker(): AIWorkerBridge {
  return getWorkerBridge();
}

/** 确保 ai-core 工作线程已初始化后返回（异步）。 */
function initWorker(): Promise<AIWorkerBridge> {
  return initializeWorkerBridge();
}

/** 语音合成（本地 TTS sidecar）：提交生成任务，返回任务信息。 */
function tts(payload: TtsGenerateRequest): Promise<TtsGenerateResponse> {
  return generateSpeech(payload);
}

export const aiManager = { resolve, text, textStream, image, imageGrid, worker, initWorker, tts };
