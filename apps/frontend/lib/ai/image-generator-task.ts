import { buildOpenAIImageRequestBody, buildProviderExtensionImageRequestBody, extractImageGenerationResult, isGptImageModel, sdkGenerateImage } from "@/lib/ai/ai-sdk-bridge";
import { IProvider } from "@/lib/ai/core";
import { createDescribedFetchError } from "@/lib/ai/fetch-error";
import { buildCompatibilityImagePrompt, shouldRetryImageCompatibility } from "@/lib/ai/image-compatibility";
import { isAmbiguousPaidImageException, isAmbiguousPaidImageResult, markAmbiguousPaidImageError } from "@/lib/ai/image-generation-errors";
import { DEFAULT_IMAGE_ENDPOINT, IMAGE_ENDPOINT_PATHS, createImageApiHttpError, getImageEndpointPaths, getRootBaseUrl, getTargetDimensions, needsPixelSize, parseImageApiErrorMessage } from "@/lib/ai/image-generator-helpers";
import { getImageSizeLabel } from "@/lib/ai/image-size-presets";
import { logEvent } from "@/lib/diagnostics/logger";
import { observedFetch } from "@/lib/diagnostics/network";
import { retryOperation } from "@/lib/utils/retry";
import { useAppSettingsStore } from "@/stores/app/app-settings-store";
import { IMAGE_SUBMIT_TIMEOUT_MS, isMikotoImageProvider } from "./image-generator-shared";

/**
 * 生图任务通道——images/generations 异步任务提交与作业任务。file-size-reduction P1 拆出,体逐字保留。
 */
/**
 * Submit image generation task via OpenAI-compatible images/generations API
 */
export async function submitImageTask(
  prompt: string,
  aspectRatio: string,
  resolution: string,
  apiKey: string,
  referenceImages?: string[],
  model?: string,
  baseUrl?: string,
  keyManager?: { getCurrentKey: () => string | null; handleError: (status: number, errorText?: string) => boolean; getTotalKeyCount?: () => number },
  endpointTypes?: string[],
  operationId?: string,
  provider?: Pick<IProvider, 'id' | 'platform' | 'name' | 'baseUrl' | 'apiKey'>,
  negativePrompt?: string,
  promptPolicy?: 'enhanced' | 'raw',
): Promise<{ taskId?: string; imageUrl?: string; pollUrl?: string }> {
  if (!baseUrl) {
    throw new Error('请先在设置中配置图片生成服务映射');
  }
  const imagePaths = getImageEndpointPaths(endpointTypes || []);
  const usesDefaultImagesEndpoint = imagePaths.submit === DEFAULT_IMAGE_ENDPOINT.submit;
  const imageSettings = useAppSettingsStore.getState().imageGenerationSettings;
  const mikotoPaidBoundary = isMikotoImageProvider(baseUrl);
  const builtRequest = usesDefaultImagesEndpoint
    ? buildOpenAIImageRequestBody({ model, prompt, aspectRatio, resolution, referenceImages, negativePrompt, promptPolicy })
    : buildProviderExtensionImageRequestBody({ model, prompt, aspectRatio, resolution, referenceImages, negativePrompt, promptPolicy });
  const requestData = builtRequest.body;

  if (model && !requestData.size && needsPixelSize(model)) {
    const dims = getTargetDimensions(aspectRatio, resolution);
    if (dims) {
      requestData.size = `${dims.width}x${dims.height}`;
      delete requestData.aspect_ratio;
      delete requestData.resolution;
    }
  }


  if (usesDefaultImagesEndpoint && model && provider && isGptImageModel(model)) {
    let currentApiKey = keyManager?.getCurrentKey?.() || apiKey;
    let sdkResult = await sdkGenerateImage({
      provider: { ...provider, apiKey: currentApiKey, baseUrl },
      model,
      prompt,
      aspectRatio,
      resolution,
      negativePrompt,
      promptPolicy,
      referenceImages,
      operationId,
      endpointFamily: 'images-generations',
      timeoutMs: IMAGE_SUBMIT_TIMEOUT_MS,
      maxRetries: mikotoPaidBoundary ? 0 : 2,
    });
    // 多 key 轮转(2026-08-22):同一 provider 配多把 key 时,标准通道失败(如分组无渠道 503)
    // 后换下一把 key 重走同通道——sdk 内部重试不换 key,必须在调用方轮转(实弹验证:双 key
    // 分组互补场景下,不轮转则生图永远打在无渠道分组上)。
    if (!(sdkResult.success && sdkResult.imageUrl) && !mikotoPaidBoundary && keyManager?.handleError) {
      const totalKeys = Math.max(1, keyManager.getTotalKeyCount?.() ?? 1);
      for (let keyAttempt = 1; keyAttempt < totalKeys; keyAttempt++) {
        if (!keyManager.handleError(sdkResult.status ?? 500, sdkResult.error)) break;
        const nextKey = keyManager.getCurrentKey();
        if (!nextKey || nextKey === currentApiKey) break;
        currentApiKey = nextKey;
        void logEvent({
          level: 'warn',
          category: 'ai',
          operationId,
          message: 'Image generation key rotation retry',
          context: {
            endpointFamily: 'images-generations',
            providerId: provider.id,
            providerName: provider.name,
            model,
            keyAttempt,
            totalKeys,
            status: sdkResult.status,
            reason: sdkResult.error,
          },
        });
        sdkResult = await sdkGenerateImage({
          provider: { ...provider, apiKey: currentApiKey, baseUrl },
          model,
          prompt,
          aspectRatio,
          resolution,
          negativePrompt,
          promptPolicy,
          referenceImages,
          operationId,
          endpointFamily: 'images-generations',
          timeoutMs: IMAGE_SUBMIT_TIMEOUT_MS,
          maxRetries: 2,
        });
        if (sdkResult.success && sdkResult.imageUrl) break;
      }
    }
    if (sdkResult.success && sdkResult.imageUrl) {
      return { imageUrl: sdkResult.imageUrl };
    }
    if (mikotoPaidBoundary && isAmbiguousPaidImageResult(sdkResult)) {
      throw markAmbiguousPaidImageError(new Error(
        `Mikoto 图片请求结果不确定，已停止兼容重试与 provider fallback: ${sdkResult.error || 'transport failure'}`,
      ));
    }
    // raw 策略=调用方已持有最终 provider-visible 文本(如道劫编译产物),
    // 兼容性改写会截断/重写正文,禁止触发。
    if (imageSettings.compatibilityRetryEnabled && promptPolicy !== 'raw' && !mikotoPaidBoundary && shouldRetryImageCompatibility(sdkResult)) {
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
    const sdkFailure = new Error(sdkResult.error || 'AI SDK 图片生成失败') as Error & { status?: number };
    sdkFailure.status = sdkResult.status;
    throw sdkFailure;
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
      maxRetries: mikotoPaidBoundary ? 0 : 3,
      baseDelay: 3000,
      retryOn429: true,
      onRetry: (attempt, delay) => {
        console.warn(`[ImageGenerator] Retryable error, retrying in ${delay}ms... (Attempt ${attempt}/3)`);
      },
    });

    // 标准格式: { data: [{ url }] } 或 OpenAI-compatible { data: [{ b64_json }] }
    const extracted = extractImageGenerationResult(data);
    if (extracted.imageUrl) return { imageUrl: extracted.imageUrl };

    if (!extracted.taskId) {
      throw new Error('No task_id or image URL in response');
    }

    // 返回 pollUrl 供调用方使用自定义轮询路径
    const rootBase = getRootBaseUrl(baseUrl);
    const pollUrl = `${rootBase}${imagePaths.poll(extracted.taskId)}`;
    return { taskId: extracted.taskId, pollUrl };
  } catch (error) {
    if (mikotoPaidBoundary && isAmbiguousPaidImageException(error)) {
      throw markAmbiguousPaidImageError(error);
    }
    if (error instanceof Error) {
      if (error.name === 'AbortError') {
        throw new Error(`图片生成请求超时(${Math.round(IMAGE_SUBMIT_TIMEOUT_MS / 1000)}s),可重试或稍后再试`);
      }
      throw createDescribedFetchError(error, {
        timeoutLabel: '图片生成请求',
        timeoutMs: IMAGE_SUBMIT_TIMEOUT_MS,
        endpoint: `${getRootBaseUrl(baseUrl)}${imagePaths.submit}`,
      });
    }
    throw new Error('调用图片生成 API 时发生未知错误');
  }
}

/**
 * Submit an async image job via the new-api style /v1/images/jobs endpoint.
 * Verified contract (fanrenapi): POST {rootBase}/v1/images/jobs with
 * {model, prompt, image?: <raw base64>, size?, n} → {"job": {"id", "status": "queued"}}.
 * Submit is a paid request, so it is never retried blindly.
 */
export async function submitImageJobTask(
  prompt: string,
  aspectRatio: string,
  resolution: string,
  apiKey: string,
  referenceImages: string[] | undefined,
  model: string,
  baseUrl: string,
  keyManager?: { getCurrentKey?: () => string | null },
  operationId?: string,
): Promise<{ taskId: string; pollUrl: string }> {
  const rootBase = getRootBaseUrl(baseUrl);
  const imagePaths = IMAGE_ENDPOINT_PATHS['image-job'];
  const sizeSource = buildOpenAIImageRequestBody({ model, prompt, aspectRatio, resolution }).body;
  const requestBody: Record<string, unknown> = { model, prompt, n: 1 };
  if (typeof sizeSource.size === 'string' && sizeSource.size) requestBody.size = sizeSource.size;
  const firstReference = referenceImages?.[0];
  if (firstReference) {
    const base64 = firstReference.replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, '');
    if (!base64 || base64 === firstReference) {
      throw new Error('job 通道参考图必须是缩略后的 data:image base64 格式');
    }
    requestBody.image = base64;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), IMAGE_SUBMIT_TIMEOUT_MS);
  try {
    const currentApiKey = keyManager?.getCurrentKey?.() || apiKey;
    const response = await observedFetch(`${rootBase}${imagePaths.submit}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${currentApiKey}`,
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    }, {
      operationId,
      endpointFamily: 'images-jobs',
      model,
      timeoutMs: IMAGE_SUBMIT_TIMEOUT_MS,
      templateName: 'image-job',
    });
    if (!response.ok) {
      const errorText = await response.text();
      console.error('[ImageGenerator] Image job submit error:', response.status, errorText);
      throw createImageApiHttpError(response.status, errorText);
    }
    const text = await response.text();
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      const sseMatch = text.match(/^data:\s*(\{.+\})/m);
      if (sseMatch) {
        data = JSON.parse(sseMatch[1]);
      } else {
        throw new Error(`无法解析图片 job API 响应: ${text.substring(0, 100)}`);
      }
    }
    const record = data as Record<string, unknown>;
    const job = (record.job && typeof record.job === 'object' ? record.job : record) as Record<string, unknown>;
    const taskId = typeof job.id === 'string' && job.id.trim()
      ? job.id.trim()
      : typeof job.task_id === 'string' && job.task_id.trim()
        ? job.task_id.trim()
        : '';
    if (!taskId) throw new Error('图片 job 提交响应缺少任务 ID');
    return { taskId, pollUrl: `${rootBase}${imagePaths.poll(taskId)}` };
  } finally {
    clearTimeout(timeoutId);
  }
}
