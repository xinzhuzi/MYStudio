import type { ReactNode } from "react";
import {
  Clapperboard,
  FileText,
  Image,
  Mic2,
  ScanEye,
  Sparkles,
  Video,
} from "lucide-react";
import type { AIFeature } from "@/stores/ai/api-config-store";
import {
  classifyModelByName,
  parseApiKeys,
  type ModelCapability,
} from "@/lib/ai/core";
import { LOCAL_TTS_BASE_URL } from "@/lib/tts/client";

export interface FeatureMeta {
  key: AIFeature;
  name: string;
  description: string;
  icon: ReactNode;
  requiredCapability?: ModelCapability;
  recommendation?: string;
}

export const FEATURE_CONFIGS: FeatureMeta[] = [
  { key: "script_analysis", name: "剧本分析 / 对话", description: "将故事文本分解为结构化剧本", icon: <FileText className="h-4 w-4" />, requiredCapability: "text" },
  { key: "character_generation", name: "角色图片", description: "生成角色参考图和变体服装", icon: <Image className="h-4 w-4" />, requiredCapability: "image_generation" },
  { key: "scene_generation", name: "场景图片", description: "生成场景环境参考图", icon: <Image className="h-4 w-4" />, requiredCapability: "image_generation" },
  { key: "prop_generation", name: "道具图片", description: "生成道具、法宝、物件参考图", icon: <Image className="h-4 w-4" />, requiredCapability: "image_generation" },
  { key: "video_generation", name: "视频生成", description: "将图片转换为视频", icon: <Video className="h-4 w-4" />, requiredCapability: "video_generation" },
  { key: "image_understanding", name: "图片理解", description: "读取图片并生成文字描述，可使用支持图片输入的文本模型", icon: <ScanEye className="h-4 w-4" />, requiredCapability: "vision" },
  { key: "freedom_image", name: "自由板块-图片", description: "自由板块独立的图片生成配置（未配置时回退到「图片生成」）", icon: <Sparkles className="h-4 w-4" />, requiredCapability: "image_generation" },
  { key: "freedom_video", name: "自由板块-视频", description: "自由板块独立的视频生成配置（未配置时回退到「视频生成」）", icon: <Clapperboard className="h-4 w-4" />, requiredCapability: "video_generation" },
  { key: "tts", name: "TTS 口播", description: "旁白、对白和音频生成模型配置", icon: <Mic2 className="h-4 w-4" />, requiredCapability: "tts" },
];

const DEFAULT_PLATFORM_CAPABILITIES: Record<string, ModelCapability[]> = {
  memefast: ["text", "vision", "image_generation", "video_generation"],
  "openai-compatible": ["text", "vision", "image_generation", "video_generation", "tts"],
  "anthropic-compatible": ["text", "vision"],
  "gemini-compatible": ["text", "vision", "image_generation"],
  openai: ["text", "vision", "image_generation", "video_generation", "tts"],
  minimax: ["text", "video_generation", "tts"],
  "tts-compatible": ["tts"],
  "manying-local-tts": ["tts"],
  runninghub: ["image_generation"],
};

const VISION_TEXT_MARKERS = [
  "vision", "image_input", "image-input", "image input", "image_understanding",
  "image-understanding", "multimodal", "multi_modal", "multi-modal", "omni",
  "识图", "图片输入", "图片理解", "图像理解", "多模态",
];

const MODEL_CAPABILITIES: Record<string, ModelCapability[]> = {
  "glm-4.7": ["text", "function_calling"],
  "glm-4.6v": ["text", "vision"],
  "deepseek-v3": ["text"],
  "deepseek-v3.2": ["text"],
  "deepseek-r1": ["text", "reasoning"],
  "kimi-k2": ["text"],
  "MiniMax-M2.1": ["text"],
  "qwen3-max": ["text"],
  "qwen3-max-preview": ["text"],
  "gemini-2.0-flash": ["text", "vision"],
  "gemini-3-flash-preview": ["text", "vision"],
  "gemini-3-pro-preview": ["text", "vision"],
  "claude-haiku-4-5-20251001": ["text", "vision"],
  "gpt-4o-mini": ["text", "vision"],
  "gpt-4o": ["text", "vision"],
  "gpt-4.1": ["text", "vision"],
  "gpt-5.1": ["text", "vision"],
  "cogview-3-plus": ["image_generation"],
  "gemini-imagen": ["image_generation"],
  "gemini-3-pro-image-preview": ["image_generation"],
  "gpt-image-1.5": ["image_generation"],
  cogvideox: ["video_generation"],
  "gemini-veo": ["video_generation"],
  "doubao-seedance-1-5-pro": ["video_generation"],
  "doubao-seedance-1-5-pro-251215": ["video_generation"],
  "doubao-seedream-4-5-251128": ["image_generation"],
  "veo3.1": ["video_generation"],
  "sora-2-all": ["video_generation"],
  "wan2.6-i2v": ["video_generation"],
  "grok-video-3": ["video_generation"],
  "grok-video-3-10s": ["video_generation"],
  "grok-video-3-15s": ["video_generation"],
  "doubao-vision": ["vision"],
  "2009613632530812930": ["image_generation"],
};

function hasVisionMarker(values?: string[]): boolean {
  return values?.some((value) => {
    const normalized = value.toLowerCase();
    return VISION_TEXT_MARKERS.some((marker) => normalized.includes(marker));
  }) ?? false;
}

function modelNameImpliesVision(modelName: string): boolean {
  const name = modelName.toLowerCase();
  if (/vision|qwen.*vl|glm.*v|doubao.*vision/.test(name)) return true;
  if (/^gpt-4o/.test(name) || /^gpt-4\.1/.test(name) || /^gpt-5/.test(name)) return true;
  return /claude|gemini/.test(name) && !/imagen|image[-_ ]?preview/.test(name);
}

function providerCapabilities(provider: { platform: string; capabilities?: ModelCapability[] }): ModelCapability[] | undefined {
  return provider.capabilities && provider.capabilities.length > 0
    ? provider.capabilities
    : DEFAULT_PLATFORM_CAPABILITIES[provider.platform];
}

function providerSupportsCapability(
  provider: { platform: string; capabilities?: ModelCapability[] },
  required?: ModelCapability,
): boolean {
  if (!required) return true;
  const capabilities = providerCapabilities(provider);
  return !capabilities || capabilities.length === 0 || capabilities.includes(required);
}

export function isProviderConfiguredForFeature(
  provider: { platform: string; apiKey: string; baseUrl?: string },
  feature: FeatureMeta,
): boolean {
  if (parseApiKeys(provider.apiKey).length > 0) return true;
  const normalizedBaseUrl = (provider.baseUrl || "").trim().replace(/\/+$/, "");
  const isLocalTts = provider.platform === "manying-local-tts"
    || (provider.platform === "tts-compatible" && normalizedBaseUrl === LOCAL_TTS_BASE_URL);
  return feature.requiredCapability === "tts" && isLocalTts;
}

export function modelSupportsCapability(
  modelName: string,
  provider: { platform: string; capabilities?: ModelCapability[] },
  required?: ModelCapability,
  modelType?: string,
  modelTagsList?: string[],
): boolean {
  if (!required) return true;

  if (required === "vision") {
    if (hasVisionMarker(provider.capabilities) || hasVisionMarker(modelTagsList) || modelNameImpliesVision(modelName)) return true;
    if (providerCapabilities(provider)?.includes("vision")) return true;
  }

  const modelCapabilities = MODEL_CAPABILITIES[modelName];
  if (modelCapabilities) return modelCapabilities.includes(required);

  if (modelType) {
    if (required === "text") return modelType === "文本";
    if (required === "image_generation") return modelType === "图像";
    if (required === "video_generation") return modelType === "音视频" && (modelTagsList?.some((tag) => tag.includes("视频")) ?? false);
    if (required === "vision") return hasVisionMarker(modelTagsList) || modelNameImpliesVision(modelName);
    if (required === "embedding") return modelType === "检索";
  }

  const inferred = classifyModelByName(modelName);
  if (inferred.length > 0) return inferred.includes(required);
  return providerSupportsCapability(provider, required);
}
