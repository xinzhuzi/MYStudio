import type { StateStorage } from "zustand/middleware";
import { createSecureLocalStorage } from "@/lib/storage/secure-local-storage";
import type { APIConfigState } from "./api-config-store-types";

export const API_CONFIG_STORAGE_KEY = "opencut-api-config";
// 0924 C1 专项:v17→v18 无 state schema 变更(密文格式变化在存储层吸收,
// migrateAPIConfigState 既有链零改);升版使旧明文盘走 migrate 自动回写路径。
export const API_CONFIG_PERSIST_VERSION = 18;

const fallbackAPIConfigStorage: StateStorage = {
  getItem: () => null,
  setItem: () => undefined,
  removeItem: () => undefined,
};

// H1 硬约束(计划 §4.2):createJSONStorage 在工厂同步抛错时整体 return undefined
// → persist 静默旁路加密与持久化。本函数体只做守卫判断+工厂调用(工厂体仅构造
// 对象字面量),绝不同步抛错;一切环境探测延迟到适配器 getItem/setItem 内部。
export function getAPIConfigStorage(): StateStorage {
  if (typeof localStorage !== "undefined" && typeof localStorage.setItem === "function") {
    return createSecureLocalStorage(API_CONFIG_STORAGE_KEY);
  }
  return fallbackAPIConfigStorage;
}

export function partializeAPIConfigState<T extends APIConfigState>(state: T): APIConfigState {
  return {
    providers: state.providers,
    agentUseMode: state.agentUseMode,
    agentDeployments: state.agentDeployments,
    providerAdapterCodes: state.providerAdapterCodes,
    studioBindingsMigrated: state.studioBindingsMigrated,
    featureBindings: state.featureBindings,
    apiKeys: state.apiKeys,
    concurrency: state.concurrency,
    aspectRatio: state.aspectRatio,
    orientation: state.orientation,
    advancedOptions: state.advancedOptions,
    imageHostProviders: state.imageHostProviders,
    modelEndpointTypes: state.modelEndpointTypes,
    modelTypes: state.modelTypes,
    modelTags: state.modelTags,
    modelEnableGroups: state.modelEnableGroups,
    discoveredModelLimits: state.discoveredModelLimits,
    modelThinkingOverrides: state.modelThinkingOverrides,
  };
}
