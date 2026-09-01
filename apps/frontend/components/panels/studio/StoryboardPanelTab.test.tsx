// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { StoryboardPanelTab } from "./StoryboardPanelTab";
import type { StoryboardItem } from "@/types/studio";
import { __resetImageResolutionCacheForTests } from "@/components/ui/image-resolution-badge";

vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { info: vi.fn(), success: vi.fn(), error: vi.fn() }) }));

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
