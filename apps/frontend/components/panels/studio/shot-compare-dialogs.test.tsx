// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  ShotImageCompareDialog,
  ShotVideoCompareDialog,
  shotCompareAvailability,
} from "./shot-compare-dialogs";
import { StoryboardPanelTab } from "./StoryboardPanelTab";
import type { StoryboardItem } from "@/types/studio";
import type { VideoCandidate } from "@/types/studio-production-types";

vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { info: vi.fn(), success: vi.fn(), error: vi.fn(), warning: vi.fn() }) }));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  delete (window as { shotKeyframes?: unknown }).shotKeyframes;
});

function shot(overrides: Partial<StoryboardItem> = {}): StoryboardItem {
  return {
    id: "sb-1",
    index: 1,
    trackKey: "001-1",
    trackId: "001-1",
    episodeId: "chapter-001",
    duration: 6,
    prompt: "p",
    videoDesc: "v",
    associateAssetsNames: [],
    ...overrides,
  } as unknown as StoryboardItem;
}

function candidate(id: string, filePath: string, createdAt: number): VideoCandidate {
  return { id, trackId: "001-1", provider: "h3-comfyui", filePath, state: "ready", createdAt };
}

describe("shotCompareAvailability", () => {
  it("图对=帧≥2;视频对=当前成片+历史候选", () => {
    const twoFrames = shot({
      keyframes: [
        { frameId: "sb-1-kf-1", mediaRef: { kind: "image", path: "project-file://p/f1.jpg" }, inUs: 0 },
        { frameId: "sb-1-kf-2", mediaRef: { kind: "image", path: "project-file://p/f2.jpg" }, inUs: 3_000_000 },
      ],
    });
    expect(shotCompareAvailability(twoFrames, []).frames).toBe(true);
    expect(shotCompareAvailability(twoFrames, []).video).toBe(false);

    const videoShot = shot({ mediaRef: { kind: "video", path: "project-file://p/v2.mp4" } });
    const candidates = [candidate("h3-sb-1-2", "project-file://p/v2.mp4", 200), candidate("h3-sb-1-1", "project-file://p/v1.mp4", 100)];
    expect(shotCompareAvailability(videoShot, candidates).video).toBe(true);
    // 只有当前版一条候选史(无上一版)→ 不给入口
    expect(shotCompareAvailability(videoShot, [candidate("h3-sb-1-2", "project-file://p/v2.mp4", 200)]).video).toBe(false);
  });
});

describe("ShotImageCompareDialog", () => {
  it("渲染 ABCompare(第 1 帧 vs 第 2 帧);帧不足 2 不渲染", () => {
    const twoFrames = shot({
      keyframes: [
        { frameId: "sb-1-kf-1", mediaRef: { kind: "image", path: "project-file://p/f1.jpg" }, inUs: 0 },
        { frameId: "sb-1-kf-2", mediaRef: { kind: "image", path: "project-file://p/f2.jpg" }, inUs: 3_000_000 },
      ],
    });
    const { container } = render(<ShotImageCompareDialog storyboard={twoFrames} open onClose={() => undefined} />);
    expect(container.querySelector("[data-ab-compare]")).toBeTruthy();
    expect(container.querySelector('[data-ab-compare-label="a"]')?.textContent).toBe("第 1 帧");
    expect(container.querySelector('[data-ab-compare-label="b"]')?.textContent).toBe("第 2 帧");

    const empty = render(<ShotImageCompareDialog storyboard={shot()} open onClose={() => undefined} />);
    expect(empty.container.querySelector("[data-shot-compare-overlay]")).toBeNull();
  });
});

describe("ShotVideoCompareDialog", () => {
  const videoShot = shot({ mediaRef: { kind: "video", path: "project-file://p/v2.mp4" } });
  const candidates = [candidate("h3-sb-1-2", "project-file://p/v2.mp4", 200), candidate("h3-sb-1-1", "project-file://p/v1.mp4", 100)];

  it("上一版 vs 当前版;探测桥回帧数一致 → 帧对齐", async () => {
    (window as { shotKeyframes?: unknown }).shotKeyframes = {
      probeVideo: async () => ({
        schemaVersion: 1,
        success: true,
        durationS: 6,
        fps: 30,
        frameCount: 180,
        frameCountEstimated: false,
      }),
    };
    const { container } = render(
      <ShotVideoCompareDialog projectId="p" storyboard={videoShot} candidates={candidates} open onClose={() => undefined} />,
    );
    expect(container.querySelector("[data-ab-video-a]")?.getAttribute("src")).toBe("project-file://p/v1.mp4");
    expect(container.querySelector("[data-ab-video-b]")?.getAttribute("src")).toBe("project-file://p/v2.mp4");
    expect(container.querySelector('[data-ab-video-label="a"]')?.textContent).toBe("第 1 版");
    expect(container.querySelector('[data-ab-video-label="b"]')?.textContent).toBe("当前版");
    await waitFor(() => {
      expect(container.querySelector("[data-ab-video-stage]")?.getAttribute("data-ab-video-align-mode")).toBe("frame");
    });
  });

  it("探测桥缺席 → 按时间对齐(估),不弹错", () => {
    const { container } = render(
      <ShotVideoCompareDialog projectId={undefined} storyboard={videoShot} candidates={candidates} open onClose={() => undefined} />,
    );
    expect(container.querySelector("[data-ab-video-align-note]")?.textContent).toContain("按时间对齐（估）");
  });

  it("面板重渲染不重置对比器状态(probeVideo 身份须稳定)", () => {
    vi.spyOn(HTMLMediaElement.prototype, "play").mockReturnValue(Promise.resolve());
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
    const view = render(
      <ShotVideoCompareDialog projectId="p" storyboard={videoShot} candidates={candidates} open onClose={() => undefined} />,
    );
    fireEvent.click(screen.getByText("播放"));
    expect(screen.getByText("暂停")).toBeTruthy();
    // 模拟面板层重渲染(store 刷新):probeVideo 若身份漂移,ABVideoCompare 的
    // 换源 effect 会误触发——滑帘/进度/播放态归零、同步循环被杀
    view.rerender(
      <ShotVideoCompareDialog projectId="p" storyboard={videoShot} candidates={candidates} open onClose={() => undefined} />,
    );
    expect(screen.getByText("暂停")).toBeTruthy();
    view.unmount();
  });
});

describe("StoryboardPanelTab 版本对入口接线", () => {
  it("帧≥2 的镜卡显示「对比两帧」,点击弹 A/B 对比;无入口条件不显示", () => {
    const twoFrames = shot({
      keyframes: [
        { frameId: "sb-1-kf-1", mediaRef: { kind: "image", path: "project-file://p/f1.jpg" }, inUs: 0 },
        { frameId: "sb-1-kf-2", mediaRef: { kind: "image", path: "project-file://p/f2.jpg" }, inUs: 3_000_000 },
      ],
    });
    const singleFrame = shot({ id: "sb-2", index: 2, mediaRef: { kind: "image", path: "project-file://p/g1.jpg" } });
    const { container } = render(
      <StoryboardPanelTab storyboards={[twoFrames, singleFrame]} onOpenImageWorkflow={() => undefined} />,
    );
    expect(screen.getByText("对比两帧")).toBeTruthy();
    expect(screen.queryByText("对比上一版")).toBeNull();
    fireEvent.click(screen.getByText("对比两帧"));
    expect(container.querySelector("[data-ab-compare]")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("关闭对比"));
    expect(container.querySelector("[data-ab-compare]")).toBeNull();
  });
});
