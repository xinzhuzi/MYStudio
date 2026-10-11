/**
 * scriptAsset 成本护栏纯逻辑(10-11 pipeline-human-node-automation 批2,G7/G16):
 * - 渠道估价:按生图功能绑定(character/scene/prop_generation)解析首绑通道,
 *   `${providerId}:${model}` → 估价表单价;纯本地通道(manying-local-image)恒 ¥0;
 * - fail-closed 护栏:发车前预估(张数×估价)+逐张开检,累计+本张>上限→不发
 *   (已完成不回滚);免费通道恒放行;
 * 计数口径=张数×静态估价表(G16 裁定,token 口径漏算异步 job 计费禁用)。
 * 估价是计划口径(按首绑通道),本地失败回落云端的实烧由跑完报表的
 * 「未估价/对账」提示兜底(数据源 diagnostics jsonl,后续批校准)。
 */
import { getAIConfigStore } from "@/lib/ai/config/store-adapter";
import type { AIFeature } from "@/lib/ai/feature-definitions";
import { DEFAULT_LOCAL_IMAGE_PROVIDER_ID } from "@/stores/ai/api-config-provider-helpers";

/** 资产生成三类行 → 生图功能绑定键(与 image-generator 取用同源)。 */
export const SCRIPT_ASSET_IMAGE_FEATURES = {
  character: "character_generation",
  scene: "scene_generation",
  prop: "prop_generation",
} as const;

export type ScriptAssetGenerationType = keyof typeof SCRIPT_ASSET_IMAGE_FEATURES;

export interface ImageChannelEstimate {
  /** 功能绑定键(character_generation 等)。 */
  feature: AIFeature;
  /** 绑定键(与估价表键同形):`${providerId}:${model}`。 */
  key: string;
  providerId: string;
  providerLabel: string;
  model: string;
  /** 纯本地通道(Q2.1 sidecar)恒 true,零计费。 */
  isLocal: boolean;
  /** 元/张;本地/未估价云端=0(区分见 priced)。 */
  priceCny: number;
  /** 估价表命中(本地通道恒 true:法定零价,不算未估价)。 */
  priced: boolean;
}

/** 纯本地生图通道判定(Q2.1 sidecar,provider id/platform 双口径)。 */
export function isLocalImageChannel(providerId: string, platform?: string): boolean {
  return (
    providerId === DEFAULT_LOCAL_IMAGE_PROVIDER_ID ||
    platform === DEFAULT_LOCAL_IMAGE_PROVIDER_ID
  );
}

/**
 * 解析功能的首绑通道估价(有序绑定第 1 条=优先通道;不触发
 * feature-router 的多模型轮询游标,预测与实发不串位)。未绑定返回 null。
 */
export function estimateImageChannel(
  feature: AIFeature,
  prices: Record<string, number>,
): ImageChannelEstimate | null {
  const providers = getAIConfigStore().getProvidersForFeature(feature);
  const primary = providers[0];
  if (!primary) return null;
  const providerId = primary.provider.id;
  const model = primary.model;
  const isLocal = isLocalImageChannel(providerId, primary.provider.platform);
  const key = `${providerId}:${model}`;
  const tablePrice = prices[key];
  const priced = isLocal || (typeof tablePrice === "number" && tablePrice >= 0);
  return {
    feature,
    key,
    providerId,
    providerLabel: primary.provider.name || providerId,
    model,
    isLocal,
    priceCny: isLocal ? 0 : priced ? tablePrice : 0,
    priced,
  };
}

/** 渠道分布/报表用的展示标签。 */
export function channelEstimateLabel(channel: ImageChannelEstimate): string {
  return channel.isLocal
    ? `本地:${channel.model}`
    : `${channel.providerLabel}:${channel.model}`;
}

/**
 * fail-closed 发车门:累计已发车成本 + 本张估价 ≤ 单章上限才放行。
 * 免费通道(本地/¥0)恒放行;上限 0=只允许免费通道。浮点容差 1e-9。
 */
export function costGuardAllowsDispatch(
  spentCny: number,
  nextCostCny: number,
  capCny: number,
): boolean {
  if (nextCostCny <= 0) return true;
  return spentCny + nextCostCny <= capCny + 1e-9;
}

/** 金额两位小数展示(¥)。 */
export function formatCny(value: number): string {
  return `¥${(Math.round(value * 100) / 100).toFixed(2)}`;
}
