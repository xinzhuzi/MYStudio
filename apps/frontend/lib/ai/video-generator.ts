import { getFeatureConfig } from "@/lib/ai/feature-router";
import { retryOperation } from "@/lib/utils/retry";
import { prepareVideoImageRolesForTransfer } from "@/lib/ai/video-generator-image-transfer";
import { callVolcVideoApi as callVolcVideoApiAdapter } from "@/lib/ai/video-generator-volc-adapter";
import { callKlingVideoApi, callOpenAIOfficialVideoApi, callReplicateVideoApi, callUnifiedVideoApi, callWanVideoApi } from "./video-generator-channels";
import { toGrokAspectRatio } from "./video-generator-media";
import { detectVideoApiFormat, ensureMinImageSize, sleepOrAbort, videoFetch } from "./video-generator-shared";

export { buildImageWithRoles, convertToHttpUrl, prepareVideoImageRolesForTransfer } from "@/lib/ai/video-generator-image-transfer";


// Call video generation API — 根据模型自动路由到正确的 MemeFast API 格式
export async function callVideoGenerationApi(
  apiKey: string,
  prompt: string,
  duration: number,
  aspectRatio: string,
  imageWithRoles: Array<{ url: string; role: 'first_frame' | 'last_frame' }>,
  onProgress?: (progress: number) => void,
  keyManager?: { getCurrentKey?: () => string | null; handleError: (status: number, errorText?: string) => boolean; getAvailableKeyCount: () => number; getTotalKeyCount: () => number },
  platform?: string,
  videoResolution?: '480p' | '720p' | '1080p',
  /** Seedance 2.0: 视频引用 URL 列表 (运镜/动作复刻) */
  videoRefs?: string[],
  /** Seedance 2.0: 音频引用 URL 列表 (节奏/BGM) */
  audioRefs?: string[],
  /** Seedance 2.0: 是否生成音频（默认 true） */
  enableAudio?: boolean,
  /** Seedance 2.0: 是否锁定运镜（默认 false） */
  cameraFixed?: boolean,
  /** 外部中止信号，用于停止生成时真正取消网络请求 */
  signal?: AbortSignal,
): Promise<string> {
  const featureConfig = getFeatureConfig('video_generation');
  const resolvedPlatform = platform || featureConfig?.platform;
  if (!resolvedPlatform) {
    throw new Error('请先在设置中配置视频生成服务映射');
  }
  const model = featureConfig?.models?.[0];
  if (!model) {
    throw new Error('请先在设置中配置视频生成模型');
  }
  const videoBaseUrl = featureConfig?.baseUrl?.replace(/\/+$/, '');
  if (!videoBaseUrl) {
    throw new Error('请先在设置中配置视频生成服务映射');
  }

  // 确保所有输入图片满足视频 API 的最小尺寸要求（如 Seedance ≥ 300px）
  const transferImages = await prepareVideoImageRolesForTransfer(imageWithRoles);
  const processedImages: Array<{ url: string; role: 'first_frame' | 'last_frame' }> = [];
  for (const image of transferImages) {
    processedImages.push({ ...image, url: await ensureMinImageSize(image.url) });
  }

  // 根据元数据/模型名检测 API 格式并路由，包裹重试（覆盖 429/503/529 等）
  const format = detectVideoApiFormat(model);

  return retryOperation(() => {
    if (signal?.aborted) return Promise.reject(new Error('用户已取消'));
    // 每次重试动态取当前 key（keyManager.handleError 已 rotate，需要用新 key）
    const currentApiKey = keyManager?.getCurrentKey?.() || apiKey;
    switch (format) {
      case 'openai_official':
        return callOpenAIOfficialVideoApi(currentApiKey, prompt, videoBaseUrl, model, aspectRatio, duration, videoResolution, onProgress, keyManager, signal);
      case 'volc':
        return callVolcVideoApiAdapter(currentApiKey, prompt, videoBaseUrl, model, aspectRatio, processedImages, videoResolution, duration, cameraFixed, onProgress, keyManager, videoRefs, audioRefs, signal);
      case 'wan':
        return callWanVideoApi(currentApiKey, prompt, videoBaseUrl, model, processedImages, videoResolution, duration, enableAudio, onProgress, keyManager, signal);
      case 'kling':
        return callKlingVideoApi(currentApiKey, prompt, videoBaseUrl, model, aspectRatio, processedImages, duration, onProgress, keyManager, signal);
      case 'replicate':
        return callReplicateVideoApi(currentApiKey, prompt, videoBaseUrl, model, aspectRatio, processedImages, duration, videoResolution, onProgress, keyManager, signal);
      default:
        // 统一格式: grok, veo, luma, runway, 海螺, 即梦, wan2.6, vidu 等
        return callUnifiedVideoApi(currentApiKey, prompt, videoBaseUrl, model, aspectRatio, processedImages, videoResolution, duration, onProgress, keyManager, signal);
    }
  }, {
    maxRetries: 3,
    baseDelay: 3000,
    retryOn429: true,
    onRetry: (attempt, delay) => {
      const availableKeys = keyManager?.getAvailableKeyCount?.() ?? 1;
      console.warn(`[VideoGen] Retryable error, retrying in ${delay}ms... (Attempt ${attempt}/3, available keys: ${availableKeys})`);
    },
  });
}

// ==================== 视频统一格式 (grok/veo/luma/runway/海螺/即梦/doubao-seedance/wan2.6/vidu 等) ====================

export async function callJuxinVideoGenerationApi(
  apiKey: string,
  prompt: string,
  aspectRatio: string,
  imageWithRoles: Array<{ url: string; role: 'first_frame' | 'last_frame' }>,
  onProgress?: (progress: number) => void,
  keyManager?: { getCurrentKey?: () => string | null; handleError: (status: number, errorText?: string) => boolean; getAvailableKeyCount: () => number; getTotalKeyCount: () => number },
  baseUrl?: string,
  model?: string,
  signal?: AbortSignal,
): Promise<string> {
  const apiBaseUrl = baseUrl?.replace(/\/+$/, '');
  if (!apiBaseUrl) {
    throw new Error('请先在设置中配置视频生成服务映射');
  }
  if (!model) {
    throw new Error('请先在设置中配置视频生成模型');
  }
  
  // Extract first frame URL for Grok
  const images: string[] = [];
  const firstFrame = imageWithRoles.find(img => img.role === 'first_frame');
  if (firstFrame?.url) {
    images.push(firstFrame.url);
  }
  
  const requestBody = {
    model,
    prompt,
    aspect_ratio: toGrokAspectRatio(aspectRatio),
    size: '720P', // Currently only 720P is supported
    images,
  };
  

  // Submit video generation request（带重试，覆盖 429/503/529，每次重试动态取 key）
  const submitData = await retryOperation(async () => {
    // 每次重试动态取当前 key，利用 keyManager rotate 后的新 key
    const currentApiKey = keyManager?.getCurrentKey?.() || apiKey;
    const submitResponse = await videoFetch(`${apiBaseUrl}/v1/video/create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Authorization': `Bearer ${currentApiKey}`,
      },
      body: JSON.stringify(requestBody),
    });

    if (!submitResponse.ok) {
      const errorText = await submitResponse.text();
      console.error('[VideoGen] Grok video error:', submitResponse.status, errorText);

      if (keyManager?.handleError(submitResponse.status, errorText)) {
      }

      let errorMessage = `Grok API failed: ${submitResponse.status}`;
      try {
        const errorJson = JSON.parse(errorText);
        errorMessage = errorJson.error?.message || errorJson.message || errorMessage;
      } catch {
        // Ignore JSON parse errors
      }

      if (submitResponse.status === 401 || submitResponse.status === 403) {
        throw new Error('API Key 无效或已过期');
      }
      const err = new Error(errorMessage) as Error & { status?: number };
      err.status = submitResponse.status;
      throw err;
    }

    return submitResponse.json();
  }, {
    maxRetries: 3,
    baseDelay: 3000,
    retryOn429: true,
    onRetry: (attempt, delay) => {
      console.warn(`[VideoGen][Grok] Retryable error, retrying in ${delay}ms... (Attempt ${attempt}/3)`);
    },
  });

  // Extract task ID from response
  const taskId = submitData.id;
  if (!taskId) {
    throw new Error('Grok API 返回空的任务 ID');
  }


  // Poll for completion
  const pollInterval = 5000; // 5 seconds for Grok (longer video generation)
  const maxAttempts = 180; // 15 minutes max
  
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const progress = Math.min(20 + Math.floor((attempt / maxAttempts) * 80), 99);
    onProgress?.(progress);

    // Query task status
    const queryUrl = new URL(`${apiBaseUrl}/v1/video/query`);
    queryUrl.searchParams.set('id', taskId);

    const statusResponse = await videoFetch(queryUrl.toString(), {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      signal,
    });

    if (!statusResponse.ok) {
      if (statusResponse.status === 404) {
        throw new Error('任务不存在');
      }
      console.warn('[VideoGen] Grok query failed:', statusResponse.status);
      await sleepOrAbort(pollInterval, signal);
      continue;
    }

    const statusData = await statusResponse.json();

    const status = (statusData.status ?? 'unknown').toString().toLowerCase();

    if (status === 'completed' || status === 'succeeded' || status === 'success') {
      // Extract video URL
      const videoUrl = statusData.video_url || statusData.result_url || statusData.url;
      
      if (!videoUrl) {
        throw new Error('任务完成但没有视频 URL');
      }
      
      return videoUrl;
    }

    if (status === 'failed' || status === 'error') {
      const errorMsg = statusData.error || statusData.error_message || '视频生成失败';
      throw new Error(typeof errorMsg === 'string' ? errorMsg : JSON.stringify(errorMsg));
    }

    // Status is pending/processing, continue polling
    await sleepOrAbort(pollInterval, signal);
  }
  
  throw new Error(`视频生成超时(已轮询 ${maxAttempts} 次、约 ${Math.round((maxAttempts * pollInterval) / 60000)} 分钟仍未出片)`);
}


export { CONTENT_MODERATION_KEYWORDS, detectVideoApiFormat, ensureMinImageSize, getUnifiedEndpointPaths, getVideoApiConfig, handleVideoSubmitError, isContentModerationError, sleepOrAbort, videoFetch } from "./video-generator-shared";
export { callKlingVideoApi, callOpenAIOfficialVideoApi, callReplicateVideoApi, callUnifiedVideoApi, callWanVideoApi } from "./video-generator-channels";
export { extractLastFrameFromVideo, saveVideoLocally, toGrokAspectRatio } from "./video-generator-media";
