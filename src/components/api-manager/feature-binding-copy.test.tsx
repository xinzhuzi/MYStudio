import { describe, expect, it } from "vitest";
import { FEATURE_CONFIGS } from "./FeatureBindingPanel";

describe("API feature binding copy", () => {
  it("uses neutral configuration guidance instead of promotional recommendations", () => {
    const text = FEATURE_CONFIGS
      .flatMap((feature) => [feature.name, feature.description, feature.recommendation ?? ""])
      .join("\n");

    expect(text).not.toMatch(/推荐|广告|推广|赞助|Nano Banana|MemeFast|💎|🧪|🎨|🎬/i);
  });
});
