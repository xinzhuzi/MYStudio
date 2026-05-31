// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
/**
 * AI Feature Router
 * Routes AI requests to the bound provider based on feature bindings
 * 
 * v2: 支持多模型绑定 + 轮询调度
 * 
 * Usage:
 *   const config = getFeatureConfig('character_generation');
 *   if (!config) {
 *     toast.error('请先在设置中配置角色生成的 API 供应商');
 *     return;
 *   }
 *   // Use config.apiKey and config.provider in API call
 */

import { useAPIConfigStore, type AIFeature, type IProvider, AI_FEATURES } from '@/stores/api-config-store';
import { parseApiKeys, getProviderKeyManager, ApiKeyManager } from '@/lib/api-key-manager';
import { retryOperation } from '@/lib/utils/retry';

export interface FeatureConfig {
  feature: AIFeature;
  featureName: string;
  provider: IProvider;
  apiKey: string;
  allApiKeys: string[]; // All available API keys
  keyManager: ApiKeyManager; // For key rotation
  platform: string;
  baseUrl: string;
  models: string[];
  model: string; // 当前选中的模型
}

// 多模型轮询调度器：记录每个功能的当前索引
const featureRoundRobinIndex: Map<AIFeature, number> = new Map();

/**
 * Default mapping for features to platforms (fallback when not explicitly bound)
 */
const FEATURE_PLATFORM_MAP: Partial<Record<AIFeature, string>> = {
  script_analysis: 'memefast',
  character_generation: 'memefast',
  video_generation: 'memefast',
  image_understanding: 'memefast',
  chat: 'memefast',
  freedom_image: 'memefast',
  freedom_video: 'memefast',
};

/**
 * 默认模型映射：当供应商未显式绑定模型时，为特定功能提供默认模型
 * 仅在 fallback 路径中使用（用户显式绑定优先）
 */
const FEATURE_DEFAULT_MODEL: Partial<Record<AIFeature, Record<string, string>>> = {
  image_understanding: {
    memefast: 'gemini-3.1-pro-preview', // 魔音API 默认使用 Gemini 3.1 Pro
  },
};


/**
 * 解析 platform:model 格式
 */
function parseBindingValue(binding: string): { platform: string; model?: string } | null {
  if (binding.includes(':')) {
    const [platform, model] = binding.split(':');
    return { platform, model };
  }
  return null;
}

/**
 * Get the platform and model from featureBindings (first binding)
 * featureBindings now stores: string[] (array of platform:model)
 * 这个函数仅用于兼容旧代码，新代码应使用 getProvidersForFeature
 */
function getBoundPlatformAndModel(store: ReturnType<typeof useAPIConfigStore.getState>, feature: AIFeature): { platform: string; model?: string } | null {
  const bindings = store.getFeatureBindings(feature);
  if (!bindings || bindings.length === 0) return null;
  
  // 取第一个绑定
  const binding = bindings[0];
  if (!binding) return null;
  
  // 新格式: platform:model
  const parsed = parseBindingValue(binding);
  if (parsed) {
    return parsed;
  }
  
  // 兼容旧格式: provider ID
  const provider = store.providers.find(p => p.id === binding);
  if (provider) return { platform: provider.platform };
  
  // 兼容旧格式: platform name
  const providerByPlatform = store.providers.find(p => p.platform === binding);
  if (providerByPlatform) return { platform: providerByPlatform.platform };
  
  // It might be a platform name that's not yet added
  return { platform: binding };
}

/**
 * 获取功能的所有可用配置（多模型）
 */
export function getAllFeatureConfigs(feature: AIFeature): FeatureConfig[] {
  const store = useAPIConfigStore.getState();
  const providersWithModels = store.getProvidersForFeature(feature);
  const featureInfo = AI_FEATURES.find(f => f.key === feature);
  
  const configs: FeatureConfig[] = [];
  
  for (const { provider, model } of providersWithModels) {
    const keys = parseApiKeys(provider.apiKey);
    if (keys.length === 0) continue;
    
    const scopeKey = `${feature}:${model || 'default'}`;
    const keyManager = getProviderKeyManager(provider.id, provider.apiKey, scopeKey);
    
    configs.push({
      feature,
      featureName: featureInfo?.name || feature,
      provider,
      apiKey: keyManager.getCurrentKey() || keys[0],
      allApiKeys: keys,
      keyManager,
      platform: provider.platform,
      baseUrl: provider.baseUrl,
      models: [model],
      model,
    });
  }
  
  return configs;
}

/**
 * Get configuration for an AI feature (with round-robin for multi-model)
 * Returns null if feature is not configured (no provider bound or no API key)
 * 
 * v2: 支持多模型轮询
 */
export function getFeatureConfig(feature: AIFeature): FeatureConfig | null {
  const configs = getAllFeatureConfigs(feature);
  
  if (configs.length === 0) {
    // Fallback: 尝试使用默认平台映射
    const store = useAPIConfigStore.getState();
    const defaultPlatform = FEATURE_PLATFORM_MAP[feature];
    if (defaultPlatform) {
      const provider = store.providers.find(p => p.platform === defaultPlatform);
      if (provider) {
        const keys = parseApiKeys(provider.apiKey);
        if (keys.length > 0) {
          const fallbackModel = FEATURE_DEFAULT_MODEL[feature]?.[provider.platform] || provider.model?.[0] || '';
          const scopeKey = `${feature}:${fallbackModel || 'default'}`;
          const keyManager = getProviderKeyManager(provider.id, provider.apiKey, scopeKey);
          const featureInfo = AI_FEATURES.find(f => f.key === feature);
          // 优先使用功能默认模型，否则取供应商第一个模型
          const defaultModel = FEATURE_DEFAULT_MODEL[feature]?.[provider.platform];
          const model = defaultModel || provider.model?.[0] || '';
          return {
            feature,
            featureName: featureInfo?.name || feature,
            provider,
            apiKey: keyManager.getCurrentKey() || keys[0],
            allApiKeys: keys,
            keyManager,
            platform: provider.platform,
            baseUrl: provider.baseUrl,
            models: provider.model || [],
            model,
          };
        }
      }
    }
    console.warn(`[FeatureRouter] No provider bound for feature: ${feature}`);
    return null;
  }
  
  // 单模型直接返回
  if (configs.length === 1) {
    return configs[0];
  }
  
  // 多模型轮询
  const currentIndex = featureRoundRobinIndex.get(feature) || 0;
  const config = configs[currentIndex % configs.length];
  
  // 更新索引（下次调用使用下一个）
  featureRoundRobinIndex.set(feature, currentIndex + 1);
  
  console.log(`[FeatureRouter] 多模型轮询: ${feature} -> ${config.provider.name}:${config.model} (${currentIndex % configs.length + 1}/${configs.length})`);
  
  return config;
}

/**
 * 重置轮询索引（用于新任务开始时）
 */
export function resetFeatureRoundRobin(feature?: AIFeature): void {
  if (feature) {
    featureRoundRobinIndex.set(feature, 0);
  } else {
    featureRoundRobinIndex.clear();
  }
}

/**
 * Check if a feature is properly configured
 */
export function isFeatureReady(feature: AIFeature): boolean {
  return getFeatureConfig(feature) !== null;
}

/**
 * Get error message for unconfigured feature
 */
export function getFeatureNotConfiguredMessage(feature: AIFeature): string {
  const featureInfo = AI_FEATURES.find(f => f.key === feature);
  const featureName = featureInfo?.name || feature;
  return `请先在设置中为「${featureName}」功能绑定 API 供应商`;
}

// ==================== 统一 API 调用入口 ====================

import { callChatAPI } from '@/lib/script/script-parser';

export interface CallFeatureAPIOptions {
  /** 自定义温度，默认 0.7 */
  temperature?: number;
  /** 自定义最大输出 token 数（默认 4096，推理模型建议设置更高） */
  maxTokens?: number;
  /** 强制覆盖模型（一般不需要，自动从服务映射获取） */
  modelOverride?: string;
  /** 强制使用指定的配置（用于批量调度时指定具体模型） */
  configOverride?: FeatureConfig;
  /** 显式控制深度思考：true 强制关闭，false 强制开启。不传则按模型自动判断（推理模型自动开最高思考）。 */
  disableThinking?: boolean;
}

/**
 * 统一的 AI 调用入口 - 自动从服务映射获取配置
 * 
 * v2: 支持多模型轮询
 * 
 * 用法：
 *   const result = await callFeatureAPI('script_analysis', systemPrompt, userPrompt);
 * 
 * 不需要手动传 apiKey、baseUrl、model，全部从服务映射自动获取
 */
export async function callFeatureAPI(
  feature: AIFeature,
  systemPrompt: string,
  userPrompt: string,
  options?: CallFeatureAPIOptions
): Promise<string> {
  // 使用指定配置或轮询获取
  const config = options?.configOverride || getFeatureConfig(feature);
  
  if (!config) {
    throw new Error(getFeatureNotConfiguredMessage(feature));
  }
  
  // 从服务映射获取模型
  const model = options?.modelOverride || config.model || config.models?.[0];
  const baseUrl = config.baseUrl?.replace(/\/+$/, '');
  if (!baseUrl) {
    throw new Error('请先在设置中配置 Base URL');
  }
  if (!model) {
    throw new Error('请先在设置中配置模型');
  }
  
  console.log(`[callFeatureAPI] 功能: ${feature}`);
  console.log(`[callFeatureAPI] 供应商: ${config.provider.name} (${config.platform})`);
  console.log(`[callFeatureAPI] 模型: ${model}`);
  console.log(`[callFeatureAPI] BaseURL: ${baseUrl}`);
  
  // 调用底层 API
  // 深度思考：默认按模型自动判断（支持就开最高思考），仅在调用方显式传入时才强制开/关。
  const disableThinking = options?.disableThinking;
  // 用户在设置里为该模型显式配置的「思考模式」开关（优先于按名字自动判断）。
  const thinkingEnabled = useAPIConfigStore.getState().getModelThinkingOverride(model);
  return await callChatAPI(systemPrompt, userPrompt, {
    apiKey: config.allApiKeys.join(','),
    provider: 'openai',
    baseUrl,
    model,
    temperature: options?.temperature,
    maxTokens: options?.maxTokens,
    keyManager: config.keyManager,
    disableThinking,
    thinkingEnabled,
  });
}

/**
 * Hook-friendly version using Zustand subscription
 */
export function useFeatureConfig(feature: AIFeature): FeatureConfig | null {
  const getProviderForFeature = useAPIConfigStore(state => state.getProviderForFeature);
  const provider = getProviderForFeature(feature);
  
  if (!provider) return null;
  
  const keys = parseApiKeys(provider.apiKey);
  if (keys.length === 0) return null;
  
  const featureInfo = AI_FEATURES.find(f => f.key === feature);
  const model = provider.model?.[0] || '';
  const keyManager = getProviderKeyManager(provider.id, provider.apiKey, `${feature}:${model || 'default'}`);
  
  return {
    feature,
    featureName: featureInfo?.name || feature,
    provider,
    apiKey: keyManager.getCurrentKey() || keys[0],
    allApiKeys: keys,
    keyManager,
    platform: provider.platform,
    baseUrl: provider.baseUrl,
    models: provider.model || [],
    model,
  };
}

/**
 * Get all feature configurations for status display
 */
export function getAllFeatureStatuses(): Array<{
  feature: AIFeature;
  name: string;
  description: string;
  configured: boolean;
  providerName?: string;
}> {
  const store = useAPIConfigStore.getState();
  
  return AI_FEATURES.map(f => {
    const provider = store.getProviderForFeature(f.key);
    const configured = store.isFeatureConfigured(f.key);
    
    return {
      feature: f.key,
      name: f.name,
      description: f.description,
      configured,
      providerName: configured ? provider?.name : undefined,
    };
  });
}


/**
 * 功能绑定的多模态 chat 调用（文本+图片），含 key 轮换/重试。
 * 调用方自行构建 messages（content 可含 image_url）与解析返回；返回 message content 字符串。
 */
export async function callFeatureMultimodalAPI(
  feature: AIFeature,
  messages: Array<{ role: string; content: unknown }>,
  opts?: { temperature?: number; responseFormat?: 'json_object'; signal?: AbortSignal },
): Promise<string> {
  const config = getFeatureConfig(feature);
  if (!config) {
    throw new Error(getFeatureNotConfiguredMessage(feature));
  }
  const model = config.model || config.models?.[0];
  const baseUrl = config.baseUrl?.replace(/\/+$/, '');
  if (!baseUrl) throw new Error('请先在设置中配置 Base URL');
  if (!model) throw new Error('请先在设置中配置模型');
  const endpoint = /\/v\d+$/.test(baseUrl) ? `${baseUrl}/chat/completions` : `${baseUrl}/v1/chat/completions`;
  const body: Record<string, unknown> = { model, messages, stream: false };
  if (opts?.temperature != null) body.temperature = opts.temperature;
  if (opts?.responseFormat) body.response_format = { type: opts.responseFormat };

  const response = await retryOperation(async () => {
    const apiKey = config.keyManager.getCurrentKey() || config.apiKey;
    const resp = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
      signal: opts?.signal,
    });
    if (!resp.ok) {
      const errorText = await resp.text();
      config.keyManager.handleError(resp.status, errorText);
      const err = new Error(`多模态调用失败 (${resp.status}) ${errorText.slice(0, 200)}`) as Error & { status?: number };
      err.status = resp.status;
      throw err;
    }
    return resp;
  }, { maxRetries: 3, baseDelay: 3000, retryOn429: true });

  const data = await response.json();
  return (data?.choices?.[0]?.message?.content ?? data?.content ?? '') as string;
}
