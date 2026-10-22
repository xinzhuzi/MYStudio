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
    onImageToImage: vi.fn(),
    onFaceFromImage: vi.fn(),
    onFaceFromText: vi.fn(),
    onExpression: vi.fn(),
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
    // 10-19 用户裁定:主图亦可删——缺省(未注入 isImageRemovable)两图都显示删除钮
    expect(screen.getAllByTitle("删除")).toHaveLength(2);

    fireEvent.click(screen.getAllByTitle("删除")[1]);
    expect(props.onRemoveImage).toHaveBeenCalledWith(props.images[1], 1);
    fireEvent.click(screen.getAllByTitle("删除")[0]);
    expect(props.onRemoveImage).toHaveBeenCalledWith(props.images[0], 0);
    await waitFor(() => expect(props.onCarouselApi).toHaveBeenCalled());
  });

  it("honors the injected isImageRemovable predicate for family read-only entries", () => {
    renderPane({ isImageRemovable: (_image, index) => index !== 0 });

    // 注入判定优先:第 0 条(族兄弟只读位)不显示删除钮,第 1 条显示
    expect(screen.getAllByTitle("删除")).toHaveLength(1);
    fireEvent.click(screen.getByTitle("删除"));
  });

  it("delegates every image operation without owning side effects", () => {
    const { props } = renderPane();

    fireEvent.click(screen.getByRole("button", { name: "添加图片" }));
    fireEvent.click(screen.getByRole("button", { name: "更换图片" }));
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

  it("renders the image-to-image button right after 重新出图 and delegates the dispatch", () => {
    const { props } = renderPane();

    const buttons = screen.getAllByRole("button");
    const regenerateIndex = buttons.findIndex((button) => button.textContent?.includes("重新出图"));
    const i2iIndex = buttons.findIndex((button) => button.textContent?.includes("图生图"));
    expect(regenerateIndex).toBeGreaterThanOrEqual(0);
    expect(i2iIndex).toBe(regenerateIndex + 1);

    fireEvent.click(screen.getByRole("button", { name: /图生图/ }));
    expect(props.onImageToImage).toHaveBeenCalledTimes(1);
  });

  it("hides the image-to-image entry entirely for audio assets", () => {
    renderPane({ asset: asset({ type: "audio" }), images: [] });
    expect(screen.queryByRole("button", { name: /图生图/ })).toBeNull();
  });

  it("disables image-to-image with a reason title when the asset cannot transfer (clip / no image)", () => {
    renderPane({
      asset: asset({ type: "clip", name: "片段一" }),
      images: [],
      canImageToImage: false,
    });

    const button = screen.getByRole("button", { name: /图生图/ }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.getAttribute("title")).toContain("角色/场景/道具");
  });

  it("shows the Loader2 spinner and phase text while the style transfer is running", () => {
    renderPane({ i2iPhase: "generating" });

    const button = screen.getByRole("button", { name: /正在转换画风/ }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.querySelector(".animate-spin")).toBeTruthy();
    expect(screen.getByText("正在转换画风…")).toBeTruthy();
  });

  it("disables image-to-image while the one-click generation phase is running", () => {
    renderPane({ generatePhase: "generating" });

    const button = screen.getByRole("button", { name: /图生图/ }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.getAttribute("title")).toBeTruthy();
  });

  // 10-21 高清人脸:人物弹窗两路按钮(图生图锚参考图/文生图锚描述+型层)
  it("hides the face portrait buttons by default and shows them for role assets with the flag", () => {
    const hidden = renderPane();
    expect(hidden.queryByRole("button", { name: /人脸·图生图/ })).toBeNull();
    expect(hidden.queryByRole("button", { name: /人脸·文生图/ })).toBeNull();

    cleanup();
    const { props } = renderPane({ canFacePortrait: true });
    fireEvent.click(screen.getByRole("button", { name: "人脸·图生图" }));
    fireEvent.click(screen.getByRole("button", { name: "人脸·文生图" }));
    expect(props.onFaceFromImage).toHaveBeenCalledTimes(1);
    expect(props.onFaceFromText).toHaveBeenCalledTimes(1);
  });

  it("disables face-from-image without images but keeps face-from-text available", () => {
    renderPane({ canFacePortrait: true, images: [] });

    const fromImage = screen.getByRole("button", { name: "人脸·图生图" }) as HTMLButtonElement;
    expect(fromImage.disabled).toBe(true);
    expect(fromImage.getAttribute("title")).toContain("先有角色图片");
    const fromText = screen.getByRole("button", { name: "人脸·文生图" }) as HTMLButtonElement;
    expect(fromText.disabled).toBe(false);
  });

  it("shows the spinner and phase text while a face portrait is running", () => {
    renderPane({ canFacePortrait: true, facePhase: "generating", faceMessage: "正在生成 主角 的高清人脸(图生图)..." });

    const buttons = screen.getAllByRole("button", { name: /人脸生成中/ });
    expect(buttons).toHaveLength(2);
    for (const button of buttons) {
      expect((button as HTMLButtonElement).disabled).toBe(true);
      expect(button.querySelector(".animate-spin")).toBeTruthy();
    }
    expect(screen.getAllByText("人脸生成中…")).toHaveLength(2);
  });

  it("disables both face portrait entries while generation or style transfer is running", () => {
    renderPane({ canFacePortrait: true, generatePhase: "generating" });
    for (const label of ["人脸·图生图", "人脸·文生图"]) {
      const button = screen.getByRole("button", { name: label }) as HTMLButtonElement;
      expect(button.disabled).toBe(true);
      expect(button.getAttribute("title")).toBeTruthy();
    }
  });
  // 10-21 表情差分:人物弹窗图生图按钮(轮播当前图锚身份+固定九宫格指令)
  it("hides the expression sheet button by default and fires it for role assets with the flag", () => {
    const hidden = renderPane();
    expect(hidden.queryByRole("button", { name: "表情差分" })).toBeNull();

    cleanup();
    const { props } = renderPane({ canFacePortrait: true });
    fireEvent.click(screen.getByRole("button", { name: "表情差分" }));
    expect(props.onExpression).toHaveBeenCalledTimes(1);
  });

  it("disables the expression sheet button without images", () => {
    renderPane({ canFacePortrait: true, images: [] });

    const button = screen.getByRole("button", { name: "表情差分" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.getAttribute("title")).toContain("先有角色图片");
  });

  it("shows the spinner and phase text while an expression sheet is running", () => {
    renderPane({ canFacePortrait: true, expressionPhase: "generating", expressionMessage: "正在生成 主角 的表情差分..." });

    const button = screen.getByRole("button", { name: "表情差分生成中…" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.querySelector(".animate-spin")).toBeTruthy();
  });

  it("disables the expression sheet entry while face portrait is running", () => {
    renderPane({ canFacePortrait: true, facePhase: "generating" });
    const button = screen.getByRole("button", { name: "表情差分" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.getAttribute("title")).toBeTruthy();
  });
});
