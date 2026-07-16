interface SClassVideoKeyManager {
  getCurrentKey: () => string | null;
  handleError: (status: number, errorText?: string) => boolean;
  getTotalKeyCount: () => number;
}

interface RunSClassVideoWithKeyRotationOptions {
  keyManager: SClassVideoKeyManager;
  invoke: (apiKey: string) => Promise<string>;
  label: string;
  context: Record<string, unknown>;
}

const ROTATED_STATUS_CODES = new Set([400, 401, 403, 429, 500, 502, 503, 529]);
const RETRYABLE_MESSAGE = /429|500|502|503|529|too many requests|rate|quota|service unavailable|overloaded|internal server error|server error|上游负载|上游服务|饱和|暂时不可用|服务暂时不可用|api key|无效|过期|model|模型|不支持|权限|未开通/;

function errorStatus(error: Error & { status?: number }): number | undefined {
  if (typeof error.status === "number") return error.status;
  const statusMatch = error.message.match(/\b(4\d\d|5\d\d)\b/);
  if (statusMatch) return Number(statusMatch[1]);
  return /model|模型/i.test(error.message)
    && /not support|unsupported|无权限|权限不足|未开通|不可用/i.test(error.message)
    ? 400
    : undefined;
}

export async function runSClassVideoWithKeyRotation({
  keyManager,
  invoke,
  label,
  context,
}: RunSClassVideoWithKeyRotationOptions): Promise<string> {
  const maxAttempts = Math.max(1, Math.min(keyManager.getTotalKeyCount(), 6));
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const apiKey = keyManager.getCurrentKey() || "";
    if (!apiKey) break;
    try {
      return await invoke(apiKey);
    } catch (error) {
      const currentError = error as Error & { status?: number };
      lastError = currentError;
      const message = currentError.message || "";
      const status = errorStatus(currentError);
      const alreadyRotatedByInner = typeof currentError.status === "number"
        && ROTATED_STATUS_CODES.has(currentError.status);
      const rotated = alreadyRotatedByInner
        || (typeof status === "number" && keyManager.handleError(status, message));
      const retryableByMessage = RETRYABLE_MESSAGE.test(message.toLowerCase());
      const canRetry = attempt < maxAttempts - 1 && (rotated || retryableByMessage);
      if (!canRetry) throw currentError;

      console.warn(`[SClassGen] ${label} retry with next key (${attempt + 1}/${maxAttempts})`, {
        ...context,
        status,
        message: message.substring(0, 160),
      });
    }
  }

  throw lastError || new Error("视频生成失败：没有可用 API Key");
}
