// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
/**
 * API Config Store v2
 * Manages API providers and keys with localStorage persistence
 * Supports multi-key rotation and IProvider interface (AionUi pattern)
 */

import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import type { ProviderId, ServiceType } from '@/lib/ai/core';
import { 
// eslint-disable-next-line @typescript-eslint/no-unused-vars
  type IProvider, 
// eslint-disable-next-line @typescript-eslint/no-unused-vars
  DEFAULT_PROVIDERS, 
  generateId, 
  parseApiKeys,
  maskApiKey as maskKey,
// eslint-disable-next-line @typescript-eslint/no-unused-vars
  classifyModelByName,
} from '@/lib/ai/core';
import { injectDiscoveryCache, type DiscoveredModelLimits } from '@/lib/ai/model-registry';
import {
// eslint-disable-next-line @typescript-eslint/no-unused-vars
  AI_FEATURES,
// eslint-disable-next-line @typescript-eslint/no-unused-vars
  type AIFeature,
  type FeatureBindings,
} from '@/lib/ai/feature-definitions';
import {
  createDefaultImageHostProviders,
// eslint-disable-next-line @typescript-eslint/no-unused-vars
  findImageHostPreset,
// eslint-disable-next-line @typescript-eslint/no-unused-vars
  isUnconfiguredDefaultCatboxProvider,
// eslint-disable-next-line @typescript-eslint/no-unused-vars
  isUnconfiguredDefaultImgBBProvider,
  isVisibleImageHostProvider,
  normalizeImageHostProvider,
  normalizeImageHostProviders,
// eslint-disable-next-line @typescript-eslint/no-unused-vars
  type ImageHostPlatform,
  type ImageHostProvider,
} from './api-config-image-host';
import {
  API_CONFIG_PERSIST_VERSION,
  API_CONFIG_STORAGE_KEY,
  getAPIConfigStorage,
  partializeAPIConfigState,
} from './api-config-persistence';
import {
  DEFAULT_LOCAL_TTS_MODEL,
  DEFAULT_LOCAL_TTS_PROVIDER_ID,
  PROVIDER_INFO,
  createDefaultLocalTtsProvider,
// eslint-disable-next-line @typescript-eslint/no-unused-vars
  ensureDefaultLocalTtsProvider,
// eslint-disable-next-line @typescript-eslint/no-unused-vars
  isLocalTtsProvider,
} from './api-config-provider-helpers';
import { createAPIConfigImageHostActions } from './api-config-image-host-actions';
import { createAPIConfigProviderActions } from './api-config-provider-actions';
import { createAPIConfigFeatureBindingActions } from './api-config-feature-binding-actions';
import { createAPIConfigAgentActions } from './api-config-agent-actions';
import { migrateAPIConfigState } from './api-config-migration';
import {
  DEFAULT_ADVANCED_OPTIONS,
  type APIConfigState,
  type APIConfigStore,
} from './api-config-store-types';
import {
  createDefaultAgentDeployments,
  normalizeAgentDeployments,
} from './api-config-agent-deployments';

export { AI_FEATURES } from '@/lib/ai/feature-definitions';
export type { AIFeature, FeatureBindings } from '@/lib/ai/feature-definitions';
export {
  DEFAULT_IMAGE_HOST_PROVIDERS,
  IMAGE_HOST_PRESETS,
  findImageHostPreset,
  isVisibleImageHostPlatform,
  isVisibleImageHostProvider,
} from './api-config-image-host';
export type { ImageHostPlatform, ImageHostProvider } from './api-config-image-host';
export {
  DEFAULT_LOCAL_TTS_MODEL,
  DEFAULT_LOCAL_TTS_PROVIDER_ID,
  createDefaultLocalTtsProvider,
} from './api-config-provider-helpers';

// Re-export IProvider for convenience
export type { IProvider } from '@/lib/ai/core';
export { DEFAULT_ADVANCED_OPTIONS } from './api-config-store-types';
export type {
  AdvancedGenerationOptions,
  APIConfigActions,
  APIConfigState,
  APIConfigStatus,
  APIConfigStore,
  LegacyImageHostConfig,
} from './api-config-store-types';
export {
  API_AGENT_DEPLOYMENT_DEFAULTS,
  API_AGENT_DEPLOYMENT_GROUPS,
  createDefaultAgentDeployments,
  getAgentDeploymentModelType,
  validateProviderAdapterCodeText,
} from './api-config-agent-deployments';
export type {
  AgentDeploymentConfig,
  AgentDeploymentGroup,
  AgentDeploymentKey,
  AgentUseMode,
  ProviderAdapterCode,
  ProviderAdapterModelDefinition,
  ProviderAdapterModelType,
  ProviderAdapterValidationResult,
  ResolvedAgentModel,
} from './api-config-agent-deployments';

// ==================== Types ====================

/**
 * 高级生成选项
 * 控制视频生成的高级行为
 */
// ==================== Initial State ====================

export function createDefaultFeatureBindings(): FeatureBindings {
  return {
    script_analysis: null,
    character_generation: null,
    scene_generation: null,
    prop_generation: null,
    video_generation: null,
    image_understanding: null,
    chat: null,
    freedom_image: null,
    freedom_video: null,
    tts: [`${DEFAULT_LOCAL_TTS_PROVIDER_ID}:${DEFAULT_LOCAL_TTS_MODEL}`],
  };
}

const defaultFeatureBindings = createDefaultFeatureBindings();
const defaultImageHostProviders: ImageHostProvider[] = createDefaultImageHostProviders();

const initialState: APIConfigState = {
  providers: [createDefaultLocalTtsProvider()],
  agentUseMode: 'simple',
  agentDeployments: createDefaultAgentDeployments(),
  providerAdapterCodes: [],
  studioBindingsMigrated: false,
  featureBindings: defaultFeatureBindings,
  apiKeys: {},
  concurrency: 1,  // Default to serial execution (single key rate limit)
  aspectRatio: '16:9',
  orientation: 'landscape',
  advancedOptions: { ...DEFAULT_ADVANCED_OPTIONS },
  imageHostProviders: defaultImageHostProviders,
  modelEndpointTypes: {},
  modelTypes: {},
  modelTags: {},
  modelEnableGroups: {},
  discoveredModelLimits: {},
  modelThinkingOverrides: {},
};

// ==================== Store ====================

export const useAPIConfigStore = create<APIConfigStore>()(
  persist(
    (set, get) => ({
      ...initialState,

      // ==================== Workflow Agent Deployment Config ====================
      ...createAPIConfigAgentActions(set, get),

      // ==================== Provider Management (v2) ====================

      ...createAPIConfigProviderActions(set, get, {
        generateId,
        normalizeAgentDeployments,
      }),
      // ==================== Feature Binding Management (Multi-Select) ====================

      ...createAPIConfigFeatureBindingActions(set, get),
      // ==================== Legacy API Key management (v1 compat) ====================
      
      setApiKey: (provider, key) => {
        // Update legacy apiKeys
        set((state) => ({
          apiKeys: { ...state.apiKeys, [provider]: key },
        }));
        
        // Also update provider if exists
        const existingProvider = get().getProviderByPlatform(provider);
        if (existingProvider) {
          get().updateProvider({ ...existingProvider, apiKey: key });
        }
        
      },

      getApiKey: (provider) => {
        // First check providers (v2)
        const prov = get().getProviderByPlatform(provider);
        if (prov?.apiKey) {
          // Return first key for compatibility
          const keys = parseApiKeys(prov.apiKey);
          return keys[0] || '';
        }
        // Fallback to legacy apiKeys
        return get().apiKeys[provider] || '';
      },

      clearApiKey: (provider) => {
        // Clear from legacy
        set((state) => {
          const newKeys = { ...state.apiKeys };
          delete newKeys[provider];
          return { apiKeys: newKeys };
        });
        
        // Also clear from provider if exists
        const existingProvider = get().getProviderByPlatform(provider);
        if (existingProvider) {
          get().updateProvider({ ...existingProvider, apiKey: '' });
        }
        
      },

      clearAllApiKeys: () => {
        // Clear legacy
        set({ apiKeys: {} });
        
        // Clear all provider keys
        const { providers, updateProvider } = get();
        providers.forEach(p => {
          updateProvider({ ...p, apiKey: '' });
        });
        
      },

      // ==================== Concurrency ====================
      
      setConcurrency: (n) => {
        const value = Math.max(1, n); // 最小为1，无上限
        set({ concurrency: value });
      },

      // ==================== Aspect ratio ====================
      
      setAspectRatio: (ratio) => {
        set({
          aspectRatio: ratio,
          orientation: ratio === '16:9' ? 'landscape' : 'portrait',
        });
      },

      toggleOrientation: () => {
        const { aspectRatio } = get();
        const newRatio = aspectRatio === '16:9' ? '9:16' : '16:9';
        get().setAspectRatio(newRatio);
      },

      // ==================== Advanced Generation Options ====================
      
      setAdvancedOption: (key, value) => {
        set((state) => ({
          advancedOptions: { ...state.advancedOptions, [key]: value },
        }));
      },

      resetAdvancedOptions: () => {
        set({ advancedOptions: { ...DEFAULT_ADVANCED_OPTIONS } });
      },

      // ==================== Image Host Providers (independent) ====================

      ...createAPIConfigImageHostActions(set, get),

      getImageHostProviderById: (id) => {
        const provider = get().imageHostProviders.find(p => p.id === id);
        return provider && isVisibleImageHostProvider(provider)
          ? normalizeImageHostProvider(provider)
          : undefined;
      },

      getEnabledImageHostProviders: () => {
        return normalizeImageHostProviders(get().imageHostProviders).filter(p => p.enabled);
      },

      isImageHostConfigured: () => {
        const providers = normalizeImageHostProviders(get().imageHostProviders);
        return providers.some(p => {
          const hasKey = parseApiKeys(p.apiKey).length > 0;
          const hasUrl = !!(p.baseUrl || p.uploadPath);
          return p.enabled && hasUrl && (p.apiKeyOptional || hasKey);
        });
      },

      // ==================== Validation ====================
      
      isConfigured: (provider) => {
        // Check v2 providers first
        const prov = get().getProviderByPlatform(provider);
        if (prov) {
          return parseApiKeys(prov.apiKey).length > 0;
        }
        // Fallback to legacy
        const key = get().apiKeys[provider];
        return !!key && key.length > 0;
      },

      isPlatformConfigured: (platform) => {
        const provider = get().getProviderByPlatform(platform);
        return !!provider && parseApiKeys(provider.apiKey).length > 0;
      },

      checkRequiredKeys: (services) => {
        const missing: string[] = [];
        const { isConfigured } = get();

        for (const service of services) {
          // Find provider for this service
          for (const [providerId, info] of Object.entries(PROVIDER_INFO)) {
            if (info.services.includes(service) && !isConfigured(providerId as ProviderId)) {
              if (!missing.includes(info.name)) {
                missing.push(info.name);
              }
            }
          }
        }

        return {
          isAllConfigured: missing.length === 0,
          missingKeys: missing,
          friendlyMessage: missing.length === 0
            ? '所有 API Key 已配置'
            : `缺少以下 API Key：${missing.join('、')}`,
        };
      },

      checkChatKeys: () => {
        return get().checkRequiredKeys(['chat']);
      },

      checkVideoGenerationKeys: () => {
        return get().checkRequiredKeys(['chat', 'image', 'video']);
      },

      // ==================== Display helpers ====================
      
      maskApiKey: (key) => {
        return maskKey(key);
      },

      getAllConfigs: () => {
        const { apiKeys, maskApiKey, isConfigured } = get();
        return (Object.keys(PROVIDER_INFO) as ProviderId[]).map((provider) => {
          const resolvedProvider = get().getProviderByPlatform(provider);
          const key = resolvedProvider ? resolvedProvider.apiKey : apiKeys[provider];
          return {
            provider,
            configured: isConfigured(provider),
            masked: maskApiKey(key || ''),
          };
        });
      },

      // ==================== Model limits discovery ====================

      getDiscoveredModelLimits: (model) => {
        return get().discoveredModelLimits[model];
      },

      setDiscoveredModelLimits: (model, limits) => {
        set((state) => ({
          discoveredModelLimits: {
            ...state.discoveredModelLimits,
            [model]: {
              ...state.discoveredModelLimits[model],
              ...limits,
              discoveredAt: Date.now(),
            } as DiscoveredModelLimits,
          },
        }));
      },

      getModelThinkingOverride: (model) => {
        return get().modelThinkingOverrides[model];
      },

      setModelThinkingOverride: (model, enabled) => {
        set((state) => {
          const next = { ...state.modelThinkingOverrides };
          if (typeof enabled === 'boolean') {
            next[model] = enabled;
          } else {
            delete next[model];
          }
          return { modelThinkingOverrides: next };
        });
      },
    }),
    {
      name: API_CONFIG_STORAGE_KEY,
      storage: createJSONStorage(getAPIConfigStorage),
      version: API_CONFIG_PERSIST_VERSION,
      migrate: migrateAPIConfigState,
      partialize: partializeAPIConfigState,
    }
  )
);

// ==================== Selectors ====================

/**
 * Check if all required APIs for video generation are configured
 */
export const useIsVideoGenerationReady = (): boolean => {
  return useAPIConfigStore((state) => {
    const status = state.checkVideoGenerationKeys();
    return status.isAllConfigured;
  });
};

/**
 * Get the current concurrency setting
 */
export const useConcurrency = (): number => {
  return useAPIConfigStore((state) => state.concurrency);
};

// ==================== Model Registry Cache Injection ====================

// Inject discovery cache into model-registry (avoids circular dependency)
// This runs once when the module is loaded
injectDiscoveryCache(
  (model: string) => useAPIConfigStore.getState().getDiscoveredModelLimits(model),
  (model: string, limits: Partial<DiscoveredModelLimits>) => useAPIConfigStore.getState().setDiscoveredModelLimits(model, limits),
);
