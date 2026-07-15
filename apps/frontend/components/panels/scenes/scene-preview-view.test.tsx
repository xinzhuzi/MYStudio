// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ScenePreviewView } from "./scene-preview-view";

afterEach(cleanup);

describe("ScenePreviewView", () => {
  it("renders the preview and delegates all actions", () => {
    const onSave = vi.fn();
    const onRegenerate = vi.fn();
    const onDiscard = vi.fn();

    render(
      <ScenePreviewView
        previewUrl="preview.png"
        isGenerating={false}
        onSave={onSave}
        onRegenerate={onRegenerate}
        onDiscard={onDiscard}
      />,
    );

    expect(screen.getByAltText("场景概念图预览").getAttribute("src")).toBe("preview.png");
    fireEvent.click(screen.getByRole("button", { name: "保存概念图" }));
    fireEvent.click(screen.getByRole("button", { name: "重新生成" }));
    fireEvent.click(screen.getByRole("button", { name: "放弃并返回" }));

    expect(onSave).toHaveBeenCalledOnce();
    expect(onRegenerate).toHaveBeenCalledOnce();
    expect(onDiscard).toHaveBeenCalledOnce();
  });

  it("disables regeneration while a generation is running", () => {
    const onRegenerate = vi.fn();

    render(
      <ScenePreviewView
        previewUrl="preview.png"
        isGenerating
        onSave={vi.fn()}
        onRegenerate={onRegenerate}
        onDiscard={vi.fn()}
      />,
    );

    const regenerate = screen.getByRole("button", { name: "重新生成" });
    expect(regenerate.hasAttribute("disabled")).toBe(true);
    fireEvent.click(regenerate);
    expect(onRegenerate).not.toHaveBeenCalled();
  });
});
