import type { ModelBinding } from "@/types/studio";
import {
  API_AGENT_DEPLOYMENT_DEFAULTS,
  getAgentDeploymentModelType,
  normalizeAgentDeployments,
  validateProviderAdapterCodeText,
  type AgentDeploymentConfig,
  type AgentDeploymentKey,
} from "./api-config-agent-deployments";
import type { APIConfigStore } from "./api-config-store-types";

export type APIConfigAgentActions = Pick<
  APIConfigStore,
  | "setAgentUseMode"
  | "setAgentDeployment"
  | "getResolvedAgentModel"
  | "migrateStudioBindings"
  | "upsertProviderAdapterCode"
  | "validateProviderAdapterCode"
  | "syncModelsFromProviderAdapterCode"
>;

type SetAPIConfigState = (
  partial: Partial<APIConfigStore> | ((state: APIConfigStore) => Partial<APIConfigStore>),
) => void;
type GetAPIConfigState = () => APIConfigStore;

export function createAPIConfigAgentActions(
  set: SetAPIConfigState,
  get: GetAPIConfigState,
): APIConfigAgentActions {
  return {
    setAgentUseMode: (mode) => set({ agentUseMode: mode }),

    setAgentDeployment: (deployment) => {
      set((state) => {
        const defaults = API_AGENT_DEPLOYMENT_DEFAULTS.find((item) => item.key === deployment.key);
        const nextDeployment: AgentDeploymentConfig = {
          ...(defaults || { key: deployment.key, name: deployment.key, desc: "" }),
          ...(state.agentDeployments.find((item) => item.key === deployment.key) || {}),
          ...deployment,
        };
        const exists = state.agentDeployments.some((item) => item.key === deployment.key);
        return {
          agentDeployments: normalizeAgentDeployments(
            exists
              ? state.agentDeployments.map((item) => item.key === deployment.key ? nextDeployment : item)
              : [...state.agentDeployments, nextDeployment],
          ),
        };
      });
    },

    getResolvedAgentModel: (key) => {
      const state = get();
      const deployments = normalizeAgentDeployments(state.agentDeployments);
      const universal = deployments.find((item) => item.key === "universalAi");
      const exact = deployments.find((item) => item.key === key);
      const canUseTextFallback = getAgentDeploymentModelType(key) === "text";
      const deployment = state.agentUseMode === "simple" && key !== "universalAi" && canUseTextFallback && universal?.modelId && !universal.disabled
        ? universal
        : exact;
      if (!deployment || deployment.disabled || !deployment.modelId) return null;

      let vendorId = deployment.vendorId;
      let model = deployment.modelId;
      if (!vendorId) {
        const splitAt = model.indexOf(":");
        if (splitAt > 0) {
          vendorId = model.slice(0, splitAt);
          model = model.slice(splitAt + 1);
        }
      }
      if (!vendorId || !model) return null;

      const provider = state.providers.find((item) => item.id === vendorId || item.platform === vendorId);
      if (!provider || (provider.model.length > 0 && !provider.model.includes(model))) return null;
      return { deployment, provider, model };
    },

    migrateStudioBindings: (bindings: ModelBinding[]) => {
      const state = get();
      if (state.studioBindingsMigrated) return { migrated: false, count: 0 };

      const allowedKeys = new Set(API_AGENT_DEPLOYMENT_DEFAULTS.map((item) => item.key));
      const updates: AgentDeploymentConfig[] = [];
      for (const binding of bindings) {
        if (!allowedKeys.has(binding.key as AgentDeploymentKey)) continue;
        const splitAt = binding.modelId.indexOf(":");
        const vendorId = splitAt > 0 ? binding.modelId.slice(0, splitAt) : undefined;
        const modelId = splitAt > 0 ? binding.modelId.slice(splitAt + 1) : binding.modelId;
        const defaults = API_AGENT_DEPLOYMENT_DEFAULTS.find((item) => item.key === binding.key);
        if (!defaults || !modelId) continue;
        updates.push({
          ...defaults,
          ...(state.agentDeployments.find((item) => item.key === binding.key) || {}),
          key: binding.key as AgentDeploymentKey,
          vendorId,
          modelId,
        });
      }
      if (updates.length === 0) return { migrated: false, count: 0 };

      set({
        agentDeployments: normalizeAgentDeployments([
          ...state.agentDeployments.filter((item) => !updates.some((update) => update.key === item.key)),
          ...updates,
        ]),
        studioBindingsMigrated: true,
      });
      return { migrated: true, count: updates.length };
    },

    upsertProviderAdapterCode: (providerId, code) => {
      const result = validateProviderAdapterCodeText(code);
      set((state) => ({
        providerAdapterCodes: [
          ...state.providerAdapterCodes.filter((item) => item.providerId !== providerId),
          { providerId, code, updatedAt: Date.now(), validationState: result.state, validationReason: result.reason },
        ],
      }));
      return result;
    },

    validateProviderAdapterCode: (providerId) => {
      const item = get().providerAdapterCodes.find((adapter) => adapter.providerId === providerId);
      return item
        ? validateProviderAdapterCodeText(item.code)
        : { ok: false, state: "invalid", reason: "尚未保存供应商适配代码", models: [] };
    },

    syncModelsFromProviderAdapterCode: (providerId) => {
      const result = get().validateProviderAdapterCode(providerId);
      if (!result.ok) return { success: false, count: 0, error: result.reason || "供应商适配代码无效" };
      const provider = get().providers.find((item) => item.id === providerId);
      if (!provider) return { success: false, count: 0, error: "供应商不存在" };
      const models = result.models.map((model) => model.modelName);
      get().updateProvider({ ...provider, model: models });
      return { success: true, count: models.length };
    },
  };
}
