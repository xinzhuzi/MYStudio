import { parseApiKeys, type IProvider } from "@/lib/api-key-manager";
import { isLocalTtsProvider } from "./api-config-provider-helpers";
import type { APIConfigStore } from "./api-config-store";

export type APIConfigFeatureBindingActions = Pick<
  APIConfigStore,
  | "setFeatureBindings"
  | "toggleFeatureBinding"
  | "getFeatureBindings"
  | "getProvidersForFeature"
  | "isFeatureConfigured"
  | "setFeatureBinding"
  | "getFeatureBinding"
  | "getProviderForFeature"
>;

type SetAPIConfigState = (
  partial: Partial<APIConfigStore> | ((state: APIConfigStore) => Partial<APIConfigStore>),
) => void;
type GetAPIConfigState = () => APIConfigStore;

export function createAPIConfigFeatureBindingActions(
  set: SetAPIConfigState,
  get: GetAPIConfigState,
): APIConfigFeatureBindingActions {
  return {
    setFeatureBindings: (feature, bindings) => {
      set((state) => ({
        featureBindings: { ...state.featureBindings, [feature]: bindings },
      }));
      console.log(`[APIConfig] Set ${feature} -> [${bindings?.join(', ') || '无'}]`);
    },
    
    // 切换单个绑定（添加/移除）
    toggleFeatureBinding: (feature, binding) => {
      const current = get().featureBindings[feature] || [];
      const exists = current.includes(binding);
      
      // 同时检查 legacy 格式（platform:model）是否存在
      // 例如 binding = "{id}:deepseek-v3" 但 current 里可能有 "memefast:deepseek-v3"
      let legacyMatch: string | null = null;
      const idx = binding.indexOf(':');
      if (idx > 0) {
        const providerId = binding.slice(0, idx);
        const model = binding.slice(idx + 1);
        const provider = get().providers.find(p => p.id === providerId);
        if (provider) {
          const legacyKey = `${provider.platform}:${model}`;
          if (legacyKey !== binding && current.includes(legacyKey)) {
            legacyMatch = legacyKey;
          }
        }
      }
      
      if (exists || legacyMatch) {
        // 删除：同时移除精确匹配和 legacy 格式
        const newBindings = current.filter(b => b !== binding && b !== legacyMatch);
        set((state) => ({
          featureBindings: { ...state.featureBindings, [feature]: newBindings.length > 0 ? newBindings : null },
        }));
        console.log(`[APIConfig] Toggle ${feature}: ${binding} -> removed${legacyMatch ? ` (also removed legacy: ${legacyMatch})` : ''}`);
      } else {
        // 添加
        const newBindings = [...current, binding];
        set((state) => ({
          featureBindings: { ...state.featureBindings, [feature]: newBindings.length > 0 ? newBindings : null },
        }));
        console.log(`[APIConfig] Toggle ${feature}: ${binding} -> added`);
      }
    },
    
    // 获取功能的所有绑定
    getFeatureBindings: (feature) => {
      const bindings = get().featureBindings;
      const value = bindings?.[feature];
      // 兼容旧数据：如果是字符串，转为数组
      if (typeof value === 'string') return [value];
      return value || [];
    },
    
    // 获取功能对应的所有 provider + model
    getProvidersForFeature: (feature) => {
      const bindings = get().getFeatureBindings(feature);
      const results: Array<{ provider: IProvider; model: string }> = [];
      
      for (const binding of bindings) {
        const idx = binding.indexOf(':');
        if (idx <= 0) continue;
        const platformOrId = binding.slice(0, idx);
        const model = binding.slice(idx + 1);
        // 1. 优先按 provider.id 精确匹配（始终安全）
        let provider = get().providers.find(p => p.id === platformOrId);
        // 2. Fallback: 按 platform 匹配，但仅当该 platform 下只有一个供应商时
        //    （防止多个 custom 供应商时误选第一个）
        if (!provider) {
          const platformMatches = get().providers.filter(p => p.platform === platformOrId);
          if (platformMatches.length === 1) {
            provider = platformMatches[0];
          } else if (platformMatches.length > 1) {
            console.warn(`[APIConfig] Ambiguous platform binding "${binding}" matches ${platformMatches.length} providers, skipping`);
          }
        }
        if (!provider) {
          continue;
        }
        if (parseApiKeys(provider.apiKey).length === 0 && !isLocalTtsProvider(provider)) {
          continue;
        }
    
        // Skip stale hidden bindings that no longer exist in the provider's synced model list.
        // This prevents runtime from executing models that the service-mapping UI can no longer display.
        if (provider.model.length > 0 && !provider.model.includes(model)) {
          console.warn(
            `[APIConfig] Skipping stale binding "${binding}" for ${feature}: model "${model}" is not in provider "${provider.name}" model list`
          );
          continue;
        }
    
        results.push({ provider, model });
      }
      return results;
    },
    
    isFeatureConfigured: (feature) => {
      return get().getProvidersForFeature(feature).length > 0;
    },
    
    // Legacy single-select compat (deprecated, for backward compat)
    setFeatureBinding: (feature, providerId) => {
      // 单选兼容：设置为单元素数组
      get().setFeatureBindings(feature, providerId ? [providerId] : null);
    },
    
    getFeatureBinding: (feature) => {
      const bindings = get().getFeatureBindings(feature);
      return bindings[0] || null;
    },
    
    getProviderForFeature: (feature) => {
      const providers = get().getProvidersForFeature(feature);
      return providers[0]?.provider;
    },
  };
}

