import { normalizeUrl } from "@/lib/ai/video-response-utils";

type VideoKeyManager = { handleError: (status: number, errorText?: string) => boolean };

export interface WanVideoAdapterDeps {
  handleVideoSubmitError: (
    status: number,
    errorText: string,
    keyManager?: VideoKeyManager,
  ) => never;
  sleepOrAbort: (ms: number, signal?: AbortSignal) => Promise<void>;
}

export async function callWanVideoApiAdapter(
  apiKey: string,
  prompt: string,
  baseUrl: string,
  model: string,
  imageWithRoles: Array<{ url: string; role: string }>,
  resolution?: string,
  duration?: number,
  enableAudio?: boolean,
  onProgress?: (progress: number) => void,
  keyManager?: VideoKeyManager,
  signal?: AbortSignal,
  deps?: WanVideoAdapterDeps,
): Promise<string> {
  if (!deps) {
    throw new Error('Wan video adapter dependencies are required');
  }

  const firstFrame = imageWithRoles.find(img => img.role === 'first_frame');

  const requestBody: Record<string, unknown> = {
    model,
    input: {
      prompt,
      ...(firstFrame?.url ? { img_url: firstFrame.url } : {}),
    },
    parameters: {
      resolution: (resolution || '480P').toUpperCase(),
      prompt_extend: true,
      ...(duration ? { duration: Math.max(3, Math.min(10, duration)) } : {}),
      audio: enableAudio !== false,
    },
  };

  console.log('[VideoGen] Wan format → POST /alibailian/api/v1/services/aigc/video-generation/video-synthesis', { model });

  const submitResponse = await fetch(
    `${baseUrl}/alibailian/api/v1/services/aigc/video-generation/video-synthesis`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(requestBody),
    },
  );

  if (!submitResponse.ok) {
    const errorText = await submitResponse.text();
    console.error('[VideoGen] Wan video submit error:', submitResponse.status, errorText);
    deps.handleVideoSubmitError(submitResponse.status, errorText, keyManager);
  }

  const submitData = await submitResponse.json();
  console.log('[VideoGen] Wan submit response:', submitData);

  // Bailian response: { request_id, output: { task_id, task_status: "PENDING" } }
  const taskId = submitData.output?.task_id;
  if (!taskId) throw new Error('返回空的任务 ID');

  const pollInterval = 5000;
  const maxAttempts = 180;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    onProgress?.(Math.min(20 + Math.floor((attempt / maxAttempts) * 80), 99));

    const statusResponse = await fetch(
      `${baseUrl}/alibailian/api/v1/tasks/${taskId}`,
      {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${apiKey}` },
        signal,
      },
    );

    if (!statusResponse.ok) {
      if (statusResponse.status === 404) throw new Error('任务不存在');
      console.warn('[VideoGen] Wan query failed:', statusResponse.status);
      await deps.sleepOrAbort(pollInterval, signal);
      continue;
    }

    const statusData = await statusResponse.json();
    console.log(`[VideoGen] Wan task ${taskId} status:`, statusData);

    const taskStatus = (statusData.output?.task_status ?? '').toUpperCase();

    if (taskStatus === 'SUCCEEDED') {
      const videoUrl = normalizeUrl(statusData.output?.video_url);
      if (!videoUrl) throw new Error('任务完成但没有视频 URL');
      return videoUrl;
    }

    if (taskStatus === 'FAILED') {
      throw new Error(statusData.output?.message || statusData.output?.error || '视频生成失败');
    }

    await deps.sleepOrAbort(pollInterval, signal);
  }
  throw new Error('视频生成超时');
}
