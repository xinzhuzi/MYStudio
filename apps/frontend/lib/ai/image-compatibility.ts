import { normalizeImagePromptForGeneration } from "./ai-sdk-bridge";

export const IMAGE_COMPATIBILITY_PROMPT_LIMIT = 180;

export type ImageCompatibilityFailure = {
  error?: string;
  status?: number;
  /** 传输层网络失败标记(fetch-error.ts);有标记时不再依赖文案判定 */
  networkFailure?: boolean;
  timeoutFailure?: boolean;
};

export function shouldRetryImageCompatibility(result: ImageCompatibilityFailure) {
  // 结构化标记优先:传输层失败(DNS/拒连/超时等)与文案措辞解耦,改措辞不再弄坏判定
  if (result.networkFailure) return true;
  if (typeof result.status === "number") {
    return [408, 502, 503, 504, 520, 522, 524].includes(result.status);
  }

  const message = (result.error || "").toLowerCase();
  return (
    message.includes("fetch failed") ||
    message.includes("failed to fetch") ||
    message.includes("socket") ||
    message.includes("timeout") ||
    message.includes("timed out") ||
    message.includes("api 请求超时") ||
    message.includes("network") ||
    message.includes("aborted") ||
    // fetch-error.ts 翻译后的稳定前缀:网络层失败/各类超时,保持判定语义不变
    message.includes("网络请求失败") ||
    message.includes("请求超时")
  );
}

export function buildCompatibilityImagePrompt(prompt: string) {
  const normalized = prompt.replace(/\s+/g, " ").trim();
  if (normalized.length <= IMAGE_COMPATIBILITY_PROMPT_LIMIT) {
    return normalizeImagePromptForGeneration({ prompt: normalized }).prompt;
  }

  const compact = normalized
    .replace(/\s*\+\s*/g, "，")
    .slice(0, IMAGE_COMPATIBILITY_PROMPT_LIMIT)
    .replace(/[，,;；:：、\s]+$/, "");
  return normalizeImagePromptForGeneration({
    prompt: `${compact}。主体完整，构图简洁，细节清晰，避免文字和水印。`,
  }).prompt;
}
