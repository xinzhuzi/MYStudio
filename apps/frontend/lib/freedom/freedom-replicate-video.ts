import type { FreedomVideoParams, GenerationResult } from "./freedom-api";
import {
  extractFreedomVideoUrl,
  freedomObservedFetch,
  getFreedomRootBaseUrl,
  toUploadHttpUrl,
} from "./freedom-transport";
import { groupVideoUploadFiles } from "./video-upload-validation";

const DEFAULT_POLL_INTERVAL_MS = 2000;
const DEFAULT_MAX_POLL_ATTEMPTS = 120;

interface ReplicatePollingOptions {
  pollIntervalMs?: number;
  maxPollAttempts?: number;
}

function toReplicateHttpError(status: number, body: string): Error & { status: number } {
  const error = new Error(`Replicate video submit failed: ${status} ${body}`) as Error & { status: number };
  error.status = status;
  return error;
}

export async function generateVideoViaReplicate(
  params: FreedomVideoParams,
  model: string,
  apiKey: string,
  baseUrl: string,
  options: ReplicatePollingOptions = {},
): Promise<GenerationResult> {
  const rootBase = getFreedomRootBaseUrl(baseUrl);
  const submitUrl = `${rootBase}/replicate/v1/predictions`;
  const input: Record<string, unknown> = { prompt: params.prompt };

  if (params.aspectRatio) input.aspect_ratio = params.aspectRatio;
  if (params.duration) input.duration = params.duration;
  if (params.resolution) input.resolution = params.resolution;

  const grouped = groupVideoUploadFiles(params.uploadFiles);
  const primaryFile = grouped.single || grouped.first;
  if (primaryFile) input.image = await toUploadHttpUrl(primaryFile);
  if (grouped.last) input.tail_image = await toUploadHttpUrl(grouped.last);

  const submitResponse = await freedomObservedFetch(submitUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, input }),
  });
  if (!submitResponse.ok) {
    throw toReplicateHttpError(submitResponse.status, await submitResponse.text());
  }

  const submitData = await submitResponse.json();
  const directUrl = extractFreedomVideoUrl(submitData);
  if (directUrl) return { url: directUrl };

  const predictionId = submitData.id;
  if (!predictionId) throw new Error("Replicate 返回空 prediction ID");

  const pollUrl = `${rootBase}/replicate/v1/predictions/${predictionId}`;
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const maxPollAttempts = options.maxPollAttempts ?? DEFAULT_MAX_POLL_ATTEMPTS;
  for (let attempt = 0; attempt < maxPollAttempts; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    const pollResponse = await freedomObservedFetch(pollUrl, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!pollResponse.ok) continue;

    const pollData = await pollResponse.json();
    const status = String(pollData.status || "").toLowerCase();
    if (status === "succeeded") {
      const videoUrl = extractFreedomVideoUrl(pollData);
      if (!videoUrl) throw new Error("Replicate 成功但未返回视频 URL");
      return { url: videoUrl, taskId: String(predictionId) };
    }
    if (status === "failed" || status === "canceled") {
      throw new Error(pollData.error || "Replicate 视频生成失败");
    }
  }

  throw new Error("Replicate 视频生成超时");
}
