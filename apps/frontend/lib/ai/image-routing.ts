/**
 * 分层定位(2026-08-29 迁自 lib/assist/freedom-*,Trellis 08-28-freedom-image-engine-rename 批次 A):
 * 渠道/引擎层——与 image-generator/mikoto-async 同层,服务于所有生图消费方
 * (自由面板/分镜批量/资产生成),不隶属任何单一面板。行为零变更,纯迁移。
 */
/**
 * 生图智能路由:按模型元数据选端点形态(openai_images/openai_chat/mj/…)。
 * 视频路由留 lib/assist/freedom-routing.ts 待二期。
 */
import { resolveImageApiFormat } from "@/lib/ai/core";

export type FreedomImageRoute = "midjourney" | "ideogram" | "kling_image" | "openai_chat" | "openai_images" | "replicate";

export interface FreedomEndpointPaths {
  submit: string;
  poll: (id: string) => string;
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
