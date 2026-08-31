import { getModelEndpointTypes } from "@/lib/ai/config/store-adapter";
import { getFeatureConfig } from "@/lib/ai/feature-router";
import { describeFetchError } from "@/lib/ai/fetch-error";
import { detectVideoApiFormat as detectVideoApiFormatFromRouting, getUnifiedEndpointPaths as getUnifiedEndpointPathsFromRouting } from "@/lib/ai/video-generator-routing";
import { isImageHostConfigured, uploadToImageHost } from "@/lib/media/image-host";

/**
 * 视频生成共享底座——内容审核判别/API 配置/统一端点/格式路由/提交错误处理/最小图尺寸/网络与中止工具。file-size-reduction P2 拆出,体逐字保留。
 */
/**
 * Keywords indicating content moderation errors
 * Based on ScriptAgent's CONTENT_MODERATION_KEYWORDS
 */
export const CONTENT_MODERATION_KEYWORDS = [
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
export function getUnifiedEndpointPaths(endpointTypes: string[]): { submit: string; poll: (id: string) => string } {
  return getUnifiedEndpointPathsFromRouting(endpointTypes);
}

/**
 * 根据模型的 supported_endpoint_types 元数据检测应使用的视频 API 格式
 * 优先使用 MemeFast /api/pricing_new 同步的元数据，fallback 到模型名推断
 */
export function detectVideoApiFormat(model: string): 'openai_official' | 'unified' | 'volc' | 'wan' | 'kling' | 'replicate' {
  return detectVideoApiFormatFromRouting(model, getModelEndpointTypes(model));
}

// ==================== 通用错误处理 ====================

export function handleVideoSubmitError(
  status: number,
  errorText: string,
  keyManager?: { handleError: (status: number, errorText?: string) => boolean; getCurrentKey?: () => string | null },
): never {
  if (keyManager?.handleError(status, errorText)) {
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
export async function ensureMinImageSize(
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

/** 视频链路网络层失败统一翻译成带原因的中文错误(DNS/拒连/超时/证书等)再上抛 */
export async function videoFetch(url: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (error) {
    if (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')) throw error;
    throw new Error(describeFetchError(error, { endpoint: url }));
  }
}

/** AbortSignal 感知的 sleep：若信号触发则立即以 '用户已取消' 拒绝 */
export function sleepOrAbort(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('用户已取消'));
    const tid = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(tid); reject(new Error('用户已取消')); }, { once: true });
  });
}
