import { getModelEndpointTypes } from "@/lib/ai/config/store-adapter";
import { callKlingVideoApiAdapter } from "@/lib/ai/video-generator-kling-adapter";
import { callOpenAIOfficialVideoApiAdapter } from "@/lib/ai/video-generator-openai-adapter";
import { callReplicateVideoApiAdapter } from "@/lib/ai/video-generator-replicate-adapter";
import { callWanVideoApiAdapter } from "@/lib/ai/video-generator-wan-adapter";
import { toRunwayRatio } from "@/lib/ai/video-request-sizing";
import { extractVideoUrl } from "@/lib/ai/video-response-utils";
import { getUnifiedEndpointPaths, handleVideoSubmitError, sleepOrAbort, videoFetch } from "./video-generator-shared";

/**
 * 视频生成通道族——unified/wan/kling/openai 官方/replicate 各 API 形态提交与轮询。file-size-reduction P2 拆出,体逐字保留。
 */
// MemeFast 文档: POST /v1/video/generations (primary) + /v1/video/create (fallback)
//             GET  /v1/video/generations/{id} (primary) + /v1/video/query?id= (fallback)

export async function callUnifiedVideoApi(
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
  const endpointTypes = getModelEndpointTypes(model);
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

  // 提交：直接使用端点类型对应的 URL
  const resp = await videoFetch(submitUrl, {
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

    const statusResponse = await videoFetch(pollUrl, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      signal,
    });

    if (!statusResponse.ok) continue;

    const statusData = await statusResponse.json();

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
  throw new Error(`视频生成超时(已轮询 ${maxAttempts} 次、约 ${Math.round((maxAttempts * pollInterval) / 60000)} 分钟仍未出片)`);
}

// ==================== Volcengine 豆包/Seedance 格式 ====================
// MemeFast 文档: POST /volc/v1/contents/generations/tasks + GET /volc/v1/contents/generations/tasks/{taskId}
// 火山方舟文档: https://www.volcengine.com/docs/82379/1520757


// ==================== 通义万象 wan 格式 ====================
// MemeFast 文档:
//   创建: POST /alibailian/api/v1/services/aigc/video-generation/video-synthesis
//   查询: GET  /alibailian/api/v1/tasks/{task_id}

export async function callWanVideoApi(
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

export async function callKlingVideoApi(
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

export async function callOpenAIOfficialVideoApi(
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

export async function callReplicateVideoApi(
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
