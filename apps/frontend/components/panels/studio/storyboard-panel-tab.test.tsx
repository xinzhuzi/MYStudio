// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StoryboardPanelTab } from "./StoryboardPanelTab";
import type { StoryboardItem } from "@/types/studio";
import { useStudioStore } from "@/stores/studio/studio-store";

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

  it("shows the three audio mix choices only for video shots and saves changes", () => {
    const updateStoryboard = vi.fn();
    const updateSpy = vi.spyOn(useStudioStore.getState(), "updateStoryboard").mockImplementation(updateStoryboard);
    render(
      <StoryboardPanelTab
        storyboards={[
          shot({ id: "image-shot", index: 1, mediaRef: { kind: "image", path: "project-file://image" } }),
          shot({ id: "video-shot", index: 2, mediaRef: { kind: "video", path: "project-file://video" }, audioMix: "mixed" }),
        ]}
        onOpenImageWorkflow={vi.fn()}
      />,
    );

    expect(screen.queryAllByTestId("storyboard-audio-mix")).toHaveLength(1);
    const select = screen.getByRole("combobox", { name: "S02 混音" });
    expect((select as HTMLSelectElement).value).toBe("mixed");
    expect(screen.getByRole("option", { name: "用片内声" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "配音主导" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "双层混音" })).toBeTruthy();

    fireEvent.change(select, { target: { value: "h3-baked" } });
    expect(updateStoryboard).toHaveBeenCalledWith("video-shot", { audioMix: "h3-baked" });
    updateSpy.mockRestore();
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

describe("StoryboardPanelTab·分镜素材自动绑定(10-11 批4)", () => {
  it("自动绑定素材按钮:注入 assetBinding 才渲染,点击调 start", () => {
    const start = vi.fn();
    render(
      <StoryboardPanelTab
        storyboards={[shot({ id: "sb-1" })]}
        onOpenImageWorkflow={vi.fn()}
        assetBinding={{ running: false, start, retryShot: vi.fn(), clear: vi.fn() }}
      />,
    );
    const button = screen.getByRole("button", { name: /自动绑定素材/ });
    expect(button).toBeTruthy();
    fireEvent.click(button);
    expect(start).toHaveBeenCalledTimes(1);
  });

  it("未注入 assetBinding 时不渲染绑定按钮(默认行为零变化)", () => {
    render(
      <StoryboardPanelTab storyboards={[shot({ id: "sb-1" })]} onOpenImageWorkflow={vi.fn()} />,
    );
    expect(screen.queryByRole("button", { name: /自动绑定素材/ })).toBeNull();
  });

  it("绑定运行中:进度行可见+按钮禁用", () => {
    render(
      <StoryboardPanelTab
        storyboards={[shot({ id: "sb-1" })]}
        onOpenImageWorkflow={vi.fn()}
        assetBinding={{
          running: true,
          run: {
            chapterId: "chapter-001",
            status: "running",
            progress: { done: 1, total: 3, currentShot: "S02" },
          },
          start: vi.fn(),
          retryShot: vi.fn(),
          clear: vi.fn(),
        }}
      />,
    );
    expect(screen.getByText(/素材绑定中 1\/3 · S02/)).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: /素材绑定中/ }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("跑完报表+例外清单:就绪计数/例外行可点重试/关闭清报表", () => {
    const retryShot = vi.fn();
    const clear = vi.fn();
    render(
      <StoryboardPanelTab
        storyboards={[shot({ id: "sb-1" }), shot({ id: "sb-2", index: 2 })]}
        onOpenImageWorkflow={vi.fn()}
        assetBinding={{
          running: false,
          run: {
            chapterId: "chapter-001",
            status: "done",
            progress: { done: 2, total: 2, currentShot: "" },
            report: {
              chapterId: "chapter-001",
              finishedAt: Date.now(),
              total: 2,
              boundCount: 1,
              readyBefore: 0,
              readyAfter: 1,
              fillTriggered: true,
              exceptions: [
                {
                  storyboardId: "sb-2",
                  shotIndex: 2,
                  status: "ambiguous",
                  statusLabel: "匹配多义",
                  detail: "S02 命中多个场景资产，请人工拣选",
                  candidates: ["夜市街口", "夜市街口西"],
                },
              ],
            },
          },
          start: vi.fn(),
          retryShot,
          clear,
        }}
      />,
    );
    expect(screen.getByText(/绑 1\/2 · 分镜就绪 1（已触发补图）/)).toBeTruthy();
    expect(screen.getByText(/例外 1：S02 匹配多义/)).toBeTruthy();
    expect(screen.getByText(/候选：夜市街口、夜市街口西/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /重试/ }));
    expect(retryShot).toHaveBeenCalledWith("sb-2");
    fireEvent.click(screen.getByRole("button", { name: "关闭素材绑定报表" }));
    expect(clear).toHaveBeenCalledTimes(1);
  });
});
