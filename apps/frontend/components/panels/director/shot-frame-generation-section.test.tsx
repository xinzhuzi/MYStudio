// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ShotFrameGenerationSection } from "./shot-frame-generation-section";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

type SectionProps = ComponentProps<typeof ShotFrameGenerationSection>;

function makeProps(overrides: Partial<SectionProps> = {}): SectionProps {
  return {
    startImageUrl: "media://start-frame",
    endImageUrl: "media://end-frame",
    hasVideo: false,
    previewMode: "start",
    processingType: null,
    isAngleSwitching: false,
    onPreviewFrame: vi.fn(),
    onGenerateImage: vi.fn(),
    onGenerateVideo: vi.fn(),
    onAngleSwitchClick: vi.fn(),
    ...overrides,
  };
}

function renderSection(overrides: Partial<SectionProps> = {}) {
  const props = makeProps(overrides);
  const view = render(<ShotFrameGenerationSection {...props} />);
  return { ...view, props };
}

describe("ShotFrameGenerationSection", () => {
  it("routes frame previews while nested generation controls stop propagation", () => {
    const { props, rerender } = renderSection();

    fireEvent.click(screen.getByText("起始帧"));
    fireEvent.click(screen.getByText("结束帧"));
    expect(props.onPreviewFrame).toHaveBeenNthCalledWith(1, "start");
    expect(props.onPreviewFrame).toHaveBeenNthCalledWith(2, "end");

    vi.mocked(props.onPreviewFrame).mockClear();
    const regenerateButtons = screen.getAllByRole("button", { name: "重新" });
    fireEvent.click(regenerateButtons[0]);
    fireEvent.click(regenerateButtons[1]);

    expect(props.onGenerateImage).toHaveBeenNthCalledWith(1, "start");
    expect(props.onGenerateImage).toHaveBeenNthCalledWith(2, "end");
    expect(props.onPreviewFrame).not.toHaveBeenCalled();

    const angleButtons = screen.getAllByRole("button", { name: "视角" });
    fireEvent.click(angleButtons[0]);
    fireEvent.click(angleButtons[1]);

    expect(props.onAngleSwitchClick).toHaveBeenNthCalledWith(1, "start");
    expect(props.onAngleSwitchClick).toHaveBeenNthCalledWith(2, "end");
    expect(props.onPreviewFrame).not.toHaveBeenCalled();

    rerender(<ShotFrameGenerationSection {...props} isAngleSwitching />);
    expect(screen.getAllByRole("button", { name: "视角" }).every((button) => button.hasAttribute("disabled"))).toBe(true);
  });

  it("shows empty-frame controls and blocks video generation without a start image", () => {
    const { props } = renderSection({
      startImageUrl: undefined,
      endImageUrl: undefined,
    });

    const generateButtons = screen.getAllByRole("button", { name: "生成" });
    expect(generateButtons).toHaveLength(2);
    fireEvent.click(generateButtons[0]);
    fireEvent.click(generateButtons[1]);
    expect(props.onGenerateImage).toHaveBeenNthCalledWith(1, "start");
    expect(props.onGenerateImage).toHaveBeenNthCalledWith(2, "end");
    expect(props.onPreviewFrame).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "视角" })).toBeNull();
    expect(screen.getByText("可选")).toBeTruthy();

    const videoButton = screen.getByRole("button", { name: "生成视频" });
    expect(videoButton.hasAttribute("disabled")).toBe(true);
    expect(screen.getByText("请先生成起始帧")).toBeTruthy();

    fireEvent.click(screen.getByText("起始帧"));
    expect(props.onPreviewFrame).toHaveBeenCalledWith("start");
  });

  it("keeps single-image video generation enabled with its mode hint", () => {
    const { props } = renderSection({ endImageUrl: undefined });

    const videoButton = screen.getByRole("button", { name: "生成视频" });
    expect(videoButton.hasAttribute("disabled")).toBe(false);
    expect(screen.getByText("将使用单图模式 (Image-to-Video)")).toBeTruthy();

    fireEvent.click(videoButton);
    expect(props.onGenerateVideo).toHaveBeenCalledTimes(1);
  });

  it("previews and regenerates an existing video", () => {
    const { props } = renderSection({ hasVideo: true, previewMode: "video" });

    fireEvent.click(screen.getByText("已生成"));
    expect(props.onPreviewFrame).toHaveBeenCalledWith("video");

    fireEvent.click(screen.getByRole("button", { name: "重新生成视频" }));
    expect(props.onGenerateVideo).toHaveBeenCalledTimes(1);
  });

  it("renders and disables the matching start, end, and video processing controls", () => {
    const props = makeProps({ processingType: "start" });
    const { container, rerender } = render(<ShotFrameGenerationSection {...props} />);

    expect(screen.getAllByRole("button", { name: "重新" })[0].hasAttribute("disabled")).toBe(true);
    expect(container.querySelectorAll(".animate-spin")).toHaveLength(1);

    rerender(<ShotFrameGenerationSection {...props} processingType="end" />);
    expect(screen.getAllByRole("button", { name: "重新" })[1].hasAttribute("disabled")).toBe(true);
    expect(container.querySelectorAll(".animate-spin")).toHaveLength(1);

    rerender(<ShotFrameGenerationSection {...props} processingType="video" />);
    expect(screen.getByRole("button", { name: "生成中..." }).hasAttribute("disabled")).toBe(true);
    expect(container.querySelectorAll(".animate-spin")).toHaveLength(2);
  });
});
