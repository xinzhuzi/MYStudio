import type { StateStorage } from "zustand/middleware";
import type { APIConfigState } from "./api-config-store";

export const API_CONFIG_STORAGE_KEY = "opencut-api-config";
export const API_CONFIG_PERSIST_VERSION = 17;

const fallbackAPIConfigStorage: StateStorage = {
  getItem: () => null,
  setItem: () => undefined,
  removeItem: () => undefined,
};

export function getAPIConfigStorage(): StateStorage {
  if (typeof localStorage !== "undefined" && typeof localStorage.setItem === "function") {
    return localStorage;
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
