// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
import { getFeatureConfig } from "@/lib/ai/feature-router";
import { uploadToImageHost, isImageHostConfigured } from "@/lib/image-host";
import { saveVideoToLocal } from "@/lib/image-storage";
import { useAPIConfigStore } from "@/stores/api-config-store";
import { retryOperation } from "@/lib/utils/retry";
import { toRunwayRatio } from "@/lib/ai/video-request-sizing";
import {
  detectVideoApiFormat as detectVideoApiFormatFromRouting,
  getUnifiedEndpointPaths as getUnifiedEndpointPathsFromRouting,
} from "@/lib/ai/video-generator-routing";
import {
  extractVideoUrl,
  normalizeUrl,
} from "@/lib/ai/video-response-utils";
import {
  buildImageWithRoles,
  convertToHttpUrl,
  prepareVideoImageRolesForTransfer,
} from "@/lib/ai/video-generator-image-transfer";
import { callVolcVideoApi as callVolcVideoApiAdapter } from "@/lib/ai/video-generator-volc-adapter";
import { callOpenAIOfficialVideoApiAdapter } from "@/lib/ai/video-generator-openai-adapter";
import { callWanVideoApiAdapter } from "@/lib/ai/video-generator-wan-adapter";
import { callKlingVideoApiAdapter } from "@/lib/ai/video-generator-kling-adapter";
import { callReplicateVideoApiAdapter } from "@/lib/ai/video-generator-replicate-adapter";
export { buildImageWithRoles, convertToHttpUrl, prepareVideoImageRolesForTransfer } from "@/lib/ai/video-generator-image-transfer";

// ==================== Content Moderation ====================

/**
 * Keywords indicating content moderation errors
 * Based on ScriptAgent's CONTENT_MODERATION_KEYWORDS
 */
const CONTENT_MODERATION_KEYWORDS = [
  'moderation',
  'authentication',
  'content_sensitive',
  'violation',
  'sensitive',
  'policy',
  'refused',
  'rejected',
  'inappropriate',
  'blocked',
  'review',
  'prohibited',
  'not_allowed',
  'unsafe',
  '内容审核',
  '违规',
  '敏感',
  '禁止',
  '拒绝',
  '不合规',
] as const;

/**
 * Check if an error is related to content moderation
 * @param error - Error message or error object
 * @returns true if it's a moderation error
 */
export function isContentModerationError(error: string | Error | unknown): boolean {
  const errorStr = error instanceof Error
    ? error.message.toLowerCase()
    : String(error).toLowerCase();

  return CONTENT_MODERATION_KEYWORDS.some(keyword => 
    errorStr.includes(keyword.toLowerCase())
  );
}

// Get API configuration for video generation
export function getVideoApiConfig() {
  const featureConfig = getFeatureConfig('video_generation');
  if (!featureConfig) {
    return null;
  }
  
  const keyManager = featureConfig.keyManager;
  const apiKey = keyManager.getCurrentKey() || '';
  const platform = featureConfig.platform;
  const model = featureConfig.models?.[0];
  if (!model) {
    return null;
  }
  const videoBaseUrl = featureConfig.baseUrl?.replace(/\/+$/, '');
  if (!videoBaseUrl) {
    return null;
  }
  
  return {
    apiKey,
    keyManager,
    platform,
    model,
    videoBaseUrl,
  };
}

// ==================== 模型路由检测 ====================

/**
 * 根据模型端点类型查找对应的提交/轮询 URL 路径
 */
function getUnifiedEndpointPaths(endpointTypes: string[]): { submit: string; poll: (id: string) => string } {
  return getUnifiedEndpointPathsFromRouting(endpointTypes);
}

/**
 * 根据模型的 supported_endpoint_types 元数据检测应使用的视频 API 格式
 * 优先使用 MemeFast /api/pricing_new 同步的元数据，fallback 到模型名推断
 */
function detectVideoApiFormat(model: string): 'openai_official' | 'unified' | 'volc' | 'wan' | 'kling' | 'replicate' {
  return detectVideoApiFormatFromRouting(model, useAPIConfigStore.getState().modelEndpointTypes[model] || []);
}

// ==================== 通用错误处理 ====================

function handleVideoSubmitError(
  status: number,
  errorText: string,
  keyManager?: { handleError: (status: number, errorText?: string) => boolean; getCurrentKey?: () => string | null },
): never {
  if (keyManager?.handleError(status, errorText)) {
    const nextKey = keyManager.getCurrentKey?.();
    const keyHint = nextKey ? `${nextKey.substring(0, 8)}…` : '(none)';
    console.log(`[VideoGen] Rotated to next key: ${keyHint} (due to ${status})`);
  }
  let errorMessage = `视频 API 错误: ${status}`;
  try {
    const errorJson = JSON.parse(errorText);
    errorMessage = errorJson.error?.message || errorJson.message || errorMessage;
  } catch { /* ignore */ }
  if (status === 401 || status === 403) throw new Error('API Key 无效或已过期');
  if (status === 429) {
    const err = new Error('API 请求过于频繁，请稍后重试') as Error & { status?: number };
    err.status = 429;
    throw err;
  }
  // 所有 500/502/503/529 均视为可重试的临时服务错误，携带 status 供重试机制识别
  if (status >= 500) {
    const err = new Error(errorMessage || `上游服务暂时不可用 (${status})`) as Error & { status?: number };
    err.status = status;
    throw err;
  }
  const err = new Error(errorMessage) as Error & { status?: number };
  err.status = status;
  throw err;
}

// ==================== 图片最小尺寸保障 ====================

/**
 * 视频生成 API 通常要求输入图片满足最小尺寸（如 Seedance 要求宽度 ≥ 300px）。
 * 当九宫格切割后的图片尺寸过小时，自动放大到满足最低要求后重新上传。
 * @param imageUrl  HTTP URL 图片地址
 * @param minDimension  宽高的最小像素值（默认 300，匹配 Seedance 等模型要求）
 * @returns 原始 URL（尺寸达标）或放大后重新上传的新 URL
 */
async function ensureMinImageSize(
  imageUrl: string,
  minDimension: number = 300,
): Promise<string> {
  if (!imageUrl || !imageUrl.startsWith('http')) return imageUrl;

  let objectUrl: string | undefined;
  try {
    // 通过 fetch 加载图片为 blob，避免 CORS 问题
    const response = await fetch(imageUrl);
    if (!response.ok) {
      console.warn('[VideoGen] ensureMinImageSize: fetch failed', response.status);
      return imageUrl;
    }
    const blob = await response.blob();
    objectUrl = URL.createObjectURL(blob);

    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('Failed to decode image'));
      image.src = objectUrl!;
    });

    const { naturalWidth, naturalHeight } = img;

    if (naturalWidth >= minDimension && naturalHeight >= minDimension) {
      URL.revokeObjectURL(objectUrl);
      return imageUrl; // 尺寸达标
    }

    // 计算等比放大系数
    const scaleW = naturalWidth < minDimension ? minDimension / naturalWidth : 1;
    const scaleH = naturalHeight < minDimension ? minDimension / naturalHeight : 1;
    const scale = Math.max(scaleW, scaleH);
    const newWidth = Math.ceil(naturalWidth * scale);
    const newHeight = Math.ceil(naturalHeight * scale);

    console.log(`[VideoGen] Image too small (${naturalWidth}×${naturalHeight}), upscaling to ${newWidth}×${newHeight}`);

    // Canvas 放大
    const canvas = document.createElement('canvas');
    canvas.width = newWidth;
    canvas.height = newHeight;
    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, newWidth, newHeight);
    URL.revokeObjectURL(objectUrl); // drawImage 完成后释放
    objectUrl = undefined;
    const upscaledDataUrl = canvas.toDataURL('image/png');

    // 重新上传到图床
    if (!isImageHostConfigured()) {
      console.warn('[VideoGen] Image host not configured, cannot re-upload upscaled image');
      return imageUrl;
    }
    const result = await uploadToImageHost(upscaledDataUrl, {
      name: `upscaled_${Date.now()}`,
      expiration: 15552000,
    });
    if (result.success && result.url) {
      console.log(`[VideoGen] Upscaled & re-uploaded: ${result.url.substring(0, 60)}`);
      return result.url;
    }

    console.warn('[VideoGen] Re-upload failed, using original URL');
    return imageUrl;
  } catch (e) {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    console.warn('[VideoGen] ensureMinImageSize failed, using original:', e);
    return imageUrl;
  }
}

// ==================== 视频生成主入口 ====================

/** AbortSignal 感知的 sleep：若信号触发则立即以 '用户已取消' 拒绝 */
function sleepOrAbort(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('用户已取消'));
    const tid = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(tid); reject(new Error('用户已取消')); }, { once: true });
  });
}

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
  console.log('[VideoGen] Detected API format:', { model, format, platform: resolvedPlatform });

  return retryOperation(() => {
    if (signal?.aborted) return Promise.reject(new Error('用户已取消'));
    // 每次重试动态取当前 key（keyManager.handleError 已 rotate，需要用新 key）
    const currentApiKey = keyManager?.getCurrentKey?.() || apiKey;
    const keyHint = currentApiKey ? `${currentApiKey.substring(0, 8)}…` : '(none)';
    console.log(`[VideoGen] Using key: ${keyHint}, format: ${format}`);
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
// MemeFast 文档: POST /v1/video/generations (primary) + /v1/video/create (fallback)
//             GET  /v1/video/generations/{id} (primary) + /v1/video/query?id= (fallback)

async function callUnifiedVideoApi(
  apiKey: string,
  prompt: string,
  baseUrl: string,
  model: string,
  aspectRatio: string,
  imageWithRoles: Array<{ url: string; role: 'first_frame' | 'last_frame' }>,
  videoResolution?: string,
  duration?: number,
  onProgress?: (progress: number) => void,
  keyManager?: { handleError: (status: number, errorText?: string) => boolean },
  signal?: AbortSignal,
): Promise<string> {
  // 检测模型端点类型，决定特殊处理和 URL 路径
  const endpointTypes = useAPIConfigStore.getState().modelEndpointTypes[model] || [];
  const isLuma = endpointTypes.some(t => /luma/i.test(t));
  const isRunway = endpointTypes.some(t => /runway/i.test(t));
  const isGrok = endpointTypes.some(t => /grok/i.test(t)) || /grok/i.test(model);
  const endpointPaths = getUnifiedEndpointPaths(endpointTypes);

  // 构建请求体（对齐 freedom-api.ts generateVideoViaUnified）
  const body: Record<string, unknown> = { model, prompt };
  const metadata: Record<string, unknown> = {};

  // Duration: Luma requires string with unit ("5s"), other models use number
  if (duration) {
    body.duration = isLuma ? `${duration}s` : duration;
  }

  // AspectRatio 处理策略（各模型格式不同，按模型分别处理）：
  // - Runway: metadata.ratio（像素格式 1280:720）
  // - Grok: 顶层 aspect_ratio（xAI 官方格式，支持 16:9/9:16/4:3/3:4/3:2/2:3/1:1）
  // - 其他统一格式模型: metadata.aspect_ratio
  if (aspectRatio) {
    if (isRunway) {
      metadata.ratio = toRunwayRatio(aspectRatio);
    } else if (isGrok) {
      body.aspect_ratio = aspectRatio;
    } else {
      metadata.aspect_ratio = aspectRatio;
    }
  }

  // Resolution: Grok supports "720p"/"480p" at top level; others via metadata
  if (videoResolution) {
    if (isRunway) {
      // Runway doesn't use resolution field
    } else if (isGrok) {
      body.resolution = videoResolution;
    } else {
      metadata.resolution = videoResolution;
    }
  }

  // Image inputs: single `image` field (not array)
  const firstFrame = imageWithRoles.find(img => img.role === 'first_frame');
  if (firstFrame?.url) {
    body.image = firstFrame.url;
  }
  const lastFrame = imageWithRoles.find(img => img.role === 'last_frame');
  if (lastFrame?.url) {
    metadata.image_end = lastFrame.url;
  }

  if (Object.keys(metadata).length > 0) body.metadata = metadata;

  // 绝对路径拼接：从域名根开始
  const rootBase = baseUrl.replace(/\/v\d+$/, '');
  const submitUrl = `${rootBase}${endpointPaths.submit}`;
  console.log(`[VideoGen] Unified format → POST ${endpointPaths.submit}`, { model, metadata, hasImage: !!firstFrame?.url });

  // 提交：直接使用端点类型对应的 URL
  const resp = await fetch(submitUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const errorText = await resp.text();
    handleVideoSubmitError(resp.status, errorText, keyManager);
  }
  const submitData = await resp.json();

  console.log('[VideoGen] Unified submit response:', submitData);

  // 提取任务 ID（覆盖各平台的嵌套响应格式）
  const taskId = (
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
    submitData.output?.id
  )?.toString();

  // 某些模型直接返回结果
  const directUrl = extractVideoUrl(submitData);
  if (directUrl) return directUrl;
  if (!taskId) {
    console.error('[VideoGen] Cannot extract taskId from submit response:', JSON.stringify(submitData).substring(0, 300));
    throw new Error(`返回空的任务 ID（响应格式未识别，请检查控制台日志）`);
  }

  // 轮询：直接使用端点类型对应的 URL
  const pollUrl = `${rootBase}${endpointPaths.poll(taskId)}`;
  const pollInterval = 5000;
  const maxAttempts = 180;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    onProgress?.(Math.min(20 + Math.floor((attempt / maxAttempts) * 80), 99));
    await sleepOrAbort(pollInterval, signal);

    const statusResponse = await fetch(pollUrl, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      signal,
    });

    if (!statusResponse.ok) continue;

    const statusData = await statusResponse.json();
    console.log(`[VideoGen] Unified task ${taskId} status:`, statusData);

    const status = String(statusData.status || statusData.state || statusData.data?.status || '').toLowerCase();

    if (status === 'completed' || status === 'succeeded' || status === 'success') {
      const videoUrl = extractVideoUrl(statusData);
      if (!videoUrl) throw new Error('任务完成但没有视频 URL');
      return videoUrl;
    }

    if (status === 'failed' || status === 'error' || status === 'cancelled') {
      const errorMsg = statusData.error?.message || statusData.error || statusData.message || '视频生成失败';
      throw new Error(typeof errorMsg === 'string' ? errorMsg : JSON.stringify(errorMsg));
    }
  }
  throw new Error('视频生成超时');
}

// ==================== Volcengine 豆包/Seedance 格式 ====================
// MemeFast 文档: POST /volc/v1/contents/generations/tasks + GET /volc/v1/contents/generations/tasks/{taskId}
// 火山方舟文档: https://www.volcengine.com/docs/82379/1520757

async function callVolcVideoApi(
  apiKey: string,
  prompt: string,
  baseUrl: string,
  model: string,
  aspectRatio: string,
  imageWithRoles: Array<{ url: string; role: string }>,
  videoResolution?: string,
  duration?: number,
  cameraFixed?: boolean,
  onProgress?: (progress: number) => void,
  keyManager?: { handleError: (status: number, errorText?: string) => boolean },
  /** Seedance 2.0: 视频引用 URL 列表 */
  videoRefs?: string[],
  /** Seedance 2.0: 音频引用 URL 列表 */
  audioRefs?: string[],
  signal?: AbortSignal,
): Promise<string> {
  return callVolcVideoApiAdapter(apiKey, prompt, baseUrl, model, aspectRatio, imageWithRoles, videoResolution, duration, cameraFixed, onProgress, keyManager, videoRefs, audioRefs, signal);
}

// ==================== 通义万象 wan 格式 ====================
// MemeFast 文档:
//   创建: POST /alibailian/api/v1/services/aigc/video-generation/video-synthesis
//   查询: GET  /alibailian/api/v1/tasks/{task_id}

async function callWanVideoApi(
  apiKey: string,
  prompt: string,
  baseUrl: string,
  model: string,
  imageWithRoles: Array<{ url: string; role: string }>,
  resolution?: string,
  duration?: number,
  enableAudio?: boolean,
  onProgress?: (progress: number) => void,
  keyManager?: { handleError: (status: number, errorText?: string) => boolean },
  signal?: AbortSignal,
): Promise<string> {
  return callWanVideoApiAdapter(
    apiKey,
    prompt,
    baseUrl,
    model,
    imageWithRoles,
    resolution,
    duration,
    enableAudio,
    onProgress,
    keyManager,
    signal,
    { handleVideoSubmitError, sleepOrAbort },
  );
}

// ==================== Kling 可灵全系列格式 ====================
// MemeFast: POST /kling/v1/videos/{path} + GET /kling/v1/videos/{path}/{task_id}

async function callKlingVideoApi(
  apiKey: string,
  prompt: string,
  baseUrl: string,
  model: string,
  aspectRatio: string,
  imageWithRoles: Array<{ url: string; role: string }>,
  duration?: number,
  onProgress?: (progress: number) => void,
  keyManager?: { handleError: (status: number, errorText?: string) => boolean },
  signal?: AbortSignal,
): Promise<string> {
  return callKlingVideoApiAdapter(
    apiKey,
    prompt,
    baseUrl,
    model,
    aspectRatio,
    imageWithRoles,
    duration,
    onProgress,
    keyManager,
    signal,
    { handleVideoSubmitError, sleepOrAbort },
  );
}

// ==================== OpenAI 官方视频格式 (sora-2) ====================
// MemeFast: POST /v1/videos (FormData) + GET /v1/videos/{taskId}

async function callOpenAIOfficialVideoApi(
  apiKey: string,
  prompt: string,
  baseUrl: string,
  model: string,
  aspectRatio: string,
  duration?: number,
  videoResolution?: string,
  onProgress?: (progress: number) => void,
  keyManager?: { handleError: (status: number, errorText?: string) => boolean },
  signal?: AbortSignal,
): Promise<string> {
  return callOpenAIOfficialVideoApiAdapter(
    apiKey,
    prompt,
    baseUrl,
    model,
    aspectRatio,
    duration,
    videoResolution,
    onProgress,
    keyManager,
    signal,
    { handleVideoSubmitError, sleepOrAbort },
  );
}

// ==================== Replicate 视频格式 ====================
// MemeFast: POST /replicate/v1/predictions + GET /replicate/v1/predictions/{id}

async function callReplicateVideoApi(
  apiKey: string,
  prompt: string,
  baseUrl: string,
  model: string,
  aspectRatio: string,
  imageWithRoles: Array<{ url: string; role: string }>,
  duration?: number,
  videoResolution?: string,
  onProgress?: (progress: number) => void,
  keyManager?: { handleError: (status: number, errorText?: string) => boolean },
  signal?: AbortSignal,
): Promise<string> {
  return callReplicateVideoApiAdapter(
    apiKey,
    prompt,
    baseUrl,
    model,
    aspectRatio,
    imageWithRoles,
    duration,
    videoResolution,
    onProgress,
    keyManager,
    signal,
    { handleVideoSubmitError, sleepOrAbort },
  );
}

// Save video to local and return the local URL
export async function saveVideoLocally(videoUrl: string, sceneId: number): Promise<string> {
  try {
    const filename = `scene_${sceneId + 1}_${Date.now()}.mp4`;
    const localUrl = await saveVideoToLocal(videoUrl, filename);
    console.log('[VideoGen] Video saved locally:', localUrl);
    return localUrl;
  } catch (e) {
    console.warn('[VideoGen] Failed to save video locally, using URL:', e);
    return videoUrl;
  }
}

/**
 * Extract the last frame from a video URL as base64 image
 * Uses video element + canvas for frame extraction
 * @param videoUrl - Video URL (HTTP or local)
 * @param seekOffset - Seconds before end to extract (default 0.1s from end)
 * @returns Base64 data URL of the frame, or null on failure
 */
export async function extractLastFrameFromVideo(
  videoUrl: string,
  seekOffset: number = 0.1
): Promise<string | null> {
  // local-image:// 是 Electron 注册的自定义协议，可以直接使用
  // 不需要转换为 file://
  const resolvedUrl = videoUrl;
  console.log('[VideoGen] Loading video for frame extraction:', resolvedUrl);
  
  return new Promise((resolve) => {
    const video = document.createElement('video');
    // local-image:// 是受信任的协议，不需要 crossOrigin
    if (!resolvedUrl.startsWith('local-image://') && !resolvedUrl.startsWith('file://')) {
      video.crossOrigin = 'anonymous';
    }
    video.preload = 'auto';
    video.muted = true;
    video.playsInline = true;
    
    let hasResolved = false;
    let targetTime = -1; // -1 表示还未设置
    let isSeekStarted = false;
    
    const cleanup = () => {
      video.onloadedmetadata = null;
      video.onloadeddata = null;
      video.oncanplaythrough = null;
      video.onseeked = null;
      video.onerror = null;
      video.ontimeupdate = null;
      video.pause();
      video.src = '';
      video.load();
    };
    
    const timeoutId = setTimeout(() => {
      if (!hasResolved) {
        hasResolved = true;
        console.warn('[VideoGen] extractLastFrameFromVideo timeout');
        cleanup();
        resolve(null);
      }
    }, 30000); // 30s timeout
    
    const captureFrame = () => {
      if (hasResolved) return;
      
      // 确保视频尺寸有效
      if (video.videoWidth === 0 || video.videoHeight === 0) {
        console.warn('[VideoGen] Video dimensions not ready, waiting...');
        setTimeout(captureFrame, 100);
        return;
      }
      
      try {
        video.pause();
        
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext('2d');
        
        if (!ctx) {
          console.warn('[VideoGen] Cannot get canvas context');
          hasResolved = true;
          clearTimeout(timeoutId);
          cleanup();
          resolve(null);
          return;
        }
        
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
        
        console.log('[VideoGen] Extracted last frame:', {
          width: canvas.width,
          height: canvas.height,
          duration: video.duration,
          currentTime: video.currentTime,
          targetWas: targetTime,
        });
        
        hasResolved = true;
        clearTimeout(timeoutId);
        cleanup();
        resolve(dataUrl);
      } catch (e) {
        console.warn('[VideoGen] Failed to extract frame:', e);
        hasResolved = true;
        clearTimeout(timeoutId);
        cleanup();
        resolve(null);
      }
    };
    
    // 开始 seek 的函数
    const startSeek = () => {
      if (hasResolved || isSeekStarted) return;
      
      const duration = video.duration;
      if (!duration || duration <= 0 || !isFinite(duration)) {
        console.warn('[VideoGen] Invalid video duration:', duration);
        return;
      }
      
      isSeekStarted = true;
      targetTime = Math.max(0.1, duration - seekOffset);
      console.log('[VideoGen] Starting seek, duration:', duration, 'target:', targetTime);
      
      video.currentTime = targetTime;
    };
    
    // 方法：使用 timeupdate 监听播放进度，当接近目标时间时捕获
    video.ontimeupdate = () => {
      if (hasResolved || targetTime < 0) return; // 未开始 seek 时忽略
      
      // 当播放到目标时间附近时捕获帧
      if (video.currentTime >= targetTime - 0.05) {
        console.log('[VideoGen] timeupdate reached target, currentTime:', video.currentTime, 'target:', targetTime);
        captureFrame();
      }
    };
    
    // 当 seek 完成时捕获
    video.onseeked = () => {
      if (hasResolved || targetTime < 0) return;
      console.log('[VideoGen] onseeked fired, currentTime:', video.currentTime, 'target:', targetTime);
      
      // 检查是否真的 seek 到了目标位置
      if (Math.abs(video.currentTime - targetTime) < 0.5) {
        // seek 成功，等待一下再捕获
        setTimeout(captureFrame, 200);
      } else {
        // seek 可能失败，尝试播放到目标位置
        console.log('[VideoGen] Seek may have failed, trying play approach...');
        video.playbackRate = 16; // 快速播放
        video.play().catch(() => {
          // 如果播放失败，直接捕获当前帧
          console.warn('[VideoGen] Play failed, capturing current frame');
          captureFrame();
        });
      }
    };
    
    // 当视频数据加载完成时尝试 seek
    video.onloadeddata = () => {
      if (hasResolved) return;
      console.log('[VideoGen] onloadeddata, readyState:', video.readyState, 'duration:', video.duration);
      startSeek();
    };
    
    // 当可以播放时也尝试 seek（备选）
    video.oncanplaythrough = () => {
      if (hasResolved) return;
      console.log('[VideoGen] oncanplaythrough, readyState:', video.readyState, 'duration:', video.duration);
      startSeek();
    };
    
    video.onerror = (e) => {
      if (!hasResolved) {
        hasResolved = true;
        console.warn('[VideoGen] Video load error:', e);
        clearTimeout(timeoutId);
        cleanup();
        resolve(null);
      }
    };
    
    video.src = resolvedUrl;
    video.load();
  });
}

// ==================== 聚鑫API Grok Video Generation ====================

/**
 * Convert aspect ratio to Grok format
 */
function toGrokAspectRatio(aspectRatio: string): string {
  // Grok supports: 2:3, 3:2, 1:1
  if (aspectRatio === '9:16' || aspectRatio === '3:4') return '2:3';
  if (aspectRatio === '1:1') return '1:1';
  // 16:9, 4:3, 21:9 → 3:2 (closest landscape)
  return '3:2';
}

/**
 * Call JuxinAPI (Grok) video generation API
 * API Documentation: https://juxinapi.apifox.cn/doc-7302525
 * 
 * Create video: POST /v1/video/create
 * Query task: GET /v1/video/query?id={taskId}
 */
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
  console.log('[VideoGen] Using JuxinAPI (Grok) for video generation');
  
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
  
  console.log('[VideoGen] Grok request:', requestBody);

  // Submit video generation request（带重试，覆盖 429/503/529，每次重试动态取 key）
  const submitData = await retryOperation(async () => {
    // 每次重试动态取当前 key，利用 keyManager rotate 后的新 key
    const currentApiKey = keyManager?.getCurrentKey?.() || apiKey;
    const submitResponse = await fetch(`${apiBaseUrl}/v1/video/create`, {
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
        const nextKey = keyManager.getCurrentKey?.();
        console.log(`[VideoGen] Grok: rotated to key ${nextKey?.substring(0, 8)}… (due to ${submitResponse.status})`);
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
  console.log('[VideoGen] Grok submit response:', submitData);

  // Extract task ID from response
  const taskId = submitData.id;
  if (!taskId) {
    throw new Error('Grok API 返回空的任务 ID');
  }

  console.log('[VideoGen] Grok task ID:', taskId);

  // Poll for completion
  const pollInterval = 5000; // 5 seconds for Grok (longer video generation)
  const maxAttempts = 180; // 15 minutes max
  
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const progress = Math.min(20 + Math.floor((attempt / maxAttempts) * 80), 99);
    onProgress?.(progress);

    // Query task status
    const queryUrl = new URL(`${apiBaseUrl}/v1/video/query`);
    queryUrl.searchParams.set('id', taskId);

    const statusResponse = await fetch(queryUrl.toString(), {
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
    console.log(`[VideoGen] Grok task ${taskId} status:`, statusData);

    const status = (statusData.status ?? 'unknown').toString().toLowerCase();

    if (status === 'completed' || status === 'succeeded' || status === 'success') {
      // Extract video URL
      const videoUrl = statusData.video_url || statusData.result_url || statusData.url;
      
      if (!videoUrl) {
        throw new Error('任务完成但没有视频 URL');
      }
      
      console.log('[VideoGen] Grok video completed:', videoUrl);
      return videoUrl;
    }

    if (status === 'failed' || status === 'error') {
      const errorMsg = statusData.error || statusData.error_message || '视频生成失败';
      throw new Error(typeof errorMsg === 'string' ? errorMsg : JSON.stringify(errorMsg));
    }

    // Status is pending/processing, continue polling
    await sleepOrAbort(pollInterval, signal);
  }
  
  throw new Error('视频生成超时');
}
