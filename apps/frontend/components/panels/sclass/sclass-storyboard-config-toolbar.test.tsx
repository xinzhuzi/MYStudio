// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { HTMLAttributes, ReactNode } from "react";

vi.mock("@/components/ui/style-picker", () => ({
  StylePicker: ({ onChange }: { onChange: (value: string) => void }) => (
    <button type="button" onClick={() => onChange("ink")}>选择视觉风格</button>
  ),
}));
vi.mock("@/components/ui/cinematography-profile-picker", () => ({
  CinematographyProfilePicker: ({ onChange }: { onChange: (value: string) => void }) => (
    <button type="button" onClick={() => onChange("noir")}>选择摄影风格</button>
  ),
}));
vi.mock("@/components/ui/select", () => ({
  Select: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectItem: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  SelectTrigger: ({ children, ...props }: HTMLAttributes<HTMLButtonElement>) => <button {...props}>{children}</button>,
  SelectValue: () => <span>当前值</span>,
}));

import { SClassStoryboardConfigToolbar } from "./sclass-storyboard-config-toolbar";

describe("SClassStoryboardConfigToolbar", () => {
  it("forwards style, cinematography, and generation-mode actions", () => {
    const onStyleChange = vi.fn();
    const onCinematographyProfileChange = vi.fn();
    const onImageGenerationModeChange = vi.fn();
    render(<SClassStoryboardConfigToolbar
      styleId="anime"
      onStyleChange={onStyleChange}
      cinematographyProfileId="classic"
      onCinematographyProfileChange={onCinematographyProfileChange}
      aspectRatio="21:9"
      onAspectRatioChange={vi.fn()}
      imageResolution="2K"
      onImageResolutionChange={vi.fn()}
      videoResolution="720p"
      onVideoResolutionChange={vi.fn()}
      imageGenerationMode="single"
      onImageGenerationModeChange={onImageGenerationModeChange}
    />);

    fireEvent.click(screen.getByRole("button", { name: "选择视觉风格" }));
    fireEvent.click(screen.getByRole("button", { name: "选择摄影风格" }));
    fireEvent.click(screen.getByRole("button", { name: "合并生成" }));
    expect(onStyleChange).toHaveBeenCalledWith("ink");
    expect(onCinematographyProfileChange).toHaveBeenCalledWith("noir");
    expect(onImageGenerationModeChange).toHaveBeenCalledWith("merged");
    expect(screen.getByRole("button", { name: "单图生成" }).getAttribute("aria-pressed")).toBe("true");
  });
});
