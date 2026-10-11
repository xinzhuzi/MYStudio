import { createDescribedFetchError } from "@/lib/ai/fetch-error";
import { ImageAspectRatio, ImageResolution } from "@/lib/ai/image-size-presets";
import { getImageStorageBridge } from "@/lib/bridge/image-storage";
import { createOperationId } from "@/lib/diagnostics/logger";
import { observedFetch } from "@/lib/diagnostics/network";
import { fetchRemoteImageDataUrl } from "@/lib/media/remote-image-fetch";
import { corsFetch } from "@/lib/network/cors-fetch";
import {
  DEFAULT_LOCAL_IMAGE_PROVIDER_ID,
  LOCAL_IMAGE_BASE_URL,
} from "@/stores/ai/api-config-provider-helpers";

/**
 * 生图共享底座——参数/结果类型、通道错误工具、URL 落地转换。file-size-reduction P1 拆出,体逐字保留。
 */
export interface ImageGenerationParams {
  prompt: string;
  negativePrompt?: string;
  /** raw=调用方已持有最终 provider-visible 文本(如道劫 ma-gongbi-v1 编译产物),传输层禁止再追加/改写 */
  promptPolicy?: "enhanced" | "raw";
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

export type ImageGenerationFeature = 'character_generation' | 'scene_generation' | 'prop_generation';
export const IMAGE_SUBMIT_TIMEOUT_MS = 180_000;
/**
 * 本地 Q2.1 通道的提交超时豁免(1011 断点C):本地 sidecar 同步跑全管线
 * (t2i+SeedVR2 2K)实测 3.5-4.5min,180s 提交超时会中途 abort 并连带
 * sidecar 取消引擎作业(2K 精修被掐);对齐自由口 generateImage 本地链 900s。
 */
export const LOCAL_IMAGE_SUBMIT_TIMEOUT_MS = 900_000;

/** 按 provider 判定提交超时:本地通道(platform 或 baseUrl 口径,同 isLocalImageProvider)豁免 900s,其余维持 180s。 */
export function imageSubmitTimeoutForProvider(
  provider?: { platform?: string; baseUrl?: string } | null,
): number {
  if (!provider) return IMAGE_SUBMIT_TIMEOUT_MS;
  if (provider.platform === DEFAULT_LOCAL_IMAGE_PROVIDER_ID) return LOCAL_IMAGE_SUBMIT_TIMEOUT_MS;
  if ((provider.baseUrl || '').trim().replace(/\/+$/, '') === LOCAL_IMAGE_BASE_URL) {
    return LOCAL_IMAGE_SUBMIT_TIMEOUT_MS;
  }
  return IMAGE_SUBMIT_TIMEOUT_MS;
}

export function isMikotoImageProvider(baseUrl: string): boolean {
  try {
    return new URL(baseUrl).hostname.toLowerCase() === 'api.mikoto.vip';
  } catch {
    return false;
  }
}


export function isAuthStatusError(error: unknown): boolean {
  const status = (error as { status?: unknown } | undefined)?.status;
  return status === 401 || status === 403;
}

/** 网络层失败统一翻译成带原因的中文错误(域名解析/拒连/超时/证书等)再上抛 */
export async function withDescribedFetchError<T>(run: () => Promise<T>, endpoint: string): Promise<T> {
  try {
    return await run();
  } catch (error) {
    throw createDescribedFetchError(error, { endpoint });
  }
}

export async function imageUrlToBase64(url: string): Promise<string> {
  const operationId = createOperationId('image-download');
  // If already a local or base64 path, return as-is
  if (url.startsWith('data:image/') || url.startsWith('local-image://')) {
    return url;
  }
  
  // Try to use Electron local storage first
  const imageStorage = getImageStorageBridge();
  if (imageStorage) {
    try {
      const filename = `image_${Date.now()}.png`;
      const result = await imageStorage.saveImage(url, 'shots', filename);
      if (result.success && result.localPath) {
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
    console.warn('[ImageGenerator] Direct fetch failed, trying shared image fetch:', error);
  }
  
  // Fallback: use the shared CORS-aware image fetch path.
  try {
    return await fetchRemoteImageDataUrl(url, {
      fetchImage: (input, init) => corsFetch(input, init),
    });
  } catch (error) {
    console.warn('[ImageGenerator] Shared image fetch also failed:', error);
    throw createDescribedFetchError(error, { endpoint: url });
  }
}
