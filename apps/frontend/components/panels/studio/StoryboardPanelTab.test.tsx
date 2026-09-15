// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { StoryboardPanelTab } from "./StoryboardPanelTab";
import type { StoryboardItem } from "@/types/studio";
import { __resetImageResolutionCacheForTests } from "@/components/ui/image-resolution-badge";
import { useProjectStore } from "@/stores/project/project-store";

vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { info: vi.fn(), success: vi.fn(), error: vi.fn(), warning: vi.fn() }) }));

function shot(index: number, path: string | undefined): StoryboardItem {
  return {
    id: `sb-${index}`,
    index,
    trackKey: `001-${index}`,
    episodeId: "chapter-001",
    duration: 4,
    prompt: `镜 ${index} 正文`,
    videoDesc: `镜 ${index} 画面`,
    associateAssetsNames: [],
    mediaRef: path ? ({ kind: "image", path } as StoryboardItem["mediaRef"]) : undefined,
  } as unknown as StoryboardItem;
}

/** 角标按真实像素探测:stub Image 返回每 URL 的 natural 尺寸 */
function installFakeImage(dimTable: Record<string, [number, number]>) {
  vi.stubGlobal(
    "Image",
    class {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      naturalWidth = 0;
      naturalHeight = 0;
      private src_ = "";
      constructor() {
        Object.defineProperty(this, "src", {
          get: () => this.src_,
          set: (value: string) => {
            this.src_ = value;
            const dims = dimTable[value];
            queueMicrotask(() => {
              if (dims) {
                this.naturalWidth = dims[0];
                this.naturalHeight = dims[1];
                this.onload?.();
              } else {
                this.onerror?.();
              }
            });
          },
        });
      }
    },
  );
}

describe("StoryboardPanelTab 分辨率角标", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    __resetImageResolutionCacheForTests();
  });

  it("按真实像素显示角标:超分产物与普通图均显示 W×H,不再显示「已生成」", async () => {
    installFakeImage({
      "project-file://p/workflow-images/chapter-001/f/up4x-gen-1.png": [4096, 4096],
      "project-file://p/workflow-images/chapter-001/f/gen-2.png": [1280, 720],
    });
    render(
      <StoryboardPanelTab
        storyboards={[
          shot(1, "project-file://p/workflow-images/chapter-001/f/up4x-gen-1.png"),
          shot(2, "project-file://p/workflow-images/chapter-001/f/gen-2.png"),
        ]}
        onOpenImageWorkflow={() => undefined}
      />,
    );
    await vi.waitFor(() => {
      expect(screen.getByText("4096×4096")).toBeTruthy();
    });
    expect(screen.getByText("1280×720")).toBeTruthy();
    expect(screen.queryByText("已生成")).toBeNull();
    expect(screen.queryAllByText("4096×4096")).toHaveLength(1);
  });

  it("未生成的镜不显示像素角标,有效图片仍显示真实尺寸", async () => {
    installFakeImage({ "project-file://p/gen-3.png": [1024, 1024] });
    render(
      <StoryboardPanelTab
        storyboards={[shot(3, "project-file://p/gen-3.png"), shot(4, undefined)]}
        onOpenImageWorkflow={() => undefined}
      />,
    );
    await vi.waitFor(() => {
      expect(screen.getByText("1024×1024")).toBeTruthy();
    });
    expect(screen.queryByText("4096×4096")).toBeNull();
    // S## 序号标仍在
    expect(screen.getByText("S03")).toBeTruthy();
  });
});

describe("StoryboardPanelTab 截帧回灌接线(09-15 P1a)", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    __resetImageResolutionCacheForTests();
    delete (window as { shotKeyframes?: unknown }).shotKeyframes;
  });

  function videoShot(): StoryboardItem {
    return {
      ...shot(1, undefined),
      mediaRef: { kind: "video", path: "project-file://p1/remotion/outputs/shots/chapter-001/sb-1/h3/ambient_v1_1.mp4" },
    } as unknown as StoryboardItem;
  }

  it("项目内视频:▶ 打开查看器带抽帧动作;「存为关键帧」走桥并带当前时刻", async () => {
    useProjectStore.setState({ activeProjectId: "p1" });
    const extract = vi.fn(async (_payload: { projectId: string; videoUrl: string; mode: { kind: string; timestampS?: number } }) => ({
      schemaVersion: 1 as const,
      success: true,
      durationS: 6,
      frames: [{ url: "project-file://p1/media/storyboard-keyframes/chapter-001/sb-1/sb-1-01-2500ms.jpg", timestampS: 2.5 }],
    }));
    (window as { shotKeyframes?: unknown }).shotKeyframes = { extract };

    const { container } = render(
      <StoryboardPanelTab storyboards={[videoShot()]} onOpenImageWorkflow={() => undefined} />,
    );
    fireEvent.click(screen.getByLabelText("播放 S01 单镜视频"));
    // 操作条在场且可点(项目内视频=不禁用)
    const saveButton = screen.getByText("存为关键帧") as HTMLButtonElement;
    expect(saveButton.disabled).toBe(false);
    const video = container.querySelector("[data-video-preview-player]") as HTMLVideoElement;
    video.currentTime = 2.5;
    fireEvent.click(saveButton);
    await vi.waitFor(() => {
      expect(extract).toHaveBeenCalledTimes(1);
    });
    const payload = extract.mock.calls[0]?.[0] as { projectId: string; videoUrl: string; mode: { kind: string; timestampS?: number } };
    expect(payload.projectId).toBe("p1");
    expect(payload.videoUrl).toBe("project-file://p1/remotion/outputs/shots/chapter-001/sb-1/h3/ambient_v1_1.mp4");
    expect(payload.mode.kind).toBe("single");
    expect(payload.mode.timestampS).toBe(2.5);
  });

  it("项目外视频(非 project-file):动作禁用+tooltip,不报错弹窗", () => {
    useProjectStore.setState({ activeProjectId: "p1" });
    const { container } = render(
      <StoryboardPanelTab
        storyboards={[{ ...shot(1, undefined), mediaRef: { kind: "video", path: "/abs/outside.mp4" } } as unknown as StoryboardItem]}
        onOpenImageWorkflow={() => undefined}
      />,
    );
    fireEvent.click(screen.getByLabelText("播放 S01 单镜视频"));
    const saveButton = screen.getByText("存为关键帧") as HTMLButtonElement;
    expect(saveButton.disabled).toBe(true);
    expect(saveButton.title).toContain("不在项目内");
    expect(container.querySelector("[data-video-keyframe-actions]")).toBeTruthy();
  });
});
