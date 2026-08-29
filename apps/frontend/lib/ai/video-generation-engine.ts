// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

/**
 * 视频生成引擎(智能路由 + 渠道适配)。
 *
 * 分层定位(2026-08-29 迁自 lib/assist/freedom-api.ts,08-28-freedom-image-engine-rename
 * 二期):渠道/引擎层,与 image-generation-engine 同层;消费方 ai-manager 门面 →
 * 自由面板视频。公共入口 generateVideo(原 generateFreedomVideo,随批次 C 口径正名)。
 */
import { getFeatureNotConfiguredMessage } from '@/lib/ai/feature-router';
import { getModelEndpointTypes } from '@/lib/ai/config/store-adapter';
import { toast } from 'sonner';
import { freedomRetry } from '@/lib/ai/generation-retry';
import { resolveFreedomFeatureConfig } from '@/lib/ai/generation-feature-config';
import { detectFreedomVideoRoute } from './video-routing';
import { generateVideoViaReplicate } from './video-channel-replicate';
import { runFreedomVideoRoute } from './video-channel-dispatch';
import {
  generateVideoViaKling,
  generateVideoViaOpenAIOfficial,
  generateVideoViaUnified,
  generateVideoViaVolc,
  generateVideoViaWan,
} from './video-channel-adapters';
import { saveToMediaLibrary } from '@/lib/ai/generation-media';
import type { FreedomVideoParams, GenerationResult } from './generation-types';

// ==================== Video Generation ====================
export async function generateVideo(
  params: FreedomVideoParams
): Promise<GenerationResult> {
  const { config } = resolveFreedomFeatureConfig('freedom_video', 'video_generation', params.model);
  return freedomRetry(() => _generateVideoInner(params), 'Video generation', config?.keyManager);
}

async function _generateVideoInner(
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
