import { normalizeImagePromptForGeneration } from "./ai-sdk-bridge";

export const IMAGE_COMPATIBILITY_PROMPT_LIMIT = 180;

export type ImageCompatibilityFailure = {
  error?: string;
  status?: number;
};

export function shouldRetryImageCompatibility(result: ImageCompatibilityFailure) {
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
    message.includes("aborted")
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
