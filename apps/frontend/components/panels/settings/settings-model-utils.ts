import { classifyModelByName } from "@/lib/api-key-manager";
import type {
  IProvider,
  ProviderAdapterModelType,
} from "@/stores/api-config-store";
import type { TtsRuntimeConfig } from "@/types/tts";

export type AdapterModelType = ProviderAdapterModelType;

export const MODEL_TYPE_LABELS: Record<AdapterModelType, string> = {
  text: "文本",
  image: "图片",
  video: "视频",
  tts: "TTS",
  vision: "视觉",
};

export function getPythonExecutableDisplayPath(
  config?: Pick<TtsRuntimeConfig, "pythonRuntimeDir" | "installedItems"> | null,
) {
  if (!config?.pythonRuntimeDir) return "配置完成后显示实际 Python 路径";
  const expectedPath = config.pythonRuntimeDir.includes("\\")
    ? `${config.pythonRuntimeDir}\\python.exe`
    : `${config.pythonRuntimeDir}/bin/python3`;
  const runtimeItem = config.installedItems?.find((item) => (
    item.label === "Python 运行环境"
    && item.detail === expectedPath
  ));
  return runtimeItem?.detail || expectedPath;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

export function inferProviderAdapterModelType(modelName: string): AdapterModelType {
  const lowerName = modelName.toLowerCase();
  if (/tts|voice|speech|audio|kokoro|chatterbox|luxtts|tada/.test(lowerName)) return "tts";

  const capabilities = classifyModelByName(modelName);
  if (capabilities.includes("video_generation")) return "video";
  if (capabilities.includes("image_generation")) return "image";
  if (capabilities.includes("vision") || /vision|vl|omni/.test(lowerName)) return "vision";
  return "text";
}

function inferProviderAdapterCapabilities(modelName: string): string[] {
  const modelType = inferProviderAdapterModelType(modelName);
  if (modelType === "tts") return ["tts"];
  if (modelType === "vision") return ["text", "vision"];
  return uniqueStrings(classifyModelByName(modelName));
}

function getToonflowModelShape(modelName: string) {
  const modelType = inferProviderAdapterModelType(modelName);
  const base = {
    name: modelName,
    modelName,
    type: modelType,
    capabilities: inferProviderAdapterCapabilities(modelName),
  };

  if (modelType === "image") {
    return { ...base, mode: ["text", "singleImage", "multiReference"] };
  }
  if (modelType === "video") {
    return {
      ...base,
      mode: ["text", "singleImage"],
      audio: "optional",
      durationResolutionMap: [{ duration: [5], resolution: ["720p", "1080p"] }],
    };
  }
  if (modelType === "tts") {
    return { ...base, voices: [{ title: "Default", voice: "default" }] };
  }
  return { ...base, type: modelType === "vision" ? "vision" : "text", think: false };
}

export function getProviderDisplayName(provider: Pick<IProvider, "platform" | "name">): string {
  if (provider.platform === "memefast" && /meme\s*fast|memefast|漫影API/i.test(provider.name)) {
    return "OpenAI 兼容服务";
  }
  return provider.name;
}

export function formatModelCapabilities(modelName: string): string {
  const labels: Record<string, string> = {
    text: "文本",
    vision: "视觉",
    function_calling: "工具",
    image_generation: "图片",
    video_generation: "视频",
    web_search: "搜索",
    reasoning: "推理",
    embedding: "向量",
    tts: "TTS",
  };
  return inferProviderAdapterCapabilities(modelName)
    .map((capability) => labels[capability] || capability)
    .join(" / ");
}

export function filterModelsByFuzzyQuery(models: string[], query: string): string[] {
  const tokens = query
    .toLocaleLowerCase("zh-Hans-CN")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (tokens.length === 0) return models;

  return models.filter((model) => {
    const normalizedModel = model.toLocaleLowerCase("zh-Hans-CN");
    return tokens.every((token) => normalizedModel.includes(token));
  });
}

export function buildProviderAdapterTemplate(provider: IProvider): string {
  const providerName = getProviderDisplayName(provider);
  const models = provider.model.map(getToonflowModelShape);
  const vendorConfig = {
    vendor: {
      id: provider.platform,
      version: "1.0",
      name: providerName,
      author: "漫影工作室",
      description: "OpenAI-compatible 供应商配置，可按实际接口补充模型和请求方法。",
      inputs: [
        { key: "apiKey", label: "API Key", type: "password", required: true },
        {
          key: "baseUrl",
          label: "Base URL",
          type: "url",
          required: true,
          placeholder: "https://api.example.com/v1",
        },
      ],
      inputValues: { apiKey: "", baseUrl: provider.baseUrl },
    },
    models,
  };

  return `/**
 * ${providerName} 供应商适配配置
 * 该代码作为本地配置资产保存；漫影工作室只解析 mystudio-vendor-json，不执行 TS。
 */
type ModelType = "text" | "image" | "video" | "tts" | "vision";
interface AdapterModel {
  name: string;
  modelName: string;
  type: ModelType;
  capabilities?: string[];
}
interface VendorConfig {
  id: string;
  version: string;
  name: string;
  author: string;
  description?: string;
  inputs: Array<{ key: string; label: string; type: "text" | "password" | "url"; required: boolean; placeholder?: string }>;
  inputValues: Record<string, string>;
  models: AdapterModel[];
}

const vendor: VendorConfig = ${JSON.stringify({ ...vendorConfig.vendor, models }, null, 2)};

const textRequest = () => {
  throw new Error("V1 仅保存配置，不在 renderer 执行供应商代码");
};
const imageRequest = textRequest;
const videoRequest = textRequest;
const ttsRequest = textRequest;

exports.vendor = vendor;
exports.textRequest = textRequest;
exports.imageRequest = imageRequest;
exports.videoRequest = videoRequest;
exports.ttsRequest = ttsRequest;

/* mystudio-vendor-json
${JSON.stringify(vendorConfig, null, 2)}
*/`;
}
