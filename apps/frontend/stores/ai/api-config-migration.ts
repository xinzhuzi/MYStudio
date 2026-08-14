import type { ProviderId } from "@/lib/ai/core";
import {
  DEFAULT_PROVIDERS,
  generateId,
  parseApiKeys,
  type IProvider,
} from "@/lib/ai/core";
import {
  type AIFeature,
  type FeatureBindings,
} from "@/lib/ai/feature-definitions";
import {
  createDefaultImageHostProviders,
  findImageHostPreset,
  isUnconfiguredDefaultCatboxProvider,
  isUnconfiguredDefaultImgBBProvider,
  normalizeImageHostProviders,
  type ImageHostProvider,
} from "./api-config-image-host";
import {
  DEFAULT_LOCAL_TTS_MODEL,
  DEFAULT_LOCAL_TTS_PROVIDER_ID,
  ensureDefaultLocalTtsProvider,
  ensureDefaultLocalImageProvider,
  LOCAL_IMAGE_MODELS,
} from "./api-config-provider-helpers";
import { normalizeAgentDeployments } from "./api-config-agent-deployments";
import type { APIConfigState, LegacyImageHostConfig } from "./api-config-store-types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeProviderList(value: unknown): IProvider[] {
  return Array.isArray(value)
    ? value.filter(isRecord) as unknown as IProvider[]
    : [];
}

export function migrateAPIConfigState(
  persistedState: unknown,
  version: number,
): Partial<APIConfigState> {
        // Use mutable result object for chained migration
         
        const result = {
          ...(isRecord(persistedState) ? persistedState : {}),
        } as Partial<APIConfigState> & { imageHostConfig?: LegacyImageHostConfig };
        
        // Default feature bindings for migration
        const defaultBindings: FeatureBindings = {
          script_analysis: null,
          character_generation: null,
          scene_generation: null,
          prop_generation: null,
          video_generation: null,
          image_understanding: null,
          chat: null,
          freedom_image: null,
          freedom_video: null,
          tts: null,
        };
        const resolveImageHostProviders = (): ImageHostProvider[] => {
          const legacyConfig = result?.imageHostConfig;
          let imageHostProviders: ImageHostProvider[] = normalizeImageHostProviders(
            Array.isArray(result?.imageHostProviders) ? result.imageHostProviders : [],
          );

          if (
            imageHostProviders.length > 0
            && !imageHostProviders.some((provider) => provider.platform === 'catbox')
            && imageHostProviders.every(isUnconfiguredDefaultImgBBProvider)
          ) {
            imageHostProviders = createDefaultImageHostProviders();
          }

          if (
            imageHostProviders.length > 0
            && !imageHostProviders.some((provider) => provider.platform === 'scdn')
            && imageHostProviders.every((provider) => (
              isUnconfiguredDefaultImgBBProvider(provider) || isUnconfiguredDefaultCatboxProvider(provider)
            ))
          ) {
            imageHostProviders = createDefaultImageHostProviders();
          }

          if (!imageHostProviders || imageHostProviders.length === 0) {
            if (legacyConfig) {
              const imgbbPreset = findImageHostPreset('imgbb');
              if (legacyConfig.type === 'imgbb' && imgbbPreset) {
                imageHostProviders = [
                  {
                    ...imgbbPreset,
                    id: generateId(),
                    apiKey: legacyConfig.imgbbApiKey || '',
                    enabled: true,
                  },
                ];
              } else if (legacyConfig.type === 'custom' && legacyConfig.custom) {
                imageHostProviders = [
                  {
                    id: generateId(),
                    platform: 'custom',
                    name: '自定义图床',
                    baseUrl: legacyConfig.custom.uploadUrl || '',
                    uploadPath: '',
                    apiKey: legacyConfig.custom.apiKey || '',
                    enabled: true,
                  },
                ];
              } else if (legacyConfig.type === 'cloudflare_r2') {
                imageHostProviders = [
                  {
                    id: generateId(),
                    platform: 'cloudflare_r2',
                    name: 'Cloudflare R2',
                    baseUrl: '',
                    uploadPath: '',
                    apiKey: '',
                    enabled: false,
                  },
                ];
              }
            }

            if (!imageHostProviders || imageHostProviders.length === 0) {
              imageHostProviders = createDefaultImageHostProviders();
            }
          }

          return normalizeImageHostProviders(imageHostProviders);
        };

        // ========== Chained migration: each step mutates `result` and falls through ==========
        
        // v0/v1 → v2: Migrate apiKeys to providers
        if (version <= 1) {
          const oldApiKeys = isRecord(result?.apiKeys) ? result.apiKeys : {};
          const providers: IProvider[] = [];
          
          for (const template of DEFAULT_PROVIDERS) {
            const rawKey = oldApiKeys[template.platform as ProviderId];
            const existingKey = typeof rawKey === 'string'
              ? rawKey
              : '';
            providers.push({
              id: generateId(),
              ...template,
              apiKey: existingKey,
            });
          }
          
          result.providers = providers;
          result.featureBindings = defaultBindings;
          result.apiKeys = oldApiKeys;
          version = 2; // continue to next step
        }

        // v2 → v3: Ensure providers and featureBindings exist
        if (version <= 2) {
          result.providers = normalizeProviderList(result.providers);
          result.featureBindings = {
            ...defaultBindings,
            ...(isRecord(result.featureBindings) ? result.featureBindings : {}),
          } as FeatureBindings;
          version = 3;
        }

        // v3 → v4: Ensure RunningHub model uses AppId
        if (version <= 3) {
          result.providers = normalizeProviderList(result.providers).map((p: IProvider) => {
            if (p.platform === 'runninghub') {
              const hasOldModel = p.model?.includes('qwen-image-edit-angles');
              const hasAppId = p.model?.includes('2009613632530812930');
              if (!p.model || p.model.length === 0 || hasOldModel || !hasAppId) {
                return { ...p, model: ['2009613632530812930'] };
              }
            }
            return p;
          });
          result.featureBindings = {
            ...defaultBindings,
            ...(isRecord(result.featureBindings) ? result.featureBindings : {}),
          } as FeatureBindings;
          version = 4;
        }

        // v4/v5 → v6: Convert featureBindings from string to string[] (multi-select)
        if (version <= 5) {
          const oldBindings = isRecord(result.featureBindings) ? result.featureBindings : {};
          const newBindings: FeatureBindings = { ...defaultBindings };
          
          for (const [key, value] of Object.entries(oldBindings)) {
            const feature = key as AIFeature;
            if (typeof value === 'string' && value) {
              newBindings[feature] = [value];
            } else if (Array.isArray(value)) {
              newBindings[feature] = value.filter((binding): binding is string => typeof binding === 'string');
            } else {
              newBindings[feature] = null;
            }
          }
          
          result.featureBindings = newBindings;
          version = 6;
        }

        // v6 → v7: Remove deprecated providers (dik3, nanohajimi, apimart, zhipu)
        if (version <= 6) {
          const DEPRECATED_PLATFORMS = ['dik3', 'nanohajimi', 'apimart', 'zhipu'];
          const oldProviders = normalizeProviderList(result.providers);
          const cleanedProviders = oldProviders.filter(
            (p: IProvider) => !DEPRECATED_PLATFORMS.includes(p.platform)
          );
          const removedCount = oldProviders.length - cleanedProviders.length;
          if (removedCount > 0) {
          }
          
          const oldBindings = isRecord(result.featureBindings) ? result.featureBindings : {};
          const cleanedBindings: FeatureBindings = { ...defaultBindings };
          for (const [key, value] of Object.entries(oldBindings)) {
            const feature = key as AIFeature;
            if (Array.isArray(value)) {
              const filtered = value.filter(
                (b): b is string => typeof b === 'string'
                  && !DEPRECATED_PLATFORMS.some((dp) => b.startsWith(dp + ':'))
              );
              cleanedBindings[feature] = filtered.length > 0 ? filtered : null;
            } else {
              cleanedBindings[feature] = null;
            }
          }
          
          result.providers = cleanedProviders;
          result.featureBindings = cleanedBindings;
          version = 7;
        }

        // v7 → v8: (no-op, pass through)
        if (version <= 7) {
          version = 8;
        }

        // v8 → v9: Convert platform:model bindings to id:model format
        if (version <= 8) {
          const providers = normalizeProviderList(result.providers);
          const oldBindings = isRecord(result.featureBindings) ? result.featureBindings : {};
          const newBindings: FeatureBindings = { ...defaultBindings };
          let convertedCount = 0;
          let removedCount = 0;
          
          for (const [key, value] of Object.entries(oldBindings)) {
            const feature = key as AIFeature;
            if (!Array.isArray(value)) {
              newBindings[feature] = typeof value === 'string' && value ? [value] : null;
              continue;
            }
            const converted: string[] = [];
            for (const binding of value) {
              if (typeof binding !== 'string') continue;
              const idx = binding.indexOf(':');
              if (idx <= 0) { converted.push(binding); continue; }
              const platformOrId = binding.slice(0, idx);
              const model = binding.slice(idx + 1);
              
              if (providers.some(p => p.id === platformOrId)) {
                converted.push(binding);
                continue;
              }
              
              const matches = providers.filter(p => p.platform === platformOrId);
              if (matches.length === 1) {
                const newBinding = `${matches[0].id}:${model}`;
                converted.push(newBinding);
                convertedCount++;
              } else if (matches.length > 1) {
                removedCount++;
                console.warn(`[APIConfig] v8→v9: Removed ambiguous binding "${binding}" (${matches.length} providers with platform "${platformOrId}")`);
              } else {
                converted.push(binding);
              }
            }
            newBindings[feature] = converted.length > 0 ? converted : null;
          }
          
          if (convertedCount > 0 || removedCount > 0) {
          }
          
          result.featureBindings = newBindings;
          version = 9;
        }

        // v9 → v10: normalize image-host provider fields (pass through to resolveImageHostProviders at end)
        if (version <= 9) {
          version = 10;
        }

        // v10 → v11: switch defaults to Catbox/ImgBB (pass through to resolveImageHostProviders at end)
        if (version <= 10) {
          version = 11;
        }

        // v11 → v12: switch defaults to SCDN (pass through to resolveImageHostProviders at end)
        if (version <= 11) {
          version = 12;
        }

        // v12 → v13: Clear stale API metadata caches to force fresh sync on startup
        // This fixes the issue where cached modelEndpointTypes / modelEnableGroups / modelTypes / modelTags
        // from an old version cause incorrect API routing after an in-place upgrade (覆盖安装)
        if (version <= 12) {
          result.modelEndpointTypes = {};
          result.modelTypes = {};
          result.modelTags = {};
          result.modelEnableGroups = {};
          result.discoveredModelLimits = {};
          
          // Backfill missing provider defaults without overwriting user-edited values.
          if (Array.isArray(result.providers)) {
            result.providers = normalizeProviderList(result.providers).map((p: IProvider) => {
              const template = DEFAULT_PROVIDERS.find(t => t.platform === p.platform);
              if (template) {
                const updated = {
                  ...p,
                  baseUrl: p.baseUrl?.trim() ? p.baseUrl : template.baseUrl,
                  name: p.name?.trim() ? p.name : template.name,
                };
                if (updated.baseUrl !== p.baseUrl || updated.name !== p.name) {
                }
                return updated;
              }
              return p;
            });
          }
          
          version = 13;
        }

        // v13 → v14: ensure Toonflow-style agent deployments and provider adapter code store exist
        if (version <= 13) {
          result.agentUseMode = result.agentUseMode || 'simple';
          result.agentDeployments = normalizeAgentDeployments(result.agentDeployments);
          result.providerAdapterCodes = result.providerAdapterCodes || [];
          result.studioBindingsMigrated = Boolean(result.studioBindingsMigrated);
          version = 14;
        }

        // v14 → v15: remove the old empty MemeFast marketing placeholder.
        if (version <= 14) {
          if (Array.isArray(result.providers)) {
            result.providers = normalizeProviderList(result.providers).filter((provider: IProvider) => {
              if (provider.platform !== 'memefast') return true;
              return parseApiKeys(provider.apiKey).length > 0;
            });
          }
          version = 15;
        }

        // v15 → v16: built-in local TTS provider and Qwen3-TTS 1.7B defaults are applied in final normalization.
        if (version <= 15) {
          version = 16;
        }

        // v16 → v17: 新增 per-model 思考模式覆盖表（默认空，未配置则按名字自动判断）
        if (version <= 16) {
          if (!result.modelThinkingOverrides || typeof result.modelThinkingOverrides !== 'object') {
            result.modelThinkingOverrides = {};
          }
          version = 17;
        }

        // ========== Final normalization (always runs) ==========

        // Ensure all feature binding keys exist and normalize string → string[]
        const finalBindings: FeatureBindings = { ...defaultBindings };
        if (isRecord(result.featureBindings)) {
          for (const [key, value] of Object.entries(result.featureBindings)) {
            const feature = key as AIFeature;
            if (typeof value === 'string' && value) {
              finalBindings[feature] = [value];
            } else if (Array.isArray(value)) {
              finalBindings[feature] = value.filter((binding): binding is string => typeof binding === 'string');
            } else {
              finalBindings[feature] = null;
            }
          }
        }
        if (!finalBindings.tts || finalBindings.tts.length === 0) {
          finalBindings.tts = [`${DEFAULT_LOCAL_TTS_PROVIDER_ID}:${DEFAULT_LOCAL_TTS_MODEL}`];
        }
        result.featureBindings = finalBindings;

        result.agentUseMode = result.agentUseMode || 'simple';
        result.agentDeployments = normalizeAgentDeployments(result.agentDeployments);
        result.providerAdapterCodes = result.providerAdapterCodes || [];
        result.studioBindingsMigrated = Boolean(result.studioBindingsMigrated);
        result.providers = ensureDefaultLocalTtsProvider(normalizeProviderList(result.providers));
        result.providers = ensureDefaultLocalImageProvider(result.providers);

        // Seed endpoint types for local image models so resolveImageApiFormat
        // routes them to /v1/images/generations explicitly (not name inference).
        result.modelEndpointTypes = result.modelEndpointTypes || {};
        for (const modelName of LOCAL_IMAGE_MODELS) {
          if (!Array.isArray(result.modelEndpointTypes[modelName])) {
            result.modelEndpointTypes[modelName] = ['image-generation'];
          }
        }

        if (!result.modelThinkingOverrides || typeof result.modelThinkingOverrides !== 'object') {
          result.modelThinkingOverrides = {};
        }

        // Resolve image host providers (handles all legacy formats)
        result.imageHostProviders = resolveImageHostProviders();

        return result;

}
