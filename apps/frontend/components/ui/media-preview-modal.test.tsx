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
