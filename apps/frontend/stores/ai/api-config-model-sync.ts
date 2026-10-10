import { parseApiKeys, type IProvider } from "@/lib/ai/core";
import { observedFetch } from "@/lib/diagnostics/network";

export interface ProviderModelMetadata {
  modelTypes: Record<string, string>;
  modelTags: Record<string, string[]>;
  modelEndpointTypes: Record<string, string[]>;
  modelEnableGroups: Record<string, string[]>;
}

interface SyncProviderModelsDependencies {
  updateProvider: (provider: IProvider) => void;
  applyEndpointTypes: (updates: Record<string, string[]>) => void;
  replaceProviderMetadata: (ownedModels: Set<string>, metadata: ProviderModelMetadata) => void;
}

export async function syncProviderModels(
  provider: IProvider | undefined,
  dependencies: SyncProviderModelsDependencies,
): Promise<{ success: boolean; count: number; removed?: number; error?: string }> {
  if (!provider) return { success: false, count: 0, error: "供应商不存在" };
  const keys = parseApiKeys(provider.apiKey);
  if (keys.length === 0) return { success: false, count: 0, error: "请先配置 API Key" };
  const baseUrl = provider.baseUrl?.replace(/\/+$/, "");
  if (!baseUrl) return { success: false, count: 0, error: "Base URL 未配置" };

  const isMemefast = provider.platform === "memefast";
  const configuredModelIds = Array.from(new Set((provider.model || []).map((model) => model.trim()).filter(Boolean)));

  try {
    const allModelIds = new Set<string>();
    const metadata: ProviderModelMetadata = {
      modelTypes: {},
      modelTags: {},
      modelEndpointTypes: {},
      modelEnableGroups: {},
    };

    if (isMemefast) {
      const pricingUrl = `${baseUrl.replace(/\/v\d+$/, "")}/api/pricing_new`;
      const response = await observedFetch(pricingUrl, { method: "GET" }, {
        endpointFamily: "models-sync",
        providerId: provider.id,
        providerName: provider.name,
      });
      if (!response.ok) return { success: false, count: 0, error: `pricing_new API 返回 ${response.status}` };
      const json = await response.json() as { data?: Array<{
        model_name: string;
        model_type?: string;
        tags?: string | string[];
        supported_endpoint_types?: string[];
        enable_groups?: string[];
      }> };
      const data = json.data;
      if (!Array.isArray(data) || data.length === 0) return { success: false, count: 0, error: "响应格式异常" };

      for (const model of data) {
        const name = model.model_name;
        if (!name) continue;
        allModelIds.add(name);
        if (model.model_type) metadata.modelTypes[name] = model.model_type;
        if (model.tags) {
          metadata.modelTags[name] = typeof model.tags === "string"
            ? model.tags.split(",").map((tag) => tag.trim()).filter(Boolean)
            : model.tags;
        }
        if (Array.isArray(model.supported_endpoint_types)) {
          metadata.modelEndpointTypes[name] = model.supported_endpoint_types;
        }
        if (Array.isArray(model.enable_groups) && model.enable_groups.length > 0) {
          metadata.modelEnableGroups[name] = model.enable_groups;
        }
      }

      const modelsUrl = /\/v\d+$/.test(baseUrl) ? `${baseUrl}/models` : `${baseUrl}/v1/models`;
      for (let index = 0; index < keys.length; index++) {
        try {
          const response = await observedFetch(modelsUrl, { headers: { Authorization: `Bearer ${keys[index]}` } }, {
            endpointFamily: "models-sync",
            providerId: provider.id,
            providerName: provider.name,
            attempt: index + 1,
            maxRetries: keys.length,
          });
          if (!response.ok) {
            console.warn(`[APIConfig] MemeFast key#${index + 1} /v1/models returned ${response.status}, skip`);
            continue;
          }
          const json = await response.json() as { data?: Array<{ id: string; supported_endpoint_types?: string[] } | string> } | Array<{ id: string; supported_endpoint_types?: string[] } | string>;
          const models = Array.isArray(json) ? json : json.data;
          if (!Array.isArray(models)) continue;
          for (const model of models) {
            const id = typeof model === "string" ? model : model.id;
            if (id) allModelIds.add(id);
            if (typeof model !== "string" && model.id && Array.isArray(model.supported_endpoint_types)) {
              metadata.modelEndpointTypes[model.id] = model.supported_endpoint_types;
            }
          }
        } catch (error) {
          console.warn(`[APIConfig] MemeFast key#${index + 1} /v1/models failed:`, error);
        }
      }
    } else {
      const modelsUrl = /\/v\d+$/.test(baseUrl) ? `${baseUrl}/models` : `${baseUrl}/v1/models`;
      // 1010 用户裁定:同步以服务器目录为准(替换式)——不在目录中的已配置模型随同步移除,
      // 防止失效模型长期滞留列表(功能绑定可选到死模型)。替换具有破坏性,必须拿到全部 Key 的
      // 目录才动手:任一 Key 失败/目录为空即整体取消且不动列表,防止误删仅由该 Key 分组提供的模型。
      const failedKeyNumbers: number[] = [];
      let lastError = "";
      for (let index = 0; index < keys.length; index++) {
        try {
          const response = await observedFetch(modelsUrl, { headers: { Authorization: `Bearer ${keys[index]}` } }, {
            endpointFamily: "models-sync",
            providerId: provider.id,
            providerName: provider.name,
            attempt: index + 1,
            maxRetries: keys.length,
          });
          if (!response.ok) {
            lastError = `key#${index + 1} API 返回 ${response.status}`;
            console.warn(`[APIConfig] ${lastError}`);
            failedKeyNumbers.push(index + 1);
            continue;
          }
          const json = await response.json() as { data?: Array<{ id: string; supported_endpoint_types?: string[] } | string> } | Array<{ id: string; supported_endpoint_types?: string[] } | string>;
          const models = Array.isArray(json) ? json : json.data;
          if (!Array.isArray(models) || models.length === 0) {
            lastError = `key#${index + 1} 目录为空`;
            console.warn(`[APIConfig] ${lastError}`);
            failedKeyNumbers.push(index + 1);
            continue;
          }
          for (const model of models) {
            const id = typeof model === "string" ? model : model.id;
            if (id) allModelIds.add(id);
            if (typeof model !== "string" && model.id && Array.isArray(model.supported_endpoint_types)) {
              metadata.modelEndpointTypes[model.id] = model.supported_endpoint_types;
            }
          }
        } catch (error) {
          lastError = `key#${index + 1} 网络请求失败`;
          console.warn(`[APIConfig] ${lastError}:`, error);
          failedKeyNumbers.push(index + 1);
        }
      }
      if (failedKeyNumbers.length > 0) {
        const failedKeys = failedKeyNumbers.map((keyNumber) => `key#${keyNumber}`).join("、");
        return { success: false, count: 0, error: `${failedKeys} 目录获取失败(${lastError}),已取消同步以免误删` };
      }
      const modelIds = Array.from(allModelIds);
      const removedModels = configuredModelIds.filter((model) => !allModelIds.has(model));
      if (removedModels.length > 0) {
        console.warn(`[APIConfig] 以下已配置模型不在供应商目录中,已随同步移除: ${removedModels.join(", ")}`);
      }
      const endpointTypes = Object.fromEntries(
        modelIds.filter((model) => metadata.modelEndpointTypes[model]).map((model) => [model, metadata.modelEndpointTypes[model]]),
      );
      if (Object.keys(endpointTypes).length > 0) dependencies.applyEndpointTypes(endpointTypes);
      dependencies.updateProvider({ ...provider, model: modelIds });
      return { success: true, count: modelIds.length, removed: removedModels.length };
    }

    const modelIds = Array.from(allModelIds);
    if (modelIds.length === 0) return { success: false, count: 0, error: "未获取到任何模型" };
    dependencies.replaceProviderMetadata(new Set([...(provider.model || []), ...modelIds]), metadata);
    dependencies.updateProvider({ ...provider, model: modelIds });
    return { success: true, count: modelIds.length };
  } catch (error) {
    console.error("[APIConfig] Model sync failed:", error);
    return { success: false, count: 0, error: "网络请求失败，请检查网络" };
  }
}
