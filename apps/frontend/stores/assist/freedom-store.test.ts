import { describe, expect, it } from "vitest";
import { resetTransientGenerating } from "./freedom-store";

describe("freedom-store rehydrate reset", () => {
  it("forces all transient generating flags to false (防止重启卡在生成中)", () => {
    const state = { imageGenerating: true, videoGenerating: true, cinemaGenerating: true };
    resetTransientGenerating(state);
    expect(state).toMatchObject({
      imageGenerating: false,
      videoGenerating: false,
      cinemaGenerating: false,
    });
  });

  it("preserves non-generating fields and is a no-op on undefined", () => {
    const state = { imagePrompt: "测试", imageGenerating: true };
    resetTransientGenerating(state);
    expect(state.imagePrompt).toBe("测试");
    expect(state.imageGenerating).toBe(false);
    expect(() => resetTransientGenerating(undefined)).not.toThrow();
  });
});
