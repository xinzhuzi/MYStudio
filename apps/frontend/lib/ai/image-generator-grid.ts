import { submitViaChatCompletions } from "./image-generator-core";
import { buildOpenAIImageRequestBody, buildProviderExtensionImageRequestBody, extractImageGenerationResult, isGptImageModel, normalizeImagePromptForGeneration, sdkGenerateImage } from "@/lib/ai/ai-sdk-bridge";
import { getModelEndpointTypes } from "@/lib/ai/config/store-adapter";
import { resolveImageApiFormat } from "@/lib/ai/core";
import { createDescribedFetchError } from "@/lib/ai/fetch-error";
import { isAmbiguousPaidImageException, isAmbiguousPaidImageResult, markAmbiguousPaidImageError } from "@/lib/ai/image-generation-errors";
import { DEFAULT_IMAGE_ENDPOINT, getImageEndpointPaths, getRootBaseUrl } from "@/lib/ai/image-generator-helpers";
import { pollTaskStatus as pollTaskStatusImpl } from "@/lib/ai/image-task-poller";
import { prepareReferenceImagesForTransfer } from "@/lib/ai/image-transfer";
import { createOperationId } from "@/lib/diagnostics/logger";
import { observedFetch } from "@/lib/diagnostics/network";
import { retryOperation } from "@/lib/utils/retry";
import { useAppSettingsStore } from "@/stores/app/app-settings-store";
import { ImageGenerationResult, isMikotoImageProvider, withDescribedFetchError } from "./image-generator-shared";

/**
 * 生图轮询与网格/可灵通道——pollTaskStatus、submitGridImageRequest、submitViaKlingImages。file-size-reduction P1 拆出,体逐字保留。
 */

/** Compatibility façade preserving the historical export and call signature. */
export async function pollTaskStatus(  taskId: string,
  apiKey: string,
  baseUrl: string,
  onProgress?: (progress: number) => void,
  customPollUrl?: string,
  operationId?: string,
  signal?: AbortSignal,
): Promise<string> {
  return pollTaskStatusImpl(taskId, apiKey, baseUrl, onProgress, customPollUrl, operationId, signal);
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
  negativePrompt?: string;
  /** raw=调用方已持有最终 provider-visible 文本(如道劫分镜帧编译产物),传输层禁止再追加/改写 */
  promptPolicy?: "enhanced" | "raw";
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
    negativePrompt,
    promptPolicy,
    apiKey,
    baseUrl,
    aspectRatio = imageSettings.defaultAspectRatio,
    resolution = imageSettings.defaultResolution,
    referenceImages,
    keyManager,
    signal,
  } = params;
  const normalizedPrompt = normalizeImagePromptForGeneration({ prompt, negativePrompt, promptPolicy });
  const transferReferenceImages = await prepareReferenceImagesForTransfer(referenceImages);
  const normalizedBase = baseUrl.replace(/\/+$/, '');
  const mikotoPaidBoundary = isMikotoImageProvider(normalizedBase);
  const operationId = createOperationId('grid-image');

  // 检测 API 格式（与 generateImage 一致）
  const endpointTypes = getModelEndpointTypes(model);
  const apiFormat = resolveImageApiFormat(endpointTypes, model);

  if (apiFormat === 'openai_chat') {
    // Gemini 等模型通过 chat completions 生图
    const result = await submitViaChatCompletions(normalizedPrompt.prompt, model, apiKey, normalizedBase, aspectRatio, transferReferenceImages, resolution, keyManager, signal, operationId, promptPolicy);
    return { imageUrl: result.imageUrl };
  }

  if (apiFormat === 'kling_image') {
    if (transferReferenceImages?.length) {
      throw new Error('当前 Kling 图片适配器不支持参考图，已在网络请求前阻断');
    }
    const result = await submitViaKlingImages({ prompt: normalizedPrompt.prompt, aspectRatio, negativePrompt: normalizedPrompt.negativePrompt }, model, apiKey, normalizedBase, aspectRatio, keyManager, operationId, signal);
    return { imageUrl: result.imageUrl, taskId: result.taskId };
  }

  // 标准 images/generations 端点（aigc-image / vidu生图 走自定义路径）
  const imagePaths = getImageEndpointPaths(endpointTypes || []);
  const rootBase = getRootBaseUrl(normalizedBase);
  const endpoint = `${rootBase}${imagePaths.submit}`;
  const usesDefaultImagesEndpoint = imagePaths.submit === DEFAULT_IMAGE_ENDPOINT.submit;
  const builtRequest = usesDefaultImagesEndpoint
    ? buildOpenAIImageRequestBody({ model, prompt: normalizedPrompt.prompt, aspectRatio, resolution, referenceImages: transferReferenceImages, negativePrompt: normalizedPrompt.negativePrompt, promptPolicy })
    : buildProviderExtensionImageRequestBody({ model, prompt: normalizedPrompt.prompt, aspectRatio, resolution, referenceImages: transferReferenceImages, negativePrompt: normalizedPrompt.negativePrompt, promptPolicy });
  const requestBody = builtRequest.body;


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
      promptPolicy,
      referenceImages: transferReferenceImages,
      operationId,
      endpointFamily: 'grid-images-generations',
      abortSignal: signal,
      maxRetries: mikotoPaidBoundary ? 0 : 2,
    });
    if (sdkResult.success && sdkResult.imageUrl) {
      return { imageUrl: sdkResult.imageUrl };
    }
    if (mikotoPaidBoundary && isAmbiguousPaidImageResult(sdkResult)) {
      throw markAmbiguousPaidImageError(new Error(
        `Mikoto 图片请求结果不确定，已停止兼容重试与 provider fallback: ${sdkResult.error || 'transport failure'}`,
      ));
    }
    throw new Error(sdkResult.error || 'AI SDK 图片生成失败');
  }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
  let data: Record<string, any>;
  try {
    data = await retryOperation(async () => {
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
    maxRetries: mikotoPaidBoundary ? 0 : 3,
    baseDelay: 3000,
    retryOn429: true,
  });
  } catch (error) {
    if (mikotoPaidBoundary && isAmbiguousPaidImageException(error)) {
      throw markAmbiguousPaidImageError(error);
    }
    throw createDescribedFetchError(error, { endpoint });
  }

  // 标准格式: { data: [{ url, task_id }] } 或 OpenAI-compatible { data: [{ b64_json }] }
  const extracted = extractImageGenerationResult(data);
  const imageUrl = extracted.imageUrl;
  const taskId = extracted.taskId;

  // 如果只有 taskId 没有 imageUrl，自动轮询获取结果（与 generateImage 行为一致）
  if (!imageUrl && taskId) {
    const pollUrl = `${rootBase}${imagePaths.poll(taskId)}`;
    const polledUrl = await pollTaskStatus(taskId, params.keyManager?.getCurrentKey?.() || apiKey, normalizedBase, undefined, pollUrl, operationId, signal);
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
export async function submitViaKlingImages(
  params: { prompt: string; aspectRatio?: string; negativePrompt?: string },
  model: string,
  apiKey: string,
  baseUrl: string,
  aspectRatio: string,
  keyManager?: { getCurrentKey?: () => string | null; handleError?: (status: number, errorText?: string) => boolean },
  operationId?: string,
  signal?: AbortSignal,
): Promise<ImageGenerationResult> {
  const rootBase = baseUrl.replace(/\/v\d+$/, '');
  const nativePath = model === 'kling-omni-image'
    ? 'kling/v1/images/omni-image'
    : 'kling/v1/images/generations';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
  const body: Record<string, any> = { prompt: params.prompt, model };
  if (aspectRatio) body.aspect_ratio = aspectRatio;
  if (params.negativePrompt) body.negative_prompt = params.negativePrompt;


  const data = await withDescribedFetchError(() => retryOperation(async () => {
    const currentApiKey = keyManager?.getCurrentKey?.() || apiKey;
    if (signal?.aborted) throw signal.reason || new Error('用户已取消');
    const response = await observedFetch(`${rootBase}/${nativePath}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${currentApiKey}` },
      body: JSON.stringify(body),
      signal,
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
  }), `${rootBase}/${nativePath}`);

  const directUrl = data.data?.[0]?.url;
  if (directUrl) return { imageUrl: directUrl };

  const taskId = data.data?.task_id;
  if (!taskId) throw new Error('Kling image 返回空任务 ID');

  const pollUrl = `${rootBase}/${nativePath}/${taskId}`;
  const pollInterval = 2000;
  const maxAttempts = 60;

  for (let i = 0; i < maxAttempts; i++) {
    await new Promise<void>((resolve, reject) => {
      const onAbort = () => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        reject(signal?.reason || new Error('用户已取消'));
      };
      const timer = setTimeout(() => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      }, pollInterval);
      if (!signal) return;
      if (signal.aborted) onAbort();
      else signal.addEventListener('abort', onAbort, { once: true });
    });
    const currentApiKey = keyManager?.getCurrentKey?.() || apiKey;
    if (signal?.aborted) throw signal.reason || new Error('用户已取消');
    const pollResp = await observedFetch(pollUrl, {
      headers: { 'Authorization': `Bearer ${currentApiKey}` },
      signal,
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
