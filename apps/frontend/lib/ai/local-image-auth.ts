// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

/**
 * 本地图片通道装机随机令牌替换(0924 安全收口 H5;1011 断点A 提升共享)。
 *
 * 本地 provider 的 apiKey 只是非空占位(见 api-config-provider-helpers),
 * 真实令牌每装机随机、经 imageGenRuntime 桥按需取、不落 localStorage。
 * keyManager 换成单键真令牌管理器——请求侧按 getCurrentKey()||apiKey 取值,
 * 不换管理器会被占位键盖掉;单键即无换 key 轮转,与本地链 skipFreedomRetry
 * 语义一致。取不到令牌(非 Electron/桥缺席)保留占位,由 sidecar fail-closed
 * 兜底(17595 对占位 apiKey 返 403 invalid_local_token)。
 *
 * 这是替换逻辑的唯一实现(1011 用户口径:禁新增第二套),本地图片双口共用:
 * - 自由生图口:image-generation-engine.generateImage 本地链(0924 原址迁入);
 * - feature 资产口:image-generator-core.generateImage(character/scene/prop,
 *   1011 断点A:T2 装机实弹——feature 口此前不过替换,占位键被 sidecar 拒)。
 * 其余直连 sidecar 的链路(comfy 桥/uncloth)仍各自经 local-image-token
 * 取令牌组头,不经 FeatureConfig,不在此列。
 */
import { getLocalImageToken } from '@/lib/assist/image-studio/local-image-token';
import { isLocalImageProvider } from '@/stores/ai/api-config-provider-helpers';
import { ApiKeyManager } from '@/lib/ai/core';
import type { FeatureConfig } from '@/lib/ai/feature-router';

/**
 * 把链内本地 provider 的占位 apiKey/keyManager 原位替换为装机随机真令牌。
 * configs 须是每次调用新建的 FeatureConfig(feature-router 每次解析都是新
 * 对象),避免污染 keyManager 全局缓存;非本地条目原样不动。
 */
export async function applyLocalImageTokenToConfigs(configs: FeatureConfig[]): Promise<void> {
  if (!configs.some((cfg) => isLocalImageProvider(cfg.provider))) return;
  const token = await getLocalImageToken();
  if (!token) return;
  for (const cfg of configs) {
    if (!isLocalImageProvider(cfg.provider)) continue;
    cfg.apiKey = token;
    cfg.allApiKeys = [token];
    cfg.keyManager = new ApiKeyManager(token);
  }
}
