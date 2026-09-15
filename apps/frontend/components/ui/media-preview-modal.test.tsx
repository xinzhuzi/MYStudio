// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ImagePreviewModal, VideoPreviewModal } from "./media-preview-modal";

afterEach(() => {
  cleanup();
  document.body.style.overflow = "";
});

describe("media preview modals", () => {
  it("closes an open image preview with Escape and restores body scrolling", () => {
    const onClose = vi.fn();
    render(
      <ImagePreviewModal
        imageUrl="https://example.test/preview.png"
        isOpen
        onClose={onClose}
      />,
    );

    expect(screen.getByAltText("Preview").getAttribute("src")).toBe(
      "https://example.test/preview.png",
    );
    expect(document.body.style.overflow).toBe("hidden");

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();

    cleanup();
    expect(document.body.style.overflow).toBe("");
  });

  it("multi-image group: both prev/next navigation controls are present for page turning", () => {
    const onClose = vi.fn();
    render(
      <ImagePreviewModal
        imageUrl="https://example.test/1.png"
        imageUrls={["https://example.test/1.png", "https://example.test/2.png"]}
        initialIndex={1}
        isOpen
        onClose={onClose}
      />,
    );

    expect(screen.getByLabelText("上一张")).toBeTruthy();
    expect(screen.getByLabelText("下一张")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("上一张"));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("受控翻页回路(09-03 根修):点下一张后索引回写,上一张按钮解除禁用", () => {
    render(
      <ImagePreviewModal
        imageUrl="https://example.test/1.png"
        imageUrls={["https://example.test/1.png", "https://example.test/2.png", "https://example.test/3.png"]}
        initialIndex={0}
        isOpen
        onClose={vi.fn()}
      />,
    );
    // 初始第一张:上一张禁用、下一张可用
    expect((screen.getByLabelText("上一张") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText("下一张") as HTMLButtonElement).disabled).toBe(false);
    // 翻到中间张:上一张/下一张都必须可用(受控 index 缺回路时会全体禁用)
    fireEvent.click(screen.getByLabelText("下一张"));
    expect((screen.getByLabelText("上一张") as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByLabelText("下一张") as HTMLButtonElement).disabled).toBe(false);
  });

  it("Radix 模态锁穿透:从 Radix Dialog 内打开时容器显式恢复 pointer-events(09-03)", () => {
    // 复现 Radix modal 行为:body 被置 pointer-events:none(只恢复自身内容树),
    // Lightbox portal 在 body 下不在该树内——容器必须显式 auto,否则
    // 放大/缩小/关闭按钮可见但点不动(生成记录弹窗内看大图实锤)。
    document.body.style.pointerEvents = "none";
    try {
      render(
        <ImagePreviewModal
          imageUrl="https://example.test/preview.png"
          isOpen
          onClose={vi.fn()}
        />,
      );
      const lightboxContainer = document.querySelector(".yarl__container") as HTMLElement | null;
      expect(lightboxContainer).toBeTruthy();
      expect(lightboxContainer!.style.pointerEvents).toBe("auto");
    } finally {
      document.body.style.pointerEvents = "";
    }
  });

  it("renders and closes the video preview through its close control", () => {
    const onClose = vi.fn();
    const { container } = render(
      <VideoPreviewModal
        videoUrl="https://example.test/preview.mp4"
        isOpen
        onClose={onClose}
      />,
    );

    expect(container.querySelector("video")?.getAttribute("src")).toBe(
      "https://example.test/preview.mp4",
    );
    fireEvent.click(container.querySelector("button")!);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("不带截帧动作时不渲染操作条(既有消费方零变化)", () => {
    const { container } = render(
      <VideoPreviewModal videoUrl="https://example.test/preview.mp4" isOpen onClose={vi.fn()} />,
    );
    expect(container.querySelector("[data-video-keyframe-actions]")).toBeNull();
  });
});

describe("VideoPreviewModal 截帧动作(09-15 P1a)", () => {
  it("存为关键帧上报当前播放时刻;自动抽帧上报 3/5/9 档", () => {
    const onSaveCurrentFrame = vi.fn();
    const onAutoSample = vi.fn();
    const { container } = render(
      <VideoPreviewModal
        videoUrl="https://example.test/preview.mp4"
        isOpen
        onClose={vi.fn()}
        keyframeActions={{ onSaveCurrentFrame, onAutoSample }}
      />,
    );
    const video = container.querySelector("[data-video-preview-player]") as HTMLVideoElement;
    video.currentTime = 3.25;
    fireEvent.click(screen.getByText("存为关键帧"));
    expect(onSaveCurrentFrame).toHaveBeenCalledWith(3.25);

    fireEvent.click(screen.getByText("3 帧"));
    expect(onAutoSample).toHaveBeenCalledWith(3);
    fireEvent.click(screen.getByText("9 帧"));
    expect(onAutoSample).toHaveBeenCalledWith(9);
  });

  it("禁用原因→两动作禁用+tooltip;busy→禁用+抽帧中文案", () => {
    const { rerender } = render(
      <VideoPreviewModal
        videoUrl="https://example.test/preview.mp4"
        isOpen
        onClose={vi.fn()}
        keyframeActions={{
          onSaveCurrentFrame: vi.fn(),
          onAutoSample: vi.fn(),
          disabledReason: "当前视频不在项目内,无法抽帧",
        }}
      />,
    );
    const saveButton = screen.getByText("存为关键帧") as HTMLButtonElement;
    expect(saveButton.disabled).toBe(true);
    expect(saveButton.title).toContain("不在项目内");
    expect((screen.getByText("5 帧") as HTMLButtonElement).disabled).toBe(true);

    rerender(
      <VideoPreviewModal
        videoUrl="https://example.test/preview.mp4"
        isOpen
        onClose={vi.fn()}
        keyframeActions={{ onSaveCurrentFrame: vi.fn(), onAutoSample: vi.fn(), busy: true }}
      />,
    );
    const busyButton = screen.getByText("抽帧中…") as HTMLButtonElement;
    expect(busyButton.disabled).toBe(true);
    expect((screen.getByText("5 帧") as HTMLButtonElement).disabled).toBe(true);
  });
});
