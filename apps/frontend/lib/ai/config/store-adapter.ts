import { useAPIConfigStore } from "@/stores/ai/api-config-store";
import type { APIConfigStore } from "@/stores/ai/api-config-store";

export type { AgentDeploymentKey, ImageHostProvider } from "@/stores/ai/api-config-store";

/**
 * Application adapter for the persisted API configuration store.
 * Runtime AI modules depend on this boundary instead of importing Zustand
 * state directly; the store remains the owner of persistence and migrations.
 */
export type AIConfigStore = APIConfigStore;

export function getAIConfigStore(): AIConfigStore {
  return useAPIConfigStore.getState();
}

export function useAIConfigSelector<T>(selector: (state: AIConfigStore) => T): T {
  return useAPIConfigStore(selector);
}

export function getModelEndpointTypes(model: string): string[] {
  return getAIConfigStore().modelEndpointTypes[model] ?? [];
}

export function getAIConcurrency(): number {
  return getAIConfigStore().concurrency || 1;
}
