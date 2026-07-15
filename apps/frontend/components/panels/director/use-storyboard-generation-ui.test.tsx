// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useStoryboardGenerationUi } from "./use-storyboard-generation-ui";

describe("useStoryboardGenerationUi", () => {
  it("preserves workflow-specific image generation defaults", () => {
    const director = renderHook(() => useStoryboardGenerationUi({ defaultImageGenMode: "merged" }));
    const sclass = renderHook(() => useStoryboardGenerationUi({ defaultImageGenMode: "single" }));
    expect(director.result.current.imageGenMode).toBe("merged");
    expect(sclass.result.current.imageGenMode).toBe("single");
  });

  it("opens angle and grid operations with isolated frame targets", () => {
    const { result } = renderHook(() => useStoryboardGenerationUi({ defaultImageGenMode: "merged" }));
    act(() => result.current.openAngleSwitch({ sceneId: 3, type: "end" }));
    expect(result.current.angleSwitchOpen).toBe(true);
    expect(result.current.angleSwitchTarget).toEqual({ sceneId: 3, type: "end" });
    act(() => result.current.openQuadGrid({ sceneId: 7, type: "start" }));
    expect(result.current.quadGridOpen).toBe(true);
    expect(result.current.quadGridTarget).toEqual({ sceneId: 7, type: "start" });
  });
});
