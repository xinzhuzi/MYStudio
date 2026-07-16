import { isVeoModel, resolveVeoUploadCapability } from "@/lib/freedom/veo-capability";
import { useAPIConfigStore } from "@/stores/api-config-store";
import { toRunwayRatio, toSoraSize, toVeoOpenAIVideoSize } from "@/lib/ai/video-request-sizing";
import {
  groupVideoUploadFiles,
  validateVeoVideoUploads,
  type FreedomVideoUploadFile,
} from "./video-upload-validation";
import {
  buildFreedomEndpoint as buildEndpoint,
  extractFreedomVideoUrl as extractVideoUrl,
  freedomObservedFetch,
  getFreedomRootBaseUrl as getRootBaseUrl,
  toUploadBlob,
  toUploadHttpUrl,
} from "./freedom-transport";
import { getUnifiedEndpointPaths } from "./freedom-routing";
import { resolveKlingModelName } from "./freedom-model-names";
import type { FreedomVideoParams, GenerationResult } from "./freedom-api";

const VIDEO_POLL_INTERVAL = 2000;
const VIDEO_POLL_MAX_ATTEMPTS = 120;

function toHttpError(prefix: string, status: number, body: string): Error & { status: number } {
  const error = new Error(`${prefix}: ${status} ${body}`) as Error & { status: number };
  error.status = status;
  return error;
}

async function appendVeoMultipartReferences(
  form: FormData,
  model: string,
  endpointTypes: string[] | undefined,
  uploadFiles?: FreedomVideoUploadFile[],
) {
  const capability = resolveVeoUploadCapability(model, endpointTypes);
  if (!capability.isVeo) return;

  const grouped = validateVeoVideoUploads(model, endpointTypes, uploadFiles);
  const ordered: FreedomVideoUploadFile[] = [];

  if (capability.mode === 'single') {
    const single = grouped.single || grouped.first;
    if (single) ordered.push(single);
  } else if (capability.mode === 'first_last') {
    if (grouped.first) ordered.push(grouped.first);
    if (grouped.last) ordered.push(grouped.last);
  } else if (capability.mode === 'multi') {
    ordered.push(...grouped.references.slice(0, capability.maxFiles));
  }

  for (let i = 0; i < ordered.length; i++) {
    const file = ordered[i];
    const blob = await toUploadBlob(file);
    const fileName = file.fileName || `veo-reference-${i + 1}.png`;
    form.append('input_reference', blob, fileName);
  }
}

async function buildVeoUnifiedVideoBody(
  params: FreedomVideoParams,
  model: string,
  endpointTypes: string[] | undefined,
): Promise<Record<string, any>> {
  const capability = resolveVeoUploadCapability(model, endpointTypes);
  const grouped = validateVeoVideoUploads(model, endpointTypes, params.uploadFiles);
  const body: Record<string, any> = {
    model,
    prompt: params.prompt,
  };
  const metadata: Record<string, any> = {};

  if (params.duration) body.duration = params.duration;
  if (params.aspectRatio) metadata.aspectRatio = params.aspectRatio;
  if (params.resolution) metadata.resolution = params.resolution.toLowerCase();

  if (capability.mode === 'single') {
    const single = grouped.single || grouped.first;
    if (single) body.image = await toUploadHttpUrl(single);
  } else if (capability.mode === 'first_last') {
    if (grouped.first) body.image = await toUploadHttpUrl(grouped.first);
    if (grouped.last) {
      metadata.lastFrame = { url: await toUploadHttpUrl(grouped.last) };
    }
  } else if (capability.mode === 'multi') {
    const refs = grouped.references.slice(0, capability.maxFiles);
    metadata.referenceImages = await Promise.all(
      refs.map(async (f) => ({ url: await toUploadHttpUrl(f) })),
    );
  }

  if (Object.keys(metadata).length > 0) body.metadata = metadata;
  return body;
}

export async function generateVideoViaOpenAIOfficial(
  params: FreedomVideoParams,
  model: string,
  apiKey: string,
  baseUrl: string,
): Promise<GenerationResult> {
  const endpoint = buildEndpoint(baseUrl, 'videos');
  const endpointTypes = useAPIConfigStore.getState().modelEndpointTypes[model];
  const isVeo = isVeoModel(model);
  const form = new FormData();
  form.append('model', model);
  form.append('prompt', params.prompt);
  form.append('size', isVeo ? toVeoOpenAIVideoSize(params.aspectRatio) : toSoraSize(params.aspectRatio, params.resolution));
  form.append('seconds', String(params.duration || (isVeo ? 8 : 10)));
  if (isVeo) {
    await appendVeoMultipartReferences(form, model, endpointTypes, params.uploadFiles);
  }

  const submitResp = await freedomObservedFetch(endpoint, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}` },
    body: form,
  });
  if (!submitResp.ok) {
    throw toHttpError('Sora submit failed', submitResp.status, await submitResp.text());
  }

  const submitData = await submitResp.json();
  const taskId = submitData.id || submitData.video_id;
  const directUrl = extractVideoUrl(submitData);
  if (directUrl) return { url: directUrl, taskId: taskId ? String(taskId) : undefined };
  if (!taskId) throw new Error('Sora 返回空任务 ID');

  const pollUrl = buildEndpoint(baseUrl, `videos/${taskId}`);
  for (let i = 0; i < VIDEO_POLL_MAX_ATTEMPTS; i++) {
    await new Promise((r) => setTimeout(r, VIDEO_POLL_INTERVAL));
    const pollResp = await freedomObservedFetch(pollUrl, {
      headers: { 'Authorization': `Bearer ${apiKey}` },
    });
    if (!pollResp.ok) continue;
    const pollData = await pollResp.json();
    const status = String(pollData.status || '').toLowerCase();
    if (status === 'completed' || status === 'succeeded' || status === 'success') {
      const videoUrl = extractVideoUrl(pollData) || buildEndpoint(baseUrl, `videos/${taskId}/content`);
      return { url: videoUrl, taskId: String(taskId) };
    }
    if (status === 'failed' || status === 'error') {
      throw new Error(pollData.error?.message || pollData.error || pollData.message || 'Sora 生成失败');
    }
  }

  throw new Error('Sora 生成超时');
}

export async function generateVideoViaUnified(
  params: FreedomVideoParams,
  model: string,
  apiKey: string,
  baseUrl: string,
): Promise<GenerationResult> {
  const endpointTypes = useAPIConfigStore.getState().modelEndpointTypes[model];

  let body: Record<string, any>;
  if (isVeoModel(model)) {
    body = await buildVeoUnifiedVideoBody(params, model, endpointTypes);
  } else {
    const isLuma = (endpointTypes || []).some(t => /luma/i.test(t));
    const isRunway = (endpointTypes || []).some(t => /runway/i.test(t));
    const isGrok = (endpointTypes || []).some(t => /grok/i.test(t)) || /grok/i.test(model);

    body = { model, prompt: params.prompt };
    const metadata: Record<string, any> = {};

    // Duration: Luma requires string with unit ("5s"), other models use number
    if (params.duration) {
      body.duration = isLuma ? `${params.duration}s` : params.duration;
    }

    // AspectRatio 处理策略（各模型格式不同，按模型分别处理）：
    // - Runway: metadata.ratio（像素格式 1280:720）
    // - Grok: 顶层 aspect_ratio（xAI 官方格式，支持 16:9/9:16/4:3/3:4/3:2/2:3/1:1）
    // - 其他统一格式模型: metadata.aspect_ratio
    if (params.aspectRatio) {
      if (isRunway) {
        metadata.ratio = toRunwayRatio(params.aspectRatio);
      } else if (isGrok) {
        body.aspect_ratio = params.aspectRatio;
      } else {
        metadata.aspect_ratio = params.aspectRatio;
      }
    }

    // Resolution: Grok uses top-level "720p"/"480p"; others via metadata
    if (params.resolution) {
      if (isRunway) {
        // Runway doesn't use resolution field
      } else if (isGrok) {
        body.resolution = params.resolution;
      } else {
        metadata.resolution = params.resolution;
      }
    }

    // Image inputs (wan2.6, doubao, luma, vidu, minimax, runway, etc.)
    const grouped = groupVideoUploadFiles(params.uploadFiles);
    if (grouped.single || grouped.first) {
      body.image = await toUploadHttpUrl((grouped.single || grouped.first)!);
    }
    if (grouped.last) {
      metadata.image_end = await toUploadHttpUrl(grouped.last);
    }
    // Reference images: vidu参考生视频 and similar models
    if (grouped.references.length > 0) {
      metadata.reference_images = await Promise.all(
        grouped.references.map(async (f) => ({ url: await toUploadHttpUrl(f) }))
      );
    }

    if (Object.keys(metadata).length > 0) body.metadata = metadata;
  }

  // 直接使用端点类型对应的 URL（绝对路径，从域名根拼接）
  const endpointPaths = getUnifiedEndpointPaths(endpointTypes || []);
  const rootBase = getRootBaseUrl(baseUrl);
  const submitUrl = `${rootBase}${endpointPaths.submit}`;

  const resp = await freedomObservedFetch(submitUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw toHttpError('Unified video submit failed', resp.status, text);
  }
  const submitData = await resp.json();

  const taskId =
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
    submitData.output?.id;
  const directUrl = extractVideoUrl(submitData);
  if (directUrl) return { url: directUrl, taskId: taskId ? String(taskId) : undefined };
  if (!taskId) throw new Error('统一视频接口返回空任务 ID');

  // 轮询：直接使用端点类型对应的 URL
  const pollUrl = `${rootBase}${endpointPaths.poll(String(taskId))}`;

  for (let i = 0; i < VIDEO_POLL_MAX_ATTEMPTS; i++) {
    await new Promise((r) => setTimeout(r, VIDEO_POLL_INTERVAL));
    const pollResp = await freedomObservedFetch(pollUrl, {
      headers: { 'Authorization': `Bearer ${apiKey}` },
    });
    if (!pollResp.ok) continue;
    const pollData = await pollResp.json();
    const status = String(pollData.status || pollData.state || pollData.data?.status || '').toLowerCase();
    if (status === 'completed' || status === 'succeeded' || status === 'success') {
      const videoUrl = extractVideoUrl(pollData);
      if (videoUrl) return { url: videoUrl, taskId: String(taskId) };
    }
    if (status === 'failed' || status === 'error' || status === 'cancelled') {
      throw new Error(pollData.error?.message || pollData.error || pollData.message || '视频生成失败');
    }
  }

  throw new Error('视频生成超时');
}

export async function generateVideoViaVolc(
  params: FreedomVideoParams,
  model: string,
  apiKey: string,
  baseUrl: string,
): Promise<GenerationResult> {
  const rootBase = getRootBaseUrl(baseUrl);
  const promptParts = [params.prompt];
  if (params.resolution) promptParts.push(`--rs ${params.resolution.toLowerCase()}`);
  if (params.aspectRatio) promptParts.push(`--rt ${params.aspectRatio}`);
  if (params.duration) promptParts.push(`--dur ${params.duration}`);

  const content: Array<Record<string, unknown>> = [
    { type: 'text', text: promptParts.join(' ') },
  ];

  // 附加上传图片（首帧/尾帧），对齐 Director 面板的 callVolcVideoApi
  const grouped = groupVideoUploadFiles(params.uploadFiles);
  const primaryFile = grouped.single || grouped.first;
  if (primaryFile) {
    const url = await toUploadHttpUrl(primaryFile);
    content.push({ type: 'image_url', image_url: { url }, role: 'first_frame' });
  }
  if (grouped.last) {
    const url = await toUploadHttpUrl(grouped.last);
    content.push({ type: 'image_url', image_url: { url }, role: 'last_frame' });
  }

  const body = { model, content };

  const submitResp = await freedomObservedFetch(`${rootBase}/volc/v1/contents/generations/tasks`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });
  if (!submitResp.ok) {
    throw toHttpError('Volc submit failed', submitResp.status, await submitResp.text());
  }

  const submitData = await submitResp.json();
  const taskId = submitData.id;
  if (!taskId) throw new Error('Volc 返回空任务 ID');

  const pollUrl = `${rootBase}/volc/v1/contents/generations/tasks/${taskId}`;
  for (let i = 0; i < VIDEO_POLL_MAX_ATTEMPTS; i++) {
    await new Promise((r) => setTimeout(r, VIDEO_POLL_INTERVAL));
    const pollResp = await freedomObservedFetch(pollUrl, {
      headers: { 'Authorization': `Bearer ${apiKey}` },
    });
    if (!pollResp.ok) continue;
    const pollData = await pollResp.json();
    const status = String(pollData.status || '').toLowerCase();
    if (status === 'succeeded' || status === 'completed' || status === 'success') {
      const videoUrl = pollData.content?.video_url || extractVideoUrl(pollData);
      if (!videoUrl) throw new Error('Volc 成功但无视频 URL');
      return { url: videoUrl, taskId: String(taskId) };
    }
    if (status === 'failed' || status === 'expired' || status === 'cancelled' || status === 'error') {
      throw new Error(pollData.error?.message || pollData.error || 'Volc 视频生成失败');
    }
  }

  throw new Error('Volc 视频生成超时');
}

export async function generateVideoViaWan(
  params: FreedomVideoParams,
  model: string,
  apiKey: string,
  baseUrl: string,
): Promise<GenerationResult> {
  const rootBase = getRootBaseUrl(baseUrl);
  const body: Record<string, any> = {
    model,
    input: { prompt: params.prompt },
    parameters: {
      resolution: (params.resolution || '720P').toUpperCase(),
      prompt_extend: true,
      audio: true,
    },
  };
  if (params.duration) body.parameters.duration = Math.max(3, params.duration);

  const submitResp = await freedomObservedFetch(
    `${rootBase}/alibailian/api/v1/services/aigc/video-generation/video-synthesis`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    },
  );
  if (!submitResp.ok) {
    throw toHttpError('Wan submit failed', submitResp.status, await submitResp.text());
  }

  const submitData = await submitResp.json();
  const taskId = submitData.output?.task_id;
  if (!taskId) throw new Error('Wan 返回空任务 ID');

  const pollUrl = `${rootBase}/alibailian/api/v1/tasks/${taskId}`;
  for (let i = 0; i < VIDEO_POLL_MAX_ATTEMPTS; i++) {
    await new Promise((r) => setTimeout(r, VIDEO_POLL_INTERVAL));
    const pollResp = await freedomObservedFetch(pollUrl, {
      headers: { 'Authorization': `Bearer ${apiKey}` },
    });
    if (!pollResp.ok) continue;
    const pollData = await pollResp.json();
    const status = String(pollData.output?.task_status || '').toUpperCase();
    if (status === 'SUCCEEDED' || status === 'COMPLETED') {
      const videoUrl = pollData.output?.video_url || extractVideoUrl(pollData);
      if (!videoUrl) throw new Error('Wan 成功但无视频 URL');
      return { url: videoUrl, taskId: String(taskId) };
    }
    if (status === 'FAILED' || status === 'ERROR' || status === 'CANCELLED') {
      throw new Error(pollData.output?.message || pollData.output?.error || 'Wan 视频生成失败');
    }
  }

  throw new Error('Wan 视频生成超时');
}

// Native Kling endpoint paths (relative to /kling/v1/videos/)
// kling-video is handled dynamically: text2video vs image2video based on uploads
const KLING_VIDEO_PATH_MAP: Record<string, string> = {
  'kling-omni-video': 'omni-video',
  'kling-video-extend': 'video-extend',
  'kling-motion-control': 'motion-control',
  'kling-multi-elements': 'multi-elements',
  'kling-avatar-image2video': 'avatar/image2video',
  'kling-advanced-lip-sync': 'advanced-lip-sync',
  'kling-effects': 'effects',
};

export async function generateVideoViaKling(
  params: FreedomVideoParams,
  model: string,
  apiKey: string,
  baseUrl: string,
): Promise<GenerationResult> {
  const rootBase = getRootBaseUrl(baseUrl);
  const uploads = params.uploadFiles || [];
  const firstFrame = uploads.find((f) => f.role === 'single' || f.role === 'first');
  const lastFrame = uploads.find((f) => f.role === 'last');

  // Determine the endpoint path
  // Specialized models have a fixed path; all kling-video variants (kling-v2-1-master,
  // kling-v2-6-pro, kling-v3-0-pro, etc.) fall through to text2video / image2video.
  let endpointPath: string;
  const specialPath = KLING_VIDEO_PATH_MAP[model];
  if (specialPath) {
    endpointPath = specialPath;
  } else {
    endpointPath = firstFrame ? 'image2video' : 'text2video';
  }

  const body: Record<string, any> = {
    model_name: resolveKlingModelName(model),
    prompt: params.prompt,
    aspect_ratio: params.aspectRatio || '16:9',
    duration: String(params.duration ? Math.min(10, Math.max(5, params.duration)) : 5),
    mode: 'std',
  };

  // Attach image URLs for image-based endpoints
  if (endpointPath === 'image2video' && firstFrame) {
    body.image_url = await toUploadHttpUrl(firstFrame);
    if (lastFrame) body.tail_image_url = await toUploadHttpUrl(lastFrame);
  } else if (endpointPath === 'avatar/image2video' && firstFrame) {
    body.image_url = await toUploadHttpUrl(firstFrame);
  }

  const submitUrl = `${rootBase}/kling/v1/videos/${endpointPath}`;
  const submitResp = await freedomObservedFetch(submitUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });
  if (!submitResp.ok) {
    throw toHttpError('Kling submit failed', submitResp.status, await submitResp.text());
  }

  const submitData = await submitResp.json();
  const taskId = submitData.data?.task_id;
  if (!taskId) throw new Error('Kling 返回空任务 ID');

  // Poll URL mirrors the submit path: GET /kling/v1/videos/{path}/{task_id}
  const pollUrl = `${rootBase}/kling/v1/videos/${endpointPath}/${taskId}`;
  for (let i = 0; i < VIDEO_POLL_MAX_ATTEMPTS; i++) {
    await new Promise((r) => setTimeout(r, VIDEO_POLL_INTERVAL));
    const pollResp = await freedomObservedFetch(pollUrl, {
      headers: { 'Authorization': `Bearer ${apiKey}` },
    });
    if (!pollResp.ok) continue;
    const pollData = await pollResp.json();
    const status = String(pollData.data?.task_status || '').toLowerCase();
    if (status === 'succeed' || status === 'success' || status === 'completed') {
      const videoUrl =
        pollData.data?.task_result?.videos?.[0]?.url ||
        pollData.data?.task_result?.video_url ||
        extractVideoUrl(pollData);
      if (!videoUrl) throw new Error('Kling 成功但无视频 URL');
      return { url: videoUrl, taskId: String(taskId) };
    }
    if (status === 'failed' || status === 'error') {
      throw new Error(pollData.data?.task_status_msg || pollData.message || 'Kling 视频生成失败');
    }
  }

  throw new Error('Kling 视频生成超时');
}


