import type { ModelBinding, ModelDefinition, VendorConfig } from "@/types/studio";

export interface ResolvedModelBinding {
  binding: ModelBinding;
  vendor: VendorConfig;
  model: ModelDefinition;
}

export function validateVendorConfig(config: VendorConfig): VendorConfig {
  const id = config.id.trim();
  const name = config.name.trim();

  if (!id) throw new Error("供应商 id 不能为空");
  if (!name) throw new Error("供应商名称不能为空");

  const relayBaseUrl = normalizeRelayBaseUrl(config.relayBaseUrl);
  const seenModelIds = new Set<string>();
  const models = config.models.map((model) => {
    const modelId = model.id.trim();
    if (!modelId) throw new Error("模型 id 不能为空");
    if (seenModelIds.has(modelId)) throw new Error(`模型 id 重复: ${modelId}`);
    if (!isValidModelType(model.type)) throw new Error(`模型类型无效: ${model.type}`);
    seenModelIds.add(modelId);

    return {
      ...model,
      id: modelId,
      name: model.name.trim() || modelId,
      capabilities: model.capabilities ?? {},
      defaultParams: model.defaultParams ?? {},
    };
  });

  return {
    ...config,
    id,
    name,
    relayBaseUrl,
    inputValues: config.inputValues ?? {},
    models,
  };
}

function isValidModelType(value: unknown): value is ModelDefinition["type"] {
  return value === "text" || value === "image" || value === "video" || value === "tts" || value === "vision";
}

export function resolveModelBinding(
  bindings: ModelBinding[],
  vendors: VendorConfig[],
  key: ModelBinding["key"],
): ResolvedModelBinding | null {
  const binding = bindings.find((item) => item.key === key);
  if (!binding) return null;

  for (const vendor of vendors.filter((item) => item.enabled)) {
    const model = vendor.models.find((item) => item.id === binding.modelId);
    if (model) {
      return { binding, vendor, model };
    }
  }

  return null;
}

function normalizeRelayBaseUrl(value?: string) {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;

  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("中转站地址只支持 http/https");
    }
    return url.toString().replace(/\/$/, "");
  } catch (error) {
    if (error instanceof Error && error.message === "中转站地址只支持 http/https") {
      throw error;
    }
    throw new Error("中转站地址格式无效");
  }
}
