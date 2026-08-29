import type { ProviderId, ServiceType } from "@/lib/ai/core";
import type { IProvider } from "@/lib/ai/core";
import { LOCAL_TTS_BASE_URL } from "@/lib/tts/constants";
import { TTS_MODEL_GROUPS } from "@/lib/tts/model-catalog";

export const DEFAULT_LOCAL_TTS_PROVIDER_ID = "manying-local-tts";
export const DEFAULT_LOCAL_TTS_MODEL = "qwen-tts-1.7B";

export const PROVIDER_INFO: Record<ProviderId, { name: string; services: ServiceType[] }> = {
  memefast: { name: "OpenAI 兼容服务", services: ["chat", "image", "video", "vision"] },
  runninghub: { name: "RunningHub", services: ["image", "vision"] },
  openai: { name: "OpenAI", services: [] },
  custom: { name: "Custom", services: [] },
};

export function createDefaultLocalTtsProvider(): IProvider {
  return {
    id: DEFAULT_LOCAL_TTS_PROVIDER_ID,
    platform: "manying-local-tts",
    name: "本地 TTS",
    baseUrl: LOCAL_TTS_BASE_URL,
    apiKey: "",
    model: TTS_MODEL_GROUPS.flatMap((group) => group.models.map((model) => model.modelName)),
    capabilities: ["tts"],
  };
}

export function omitRecordKeys<T>(record: Record<string, T>, keys: Iterable<string>): Record<string, T> {
  const next = { ...record };
  for (const key of keys) {
    delete next[key];
  }
  return next;
}

export function ensureDefaultLocalTtsProvider(providers: IProvider[] | undefined | null): IProvider[] {
  const existing = providers || [];
  if (existing.some((provider) => provider.id === DEFAULT_LOCAL_TTS_PROVIDER_ID)) {
    return existing;
  }
  return [createDefaultLocalTtsProvider(), ...existing];
}

export function isLocalTtsProvider(provider: IProvider) {
  return (
    provider.platform === "manying-local-tts"
    || (
      provider.platform === "tts-compatible"
      && provider.baseUrl.trim().replace(/\/+$/, "") === LOCAL_TTS_BASE_URL
    )
  );
}

// ---------------------------------------------------------------------------
// 本地图片生成 (manying-local-image) — OpenAI 兼容的本地生图 sidecar.
// Model: Qwen-Image-Edit 2511(大件指向 ComfyUI,显式小件下载);旧 sdxl/flux 已退役.
// ---------------------------------------------------------------------------

export const DEFAULT_LOCAL_IMAGE_PROVIDER_ID = "manying-local-image";
export const LOCAL_IMAGE_BASE_URL = "http://127.0.0.1:17595";
/** Fixed local token — the sidecar accepts it as Bearer key (loopback only). */
export const LOCAL_IMAGE_API_KEY = "manying-local-image";
export const LOCAL_IMAGE_MODELS = ["qwen-image-edit-2511"] as const;
export const DEFAULT_LOCAL_IMAGE_MODEL = "qwen-image-edit-2511";

export function createDefaultLocalImageProvider(): IProvider {
  return {
    id: DEFAULT_LOCAL_IMAGE_PROVIDER_ID,
    platform: "manying-local-image",
    name: "本地图片生成",
    baseUrl: LOCAL_IMAGE_BASE_URL,
    // Non-empty placeholder key: image features skip providers without keys,
    // and the sidecar accepts this fixed loopback token.
    apiKey: LOCAL_IMAGE_API_KEY,
    model: [...LOCAL_IMAGE_MODELS],
    capabilities: ["image_generation"],
  };
}

export function ensureDefaultLocalImageProvider(providers: IProvider[] | undefined | null): IProvider[] {
  const existing = providers || [];
  if (existing.some((provider) => provider.id === DEFAULT_LOCAL_IMAGE_PROVIDER_ID)) {
    return existing;
  }
  return [createDefaultLocalImageProvider(), ...existing];
}

export function isLocalImageProvider(provider: IProvider) {
  return (
    provider.platform === "manying-local-image"
    || provider.baseUrl.trim().replace(/\/+$/, "") === LOCAL_IMAGE_BASE_URL
  );
}
