import { shouldRetryImageCompatibility } from "@/lib/ai/image-compatibility";

export function markAmbiguousPaidImageError(error: unknown): Error & { ambiguousPaidRequest: true } {
  const marked = error instanceof Error ? error : new Error(String(error));
  Object.assign(marked, { ambiguousPaidRequest: true as const });
  return marked as Error & { ambiguousPaidRequest: true };
}

export function isAmbiguousPaidImageError(error: unknown): boolean {
  return Boolean((error as { ambiguousPaidRequest?: unknown } | undefined)?.ambiguousPaidRequest);
}

export function isAmbiguousPaidImageResult(result: { error?: string; status?: number }): boolean {
  return (typeof result.status === "number" && result.status >= 500)
    || shouldRetryImageCompatibility(result);
}

export function isAmbiguousPaidImageException(error: unknown): boolean {
  const status = (error as { status?: unknown } | undefined)?.status;
  if (typeof status === "number") return status >= 500;
  // A post-request error without an HTTP status (decode, missing task/image,
  // socket, timeout, or poll failure) cannot prove that the provider did not
  // accept the paid request, so it is conservatively treated as ambiguous.
  return true;
}
