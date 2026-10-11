// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
/**
 * API Provider Types
 * Common types for all AI service providers
 */

import type { ProviderId, ServiceType, AsyncTaskResult } from '../types';

/** Model capabilities exposed by the provider configuration layer. */
export type ModelCapability =
  | 'text'
  | 'vision'
  | 'function_calling'
  | 'image_generation'
  | 'video_generation'
  | 'tts'
  | 'web_search'
  | 'reasoning'
  | 'embedding';

/** Persisted provider configuration shared by AI routing and settings. */
export interface IProvider {
  id: string;
  platform: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string[];
  apiProtocol?: ProviderApiProtocol;
  capabilities?: ModelCapability[];
  contextLimit?: number;
}

/** IProvider.apiProtocol 的取值域(供应商接口协议声明)。 */
export type ProviderApiProtocol = 'openai-compatible' | 'anthropic-compatible' | 'gemini-compatible';

// ==================== apiProtocol 配置期推断与校验(1011) ====================
// 1011 断点D(apiProtocol 配置期必填):「platform=custom + 协议未声明 → 运行时按
// OpenAI 兼容兜底 → 打错协议口 → 流秒回空」这类病的配置期防线。推断/校验全部
// 收敛在本文件;SDK 实例路由恒以 ai-sdk-bridge
// createProviderInstance 为准(1011 刚修好,禁止在此重构镜像它的运行时行为)。
// 1011 欠账④:下方推断表升为全仓单一真源——运行时 HTTP 腿(text-completion.ts
// 的协议尝试序与 SSE 分派)改经 inferProviderApiProtocolFromPlatform 消费,
// 不许再立平行表;UI 兜底与运行时尝试链的语义差异钉死在该导出函数注释里。

/** 协议下拉的取值与中文标签(供应商表单/展示共用同一张表)。 */
export const PROVIDER_API_PROTOCOL_OPTIONS: Array<{ value: ProviderApiProtocol; label: string }> = [
  { value: 'openai-compatible', label: 'OpenAI 兼容' },
  { value: 'anthropic-compatible', label: 'Anthropic 兼容' },
  { value: 'gemini-compatible', label: 'Gemini 兼容' },
];

/** 平台名 → 协议推断表(全仓单源,1011 欠账④收敛):具名平台协议可从平台名锁定
 * (镜像运行时平台路由的协议形态);custom 不入表——协议无法从平台名推断,由表单必填。 */
const PLATFORM_API_PROTOCOL_INFERENCE: Record<string, ProviderApiProtocol> = {
  'openai': 'openai-compatible',
  'openai-compatible': 'openai-compatible',
  'deepseek': 'openai-compatible',
  'memefast': 'openai-compatible',
  'minimax': 'openai-compatible',
  'klingai': 'openai-compatible',
  'volcengine': 'openai-compatible',
  'vidu': 'openai-compatible',
  'runninghub': 'openai-compatible',
  'tts-compatible': 'openai-compatible',
  'anthropic-compatible': 'anthropic-compatible',
  'gemini-compatible': 'gemini-compatible',
};

/** 平台协议推断单源导出(1011 欠账④):具名平台返回推断协议;custom 与未知平台返回
 * undefined——兜底语义归调用方:UI 层 resolveProviderApiProtocol 兜 'openai-compatible'
 * 仅作展示;运行时 HTTP 腿对 undefined 保持全协议尝试链(两语义不许在此静默合流)。 */
export function inferProviderApiProtocolFromPlatform(platform: string): ProviderApiProtocol | undefined {
  return PLATFORM_API_PROTOCOL_INFERENCE[platform];
}

/** custom 平台协议无法从平台名推断 → 表单必填、存量条目挂警示徽标。 */
export function isProviderApiProtocolInferable(platform: string): boolean {
  return platform !== 'custom';
}

/**
 * 解析供应商生效协议:显式 apiProtocol 优先 → 平台推断表 → 'openai-compatible' 兜底。
 * 仅用于 UI 展示与配置校验;运行时路由见 ai-sdk-bridge.createProviderInstance。
 */
export function resolveProviderApiProtocol(
  provider: Pick<IProvider, 'platform' | 'apiProtocol'>,
): ProviderApiProtocol {
  if (provider.apiProtocol) return provider.apiProtocol;
  return inferProviderApiProtocolFromPlatform(provider.platform) ?? 'openai-compatible';
}

/** 协议中文标签(表单选项与展示位共用)。 */
export function getProviderApiProtocolLabel(protocol: ProviderApiProtocol): string {
  return PROVIDER_API_PROTOCOL_OPTIONS.find((option) => option.value === protocol)?.label ?? protocol;
}

/** custom 平台未声明协议时的拦截提示(表单与 store 闸共用同一句,说清兜底后果)。 */
export const PROVIDER_API_PROTOCOL_BLOCK_MESSAGE =
  '自定义平台的接口协议无法从平台名推断,必须声明(OpenAI 兼容 / Anthropic 兼容 / Gemini 兼容);不声明将按 OpenAI 兼容兜底,可能打错协议口导致模型调用空返回';

/**
 * 配置期校验:custom 平台且未声明 apiProtocol 时返回拦截提示,否则 null。
 * 供应商表单保存前与 store addProvider 入库前共用。
 */
export function getProviderApiProtocolBlockReason(
  provider: Pick<IProvider, 'platform' | 'apiProtocol'>,
): string | null {
  if (!isProviderApiProtocolInferable(provider.platform) && !provider.apiProtocol) {
    return PROVIDER_API_PROTOCOL_BLOCK_MESSAGE;
  }
  return null;
}

/**
 * API Provider interface
 * All providers must implement this interface
 */
export interface APIProvider {
  id: ProviderId;
  name: string;
  services: ServiceType[];
  baseUrl: string;

  /**
   * Check if the provider is configured (has valid API key)
   */
  isConfigured(): boolean;

  /**
   * Test connection to the provider
   */
  testConnection(): Promise<{ success: boolean; error?: string }>;
}

/**
 * Chat provider interface
 */
export interface ChatProvider extends APIProvider {
  /**
   * Send a chat completion request
   */
  chat(params: ChatParams): Promise<ChatResult>;
}

/**
 * Image generation provider interface
 */
export interface ImageProvider extends APIProvider {
  /**
   * Submit image generation task
   */
  generateImage(params: ImageParams): Promise<TaskSubmitResult>;

  /**
   * Poll image task status
   */
  pollImageTask(taskId: string): Promise<AsyncTaskResult>;
}

/**
 * Video generation provider interface
 */
export interface VideoProvider extends APIProvider {
  /**
   * Submit video generation task
   */
  generateVideo(params: VideoParams): Promise<TaskSubmitResult>;

  /**
   * Poll video task status
   */
  pollVideoTask(taskId: string): Promise<AsyncTaskResult>;
}

// ==================== Request/Response Types ====================

export interface ChatParams {
  messages: Array<{
    role: 'system' | 'user' | 'assistant';
    content: string;
  }>;
  temperature?: number;
  maxTokens?: number;
  model?: string;
}

export interface ChatResult {
  content: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export interface ImageParams {
  prompt: string;
  negativePrompt?: string;
  width: number;
  height: number;
  model?: string;
  steps?: number;
  guidanceScale?: number;
}

export interface VideoParams {
  imageUrl?: string;
  imageBase64?: string;
  prompt?: string;
  duration: number;
  aspectRatio?: '16:9' | '9:16';
}

export interface TaskSubmitResult {
  taskId: string;
  estimatedTime?: number;
}

// ==================== Provider Registry ====================

/**
 * Registry of all available providers
 */
export interface ProviderRegistry {
  chat: Map<ProviderId, ChatProvider>;
  image: Map<ProviderId, ImageProvider>;
  video: Map<ProviderId, VideoProvider>;
}

/**
 * Get API key function type
 * Used for dynamic key retrieval from config store
 */
export type GetApiKeyFn = (providerId: ProviderId) => string;
