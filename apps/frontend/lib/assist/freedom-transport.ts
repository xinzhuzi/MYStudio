import { createOperationId } from "@/lib/diagnostics/logger";
import { observedFetch, type ObservedFetchMeta } from "@/lib/diagnostics/network";
import { uploadBase64Image } from "@/lib/utils/image-upload";
import type { FreedomVideoUploadFile } from "./video-upload-validation";

export function inferFreedomEndpointFamily(input: RequestInfo | URL) {
  const raw = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  try {
    const path = new URL(raw, "http://local").pathname.toLowerCase();
    if (path.includes("chat/completions")) return "freedom-chat-completions";
    if (path.includes("image") || path.includes("mj/") || path.includes("replicate")) return "freedom-image";
    if (path.includes("video") || path.includes("generations") || path.includes("tasks")) return "freedom-video";
    if (path.includes("upload")) return "freedom-upload";
  } catch {
    // data URLs and relative proxy URLs still get a generic family.
  }
  return "freedom-network";
}

export function freedomObservedFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
  meta?: Partial<ObservedFetchMeta>,
) {
  const { endpointFamily, ...restMeta } = meta ?? {};
  return observedFetch(input, init, {
    operationId: createOperationId("freedom-http"),
    endpointFamily: endpointFamily ?? inferFreedomEndpointFamily(input),
    ...restMeta,
  });
}

export function buildFreedomEndpoint(baseUrl: string, path: string): string {
  const normalized = baseUrl.replace(/\/+$/, "");
  return /\/v\d+$/.test(normalized) ? `${normalized}/${path}` : `${normalized}/v1/${path}`;
}

export function getFreedomRootBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "").replace(/\/v\d+$/, "");
}

export async function toUploadHttpUrl(file: FreedomVideoUploadFile): Promise<string> {
  if (/^https?:\/\//i.test(file.dataUrl)) return file.dataUrl;
  return uploadBase64Image(file.dataUrl);
}

export function dataUrlToBlob(dataUrl: string, mimeHint?: string): Blob {
  const match = dataUrl.match(/^data:(.*?);base64,(.*)$/);
  if (!match) throw new Error("上传文件格式无效，必须是 data URL 或 http(s) URL");
  const mime = match[1] || mimeHint || "image/png";
  const bytes = Uint8Array.from(atob(match[2]), (character) => character.charCodeAt(0));
  return new Blob([bytes], { type: mime });
}

export async function toUploadBlob(file: FreedomVideoUploadFile): Promise<Blob> {
  if (/^https?:\/\//i.test(file.dataUrl)) {
    const response = await freedomObservedFetch(file.dataUrl);
    if (!response.ok) throw new Error(`无法下载上传素材：${response.status}`);
    return response.blob();
  }
  return dataUrlToBlob(file.dataUrl, file.mimeType);
}

type FreedomResponseData = {
  data?: Array<{ url?: string; b64_json?: string }>;
  url?: string;
  output?: string | string[] | { url?: string; video_url?: string };
  outputs?: string[];
  choices?: Array<{ message?: { content?: string } }>;
  video_url?: string;
  response?: { url?: string };
  status?: string;
  state?: string;
  error?: string;
  message?: string;
};

function extractNestedOutputUrl(output: FreedomResponseData["output"]): string | null {
  return output && typeof output === "object" && !Array.isArray(output) ? output.url || null : null;
}

export function extractFreedomImageUrl(data: FreedomResponseData): string | null {
  if (data.data?.[0]?.url) return data.data[0].url;
  if (data.data?.[0]?.b64_json) return `data:image/png;base64,${data.data[0].b64_json}`;
  if (data.url) return data.url;
  const nestedOutputUrl = extractNestedOutputUrl(data.output);
  if (nestedOutputUrl) return nestedOutputUrl;
  if (typeof data.output === "string" && data.output.startsWith("http")) return data.output;
  if (Array.isArray(data.output) && typeof data.output[0] === "string") return data.output[0];
  if (data.outputs?.[0]) return data.outputs[0];
  if (data.choices?.[0]?.message?.content) {
    const content = data.choices[0].message.content;
    const markdownMatch = content.match(/!\[.*?\]\((https?:\/\/[^)]+)\)/);
    if (markdownMatch) return markdownMatch[1];
    if (content.startsWith("http")) return content.trim();
  }
  return null;
}

export function extractFreedomVideoUrl(data: FreedomResponseData): string | null {
  if (data.data?.[0]?.url) return data.data[0].url;
  if (data.url) return data.url;
  const nestedOutputUrl = extractNestedOutputUrl(data.output);
  if (nestedOutputUrl) return nestedOutputUrl;
  if (typeof data.output === "string" && data.output.startsWith("http")) return data.output;
  if (Array.isArray(data.output) && typeof data.output[0] === "string") return data.output[0];
  if (data.outputs?.[0]) return data.outputs[0];
  if (data.video_url) return data.video_url;
  if (data.response?.url) return data.response.url;
  return null;
}

export async function pollForFreedomResult(
  pollUrl: string,
  apiKey: string,
  interval: number,
  maxAttempts: number,
  operationId?: string,
  taskId?: string,
): Promise<string | null> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, interval));
    try {
      const response = await freedomObservedFetch(
        pollUrl,
        { headers: { Authorization: `Bearer ${apiKey}` } },
        {
          operationId,
          endpointFamily: inferFreedomEndpointFamily(pollUrl),
          taskId,
          pollAttempt: attempt + 1,
          maxRetries: maxAttempts,
        },
      );
      if (!response.ok) continue;
      const data = await response.json();
      const status = (data.status || data.state || "").toLowerCase();
      if (status === "completed" || status === "succeeded" || status === "success") {
        return extractFreedomImageUrl(data) || extractFreedomVideoUrl(data);
      }
      if (status === "failed" || status === "error" || status === "cancelled") {
        throw new Error(`Generation failed: ${data.error || data.message || status}`);
      }
      console.log(`[Freedom] Polling attempt ${attempt + 1}/${maxAttempts}, status: ${status}`);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.startsWith("Generation failed")) throw error;
      console.warn(`[Freedom] Poll error (attempt ${attempt + 1}):`, message);
    }
  }
  return null;
}
