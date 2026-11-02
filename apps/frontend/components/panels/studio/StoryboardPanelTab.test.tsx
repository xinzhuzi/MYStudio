// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { StoryboardPanelTab } from "./StoryboardPanelTab";
import { toast } from "sonner"; // vi.mock 工厂替换后,此处 toast 即 mock 实体(断言用)
import type { StoryboardItem } from "@/types/studio";
import { __resetImageResolutionCacheForTests } from "@/components/ui/image-resolution-badge";
import { useProjectStore } from "@/stores/project/project-store";

vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { info: vi.fn(), success: vi.fn(), error: vi.fn(), warning: vi.fn() }) }));

// 孤儿导入器 mock(10-27 件三):默认实现恒返回空结果——既有确认条测试零孤儿路径照常
const h3ScanMock = vi.hoisted(() =>
  vi.fn(
    async (
      _input: { projectId: string; storyboards: Array<{ id: string }> },
    ): Promise<import("@/lib/assist/image-studio/h3-orphan-importer").H3OrphanScanResult> => ({
      reports: [],
      unmatched: [],
      skippedFilenames: 0,
    }),
  ),
);
const h3ImportMock = vi.hoisted(() =>
  vi.fn(
    async (
      _input: { projectId: string; storyboards: Array<{ id: string }>; files: unknown[] },
    ): Promise<{ imported: number; skipped: number }> => ({ imported: 0, skipped: 0 }),
  ),
);
vi.mock("@/lib/assist/image-studio/h3-orphan-importer", () => ({
  scanH3OrphanVideos: h3ScanMock,
  importH3OrphanVideos: h3ImportMock,
}));

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

  it("双通道入口(10-27):预看成片与 H3 出片并排;H3 确认条含镜数/档位/防合盖警示;确认后 start(tier)", () => {
    useProjectStore.setState({ activeProjectId: "p1" });
    const start = vi.fn();
    render(
      <StoryboardPanelTab
        storyboards={[shot(1, "/p/1.png"), shot(2, undefined), shot(3, "/p/3.png")]}
        onOpenImageWorkflow={() => undefined}
        chapterAutoVideo={{ status: {}, running: false, run: vi.fn() }}
        h3Batch={{ state: { running: false, total: 0, done: 0, failed: 0, currentShotIndex: null }, start, stop: vi.fn(), resumable: null }}
      />,
    );
    // 通道A 文案归位(Q5)
    expect(screen.getByText("预看成片")).toBeTruthy();
    // 通道B:两步确认——首点展开确认条
    fireEvent.click(screen.getByText("H3 出片"));
    const confirmBar = document.querySelector("[data-storyboard-panel-h3-confirm]");
    expect(confirmBar).toBeTruthy();
    // N1/N2 摘要:2 镜可出片 + 1 镜缺首帧跳过 + 防合盖警示
    expect(confirmBar!.textContent).toContain("2 镜可出片");
    expect(confirmBar!.textContent).toContain("1 镜缺首帧跳过");
    expect(confirmBar!.textContent).toContain("勿合盖");
    // 档位切换(D5 默认 960P;切 480P 后 start 吃到 tier)
    fireEvent.click(document.querySelector("[data-storyboard-panel-h3-tier='480p']")!);
    fireEvent.click(screen.getByText("确认出片"));
    expect(start).toHaveBeenCalledWith({ tier: "480p" });
  });

  it("H3 出片运行态:进度行(逐镜 Sxx+done/total+失败数)与停止按钮", () => {
    useProjectStore.setState({ activeProjectId: "p1" });
    render(
      <StoryboardPanelTab
        storyboards={[shot(1, "/p/1.png")]}
        onOpenImageWorkflow={() => undefined}
        h3Batch={{ state: { running: true, total: 19, done: 7, failed: 2, currentShotIndex: 8 }, start: vi.fn(), stop: vi.fn(), resumable: null }}
      />,
    );
    const running = document.querySelector("[data-storyboard-panel-h3-running]");
    expect(running).toBeTruthy();
    expect(running!.textContent).toContain("7/19");
    expect(running!.textContent).toContain("S08");
    expect(running!.textContent).toContain("失败 2");
    expect(document.querySelector("[data-storyboard-panel-h3-stop]")).toBeTruthy();
  });
});

describe("StoryboardPanelTab 孤儿导入入口(10-27 件三,§14.3.2/§14.3.4)", () => {
  function orphanFile(shotId: string, policy: string, version: number, timestamp: number) {
    const filename = `${policy}_v${version}_${timestamp}.mp4`;
    return {
      relativePath: `remotion/outputs/shots/chapter-001/${shotId}/h3/${filename}`,
      filename,
      policy,
      version,
      timestamp,
    };
  }

  function idleH3Batch(start: (opts?: { tier?: "480p" | "960p"; skipShotIds?: string[] }) => void) {
    return {
      state: { running: false, total: 0, done: 0, failed: 0, currentShotIndex: null },
      start,
      stop: vi.fn(),
      resumable: null,
    };
  }

  beforeEach(() => {
    h3ScanMock.mockReset();
    h3ScanMock.mockResolvedValue({ reports: [], unmatched: [], skippedFilenames: 0 });
    h3ImportMock.mockReset();
    h3ImportMock.mockResolvedValue({ imported: 0, skipped: 0 });
    useProjectStore.setState({ activeProjectId: "p1" });
  });

  afterEach(() => {
    cleanup();
  });

  it("「导入盘上 H3 片」按钮在场;0 孤儿→toast.info 不起确认条", async () => {
    render(
      <StoryboardPanelTab
        storyboards={[shot(1, "/p/1.png")]}
        onOpenImageWorkflow={() => undefined}
        h3Batch={idleH3Batch(vi.fn())}
      />,
    );
    fireEvent.click(screen.getByText("导入盘上 H3 片"));
    await vi.waitFor(() => {
      expect(toast.info).toHaveBeenCalledWith("盘上没有未挂载的 H3 片");
    });
    expect(h3ScanMock).toHaveBeenCalledTimes(1);
    expect(h3ScanMock.mock.calls[0]?.[0]).toMatchObject({ projectId: "p1" });
    expect(document.querySelector("[data-storyboard-panel-h3-import-confirm]")).toBeNull();
  });

  it("有孤儿:确认条「发现 N 镜共 M 片…导入为候选?」;确认后 importH3OrphanVideos 被调+toast.success(未逐一验播)", async () => {
    h3ScanMock.mockResolvedValue({
      reports: [
        {
          shotId: "sb-1",
          episodeId: "chapter-001",
          orphans: [orphanFile("sb-1", "ambient", 1, 1000), orphanFile("sb-1", "ambient", 2, 2000)],
        },
      ],
      unmatched: [],
      skippedFilenames: 0,
    });
    render(
      <StoryboardPanelTab
        storyboards={[shot(1, "/p/1.png")]}
        onOpenImageWorkflow={() => undefined}
        h3Batch={idleH3Batch(vi.fn())}
      />,
    );
    fireEvent.click(screen.getByText("导入盘上 H3 片"));
    await vi.waitFor(() => {
      expect(document.querySelector("[data-storyboard-panel-h3-import-confirm]")).toBeTruthy();
    });
    const strip = document.querySelector("[data-storyboard-panel-h3-import-confirm]")!;
    expect(strip.textContent).toContain("发现 1 镜共 2 片盘上已有未挂载 H3 视频,导入为候选?");
    h3ImportMock.mockResolvedValue({ imported: 2, skipped: 0 });
    fireEvent.click(screen.getByText("导入"));
    await vi.waitFor(() => {
      expect(h3ImportMock).toHaveBeenCalledTimes(1);
    });
    const importArg = h3ImportMock.mock.calls[0]![0]!;
    expect(importArg.projectId).toBe("p1");
    expect(importArg.files).toHaveLength(2);
    expect(toast.success).toHaveBeenCalledWith(expect.stringContaining("已导入 2 片"));
    expect(toast.success).toHaveBeenCalledWith(expect.stringContaining("未逐一验播"));
    await vi.waitFor(() => {
      expect(document.querySelector("[data-storyboard-panel-h3-import-confirm]")).toBeNull();
    });
  });

  it("发车确认条:展开即扫描;有孤儿→孤儿行+双择;「先导入并跳过」→导入后 start 带 skipShotIds", async () => {
    h3ScanMock.mockResolvedValue({
      reports: [
        { shotId: "sb-1", episodeId: "chapter-001", orphans: [orphanFile("sb-1", "ambient", 1, 1000)] },
        { shotId: "sb-3", episodeId: "chapter-001", orphans: [orphanFile("sb-3", "ambient", 1, 1000)] },
      ],
      unmatched: [],
      skippedFilenames: 0,
    });
    const start = vi.fn();
    render(
      <StoryboardPanelTab
        storyboards={[shot(1, "/p/1.png"), shot(2, undefined), shot(3, "/p/3.png")]}
        onOpenImageWorkflow={() => undefined}
        h3Batch={idleH3Batch(start)}
      />,
    );
    fireEvent.click(screen.getByText("H3 出片"));
    await vi.waitFor(() => {
      expect(h3ScanMock).toHaveBeenCalledTimes(1);
    });
    await vi.waitFor(() => {
      expect(document.querySelector("[data-storyboard-panel-h3-orphan]")).toBeTruthy();
    });
    const confirmBar = document.querySelector("[data-storyboard-panel-h3-confirm]")!;
    expect(confirmBar.textContent).toContain("2 镜可出片");
    expect(confirmBar.textContent).toContain("2 镜盘上已有未挂载 H3 片");
    expect(screen.getByText("先导入并跳过这些镜")).toBeTruthy();
    expect(screen.getByText("仍直接出片")).toBeTruthy();
    h3ImportMock.mockResolvedValue({ imported: 2, skipped: 0 });
    fireEvent.click(screen.getByText("先导入并跳过这些镜"));
    await vi.waitFor(() => {
      expect(start).toHaveBeenCalledWith({ tier: "960p", skipShotIds: ["sb-1", "sb-3"] });
    });
    expect(h3ImportMock).toHaveBeenCalledTimes(1);
    expect(toast.success).toHaveBeenCalledWith(expect.stringContaining("已导入 2 片"));
  });

  it("「仍直接出片」:不导入,全量派发(start 无 skipShotIds)", async () => {
    h3ScanMock.mockResolvedValue({
      reports: [{ shotId: "sb-1", episodeId: "chapter-001", orphans: [orphanFile("sb-1", "ambient", 1, 1000)] }],
      unmatched: [],
      skippedFilenames: 0,
    });
    const start = vi.fn();
    render(
      <StoryboardPanelTab
        storyboards={[shot(1, "/p/1.png")]}
        onOpenImageWorkflow={() => undefined}
        h3Batch={idleH3Batch(start)}
      />,
    );
    fireEvent.click(screen.getByText("H3 出片"));
    await vi.waitFor(() => {
      expect(document.querySelector("[data-storyboard-panel-h3-orphan]")).toBeTruthy();
    });
    fireEvent.click(screen.getByText("仍直接出片"));
    expect(start).toHaveBeenCalledWith({ tier: "960p" });
    expect(h3ImportMock).not.toHaveBeenCalled();
  });

  it("无孤儿零打扰:确认条无孤儿行/无双择,单一「确认出片」", async () => {
    const start = vi.fn();
    render(
      <StoryboardPanelTab
        storyboards={[shot(1, "/p/1.png")]}
        onOpenImageWorkflow={() => undefined}
        h3Batch={idleH3Batch(start)}
      />,
    );
    fireEvent.click(screen.getByText("H3 出片"));
    await vi.waitFor(() => {
      expect(h3ScanMock).toHaveBeenCalledTimes(1);
    });
    // 扫描已回空结果:确认条照常,孤儿行/双择均不在场
    await act(async () => {
      await Promise.resolve();
    });
    expect(document.querySelector("[data-storyboard-panel-h3-orphan]")).toBeNull();
    expect(screen.queryByText("先导入并跳过这些镜")).toBeNull();
    expect(screen.queryByText("仍直接出片")).toBeNull();
    fireEvent.click(screen.getByText("确认出片"));
    expect(start).toHaveBeenCalledWith({ tier: "960p" });
  });
});
