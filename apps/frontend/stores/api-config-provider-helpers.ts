import type { ProviderId, ServiceType } from "@opencut/ai-core";
import type { IProvider } from "@/lib/api-key-manager";
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
