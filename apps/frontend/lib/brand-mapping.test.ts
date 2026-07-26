import { describe, expect, it } from "vitest";
import * as canonical from "./ai/core/providers/brand-mapping";
import * as facade from "./brand-mapping";

const { BRAND_REGISTRY, extractBrandFromModel, getBrandInfo } = canonical;

describe("brand mapping helpers", () => {
  it("keeps the root facade bound to the canonical provider module", () => {
    expect(facade.BRAND_REGISTRY).toBe(canonical.BRAND_REGISTRY);
    expect(facade.extractBrandFromModel).toBe(canonical.extractBrandFromModel);
    expect(facade.getBrandInfo).toBe(canonical.getBrandInfo);
  });

  it.each([
    ["gpt-4o-mini", "openai"],
    ["gpt_image_1", "openai"],
    ["claude-3-5-sonnet", "anthropic"],
    ["google/gemini-2.5-pro", "google"],
    ["Pro/BAAI/bge-m3", "siliconcloud"],
    ["fal-ai/flux-pro", "fal"],
  ])("maps known model prefix %s", (modelName, expectedBrand) => {
    expect(extractBrandFromModel(modelName)).toBe(expectedBrand);
  });

  it("keeps Doubao seed model aliases under the same brand", () => {
    expect(extractBrandFromModel("seed-oss-36b")).toBe("doubao");
    expect(extractBrandFromModel("seedream-3.0")).toBe("doubao");
    expect(extractBrandFromModel("bytedance-seedream-v4")).toBe("doubao");
    expect(extractBrandFromModel("doubao-seedance-1-0-pro")).toBe("doubao");
  });

  it("falls back to the shared other brand for unknown models and brand IDs", () => {
    expect(extractBrandFromModel("unknown-lab-model")).toBe("other");
    expect(getBrandInfo("unregistered-brand")).toBe(BRAND_REGISTRY.other);
  });
});
