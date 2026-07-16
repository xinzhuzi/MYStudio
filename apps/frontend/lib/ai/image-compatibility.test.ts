import { describe, expect, it } from "vitest";
import {
  buildCompatibilityImagePrompt,
  IMAGE_COMPATIBILITY_PROMPT_LIMIT,
  shouldRetryImageCompatibility,
} from "./image-compatibility";

describe("image compatibility helpers", () => {
  it("retries only established transport statuses and messages", () => {
    expect(shouldRetryImageCompatibility({ status: 408 })).toBe(true);
    expect(shouldRetryImageCompatibility({ status: 500 })).toBe(false);
    expect(shouldRetryImageCompatibility({ error: "Network timed out" })).toBe(true);
    expect(shouldRetryImageCompatibility({ error: "provider rejected prompt" })).toBe(false);
  });

  it("preserves normalized prompts at the compatibility boundary", () => {
    const prompt = `${"x".repeat(IMAGE_COMPATIBILITY_PROMPT_LIMIT - 4)}  a\n b`;
    const compatibilityPrompt = buildCompatibilityImagePrompt(prompt);

    expect(compatibilityPrompt).toContain(`${"x".repeat(IMAGE_COMPATIBILITY_PROMPT_LIMIT - 4)} a b`);
    expect(compatibilityPrompt).not.toContain("主体完整，构图简洁，细节清晰，避免文字和水印。");
    expect(compatibilityPrompt).toContain("clean image");
  });

  it("compacts long prompts before applying the established clean-image suffix", () => {
    const prompt = `${"x".repeat(IMAGE_COMPATIBILITY_PROMPT_LIMIT - 2)} + ${"overflow".repeat(8)}`;
    const compatibilityPrompt = buildCompatibilityImagePrompt(prompt);

    expect(compatibilityPrompt).toContain("主体完整，构图简洁，细节清晰，避免文字和水印。");
    expect(compatibilityPrompt).not.toContain("overflowoverflow");
    expect(compatibilityPrompt).toContain("clean image");
    expect(compatibilityPrompt).toContain("controlled ink wash");
  });
});
