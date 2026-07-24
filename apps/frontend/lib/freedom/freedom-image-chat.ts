import { DEFAULT_IMAGE_ASPECT_RATIO } from "@/lib/ai/image-size-presets";
import { buildFreedomEndpoint, freedomObservedFetch } from "./freedom-transport";
import type { FreedomImageParams, GenerationResult } from "./freedom-types";

type ChatImagePart = {
  type?: string;
  image_url?: { url?: string };
  image?: { url?: string };
  data?: string;
};

type ChatImageResponse = {
  choices?: Array<{ message?: { content?: string | ChatImagePart[] } }>;
};

export function extractChatCompletionsImage(data: ChatImageResponse): string | null {
  const content = data.choices?.[0]?.message?.content;
  if (Array.isArray(content)) {
    for (const part of content) {
      if (part.type === "image_url" && part.image_url?.url) return part.image_url.url;
      if (part.type === "image" && part.image?.url) return part.image.url;
      if (part.type === "image" && part.data) return `data:image/png;base64,${part.data}`;
    }
  }
  if (typeof content === "string") {
    const markdown = content.match(/!\[.*?\]\((https?:\/\/[^)]+)\)/);
    if (markdown) return markdown[1];
    const dataUrl = content.match(/(data:image\/[^;]+;base64,[A-Za-z0-9+/=]+)/);
    if (dataUrl) return dataUrl[1];
  }
  return null;
}

function toChatHttpError(message: string, status: number, body: string): Error & { status: number } {
  const error = new Error(`${message}: ${status} ${body}`) as Error & { status: number };
  error.status = status;
  return error;
}

export async function generateFreedomImageViaChat(
  params: FreedomImageParams,
  model: string,
  apiKey: string,
  baseUrl: string,
  saveMedia: (url: string, prompt: string) => string | undefined,
  operationId?: string,
): Promise<GenerationResult> {
  const endpoint = buildFreedomEndpoint(baseUrl, "chat/completions");
  const aspectRatio = params.aspectRatio || DEFAULT_IMAGE_ASPECT_RATIO;
  const content: Array<{ type: string; text?: string; image_url?: { url: string } }> = [
    { type: "text", text: `Generate an image with aspect ratio ${aspectRatio}: ${params.prompt}` },
  ];
  for (const image of params.referenceImages ?? []) {
    content.push({ type: "image_url", image_url: { url: image } });
  }

  console.log("[Freedom] Submitting via chat completions:", { model, endpoint });
  const response = await freedomObservedFetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, messages: [{ role: "user", content }], max_tokens: 4096 }),
    signal: params.signal,
  }, { operationId, endpointFamily: "freedom-chat-completions", model });
  if (!response.ok) {
    const body = await response.text();
    let message = `图片生成 API 错误: ${response.status}`;
    try {
      const parsed = JSON.parse(body) as { error?: { message?: string } };
      message = parsed.error?.message || message;
    } catch {
      // Keep the compatible status-based message for non-JSON responses.
    }
    throw toChatHttpError(message, response.status, body);
  }

  const imageUrl = extractChatCompletionsImage(await response.json() as ChatImageResponse);
  if (!imageUrl) throw new Error("未能从聊天响应中提取图片 URL");
  return { url: imageUrl, mediaId: saveMedia(imageUrl, params.prompt) };
}
