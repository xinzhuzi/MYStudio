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
});
