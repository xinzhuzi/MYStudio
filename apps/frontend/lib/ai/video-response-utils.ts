/** Pure response and model helpers shared by the video provider adapters. */

export function normalizeUrl(url: unknown): string | undefined {
  if (!url) return undefined;
  if (Array.isArray(url)) return url[0] || undefined;
  if (typeof url === 'string') return url;
  return undefined;
}

/** Extract a video URL from the response shapes used by supported providers. */
export function extractVideoUrl(data: Record<string, any>): string | null {
  const url =
    data.data?.[0]?.url ||
    data.url ||
    data.output?.url ||
    (typeof data.output === 'string' && data.output.startsWith('http') ? data.output : null) ||
    (Array.isArray(data.output) && typeof data.output[0] === 'string' ? data.output[0] : null) ||
    data.outputs?.[0] ||
    data.video_url ||
    data.result_url ||
    data.response?.url;
  return (url ? normalizeUrl(url) : undefined) ?? null;
}

/** Resolve composite Kling image model IDs to the video model ID expected by the API. */
export function resolveKlingModelName(model: string): string {
  const match = model.match(/^kling-image-(v.+)$/);
  return match ? `kling-${match[1]}` : model;
}

/** Native Kling endpoint paths for models that do not use text2video/image2video. */
export const KLING_VIDEO_PATH_MAP: Record<string, string> = {
  'kling-omni-video': 'omni-video',
  'kling-video-extend': 'video-extend',
  'kling-motion-control': 'motion-control',
  'kling-multi-elements': 'multi-elements',
  'kling-avatar-image2video': 'avatar/image2video',
  'kling-advanced-lip-sync': 'advanced-lip-sync',
  'kling-effects': 'effects',
};
