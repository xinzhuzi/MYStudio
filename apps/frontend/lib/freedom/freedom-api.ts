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
import { useMediaStore } from '@/stores/media-store';
import { useProjectStore } from '@/stores/project-store';
import { getImageSizeLabel } from '@/lib/ai/image-size-presets';
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

export type { FreedomVideoUploadFile, FreedomVideoUploadRole } from './video-upload-validation';

// ==================== Types ====================

export interface FreedomImageParams {
  prompt: string;
  model?: string;
  aspectRatio?: string;
  resolution?: string;
  width?: number;
  height?: number;
  negativePrompt?: string;
  referenceImages?: string[];
  extraParams?: Record<string, any>;
  signal?: AbortSignal;
}

export interface FreedomVideoParams {
  prompt: string;
  model?: string;
  aspectRatio?: string;
  duration?: number;
  resolution?: string;
  uploadFiles?: FreedomVideoUploadFile[];
}

export interface GenerationResult {
  url: string;
  taskId?: string;
  mediaId?: string;
}

// ==================== Constants ====================

const IMAGE_POLL_INTERVAL = 2000;
const IMAGE_POLL_MAX_ATTEMPTS = 60;
const VIDEO_POLL_INTERVAL = 2000;
const VIDEO_POLL_MAX_ATTEMPTS = 120;
const IMAGE_COMPATIBILITY_PROMPT_LIMIT = 180;

// ==================== Retry Logic ====================

function shouldRetryImageCompatibility(result: { error?: string; status?: number }) {
  if (typeof result.status === 'number') {
    return [408, 502, 503, 504, 520, 522, 524].includes(result.status);
  }

  const message = (result.error || '').toLowerCase();
  return (
    message.includes('fetch failed') ||
    message.includes('failed to fetch') ||
    message.includes('socket') ||
    message.includes('timeout') ||
    message.includes('timed out') ||
    message.includes('api 请求超时') ||
    message.includes('network') ||
    message.includes('aborted')
  );
}

function throwImageSdkError(result: { error?: string; status?: number }, fallbackMessage: string): never {
  const message = result.error || fallbackMessage;
  if (typeof result.status === 'number') {
    throw toHttpError(message, result.status, message);
  }
  throw new Error(message);
}

function buildCompatibilityImagePrompt(prompt: string) {
  const normalized = prompt.replace(/\s+/g, ' ').trim();
  if (normalized.length <= IMAGE_COMPATIBILITY_PROMPT_LIMIT) {
    return normalizeImagePromptForGeneration({ prompt: normalized }).prompt;
  }

  const compact = normalized
    .replace(/\s*\+\s*/g, '，')
    .slice(0, IMAGE_COMPATIBILITY_PROMPT_LIMIT)
    .replace(/[，,;；:：、\s]+$/, '');
  return normalizeImagePromptForGeneration({
    prompt: `${compact}。主体完整，构图简洁，细节清晰，避免文字和水印。`,
  }).prompt;
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
  };
  // 收集所有图片相关功能绑定的 provider，合并去重
  const seen = new Set<string>();
  const fallbackConfigs: FeatureConfig[] = [];
  for (const feature of ['freedom_image', 'character_generation', 'scene_generation'] as const) {
    for (const cfg of getAllFeatureConfigs(feature as any)) {
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
    return await generateViaMidjourneyEndpoint(params, model, apiKey, normalizedBase);
  }
  if (route === 'ideogram') {
    return await generateViaIdeogramEndpoint(params, model, apiKey, normalizedBase);
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
    return await generateViaKlingImagesEndpoint(params, model, apiKey, normalizedBase);
  }
  if (route === 'replicate') {
    return await generateViaReplicateImageEndpoint(params, model, apiKey, normalizedBase);
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
function resolveKlingModelName(model: string): string {
  const match = model.match(/^kling-image-(v.+)$/);
  return match ? `kling-${match[1]}` : model;
}

/**
 * Generate image via Kling's native /kling/v1/images/* endpoints
 * Falls back to standard /v1/images/generations if native endpoint fails
 */
async function generateViaKlingImagesEndpoint(
  params: FreedomImageParams,
  model: string,
  apiKey: string,
  baseUrl: string,
): Promise<GenerationResult> {
  const rootBase = getRootBaseUrl(baseUrl);
  const nativePath = model === 'kling-omni-image'
    ? 'kling/v1/images/omni-image'
    : 'kling/v1/images/generations';

  const body: Record<string, any> = { prompt: params.prompt, model: resolveKlingModelName(model) };
  if (params.aspectRatio) body.aspect_ratio = params.aspectRatio;
  if (params.negativePrompt) body.negative_prompt = params.negativePrompt;
  if (params.referenceImages?.length) body.image_urls = params.referenceImages;
  if (params.extraParams) Object.assign(body, params.extraParams);

  let response: Response;
  try {
    response = await freedomObservedFetch(`${rootBase}/${nativePath}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify(body),
      signal: params.signal,
    });
  } catch {
    return generateViaImagesEndpoint(params, model, apiKey, baseUrl);
  }

  if (!response.ok) {
    return generateViaImagesEndpoint(params, model, apiKey, baseUrl);
  }

  const data = await response.json();
  let imageUrl = extractImageUrl(data);

  if (!imageUrl && data.task_id) {
    imageUrl = await pollForResult(
      `${rootBase}/${nativePath}/${data.task_id}`,
      apiKey,
      IMAGE_POLL_INTERVAL,
      IMAGE_POLL_MAX_ATTEMPTS,
    );
  }

  if (!imageUrl) {
    return generateViaImagesEndpoint(params, model, apiKey, baseUrl);
  }

  const mediaId = saveToMediaLibrary(imageUrl, params.prompt, 'ai-image');
  return { url: imageUrl, taskId: data.task_id, mediaId };
}

function toHttpError(prefix: string, status: number, body: string): Error & { status: number } {
  const err = new Error(`${prefix}: ${status} ${body}`) as Error & { status: number };
  err.status = status;
  return err;
}

function buildMidjourneyPrompt(params: FreedomImageParams): string {
  let prompt = params.prompt;
  const extra = params.extraParams || {};
  const aspect = params.aspectRatio;
  const stylization = typeof extra.stylization === 'number' ? extra.stylization : undefined;
  const weirdness = typeof extra.weirdness === 'number' ? extra.weirdness : undefined;

  if (aspect && !/\s--ar\s+\S+/i.test(prompt)) {
    prompt += ` --ar ${aspect}`;
  }
  if (stylization !== undefined && !/\s--s(tylize)?\s+\S+/i.test(prompt)) {
    prompt += ` --s ${stylization}`;
  }
  if (weirdness !== undefined && !/\s--weird\s+\S+/i.test(prompt)) {
    prompt += ` --weird ${weirdness}`;
  }
  return prompt;
}

function mapMidjourneyMode(speed: unknown): string[] | undefined {
  if (typeof speed !== 'string') return undefined;
  const normalized = speed.toLowerCase();
  if (normalized === 'relaxed') return ['RELAX'];
  if (normalized === 'fast') return ['FAST'];
  if (normalized === 'turbo') return ['TURBO'];
  return undefined;
}

async function generateViaMidjourneyEndpoint(
  params: FreedomImageParams,
  model: string,
  apiKey: string,
  baseUrl: string,
): Promise<GenerationResult> {
  const rootBase = getRootBaseUrl(baseUrl);
  const submitUrl = `${rootBase}/mj/submit/imagine`;
  const extra = params.extraParams || {};
  const requestBody: Record<string, any> = {
    prompt: buildMidjourneyPrompt(params),
  };
  const modes = mapMidjourneyMode(extra.speed);
  if (modes) requestBody.accountFilter = { modes };
  if (/niji/i.test(model)) requestBody.botType = 'NIJI_JOURNEY';
  // 垫图：base64Array（图片引导，格式 data:image/png;base64,xxx）
  if (Array.isArray(extra.base64Array) && extra.base64Array.length > 0) {
    requestBody.base64Array = extra.base64Array;
  }

  const submitResp = await freedomObservedFetch(submitUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(requestBody),
  });
  if (!submitResp.ok) {
    throw toHttpError('Midjourney submit failed', submitResp.status, await submitResp.text());
  }

  const submitData = await submitResp.json();
  // MJ API 成功时 code === 1；其他值表示 API 层错误（即使 HTTP 200）
  if (submitData.code !== undefined && submitData.code !== 1) {
    throw new Error(submitData.description || submitData.error || `Midjourney 提交失败 (code=${submitData.code})`);
  }
  const taskId = submitData.result || submitData.task_id || submitData.id;
  if (!taskId) throw new Error('Midjourney 返回空任务 ID');

  const pollUrl = `${rootBase}/mj/task/${taskId}/fetch`;
  for (let i = 0; i < IMAGE_POLL_MAX_ATTEMPTS; i++) {
    await new Promise((r) => setTimeout(r, 2500));
    const pollResp = await freedomObservedFetch(pollUrl, {
      headers: { 'Authorization': `Bearer ${apiKey}` },
    });
    if (!pollResp.ok) continue;
    const pollData = await pollResp.json();
    const status = String(pollData.status || '').toLowerCase();
    if (status === 'success' || status === 'succeeded' || status === 'completed') {
      const imageUrl =
        pollData.imageUrl ||
        pollData.image_url ||
        pollData.url ||
        pollData.data?.imageUrl ||
        pollData.data?.image_url;
      if (!imageUrl) throw new Error('Midjourney 成功但未返回图片 URL');
      const mediaId = saveToMediaLibrary(imageUrl, params.prompt, 'ai-image');
      return { url: imageUrl, taskId: String(taskId), mediaId };
    }
    if (status === 'failure' || status === 'failed' || status === 'error') {
      throw new Error(pollData.failReason || pollData.message || 'Midjourney 生成失败');
    }
  }

  throw new Error('Midjourney 生成超时');
}

function toIdeogramAspectRatio(model: string, aspectRatio?: string): string | undefined {
  if (!aspectRatio) return undefined;

  // V1/V2 使用 ASPECT_16_9；V3 使用 16x9
  if (/_V_[12](_|$)/i.test(model)) {
    return `ASPECT_${aspectRatio.replace(':', '_')}`;
  }
  return aspectRatio.replace(':', 'x');
}

function toIdeogramRenderSpeed(input: unknown): string | undefined {
  if (typeof input !== 'string') return undefined;
  const normalized = input.toLowerCase();
  if (normalized === 'turbo') return 'TURBO';
  if (normalized === 'quality') return 'QUALITY';
  if (normalized === 'balanced') return 'DEFAULT';
  return input.toUpperCase();
}

/**
 * 从 model 名后缀自动提取 rendering_speed
 * e.g. ideogram_generate_V_3_TURBO → 'TURBO'
 */
function toIdeogramRenderSpeedFromModel(model: string): string | undefined {
  const match = model.match(/_(TURBO|DEFAULT|QUALITY|FLASH)$/i);
  return match ? match[1].toUpperCase() : undefined;
}

async function generateViaIdeogramEndpoint(
  params: FreedomImageParams,
  model: string,
  apiKey: string,
  baseUrl: string,
): Promise<GenerationResult> {
  // Ideogram 原生路径：/ideogram/v1/ideogram-v3/generate（不是 /v1/ideogram-v3/generate）
  const rootBase = getRootBaseUrl(baseUrl);
  const endpoint = `${rootBase}/ideogram/v1/ideogram-v3/generate`;
  const extra = params.extraParams || {};
  const form = new FormData();
  form.append('model', model);
  form.append('prompt', params.prompt);

  const aspect = toIdeogramAspectRatio(model, params.aspectRatio);
  if (aspect) form.append('aspect_ratio', aspect);

  // extraParams 优先；无则从 model 名后缀推断（e.g. ideogram_generate_V_3_TURBO）
  const speed = toIdeogramRenderSpeed(extra.render_speed || extra.rendering_speed)
    ?? toIdeogramRenderSpeedFromModel(model);
  if (speed) form.append('rendering_speed', speed);

  if (typeof extra.style === 'string') form.append('style_type', extra.style.toUpperCase());
  if (typeof params.negativePrompt === 'string' && params.negativePrompt.trim()) {
    form.append('negative_prompt', params.negativePrompt);
  }
  if (typeof extra.num_images === 'number') form.append('num_images', String(extra.num_images));

  const response = await freedomObservedFetch(endpoint, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
    },
    body: form,
  });

  if (!response.ok) {
    throw toHttpError('Ideogram generate failed', response.status, await response.text());
  }

  const data = await response.json();
  const imageUrl = extractImageUrl(data);
  if (!imageUrl) throw new Error('Ideogram 响应未包含图片 URL');
  const mediaId = saveToMediaLibrary(imageUrl, params.prompt, 'ai-image');
  return { url: imageUrl, mediaId };
}

/**
 * Generate image via Replicate's /replicate/v1/predictions endpoint
 * Request body: { model, input: { prompt, aspect_ratio, ... } }
 * Poll until status === 'succeeded' / 'failed' / 'canceled'
 */
async function generateViaReplicateImageEndpoint(
  params: FreedomImageParams,
  model: string,
  apiKey: string,
  baseUrl: string,
): Promise<GenerationResult> {
  const rootBase = getRootBaseUrl(baseUrl);
  const submitUrl = `${rootBase}/replicate/v1/predictions`;

  const input: Record<string, any> = { prompt: params.prompt };
  if (params.aspectRatio) input.aspect_ratio = params.aspectRatio;
  if (params.resolution) input.resolution = params.resolution;
  if (params.width) input.width = params.width;
  if (params.height) input.height = params.height;
  if (params.negativePrompt) input.negative_prompt = params.negativePrompt;
  if (params.extraParams) Object.assign(input, params.extraParams);

  const submitResp = await freedomObservedFetch(submitUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({ model, input }),
  });
  if (!submitResp.ok) {
    throw toHttpError('Replicate submit failed', submitResp.status, await submitResp.text());
  }

  const submitData = await submitResp.json();
  const directUrl = extractImageUrl(submitData);
  if (directUrl) {
    const mediaId = saveToMediaLibrary(directUrl, params.prompt, 'ai-image');
    return { url: directUrl, mediaId };
  }

  const predictionId = submitData.id;
  if (!predictionId) throw new Error('Replicate 返回空 prediction ID');

  const pollUrl = `${rootBase}/replicate/v1/predictions/${predictionId}`;
  for (let i = 0; i < IMAGE_POLL_MAX_ATTEMPTS; i++) {
    await new Promise(r => setTimeout(r, IMAGE_POLL_INTERVAL));
    const pollResp = await freedomObservedFetch(pollUrl, {
      headers: { 'Authorization': `Bearer ${apiKey}` },
    });
    if (!pollResp.ok) continue;
    const pollData = await pollResp.json();
    const status = String(pollData.status || '').toLowerCase();
    if (status === 'succeeded') {
      const imageUrl = extractImageUrl(pollData);
      if (!imageUrl) throw new Error('Replicate 成功但未返回图片 URL');
      const mediaId = saveToMediaLibrary(imageUrl, params.prompt, 'ai-image');
      return { url: imageUrl, taskId: String(predictionId), mediaId };
    }
    if (status === 'failed' || status === 'canceled') {
      throw new Error(pollData.error || 'Replicate 图片生成失败');
    }
  }
  throw new Error('Replicate 图片生成超时');
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

  let result: GenerationResult;
  switch (route) {
    case 'openai_official':
      result = await generateVideoViaOpenAIOfficial(params, model, apiKey, baseUrl);
      break;
    case 'volc':
      result = await generateVideoViaVolc(params, model, apiKey, baseUrl);
      break;
    case 'wan':
      result = await generateVideoViaWan(params, model, apiKey, baseUrl);
      break;
    case 'kling':
      result = await generateVideoViaKling(params, model, apiKey, baseUrl);
      break;
    case 'replicate':
      result = await generateVideoViaReplicate(params, model, apiKey, baseUrl);
      break;
    default:
      result = await generateVideoViaUnified(params, model, apiKey, baseUrl);
      break;
  }

  const mediaId = saveToMediaLibrary(result.url, params.prompt, 'ai-video');
  return { ...result, mediaId };
}

async function appendVeoMultipartReferences(
  form: FormData,
  model: string,
  endpointTypes: string[] | undefined,
  uploadFiles?: FreedomVideoUploadFile[],
) {
  const capability = resolveVeoUploadCapability(model, endpointTypes);
  if (!capability.isVeo) return;

  const grouped = validateVeoVideoUploads(model, endpointTypes, uploadFiles);
  const ordered: FreedomVideoUploadFile[] = [];

  if (capability.mode === 'single') {
    const single = grouped.single || grouped.first;
    if (single) ordered.push(single);
  } else if (capability.mode === 'first_last') {
    if (grouped.first) ordered.push(grouped.first);
    if (grouped.last) ordered.push(grouped.last);
  } else if (capability.mode === 'multi') {
    ordered.push(...grouped.references.slice(0, capability.maxFiles));
  }

  for (let i = 0; i < ordered.length; i++) {
    const file = ordered[i];
    const blob = await toUploadBlob(file);
    const fileName = file.fileName || `veo-reference-${i + 1}.png`;
    form.append('input_reference', blob, fileName);
  }
}

async function buildVeoUnifiedVideoBody(
  params: FreedomVideoParams,
  model: string,
  endpointTypes: string[] | undefined,
): Promise<Record<string, any>> {
  const capability = resolveVeoUploadCapability(model, endpointTypes);
  const grouped = validateVeoVideoUploads(model, endpointTypes, params.uploadFiles);
  const body: Record<string, any> = {
    model,
    prompt: params.prompt,
  };
  const metadata: Record<string, any> = {};

  if (params.duration) body.duration = params.duration;
  if (params.aspectRatio) metadata.aspectRatio = params.aspectRatio;
  if (params.resolution) metadata.resolution = params.resolution.toLowerCase();

  if (capability.mode === 'single') {
    const single = grouped.single || grouped.first;
    if (single) body.image = await toUploadHttpUrl(single);
  } else if (capability.mode === 'first_last') {
    if (grouped.first) body.image = await toUploadHttpUrl(grouped.first);
    if (grouped.last) {
      metadata.lastFrame = { url: await toUploadHttpUrl(grouped.last) };
    }
  } else if (capability.mode === 'multi') {
    const refs = grouped.references.slice(0, capability.maxFiles);
    metadata.referenceImages = await Promise.all(
      refs.map(async (f) => ({ url: await toUploadHttpUrl(f) })),
    );
  }

  if (Object.keys(metadata).length > 0) body.metadata = metadata;
  return body;
}

async function generateVideoViaOpenAIOfficial(
  params: FreedomVideoParams,
  model: string,
  apiKey: string,
  baseUrl: string,
): Promise<GenerationResult> {
  const endpoint = buildEndpoint(baseUrl, 'videos');
  const endpointTypes = useAPIConfigStore.getState().modelEndpointTypes[model];
  const isVeo = isVeoModel(model);
  const form = new FormData();
  form.append('model', model);
  form.append('prompt', params.prompt);
  form.append('size', isVeo ? toVeoOpenAIVideoSize(params.aspectRatio) : toSoraSize(params.aspectRatio, params.resolution));
  form.append('seconds', String(params.duration || (isVeo ? 8 : 10)));
  if (isVeo) {
    await appendVeoMultipartReferences(form, model, endpointTypes, params.uploadFiles);
  }

  const submitResp = await freedomObservedFetch(endpoint, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}` },
    body: form,
  });
  if (!submitResp.ok) {
    throw toHttpError('Sora submit failed', submitResp.status, await submitResp.text());
  }

  const submitData = await submitResp.json();
  const taskId = submitData.id || submitData.video_id;
  const directUrl = extractVideoUrl(submitData);
  if (directUrl) return { url: directUrl, taskId: taskId ? String(taskId) : undefined };
  if (!taskId) throw new Error('Sora 返回空任务 ID');

  const pollUrl = buildEndpoint(baseUrl, `videos/${taskId}`);
  for (let i = 0; i < VIDEO_POLL_MAX_ATTEMPTS; i++) {
    await new Promise((r) => setTimeout(r, VIDEO_POLL_INTERVAL));
    const pollResp = await freedomObservedFetch(pollUrl, {
      headers: { 'Authorization': `Bearer ${apiKey}` },
    });
    if (!pollResp.ok) continue;
    const pollData = await pollResp.json();
    const status = String(pollData.status || '').toLowerCase();
    if (status === 'completed' || status === 'succeeded' || status === 'success') {
      const videoUrl = extractVideoUrl(pollData) || buildEndpoint(baseUrl, `videos/${taskId}/content`);
      return { url: videoUrl, taskId: String(taskId) };
    }
    if (status === 'failed' || status === 'error') {
      throw new Error(pollData.error?.message || pollData.error || pollData.message || 'Sora 生成失败');
    }
  }

  throw new Error('Sora 生成超时');
}

async function generateVideoViaUnified(
  params: FreedomVideoParams,
  model: string,
  apiKey: string,
  baseUrl: string,
): Promise<GenerationResult> {
  const endpointTypes = useAPIConfigStore.getState().modelEndpointTypes[model];

  let body: Record<string, any>;
  if (isVeoModel(model)) {
    body = await buildVeoUnifiedVideoBody(params, model, endpointTypes);
  } else {
    const isLuma = (endpointTypes || []).some(t => /luma/i.test(t));
    const isRunway = (endpointTypes || []).some(t => /runway/i.test(t));
    const isGrok = (endpointTypes || []).some(t => /grok/i.test(t)) || /grok/i.test(model);

    body = { model, prompt: params.prompt };
    const metadata: Record<string, any> = {};

    // Duration: Luma requires string with unit ("5s"), other models use number
    if (params.duration) {
      body.duration = isLuma ? `${params.duration}s` : params.duration;
    }

    // AspectRatio 处理策略（各模型格式不同，按模型分别处理）：
    // - Runway: metadata.ratio（像素格式 1280:720）
    // - Grok: 顶层 aspect_ratio（xAI 官方格式，支持 16:9/9:16/4:3/3:4/3:2/2:3/1:1）
    // - 其他统一格式模型: metadata.aspect_ratio
    if (params.aspectRatio) {
      if (isRunway) {
        metadata.ratio = toRunwayRatio(params.aspectRatio);
      } else if (isGrok) {
        body.aspect_ratio = params.aspectRatio;
      } else {
        metadata.aspect_ratio = params.aspectRatio;
      }
    }

    // Resolution: Grok uses top-level "720p"/"480p"; others via metadata
    if (params.resolution) {
      if (isRunway) {
        // Runway doesn't use resolution field
      } else if (isGrok) {
        body.resolution = params.resolution;
      } else {
        metadata.resolution = params.resolution;
      }
    }

    // Image inputs (wan2.6, doubao, luma, vidu, minimax, runway, etc.)
    const grouped = groupVideoUploadFiles(params.uploadFiles);
    if (grouped.single || grouped.first) {
      body.image = await toUploadHttpUrl((grouped.single || grouped.first)!);
    }
    if (grouped.last) {
      metadata.image_end = await toUploadHttpUrl(grouped.last);
    }
    // Reference images: vidu参考生视频 and similar models
    if (grouped.references.length > 0) {
      metadata.reference_images = await Promise.all(
        grouped.references.map(async (f) => ({ url: await toUploadHttpUrl(f) }))
      );
    }

    if (Object.keys(metadata).length > 0) body.metadata = metadata;
  }

  // 直接使用端点类型对应的 URL（绝对路径，从域名根拼接）
  const endpointPaths = getUnifiedEndpointPaths(endpointTypes || []);
  const rootBase = getRootBaseUrl(baseUrl);
  const submitUrl = `${rootBase}${endpointPaths.submit}`;

  const resp = await freedomObservedFetch(submitUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw toHttpError('Unified video submit failed', resp.status, text);
  }
  const submitData = await resp.json();

  const taskId =
    submitData.task_id ||
    submitData.id ||
    submitData.request_id ||
    submitData.data?.task_id ||
    submitData.data?.id ||
    submitData.response?.task_id ||
    submitData.response?.id ||
    submitData.result?.task_id ||
    submitData.result?.id ||
    submitData.output?.task_id ||
    submitData.output?.id;
  const directUrl = extractVideoUrl(submitData);
  if (directUrl) return { url: directUrl, taskId: taskId ? String(taskId) : undefined };
  if (!taskId) throw new Error('统一视频接口返回空任务 ID');

  // 轮询：直接使用端点类型对应的 URL
  const pollUrl = `${rootBase}${endpointPaths.poll(String(taskId))}`;

  for (let i = 0; i < VIDEO_POLL_MAX_ATTEMPTS; i++) {
    await new Promise((r) => setTimeout(r, VIDEO_POLL_INTERVAL));
    const pollResp = await freedomObservedFetch(pollUrl, {
      headers: { 'Authorization': `Bearer ${apiKey}` },
    });
    if (!pollResp.ok) continue;
    const pollData = await pollResp.json();
    const status = String(pollData.status || pollData.state || pollData.data?.status || '').toLowerCase();
    if (status === 'completed' || status === 'succeeded' || status === 'success') {
      const videoUrl = extractVideoUrl(pollData);
      if (videoUrl) return { url: videoUrl, taskId: String(taskId) };
    }
    if (status === 'failed' || status === 'error' || status === 'cancelled') {
      throw new Error(pollData.error?.message || pollData.error || pollData.message || '视频生成失败');
    }
  }

  throw new Error('视频生成超时');
}

async function generateVideoViaVolc(
  params: FreedomVideoParams,
  model: string,
  apiKey: string,
  baseUrl: string,
): Promise<GenerationResult> {
  const rootBase = getRootBaseUrl(baseUrl);
  const promptParts = [params.prompt];
  if (params.resolution) promptParts.push(`--rs ${params.resolution.toLowerCase()}`);
  if (params.aspectRatio) promptParts.push(`--rt ${params.aspectRatio}`);
  if (params.duration) promptParts.push(`--dur ${params.duration}`);

  const content: Array<Record<string, unknown>> = [
    { type: 'text', text: promptParts.join(' ') },
  ];

  // 附加上传图片（首帧/尾帧），对齐 Director 面板的 callVolcVideoApi
  const grouped = groupVideoUploadFiles(params.uploadFiles);
  const primaryFile = grouped.single || grouped.first;
  if (primaryFile) {
    const url = await toUploadHttpUrl(primaryFile);
    content.push({ type: 'image_url', image_url: { url }, role: 'first_frame' });
  }
  if (grouped.last) {
    const url = await toUploadHttpUrl(grouped.last);
    content.push({ type: 'image_url', image_url: { url }, role: 'last_frame' });
  }

  const body = { model, content };

  const submitResp = await freedomObservedFetch(`${rootBase}/volc/v1/contents/generations/tasks`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });
  if (!submitResp.ok) {
    throw toHttpError('Volc submit failed', submitResp.status, await submitResp.text());
  }

  const submitData = await submitResp.json();
  const taskId = submitData.id;
  if (!taskId) throw new Error('Volc 返回空任务 ID');

  const pollUrl = `${rootBase}/volc/v1/contents/generations/tasks/${taskId}`;
  for (let i = 0; i < VIDEO_POLL_MAX_ATTEMPTS; i++) {
    await new Promise((r) => setTimeout(r, VIDEO_POLL_INTERVAL));
    const pollResp = await freedomObservedFetch(pollUrl, {
      headers: { 'Authorization': `Bearer ${apiKey}` },
    });
    if (!pollResp.ok) continue;
    const pollData = await pollResp.json();
    const status = String(pollData.status || '').toLowerCase();
    if (status === 'succeeded' || status === 'completed' || status === 'success') {
      const videoUrl = pollData.content?.video_url || extractVideoUrl(pollData);
      if (!videoUrl) throw new Error('Volc 成功但无视频 URL');
      return { url: videoUrl, taskId: String(taskId) };
    }
    if (status === 'failed' || status === 'expired' || status === 'cancelled' || status === 'error') {
      throw new Error(pollData.error?.message || pollData.error || 'Volc 视频生成失败');
    }
  }

  throw new Error('Volc 视频生成超时');
}

async function generateVideoViaWan(
  params: FreedomVideoParams,
  model: string,
  apiKey: string,
  baseUrl: string,
): Promise<GenerationResult> {
  const rootBase = getRootBaseUrl(baseUrl);
  const body: Record<string, any> = {
    model,
    input: { prompt: params.prompt },
    parameters: {
      resolution: (params.resolution || '720P').toUpperCase(),
      prompt_extend: true,
      audio: true,
    },
  };
  if (params.duration) body.parameters.duration = Math.max(3, params.duration);

  const submitResp = await freedomObservedFetch(
    `${rootBase}/alibailian/api/v1/services/aigc/video-generation/video-synthesis`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    },
  );
  if (!submitResp.ok) {
    throw toHttpError('Wan submit failed', submitResp.status, await submitResp.text());
  }

  const submitData = await submitResp.json();
  const taskId = submitData.output?.task_id;
  if (!taskId) throw new Error('Wan 返回空任务 ID');

  const pollUrl = `${rootBase}/alibailian/api/v1/tasks/${taskId}`;
  for (let i = 0; i < VIDEO_POLL_MAX_ATTEMPTS; i++) {
    await new Promise((r) => setTimeout(r, VIDEO_POLL_INTERVAL));
    const pollResp = await freedomObservedFetch(pollUrl, {
      headers: { 'Authorization': `Bearer ${apiKey}` },
    });
    if (!pollResp.ok) continue;
    const pollData = await pollResp.json();
    const status = String(pollData.output?.task_status || '').toUpperCase();
    if (status === 'SUCCEEDED' || status === 'COMPLETED') {
      const videoUrl = pollData.output?.video_url || extractVideoUrl(pollData);
      if (!videoUrl) throw new Error('Wan 成功但无视频 URL');
      return { url: videoUrl, taskId: String(taskId) };
    }
    if (status === 'FAILED' || status === 'ERROR' || status === 'CANCELLED') {
      throw new Error(pollData.output?.message || pollData.output?.error || 'Wan 视频生成失败');
    }
  }

  throw new Error('Wan 视频生成超时');
}

// Native Kling endpoint paths (relative to /kling/v1/videos/)
// kling-video is handled dynamically: text2video vs image2video based on uploads
const KLING_VIDEO_PATH_MAP: Record<string, string> = {
  'kling-omni-video': 'omni-video',
  'kling-video-extend': 'video-extend',
  'kling-motion-control': 'motion-control',
  'kling-multi-elements': 'multi-elements',
  'kling-avatar-image2video': 'avatar/image2video',
  'kling-advanced-lip-sync': 'advanced-lip-sync',
  'kling-effects': 'effects',
};

async function generateVideoViaKling(
  params: FreedomVideoParams,
  model: string,
  apiKey: string,
  baseUrl: string,
): Promise<GenerationResult> {
  const rootBase = getRootBaseUrl(baseUrl);
  const uploads = params.uploadFiles || [];
  const firstFrame = uploads.find((f) => f.role === 'single' || f.role === 'first');
  const lastFrame = uploads.find((f) => f.role === 'last');

  // Determine the endpoint path
  // Specialized models have a fixed path; all kling-video variants (kling-v2-1-master,
  // kling-v2-6-pro, kling-v3-0-pro, etc.) fall through to text2video / image2video.
  let endpointPath: string;
  const specialPath = KLING_VIDEO_PATH_MAP[model];
  if (specialPath) {
    endpointPath = specialPath;
  } else {
    endpointPath = firstFrame ? 'image2video' : 'text2video';
  }

  const body: Record<string, any> = {
    model_name: resolveKlingModelName(model),
    prompt: params.prompt,
    aspect_ratio: params.aspectRatio || '16:9',
    duration: String(params.duration ? Math.min(10, Math.max(5, params.duration)) : 5),
    mode: 'std',
  };

  // Attach image URLs for image-based endpoints
  if (endpointPath === 'image2video' && firstFrame) {
    body.image_url = await toUploadHttpUrl(firstFrame);
    if (lastFrame) body.tail_image_url = await toUploadHttpUrl(lastFrame);
  } else if (endpointPath === 'avatar/image2video' && firstFrame) {
    body.image_url = await toUploadHttpUrl(firstFrame);
  }

  const submitUrl = `${rootBase}/kling/v1/videos/${endpointPath}`;
  const submitResp = await freedomObservedFetch(submitUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });
  if (!submitResp.ok) {
    throw toHttpError('Kling submit failed', submitResp.status, await submitResp.text());
  }

  const submitData = await submitResp.json();
  const taskId = submitData.data?.task_id;
  if (!taskId) throw new Error('Kling 返回空任务 ID');

  // Poll URL mirrors the submit path: GET /kling/v1/videos/{path}/{task_id}
  const pollUrl = `${rootBase}/kling/v1/videos/${endpointPath}/${taskId}`;
  for (let i = 0; i < VIDEO_POLL_MAX_ATTEMPTS; i++) {
    await new Promise((r) => setTimeout(r, VIDEO_POLL_INTERVAL));
    const pollResp = await freedomObservedFetch(pollUrl, {
      headers: { 'Authorization': `Bearer ${apiKey}` },
    });
    if (!pollResp.ok) continue;
    const pollData = await pollResp.json();
    const status = String(pollData.data?.task_status || '').toLowerCase();
    if (status === 'succeed' || status === 'success' || status === 'completed') {
      const videoUrl =
        pollData.data?.task_result?.videos?.[0]?.url ||
        pollData.data?.task_result?.video_url ||
        extractVideoUrl(pollData);
      if (!videoUrl) throw new Error('Kling 成功但无视频 URL');
      return { url: videoUrl, taskId: String(taskId) };
    }
    if (status === 'failed' || status === 'error') {
      throw new Error(pollData.data?.task_status_msg || pollData.message || 'Kling 视频生成失败');
    }
  }

  throw new Error('Kling 视频生成超时');
}

/**
 * Generate video via Replicate's /replicate/v1/predictions endpoint
 * Request body: { model, input: { prompt, aspect_ratio, ... } }
 * Poll until status === 'succeeded' / 'failed' / 'canceled'
 */
async function generateVideoViaReplicate(
  params: FreedomVideoParams,
  model: string,
  apiKey: string,
  baseUrl: string,
): Promise<GenerationResult> {
  const rootBase = getRootBaseUrl(baseUrl);
  const submitUrl = `${rootBase}/replicate/v1/predictions`;

  const input: Record<string, any> = { prompt: params.prompt };
  if (params.aspectRatio) input.aspect_ratio = params.aspectRatio;
  if (params.duration) input.duration = params.duration;
  if (params.resolution) input.resolution = params.resolution;

  // Image-to-video: attach upload files inside input
  const grouped = groupVideoUploadFiles(params.uploadFiles);
  const primaryFile = grouped.single || grouped.first;
  if (primaryFile) input.image = await toUploadHttpUrl(primaryFile);
  if (grouped.last) input.tail_image = await toUploadHttpUrl(grouped.last);

  const submitResp = await freedomObservedFetch(submitUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({ model, input }),
  });
  if (!submitResp.ok) {
    throw toHttpError('Replicate video submit failed', submitResp.status, await submitResp.text());
  }

  const submitData = await submitResp.json();
  const directUrl = extractVideoUrl(submitData);
  if (directUrl) return { url: directUrl };

  const predictionId = submitData.id;
  if (!predictionId) throw new Error('Replicate 返回空 prediction ID');

  const pollUrl = `${rootBase}/replicate/v1/predictions/${predictionId}`;
  for (let i = 0; i < VIDEO_POLL_MAX_ATTEMPTS; i++) {
    await new Promise(r => setTimeout(r, VIDEO_POLL_INTERVAL));
    const pollResp = await freedomObservedFetch(pollUrl, {
      headers: { 'Authorization': `Bearer ${apiKey}` },
    });
    if (!pollResp.ok) continue;
    const pollData = await pollResp.json();
    const status = String(pollData.status || '').toLowerCase();
    if (status === 'succeeded') {
      const videoUrl = extractVideoUrl(pollData);
      if (!videoUrl) throw new Error('Replicate 成功但未返回视频 URL');
      return { url: videoUrl, taskId: String(predictionId) };
    }
    if (status === 'failed' || status === 'canceled') {
      throw new Error(pollData.error || 'Replicate 视频生成失败');
    }
  }
  throw new Error('Replicate 视频生成超时');
}

function saveToMediaLibrary(
  url: string,
  prompt: string,
  source: 'ai-image' | 'ai-video'
): string | undefined {
  try {
    const mediaStore = useMediaStore.getState();
    const projectId = useProjectStore.getState().activeProjectId;
    const name = prompt.slice(0, 30).replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, '_') || 'freedom';
    const type = source === 'ai-image' ? 'image' : 'video';
    
    const mediaId = mediaStore.addMediaFromUrl({
      url,
      name: `${name}_${Date.now()}`,
      type: type as any,
      source,
      projectId: projectId || undefined,
    });

    return mediaId;
  } catch (err) {
    console.warn('[Freedom] Failed to save to media library:', err);
    return undefined;
  }
}
