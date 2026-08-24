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

  it("starts serial batch generation from the one-click button (原单镜跳转语义已移除)", () => {
    const onOpenImageWorkflow = vi.fn();
    const onStart = vi.fn();
    render(
      <StoryboardPanelTab
        storyboards={[
          shot({ id: "sb-1", index: 1, mediaRef: { kind: "image", path: "project-file://a.png" } as StoryboardItem["mediaRef"] }),
          shot({ id: "sb-2", index: 2 }),
          shot({ id: "sb-3", index: 3 }),
        ]}
        onOpenImageWorkflow={onOpenImageWorkflow}
        batch={{ state: { running: false, total: 2, done: 0, failed: 0, currentShotIndex: null }, start: onStart, stop: vi.fn() }}
      />,
    );
    expect(screen.getByText("3 个分镜 · 1 个画面")).toBeTruthy();
    const button = screen.getByRole("button", { name: /一键生图/ });
    expect(button.getAttribute("title")).toContain("2");
    fireEvent.click(button);
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(onOpenImageWorkflow).not.toHaveBeenCalled();
  });

  it("shows live progress with stop while the serial batch is running", () => {
    const onStop = vi.fn();
    render(
      <StoryboardPanelTab
        storyboards={[shot({ id: "sb-1", index: 1 }), shot({ id: "sb-2", index: 2 })]}
        onOpenImageWorkflow={vi.fn()}
        batch={{ state: { running: true, total: 2, done: 1, failed: 0, currentShotIndex: 2 }, start: vi.fn(), stop: onStop }}
      />,
    );
    expect(screen.getByText(/一键生图 1\/2 · S02/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /停止/ }));
    expect(onStop).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: /一键生图/ })).toBeNull();
  });

  it("hides the batch button when every shot already has an image", () => {
    render(
      <StoryboardPanelTab
        storyboards={[shot({ id: "sb-1", index: 1, mediaRef: { kind: "image", path: "project-file://a.png" } as StoryboardItem["mediaRef"] })]}
        onOpenImageWorkflow={vi.fn()}
        batch={{ state: { running: false, total: 0, done: 0, failed: 0, currentShotIndex: null }, start: vi.fn(), stop: vi.fn() }}
      />,
    );
    expect(screen.queryByRole("button", { name: /一键生图/ })).toBeNull();
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
