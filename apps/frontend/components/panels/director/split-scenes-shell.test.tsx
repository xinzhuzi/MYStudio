// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { StoryboardTrailerScenesPanelProps } from "../storyboard-trailer-scenes-panel";
import { SplitScenesEmptyState } from "./split-scenes-empty-state";
import { SplitScenesTrailerTab } from "./split-scenes-trailer-tab";

vi.mock("../storyboard-trailer-scenes-panel", () => ({
  StoryboardTrailerScenesPanel: ({
    headerActions,
    isGenerating,
  }: StoryboardTrailerScenesPanelProps & { headerActions?: ReactNode }) => (
    <div>
      <div data-testid="trailer-generating">{String(isGenerating)}</div>
      {headerActions}
    </div>
  ),
}));

function createTrailerProps(
  overrides: Partial<StoryboardTrailerScenesPanelProps> = {},
): StoryboardTrailerScenesPanelProps {
  return {
    trailerScenes: [],
    isGenerating: false,
    renderSceneCard: vi.fn(),
    onDeleteScene: vi.fn(),
    onClearTrailer: vi.fn(),
    onGenerateVideo: vi.fn(),
    styleId: "ink",
    onStyleChange: vi.fn(),
    aspectRatio: "16:9",
    onAspectRatioChange: vi.fn(),
    imageResolution: "1K",
    onImageResolutionChange: vi.fn(),
    videoResolution: "480p",
    onVideoResolutionChange: vi.fn(),
    styleTokens: [],
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("SplitScenes shell components", () => {
  it("renders the empty split-scenes state", () => {
    render(<SplitScenesEmptyState />);

    expect(screen.getByText("暂无切割的分镜")).toBeTruthy();
  });

  it("passes trailer generation state and delegates auto prompt generation", () => {
    const onAutoGeneratePrompts = vi.fn();
    render(
      <SplitScenesTrailerTab
        {...createTrailerProps({ isGenerating: false })}
        isGeneratingPrompts={false}
        onAutoGeneratePrompts={onAutoGeneratePrompts}
      />,
    );

    expect(screen.getByTestId("trailer-generating").textContent).toBe("false");
    fireEvent.click(screen.getByRole("button", { name: "AI 自动填写提示词" }));

    expect(onAutoGeneratePrompts).toHaveBeenCalledTimes(1);
  });

  it("disables auto prompt generation while prompts are running", () => {
    render(
      <SplitScenesTrailerTab
        {...createTrailerProps({ isGenerating: false })}
        isGeneratingPrompts={true}
        onAutoGeneratePrompts={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "AI 自动填写提示词" })).toHaveProperty("disabled", true);
  });

  it("disables auto prompt generation while trailer generation is active", () => {
    render(
      <SplitScenesTrailerTab
        {...createTrailerProps({ isGenerating: true })}
        isGeneratingPrompts={false}
        onAutoGeneratePrompts={vi.fn()}
      />,
    );

    expect(screen.getByTestId("trailer-generating").textContent).toBe("true");
    expect(screen.getByRole("button", { name: "AI 自动填写提示词" })).toHaveProperty("disabled", true);
  });
});
