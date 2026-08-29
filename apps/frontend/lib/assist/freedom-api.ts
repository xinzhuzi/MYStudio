// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

/**
 * 自由面板视频生成客户端(08-28-freedom-image-engine-rename 批次 A 拆分):
 * 生图引擎已整体迁 lib/ai/image-generation-engine.ts,此处保留——
 *   1. generateFreedomVideo(视频生成,二期正名迁出)
 *   2. 旧符号再导出(generateFreedomImage 等),ai-manager/面板零改动;
 *      批次 C 公共名统一改为 generateImage 后移除。
 */
import { getFeatureNotConfiguredMessage } from '@/lib/ai/feature-router';
import { getModelEndpointTypes } from '@/lib/ai/config/store-adapter';
import { toast } from 'sonner';
import { freedomRetry } from '@/lib/ai/generation-retry';
import { resolveFreedomFeatureConfig } from '@/lib/ai/generation-feature-config';
import { detectFreedomVideoRoute } from './freedom-routing';
import { generateVideoViaReplicate } from './freedom-replicate-video';
import { runFreedomVideoRoute } from './freedom-video-dispatch';
import {
  generateVideoViaKling,
  generateVideoViaOpenAIOfficial,
  generateVideoViaUnified,
  generateVideoViaVolc,
  generateVideoViaWan,
} from './freedom-video-provider-adapters';
import { saveToMediaLibrary } from '@/lib/ai/generation-media';
import type { FreedomVideoParams, GenerationResult } from './freedom-types';

// ── 旧符号兼容再导出(批次 C 正名后移除)──
export { generateImage as generateFreedomImage } from '@/lib/ai/image-generation-engine';
export type { FreedomImageParams, GenerationResult } from '@/lib/ai/generation-types';
export type { FreedomVideoUploadFile, FreedomVideoUploadRole } from './video-upload-validation';

// ==================== Video Generation ====================
export async function generateFreedomVideo(
  params: FreedomVideoParams
): Promise<GenerationResult> {
  const { config } = resolveFreedomFeatureConfig('freedom_video', 'video_generation', params.model);
  return freedomRetry(() => _generateFreedomVideoInner(params), 'Video generation', config?.keyManager);
}

async function _generateFreedomVideoInner(
  params: FreedomVideoParams
): Promise<GenerationResult> {
  const { config } = resolveFreedomFeatureConfig(
    'freedom_video',
    'video_generation',
    params.model,
  );
  if (!config) {
    const msg = getFeatureNotConfiguredMessage('video_generation');
    toast.error('自由板块视频生成未配置：请在设置中配置「自由板块-视频」或「视频生成」服务映射');
    throw new Error(msg);
  }

  const { baseUrl, model: defaultModel } = config;
  // 每次重试动态取当前 key（利用 keyManager rotate 后的新 key）
  const apiKey = config.keyManager?.getCurrentKey?.() || config.apiKey;
  // 模型 ID 直接透传：UI 选的就是供应商原始 ID，无需转换
  const model = params.model || defaultModel;

  const endpointTypes = getModelEndpointTypes(model);
  const route = detectFreedomVideoRoute(model, endpointTypes);

  const result = await runFreedomVideoRoute(route, {
    openai_official: generateVideoViaOpenAIOfficial,
    unified: generateVideoViaUnified,
    volc: generateVideoViaVolc,
    wan: generateVideoViaWan,
    kling: generateVideoViaKling,
    replicate: generateVideoViaReplicate,
  }, params, model, apiKey, baseUrl);

  const mediaId = saveToMediaLibrary(result.url, params.prompt, 'ai-video');
  return { ...result, mediaId };
}
