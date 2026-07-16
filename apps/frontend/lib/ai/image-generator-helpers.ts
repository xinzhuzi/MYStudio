import { getAllFeatureConfigs, type FeatureConfig } from '@/lib/ai/feature-router';
import { DEFAULT_IMAGE_RESOLUTION, normalizeImageResolution, resolveImageDimensions } from '@/lib/ai/image-size-presets';

export const buildEndpoint = (baseUrl: string, path: string) => {
  const normalized = baseUrl.replace(/\/+$/, '');
  return /\/v\d+$/.test(normalized) ? `${normalized}/${path}` : `${normalized}/v1/${path}`;
};
export const getRootBaseUrl = (baseUrl: string): string => baseUrl.replace(/\/+$/, '').replace(/\/v\d+$/, '');
export const IMAGE_ENDPOINT_PATHS: Record<string, { submit: string; poll: (id: string) => string }> = {
  'aigc-image': { submit: '/tencent-vod/v1/aigc-image', poll: (id) => `/tencent-vod/v1/aigc-image/${id}` },
  'vidu生图': { submit: '/ent/v2/reference2image', poll: (id) => `/ent/v2/task?task_id=${id}` },
};
export const DEFAULT_IMAGE_ENDPOINT = { submit: '/v1/images/generations', poll: (id: string) => `/v1/images/generations/${id}` };
export function getImageEndpointPaths(endpointTypes: string[]) { for (const t of endpointTypes) if (IMAGE_ENDPOINT_PATHS[t]) return IMAGE_ENDPOINT_PATHS[t]; return DEFAULT_IMAGE_ENDPOINT; }
export function getImageAttemptConfigs(feature: 'character_generation' | 'scene_generation' | 'prop_generation', selectedConfig: FeatureConfig) {
  const allConfigs = getAllFeatureConfigs(feature); if (!allConfigs.length) return [selectedConfig];
  return [selectedConfig, ...allConfigs.filter((c) => c.provider.id !== selectedConfig.provider.id || c.model !== selectedConfig.model)];
}
export function parseImageApiErrorMessage(errorText: string, fallback: string) { try { const data = JSON.parse(errorText); return data?.error?.message || data?.message || data?.msg || fallback; } catch { return errorText && errorText.length < 500 ? errorText : fallback; } }
export function hasQuotaProblem(status: number, errorText: string, message: string) { const text = `${message}\n${errorText}`.toLowerCase(); return status === 403 && ['insufficient_user_quota','insufficient quota','subscription quota','quota insufficient','额度不足','未配置订阅'].some((s) => text.includes(s)); }
export function createImageApiHttpError(status: number, errorText: string) { const rawMessage = parseImageApiErrorMessage(errorText, `图片生成 API 错误: ${status}`); let message = rawMessage; if (status === 401) message = `API Key 无效或已过期，请前往「设置」检查图片生成服务的 API Key 配置（原始信息：${rawMessage}）`; else if (hasQuotaProblem(status,errorText,rawMessage)) message = `图片生成额度不足或订阅未配置：${rawMessage}`; else if (status === 403) message = `图片生成服务拒绝请求（403）：${rawMessage}`; const error = new Error(message) as Error & { status?: number; retryable?: boolean }; error.status = status; if (status===401||status===403) error.retryable=false; return error; }
export function getTargetDimensions(aspectRatio: string, resolution?: string) { return resolveImageDimensions({ aspectRatio, resolution }); }
export function isGeminiImageModel(model: string) { const m=model.toLowerCase(); return m.includes('gemini') && (m.includes('image') || m.includes('imagen')); }
export function geminiSupportsImageSize(model: string) { const m=model.toLowerCase(); return m.includes('gemini-3') && m.includes('image'); }
export function normalizeResolutionForGemini(resolution?: string) { if (!resolution) return DEFAULT_IMAGE_RESOLUTION; const upper=resolution.toUpperCase(); return upper==='512' ? '512' : normalizeImageResolution(upper); }
export function needsPixelSize(model: string) { const m=model.toLowerCase(); return m.includes('doubao') || m.includes('seedream') || m.includes('cogview'); }
