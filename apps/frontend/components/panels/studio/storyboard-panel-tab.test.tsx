// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StoryboardPanelTab } from "./StoryboardPanelTab";
import type { StoryboardItem } from "@/types/studio";

afterEach(cleanup);

function shot(partial: Partial<StoryboardItem>): StoryboardItem {
  return {
    id: partial.id ?? "sb-1",
    episodeId: "chapter-001",
    index: partial.index ?? 1,
    trackKey: "001-1",
    trackId: "",
    duration: 6,
    prompt: partial.prompt ?? "矿奴队列压过石板。",
    videoDesc: partial.videoDesc,
    assetIds: [],
    shouldGenerateImage: true,
    state: "idle",
    ...partial,
  } as StoryboardItem;
}

describe("StoryboardPanelTab(全量分镜面板)", () => {
  it("renders every shot with counts and enters a shot workflow on card click", () => {
    const onOpenImageWorkflow = vi.fn();
    render(
      <StoryboardPanelTab
        storyboards={[
          shot({ id: "sb-2", index: 2, prompt: "赵四俯身指向老苦力。", lines: "赵四：快些！" }),
          shot({ id: "sb-1", index: 1, prompt: "船桩压住前景，铁链横穿石板。", lines: "旁白：铁链压境。" }),
        ]}
        onOpenImageWorkflow={onOpenImageWorkflow}
      />,
    );

    expect(screen.getByText("2 个分镜 · 0 个画面")).toBeTruthy();
    expect(screen.getByText("S01")).toBeTruthy();
    expect(screen.getByText("S02")).toBeTruthy();
    expect(screen.getAllByText("未生成").length).toBe(2);

    fireEvent.click(document.querySelector('[data-storyboard-panel-shot="sb-2"]')!);
    expect(onOpenImageWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({
        target: { kind: "storyboard", id: "sb-2" },
        sourceStage: "storyboardPanel",
        sourceStageLabel: "分镜面板",
      }),
    );
  });

  it("keeps the first-ungenerated entry button wired to that shot", () => {
    const onOpenImageWorkflow = vi.fn();
    render(
      <StoryboardPanelTab
        storyboards={[
          shot({ id: "sb-1", index: 1, mediaRef: { kind: "image", path: "project-file://a.png" } as StoryboardItem["mediaRef"] }),
          shot({ id: "sb-2", index: 2 }),
        ]}
        onOpenImageWorkflow={onOpenImageWorkflow}
      />,
    );
    expect(screen.getByText("2 个分镜 · 1 个画面")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /分镜生图/ }));
    expect(onOpenImageWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({ target: { kind: "storyboard", id: "sb-2" } }),
    );
  });

  it("exposes a back-to-canvas action when wired", () => {
    const onBackToCanvas = vi.fn();
    render(
      <StoryboardPanelTab
        storyboards={[shot({ id: "sb-1" })]}
        onOpenImageWorkflow={vi.fn()}
        onBackToCanvas={onBackToCanvas}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /返回节点图/ }));
    expect(onBackToCanvas).toHaveBeenCalledOnce();
  });

  it("renders the empty state without shot cards", () => {
    render(<StoryboardPanelTab storyboards={[]} onOpenImageWorkflow={vi.fn()} />);
    expect(screen.getByText("尚无分镜,请先生成分镜表")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /分镜生图/ })).toBeNull();
  });
});
