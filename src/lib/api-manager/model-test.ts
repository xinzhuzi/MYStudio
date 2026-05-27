import { parseApiKeys, type IProvider } from "../api-key-manager";

export type ModelTestType = "text" | "image" | "video" | "tts" | "vision";
export type ModelTestProtocol =
  | "openai-compatible"
  | "anthropic-compatible"
  | "gemini-compatible";

export interface ModelTestRequest {
  provider: Pick<IProvider, "id" | "platform" | "name" | "baseUrl" | "apiKey" | "model">;
  model: string;
  type: ModelTestType;
}

export interface ModelTestResult {
  success: boolean;
  message?: string;
  error?: string;
  elapsedMs?: number;
  status?: number;
  protocol?: ModelTestProtocol;
  attempts?: ModelTestAttemptResult[];
}

export interface ModelTestAttemptResult {
  protocol: ModelTestProtocol;
  label: string;
  endpoint: string;
  success: boolean;
  elapsedMs: number;
  status?: number;
  error?: string;
}

export interface PreparedTextModelTestAttempt {
  protocol: ModelTestProtocol;
  label: string;
  endpoint: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

export interface PreparedTextModelTest {
  success: true;
  dryRun: false;
  attempts: PreparedTextModelTestAttempt[];
  protocol: ModelTestProtocol;
  label: string;
  endpoint: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

export interface PreparedDryRunModelTest {
  success: true;
  dryRun: true;
  message: string;
}

export interface FailedModelTestPreparation {
  success: false;
  error: string;
}

export type PreparedModelTest =
  | PreparedTextModelTest
  | PreparedDryRunModelTest
  | FailedModelTestPreparation;

export function buildOpenAICompatibleEndpoint(baseUrl: string, path: string): string {
  const normalized = baseUrl.replace(/\/+$/, "");
  return /\/v\d+$/.test(normalized) ? `${normalized}/${path}` : `${normalized}/v1/${path}`;
}

export function buildGeminiCompatibleEndpoint(baseUrl: string, model: string): string {
  const normalized = baseUrl.replace(/\/+$/, "");
  const versioned = /\/v\d+(beta)?$/.test(normalized) ? normalized : `${normalized}/v1beta`;
  return `${versioned}/models/${encodeURIComponent(model)}:generateContent`;
}

function buildTextModelTestAttempts(baseUrl: string, apiKey: string, model: string): PreparedTextModelTestAttempt[] {
  const prompt = "回复 OK 和模型名称";
  return [
    {
      protocol: "openai-compatible",
      label: "OpenAI 兼容",
      endpoint: buildOpenAICompatibleEndpoint(baseUrl, "chat/completions"),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: {
        model,
        messages: [{ role: "user", content: prompt }],
        max_tokens: 32,
        temperature: 0,
      },
    },
    {
      protocol: "anthropic-compatible",
      label: "Anthropic 兼容",
      endpoint: buildOpenAICompatibleEndpoint(baseUrl, "messages"),
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: {
        model,
        max_tokens: 32,
        messages: [{ role: "user", content: prompt }],
      },
    },
    {
      protocol: "gemini-compatible",
      label: "Gemini 兼容",
      endpoint: buildGeminiCompatibleEndpoint(baseUrl, model),
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: {
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          maxOutputTokens: 32,
          temperature: 0,
        },
      },
    },
  ];
}

export function prepareModelTestRequest(payload: ModelTestRequest): PreparedModelTest {
  const keys = parseApiKeys(payload.provider.apiKey);
  if (keys.length === 0) {
    return { success: false, error: "缺少 API Key" };
  }

  const baseUrl = payload.provider.baseUrl?.trim();
  if (!baseUrl) {
    return { success: false, error: "缺少 Base URL" };
  }

  const model = payload.model?.trim();
  if (!model) {
    return { success: false, error: "缺少模型" };
  }

  if (payload.type !== "text") {
    return {
      success: true,
      dryRun: true,
      message: `配置 dry-run 通过，V1 暂不调用 ${payload.type} 模型`,
    };
  }

  const attempts = buildTextModelTestAttempts(baseUrl, keys[0], model);
  const firstAttempt = attempts[0];
  return {
    success: true,
    dryRun: false,
    attempts,
    protocol: firstAttempt.protocol,
    label: firstAttempt.label,
    endpoint: firstAttempt.endpoint,
    headers: firstAttempt.headers,
    body: firstAttempt.body,
  };
}

function parseOpenAICompatibleResponse(text: string): string | undefined {
  const data = JSON.parse(text) as { choices?: Array<{ message?: { content?: string } }> };
  return data.choices?.[0]?.message?.content?.trim();
}

function parseAnthropicCompatibleResponse(text: string): string | undefined {
  const data = JSON.parse(text) as {
    content?: Array<{ type?: string; text?: string }>;
  };
  return data.content
    ?.map((item) => item.text?.trim())
    .filter(Boolean)
    .join(" ");
}

function parseGeminiCompatibleResponse(text: string): string | undefined {
  const data = JSON.parse(text) as {
    candidates?: Array<{
      content?: {
        parts?: Array<{ text?: string }>;
      };
    }>;
  };
  return data.candidates?.[0]?.content?.parts
    ?.map((part) => part.text?.trim())
    .filter(Boolean)
    .join(" ");
}

function parseModelTestSuccessText(protocol: ModelTestProtocol, text: string): string | undefined {
  try {
    if (protocol === "anthropic-compatible") return parseAnthropicCompatibleResponse(text);
    if (protocol === "gemini-compatible") return parseGeminiCompatibleResponse(text);
    return parseOpenAICompatibleResponse(text);
  } catch {
    return undefined;
  }
}

type ModelTestFetch = (input: string, init: {
  method: "POST";
  headers: Record<string, string>;
  body: string;
  signal?: AbortSignal;
}) => Promise<Response>;

export async function runModelTestRequest(
  payload: ModelTestRequest,
  fetcher: ModelTestFetch = fetch,
  timeoutMs = 15000,
): Promise<ModelTestResult> {
  const prepared = prepareModelTestRequest(payload);
  if (!prepared.success) {
    return { success: false, error: prepared.error };
  }

  if (prepared.dryRun) {
    return { success: true, message: prepared.message };
  }

  const attempts: ModelTestAttemptResult[] = [];
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
          error: `模型测试失败 (${response.status}) ${text.slice(0, 240)}`,
        });
        continue;
      }

      const content = parseModelTestSuccessText(attempt.protocol, text);
      return {
        success: true,
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
        message: content
          ? `测试通过 · ${attempt.label} · ${content.slice(0, 120)} · ${elapsedMs}ms`
          : `测试通过 · ${attempt.label} · ${payload.model} · ${elapsedMs}ms`,
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
    error: attempts
      .map((attempt) => `${attempt.label}: ${attempt.error || attempt.status || "失败"}`)
      .join("；") || "模型测试失败",
  };
}
