import type { DiagnosticsLogEntryInput } from "@/types/diagnostics";
import type { ImageRequestPayload, ImageRequestResult } from "@/types/api-image-request";
import { createOperationId, logEvent as defaultLogEvent } from "./logger";
import { summarizeResponseBody } from "./sanitize";

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
type LogEventLike = (entry: DiagnosticsLogEntryInput) => void | Promise<void>;

export interface ObservedFetchMeta {
  operationId?: string;
  requestId?: string;
  endpointFamily: string;
  providerId?: string;
  providerName?: string;
  model?: string;
  timeoutMs?: number;
  attempt?: number;
  maxRetries?: number;
  retryBackoffMs?: number;
  templateName?: string;
  keyRotated?: boolean;
  taskId?: string;
  pollAttempt?: number;
  pollStatus?: string;
  fetcher?: FetchLike;
  logEvent?: LogEventLike;
}

function getInputUrl(input: RequestInfo | URL) {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function hashText(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function summarizePrompt(value: string) {
  return {
    promptLength: value.length,
    promptHash: hashText(value),
    promptPreview: value.slice(0, 120),
    truncated: value.length > 120,
  };
}

function summarizeStringParts(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(summarizeStringParts).filter(Boolean).join("\n");
  if (!value || typeof value !== "object") return "";
  const record = value as Record<string, unknown>;
  return [
    summarizeStringParts(record.text),
    summarizeStringParts(record.content),
    summarizeStringParts(record.prompt),
  ].filter(Boolean).join("\n");
}

function summarizeRequestBody(body: BodyInit | null | undefined) {
  if (typeof body !== "string" || !body.trim().startsWith("{")) return {};
  try {
    const parsed = JSON.parse(body) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};

    const summary: Record<string, unknown> = {
      bodyKeys: Object.keys(parsed).sort(),
    };
    if (typeof parsed.model === "string") summary.requestModel = parsed.model;
    if (typeof parsed.stream === "boolean") summary.stream = parsed.stream;
    if (typeof parsed.n === "number") summary.n = parsed.n;
    if (typeof parsed.size === "string") summary.size = parsed.size;
    if (typeof parsed.aspect_ratio === "string") summary.aspectRatio = parsed.aspect_ratio;
    if (typeof parsed.resolution === "string") summary.resolution = parsed.resolution;
    if (typeof parsed.response_format === "string") summary.responseFormat = parsed.response_format;

    if (typeof parsed.prompt === "string") {
      summary.prompt = summarizePrompt(parsed.prompt);
    } else if (Array.isArray(parsed.messages)) {
      const messageText = summarizeStringParts(parsed.messages);
      summary.messageCount = parsed.messages.length;
      if (messageText) summary.prompt = summarizePrompt(messageText);
    }

    if (Array.isArray(parsed.image_urls)) summary.referenceImageCount = parsed.image_urls.length;
    if (Array.isArray(parsed.referenceImages)) summary.referenceImageCount = parsed.referenceImages.length;
    if (Array.isArray(parsed.input_image)) summary.referenceImageCount = parsed.input_image.length;

    return summary;
  } catch {
    return { bodyParseable: false };
  }
}

function getNetworkContext(input: RequestInfo | URL, init: RequestInit | undefined, meta: ObservedFetchMeta) {
  const rawUrl = getInputUrl(input);
  let baseUrlHost = "unknown";
  let pathTemplate = rawUrl;
  try {
    const parsed = new URL(rawUrl);
    baseUrlHost = parsed.host;
    pathTemplate = parsed.pathname;
  } catch {
    // keep raw fallback
  }
  return {
    endpointFamily: meta.endpointFamily,
    providerId: meta.providerId,
    providerName: meta.providerName,
    model: meta.model,
    method: init?.method ?? (typeof input !== "string" && !(input instanceof URL) ? input.method : "GET"),
    baseUrlHost,
    pathTemplate,
    timeoutMs: meta.timeoutMs,
    attempt: meta.attempt,
    maxRetries: meta.maxRetries,
    retryBackoffMs: meta.retryBackoffMs,
    templateName: meta.templateName,
    keyRotated: meta.keyRotated,
    taskId: meta.taskId,
    pollAttempt: meta.pollAttempt,
    pollStatus: meta.pollStatus,
    ...summarizeRequestBody(init?.body),
  };
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function isImageEndpoint(meta: ObservedFetchMeta, input: RequestInfo | URL) {
  const family = meta.endpointFamily.toLowerCase();
  if (family.includes("image")) return true;
  const rawUrl = getInputUrl(input).toLowerCase();
  return rawUrl.includes("/images/") || rawUrl.includes("/image/") || rawUrl.includes("/v1/images/generations");
}

function getElectronImageRequest() {
  if (typeof window === "undefined") return undefined;
  return window.electronAPI?.imageRequest;
}

function headersToRecord(headers?: HeadersInit): Record<string, string> | undefined {
  if (!headers) return undefined;
  if (headers instanceof Headers) {
    const record: Record<string, string> = {};
    headers.forEach((value, key) => {
      record[key] = value;
    });
    return record;
  }
  if (Array.isArray(headers)) {
    return Object.fromEntries(headers.map(([key, value]) => [key, value]));
  }
  return { ...headers };
}

async function bodyToString(body: BodyInit | null | undefined): Promise<string | undefined> {
  if (body == null) return undefined;
  if (typeof body === "string") return body;
  if (body instanceof URLSearchParams) return body.toString();
  if (body instanceof Blob) return body.text();
  if (body instanceof ArrayBuffer) return new TextDecoder().decode(body);
  if (ArrayBuffer.isView(body)) {
    return new TextDecoder().decode(body);
  }
  return undefined;
}

function resultToResponse(result: ImageRequestResult) {
  return new Response(result.body, {
    status: result.status,
    statusText: result.statusText,
    headers: result.headers,
  });
}

function createElectronImageProxyFetch(
  meta: ObservedFetchMeta & { operationId: string; requestId: string },
): FetchLike | undefined {
  const imageRequest = getElectronImageRequest();
  if (!imageRequest) return undefined;

  return async (input, init) => {
    const body = await bodyToString(init?.body);
    if (init?.body && body === undefined) {
      return fetch(input, init);
    }

    const payload: ImageRequestPayload = {
      url: getInputUrl(input),
      method: init?.method ?? (typeof input !== "string" && !(input instanceof URL) ? input.method : "GET"),
      headers: headersToRecord(init?.headers),
      body,
      operationId: meta.operationId,
      requestId: meta.requestId,
      endpointFamily: meta.endpointFamily,
      providerId: meta.providerId,
      providerName: meta.providerName,
      model: meta.model,
      timeoutMs: meta.timeoutMs,
      attempt: meta.attempt,
      maxRetries: meta.maxRetries,
      retryBackoffMs: meta.retryBackoffMs,
      templateName: meta.templateName,
      taskId: meta.taskId,
      pollAttempt: meta.pollAttempt,
      pollStatus: meta.pollStatus,
    };
    return resultToResponse(await imageRequest(payload));
  };
}

export async function observedFetch(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  meta: ObservedFetchMeta,
) {
  const startedAt = performance.now();
  const requestId = meta.requestId ?? createOperationId("req");
  const operationId = meta.operationId ?? createOperationId("op");
  const fetcher = meta.fetcher
    ?? (isImageEndpoint(meta, input) ? createElectronImageProxyFetch({ ...meta, operationId, requestId }) : undefined)
    ?? fetch;
  const emit = meta.logEvent ?? defaultLogEvent;
  const baseContext = getNetworkContext(input, init, meta);

  await emit({
    level: "debug",
    category: "network",
    operationId,
    requestId,
    message: "HTTP request started",
    context: baseContext,
  });

  try {
    const response = await fetcher(input, init);
    const durationMs = Math.round(performance.now() - startedAt);
    const context = {
      ...baseContext,
      status: response.status,
      statusText: response.statusText,
      durationMs,
    };

    if (!response.ok) {
      const responseSummary = await response.clone().text()
        .then((text) => summarizeResponseBody(text, 1024))
        .catch(() => "");
      await emit({
        level: "error",
        category: "network",
        operationId,
        requestId,
        message: "HTTP request failed",
        durationMs,
        context: {
          ...context,
          responseSummary,
        },
      });
      return response;
    }

    await emit({
      level: "info",
      category: "network",
      operationId,
      requestId,
      message: "HTTP request completed",
      durationMs,
      context,
    });
    return response;
  } catch (error) {
    const durationMs = Math.round(performance.now() - startedAt);
    await emit({
      level: "error",
      category: "network",
      operationId,
      requestId,
      message: "HTTP request errored",
      durationMs,
      context: {
        ...baseContext,
        durationMs,
        errorName: error instanceof Error ? error.name : undefined,
        errorMessage: getErrorMessage(error),
      },
      error,
    });
    throw error;
  }
}
