// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/ui/style-picker", () => ({
  StylePicker: ({ value }: { value: string }) => <div>style:{value}</div>,
}));
vi.mock("@/components/ui/cinematography-profile-picker", () => ({
  CinematographyProfilePicker: ({ value }: { value: string }) => <div>cinematography:{value}</div>,
}));

import { StoryboardConfigToolbar } from "./storyboard-config-toolbar";

afterEach(cleanup);

function baseProps() {
  return {
    styleId: "ink",
    onStyleChange: vi.fn(),
    aspectRatio: "16:9" as const,
    onAspectRatioChange: vi.fn(),
    imageResolution: "2K" as const,
    onImageResolutionChange: vi.fn(),
    videoResolution: "720p" as const,
    onVideoResolutionChange: vi.fn(),
    styleTokens: ["ink wash", "paper texture"],
  };
}

describe("StoryboardConfigToolbar", () => {
  it("renders the trailer/basic mode and preserves aspect callbacks", () => {
    const props = baseProps();
    render(<StoryboardConfigToolbar {...props} />);
    expect(screen.getByText("style:ink")).toBeTruthy();
    expect(screen.queryByText(/cinematography:/)).toBeNull();
    expect(screen.queryByText("图片生成方式:")).toBeNull();
    expect(screen.getByText("ink wash, paper texture...")).toBeTruthy();
    fireEvent.click(screen.getByText("竖屏"));
    expect(props.onAspectRatioChange).toHaveBeenCalledWith("9:16");
    expect(screen.getByText("横屏").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("竖屏").getAttribute("aria-pressed")).toBe("false");
  });

  it("renders extended controls and propagates generation mode", () => {
    const props = baseProps();
    const onImageGenerationModeChange = vi.fn();
    render(
      <StoryboardConfigToolbar
        {...props}
        cinematographyProfileId="cinematic"
        onCinematographyProfileChange={vi.fn()}
        imageGenerationMode="single"
        onImageGenerationModeChange={onImageGenerationModeChange}
      />,
    );
    expect(screen.getByText("cinematography:cinematic")).toBeTruthy();
    expect(screen.getByText("单图生成").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("合并生成").getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(screen.getByText("合并生成"));
    expect(onImageGenerationModeChange).toHaveBeenCalledWith("merged");
  });

  it("disables direct button controls during generation", () => {
    render(<StoryboardConfigToolbar {...baseProps()} disabled />);
    expect((screen.getByText("横屏") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByText("竖屏") as HTMLButtonElement).disabled).toBe(true);
  });
});
