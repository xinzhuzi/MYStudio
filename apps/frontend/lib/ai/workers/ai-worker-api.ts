import type { GenerationConfig } from '@/lib/ai/core';
import { assertImageTransferPayloadSize } from '@/lib/ai/image-transfer';

export interface WorkerApiContext {
  getApiBaseUrl: () => string;
  isCancelled: () => boolean;
  signal?: AbortSignal;
  requestTimeoutMs?: number;
}

export type WorkerApiTaskStatus = 'pending' | 'processing' | 'completed' | 'failed';

export type WorkerApiErrorCode =
  | 'cancelled'
  | 'aborted'
  | 'timeout'
  | 'http-error'
  | 'malformed-response'
  | 'invalid-response'
  | 'missing-result-url'
  | 'provider-error'
  | 'network-error';

export interface WorkerApiErrorEnvelope {
  code: WorkerApiErrorCode;
  message: string;
  retryable: boolean;
  status?: number;
  provider?: string;
}

export class WorkerApiError extends Error {
  readonly envelope: WorkerApiErrorEnvelope;

  constructor(envelope: WorkerApiErrorEnvelope) {
    super(envelope.message);
    this.name = 'WorkerApiError';
    this.envelope = envelope;
  }

  get code(): WorkerApiErrorCode {
    return this.envelope.code;
  }

  get retryable(): boolean {
    return this.envelope.retryable;
  }
}

interface WorkerApiResult {
  url?: string;
  imageUrl?: string;
  videoUrl?: string;
}

export interface DecodedWorkerApiPayload {
  status?: WorkerApiTaskStatus;
  progress?: number;
  taskId?: string;
  imageUrl?: string;
  videoUrl?: string;
  resultUrl?: string;
  result?: WorkerApiResult;
  errorMessage?: string;
}

type WorkerMediaGenerationConfig = Partial<GenerationConfig> & {
  apiKey?: string;
  imageApiKey?: string;
  videoApiKey?: string;
};

const TASK_STATUSES: readonly WorkerApiTaskStatus[] = ['pending', 'processing', 'completed', 'failed'];
const DEFAULT_REQUEST_TIMEOUT_MS = 180_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isTaskStatus(value: unknown): value is WorkerApiTaskStatus {
  if (typeof value !== 'string') return false;
  switch (value) {
    case 'pending':
    case 'processing':
    case 'completed':
    case 'failed':
      return true;
    default:
      return false;
  }
}

function readOptionalString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') {
    throw new WorkerApiError({
      code: 'malformed-response',
      message: `Invalid API response: ${key} must be a string`,
      retryable: false,
    });
  }
  return value.trim() ? value : undefined;
}

function readOptionalNumber(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new WorkerApiError({
      code: 'malformed-response',
      message: `Invalid API response: ${key} must be a finite number`,
      retryable: false,
    });
  }
  return value;
}

function readOptionalProgress(record: Record<string, unknown>): number | undefined {
  const progress = readOptionalNumber(record, 'progress');
  if (progress !== undefined && (progress < 0 || progress > 100)) {
    throw new WorkerApiError({
      code: 'malformed-response',
      message: 'Invalid API response: progress must be between 0 and 100',
      retryable: false,
    });
  }
  return progress;
}

function extractErrorMessage(value: unknown, depth = 0): string | undefined {
  if (depth > 4) return undefined;
  if (typeof value === 'string') return value.trim() || undefined;
  if (!isRecord(value)) return undefined;

  for (const key of ['message', 'error', 'detail', 'details']) {
    const message = extractErrorMessage(value[key], depth + 1);
    if (message) return message;
  }
  return undefined;
}

/**
 * Decode every JSON payload accepted by the worker media API boundary once.
 * Submit and task-status responses intentionally share this envelope because
 * providers may return either a direct URL or an asynchronous task id.
 */
export function decodeWorkerApiPayload(value: unknown): DecodedWorkerApiPayload {
  if (!isRecord(value)) {
    throw new WorkerApiError({
      code: 'malformed-response',
      message: 'Invalid API response: expected an object',
      retryable: false,
    });
  }

  const statusValue = value.status;
  if (statusValue !== undefined && statusValue !== null && !isTaskStatus(statusValue)) {
    throw new WorkerApiError({
      code: 'malformed-response',
      message: `Invalid API response: status must be one of ${TASK_STATUSES.join(', ')}`,
      retryable: false,
    });
  }

  const resultValue = value.result;
  let result: WorkerApiResult | undefined;
  if (resultValue !== undefined && resultValue !== null) {
    if (!isRecord(resultValue)) {
      throw new WorkerApiError({
        code: 'malformed-response',
        message: 'Invalid API response: result must be an object',
        retryable: false,
      });
    }
    result = {
      url: readOptionalString(resultValue, 'url'),
      imageUrl: readOptionalString(resultValue, 'imageUrl'),
      videoUrl: readOptionalString(resultValue, 'videoUrl'),
    };
  }

  return {
    status: isTaskStatus(statusValue) ? statusValue : undefined,
    progress: readOptionalProgress(value),
    taskId: readOptionalString(value, 'taskId'),
    imageUrl: readOptionalString(value, 'imageUrl'),
    videoUrl: readOptionalString(value, 'videoUrl'),
    resultUrl: readOptionalString(value, 'resultUrl'),
    result,
    errorMessage: extractErrorMessage(value.error) ?? extractErrorMessage(value.message),
  };
}

function createWorkerApiError(envelope: WorkerApiErrorEnvelope): WorkerApiError {
  return new WorkerApiError(envelope);
}

function getErrorMessage(error: unknown): string | undefined {
  if (error instanceof Error) return error.message || undefined;
  if (typeof error === 'string') return error.trim() || undefined;
  return extractErrorMessage(error);
}

function isAbortError(error: unknown): boolean {
  if (error instanceof Error) return error.name === 'AbortError';
  return isRecord(error) && error.name === 'AbortError';
}

function createCancelledError(): WorkerApiError {
  return createWorkerApiError({ code: 'cancelled', message: 'Cancelled', retryable: false });
}

function createAbortedError(): WorkerApiError {
  return createWorkerApiError({ code: 'aborted', message: 'The operation was aborted', retryable: false });
}

function normalizeTransportError(error: unknown, signal?: AbortSignal, provider?: string): WorkerApiError {
  if (signal?.aborted || isAbortError(error)) {
    return createWorkerApiError({
      code: 'aborted',
      message: createAbortedError().message,
      retryable: false,
      provider,
    });
  }
  if (error instanceof WorkerApiError) return error;
  return createWorkerApiError({
    code: 'network-error',
    message: getErrorMessage(error) || 'Network request failed',
    retryable: true,
    provider,
  });
}

function attachProvider(error: unknown, provider: string): WorkerApiError {
  if (error instanceof WorkerApiError) {
    if (error.envelope.provider) return error;
    return createWorkerApiError({ ...error.envelope, provider });
  }
  return normalizeTransportError(error, undefined, provider);
}

function formatTimeoutDuration(timeoutMs: number): string {
  return timeoutMs >= 1000 ? `${timeoutMs / 1000}s` : `${timeoutMs}ms`;
}

async function fetchWithDeadline(
  request: RequestInfo | URL,
  init: RequestInit,
  timeoutMs: number,
  provider?: string,
): Promise<Response> {
  const callerSignal = init.signal ?? undefined;
  if (callerSignal?.aborted) throw normalizeTransportError(createAbortedError(), callerSignal, provider);

  const controller = new AbortController();
  let timedOut = false;
  const onCallerAbort = () => controller.abort(callerSignal?.reason);
  callerSignal?.addEventListener('abort', onCallerAbort, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    return await fetch(request, { ...init, signal: controller.signal });
  } catch (error) {
    if (timedOut) {
      throw createWorkerApiError({
        code: 'timeout',
        message: `API request timed out after ${formatTimeoutDuration(timeoutMs)}`,
        retryable: true,
        provider,
      });
    }
    throw normalizeTransportError(error, callerSignal, provider);
  } finally {
    clearTimeout(timer);
    callerSignal?.removeEventListener('abort', onCallerAbort);
  }
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function httpErrorMessage(operation: 'image' | 'video' | 'poll' | 'download', status: number): string {
  switch (operation) {
    case 'image':
      return `Image API request failed: ${status}`;
    case 'video':
      return `Video API request failed: ${status}`;
    case 'poll':
      return `Task API request failed: ${status}`;
    case 'download':
      return `Failed to download: ${status}`;
  }
}

async function readJsonPayload(response: Response): Promise<unknown> {
  const body = await response.text();
  if (!body.trim()) return undefined;
  try {
    return JSON.parse(body);
  } catch {
    return undefined;
  }
}

async function fetchWorkerPayload(
  request: RequestInfo | URL,
  init: RequestInit,
  operation: 'image' | 'video' | 'poll',
  provider: string,
  timeoutMs: number,
): Promise<DecodedWorkerApiPayload> {
  let response: Response;
  try {
    response = await fetchWithDeadline(request, init, timeoutMs, provider);
  } catch (error) {
    throw normalizeTransportError(error, init.signal || undefined, provider);
  }

  let rawPayload: unknown;
  try {
    rawPayload = await readJsonPayload(response);
  } catch (error) {
    throw normalizeTransportError(error, init.signal || undefined, provider);
  }

  if (!response.ok) {
    throw createWorkerApiError({
      code: 'http-error',
      message: extractErrorMessage(rawPayload) || httpErrorMessage(operation, response.status),
      retryable: isRetryableStatus(response.status),
      status: response.status,
      provider,
    });
  }

  try {
    return decodeWorkerApiPayload(rawPayload);
  } catch (error) {
    throw attachProvider(error, provider);
  }
}

function getCompletedResultUrl(data: DecodedWorkerApiPayload, type: 'image' | 'video'): string | undefined {
  if (type === 'image') return data.imageUrl || data.result?.imageUrl || data.result?.url || data.resultUrl;
  return data.videoUrl || data.result?.videoUrl || data.result?.url || data.resultUrl;
}

function waitForRetry(milliseconds: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(createAbortedError());
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, milliseconds);
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      reject(createAbortedError());
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function workerOrigin(): string | undefined {
  if (typeof self === 'undefined') return undefined;
  const workerScope: unknown = self;
  if (!isRecord(workerScope) || !isRecord(workerScope.location)) return undefined;
  return typeof workerScope.location.origin === 'string' ? workerScope.location.origin : undefined;
}

export function buildApiUrl(path: string, apiBaseUrl = ''): string {
  if (apiBaseUrl) return `${apiBaseUrl}${path}`;
  const origin = workerOrigin();
  return origin ? `${origin}${path}` : path;
}

function assertImageReady(source: string): void {
  if (/^https?:\/\//i.test(source)) return;
  if (!source.startsWith('data:image/')) throw new Error('参考图必须在主线程完成缩略后再发送');
  assertImageTransferPayloadSize(source);
}

export function createWorkerApi(context: WorkerApiContext) {
  const url = (path: string) => buildApiUrl(path, context.getApiBaseUrl());
  const requestTimeoutMs = context.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;

  const ensureActive = (): void => {
    if (context.isCancelled()) throw createCancelledError();
    if (context.signal?.aborted) throw createAbortedError();
  };

  const pollTaskCompletion = async (
    taskId: string,
    type: 'image' | 'video',
    apiKey: string,
    provider: string,
    onProgress?: (progress: number) => void,
  ): Promise<string> => {
    const maxAttempts = type === 'video' ? 120 : 60;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      ensureActive();
      let data: DecodedWorkerApiPayload;
      try {
        data = await fetchWorkerPayload(
          url(`/api/ai/task/${taskId}?provider=${provider}&type=${type}`),
          { headers: { Authorization: `Bearer ${apiKey}` }, signal: context.signal },
          'poll',
          provider,
          requestTimeoutMs,
        );
      } catch (error) {
        const normalized = normalizeTransportError(error, context.signal, provider);
        if (normalized.envelope.retryable) {
          await waitForRetry(2000, context.signal);
          continue;
        }
        throw normalized;
      }

      if (data.progress !== undefined && onProgress) onProgress(data.progress);
      if (data.status === 'completed') {
        const result = getCompletedResultUrl(data, type);
        if (!result) {
          throw createWorkerApiError({
            code: 'missing-result-url',
            message: 'Task completed but no URL in result',
            retryable: false,
            provider,
          });
        }
        return result;
      }
      if (data.status === 'failed') {
        throw createWorkerApiError({
          code: 'provider-error',
          message: data.errorMessage || 'Task failed',
          retryable: false,
          provider,
        });
      }
      if (data.status === undefined) {
        throw createWorkerApiError({
          code: 'malformed-response',
          message: 'Invalid API response: task status is required',
          retryable: false,
          provider,
        });
      }
      await waitForRetry(2000, context.signal);
    }
    throw createWorkerApiError({
      code: 'timeout',
      message: `Task ${taskId} timed out after ${(maxAttempts * 2000) / 1000}s`,
      retryable: true,
      provider,
    });
  };

  const generateImage = async (
    prompt: string,
    negativePrompt: string,
    config: WorkerMediaGenerationConfig,
    onProgress?: (progress: number) => void,
    referenceImages?: string[],
  ): Promise<string> => {
    const apiKey = config.apiKey || config.imageApiKey || '';
    const provider = config.imageProvider || 'memefast';
    if (!apiKey) throw new Error('未配置图片生成 API Key');
    ensureActive();
    for (const source of referenceImages || []) assertImageReady(source);
    const data = await fetchWorkerPayload(
      url('/api/ai/image'),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt,
          negativePrompt,
          aspectRatio: config.aspectRatio || '9:16',
          apiKey,
          provider,
          referenceImages: referenceImages?.length ? referenceImages : undefined,
        }),
        signal: context.signal,
      },
      'image',
      provider,
      requestTimeoutMs,
    );
    const directImageUrl = getCompletedResultUrl(data, 'image');
    if (data.status === 'completed' || (data.status === undefined && directImageUrl)) {
      const result = directImageUrl;
      if (result) return result;
      throw createWorkerApiError({
        code: 'missing-result-url',
        message: 'Task completed but no URL in result',
        retryable: false,
        provider,
      });
    }
    if (data.taskId) return pollTaskCompletion(data.taskId, 'image', apiKey, provider, onProgress);
    throw createWorkerApiError({
      code: 'invalid-response',
      message: 'Invalid API response: no taskId or imageUrl',
      retryable: false,
      provider,
    });
  };

  const generateVideo = async (
    imageUrl: string,
    prompt: string,
    config: WorkerMediaGenerationConfig,
    onProgress?: (progress: number) => void,
    referenceImages?: string[],
  ): Promise<string> => {
    const apiKey = config.apiKey || config.videoApiKey || '';
    const provider = config.videoProvider || 'memefast';
    if (!apiKey) throw new Error('未配置视频生成 API Key');
    ensureActive();
    assertImageReady(imageUrl);
    for (const source of referenceImages || []) assertImageReady(source);
    const data = await fetchWorkerPayload(
      url('/api/ai/video'),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageUrl,
          prompt,
          aspectRatio: config.aspectRatio || '9:16',
          duration: config.duration || 5,
          apiKey,
          provider,
          referenceImages: referenceImages?.length ? referenceImages : undefined,
        }),
        signal: context.signal,
      },
      'video',
      provider,
      requestTimeoutMs,
    );
    const directVideoUrl = getCompletedResultUrl(data, 'video');
    if (data.status === 'completed' || (data.status === undefined && directVideoUrl)) {
      const result = directVideoUrl;
      if (result) return result;
      throw createWorkerApiError({
        code: 'missing-result-url',
        message: 'Task completed but no URL in result',
        retryable: false,
        provider,
      });
    }
    if (data.taskId) return pollTaskCompletion(data.taskId, 'video', apiKey, provider, onProgress);
    throw createWorkerApiError({
      code: 'invalid-response',
      message: 'Invalid API response: no taskId or videoUrl',
      retryable: false,
      provider,
    });
  };

  const fetchAsBlob = async (mediaUrl: string): Promise<Blob> => {
    ensureActive();
    let response: Response;
    try {
      response = await fetchWithDeadline(mediaUrl, { signal: context.signal }, requestTimeoutMs);
    } catch (error) {
      throw normalizeTransportError(error, context.signal);
    }
    if (!response.ok) {
      throw createWorkerApiError({
        code: 'http-error',
        message: httpErrorMessage('download', response.status),
        retryable: isRetryableStatus(response.status),
        status: response.status,
      });
    }
    try {
      return await response.blob();
    } catch (error) {
      throw normalizeTransportError(error, context.signal);
    }
  };

  return { generateImage, generateVideo, fetchAsBlob, pollTaskCompletion };
}
