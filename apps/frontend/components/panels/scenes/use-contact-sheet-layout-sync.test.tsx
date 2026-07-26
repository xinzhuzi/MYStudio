// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useContactSheetLayoutSync } from "./use-contact-sheet-layout-sync";

const viewpoint = {
  id: "overview",
  name: "全景",
  nameEn: "Overview",
  shotIds: [],
  shotIndexes: [],
  keyProps: ["木桌"],
  keyPropsEn: ["wooden table"],
  gridIndex: 0,
  pageIndex: 0,
};

const prompt = {
  pageIndex: 0,
  prompt: "Scene Context: old town\nVisual Description: warm dawn",
  promptZh: "展示不同视角。\n建筑风格：明式，色彩基调：暖色\n场景氛围：晨雾",
  viewpointIds: ["overview"],
  gridLayout: { rows: 3, cols: 3 },
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useContactSheetLayoutSync", () => {
  it("updates layout setters only when the aspect-ratio trigger changes", () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const setLayout = vi.fn();
    const setPrompts = vi.fn();
    const setPrompt = vi.fn();
    const setPromptZh = vi.fn();

    const { rerender } = renderHook(
      ({ aspectRatio, styleId }: {
        aspectRatio: "16:9" | "9:16";
        styleId: string;
      }) =>
        useContactSheetLayoutSync({
          aspectRatio,
          viewpoints: [viewpoint],
          prompts: [prompt],
          currentPageIndex: 0,
          currentPrompt: "existing prompt",
          selectedScene: null,
          styleId,
          setLayout,
          setPrompts,
          setPrompt,
          setPromptZh,
        }),
      {
        initialProps: {
          aspectRatio: "16:9" as "16:9" | "9:16",
          styleId: "default",
        },
      },
    );

    expect(setLayout).toHaveBeenCalledTimes(1);
    expect(setLayout).toHaveBeenLastCalledWith("2x2");
    expect(setPrompts).toHaveBeenCalledTimes(1);
    expect(setPrompts).toHaveBeenLastCalledWith([
      expect.objectContaining({ gridLayout: { rows: 2, cols: 2 } }),
    ]);
    expect(setPrompt).toHaveBeenCalledTimes(1);
    expect(setPromptZh).toHaveBeenCalledTimes(1);
    expect(setPromptZh).toHaveBeenLastCalledWith(
      expect.stringContaining("2行2列"),
    );

    rerender({ aspectRatio: "16:9", styleId: "ink-wash" });
    expect(setLayout).toHaveBeenCalledTimes(1);

    rerender({ aspectRatio: "9:16", styleId: "ink-wash" });
    expect(setLayout).toHaveBeenCalledTimes(2);
    expect(setPrompts).toHaveBeenLastCalledWith([
      expect.objectContaining({ gridLayout: { rows: 2, cols: 2 } }),
    ]);
    expect(setPrompt).toHaveBeenLastCalledWith(
      expect.stringContaining("9:16 (vertical portrait)"),
    );
    expect(setPromptZh).toHaveBeenLastCalledWith(
      expect.stringContaining("2行2列"),
    );
  });
});
