import {
  getTargetDimensions,
  geminiSupportsImageSize,
  isGeminiImageModel,
  normalizeResolutionForGemini,
} from './image-generator-helpers';

export interface ChatImageRequestInput {
  model: string;
  prompt: string;
  aspectRatio: string;
  resolution?: string;
  referenceImages?: string[];
}

/** Pure provider boundary: builds the multimodal chat request without I/O. */
export function buildChatCompletionsImageRequest(input: ChatImageRequestInput): Record<string, unknown> {
  const { model, prompt, aspectRatio, resolution, referenceImages } = input;
  const isGemini = isGeminiImageModel(model);
  const geminiHasImageSize = isGemini && geminiSupportsImageSize(model);
  const targetDims = getTargetDimensions(aspectRatio, resolution);
  const sizeInstruction = targetDims
    ? ` Output the image at ${targetDims.width}x${targetDims.height} pixels resolution.`
    : '';
  const content: Array<{ type: string; text?: string; image_url?: { url: string } }> = [
    { type: 'text', text: `Generate an image with aspect ratio ${aspectRatio}.${sizeInstruction} ${prompt}` },
  ];
  for (const image of referenceImages ?? []) content.push({ type: 'image_url', image_url: { url: image } });
  const body: Record<string, unknown> = {
    model,
    messages: [{ role: 'user', content }],
    max_tokens: 4096,
    stream: false,
  };
  if (isGemini) {
    const geminiResolution = geminiHasImageSize ? normalizeResolutionForGemini(resolution) : undefined;
    if (geminiResolution) body.image_size = geminiResolution;
    body.aspect_ratio = aspectRatio;
    body.generation_config = {
      response_modalities: ['TEXT', 'IMAGE'],
      image_config: { ...(geminiResolution ? { image_size: geminiResolution } : {}), aspect_ratio: aspectRatio },
    };
  }
  return body;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' ? value as Record<string, unknown> : undefined;
}

function firstChoice(data: unknown): Record<string, unknown> | undefined {
  const choices = asRecord(data)?.choices;
  return Array.isArray(choices) ? asRecord(choices[0]) : undefined;
}

function messageContent(data: unknown): unknown {
  return asRecord(firstChoice(data)?.message)?.content;
}

function extractStringImageUrl(value: string): string | undefined {
  const markdown = value.match(/!\[.*?\]\((https?:\/\/[^)]+)\)/);
  if (markdown) return markdown[1];
  const base64 = value.match(/(data:image\/[^;]+;base64,[A-Za-z0-9+/=]+)/);
  if (base64) return base64[1];
  const url = value.match(/(https?:\/\/[^\s"']+\.(?:png|jpg|jpeg|webp|gif)[^\s"']*)/i);
  return url?.[1];
}

function appendOrUseSnapshot(current: string, next: string): string {
  if (!current) return next;
  return next.startsWith(current) ? next : current + next;
}

function buildStreamedContent(text: string, parts: unknown[]): unknown {
  if (parts.length === 0) return text;
  return text ? [{ type: 'text', text }, ...parts] : parts;
}

/** Pure parser for multimodal chat responses (JSON or reconstructed SSE shape). */
export function extractChatCompletionsImageUrl(data: unknown): string | undefined {
  const content = messageContent(data);
  if (Array.isArray(content)) {
    for (const rawPart of content) {
      const part = asRecord(rawPart);
      const imageUrl = asRecord(part?.image_url)?.url;
      const image = asRecord(part?.image)?.url;
      if (part?.type === 'image_url' && typeof imageUrl === 'string' && imageUrl) return imageUrl;
      if (part?.type === 'image' && typeof image === 'string' && image) return image;
      if (part?.type === 'image' && typeof part.data === 'string' && part.data) {
        return `data:image/png;base64,${part.data}`;
      }
      if (part?.type === 'text' && typeof part.text === 'string') {
        const imageFromText = extractStringImageUrl(part.text);
        if (imageFromText) return imageFromText;
      }
    }
  }
  if (typeof content === 'string') {
    return extractStringImageUrl(content);
  }
  return undefined;
}

/** Parse a chat-completions image response body, including SSE-shaped provider output. */
export function parseChatCompletionsImageResponseText(responseText: string): unknown {
  try {
    return JSON.parse(responseText);
  } catch {
    const lines = responseText.split(/\r?\n/).filter((line) => line.trimStart().startsWith('data:'));
    let accumulatedDeltaText = '';
    let accumulatedMessageText = '';
    const accumulatedDeltaParts: unknown[] = [];
    const accumulatedMessageParts: unknown[] = [];
    let lastChunk: Record<string, unknown> | null = null;

    for (const line of lines) {
      const payload = line.trimStart().replace(/^data:\s*/, '').trim();
      if (payload === '[DONE]') continue;
      try {
        const chunk = JSON.parse(payload) as Record<string, unknown>;
        lastChunk = chunk;
        const choice = firstChoice(chunk);
        const deltaContent = asRecord(choice?.delta)?.content;
        const currentMessageContent = asRecord(choice?.message)?.content;

        if (typeof deltaContent === 'string') {
          accumulatedDeltaText += deltaContent;
        } else if (Array.isArray(deltaContent)) {
          accumulatedDeltaParts.push(...deltaContent);
        }

        if (typeof currentMessageContent === 'string') {
          accumulatedMessageText = appendOrUseSnapshot(accumulatedMessageText, currentMessageContent);
        } else if (Array.isArray(currentMessageContent)) {
          accumulatedMessageParts.push(...currentMessageContent);
        }
      } catch {
        // Skip malformed SSE lines while preserving the original fail-closed behavior below.
      }
    }

    if (!lastChunk) {
      throw new Error(`无法解析图片 API 响应: ${responseText.substring(0, 120)}`);
    }

    const hasDeltaContent = accumulatedDeltaParts.length > 0 || accumulatedDeltaText.length > 0;
    const content = hasDeltaContent
      ? buildStreamedContent(accumulatedDeltaText, accumulatedDeltaParts)
      : buildStreamedContent(accumulatedMessageText, accumulatedMessageParts);

    return {
      ...lastChunk,
      choices: [{
        ...(firstChoice(lastChunk) || {}),
        message: {
          role: 'assistant',
          content,
        },
      }],
    };
  }
}
