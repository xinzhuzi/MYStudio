import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiKeyManager } from "@/lib/ai/core";
import type { FeatureConfig } from "@/lib/ai/feature-router";
import type { Character } from "@/stores/library/character-library-store";
import { generateVariationImage } from "./wardrobe-image-generation";

const mocks = vi.hoisted(() => ({
  imageGrid: vi.fn(),
  readImageAsBase64: vi.fn(),
  getStyleById: vi.fn(),
}));

vi.mock("@/stores/app/app-settings-store", () => ({
  useAppSettingsStore: {
    getState: () => ({ imageGenerationSettings: { defaultResolution: "1K" } }),
  },
}));

vi.mock("@/lib/ai/ai-manager", () => ({
  aiManager: {
    imageGrid: mocks.imageGrid,
  },
}));

vi.mock("@/lib/media/image-storage", () => ({
  readImageAsBase64: mocks.readImageAsBase64,
}));

vi.mock("@/lib/constants/visual-styles", () => ({
  getStyleById: mocks.getStyleById,
}));

afterEach(() => {
  vi.clearAllMocks();
});

describe("generateVariationImage", () => {
  it("preserves the built-in wardrobe request and reference-image contract", async () => {
    const character: Character = {
      id: "character-1",
      name: "云昭",
      description: "wanderer",
      visualTraits: "silver hair",
      thumbnailUrl: "https://example.com/base.png",
      views: [],
      variations: [],
      createdAt: 1,
      updatedAt: 1,
    };
    const variation = {
      id: "variation-1",
      name: "战斗装",
      visualPrompt: "battle outfit",
    };
    mocks.imageGrid.mockResolvedValue({
      imageUrl: "https://example.com/generated.png",
    });
    const featureConfig: FeatureConfig = {
      feature: "character_generation",
      featureName: "角色生成",
      provider: {
        id: "provider-1",
        platform: "custom",
        name: "Relay",
        baseUrl: "https://api.example.com/v1/",
        apiKey: "secret",
        model: ["image-model"],
      } as FeatureConfig["provider"],
      apiKey: "secret",
      allApiKeys: ["secret"],
      keyManager: new ApiKeyManager("secret"),
      platform: "custom",
      baseUrl: "https://api.example.com/v1/",
      models: ["image-model"],
      model: "image-model",
    };

    await expect(
      generateVariationImage({
        character,
        variation,
        featureConfig,
      }),
    ).resolves.toBe("https://example.com/generated.png");

    expect(mocks.imageGrid).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "image-model",
        apiKey: "secret",
        baseUrl: "https://api.example.com/v1",
        aspectRatio: "1:1",
        resolution: "1K",
        referenceImages: ["https://example.com/base.png"],
      }),
    );
  });
});
