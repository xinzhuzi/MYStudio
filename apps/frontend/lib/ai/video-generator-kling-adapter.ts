import {
  extractVideoUrl,
  KLING_VIDEO_PATH_MAP,
  normalizeUrl,
  resolveKlingModelName,
} from "@/lib/ai/video-response-utils";

type VideoKeyManager = { handleError: (status: number, errorText?: string) => boolean };

export interface KlingVideoAdapterDeps {
  handleVideoSubmitError: (
    status: number,
    errorText: string,
    keyManager?: VideoKeyManager,
  ) => never;
  sleepOrAbort: (ms: number, signal?: AbortSignal) => Promise<void>;
}

export async function callKlingVideoApiAdapter(
  apiKey: string,
  prompt: string,
  baseUrl: string,
  model: string,
  aspectRatio: string,
  imageWithRoles: Array<{ url: string; role: string }>,
  duration?: number,
  onProgress?: (progress: number) => void,
  keyManager?: VideoKeyManager,
  signal?: AbortSignal,
  deps?: KlingVideoAdapterDeps,
): Promise<string> {
  if (!deps) {
    throw new Error('Kling video adapter dependencies are required');
  }

  const firstFrame = imageWithRoles.find(img => img.role === 'first_frame');
  const lastFrame = imageWithRoles.find(img => img.role === 'last_frame');

  // Determine the endpoint path: specialized models have a fixed path;
  // all kling-video variants fall through to text2video / image2video.
  const specialPath = KLING_VIDEO_PATH_MAP[model];
  const endpointPath = specialPath || (firstFrame?.url ? 'image2video' : 'text2video');

  const requestBody: Record<string, unknown> = {
    model_name: resolveKlingModelName(model),
    prompt,
    aspect_ratio: aspectRatio,
    duration: duration ? String(Math.min(10, Math.max(5, duration))) : '5',
    mode: 'std',
  };

  if (endpointPath === 'image2video' && firstFrame?.url) {
    requestBody.image_url = firstFrame.url;
    if (lastFrame?.url) requestBody.tail_image_url = lastFrame.url;
  } else if (endpointPath === 'avatar/image2video' && firstFrame?.url) {
    requestBody.image_url = firstFrame.url;
  }

  const submitUrl = `${baseUrl}/kling/v1/videos/${endpointPath}`;
  console.log('[VideoGen] Kling format →', endpointPath, { model, submitUrl });

  const submitResponse = await fetch(submitUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(requestBody),
  });

  if (!submitResponse.ok) {
    const errorText = await submitResponse.text();
    console.error('[VideoGen] Kling video submit error:', submitResponse.status, errorText);
    deps.handleVideoSubmitError(submitResponse.status, errorText, keyManager);
  }

  const submitData = await submitResponse.json();
  console.log('[VideoGen] Kling submit response:', submitData);

  // Kling response: { code, message, data: { task_id, task_status } }
  const taskId = submitData.data?.task_id;
  if (!taskId) throw new Error('返回空的任务 ID');

  const pollUrl = `${baseUrl}/kling/v1/videos/${endpointPath}/${taskId}`;
  const pollInterval = 5000;
  const maxAttempts = 180;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    onProgress?.(Math.min(20 + Math.floor((attempt / maxAttempts) * 80), 99));
    await deps.sleepOrAbort(pollInterval, signal);

    const statusResponse = await fetch(pollUrl, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      signal,
    });

    if (!statusResponse.ok) {
      if (statusResponse.status === 404) throw new Error('任务不存在');
      console.warn('[VideoGen] Kling query failed:', statusResponse.status);
      continue;
    }

    const statusData = await statusResponse.json();
    console.log(`[VideoGen] Kling task ${taskId} status:`, statusData);

    const taskStatus = (statusData.data?.task_status ?? '').toLowerCase();

    if (taskStatus === 'succeed' || taskStatus === 'success' || taskStatus === 'completed') {
      const videoUrl =
        normalizeUrl(statusData.data?.task_result?.videos?.[0]?.url) ||
        normalizeUrl(statusData.data?.task_result?.video_url) ||
        extractVideoUrl(statusData);
      if (!videoUrl) throw new Error('任务完成但没有视频 URL');
      return videoUrl;
    }

    if (taskStatus === 'failed' || taskStatus === 'error') {
      throw new Error(statusData.data?.task_status_msg || statusData.message || '视频生成失败');
    }
  }
  throw new Error('视频生成超时');
}
