/**
 * 分层定位(2026-08-29 迁自 lib/assist/freedom-*,Trellis 08-28-freedom-image-engine-rename 批次 A):
 * 渠道/引擎层——与 image-generator/mikoto-async 同层,服务于所有生图消费方
 * (自由面板/分镜批量/资产生成),不隶属任何单一面板。行为零变更,纯迁移。
 */
/**
 * 生图/生视频引擎的功能绑定解析(按 feature 绑定挑 provider 配置)。
 * 图片视频引擎共用,故独立成叶;迁自 freedom-routing。
 */
import {
  getAllFeatureConfigs,
  getFeatureConfig,
  type FeatureConfig,
} from "@/lib/ai/feature-router";
import type { AIFeature } from "@/lib/ai/feature-definitions";

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
