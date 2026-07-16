// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SplitScene } from "@/stores/director-store";
import { ScenePromptPanel } from "./scene-prompt-panel";

const scene = {
  id: 4,
  actionSummary: "人物起身",
  imagePrompt: "English image",
  imagePromptZh: "中文首帧",
  endFramePrompt: "English end",
  endFramePromptZh: "中文尾帧",
  videoPrompt: "English motion",
  videoPromptZh: "中文动作",
  needsEndFrame: true,
  cameraMovement: "pan-left",
  duration: 5,
} as unknown as SplitScene;

afterEach(cleanup);

function setup(options?: { language?: "zh" | "en" | "zh+en"; variant?: "director" | "sclass"; disabled?: boolean }) {
  const callbacks = {
    onUpdateAction: vi.fn(),
    onSaveImage: vi.fn(),
    onSaveEndFrame: vi.fn(),
    onSaveVideo: vi.fn(),
  };
  render(
    <ScenePromptPanel
      scene={scene}
      promptLanguage={options?.language || "zh"}
      variant={options?.variant || "director"}
      disabled={options?.disabled || false}
      {...callbacks}
    />,
  );
  return callbacks;
}

describe("ScenePromptPanel", () => {
  it("shows the collapsed workflow summary and toggles prompt details", () => {
    setup();
    expect(screen.getByText("中文尾帧")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "提示词" }));
    expect(screen.getByText("剧本动作（提示词来源）")).toBeTruthy();
    expect(screen.getByRole("button", { name: "编辑首帧提示词" })).toBeTruthy();
  });

  it("preserves the opposite language when saving a Director prompt", () => {
    const callbacks = setup({ language: "en", variant: "director" });
    fireEvent.click(screen.getByRole("button", { name: "提示词" }));
    fireEvent.click(screen.getByRole("button", { name: "编辑首帧提示词" }));
    const editor = screen.getByRole("textbox", { name: "image-prompt-editor" });
    expect((editor as HTMLTextAreaElement).value).toBe("English image");
    fireEvent.change(editor, { target: { value: "Updated English" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(callbacks.onSaveImage).toHaveBeenCalledWith("Updated English", "中文首帧");
  });

  it("uses zh-first S-Class saves and supports cancellation", () => {
    const callbacks = setup({ language: "zh", variant: "sclass" });
    fireEvent.click(screen.getByRole("button", { name: "提示词" }));
    fireEvent.click(screen.getByRole("button", { name: "编辑视频提示词" }));
    const editor = screen.getByRole("textbox", { name: "video-prompt-editor" });
    expect((editor as HTMLTextAreaElement).value).toBe("中文动作");
    fireEvent.change(editor, { target: { value: "新动作" } });
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(callbacks.onSaveVideo).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "编辑视频提示词" }));
    fireEvent.change(screen.getByRole("textbox", { name: "video-prompt-editor" }), { target: { value: "新动作" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(callbacks.onSaveVideo).toHaveBeenCalledWith("English motion", "新动作");
  });

  it("prevents prompt editing while generation is active", () => {
    setup({ disabled: true });
    fireEvent.click(screen.getByRole("button", { name: "提示词" }));
    const editButton = screen.getByRole("button", { name: "编辑首帧提示词" });
    expect((editButton as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(editButton);
    expect(screen.queryByRole("textbox", { name: "image-prompt-editor" })).toBeNull();
  });
});
