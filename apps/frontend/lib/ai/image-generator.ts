// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
/**
 * Image Generator Service
 * Unified interface for image generation across different AI providers
 * Uses same API logic as storyboard-service.ts
 */

import { getFeatureConfig, getFeatureNotConfiguredMessage } from '@/lib/ai/feature-router';
import { buildEndpoint, getRootBaseUrl, getImageEndpointPaths, DEFAULT_IMAGE_ENDPOINT, getImageAttemptConfigs, parseImageApiErrorMessage, createImageApiHttpError, getTargetDimensions, isGeminiImageModel, geminiSupportsImageSize, normalizeResolutionForGemini, needsPixelSize } from '@/lib/ai/image-generator-helpers';
import {
  buildOpenAIImageRequestBody,
  buildProviderExtensionImageRequestBody,
  extractImageGenerationResult,
  isGptImageModel,
  normalizeImagePromptForGeneration,
  sdkGenerateImage,
} from '@/lib/ai/ai-sdk-bridge';
import { createOperationId, logEvent } from '@/lib/diagnostics/logger';
import { observedFetch } from '@/lib/diagnostics/network';
import { retryOperation } from '@/lib/utils/retry';
import { resolveImageApiFormat, type IProvider } from '@/lib/api-key-manager';
import { useAPIConfigStore } from '@/stores/api-config-store';
import { useAppSettingsStore } from '@/stores/app-settings-store';
import { getImageSizeLabel, type ImageAspectRatio, type ImageResolution } from '@/lib/ai/image-size-presets';
import {
  buildCompatibilityImagePrompt,
  shouldRetryImageCompatibility,
} from '@/lib/ai/image-compatibility';
import { prepareReferenceImagesForTransfer } from '@/lib/ai/image-transfer';
import { extractDirectImageUrl } from '@/lib/ai/image-response';

export interface ImageGenerationParams {
  prompt: string;
  negativePrompt?: string;
  width?: number;
  height?: number;
  aspectRatio?: ImageAspectRatio;
  resolution?: ImageResolution;
  referenceImages?: string[];  // Base64 encoded images
  styleId?: string;
}

export interface ImageGenerationResult {
  imageUrl: string;
  taskId?: string;
}

type ImageGenerationFeature = 'character_generation' | 'scene_generation' | 'prop_generation';
const IMAGE_SUBMIT_TIMEOUT_MS = 180_000;
export async function generateCharacterImage(params: ImageGenerationParams): Promise<ImageGenerationResult> {
  return generateImage(params, 'character_generation');
}
export async function generateSceneImage(params: ImageGenerationParams): Promise<ImageGenerationResult> {
  return generateImage(params, 'scene_generation');
}

/**
 * Generate image for prop/tool assets
 */
export async function generatePropImage(params: ImageGenerationParams): Promise<ImageGenerationResult> {
  return generateImage(params, 'prop_generation');
}

/**
 * Core image generation function
 * Uses the provider bound to the feature via service mapping
 */
async function generateImage(
  params: ImageGenerationParams,
  feature: ImageGenerationFeature
): Promise<ImageGenerationResult> {
  const operationId = createOperationId('image-generation');
  const selectedConfig = getFeatureConfig(feature);
  if (!selectedConfig) {
    throw new Error(getFeatureNotConfiguredMessage(feature));
  }

  const attemptConfigs = getImageAttemptConfigs(feature, selectedConfig);
  const imageSettings = useAppSettingsStore.getState().imageGenerationSettings;
  const aspectRatio = params.aspectRatio || imageSettings.defaultAspectRatio;
  const resolution = params.resolution || imageSettings.defaultResolution;
  const normalizedPrompt = normalizeImagePromptForGeneration({
    prompt: params.prompt,
    negativePrompt: params.negativePrompt,
  });
  const generationParams = {
    ...params,
    prompt: normalizedPrompt.prompt,
    negativePrompt: normalizedPrompt.negativePrompt,
    referenceImages: await prepareReferenceImagesForTransfer(params.referenceImages),
  };
  let lastError: unknown;

  for (let attemptIndex = 0; attemptIndex < attemptConfigs.length; attemptIndex++) {
    const featureConfig = attemptConfigs[attemptIndex];
    const apiKey = featureConfig.apiKey;
    const baseUrl = featureConfig.baseUrl?.replace(/\/+$/, '');
    const model = featureConfig.models?.[0];
    if (!apiKey || !baseUrl || !model) {
      lastError = new Error(getFeatureNotConfiguredMessage(feature));
      continue;
    }

    // 根据元数据决定图片生成 API 格式
    const endpointTypes = useAPIConfigStore.getState().modelEndpointTypes[model];
    const apiFormat = resolveImageApiFormat(endpointTypes, model);

    console.log('[ImageGenerator] Generating image', {
      model,
      apiFormat,
      endpointTypes,
      aspectRatio,
      resolution,
      promptPreview: generationParams.prompt.substring(0, 100) + '...',
      attempt: attemptIndex + 1,
      attempts: attemptConfigs.length,
    });
    void logEvent({
      level: 'info',
      category: 'ai',
      operationId,
      message: 'Image generation started',
      context: {
        feature,
        providerId: featureConfig.provider.id,
        providerName: featureConfig.provider.name,
        model,
        apiFormat,
        endpointTypes,
        aspectRatio,
        resolution,
        prompt: generationParams.prompt,
        referenceImageCount: generationParams.referenceImages?.length ?? 0,
        attempt: attemptIndex + 1,
        attempts: attemptConfigs.length,
      },
    });

    try {
      // Gemini 等模型通过 chat completions 生图
      if (apiFormat === 'openai_chat') {
        const result = await submitViaChatCompletions(
          generationParams.prompt,
          model,
          apiKey,
          baseUrl,
          aspectRatio,
          generationParams.referenceImages,
          resolution,
          featureConfig.keyManager,
          undefined,
          operationId,
        );
        void logEvent({ level: 'info', category: 'ai', operationId, message: 'Image generation completed', context: { model, hasImageUrl: Boolean(result.imageUrl), taskId: result.taskId, attempt: attemptIndex + 1 } });
        return result;
      }

      // Kling image 原生端点: /kling/v1/images/generations 或 /kling/v1/images/omni-image
      if (apiFormat === 'kling_image') {
        if (generationParams.referenceImages?.length) {
          throw new Error('当前 Kling 图片适配器不支持参考图，已在网络请求前阻断');
        }
        const result = await submitViaKlingImages(generationParams, model, apiKey, baseUrl, aspectRatio, featureConfig.keyManager, operationId);
        void logEvent({ level: 'info', category: 'ai', operationId, message: 'Image generation completed', context: { model, hasImageUrl: Boolean(result.imageUrl), taskId: result.taskId, attempt: attemptIndex + 1 } });
        return result;
      }

      // 标准格式: /v1/images/generations (GPT Image, DALL-E, Flux, doubao-seedream 等)
      // aigc-image / vidu生图 等走自定义路径
      const result = await submitImageTask(
        generationParams.prompt,
        aspectRatio,
        resolution,
        apiKey,
        generationParams.referenceImages,
        model,
        baseUrl,
        featureConfig.keyManager,
        endpointTypes,
        operationId,
        featureConfig.provider,
        generationParams.negativePrompt,
      );

      if (result.imageUrl) {
        void logEvent({ level: 'info', category: 'ai', operationId, message: 'Image generation completed', context: { model, hasImageUrl: true, taskId: result.taskId, attempt: attemptIndex + 1 } });
        return { imageUrl: result.imageUrl };
      }

      if (result.taskId) {
        const imageUrl = await pollTaskStatus(result.taskId, apiKey, baseUrl, undefined, result.pollUrl, operationId);
        void logEvent({ level: 'info', category: 'ai', operationId, message: 'Image generation completed after polling', context: { model, taskId: result.taskId, hasImageUrl: Boolean(imageUrl), attempt: attemptIndex + 1 } });
        return { imageUrl, taskId: result.taskId };
      }

      throw new Error('Invalid API response');
    } catch (error) {
      lastError = error;
      const hasNextAttempt = attemptIndex < attemptConfigs.length - 1;
      if (hasNextAttempt) {
        void logEvent({
          level: 'warn',
          category: 'ai',
          operationId,
          message: 'Image generation binding failed, trying next binding',
          context: { feature, model, apiFormat, aspectRatio, resolution, attempt: attemptIndex + 1, attempts: attemptConfigs.length },
          error,
        });
        continue;
      }

      void logEvent({
        level: 'error',
        category: 'ai',
        operationId,
        message: 'Image generation failed',
        context: { feature, model, apiFormat, aspectRatio, resolution, attempt: attemptIndex + 1, attempts: attemptConfigs.length },
        error,
      });
      throw error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error('图片生成失败');
}

/**
 * Generate image via /v1/chat/completions (multimodal)
 * Used for Gemini image models that don't support /v1/images/generations
 *
 * 分辨率处理策略：
 * - Gemini 图片模型（Nano Banana Pro / Nano Banana 2）：
 *   通过请求体 image_size + aspect_ratio 参数严格指定分辨率（中转站转发给 Gemini 原生 API）
 * - 其他模型：通过 prompt 文本嵌入像素尺寸说明（软提示）
 */
async function submitViaChatCompletions(
  prompt: string,
  model: string,
  apiKey: string,
  baseUrl: string,
  aspectRatio: string,
  referenceImages?: string[],
  resolution?: string,
  keyManager?: { getCurrentKey?: () => string | null; handleError?: (status: number, errorText?: string) => boolean },
  signal?: AbortSignal,
  operationId?: string,
): Promise<ImageGenerationResult> {
  const endpoint = buildEndpoint(baseUrl, 'chat/completions');

  // === 分辨率处理：区分 Gemini 图片模型与其他模型 ===
  const isGemini = isGeminiImageModel(model);
  const geminiHasImageSize = isGemini && geminiSupportsImageSize(model);

  // 非 Gemini 模型：通过 prompt 文本嵌入像素尺寸说明（软提示）
  // Gemini 模型如果支持 image_size，也保留 prompt 提示作为兜底
  const targetDims = getTargetDimensions(aspectRatio, resolution);
  const sizeInstruction = targetDims
    ? ` Output the image at ${targetDims.width}x${targetDims.height} pixels resolution.`
    : '';

  // Build messages
  const userContent: Array<{ type: string; text?: string; image_url?: { url: string } }> = [
    { type: 'text', text: `Generate an image with aspect ratio ${aspectRatio}.${sizeInstruction} ${prompt}` },
  ];
  // Attach reference images after the shared pre-network transfer gate.
  if (referenceImages && referenceImages.length > 0) {
    for (const img of referenceImages) {
      userContent.push({ type: 'image_url', image_url: { url: img } });
    }
  }

  // === 构建请求体 ===
  const requestBody: Record<string, unknown> = {
    model,
    messages: [{ role: 'user', content: userContent }],
    // Standard multimodal image generation parameters
    max_tokens: 4096,
    stream: false,
  };

  // Gemini 图片模型：附加官方 image_size / aspect_ratio 参数
  // 中转站（MemeFast / new_api / one_api 等）会将这些参数转发给 Gemini 原生 API 的
  // generation_config.image_config
  if (isGemini) {
    const geminiResolution = geminiHasImageSize
      ? normalizeResolutionForGemini(resolution)
      : undefined; // gemini-2.5-flash-image 不支持 image_size

    // 方式 1: 顶层参数（大部分中转站兼容）
    if (geminiResolution) {
      requestBody.image_size = geminiResolution;
    }
    requestBody.aspect_ratio = aspectRatio;

    // 方式 2: 嵌套 generation_config（官方 SDK 格式，部分中转站支持）
    requestBody.generation_config = {
      response_modalities: ['TEXT', 'IMAGE'],
      image_config: {
        ...(geminiResolution ? { image_size: geminiResolution } : {}),
        aspect_ratio: aspectRatio,
      },
    };

    console.log('[ImageGenerator] Gemini image model detected, added image_size:', geminiResolution || '(not supported)', 'aspect_ratio:', aspectRatio);
  }

  console.log('[ImageGenerator] Submitting via chat completions:', { model, endpoint, isGemini, geminiImageSize: geminiHasImageSize ? normalizeResolutionForGemini(resolution) : 'N/A' });

  const response = await retryOperation(async () => {
    // 每次重试独立创建 AbortController，避免共享 controller 在重试时已超时
    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(new DOMException('图片生成请求超时（60秒），请检查网络后重试', 'TimeoutError')),
      60000
    );

    // 外部 signal 取消时同步取消内部 controller，并传播 reason
    const onExternalAbort = () => controller.abort(signal?.reason || new Error('用户已取消'));
    if (signal) {
      if (signal.aborted) throw new Error('用户已取消');
      signal.addEventListener('abort', onExternalAbort, { once: true });
    }

    // 每次重试动态取当前 key（利用 keyManager rotate 后的新 key）
    const currentApiKey = keyManager?.getCurrentKey?.() || apiKey;

    try {
      const resp = await observedFetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${currentApiKey}`,
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      }, {
        operationId,
        endpointFamily: 'chat-completions',
        model,
        timeoutMs: 60000,
      });

      if (!resp.ok) {
        const errorText = await resp.text();
        console.error('[ImageGenerator] Chat completions error:', resp.status, errorText);

        // 通知 keyManager 处理错误（触发 rotate）
        if (keyManager?.handleError) {
          keyManager.handleError(resp.status, errorText);
        }

        let msg = `图片生成 API 错误: ${resp.status}`;
        try { const j = JSON.parse(errorText); msg = j.error?.message || msg; } catch {}

        // 401 专项提示：引导用户检查 API Key
        if (resp.status === 401) {
          msg = `API Key 无效或已过期，请前往「设置」检查图片生成服务的 API Key 配置（原始信息：${msg}）`;
        }
        // 502 专项提示：上游服务临时不可用
        if (resp.status === 502) {
          msg = `API 上游服务暂时不可用（502），将自动重试（原始信息：${msg}）`;
        }

        const err = new Error(msg) as Error & { status?: number };
        err.status = resp.status;
        throw err;
      }

      return resp;
    } catch (fetchErr: any) {
      // 将 DOMException abort 转换为可读错误信息
      if (fetchErr instanceof DOMException && fetchErr.name === 'AbortError') {
        const reason = controller.signal.reason;
        const readableMsg = reason instanceof Error
          ? reason.message
          : (typeof reason === 'string' ? reason : '请求被中止，请重试');
        const abortErr = new Error(readableMsg) as Error & { status?: number };
        throw abortErr;
      }
      throw fetchErr;
    } finally {
      clearTimeout(timeoutId);
      if (signal) signal.removeEventListener('abort', onExternalAbort);
    }
  }, {
    maxRetries: 3,
    baseDelay: 3000,
    retryOn429: true,
    onRetry: (attempt, delay, error) => {
      console.warn(`[ImageGenerator] Chat completions retry ${attempt}, delay ${delay}ms, error: ${error.message}`);
    },
  });

  // Parse response — some providers return SSE "data: {...}" even with stream:false
  const responseText = await response.text();
  let data: any;
  try {
    data = JSON.parse(responseText);
  } catch {
    // Fallback: accumulate SSE delta chunks into a single message
    const lines = responseText.split('\n').filter(l => l.startsWith('data: '));
    let accumulatedText = '';
    const accumulatedParts: any[] = [];
    let lastChunk: any = null;

    for (const line of lines) {
      const payload = line.replace(/^data:\s*/, '').trim();
      if (payload === '[DONE]') continue;
      try {
        const chunk = JSON.parse(payload);
        lastChunk = chunk;
        const delta = chunk.choices?.[0]?.delta;
        if (delta) {
          if (typeof delta.content === 'string') {
            accumulatedText += delta.content;
          } else if (Array.isArray(delta.content)) {
            accumulatedParts.push(...delta.content);
          }
        }
        // Also check non-delta message (some proxies mix formats)
        const msg = chunk.choices?.[0]?.message;
        if (msg) {
          if (typeof msg.content === 'string') accumulatedText += msg.content;
          else if (Array.isArray(msg.content)) accumulatedParts.push(...msg.content);
        }
      } catch { /* skip malformed line */ }
    }

    if (!lastChunk) {
      throw new Error(`无法解析图片 API 响应: ${responseText.substring(0, 120)}`);
    }

    // Reconstruct standard response format from accumulated deltas
    data = {
      ...lastChunk,
      choices: [{
        ...(lastChunk.choices?.[0] || {}),
        message: {
          role: 'assistant',
          content: accumulatedParts.length > 0 ? accumulatedParts : accumulatedText,
        },
      }],
    };
  }
  console.log('[ImageGenerator] Chat completions response received');

  // Extract image from response - multiple possible formats
  const choice = data.choices?.[0];
  if (!choice) throw new Error('响应中无有效内容');

  const message = choice.message;

  // Format 1: content is array with image parts (OpenAI multimodal)
  if (Array.isArray(message?.content)) {
    for (const part of message.content) {
      if (part.type === 'image_url' && part.image_url?.url) {
        return { imageUrl: part.image_url.url };
      }
      // Base64 inline image
      if (part.type === 'image' && part.image?.url) {
        return { imageUrl: part.image.url };
      }
      // Some APIs return base64 in data field
      if (part.type === 'image' && part.data) {
        return { imageUrl: `data:image/png;base64,${part.data}` };
      }
    }
  }

  // Format 2: content is string with markdown image link
  if (typeof message?.content === 'string') {
    // Try to extract image URL from markdown: ![...](url)
    const mdMatch = message.content.match(/!\[.*?\]\((https?:\/\/[^)]+)\)/);
    if (mdMatch) return { imageUrl: mdMatch[1] };
    // Try to extract base64 data URI
    const b64Match = message.content.match(/(data:image\/[^;]+;base64,[A-Za-z0-9+/=]+)/);
    if (b64Match) return { imageUrl: b64Match[1] };
  }

  throw new Error('未能从响应中提取图片 URL');
}

/**
 * Submit image generation task via OpenAI-compatible images/generations API
 */
async function submitImageTask(
  prompt: string,
  aspectRatio: string,
  resolution: string,
  apiKey: string,
  referenceImages?: string[],
  model?: string,
  baseUrl?: string,
  keyManager?: { getCurrentKey: () => string | null; handleError: (status: number, errorText?: string) => boolean },
  endpointTypes?: string[],
  operationId?: string,
  provider?: Pick<IProvider, 'id' | 'platform' | 'name' | 'baseUrl' | 'apiKey'>,
  negativePrompt?: string,
): Promise<{ taskId?: string; imageUrl?: string; pollUrl?: string }> {
  if (!baseUrl) {
    throw new Error('请先在设置中配置图片生成服务映射');
  }
  const imagePaths = getImageEndpointPaths(endpointTypes || []);
  const usesDefaultImagesEndpoint = imagePaths.submit === DEFAULT_IMAGE_ENDPOINT.submit;
  const imageSettings = useAppSettingsStore.getState().imageGenerationSettings;
  const builtRequest = usesDefaultImagesEndpoint
    ? buildOpenAIImageRequestBody({ model, prompt, aspectRatio, resolution, referenceImages, negativePrompt })
    : buildProviderExtensionImageRequestBody({ model, prompt, aspectRatio, resolution, referenceImages, negativePrompt });
  const requestData = builtRequest.body;

  if (model && !requestData.size && needsPixelSize(model)) {
    const dims = resolveImageDimensions({ aspectRatio, resolution });
    if (dims) {
      requestData.size = `${dims.width}x${dims.height}`;
      delete requestData.aspect_ratio;
      delete requestData.resolution;
    }
  }

  console.log('[ImageGenerator] Submitting image task:', {
    templateName: builtRequest.templateName,
    model: requestData.model,
    size: requestData.size,
    aspectRatio: requestData.aspect_ratio,
    resolution: requestData.resolution,
    hasImageUrls: !!requestData.image_urls,
  });

  if (usesDefaultImagesEndpoint && model && provider && isGptImageModel(model)) {
    const currentApiKey = keyManager?.getCurrentKey?.() || apiKey;
    const sdkResult = await sdkGenerateImage({
      provider: { ...provider, apiKey: currentApiKey, baseUrl },
      model,
      prompt,
      aspectRatio,
      resolution,
      negativePrompt,
      referenceImages,
      operationId,
      endpointFamily: 'images-generations',
      timeoutMs: IMAGE_SUBMIT_TIMEOUT_MS,
      maxRetries: 2,
    });
    if (sdkResult.success && sdkResult.imageUrl) {
      return { imageUrl: sdkResult.imageUrl };
    }
    if (imageSettings.compatibilityRetryEnabled && shouldRetryImageCompatibility(sdkResult)) {
      const compatibilityPrompt = buildCompatibilityImagePrompt(prompt);
      void logEvent({
        level: 'warn',
        category: 'ai',
        operationId,
        message: 'Image generation compatibility retry started',
        context: {
          endpointFamily: 'images-generations',
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
          originalPromptLength: prompt.length,
          retryPromptLength: compatibilityPrompt.length,
        },
      });
      const compatibilityResult = await sdkGenerateImage({
        provider: { ...provider, apiKey: currentApiKey, baseUrl },
        model,
        prompt: compatibilityPrompt,
        aspectRatio: imageSettings.compatibilityRetryAspectRatio,
        resolution: imageSettings.compatibilityRetryResolution,
        negativePrompt,
        referenceImages,
        operationId,
        endpointFamily: 'images-generations',
        timeoutMs: IMAGE_SUBMIT_TIMEOUT_MS,
        maxRetries: 0,
      });
      if (compatibilityResult.success && compatibilityResult.imageUrl) {
        void logEvent({
          level: 'info',
          category: 'ai',
          operationId,
          message: 'Image generation compatibility retry completed',
          context: {
            endpointFamily: 'images-generations',
            providerId: provider.id,
            providerName: provider.name,
            model,
            retrySize: compatibilityResult.size,
            templateName: compatibilityResult.templateName,
          },
        });
        return { imageUrl: compatibilityResult.imageUrl };
      }
      void logEvent({
        level: 'warn',
        category: 'ai',
        operationId,
        message: 'Image generation compatibility retry failed',
        context: {
          endpointFamily: 'images-generations',
          providerId: provider.id,
          providerName: provider.name,
          model,
          status: compatibilityResult.status,
          error: compatibilityResult.error,
        },
      });
    }
    throw new Error(sdkResult.error || 'AI SDK 图片生成失败');
  }

  try {
    const data = await retryOperation(async () => {
      // 每次重试独立创建 AbortController，避免共享 controller 在重试时已超时
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), IMAGE_SUBMIT_TIMEOUT_MS);

      // 每次重试动态取当前 key（利用 keyManager rotate 后的新 key）
      const currentApiKey = keyManager?.getCurrentKey?.() || apiKey;
      const rootBase = getRootBaseUrl(baseUrl);
      const endpoint = `${rootBase}${imagePaths.submit}`;
      try {
        const response = await observedFetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${currentApiKey}`,
          },
          body: JSON.stringify(requestData),
          signal: controller.signal,
        }, {
          operationId,
          endpointFamily: 'images-generations',
          model,
          timeoutMs: IMAGE_SUBMIT_TIMEOUT_MS,
          templateName: builtRequest.templateName,
        });

        if (!response.ok) {
          const errorText = await response.text();
          console.error('[ImageGenerator] API error:', response.status, errorText);

          // 通知 keyManager 处理错误（触发 rotate）
          if (keyManager?.handleError) {
            keyManager.handleError(response.status, errorText);
          }

          const errorMessage = parseImageApiErrorMessage(errorText, `图片生成 API 错误: ${response.status}`);

          if (response.status === 401 || response.status === 403) {
            throw createImageApiHttpError(response.status, errorText);
          } else if (response.status === 529 || response.status === 503) {
            // 上游负载饱和/服务不可用，需要触发重试
            const err = new Error(errorMessage || `上游服务暂时不可用 (${response.status})`) as Error & { status?: number };
            err.status = response.status;
            throw err;
          } else if (response.status >= 500) {
            const err = new Error(errorMessage || '图片生成服务暂时不可用') as Error & { status?: number };
            err.status = response.status;
            throw err;
          }

          const error = new Error(errorMessage) as Error & { status?: number };
          error.status = response.status;
          throw error;
        }

        const text = await response.text();
        try {
          return JSON.parse(text);
        } catch {
          // Fallback: some providers return SSE format "data: {...}" even with stream:false
          const sseMatch = text.match(/^data:\s*(\{.+\})/m);
          if (sseMatch) {
            return JSON.parse(sseMatch[1]);
          }
          throw new Error(`无法解析图片 API 响应: ${text.substring(0, 100)}`);
        }
      } finally {
        clearTimeout(timeoutId);
      }
    }, {
      maxRetries: 3,
      baseDelay: 3000,
      retryOn429: true,
      onRetry: (attempt, delay) => {
        console.warn(`[ImageGenerator] Retryable error, retrying in ${delay}ms... (Attempt ${attempt}/3)`);
      },
    });
    console.log('[ImageGenerator] API response:', data);

    // GPT Image 返回 choices 格式（MemeFast 文档确认）
    if (data.choices?.[0]?.message?.content) {
      const content = data.choices[0].message.content;
      // 可能是 markdown 图片链接
      const mdMatch = content.match(/!\[.*?\]\((https?:\/\/[^)]+)\)/);
      if (mdMatch) return { imageUrl: mdMatch[1] };
      // 可能是 base64
      const b64Match = content.match(/(data:image\/[^;]+;base64,[A-Za-z0-9+/=]+)/);
      if (b64Match) return { imageUrl: b64Match[1] };
      // 可能直接是 URL
      const urlMatch = content.match(/(https?:\/\/[^\s"']+\.(?:png|jpg|jpeg|webp|gif)[^\s"']*)/i);
      if (urlMatch) return { imageUrl: urlMatch[1] };
    }

    // 标准格式: { data: [{ url }] } 或 OpenAI-compatible { data: [{ b64_json }] }
    const extracted = extractImageGenerationResult(data);
    const directImageUrl = extracted.imageUrl || extractDirectImageUrl(data);
    if (directImageUrl) return { imageUrl: directImageUrl };

    let taskId: string | undefined = extracted.taskId;
    const dataList = data.data;
    if (Array.isArray(dataList) && dataList.length > 0) {
      taskId = dataList[0].task_id?.toString();
    }
    taskId = taskId || data.task_id?.toString();

    if (!taskId) {
      throw new Error('No task_id or image URL in response');
    }

    // 返回 pollUrl 供调用方使用自定义轮询路径
    const rootBase = getRootBaseUrl(baseUrl);
    const pollUrl = `${rootBase}${imagePaths.poll(taskId)}`;
    return { taskId, pollUrl };
  } catch (error) {
    if (error instanceof Error) {
      if (error.name === 'AbortError') throw new Error('API 请求超时');
      throw error;
    }
    throw new Error('调用图片生成 API 时发生未知错误');
  }
}

/**
 * Poll task status until completion
 */
async function pollTaskStatus(
  taskId: string,
  apiKey: string,
  baseUrl: string,
  onProgress?: (progress: number) => void,
  customPollUrl?: string,
  operationId?: string,
): Promise<string> {
  const maxAttempts = 120;
  const pollInterval = 2000;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const progress = Math.min(Math.floor((attempt / maxAttempts) * 100), 99);
    onProgress?.(progress);

    try {
      const rawUrl = customPollUrl || buildEndpoint(baseUrl, `images/generations/${taskId}`);
      const url = new URL(rawUrl);
      url.searchParams.set('_ts', Date.now().toString());

      const response = await observedFetch(url.toString(), {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Cache-Control': 'no-cache',
        },
      }, {
        operationId,
        endpointFamily: 'images-generations-poll',
        taskId,
        pollAttempt: attempt + 1,
        maxRetries: maxAttempts,
      });

      if (!response.ok) {
        if (response.status === 404) throw new Error('Task not found');
        throw new Error(`Failed to check task status: ${response.status}`);
      }

      const data = await response.json();
      console.log(`[ImageGenerator] Task ${taskId} status:`, data);

      const status = (data.status ?? data.data?.status ?? 'unknown').toString().toLowerCase();
      const statusMap: Record<string, string> = {
        'pending': 'pending', 'submitted': 'pending', 'queued': 'pending',
        'processing': 'processing', 'running': 'processing', 'in_progress': 'processing',
        'completed': 'completed', 'succeeded': 'completed', 'success': 'completed',
        'failed': 'failed', 'error': 'failed',
      };
      const mappedStatus = statusMap[status] || 'processing';

      if (mappedStatus === 'completed') {
        onProgress?.(100);
        const images = data.result?.images ?? data.data?.result?.images;
        let resultUrl: string | undefined;
        if (images?.[0]) {
          const urlField = images[0].url;
          resultUrl = Array.isArray(urlField) ? urlField[0] : urlField;
        }
        resultUrl = resultUrl || data.output_url || data.result_url || data.url;
        if (!resultUrl) throw new Error('Task completed but no URL in result');
        return resultUrl;
      }

      if (mappedStatus === 'failed') {
        const rawError = data.error || data.error_message || data.data?.error;
        throw new Error(rawError ? String(rawError) : 'Task failed');
      }

      await new Promise(resolve => setTimeout(resolve, pollInterval));
    } catch (error) {
      if (error instanceof Error && 
          (error.message.includes('Task failed') || error.message.includes('no URL') || error.message.includes('Task not found'))) {
        throw error;
      }
      console.error(`[ImageGenerator] Poll attempt ${attempt} failed:`, error);
      await new Promise(resolve => setTimeout(resolve, pollInterval));
    }
  }

  throw new Error('图片生成超时');
}

/**
 * Submit a grid/quad image generation request with smart API routing.
 * Handles both chat completions (Gemini) and images/generations (standard) endpoints.
 * Used by merged generation (九宫格) and quad grid (四宫格) in director and sclass panels.
 */
export async function submitGridImageRequest(params: {
  model: string;
  prompt: string;
  apiKey: string;
  baseUrl: string;
  aspectRatio?: string;
  resolution?: string;
  referenceImages?: string[];
  /** 可选：传入 keyManager 后，重试时自动用轮换后的新 key */
  keyManager?: { getCurrentKey: () => string | null; handleError: (status: number, errorText?: string) => boolean };
  /** 外部中止信号，用于停止生成时真正取消网络请求 */
  signal?: AbortSignal;
}): Promise<{ imageUrl?: string; taskId?: string; pollUrl?: string }> {
  const imageSettings = useAppSettingsStore.getState().imageGenerationSettings;
  const {
    model,
    prompt,
    apiKey,
    baseUrl,
    aspectRatio = imageSettings.defaultAspectRatio,
    resolution = imageSettings.defaultResolution,
    referenceImages,
    keyManager,
    signal,
  } = params;
  const normalizedPrompt = normalizeImagePromptForGeneration({ prompt });
  const transferReferenceImages = await prepareReferenceImagesForTransfer(referenceImages);
  const normalizedBase = baseUrl.replace(/\/+$/, '');
  const operationId = createOperationId('grid-image');

  // 检测 API 格式（与 generateImage 一致）
  const endpointTypes = useAPIConfigStore.getState().modelEndpointTypes[model];
  const apiFormat = resolveImageApiFormat(endpointTypes, model);
  console.log('[GridImageAPI] format:', apiFormat, 'model:', model);

  if (apiFormat === 'openai_chat') {
    // Gemini 等模型通过 chat completions 生图
    const result = await submitViaChatCompletions(normalizedPrompt.prompt, model, apiKey, normalizedBase, aspectRatio, transferReferenceImages, resolution, keyManager, signal, operationId);
    return { imageUrl: result.imageUrl };
  }

  if (apiFormat === 'kling_image') {
    if (transferReferenceImages?.length) {
      throw new Error('当前 Kling 图片适配器不支持参考图，已在网络请求前阻断');
    }
    const result = await submitViaKlingImages({ prompt: normalizedPrompt.prompt, aspectRatio, negativePrompt: normalizedPrompt.negativePrompt }, model, apiKey, normalizedBase, aspectRatio, keyManager, operationId);
    return { imageUrl: result.imageUrl, taskId: result.taskId };
  }

  // 标准 images/generations 端点（aigc-image / vidu生图 走自定义路径）
  const imagePaths = getImageEndpointPaths(endpointTypes || []);
  const rootBase = getRootBaseUrl(normalizedBase);
  const endpoint = `${rootBase}${imagePaths.submit}`;
  const usesDefaultImagesEndpoint = imagePaths.submit === DEFAULT_IMAGE_ENDPOINT.submit;
  const builtRequest = usesDefaultImagesEndpoint
    ? buildOpenAIImageRequestBody({ model, prompt: normalizedPrompt.prompt, aspectRatio, resolution, referenceImages: transferReferenceImages, negativePrompt: normalizedPrompt.negativePrompt })
    : buildProviderExtensionImageRequestBody({ model, prompt: normalizedPrompt.prompt, aspectRatio, resolution, referenceImages: transferReferenceImages, negativePrompt: normalizedPrompt.negativePrompt });
  const requestBody = builtRequest.body;

  console.log('[GridImageAPI] Submitting to', endpoint, { templateName: builtRequest.templateName });

  if (usesDefaultImagesEndpoint && isGptImageModel(model)) {
    const currentApiKey = keyManager?.getCurrentKey?.() || apiKey;
    const sdkResult = await sdkGenerateImage({
      provider: {
        id: 'grid-image',
        platform: 'openai-compatible',
        name: 'Grid Image Provider',
        baseUrl: normalizedBase,
        apiKey: currentApiKey,
      },
      model,
      prompt: normalizedPrompt.prompt,
      aspectRatio,
      resolution,
      negativePrompt: normalizedPrompt.negativePrompt,
      referenceImages: transferReferenceImages,
      operationId,
      endpointFamily: 'grid-images-generations',
      abortSignal: signal,
      maxRetries: 2,
    });
    if (sdkResult.success && sdkResult.imageUrl) {
      return { imageUrl: sdkResult.imageUrl };
    }
    throw new Error(sdkResult.error || 'AI SDK 图片生成失败');
  }

  const data = await retryOperation(async () => {
    // 每次重试动态取当前 key（利用 keyManager rotate 后的新 key）
    const currentApiKey = keyManager?.getCurrentKey?.() || apiKey;
    if (signal?.aborted) throw new Error('用户已取消');
    const response = await observedFetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${currentApiKey}`,
      },
      body: JSON.stringify(requestBody),
      signal,
    }, {
      operationId,
      endpointFamily: 'grid-images-generations',
      model,
      templateName: builtRequest.templateName,
    });

    if (!response.ok) {
      const errorText = await response.text();
      // 通知 keyManager 处理错误（触发 rotate）
      if (keyManager?.handleError) {
        keyManager.handleError(response.status, errorText);
      }
      let errorMessage = `API 失败: ${response.status}`;
      try {
        const errJson = JSON.parse(errorText);
        errorMessage = errJson.error?.message || errJson.message || errorMessage;
      } catch { /* ignore */ }
      if (errorText && errorText.length < 200) errorMessage = errorMessage || errorText;
      const err = new Error(errorMessage) as Error & { status?: number };
      err.status = response.status;
      throw err;
    }

    return response.json();
  }, {
    maxRetries: 3,
    baseDelay: 3000,
    retryOn429: true,
  });
  console.log('[GridImageAPI] Response received');

  // GPT Image 可能通过 images/generations 返回 choices 格式
  if (data.choices?.[0]?.message?.content) {
    const content = data.choices[0].message.content;
    const mdMatch = content.match(/!\[.*?\]\((https?:\/\/[^)]+)\)/);
    if (mdMatch) return { imageUrl: mdMatch[1] };
    const b64Match = content.match(/(data:image\/[^;]+;base64,[A-Za-z0-9+/=]+)/);
    if (b64Match) return { imageUrl: b64Match[1] };
    const urlMatch = content.match(/(https?:\/\/[^\s"']+\.(?:png|jpg|jpeg|webp|gif)[^\s"']*)/i);
    if (urlMatch) return { imageUrl: urlMatch[1] };
  }

  // 标准格式: { data: [{ url, task_id }] } 或 OpenAI-compatible { data: [{ b64_json }] }
  const dataField = data.data;
  const firstItem = Array.isArray(dataField) ? dataField[0] : dataField;

  const extracted = extractImageGenerationResult(data);
  const imageUrl = extracted.imageUrl || extractDirectImageUrl(data);

  const taskId = extracted.taskId
    || firstItem?.task_id?.toString()
    || firstItem?.id?.toString()
    || data.task_id?.toString()
    || data.id?.toString();

  // 如果只有 taskId 没有 imageUrl，自动轮询获取结果（与 generateImage 行为一致）
  if (!imageUrl && taskId) {
    console.log('[GridImageAPI] Got taskId without imageUrl, polling...', taskId);
    const pollUrl = `${rootBase}${imagePaths.poll(taskId)}`;
    const polledUrl = await pollTaskStatus(taskId, params.keyManager?.getCurrentKey?.() || apiKey, normalizedBase, undefined, pollUrl, operationId);
    return { imageUrl: polledUrl, taskId };
  }

  // taskId 存在时附带 pollUrl 供外部轮询
  if (taskId) {
    const pollUrl = `${rootBase}${imagePaths.poll(taskId)}`;
    return { imageUrl, taskId, pollUrl };
  }

  return { imageUrl, taskId };
}

/**
 * Kling image 原生端点生成
 * 提交到 /kling/v1/images/generations 或 /kling/v1/images/omni-image
 * 轮询到 /kling/v1/images/{path}/{task_id}
 */
async function submitViaKlingImages(
  params: { prompt: string; aspectRatio?: string; negativePrompt?: string },
  model: string,
  apiKey: string,
  baseUrl: string,
  aspectRatio: string,
  keyManager?: { getCurrentKey?: () => string | null; handleError?: (status: number, errorText?: string) => boolean },
  operationId?: string,
): Promise<ImageGenerationResult> {
  const rootBase = baseUrl.replace(/\/v\d+$/, '');
  const nativePath = model === 'kling-omni-image'
    ? 'kling/v1/images/omni-image'
    : 'kling/v1/images/generations';

  const body: Record<string, any> = { prompt: params.prompt, model };
  if (aspectRatio) body.aspect_ratio = aspectRatio;
  if (params.negativePrompt) body.negative_prompt = params.negativePrompt;

  console.log('[ImageGenerator] Kling image →', nativePath, { model });

  const data = await retryOperation(async () => {
    const currentApiKey = keyManager?.getCurrentKey?.() || apiKey;
    const response = await observedFetch(`${rootBase}/${nativePath}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${currentApiKey}` },
      body: JSON.stringify(body),
    }, {
      operationId,
      endpointFamily: 'kling-image-submit',
      model,
    });

    if (!response.ok) {
      const errText = await response.text();
      if (keyManager?.handleError) {
        keyManager.handleError(response.status, errText);
      }
      const err = new Error(`Kling image API 错误: ${response.status} ${errText}`) as Error & { status?: number };
      err.status = response.status;
      throw err;
    }

    return response.json();
  }, {
    maxRetries: 3,
    baseDelay: 3000,
    retryOn429: true,
    onRetry: (attempt, delay) => {
      console.warn(`[ImageGenerator] Kling image retry ${attempt}, delay ${delay}ms`);
    },
  });

  const directUrl = data.data?.[0]?.url;
  if (directUrl) return { imageUrl: directUrl };

  const taskId = data.data?.task_id;
  if (!taskId) throw new Error('Kling image 返回空任务 ID');

  const pollUrl = `${rootBase}/${nativePath}/${taskId}`;
  const pollInterval = 2000;
  const maxAttempts = 60;

  for (let i = 0; i < maxAttempts; i++) {
    await new Promise(r => setTimeout(r, pollInterval));
    const currentApiKey = keyManager?.getCurrentKey?.() || apiKey;
    const pollResp = await observedFetch(pollUrl, {
      headers: { 'Authorization': `Bearer ${currentApiKey}` },
    }, {
      operationId,
      endpointFamily: 'kling-image-poll',
      model,
      taskId: String(taskId),
      pollAttempt: i + 1,
      maxRetries: maxAttempts,
    });
    if (!pollResp.ok) continue;
    const pollData = await pollResp.json();
    const status = String(pollData.data?.task_status || '').toLowerCase();
    if (status === 'succeed' || status === 'success' || status === 'completed') {
      const imageUrl = pollData.data?.task_result?.images?.[0]?.url;
      if (!imageUrl) throw new Error('Kling image 成功但无图片 URL');
      return { imageUrl, taskId: String(taskId) };
    }
    if (status === 'failed' || status === 'error') {
      throw new Error(pollData.data?.task_status_msg || 'Kling image 生成失败');
    }
  }
  throw new Error('Kling image 生成超时');
}

/**
 * Convert image URL to persistent format
 * In Electron: saves to local file system and returns local-image:// path
 * In browser: converts to base64
 */
export async function imageUrlToBase64(url: string): Promise<string> {
  const operationId = createOperationId('image-download');
  // If already a local or base64 path, return as-is
  if (url.startsWith('data:image/') || url.startsWith('local-image://')) {
    return url;
  }
  
  // Try to use Electron local storage first
  if (typeof window !== 'undefined' && window.imageStorage) {
    try {
      const filename = `image_${Date.now()}.png`;
      const result = await window.imageStorage.saveImage(url, 'shots', filename);
      if (result.success && result.localPath) {
        console.log('[ImageGenerator] Saved image locally:', result.localPath);
        return result.localPath;
      }
    } catch (error) {
      console.warn('[ImageGenerator] Local save failed, falling back to base64:', error);
    }
  }
  
  // Fallback to base64 for non-Electron environments
  const convertBlobToBase64 = (blob: Blob): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  };
  
  // Try direct fetch first
  try {
    const response = await observedFetch(url, { mode: 'cors' }, {
      operationId,
      endpointFamily: 'image-download',
    });
    if (response.ok) {
      const blob = await response.blob();
      return await convertBlobToBase64(blob);
    }
  } catch (error) {
    console.warn('[ImageGenerator] Direct fetch failed, trying proxy:', error);
  }
  
  // Fallback: use our API proxy to fetch the image
  try {
    const proxyUrl = `/api/proxy-image?url=${encodeURIComponent(url)}`;
    const response = await observedFetch(proxyUrl, undefined, {
      operationId,
      endpointFamily: 'image-download-proxy',
    });
    if (!response.ok) {
      throw new Error(`Proxy fetch failed: ${response.status}`);
    }
    const blob = await response.blob();
    return await convertBlobToBase64(blob);
  } catch (error) {
    console.warn('[ImageGenerator] Proxy fetch also failed:', error);
    throw error;
  }
}
