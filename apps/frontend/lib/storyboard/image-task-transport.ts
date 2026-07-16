export function normalizeImageTaskUrl(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    const first = value[0];
    return typeof first === "string" && first.length > 0 ? first : undefined;
  }
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function buildTaskUrl(baseUrl: string, taskId: string): URL {
  const normalized = baseUrl.replace(/\/+$/, "");
  const prefix = /\/v\d+$/.test(normalized) ? normalized : `${normalized}/v1`;
  const url = new URL(`${prefix}/tasks/${taskId}`);
  url.searchParams.set("_ts", Date.now().toString());
  return url;
}

type ImageTaskResponse = {
  status?: unknown;
  output_url?: unknown;
  result_url?: unknown;
  url?: unknown;
  result?: { images?: Array<{ url?: unknown } | unknown>; url?: unknown };
  images?: Array<{ url?: unknown } | unknown>;
  data?: {
    status?: unknown;
    result?: { images?: Array<{ url?: unknown } | unknown> };
    url?: unknown;
    error?: unknown;
  };
  error?: unknown;
  message?: unknown;
};

export function waitForAbortableDelay(intervalMs: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(new DOMException("Aborted", "AbortError"));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, intervalMs);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    }, { once: true });
  });
}

export async function pollImageTaskUrl(options: {
  taskId: string;
  apiKey: string;
  baseUrl: string;
  maxAttempts?: number;
  pollIntervalMs?: number;
  signal?: AbortSignal;
  onProgress?: (progress: number) => void;
  notFoundMessage?: string;
  requestErrorMessage?: (status: number) => string;
  noCache?: boolean;
  failureFallbackMessage?: string;
}): Promise<string | undefined> {
  const maxAttempts = options.maxAttempts ?? 60;
  const pollIntervalMs = options.pollIntervalMs ?? 2000;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (options.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    options.onProgress?.(Math.min(Math.floor((attempt / maxAttempts) * 100), 99));
    const response = await fetch(buildTaskUrl(options.baseUrl, options.taskId), {
      headers: {
        Authorization: `Bearer ${options.apiKey}`,
        ...(options.noCache ? { "Cache-Control": "no-cache" } : {}),
      },
      signal: options.signal,
    });
    if (!response.ok) {
      if (response.status === 404 && options.notFoundMessage) {
        throw new Error(options.notFoundMessage);
      }
      throw new Error(
        options.requestErrorMessage?.(response.status) ?? `查询任务失败: ${response.status}`,
      );
    }

    const data = await response.json() as ImageTaskResponse;
    const status = (data.status ?? data.data?.status ?? "").toString().toLowerCase();
    if (status === "completed" || status === "succeeded" || status === "success") {
      const images = data.result?.images ?? data.data?.result?.images ?? data.images;
      const firstImage = images?.[0];
      const imageUrl = firstImage && typeof firstImage === "object" && "url" in firstImage
        ? normalizeImageTaskUrl(firstImage.url)
        : normalizeImageTaskUrl(firstImage);
      options.onProgress?.(100);
      return imageUrl
        || normalizeImageTaskUrl(data.output_url)
        || normalizeImageTaskUrl(data.result_url)
        || normalizeImageTaskUrl(data.url)
        || normalizeImageTaskUrl(data.data?.url)
        || normalizeImageTaskUrl(data.result?.url);
    }
    if (status === "failed" || status === "error") {
      const rawError = data.error ?? data.message ?? data.data?.error;
      throw new Error(
        typeof rawError === "string"
          ? rawError
          : rawError
            ? JSON.stringify(rawError)
            : options.failureFallbackMessage ?? "图片生成失败",
      );
    }
    await waitForAbortableDelay(pollIntervalMs, options.signal);
  }
  return undefined;
}
