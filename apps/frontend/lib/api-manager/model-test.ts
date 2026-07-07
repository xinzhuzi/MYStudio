import { parseApiKeys, type IProvider } from "../api-key-manager";
import {
  buildOpenAIImageRequestBody,
  buildProviderExtensionImageRequestBody,
  extractImageGenerationResult,
  isGptImageModel,
  sdkGenerateImage,
  type SdkGenerateImageOptions,
  type SdkGenerateImageResult,
} from "../ai/ai-sdk-bridge";
import { THINKING_TEST_MAX_TOKENS, buildThinkingParams, resolveThinkingEnabled } from "../ai/thinking-mode";
import {
  DEFAULT_IMAGE_ASPECT_RATIO,
  DEFAULT_IMAGE_RESOLUTION,
  type ImageAspectRatio,
  type ImageResolution,
} from "../ai/image-size-presets";

export type ModelTestType = "text" | "image" | "video" | "tts" | "vision";
export type ModelTestProtocol =
  | "openai-compatible"
  | "anthropic-compatible"
  | "gemini-compatible";

export const DEFAULT_MODEL_TEST_TIMEOUT_MS = 15_000;
export const IMAGE_MODEL_TEST_TIMEOUT_MS = 120_000;

export function getModelTestTimeoutMs(type: ModelTestType) {
  return type === "image" ? IMAGE_MODEL_TEST_TIMEOUT_MS : DEFAULT_MODEL_TEST_TIMEOUT_MS;
}

export interface ModelTestRequest {
  provider: Pick<IProvider, "id" | "platform" | "name" | "baseUrl" | "apiKey" | "model">;
  model: string;
  type: ModelTestType;
  operationId?: string;
  imageGenerationSettings?: {
    defaultAspectRatio: ImageAspectRatio;
    defaultResolution: ImageResolution;
  };
  /**
   * 用户在设置里为该模型显式配置的「思考模式」开关。
   * true 强制开、false 强制关；省略则按模型名自动判断。
   */
  thinkingEnabled?: boolean;
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
  keyIndex?: number;
  template?: string;
}

export interface PreparedImageModelTestAttempt {
  protocol: "openai-compatible";
  label: string;
  endpoint: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
  keyIndex?: number;
  template?: "aspect-resolution" | "openai-size";
}

export interface PreparedTextModelTest {
  success: true;
  dryRun: false;
  type: "text";
  attempts: PreparedTextModelTestAttempt[];
  protocol: ModelTestProtocol;
  label: string;
  endpoint: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

export interface PreparedImageModelTest {
  success: true;
  dryRun: false;
  type: "image";
  attempts: PreparedImageModelTestAttempt[];
  protocol: "openai-compatible";
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
  | PreparedImageModelTest
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

function buildTextModelTestAttempts(baseUrl: string, apiKey: string, model: string, thinkingOverride?: boolean): PreparedTextModelTestAttempt[] {
  const prompt = "回复 OK 和模型名称";
  const thinking = resolveThinkingEnabled(model, thinkingOverride);
  const tokenBudget = thinking ? THINKING_TEST_MAX_TOKENS : 32;
  const openaiThinking = buildThinkingParams({ model, protocol: "openai-compatible", maxTokens: tokenBudget, enabled: thinkingOverride });
  const anthropicThinking = buildThinkingParams({ model, protocol: "anthropic-compatible", maxTokens: tokenBudget, enabled: thinkingOverride });
  const geminiThinking = buildThinkingParams({ model, protocol: "gemini-compatible", maxTokens: tokenBudget, enabled: thinkingOverride });
  const geminiThinkingConfig = (geminiThinking.generationConfig as { thinkingConfig?: unknown } | undefined)?.thinkingConfig;
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
        max_tokens: tokenBudget,
        temperature: 0,
        ...openaiThinking,
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
        max_tokens: tokenBudget,
        messages: [{ role: "user", content: prompt }],
        ...anthropicThinking,
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
          maxOutputTokens: tokenBudget,
          temperature: 0,
          ...(geminiThinkingConfig ? { thinkingConfig: geminiThinkingConfig } : {}),
        },
      },
    },
  ];
}

function buildImageModelTestAttempts(
  baseUrl: string,
  apiKeys: string[],
  model: string,
  imageSettings: ModelTestRequest["imageGenerationSettings"] = {
    defaultAspectRatio: DEFAULT_IMAGE_ASPECT_RATIO,
    defaultResolution: DEFAULT_IMAGE_RESOLUTION,
  },
): PreparedImageModelTestAttempt[] {
  const endpoint = buildOpenAICompatibleEndpoint(baseUrl, "images/generations");
  const prompt = "API 连通性测试图";
  const openAIImageBody = buildOpenAIImageRequestBody({
    model,
    prompt,
    aspectRatio: imageSettings.defaultAspectRatio,
    resolution: imageSettings.defaultResolution,
  }).body;
  const providerExtensionBody = buildProviderExtensionImageRequestBody({
    model,
    prompt,
    aspectRatio: imageSettings.defaultAspectRatio,
    resolution: imageSettings.defaultResolution,
  }).body;
  const templates: Array<{
    template: PreparedImageModelTestAttempt["template"];
    label: string;
    body: Record<string, unknown>;
  }> = [
    {
      template: "openai-size",
      label: "标准尺寸模板",
      body: openAIImageBody,
    },
    {
      template: "aspect-resolution",
      label: "供应商扩展模板",
      body: providerExtensionBody,
    },
  ];

  return templates.flatMap((template) => apiKeys.map((apiKey, index) => ({
    protocol: "openai-compatible" as const,
    label: `OpenAI 图片 · ${template.label} · Key ${index + 1}`,
    endpoint,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: template.body,
    keyIndex: index,
    template: template.template,
  })));
}

export function prepareModelTestRequest(payload: ModelTestRequest): PreparedModelTest {
  const keys = parseApiKeys(payload.provider.apiKey);
  const isLocalTtsProvider = payload.provider.platform === "manying-local-tts" || payload.provider.platform === "tts-compatible";
  if (keys.length === 0 && (!isLocalTtsProvider || payload.type === "text")) {
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

  if (payload.type === "image") {
    const attempts = buildImageModelTestAttempts(baseUrl, keys, model, payload.imageGenerationSettings);
    const attempt = attempts[0];
    return {
      success: true,
      dryRun: false,
      type: "image",
      attempts,
      protocol: attempt.protocol,
      label: attempt.label,
      endpoint: attempt.endpoint,
      headers: attempt.headers,
      body: attempt.body,
    };
  }

  if (payload.type !== "text") {
    return {
      success: true,
      dryRun: true,
      message: `配置 dry-run 通过，V1 暂不调用 ${payload.type} 模型`,
    };
  }

  const attempts = buildTextModelTestAttempts(baseUrl, keys[0], model, payload.thinkingEnabled);
  const firstAttempt = attempts[0];
  return {
    success: true,
    dryRun: false,
    type: "text",
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

function hasImageTestResult(text: string): boolean {
  try {
    const result = extractImageGenerationResult(JSON.parse(text));
    return Boolean(result.imageUrl || result.taskId);
  } catch {
    return false;
  }
}

interface ModelTestFetchMeta {
  templateName?: string;
}

type ModelTestFetch = (input: string, init: {
  method: "POST";
  headers: Record<string, string>;
  body: string;
  signal?: AbortSignal;
}, meta?: ModelTestFetchMeta) => Promise<Response>;

type ModelTestImageSdk = (options: SdkGenerateImageOptions) => Promise<SdkGenerateImageResult>;

function getBearerToken(headers: Record<string, string>): string | undefined {
  const authorization = headers.Authorization ?? headers.authorization;
  const match = /^Bearer\s+(.+)$/i.exec(authorization ?? "");
  return match?.[1]?.trim();
}

function getStringField(record: Record<string, unknown>, key: string, fallback: string) {
  const value = record[key];
  return typeof value === "string" && value.trim() ? value : fallback;
}

function getNumberField(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function getFetchUrl(input: RequestInfo | URL) {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function headersToRecord(headers: HeadersInit | undefined): Record<string, string> {
  if (!headers) return {};
  if (headers instanceof Headers) {
    const record: Record<string, string> = {};
    headers.forEach((value, key) => {
      record[key] = value;
    });
    return record;
  }
  if (Array.isArray(headers)) return Object.fromEntries(headers.map(([key, value]) => [key, value]));
  return { ...headers };
}

function bodyToString(body: BodyInit | null | undefined) {
  return typeof body === "string" ? body : "";
}

function createSdkTransportFetch(fetcher: ModelTestFetch, templateName?: string): typeof fetch {
  return ((input: RequestInfo | URL, init?: RequestInit) => fetcher(getFetchUrl(input), {
    method: "POST",
    headers: headersToRecord(init?.headers),
    body: bodyToString(init?.body),
    signal: init?.signal ?? undefined,
  }, { templateName })) as typeof fetch;
}

export async function runModelTestRequest(
  payload: ModelTestRequest,
  fetcher: ModelTestFetch = fetch,
  timeoutMs = getModelTestTimeoutMs(payload.type),
  imageSdkGenerator: ModelTestImageSdk = sdkGenerateImage,
): Promise<ModelTestResult> {
  const prepared = prepareModelTestRequest(payload);
  if (!prepared.success) {
    return { success: false, error: prepared.error };
  }

  if (prepared.dryRun) {
    return { success: true, message: prepared.message };
  }

  const attempts: ModelTestAttemptResult[] = [];
  const skippedImageKeyIndexes = new Set<number>();
  for (const attempt of prepared.attempts) {
    if (prepared.type === "image" && attempt.keyIndex !== undefined && skippedImageKeyIndexes.has(attempt.keyIndex)) {
      continue;
    }

    const startedAt = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      if (prepared.type === "image" && attempt.template === "openai-size" && isGptImageModel(payload.model)) {
        const apiKey = getBearerToken(attempt.headers) ?? "";
        const sdkResult = await imageSdkGenerator({
          provider: {
            id: payload.provider.id,
            platform: payload.provider.platform,
            name: payload.provider.name,
            baseUrl: payload.provider.baseUrl,
            apiKey,
          },
          model: payload.model,
          prompt: getStringField(attempt.body, "prompt", "API 连通性测试图"),
          aspectRatio: getStringField(attempt.body, "aspect_ratio", DEFAULT_IMAGE_ASPECT_RATIO),
          resolution: getStringField(attempt.body, "resolution", DEFAULT_IMAGE_RESOLUTION),
          width: getNumberField(attempt.body, "width"),
          height: getNumberField(attempt.body, "height"),
          operationId: payload.operationId,
          timeoutMs,
          maxRetries: 0,
          abortSignal: controller.signal,
          endpointFamily: "model-test",
          fetcher: createSdkTransportFetch(fetcher, attempt.template),
        });
        const elapsedMs = Date.now() - startedAt;
        if (sdkResult.success && sdkResult.imageUrl) {
          return {
            success: true,
            protocol: attempt.protocol,
            status: sdkResult.status ?? 200,
            elapsedMs,
            attempts: [
              ...attempts,
              {
                protocol: attempt.protocol,
                label: attempt.label,
                endpoint: attempt.endpoint,
                success: true,
                status: sdkResult.status ?? 200,
                elapsedMs,
              },
            ],
            message: `图片测试通过 · ${attempt.label} · ${payload.model} · ${elapsedMs}ms`,
          };
        }

        if (attempt.keyIndex !== undefined && (sdkResult.status === 401 || sdkResult.status === 403)) {
          skippedImageKeyIndexes.add(attempt.keyIndex);
        }
        attempts.push({
          protocol: attempt.protocol,
          label: attempt.label,
          endpoint: attempt.endpoint,
          success: false,
          status: sdkResult.status,
          elapsedMs,
          error: sdkResult.error || "图片模型测试未返回图片",
        });
        continue;
      }

      const response = await fetcher(attempt.endpoint, {
        method: "POST",
        headers: attempt.headers,
        body: JSON.stringify(attempt.body),
        signal: controller.signal,
      }, { templateName: attempt.template });
      const elapsedMs = Date.now() - startedAt;
      const text = await response.text();

      if (!response.ok) {
        if (prepared.type === "image" && attempt.keyIndex !== undefined && (response.status === 401 || response.status === 403)) {
          skippedImageKeyIndexes.add(attempt.keyIndex);
        }
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

      const imageAccepted = prepared.type === "image" ? hasImageTestResult(text) : false;
      if (prepared.type === "image" && !imageAccepted) {
        attempts.push({
          protocol: attempt.protocol,
          label: attempt.label,
          endpoint: attempt.endpoint,
          success: false,
          status: response.status,
          elapsedMs,
          error: `图片模型测试未返回图片 URL、base64 或任务 ID: ${text.slice(0, 240)}`,
        });
        continue;
      }

      const content = prepared.type === "text" ? parseModelTestSuccessText(attempt.protocol, text) : undefined;
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
        message: prepared.type === "image"
          ? `图片测试通过 · ${attempt.label} · ${payload.model} · ${elapsedMs}ms`
          : content
          ? `测试通过 · ${attempt.label} · ${content.slice(0, 120)} · ${elapsedMs}ms`
          : `测试通过 · ${attempt.label} · ${payload.model} · ${elapsedMs}ms`,
      };
    } catch (error) {
      const elapsedMs = Date.now() - startedAt;
      const isTimeout = error instanceof Error && error.name === "AbortError";
      attempts.push({
        protocol: attempt.protocol,
        label: attempt.label,
        endpoint: attempt.endpoint,
        success: false,
        elapsedMs,
        error: isTimeout
          ? `${payload.type === "image" ? "图片模型测试" : "模型测试"}超时 (${Math.round(timeoutMs / 1000)}s)`
          : error instanceof Error ? error.message : String(error),
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
