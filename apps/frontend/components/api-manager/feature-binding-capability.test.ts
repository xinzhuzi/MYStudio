import { describe, expect, it } from "vitest";
import { modelSupportsCapability } from "./FeatureBindingPanel";

describe("feature binding capability detection", () => {
  it("allows text-output models that support image input for image understanding", () => {
    expect(modelSupportsCapability("gpt-4o-mini", { platform: "openai-compatible" }, "vision")).toBe(true);
    expect(modelSupportsCapability("gemini-2.5-flash", { platform: "gemini-compatible" }, "vision")).toBe(true);
    expect(modelSupportsCapability("glm-5.1", { platform: "anthropic-compatible" }, "vision")).toBe(true);
  });

  it("does not expose pure text or local TTS models as image understanding models", () => {
    expect(modelSupportsCapability("deepseek-chat", { platform: "deepseek" }, "vision")).toBe(false);
    expect(modelSupportsCapability("qwen-tts-0.6B", { platform: "tts-compatible" }, "vision")).toBe(false);
  });
});
