// @vitest-environment jsdom
// ChapterVideoComposition 章级配方段排布(10-10 批D)——Sequence 前后段接线:
// 开篇 [0,104)、正片 [104,104+N)、章尾 [104+N,104+N+60);缺省无段=单层直渲染。
import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";

const sequences: Array<{ from?: number; durationInFrames?: number }> = [];

vi.mock("remotion", async (importOriginal) => ({
  ...(await importOriginal<typeof import("remotion")>()),
  Sequence: ({ from, durationInFrames, children }: {
    from?: number; durationInFrames?: number; children?: unknown;
  }) => {
    sequences.push({ from, durationInFrames });
    return <div data-sequence={sequences.length}>{children as never}</div>;
  },
}));

vi.mock("./RemotionComposition", () => ({
  RemotionComposition: () => <div data-testid="main-content" />,
}));

vi.mock("./recipes/chapter-vsc-recipes", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./recipes/chapter-vsc-recipes")>()),
  ChapterOpeningRecipe: () => <div data-testid="opening" />,
  ChapterOutroRecipe: () => <div data-testid="outro" />,
}));

const { ChapterVideoComposition } = await import("./TargetCompositions");
const { chapterRecipeDurationFrames } = await import("./recipes/chapter-vsc-recipes");
import type { ChapterVideoCompositionProps } from "./composition-props";

// 烧金样常量(与 recipes 组件常量独立声明,漂移即红——枚举同步锁同款纪律)。
const BRAND_INK_OPEN_DURATION_GOLD = 104;
const GRAIN_DISSOLVE_DURATION_GOLD = 60;

const baseProps = {
  target: "chapter",
  width: 1920,
  height: 1080,
  fps: 30,
  durationInFrames: 240,
  projectId: "p",
  chapterId: "c",
  editingProjectId: "e",
  editingRevision: 1,
  visualClips: [],
  transitions: [],
  audioClips: [],
  subtitles: [],
} as unknown as ChapterVideoCompositionProps;

describe("ChapterVideoComposition 章级配方段排布(批D)", () => {
  it("缺省(默认关):仅正片一层,无前后段", () => {
    sequences.length = 0;
    const { container } = render(<ChapterVideoComposition {...baseProps} />);
    expect(sequences).toEqual([{ from: 0, durationInFrames: 240 }]);
    expect(container.querySelectorAll("[data-sequence]")).toHaveLength(1);
  });

  it("开篇+章尾:开篇 [0,104)、正片 [104,344)、章尾 [344,404)", () => {
    sequences.length = 0;
    const { container } = render(<ChapterVideoComposition
      {...baseProps}
      chapterOpening={{ recipeId: "vsc:brand-ink-open", wordmark: "道劫" }}
      chapterOutro={{ recipeId: "vsc:grain-dissolve", tagline: "{ 道劫 · 本章完 }", shortMark: "道劫" }}
    />);
    expect(sequences.map((entry) => [entry.from, entry.durationInFrames])).toEqual([
      [0, BRAND_INK_OPEN_DURATION_GOLD],
      [BRAND_INK_OPEN_DURATION_GOLD, 240],
      [BRAND_INK_OPEN_DURATION_GOLD + 240, GRAIN_DISSOLVE_DURATION_GOLD],
    ]);
    expect(container.querySelector('[data-testid="opening"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="outro"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="main-content"]')).not.toBeNull();
  });

  it("仅开篇:正片后移 104,无章尾层", () => {
    sequences.length = 0;
    const { container } = render(<ChapterVideoComposition
      {...baseProps}
      chapterOpening={{ recipeId: "vsc:brand-ink-open", wordmark: "道劫" }}
    />);
    expect(sequences.map((entry) => [entry.from, entry.durationInFrames])).toEqual([
      [0, BRAND_INK_OPEN_DURATION_GOLD],
      [BRAND_INK_OPEN_DURATION_GOLD, 240],
    ]);
    expect(container.querySelector('[data-testid="outro"]')).toBeNull();
  });

  it("段帧数与注册表单一真源一致(104/60)", () => {
    expect(chapterRecipeDurationFrames("vsc:brand-ink-open")).toBe(BRAND_INK_OPEN_DURATION_GOLD);
    expect(chapterRecipeDurationFrames("vsc:grain-dissolve")).toBe(GRAIN_DISSOLVE_DURATION_GOLD);
    expect(() => chapterRecipeDurationFrames("vsc:bogus")).toThrow("fail-closed");
  });
});
