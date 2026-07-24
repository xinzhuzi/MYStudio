import { extractVideoUrl } from "@/lib/ai/video-response-utils";

type VideoKeyManager = { handleError: (status: number, errorText?: string) => boolean };

export interface ReplicateVideoAdapterDeps {
  handleVideoSubmitError: (
    status: number,
    errorText: string,
    keyManager?: VideoKeyManager,
  ) => never;
  sleepOrAbort: (ms: number, signal?: AbortSignal) => Promise<void>;
}

export async function callReplicateVideoApiAdapter(
  apiKey: string,
  prompt: string,
  baseUrl: string,
  model: string,
  aspectRatio: string,
  imageWithRoles: Array<{ url: string; role: string }>,
  duration?: number,
  videoResolution?: string,
  onProgress?: (progress: number) => void,
  keyManager?: VideoKeyManager,
  signal?: AbortSignal,
  deps?: ReplicateVideoAdapterDeps,
): Promise<string> {
  if (!deps) {
    throw new Error('Replicate video adapter dependencies are required');
  }

  // rootBase: strip /v1 suffix for /replicate/ prefix path.
  const rootBase = baseUrl.replace(/\/v\d+$/, '');

  const input: Record<string, unknown> = { prompt };
  if (aspectRatio) input.aspect_ratio = aspectRatio;
  if (duration) input.duration = duration;
  if (videoResolution) input.resolution = videoResolution;

  const firstFrame = imageWithRoles.find(img => img.role === 'first_frame');
  if (firstFrame?.url) input.image = firstFrame.url;
  const lastFrame = imageWithRoles.find(img => img.role === 'last_frame');
  if (lastFrame?.url) input.tail_image = lastFrame.url;

  const submitUrl = `${rootBase}/replicate/v1/predictions`;
  console.log('[VideoGen] Replicate format → POST /replicate/v1/predictions', { model });

  const submitResponse = await fetch(submitUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model, input }),
  });

  if (!submitResponse.ok) {
    const errorText = await submitResponse.text();
    console.error('[VideoGen] Replicate video submit error:', submitResponse.status, errorText);
    deps.handleVideoSubmitError(submitResponse.status, errorText, keyManager);
  }

  const submitData = await submitResponse.json();
  console.log('[VideoGen] Replicate submit response:', submitData);

  const directUrl = extractVideoUrl(submitData);
  if (directUrl) return directUrl;

  const predictionId = submitData.id?.toString();
  if (!predictionId) throw new Error('Replicate 返回空 prediction ID');

  const pollUrl = `${rootBase}/replicate/v1/predictions/${predictionId}`;
  const pollInterval = 5000;
  const maxAttempts = 180;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    onProgress?.(Math.min(20 + Math.floor((attempt / maxAttempts) * 80), 99));
    await deps.sleepOrAbort(pollInterval, signal);

    const statusResponse = await fetch(pollUrl, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${apiKey}` },
      signal,
    });

    if (!statusResponse.ok) continue;

    const statusData = await statusResponse.json();
    console.log(`[VideoGen] Replicate prediction ${predictionId} status:`, statusData);

    const status = String(statusData.status || '').toLowerCase();

    if (status === 'succeeded') {
      const videoUrl = extractVideoUrl(statusData);
      if (!videoUrl) throw new Error('Replicate 成功但未返回视频 URL');
      return videoUrl;
    }

    if (status === 'failed' || status === 'canceled') {
      throw new Error(statusData.error || 'Replicate 视频生成失败');
    }
  }
  throw new Error('Replicate 视频生成超时');
}
