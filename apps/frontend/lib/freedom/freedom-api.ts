// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

/**
 * Freedom Panel API Client
 * Wraps the existing AI infrastructure for single-shot generation
 * Features: smart endpoint routing, retry with exponential backoff
 */

import {
  getAllFeatureConfigs,
  getFeatureNotConfiguredMessage,
  type FeatureConfig,
} from '@/lib/ai/feature-router';
import {
  buildOpenAIImageRequestBody,
  buildProviderExtensionImageRequestBody,
  extractImageGenerationResult,
  isGptImageModel,
  normalizeImagePromptForGeneration,
  sdkGenerateImage,
} from '@/lib/ai/ai-sdk-bridge';
import { createOperationId, logEvent } from '@/lib/diagnostics/logger';
import { isVeoModel, resolveVeoUploadCapability } from '@/lib/freedom/veo-capability';
import { useAPIConfigStore } from '@/stores/api-config-store';
import { useAppSettingsStore } from '@/stores/app-settings-store';
import { getImageSizeLabel } from '@/lib/ai/image-size-presets';
import {
  buildCompatibilityImagePrompt,
  shouldRetryImageCompatibility,
} from '@/lib/ai/image-compatibility';
import { prepareReferenceImagesForTransfer } from '@/lib/ai/image-transfer';
import { toRunwayRatio, toSoraSize, toVeoOpenAIVideoSize } from '@/lib/ai/video-request-sizing';
import { toast } from 'sonner';
import { freedomRetry } from './freedom-retry';
import {
  groupVideoUploadFiles,
  validateVeoVideoUploads,
  type FreedomVideoUploadFile,
} from './video-upload-validation';
import {
  buildFreedomEndpoint as buildEndpoint,
  extractFreedomImageUrl as extractImageUrl,
  extractFreedomVideoUrl as extractVideoUrl,
  freedomObservedFetch,
  getFreedomRootBaseUrl as getRootBaseUrl,
  pollForFreedomResult as pollForResult,
  toUploadBlob,
  toUploadHttpUrl,
} from './freedom-transport';
import {
  DEFAULT_IMAGE_ENDPOINT,
  detectFreedomImageRoute,
  detectFreedomVideoRoute,
  getImageEndpointPaths,
  getUnifiedEndpointPaths,
  resolveFreedomFeatureConfig,
} from './freedom-routing';
import { generateFreedomImageViaChat } from './freedom-image-chat';
import { generateVideoViaReplicate } from './freedom-replicate-video';
import { runFreedomVideoRoute } from './freedom-video-dispatch';
import {
  generateViaIdeogramEndpoint,
  generateViaKlingImageEndpoint,
  generateViaMidjourneyEndpoint,
  generateViaReplicateImageEndpoint,
} from './freedom-image-provider-adapters';
import { saveFreedomImage, saveToMediaLibrary } from './freedom-media';
import {
  generateVideoViaKling,
  generateVideoViaOpenAIOfficial,
  generateVideoViaUnified,
  generateVideoViaVolc,
  generateVideoViaWan,
} from './freedom-video-provider-adapters';
import type { FreedomImageParams, FreedomVideoParams, GenerationResult } from './freedom-types';

export type { FreedomImageParams, FreedomVideoParams, GenerationResult } from './freedom-types';

export type { FreedomVideoUploadFile, FreedomVideoUploadRole } from './video-upload-validation';

// ==================== Constants ====================

const IMAGE_POLL_INTERVAL = 2000;
const IMAGE_POLL_MAX_ATTEMPTS = 60;
const VIDEO_POLL_INTERVAL = 2000;
const VIDEO_POLL_MAX_ATTEMPTS = 120;

// ==================== Retry Logic ====================

function throwImageSdkError(result: { error?: string; status?: number }, fallbackMessage: string): never {
  const message = result.error || fallbackMessage;
  if (typeof result.status === 'number') {
    throw toHttpError(message, result.status, message);
  }
  throw new Error(message);
}

function withGlobalImageSizeDefaults(params: FreedomImageParams): FreedomImageParams {
  const imageSettings = useAppSettingsStore.getState().imageGenerationSettings;
  return {
    ...params,
    aspectRatio: params.aspectRatio || imageSettings.defaultAspectRatio,
    resolution: params.resolution || imageSettings.defaultResolution,
  };
}

// ==================== Image Generation ====================

export async function generateFreedomImage(
  params: FreedomImageParams
): Promise<GenerationResult> {
  const operationId = createOperationId('freedom-image');
  const normalizedPrompt = normalizeImagePromptForGeneration({
    prompt: params.prompt,
    negativePrompt: params.negativePrompt,
  });
  const generationParams: FreedomImageParams = {
    ...params,
    prompt: normalizedPrompt.prompt,
    negativePrompt: normalizedPrompt.negativePrompt,
    referenceImages: await prepareReferenceImagesForTransfer(params.referenceImages),
  };
  // 收集所有图片相关功能绑定的 provider，合并去重
  const seen = new Set<string>();
  const fallbackConfigs: FeatureConfig[] = [];
  for (const feature of ['freedom_image', 'character_generation', 'scene_generation'] as const) {
    for (const cfg of getAllFeatureConfigs(feature)) {
      const key = cfg.provider.id + ':' + cfg.baseUrl;
      if (seen.has(key)) continue;
      seen.add(key);
      fallbackConfigs.push(cfg);
    }
  }

  if (fallbackConfigs.length === 0) {
    throw new Error('图片生成未配置：请在设置中配置服务');
  }

  let lastError: Error | null = null;
  for (const cfg of fallbackConfigs) {
    try {
      return await freedomRetry(
        () => _generateFreedomImageInner(generationParams, cfg, operationId),
        'Image generation',
        cfg.keyManager,
      );
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      console.warn(`[Freedom] Provider ${cfg.provider.name} (${cfg.baseUrl}) failed:`, lastError.message);
    }
  }

  throw lastError!;
}

async function _generateFreedomImageInner(
  params: FreedomImageParams,
  overrideConfig?: FeatureConfig,
  operationId?: string,
): Promise<GenerationResult> {
  params = withGlobalImageSizeDefaults(params);
  let config: FeatureConfig | null;
  let configSource: string;
  if (overrideConfig) {
    config = overrideConfig;
    configSource = `override (${overrideConfig.provider.name})`;
  } else {
    const resolved = resolveFreedomFeatureConfig('freedom_image', 'character_generation', params.model);
    config = resolved.config;
    configSource = resolved.source;
  }
  if (!config) {
    const msg = getFeatureNotConfiguredMessage('character_generation');
    toast.error('自由板块图片生成未配置：请在设置中配置「自由板块-图片」或「图片生成」服务映射');
    throw new Error(msg);
  }
  console.log(`[Freedom] Image config source: ${configSource}`);

  const { baseUrl, model: defaultModel } = config;
  // 每次重试动态取当前 key（利用 keyManager rotate 后的新 key）
  const apiKey = config.keyManager?.getCurrentKey?.() || config.apiKey;
  // 模型 ID 直接透传：UI 选的就是供应商原始 ID，无需转换
  const model = params.model || defaultModel;
  const normalizedBase = baseUrl.replace(/\/+$/, '');

  // ── Smart Routing: choose endpoint based on model metadata ──
  const endpointTypes = useAPIConfigStore.getState().modelEndpointTypes[model];
  const route = detectFreedomImageRoute(model, endpointTypes);

  console.log('[Freedom] Generating image:', {
    model,
    route,
    endpointTypes,
    prompt: params.prompt.slice(0, 50),
  });
  if (route === 'midjourney') {
    return await generateViaMidjourneyEndpoint(params, model, apiKey, normalizedBase, saveFreedomImage);
  }
  if (route === 'ideogram') {
    return await generateViaIdeogramEndpoint(params, model, apiKey, normalizedBase, saveFreedomImage);
  }
  if (route === 'openai_chat') {
    return await generateFreedomImageViaChat(
      params,
      model,
      apiKey,
      normalizedBase,
      (url, prompt) => saveToMediaLibrary(url, prompt, 'ai-image'),
      operationId,
    );
  }
  if (route === 'kling_image') {
    return await generateViaKlingImageEndpoint(
      params,
      model,
      apiKey,
      normalizedBase,
      () => generateViaImagesEndpoint(params, model, apiKey, normalizedBase),
      saveFreedomImage,
    );
  }
  if (route === 'replicate') {
    return await generateViaReplicateImageEndpoint(params, model, apiKey, normalizedBase, saveFreedomImage);
  }
  return await generateViaImagesEndpoint(params, model, apiKey, normalizedBase, endpointTypes, operationId, config.provider);
}

/**
 * Generate image via standard /v1/images/generations endpoint
 */
async function generateViaImagesEndpoint(
  params: FreedomImageParams,
  model: string,
  apiKey: string,
  baseUrl: string,
  endpointTypes?: string[],
  operationId?: string,
  provider?: Pick<FeatureConfig['provider'], 'id' | 'platform' | 'name' | 'baseUrl' | 'apiKey'>,
): Promise<GenerationResult> {
  const imagePaths = getImageEndpointPaths(endpointTypes || []);
  const rootBase = getRootBaseUrl(baseUrl);
  const submitUrl = `${rootBase}${imagePaths.submit}`;
  const usesDefaultImagesEndpoint = imagePaths.submit === DEFAULT_IMAGE_ENDPOINT.submit;
  const builtRequest = usesDefaultImagesEndpoint
    ? buildOpenAIImageRequestBody({
        model,
        prompt: params.prompt,
        aspectRatio: params.aspectRatio,
        resolution: params.resolution,
        width: params.width,
        height: params.height,
        negativePrompt: params.negativePrompt,
        referenceImages: params.referenceImages,
        extraParams: params.extraParams,
      })
    : buildProviderExtensionImageRequestBody({
        model,
        prompt: params.prompt,
        aspectRatio: params.aspectRatio,
        resolution: params.resolution,
        width: params.width,
        height: params.height,
        negativePrompt: params.negativePrompt,
        referenceImages: params.referenceImages,
        extraParams: params.extraParams,
      });
  const body = builtRequest.body;
  const imageSettings = useAppSettingsStore.getState().imageGenerationSettings;
  if (usesDefaultImagesEndpoint && isGptImageModel(model) && provider) {
    const sdkResult = await sdkGenerateImage({
      provider: { ...provider, apiKey, baseUrl },
      model,
      prompt: params.prompt,
      aspectRatio: params.aspectRatio,
      resolution: params.resolution,
      width: params.width,
      height: params.height,
      negativePrompt: params.negativePrompt,
      referenceImages: params.referenceImages,
      extraParams: params.extraParams,
      operationId,
      endpointFamily: 'freedom-image',
      abortSignal: params.signal,
      maxRetries: 2,
    });
    if (!sdkResult.success || !sdkResult.imageUrl) {
      if (imageSettings.compatibilityRetryEnabled && shouldRetryImageCompatibility(sdkResult)) {
        const compatibilityPrompt = buildCompatibilityImagePrompt(params.prompt);
        await logEvent({
          level: 'warn',
          category: 'ai',
          operationId,
          message: 'Image generation compatibility retry started',
          context: {
            endpointFamily: 'freedom-image',
            providerId: provider.id,
            providerName: provider.name,
            model,
            reason: sdkResult.error,
            status: sdkResult.status,
            originalSize: sdkResult.size,
            retrySize: getImageSizeLabel({
              aspectRatio: imageSettings.compatibilityRetryAspectRatio,
              resolution: imageSettings.compatibilityRetryResolution,
            }),
            originalPromptLength: params.prompt.length,
            retryPromptLength: compatibilityPrompt.length,
          },
        });
        const compatibilityResult = await sdkGenerateImage({
          provider: { ...provider, apiKey, baseUrl },
          model,
          prompt: compatibilityPrompt,
          aspectRatio: imageSettings.compatibilityRetryAspectRatio,
          resolution: imageSettings.compatibilityRetryResolution,
          negativePrompt: params.negativePrompt,
          referenceImages: params.referenceImages,
          extraParams: params.extraParams,
          operationId,
          endpointFamily: 'freedom-image',
          abortSignal: params.signal,
          maxRetries: 0,
        });
        if (compatibilityResult.success && compatibilityResult.imageUrl) {
          await logEvent({
            level: 'info',
            category: 'ai',
            operationId,
            message: 'Image generation compatibility retry completed',
            context: {
              endpointFamily: 'freedom-image',
              providerId: provider.id,
              providerName: provider.name,
              model,
              retrySize: compatibilityResult.size,
              templateName: compatibilityResult.templateName,
            },
          });
          const mediaId = saveToMediaLibrary(compatibilityResult.imageUrl, params.prompt, 'ai-image');
          return { url: compatibilityResult.imageUrl, mediaId };
        }
        await logEvent({
          level: 'warn',
          category: 'ai',
          operationId,
          message: 'Image generation compatibility retry failed',
          context: {
            endpointFamily: 'freedom-image',
            providerId: provider.id,
            providerName: provider.name,
            model,
            status: compatibilityResult.status,
            error: compatibilityResult.error,
          },
        });
      }
      throwImageSdkError(sdkResult, 'AI SDK 图片生成失败');
    }
    const mediaId = saveToMediaLibrary(sdkResult.imageUrl, params.prompt, 'ai-image');
    return { url: sdkResult.imageUrl, mediaId };
  }

  const response = await freedomObservedFetch(submitUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    signal: params.signal,
  }, {
    operationId,
    endpointFamily: 'freedom-image',
    model,
    templateName: builtRequest.templateName,
  });

  if (!response.ok) {
    const errText = await response.text();
    throw toHttpError('Image generation failed', response.status, errText);
  }

  const data = await response.json();

  // Try to get image URL directly
  const extracted = extractImageGenerationResult(data);
  let imageUrl = extracted.imageUrl || extractImageUrl(data);
  const taskId = extracted.taskId || data.task_id;

  // If async task, poll for result
  if (!imageUrl && taskId) {
    const pollUrl = `${rootBase}${imagePaths.poll(String(taskId))}`;
    imageUrl = await pollForResult(
      pollUrl,
      apiKey,
      IMAGE_POLL_INTERVAL,
      IMAGE_POLL_MAX_ATTEMPTS,
      operationId,
      String(taskId),
    );
  }

  if (!imageUrl) {
    throw new Error('No image URL in response');
  }

  const mediaId = saveToMediaLibrary(imageUrl, params.prompt, 'ai-image');
  return { url: imageUrl, taskId: taskId ? String(taskId) : undefined, mediaId };
}

/**
 * Resolve kling model name for API requests.
 * Composite IDs like 'kling-image-v1-5' → 'kling-v1-5' (MemeFast version ID).
 * Video version IDs (kling-v2-6) pass through unchanged.
 */
function toHttpError(prefix: string, status: number, body: string): Error & { status: number } {
  const err = new Error(`${prefix}: ${status} ${body}`) as Error & { status: number };
  err.status = status;
  return err;
}

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
  const { config, source: configSource } = resolveFreedomFeatureConfig(
    'freedom_video',
    'video_generation',
    params.model,
  );
  if (!config) {
    const msg = getFeatureNotConfiguredMessage('video_generation');
    toast.error('自由板块视频生成未配置：请在设置中配置「自由板块-视频」或「视频生成」服务映射');
    throw new Error(msg);
  }
  console.log(`[Freedom] Video config source: ${configSource}`);

  const { baseUrl, model: defaultModel } = config;
  // 每次重试动态取当前 key（利用 keyManager rotate 后的新 key）
  const apiKey = config.keyManager?.getCurrentKey?.() || config.apiKey;
  // 模型 ID 直接透传：UI 选的就是供应商原始 ID，无需转换
  const model = params.model || defaultModel;

  const endpointTypes = useAPIConfigStore.getState().modelEndpointTypes[model];
  const route = detectFreedomVideoRoute(model, endpointTypes);
  console.log('[Freedom] Generating video:', {
    model,
    route,
    endpointTypes,
    prompt: params.prompt.slice(0, 50),
  });

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
