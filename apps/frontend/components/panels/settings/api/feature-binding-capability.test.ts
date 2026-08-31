import { describe, expect, it } from "vitest";
import { classifyModelByName } from "@/lib/ai/core";
import { modelSupportsCapability } from "./FeatureBindingPanel";
import { FEATURE_CONFIGS, isProviderConfiguredForFeature } from "./feature-binding-domain";

describe("feature binding capability detection", () => {
  it("classifies Agnes image models as image generation models", () => {
    expect(classifyModelByName("agnes-image-2.1-flash")).toEqual(["image_generation"]);
  });

  it("classifies Grok Imagine image models as image generation models", () => {
    expect(classifyModelByName("grok-imagine-image")).toEqual(["image_generation"]);
  });

  it("classifies Z-Image models as image generation models", () => {
    expect(classifyModelByName("Z-Image")).toEqual(["image_generation"]);
    expect(classifyModelByName("z-image-turbo")).toEqual(["image_generation"]);
  });

  it("classifies the local Krea2 engine as an image generation model", () => {
    expect(classifyModelByName("krea2-turbo")).toEqual(["image_generation"]);
  });

  it("classifies the local ComfyUI bridge engine as an image generation model", () => {
    expect(classifyModelByName("comfyui-bridge")).toEqual(["image_generation"]);
  });

  it("classifies Qwen-Image and GLM-Image models as image generation models", () => {
    expect(classifyModelByName("qwen-image-max")).toEqual(["image_generation"]);
    expect(classifyModelByName("glm-image")).toEqual(["image_generation"]);
  });

  it("allows text-output models that support image input for image understanding", () => {
    expect(modelSupportsCapability("gpt-4o-mini", { platform: "openai-compatible" }, "vision")).toBe(true);
    expect(modelSupportsCapability("gemini-2.5-flash", { platform: "gemini-compatible" }, "vision")).toBe(true);
    expect(modelSupportsCapability("glm-5.1", { platform: "anthropic-compatible" }, "vision")).toBe(true);
  });

  it("does not expose pure text or local TTS models as image understanding models", () => {
    expect(modelSupportsCapability("deepseek-chat", { platform: "deepseek" }, "vision")).toBe(false);
    expect(modelSupportsCapability("qwen-tts-0.6B", { platform: "tts-compatible" }, "vision")).toBe(false);
  });

  it("keeps local TTS configured without an API key only for the TTS feature", () => {
    const ttsFeature = FEATURE_CONFIGS.find((feature) => feature.key === "tts");
    const textFeature = FEATURE_CONFIGS.find((feature) => feature.key === "script_analysis");
    expect(ttsFeature).toBeDefined();
    expect(textFeature).toBeDefined();

    const localProvider = {
      platform: "tts-compatible",
      apiKey: "",
      baseUrl: "http://127.0.0.1:17593/",
    };
    expect(isProviderConfiguredForFeature(localProvider, ttsFeature!)).toBe(true);
    expect(isProviderConfiguredForFeature(localProvider, textFeature!)).toBe(false);
  });

  it("keeps unknown providers selectable when no capability metadata exists", () => {
    expect(modelSupportsCapability("private-model", { platform: "private-provider" }, "text")).toBe(true);
  });
});
