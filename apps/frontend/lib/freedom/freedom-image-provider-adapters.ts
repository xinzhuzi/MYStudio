import type { FreedomImageParams, GenerationResult } from "./freedom-types";
import {
  extractFreedomImageUrl,
  freedomObservedFetch,
  getFreedomRootBaseUrl,
  pollForFreedomResult,
} from "./freedom-transport";
import { resolveKlingModelName } from "./freedom-model-names";

const IMAGE_POLL_INTERVAL = 2000;
const IMAGE_POLL_MAX_ATTEMPTS = 60;

export type SaveFreedomImage = (url: string, prompt: string) => string | undefined;

export async function generateViaKlingImageEndpoint(
  params: FreedomImageParams,
  model: string,
  apiKey: string,
  baseUrl: string,
  fallback: () => Promise<GenerationResult>,
  saveImage: SaveFreedomImage,
): Promise<GenerationResult> {
  const rootBase = getFreedomRootBaseUrl(baseUrl);
  const nativePath = model === "kling-omni-image"
    ? "kling/v1/images/omni-image"
    : "kling/v1/images/generations";
  const body: Record<string, any> = { prompt: params.prompt, model: resolveKlingModelName(model) };
  if (params.aspectRatio) body.aspect_ratio = params.aspectRatio;
  if (params.negativePrompt) body.negative_prompt = params.negativePrompt;
  if (params.referenceImages?.length) body.image_urls = params.referenceImages;
  if (params.extraParams) Object.assign(body, params.extraParams);
  let response: Response;
  try {
    response = await freedomObservedFetch(`${rootBase}/${nativePath}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
      body: JSON.stringify(body),
      signal: params.signal,
    });
  } catch {
    return fallback();
  }
  if (!response.ok) return fallback();
  const data = await response.json();
  let imageUrl = extractFreedomImageUrl(data);
  if (!imageUrl && data.task_id) {
    imageUrl = await pollForFreedomResult(
      `${rootBase}/${nativePath}/${data.task_id}`,
      apiKey,
      IMAGE_POLL_INTERVAL,
      IMAGE_POLL_MAX_ATTEMPTS,
    );
  }
  if (!imageUrl) return fallback();
  return { url: imageUrl, taskId: data.task_id, mediaId: saveImage(imageUrl, params.prompt) };
}

function toHttpError(prefix: string, status: number, body: string): Error & { status: number } {
  const error = new Error(`${prefix}: ${status} ${body}`) as Error & { status: number };
  error.status = status;
  return error;
}

function buildMidjourneyPrompt(params: FreedomImageParams): string {
  let prompt = params.prompt;
  const extra = params.extraParams || {};
  const stylization = typeof extra.stylization === "number" ? extra.stylization : undefined;
  const weirdness = typeof extra.weirdness === "number" ? extra.weirdness : undefined;
  if (params.aspectRatio && !/\s--ar\s+\S+/i.test(prompt)) prompt += ` --ar ${params.aspectRatio}`;
  if (stylization !== undefined && !/\s--s(tylize)?\s+\S+/i.test(prompt)) prompt += ` --s ${stylization}`;
  if (weirdness !== undefined && !/\s--weird\s+\S+/i.test(prompt)) prompt += ` --weird ${weirdness}`;
  return prompt;
}

function mapMidjourneyMode(speed: unknown): string[] | undefined {
  if (typeof speed !== "string") return undefined;
  const modes: Record<string, string[]> = { relaxed: ["RELAX"], fast: ["FAST"], turbo: ["TURBO"] };
  return modes[speed.toLowerCase()];
}

export async function generateViaMidjourneyEndpoint(
  params: FreedomImageParams,
  model: string,
  apiKey: string,
  baseUrl: string,
  saveImage: SaveFreedomImage,
): Promise<GenerationResult> {
  const rootBase = getFreedomRootBaseUrl(baseUrl);
  const extra = params.extraParams || {};
  const requestBody: Record<string, unknown> = { prompt: buildMidjourneyPrompt(params) };
  const modes = mapMidjourneyMode(extra.speed);
  if (modes) requestBody.accountFilter = { modes };
  if (/niji/i.test(model)) requestBody.botType = "NIJI_JOURNEY";
  if (Array.isArray(extra.base64Array) && extra.base64Array.length > 0) requestBody.base64Array = extra.base64Array;

  const response = await freedomObservedFetch(`${rootBase}/mj/submit/imagine`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(requestBody),
  });
  if (!response.ok) throw toHttpError("Midjourney submit failed", response.status, await response.text());
  const data = await response.json();
  if (data.code !== undefined && data.code !== 1) {
    throw new Error(data.description || data.error || `Midjourney 提交失败 (code=${data.code})`);
  }
  const taskId = data.result || data.task_id || data.id;
  if (!taskId) throw new Error("Midjourney 返回空任务 ID");

  for (let attempt = 0; attempt < IMAGE_POLL_MAX_ATTEMPTS; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 2500));
    const pollResponse = await freedomObservedFetch(`${rootBase}/mj/task/${taskId}/fetch`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!pollResponse.ok) continue;
    const pollData = await pollResponse.json();
    const status = String(pollData.status || "").toLowerCase();
    if (["success", "succeeded", "completed"].includes(status)) {
      const imageUrl = pollData.imageUrl || pollData.image_url || pollData.url
        || pollData.data?.imageUrl || pollData.data?.image_url;
      if (!imageUrl) throw new Error("Midjourney 成功但未返回图片 URL");
      return { url: imageUrl, taskId: String(taskId), mediaId: saveImage(imageUrl, params.prompt) };
    }
    if (["failure", "failed", "error"].includes(status)) {
      throw new Error(pollData.failReason || pollData.message || "Midjourney 生成失败");
    }
  }
  throw new Error("Midjourney 生成超时");
}

function toIdeogramAspectRatio(model: string, aspectRatio?: string): string | undefined {
  if (!aspectRatio) return undefined;
  return /_V_[12](_|$)/i.test(model)
    ? `ASPECT_${aspectRatio.replace(":", "_")}`
    : aspectRatio.replace(":", "x");
}

function toIdeogramRenderSpeed(input: unknown): string | undefined {
  if (typeof input !== "string") return undefined;
  const speeds: Record<string, string> = { turbo: "TURBO", quality: "QUALITY", balanced: "DEFAULT" };
  return speeds[input.toLowerCase()] || input.toUpperCase();
}

function toIdeogramRenderSpeedFromModel(model: string): string | undefined {
  return model.match(/_(TURBO|DEFAULT|QUALITY|FLASH)$/i)?.[1].toUpperCase();
}

export async function generateViaIdeogramEndpoint(
  params: FreedomImageParams,
  model: string,
  apiKey: string,
  baseUrl: string,
  saveImage: SaveFreedomImage,
): Promise<GenerationResult> {
  const form = new FormData();
  const extra = params.extraParams || {};
  form.append("model", model);
  form.append("prompt", params.prompt);
  const aspect = toIdeogramAspectRatio(model, params.aspectRatio);
  if (aspect) form.append("aspect_ratio", aspect);
  const speed = toIdeogramRenderSpeed(extra.render_speed || extra.rendering_speed)
    ?? toIdeogramRenderSpeedFromModel(model);
  if (speed) form.append("rendering_speed", speed);
  if (typeof extra.style === "string") form.append("style_type", extra.style.toUpperCase());
  if (typeof params.negativePrompt === "string" && params.negativePrompt.trim()) form.append("negative_prompt", params.negativePrompt);
  if (typeof extra.num_images === "number") form.append("num_images", String(extra.num_images));

  const rootBase = getFreedomRootBaseUrl(baseUrl);
  const response = await freedomObservedFetch(`${rootBase}/ideogram/v1/ideogram-v3/generate`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  if (!response.ok) throw toHttpError("Ideogram generate failed", response.status, await response.text());
  const imageUrl = extractFreedomImageUrl(await response.json());
  if (!imageUrl) throw new Error("Ideogram 响应未包含图片 URL");
  return { url: imageUrl, mediaId: saveImage(imageUrl, params.prompt) };
}

export async function generateViaReplicateImageEndpoint(
  params: FreedomImageParams,
  model: string,
  apiKey: string,
  baseUrl: string,
  saveImage: SaveFreedomImage,
): Promise<GenerationResult> {
  const rootBase = getFreedomRootBaseUrl(baseUrl);
  const input: Record<string, unknown> = { prompt: params.prompt };
  if (params.aspectRatio) input.aspect_ratio = params.aspectRatio;
  if (params.resolution) input.resolution = params.resolution;
  if (params.width) input.width = params.width;
  if (params.height) input.height = params.height;
  if (params.negativePrompt) input.negative_prompt = params.negativePrompt;
  if (params.extraParams) Object.assign(input, params.extraParams);

  const response = await freedomObservedFetch(`${rootBase}/replicate/v1/predictions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, input }),
  });
  if (!response.ok) throw toHttpError("Replicate submit failed", response.status, await response.text());
  const data = await response.json();
  const directUrl = extractFreedomImageUrl(data);
  if (directUrl) return { url: directUrl, mediaId: saveImage(directUrl, params.prompt) };
  const predictionId = data.id;
  if (!predictionId) throw new Error("Replicate 返回空 prediction ID");

  for (let attempt = 0; attempt < IMAGE_POLL_MAX_ATTEMPTS; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, IMAGE_POLL_INTERVAL));
    const pollResponse = await freedomObservedFetch(`${rootBase}/replicate/v1/predictions/${predictionId}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!pollResponse.ok) continue;
    const pollData = await pollResponse.json();
    const status = String(pollData.status || "").toLowerCase();
    if (status === "succeeded") {
      const imageUrl = extractFreedomImageUrl(pollData);
      if (!imageUrl) throw new Error("Replicate 成功但未返回图片 URL");
      return { url: imageUrl, taskId: String(predictionId), mediaId: saveImage(imageUrl, params.prompt) };
    }
    if (status === "failed" || status === "canceled") throw new Error(pollData.error || "Replicate 图片生成失败");
  }
  throw new Error("Replicate 图片生成超时");
}
