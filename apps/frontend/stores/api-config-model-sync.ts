import { parseApiKeys, type IProvider } from "@/lib/api-key-manager";

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
): Promise<{ success: boolean; count: number; error?: string }> {
  if (!provider) return { success: false, count: 0, error: "供应商不存在" };
  const keys = parseApiKeys(provider.apiKey);
  if (keys.length === 0) return { success: false, count: 0, error: "请先配置 API Key" };
  const baseUrl = provider.baseUrl?.replace(/\/+$/, "");
  if (!baseUrl) return { success: false, count: 0, error: "Base URL 未配置" };

  const isMemefast = provider.platform === "memefast";
  const configuredModelIds = Array.from(new Set((provider.model || []).map((model) => model.trim()).filter(Boolean)));
  if (!isMemefast && configuredModelIds.length === 0) {
    return { success: false, count: 0, error: "请先填写模型，再同步验证供应商模型" };
  }

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
      const response = await fetch(pricingUrl);
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
          const response = await fetch(modelsUrl, { headers: { Authorization: `Bearer ${keys[index]}` } });
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
      let anySuccess = false;
      let lastError = "";
      for (let index = 0; index < keys.length; index++) {
        try {
          const response = await fetch(modelsUrl, { headers: { Authorization: `Bearer ${keys[index]}` } });
          if (!response.ok) {
            lastError = `key#${index + 1} API 返回 ${response.status}`;
            console.warn(`[APIConfig] ${lastError}`);
            continue;
          }
          const json = await response.json() as { data?: Array<{ id: string; supported_endpoint_types?: string[] } | string> } | Array<{ id: string; supported_endpoint_types?: string[] } | string>;
          const models = Array.isArray(json) ? json : json.data;
          if (!Array.isArray(models) || models.length === 0) continue;
          anySuccess = true;
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
        }
      }
      if (!anySuccess) return { success: false, count: 0, error: lastError || "API 返回异常" };
      const missing = configuredModelIds.filter((model) => !allModelIds.has(model));
      if (missing.length > 0) return { success: false, count: 0, error: `供应商模型列表中未找到: ${missing.join(", ")}` };
      const endpointTypes = Object.fromEntries(
        configuredModelIds.filter((model) => metadata.modelEndpointTypes[model]).map((model) => [model, metadata.modelEndpointTypes[model]]),
      );
      if (Object.keys(endpointTypes).length > 0) dependencies.applyEndpointTypes(endpointTypes);
      dependencies.updateProvider({ ...provider, model: configuredModelIds });
      return { success: true, count: configuredModelIds.length };
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
