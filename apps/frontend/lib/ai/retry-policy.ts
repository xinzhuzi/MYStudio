/** Shared retry policy for idempotent polling/download requests. */
export const RETRYABLE_HTTP_STATUSES = new Set([408, 425, 429]);

export function isRetryableHttpStatus(status: number): boolean {
  return RETRYABLE_HTTP_STATUSES.has(status) || status >= 500;
}

export function retryDelayMs(attempt: number, baseDelayMs = 2000, maxDelayMs = 8000): number {
  const safeAttempt = Math.max(0, Math.floor(attempt));
  return Math.min(baseDelayMs * 2 ** safeAttempt, maxDelayMs);
}

export function waitForRetry(delayMs: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(signal.reason instanceof Error ? signal.reason : new Error("用户已取消"));
  }
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(signal?.reason instanceof Error ? signal.reason : new Error("用户已取消"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
