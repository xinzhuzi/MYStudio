import {
  getAllFeatureConfigs,
  getFeatureConfig,
  type FeatureConfig,
} from "@/lib/ai/feature-router";
import { resolveImageApiFormat } from "@/lib/api-key-manager";
import type { AIFeature } from "@/stores/api-config-store";

export type FreedomImageRoute = "midjourney" | "ideogram" | "kling_image" | "openai_chat" | "openai_images" | "replicate";
export type FreedomVideoRoute = "openai_official" | "unified" | "volc" | "wan" | "kling" | "replicate";
export interface FreedomEndpointPaths {
  submit: string;
  poll: (id: string) => string;
}

export function pickFeatureConfig(feature: AIFeature, requestedModel?: string): FeatureConfig | null {
  const all = getAllFeatureConfigs(feature);
  if (all.length === 0) return null;
  if (requestedModel) {
    const exact = all.find((config) => config.model === requestedModel);
    if (exact) return exact;
  }
  return getFeatureConfig(feature) ?? all[0];
}

export function resolveFreedomFeatureConfig(
  feature: "freedom_image" | "freedom_video",
  fallback: "character_generation" | "video_generation",
  requestedModel?: string,
): { config: FeatureConfig | null; source: string } {
  const primary = pickFeatureConfig(feature, requestedModel);
  if (primary) return { config: primary, source: feature };
  const fallbackConfig = pickFeatureConfig(fallback, requestedModel);
  if (fallbackConfig) return { config: fallbackConfig, source: `${fallback} (fallback)` };
  return { config: null, source: feature };
}

export function detectFreedomImageRoute(model: string, endpointTypes?: string[]): FreedomImageRoute {
  const hasEndpoint = (pattern: RegExp) => (endpointTypes || []).some((type) => pattern.test(type));
  const hasExactEndpoint = (name: string) => (endpointTypes || []).includes(name);
  if (/^mj_/i.test(model) || /midjourney/i.test(model) || /^niji-/i.test(model) || hasEndpoint(/midjourney/i)) return "midjourney";
  if (/^ideogram_/i.test(model)) return "ideogram";
  if (/^kling-(image|omni-image)/i.test(model) || hasExactEndpoint("kling生图") || hasExactEndpoint("omni-image") || hasExactEndpoint("文生图")) return "kling_image";
  if ((endpointTypes || []).some((type) => type.includes("/") && type.endsWith("异步"))) return "replicate";
  return resolveImageApiFormat(endpointTypes, model) === "openai_chat" ? "openai_chat" : "openai_images";
}

const FREEDOM_VIDEO_ROUTE_MAP: Record<string, FreedomVideoRoute> = {
  "openAI官方视频格式": "openai_official",
  "openAI视频格式": "openai_official",
  "豆包视频异步": "volc",
  "异步": "wan",
  "文生视频": "kling",
  "图生视频": "kling",
  "视频延长": "kling",
  "omni-video": "kling",
  "动作控制": "kling",
  "多模态视频编辑": "kling",
  "数字人": "kling",
  "对口型": "kling",
  "视频特效": "kling",
  openai: "unified",
  "视频统一格式": "unified",
  "grok视频": "unified",
  "openai-response": "unified",
  "海螺视频生成": "unified",
  "luma视频生成": "unified",
  "luma视频扩展": "unified",
  "runway图生视频": "unified",
  "aigc-video": "unified",
  "wan视频生成": "unified",
  "vidu文生视频": "unified",
  "vidu图生视频": "unified",
  "vidu参考生视频": "unified",
  "vidu首尾帧": "unified",
  "luma视频延长": "unified",
};

const UNIFIED_ENDPOINT_PATHS: Record<string, FreedomEndpointPaths> = {
  "grok视频": { submit: "/v1/video/create", poll: (id) => `/v1/video/query?id=${id}` },
  "视频统一格式": { submit: "/v1/video/create", poll: (id) => `/v1/video/query?id=${id}` },
  "海螺视频生成": { submit: "/minimax/v1/video_generation", poll: (id) => `/minimax/v1/query/video_generation?task_id=${id}` },
  "luma视频生成": { submit: "/luma/generations", poll: (id) => `/luma/generations/${id}` },
  "luma视频扩展": { submit: "/luma/generations", poll: (id) => `/luma/generations/${id}` },
  "luma视频延长": { submit: "/luma/generations", poll: (id) => `/luma/generations/${id}` },
  "runway图生视频": { submit: "/runwayml/v1/image_to_video", poll: (id) => `/runwayml/v1/tasks/${id}` },
  "wan视频生成": { submit: "/alibailian/api/v1/services/aigc/video-generation/video-synthesis", poll: (id) => `/alibailian/api/v1/tasks/${id}` },
  "aigc-video": { submit: "/tencent-vod/v1/aigc-video", poll: (id) => `/tencent-vod/v1/aigc-video/${id}` },
  "vidu文生视频": { submit: "/ent/v2/text2video", poll: (id) => `/ent/v2/task?task_id=${id}` },
  "vidu图生视频": { submit: "/ent/v2/img2video", poll: (id) => `/ent/v2/task?task_id=${id}` },
  "vidu参考生视频": { submit: "/ent/v2/reference2video", poll: (id) => `/ent/v2/task?task_id=${id}` },
  "vidu首尾帧": { submit: "/ent/v2/start-end2video", poll: (id) => `/ent/v2/task?task_id=${id}` },
};
const DEFAULT_UNIFIED_ENDPOINT: FreedomEndpointPaths = {
  submit: "/v1/video/generations",
  poll: (id) => `/v1/video/generations/${id}`,
};

const IMAGE_ENDPOINT_PATHS: Record<string, FreedomEndpointPaths> = {
  "aigc-image": { submit: "/tencent-vod/v1/aigc-image", poll: (id) => `/tencent-vod/v1/aigc-image/${id}` },
  "vidu生图": { submit: "/ent/v2/reference2image", poll: (id) => `/ent/v2/task?task_id=${id}` },
};
export const DEFAULT_IMAGE_ENDPOINT: FreedomEndpointPaths = {
  submit: "/v1/images/generations",
  poll: (id) => `/v1/images/generations/${id}`,
};

export function getImageEndpointPaths(endpointTypes: string[]): FreedomEndpointPaths {
  for (const type of endpointTypes) {
    if (IMAGE_ENDPOINT_PATHS[type]) return IMAGE_ENDPOINT_PATHS[type];
  }
  return DEFAULT_IMAGE_ENDPOINT;
}

export function getUnifiedEndpointPaths(endpointTypes: string[]): FreedomEndpointPaths {
  for (const type of endpointTypes) {
    if (UNIFIED_ENDPOINT_PATHS[type]) return UNIFIED_ENDPOINT_PATHS[type];
  }
  return DEFAULT_UNIFIED_ENDPOINT;
}

export function detectFreedomVideoRoute(model: string, endpointTypes?: string[]): FreedomVideoRoute {
  if (endpointTypes?.length) {
    for (const type of endpointTypes) if (FREEDOM_VIDEO_ROUTE_MAP[type] === "openai_official") return "openai_official";
    for (const type of endpointTypes) if (FREEDOM_VIDEO_ROUTE_MAP[type] === "kling") return "kling";
    for (const type of endpointTypes) if (FREEDOM_VIDEO_ROUTE_MAP[type] === "volc") return "volc";
    for (const type of endpointTypes) if (FREEDOM_VIDEO_ROUTE_MAP[type] === "wan") return "wan";
    if (endpointTypes.some((type) => type.includes("/") && type.endsWith("异步"))) return "replicate";
    for (const type of endpointTypes) if (FREEDOM_VIDEO_ROUTE_MAP[type] === "unified") return "unified";
  }
  const normalizedModel = model.toLowerCase();
  if (normalizedModel.includes("sora-2")) return "openai_official";
  if (normalizedModel.includes("kling")) return "kling";
  if (normalizedModel.includes("seedance") || normalizedModel.includes("doubao")) return "volc";
  if (normalizedModel.includes("wan")) return "wan";
  return "unified";
}
