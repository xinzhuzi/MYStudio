import { toSoraSize } from "@/lib/ai/video-request-sizing";
import { extractVideoUrl, normalizeUrl } from "@/lib/ai/video-response-utils";

type VideoKeyManager = { handleError: (status: number, errorText?: string) => boolean };

export interface OpenAIOfficialVideoAdapterDeps {
  handleVideoSubmitError: (
    status: number,
    errorText: string,
    keyManager?: VideoKeyManager,
  ) => never;
  sleepOrAbort: (ms: number, signal?: AbortSignal) => Promise<void>;
}

export async function callOpenAIOfficialVideoApiAdapter(
  apiKey: string,
  prompt: string,
  baseUrl: string,
  model: string,
  aspectRatio: string,
  duration?: number,
  videoResolution?: string,
  onProgress?: (progress: number) => void,
  keyManager?: VideoKeyManager,
  signal?: AbortSignal,
  deps?: OpenAIOfficialVideoAdapterDeps,
): Promise<string> {
  if (!deps) {
    throw new Error('OpenAI official video adapter dependencies are required');
  }

  const form = new FormData();
  form.append('model', model);
  form.append('prompt', prompt);
  form.append('size', toSoraSize(aspectRatio, videoResolution));
  form.append('seconds', String(duration || 10));

  const submitUrl = `${baseUrl}/v1/videos`;
  console.log('[VideoGen] OpenAI Official format → POST /v1/videos', { model, size: toSoraSize(aspectRatio, videoResolution) });

  const submitResponse = await fetch(submitUrl, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}` },
    body: form,
  });

  if (!submitResponse.ok) {
    const errorText = await submitResponse.text();
    console.error('[VideoGen] Sora video submit error:', submitResponse.status, errorText);
    deps.handleVideoSubmitError(submitResponse.status, errorText, keyManager);
  }

  const submitData = await submitResponse.json();
  console.log('[VideoGen] Sora submit response:', submitData);

  const taskId = (submitData.id || submitData.video_id)?.toString();
  const directUrl = extractVideoUrl(submitData);
  if (directUrl) return directUrl;
  if (!taskId) throw new Error('Sora 返回空任务 ID');

  // 轮询: GET /v1/videos/{taskId}
  const pollUrl = `${baseUrl}/v1/videos/${taskId}`;
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
    console.log(`[VideoGen] Sora task ${taskId} status:`, statusData);

    const status = String(statusData.status || '').toLowerCase();

    if (status === 'completed' || status === 'succeeded' || status === 'success') {
      const videoUrl = extractVideoUrl(statusData) || normalizeUrl(`${baseUrl}/v1/videos/${taskId}/content`);
      if (!videoUrl) throw new Error('Sora 任务完成但没有视频 URL');
      return videoUrl;
    }

    if (status === 'failed' || status === 'error') {
      throw new Error(statusData.error?.message || statusData.error || statusData.message || 'Sora 生成失败');
    }
  }
  throw new Error('Sora 生成超时');
}
