import { parseApiKeys, type IProvider } from "../api-key-manager";
import {
  buildGeminiCompatibleEndpoint,
  buildOpenAICompatibleEndpoint,
  type ModelTestProtocol,
} from "./model-test";

export interface TextCompletionMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface TextCompletionRequest {
  provider: Pick<IProvider, "id" | "platform" | "name" | "baseUrl" | "apiKey" | "model" | "apiProtocol">;
  model: string;
  messages: TextCompletionMessage[];
  temperature?: number;
  maxTokens?: number;
}

export interface TextCompletionAttempt {
  protocol: ModelTestProtocol;
  label: string;
  endpoint: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

export interface PreparedTextCompletion {
  success: true;
  attempts: TextCompletionAttempt[];
}

export interface FailedTextCompletionPreparation {
  success: false;
  error: string;
}

export type PreparedTextCompletionRequest = PreparedTextCompletion | FailedTextCompletionPreparation;

export interface TextCompletionAttemptResult {
  protocol: ModelTestProtocol;
  label: string;
  endpoint: string;
  success: boolean;
  elapsedMs: number;
  status?: number;
  error?: string;
}

export interface TextCompletionResult {
  success: boolean;
  text?: string;
  error?: string;
  elapsedMs?: number;
  status?: number;
  protocol?: ModelTestProtocol;
  attempts?: TextCompletionAttemptResult[];
}

type TextCompletionFetch = (input: string, init: {
  method: "POST";
  headers: Record<string, string>;
  body: string;
  signal?: AbortSignal;
}) => Promise<Response>;

export function prepareTextCompletionRequest(payload: TextCompletionRequest): PreparedTextCompletionRequest {
  const keys = parseApiKeys(payload.provider.apiKey);
  if (keys.length === 0) return { success: false, error: "缺少 API Key" };

  const baseUrl = payload.provider.baseUrl?.trim();
  if (!baseUrl) return { success: false, error: "缺少 Base URL" };

  const model = payload.model?.trim();
  if (!model) return { success: false, error: "缺少模型" };

  const messages = payload.messages.filter((message) => message.content.trim());
  if (!messages.length) return { success: false, error: "缺少消息内容" };

  const attempts = buildTextCompletionAttempts({
    baseUrl,
    apiKey: keys[0]!,
    model,
    messages,
    temperature: payload.temperature,
    maxTokens: payload.maxTokens ?? 2048,
  });

  const protocol = payload.provider.apiProtocol;
  return {
    success: true,
    attempts: protocol ? attempts.filter((attempt) => attempt.protocol === protocol) : attempts,
  };
}

export async function runTextCompletionRequest(
  payload: TextCompletionRequest,
  fetcher: TextCompletionFetch = fetch,
  timeoutMs = 60000,
): Promise<TextCompletionResult> {
  const prepared = prepareTextCompletionRequest(payload);
  if (!prepared.success) return { success: false, error: prepared.error };
  if (!prepared.attempts.length) return { success: false, error: "没有可用的接口协议" };

  const attempts: TextCompletionAttemptResult[] = [];
  for (const attempt of prepared.attempts) {
    const startedAt = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetcher(attempt.endpoint, {
        method: "POST",
        headers: attempt.headers,
        body: JSON.stringify(attempt.body),
        signal: controller.signal,
      });
      const elapsedMs = Date.now() - startedAt;
      const text = await response.text();
      if (!response.ok) {
        attempts.push({
          protocol: attempt.protocol,
          label: attempt.label,
          endpoint: attempt.endpoint,
          success: false,
          status: response.status,
          elapsedMs,
          error: `文本模型调用失败 (${response.status}) ${text.slice(0, 240)}`,
        });
        continue;
      }

      const content = parseTextCompletionSuccess(attempt.protocol, text);
      if (!content) {
        attempts.push({
          protocol: attempt.protocol,
          label: attempt.label,
          endpoint: attempt.endpoint,
          success: false,
          status: response.status,
          elapsedMs,
          error: "模型响应中缺少文本内容",
        });
        continue;
      }

      return {
        success: true,
        text: content,
        protocol: attempt.protocol,
        status: response.status,
        elapsedMs,
        attempts: [
          ...attempts,
          {
            protocol: attempt.protocol,
            label: attempt.label,
            endpoint: attempt.endpoint,
            success: true,
            status: response.status,
            elapsedMs,
          },
        ],
      };
    } catch (error) {
      attempts.push({
        protocol: attempt.protocol,
        label: attempt.label,
        endpoint: attempt.endpoint,
        success: false,
        elapsedMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      clearTimeout(timer);
    }
  }

  const lastAttempt = attempts[attempts.length - 1];
  return {
    success: false,
    attempts,
    protocol: lastAttempt?.protocol,
    status: lastAttempt?.status,
    elapsedMs: attempts.reduce((sum, attempt) => sum + attempt.elapsedMs, 0),
    error: attempts.map((attempt) => `${attempt.label}: ${attempt.error || attempt.status || "失败"}`).join("；"),
  };
}

function buildTextCompletionAttempts(input: {
  baseUrl: string;
  apiKey: string;
  model: string;
  messages: TextCompletionMessage[];
  temperature?: number;
  maxTokens: number;
}): TextCompletionAttempt[] {
  const system = input.messages
    .filter((message) => message.role === "system")
    .map((message) => message.content)
    .join("\n\n");
  const nonSystemMessages = input.messages.filter((message) => message.role !== "system");

  return [
    {
      protocol: "openai-compatible",
      label: "OpenAI 兼容",
      endpoint: buildOpenAICompatibleEndpoint(input.baseUrl, "chat/completions"),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${input.apiKey}`,
      },
      body: {
        model: input.model,
        messages: input.messages,
        max_tokens: input.maxTokens,
        temperature: input.temperature ?? 0.2,
      },
    },
    {
      protocol: "anthropic-compatible",
      label: "Anthropic 兼容",
      endpoint: buildOpenAICompatibleEndpoint(input.baseUrl, "messages"),
      headers: {
        "Content-Type": "application/json",
        "x-api-key": input.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: {
        model: input.model,
        system: system || undefined,
        max_tokens: input.maxTokens,
        temperature: input.temperature ?? 0.2,
        messages: normalizeAnthropicMessages(nonSystemMessages),
      },
    },
    {
      protocol: "gemini-compatible",
      label: "Gemini 兼容",
      endpoint: buildGeminiCompatibleEndpoint(input.baseUrl, input.model),
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": input.apiKey,
      },
      body: {
        systemInstruction: system ? { parts: [{ text: system }] } : undefined,
        contents: nonSystemMessages.map((message) => ({
          role: message.role === "assistant" ? "model" : "user",
          parts: [{ text: message.content }],
        })),
        generationConfig: {
          maxOutputTokens: input.maxTokens,
          temperature: input.temperature ?? 0.2,
        },
      },
    },
  ];
}

function normalizeAnthropicMessages(messages: TextCompletionMessage[]) {
  return messages.map((message) => ({
    role: message.role === "assistant" ? "assistant" : "user",
    content: message.content,
  }));
}

function parseTextCompletionSuccess(protocol: ModelTestProtocol, text: string): string | undefined {
  const data = JSON.parse(text);
  if (protocol === "anthropic-compatible") {
    return data.content
      ?.map((item: { text?: string }) => item.text?.trim())
      .filter(Boolean)
      .join("\n")
      .trim();
  }
  if (protocol === "gemini-compatible") {
    return data.candidates?.[0]?.content?.parts
      ?.map((part: { text?: string }) => part.text?.trim())
      .filter(Boolean)
      .join("\n")
      .trim();
  }
  return data.choices?.[0]?.message?.content?.trim();
}
