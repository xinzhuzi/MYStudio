const RETRY_MAX_ATTEMPTS = 3;
const RETRY_BASE_DELAY = 3000;

type RetryError = { name?: string; status?: number; code?: number; message?: string };

export type FreedomKeyManager = {
  handleError: (status: number, errorText?: string) => boolean;
};

function retryError(error: unknown): RetryError {
  return typeof error === "object" && error !== null ? error as RetryError : {};
}

export function isRetryableFreedomError(error: unknown): boolean {
  if (!error) return false;
  const current = retryError(error);
  if (current.name === "AbortError") return false;
  if ([429, 500, 502, 503, 529].includes(current.status ?? -1)) return true;
  if ([429, 500, 502, 503, 529].includes(current.code ?? -1)) return true;
  const message = (current.message || "").toLowerCase();
  return [
    "429", "500", "502", "503", "529", "rate", "quota",
    "insufficient_user_quota", "额度不足", "余额不足", "未配置订阅",
    "invalid token", "unauthorized", "api key", "too many requests",
    "service unavailable", "temporarily unavailable", "internal server error",
    "overloaded", "上游负载", "上游服务", "饱和", "负载已满", "暂时不可用",
    "服务暂时不可用", "无可用渠道", "no available channel", "server error",
  ].some((token) => message.includes(token));
}

export async function freedomRetry<T>(
  operation: () => Promise<T>,
  label: string,
  keyManager?: FreedomKeyManager | null,
): Promise<T> {
  let lastError: Error | undefined;
  for (let attempt = 0; attempt < RETRY_MAX_ATTEMPTS; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (!isRetryableFreedomError(error)) throw error;
      const current = retryError(error);
      const message = (current.message || "").toLowerCase();
      if (["unknown provider", "not supported", "does not exist", "model not found"]
        .some((token) => message.includes(token))) {
        throw error;
      }
      if (keyManager && typeof current.status === "number") {
        const rotated = keyManager.handleError(current.status, current.message);
        if (rotated) console.log(`[Freedom] ${label}: key rotated due to ${current.status}`);
      }
      if (attempt < RETRY_MAX_ATTEMPTS - 1) {
        const delay = RETRY_BASE_DELAY * Math.pow(2, attempt);
        console.warn(
          `[Freedom] ${label} hit retryable error, retrying in ${delay}ms... ` +
          `(Attempt ${attempt + 1}/${RETRY_MAX_ATTEMPTS}): ${lastError.message}`,
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }
  throw lastError;
}
