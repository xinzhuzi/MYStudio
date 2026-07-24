import { updateProviderKeys, type IProvider } from "@/lib/api-key-manager";
import type { FeatureBindings } from "@/lib/ai/feature-definitions";
import { omitRecordKeys } from "./api-config-provider-helpers";
import { syncProviderModels as syncProviderModelsFromApi } from "./api-config-model-sync";
import type { AgentDeploymentConfig } from "./api-config-agent-deployments";
import type { APIConfigStore } from "./api-config-store-types";

export type APIConfigProviderActions = Pick<
  APIConfigStore,
  | "addProvider"
  | "updateProvider"
  | "removeProvider"
  | "getProviderByPlatform"
  | "getProviderById"
  | "syncProviderModels"
>;

type SetAPIConfigState = (
  partial: Partial<APIConfigStore> | ((state: APIConfigStore) => Partial<APIConfigStore>),
) => void;
type GetAPIConfigState = () => APIConfigStore;

export function createAPIConfigProviderActions(
  set: SetAPIConfigState,
  get: GetAPIConfigState,
  dependencies: {
    generateId: () => string;
    normalizeAgentDeployments: (deployments: AgentDeploymentConfig[]) => AgentDeploymentConfig[];
  },
): APIConfigProviderActions {
  return {
    addProvider: (providerData) => {
      const newProvider: IProvider = { ...providerData, id: dependencies.generateId() };
      set((state) => ({ providers: [...state.providers, newProvider] }));
      updateProviderKeys(newProvider.id, newProvider.apiKey);
      console.log(`[APIConfig] Added provider: ${newProvider.name}`);
      return newProvider;
    },

    updateProvider: (provider) => {
      set((state) => ({
        providers: state.providers.map((item) => item.id === provider.id ? provider : item),
      }));
      updateProviderKeys(provider.id, provider.apiKey);
      console.log(`[APIConfig] Updated provider: ${provider.name}`);
    },

    removeProvider: (id) => {
      const provider = get().providers.find((item) => item.id === id);
      set((state) => ({
        providers: state.providers.filter((item) => item.id !== id),
        providerAdapterCodes: state.providerAdapterCodes.filter((item) => item.providerId !== id),
        featureBindings: Object.fromEntries(
          Object.entries(state.featureBindings).map(([feature, bindings]) => {
            const filtered = (bindings || []).filter((binding) => {
              const splitAt = binding.indexOf(":");
              const providerKey = splitAt > 0 ? binding.slice(0, splitAt) : binding;
              return providerKey !== id && providerKey !== provider?.platform;
            });
            return [feature, filtered.length > 0 ? filtered : null];
          }),
        ) as FeatureBindings,
        agentDeployments: dependencies.normalizeAgentDeployments(
          state.agentDeployments.map((deployment) => {
            const modelProviderKey = deployment.modelId?.includes(":")
              ? deployment.modelId.slice(0, deployment.modelId.indexOf(":"))
              : undefined;
            const shouldClear =
              deployment.vendorId === id
              || deployment.vendorId === provider?.platform
              || modelProviderKey === id
              || modelProviderKey === provider?.platform;
            return shouldClear
              ? { ...deployment, vendorId: undefined, modelId: undefined }
              : deployment;
          }),
        ),
      }));
      if (provider) console.log(`[APIConfig] Removed provider: ${provider.name}`);
    },

    getProviderByPlatform: (platform) => get().providers.find((item) => item.platform === platform),
    getProviderById: (id) => get().providers.find((item) => item.id === id),

    syncProviderModels: async (providerId) => {
      const provider = get().providers.find((item) => item.id === providerId);
      return syncProviderModelsFromApi(provider, {
        updateProvider: (updatedProvider) => get().updateProvider(updatedProvider),
        applyEndpointTypes: (updates) => set((state) => ({
          modelEndpointTypes: { ...state.modelEndpointTypes, ...updates },
        })),
        replaceProviderMetadata: (ownedModels, metadata) => set((state) => ({
          modelTypes: { ...omitRecordKeys(state.modelTypes, ownedModels), ...metadata.modelTypes },
          modelTags: { ...omitRecordKeys(state.modelTags, ownedModels), ...metadata.modelTags },
          modelEndpointTypes: { ...omitRecordKeys(state.modelEndpointTypes, ownedModels), ...metadata.modelEndpointTypes },
          modelEnableGroups: { ...omitRecordKeys(state.modelEnableGroups, ownedModels), ...metadata.modelEnableGroups },
        })),
      });
    },
  };
}
