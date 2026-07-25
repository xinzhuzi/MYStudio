import { describe, expect, it } from "vitest";
import {
  getAllT2IModels,
  getAllT2VModels,
  getAspectRatiosForT2IModel,
  getAspectRatiosForT2VModel,
  getDurationsForModel,
  getProviderModelId,
  getResolutionsForModel,
  getT2IModelById,
  getT2VModelById,
  resolveT2IModel,
  resolveT2VModel,
} from "./model-registry";

describe("freedom model registry compatibility facade", () => {
  it("resolves canonical and provider-alias image models", () => {
    expect(getT2IModelById("nano-banana")).toEqual(expect.objectContaining({
      id: "nano-banana",
      name: "Nano Banana",
    }));
    expect(resolveT2IModel("gemini-2.5-flash-image")?.id).toBe("nano-banana");
    expect(getT2IModelById("gemini-2.5-flash-image")?.id).toBe("nano-banana");
    expect(getT2IModelById("missing-image-model")).toBeUndefined();
    expect(getAspectRatiosForT2IModel("nano-banana")).toEqual(expect.arrayContaining(["1:1", "16:9"]));
    expect(getAspectRatiosForT2IModel("flux-dev")).toEqual([]);
  });

  it("preserves video capabilities and alias lookup", () => {
    expect(getT2VModelById("seedance-lite-t2v")?.name).toBe("Seedance Lite T2V");
    expect(resolveT2VModel("doubao-seedance-lite")?.id).toBe("seedance-lite-t2v");
    expect(getAspectRatiosForT2VModel("seedance-lite-t2v")).toContain("16:9");
    expect(getDurationsForModel("seedance-lite-t2v")).toEqual([5]);
    expect(getResolutionsForModel("seedance-lite-t2v")).toEqual(["480p", "720p", "1080p"]);
    expect(getDurationsForModel("missing-video-model")).toEqual([]);
  });

  it("keeps registry ids unique and provider-id preference stable", () => {
    const imageModels = getAllT2IModels();
    const videoModels = getAllT2VModels();
    expect(new Set(imageModels.map((model) => model.id)).size).toBe(imageModels.length);
    expect(new Set(videoModels.map((model) => model.id)).size).toBe(videoModels.length);
    expect(getProviderModelId(imageModels.find((model) => model.id === "nano-banana")!)).toBe("nano-banana");
    expect(getProviderModelId({ id: "fallback", name: "Fallback", inputs: {} })).toBe("fallback");
  });
});
