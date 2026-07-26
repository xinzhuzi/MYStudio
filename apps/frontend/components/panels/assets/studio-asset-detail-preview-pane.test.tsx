// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ImageIcon } from "lucide-react";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { StudioAssetDetailPreviewPane } from "./studio-asset-detail-preview-pane";
import type { StudioAssetSummary } from "@/types/studio-assets";

beforeEach(() => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn().mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
    }),
  });
  vi.stubGlobal("ResizeObserver", class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
  vi.stubGlobal("IntersectionObserver", class {
    root = null;
    rootMargin = "0px";
    thresholds = [];
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() { return []; }
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

type PreviewPaneProps = ComponentProps<typeof StudioAssetDetailPreviewPane>;

function asset(overrides: Partial<StudioAssetSummary> = {}): StudioAssetSummary {
  return {
    id: "asset-1",
    source: "manying-local",
    type: "role",
    name: "主角",
    ...overrides,
  };
}

function makeProps(overrides: Partial<PreviewPaneProps> = {}): PreviewPaneProps {
  return {
    asset: asset(),
    images: [
      { name: "主图", filePath: "role/main.png", url: "media://main" },
      { name: "姿态一", filePath: "role/pose.png", url: "media://pose" },
    ],
    currentIndex: 0,
    spokenText: "",
    audioSrc: "",
    Icon: ImageIcon,
    onCarouselApi: vi.fn(),
    onTranscribe: vi.fn(),
    onRemoveImage: vi.fn(),
    onAddImage: vi.fn(),
    onReplaceImage: vi.fn(),
    onRegenerate: vi.fn(),
    onCopyPrompt: vi.fn(),
    onOpenSource: vi.fn(),
    onOpenFolder: vi.fn(),
    ...overrides,
  };
}

function renderPane(overrides: Partial<PreviewPaneProps> = {}) {
  const props = makeProps(overrides);
  const view = render(<StudioAssetDetailPreviewPane {...props} />);
  return { ...view, props };
}

describe("StudioAssetDetailPreviewPane", () => {
  it("renders audio playback and delegates transcription", () => {
    const { container, props } = renderPane({
      asset: asset({ type: "audio", name: "旁白.wav" }),
      images: [],
      spokenText: "山雨将至。",
      audioSrc: "media://voice.wav",
    });

    expect(screen.getByText("山雨将至。")).toBeTruthy();
    expect(container.querySelector("audio")?.getAttribute("src")).toBe("media://voice.wav");
    fireEvent.click(screen.getByRole("button", { name: "✨ 智能生成说话内容" }));
    expect(props.onTranscribe).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "添加图片" })).toBeNull();
  });

  it("renders every asset image and delegates removal with the exact image index", async () => {
    const { props } = renderPane();

    expect(screen.getByRole("img", { name: "主图" }).getAttribute("src")).toBe("media://main");
    expect(screen.getByRole("img", { name: "姿态一" }).getAttribute("src")).toBe("media://pose");
    expect(screen.getAllByTitle("删除")).toHaveLength(1);

    fireEvent.click(screen.getByTitle("删除"));
    expect(props.onRemoveImage).toHaveBeenCalledWith(props.images[1], 1);
    await waitFor(() => expect(props.onCarouselApi).toHaveBeenCalled());
  });

  it("delegates every image operation without owning side effects", () => {
    const { props } = renderPane();

    fireEvent.click(screen.getByRole("button", { name: "添加图片" }));
    fireEvent.click(screen.getByRole("button", { name: "更换主图" }));
    fireEvent.click(screen.getByRole("button", { name: "重新出图" }));
    fireEvent.click(screen.getByRole("button", { name: "复制出图提示词" }));
    fireEvent.click(screen.getByRole("button", { name: "查看图片" }));
    fireEvent.click(screen.getByRole("button", { name: "打开本地文件夹" }));

    expect(props.onAddImage).toHaveBeenCalledTimes(1);
    expect(props.onReplaceImage).toHaveBeenCalledTimes(1);
    expect(props.onRegenerate).toHaveBeenCalledTimes(1);
    expect(props.onCopyPrompt).toHaveBeenCalledTimes(1);
    expect(props.onOpenSource).toHaveBeenCalledTimes(1);
    expect(props.onOpenFolder).toHaveBeenCalledTimes(1);
  });

  it("preserves the empty non-audio preview instead of inventing a clip player", () => {
    renderPane({
      asset: asset({ type: "clip", name: "片段一" }),
      images: [],
    });

    expect(screen.getByText("暂无预览图")).toBeTruthy();
    expect(screen.queryByRole("video")).toBeNull();
    expect(screen.getByRole("button", { name: "添加图片" })).toBeTruthy();
  });

  it("shows the audio empty state when no playable source exists", () => {
    renderPane({ asset: asset({ type: "audio" }), images: [] });

    expect(screen.getByText("暂无口播词句")).toBeTruthy();
    expect(screen.getByText("暂无可播放的音频地址")).toBeTruthy();
  });
});
