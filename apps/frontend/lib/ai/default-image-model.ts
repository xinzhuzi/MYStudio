// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
/**
 * 默认生图模型解析(09-12 生图路由设置,Trellis 09-12-image-gen-routing-setting)。
 *
 * 生图引擎按模型名路由(image-generation-engine):本地模型只走本地 sidecar,
 * 云端模型走归属渠道。工作流装配不带 model(历史现状)→请求层兜底本默认;
 * 存量空 model 工作流由此自动跟随设置(Q2a 裁定:空=吃默认)。
 */
import { useAppSettingsStore } from "@/stores/app/app-settings-store";
import { LOCAL_IMAGE_MODELS } from "@/stores/ai/api-config-provider-helpers";
import { getAIConfigStore } from "@/lib/ai/config/store-adapter";

/** 工作流未显式指定模型时的默认生图模型;设置空串=跟随渠道链(返回 undefined)。 */
export function resolveDefaultImageModel(): string | undefined {
  return useAppSettingsStore.getState().imageGenerationSettings.defaultImageModel.trim() || undefined;
}

/**
 * Q3a 报错指路(09-12 用户裁定):设置里选了云端模型但没有任何渠道认领(未绑定
 * 或未填 Key)时,不静默落渠道链——链首是本地 sidecar,等于悄悄换引擎,付费
 * 口径与用户意图不一致。直接抛错指路「设置 → 接口配置」。
 * 本地模型豁免(本地 sidecar 常驻免配置);显式写在节点上的模型不走此守卫
 * (保留旧的渠道链兜底语义,只约束本设置的新路径)。
 */
export function assertDefaultImageModelConfigured(model: string | undefined): void {
  if (!model) return;
  if ((LOCAL_IMAGE_MODELS as readonly string[]).includes(model)) return;
  const providers = getAIConfigStore().providers ?? [];
  const owned = providers.some(
    (provider) => (provider.model ?? []).includes(model) && Boolean((provider.apiKey ?? "").trim()),
  );
  if (!owned) {
    throw new Error(
      `云端生图模型 ${model} 尚未配置可用渠道：请到「设置 → 接口配置」绑定该模型并填入 API Key，或把生图引擎切回本地模型（免费）`,
    );
  }
}
