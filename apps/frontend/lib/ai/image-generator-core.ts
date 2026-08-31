import { isGptImageModel, normalizeImagePromptForGeneration } from "@/lib/ai/ai-sdk-bridge";
import { getModelEndpointTypes } from "@/lib/ai/config/store-adapter";
import { resolveImageApiFormat } from "@/lib/ai/core";
import { getFeatureConfig, getFeatureNotConfiguredMessage } from "@/lib/ai/feature-router";
import { createDescribedFetchError } from "@/lib/ai/fetch-error";
import { isAmbiguousPaidImageError } from "@/lib/ai/image-generation-errors";
import { buildEndpoint, getImageAttemptConfigs } from "@/lib/ai/image-generator-helpers";
import { buildChatCompletionsImageRequest, extractChatCompletionsImageUrl, parseChatCompletionsImageResponseText } from "@/lib/ai/image-request-adapter";
import { pollTaskStatus as pollTaskStatusImpl } from "@/lib/ai/image-task-poller";
import { prepareReferenceImagesForTransfer } from "@/lib/ai/image-transfer";
import { createOperationId, logEvent } from "@/lib/diagnostics/logger";
import { observedFetch } from "@/lib/diagnostics/network";
import { retryOperation } from "@/lib/utils/retry";
import { useAppSettingsStore } from "@/stores/app/app-settings-store";
import { pollTaskStatus, submitViaKlingImages } from "./image-generator-grid";
import { ImageGenerationFeature, ImageGenerationParams, ImageGenerationResult, isAuthStatusError } from "./image-generator-shared";
import { submitImageJobTask, submitImageTask } from "./image-generator-task";

/**
 * 生图核心通道——generateImage 主链 + chat/completions 提交。file-size-reduction P1 拆出,体逐字保留。
 */
/**
 * Core image generation function
 * Uses the provider bound to the feature via service mapping
 */
export async function generateImage(
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
    promptPolicy: params.promptPolicy,
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
    const endpointTypes = getModelEndpointTypes(model);
    const apiFormat = resolveImageApiFormat(endpointTypes, model);

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
        promptPolicy: params.promptPolicy ?? "enhanced",
        promptChars: Array.from(generationParams.prompt).length,
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
          params.promptPolicy,
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
        params.promptPolicy,
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

      throw new Error('图片接口响应异常:既没有返回图片地址,也没有返回任务号');
    } catch (error) {
      lastError = error;
      if (isAmbiguousPaidImageError(error)) {
        throw error;
      }
      // gpt-image 系模型标准通道失败时（如中转站分组无 images/generations 通道），
      // 先用同一 binding 依次尝试 job 异步通道与 chat 通道，再考虑换绑
      if (apiFormat === 'openai_images' && model && isGptImageModel(model) && !isAuthStatusError(error)) {
        const fallback = await tryGptImageFallbackChannels({
          prompt: generationParams.prompt,
          aspectRatio,
          resolution,
          apiKey,
          referenceImages: generationParams.referenceImages,
          model,
          baseUrl,
          keyManager: featureConfig.keyManager,
          operationId,
          promptPolicy: params.promptPolicy,
          cause: error,
        });
        if (fallback.result) {
          const fallbackResult = fallback.result;
          void logEvent({ level: 'info', category: 'ai', operationId, message: 'Image generation completed via fallback channel', context: { model, hasImageUrl: Boolean(fallbackResult.imageUrl), taskId: fallbackResult.taskId, attempt: attemptIndex + 1 } });
          return fallbackResult;
        }
        lastError = augmentErrorWithChannelFailures(error, fallback.channelFailures);
      }
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
      throw lastError;
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
export async function submitViaChatCompletions(
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
  promptPolicy?: ImageGenerationParams['promptPolicy'],
): Promise<ImageGenerationResult> {
  const endpoint = buildEndpoint(baseUrl, 'chat/completions');

  const requestBody = buildChatCompletionsImageRequest({ model, prompt, promptPolicy, aspectRatio, resolution, referenceImages });


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
// eslint-disable-next-line @typescript-eslint/no-explicit-any
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
      throw createDescribedFetchError(fetchErr, { endpoint });
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
  const data = parseChatCompletionsImageResponseText(responseText);

  // Extract image from response - multiple possible formats
  const imageUrl = extractChatCompletionsImageUrl(data);
  if (imageUrl) return { imageUrl };

  throw new Error(`未能从响应中提取图片 URL(响应片段: ${responseText.slice(0, 120)})`);
}


/**
 * gpt-image 系模型标准 images/generations 通道失败后的同 binding 兜底：
 * ① new-api 异步 job 通道（/v1/images/jobs 提交 + 轮询）
 * ② chat/completions 多模态生图通道
 */
export async function tryGptImageFallbackChannels(options: {
  prompt: string;
  aspectRatio: string;
  resolution: string;
  apiKey: string;
  referenceImages?: string[];
  model: string;
  baseUrl: string;
  keyManager?: { getCurrentKey?: () => string | null; handleError?: (status: number, errorText?: string) => boolean };
  operationId?: string;
  promptPolicy?: ImageGenerationParams['promptPolicy'];
  cause: unknown;
}): Promise<{ result: ImageGenerationResult | null; channelFailures: string[] }> {
  const { prompt, aspectRatio, resolution, apiKey, referenceImages, model, baseUrl, keyManager, operationId, promptPolicy, cause } = options;

  // 兜底通道失败原因要并入最终错误:用户此前只能看到主通道错误,兜底真实死因只进诊断日志,排查方向会被带偏。
  const channelFailures: string[] = [];
  const describeChannelFailure = (label: string, error: unknown): string => {
    const message = error instanceof Error ? error.message : String(error);
    const clipped = message.length > 120 ? `${message.slice(0, 120)}…` : message;
    const line = `${label}:${clipped}`;
    channelFailures.push(line);
    return line;
  };

  try {
    const submitted = await submitImageJobTask(prompt, aspectRatio, resolution, apiKey, referenceImages, model, baseUrl, keyManager, operationId);
    void logEvent({
      level: 'info',
      category: 'ai',
      operationId,
      message: 'Image generation job fallback submitted',
      context: { model, taskId: submitted.taskId, cause: cause instanceof Error ? cause.message : String(cause) },
    });
    const imageUrl = await pollTaskStatusImpl(submitted.taskId, apiKey, baseUrl, undefined, submitted.pollUrl, operationId);
    void logEvent({
      level: 'info',
      category: 'ai',
      operationId,
      message: 'Image generation job fallback completed',
      context: { model, taskId: submitted.taskId },
    });
    return { result: { imageUrl, taskId: submitted.taskId }, channelFailures };
  } catch (jobError) {
    void logEvent({
      level: 'warn',
      category: 'ai',
      operationId,
      message: 'Image generation job fallback failed',
      context: { model, failure: describeChannelFailure('job 异步通道', jobError) },
      error: jobError,
    });
  }

  try {
    const chatResult = await submitViaChatCompletions(prompt, model, apiKey, baseUrl, aspectRatio, referenceImages, resolution, keyManager, undefined, operationId, promptPolicy);
    void logEvent({
      level: 'info',
      category: 'ai',
      operationId,
      message: 'Image generation chat fallback completed',
      context: { model, hasImageUrl: Boolean(chatResult.imageUrl) },
    });
    return { result: chatResult, channelFailures };
  } catch (chatError) {
    void logEvent({
      level: 'warn',
      category: 'ai',
      operationId,
      message: 'Image generation chat fallback failed',
      context: { model, failure: describeChannelFailure('chat 多模态通道', chatError) },
      error: chatError,
    });
  }

  return { result: null, channelFailures };
}

/** 把兜底通道失败原因并到主错误上,保留主错误的 status 与网络失败标记 */
export function augmentErrorWithChannelFailures(error: unknown, channelFailures: string[]): Error {
  const base = error instanceof Error ? error : new Error(String(error));
  type Carried = { status?: number; networkFailure?: boolean; timeoutFailure?: boolean };
  const carried = base as Error & Carried;
  if (!channelFailures.length) return base;
  const augmented = new Error(`${base.message} · 兜底通道也失败(${channelFailures.join(';')})`) as Error & Carried;
  if (typeof carried.status === 'number') augmented.status = carried.status;
  augmented.networkFailure = carried.networkFailure;
  augmented.timeoutFailure = carried.timeoutFailure;
  return augmented;
}

