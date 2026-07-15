// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";

vi.mock("@/stores/scene-store", () => ({
  useSceneStore: { getState: () => ({ scenes: [] }) },
}));
vi.mock("@/components/ui/style-picker", () => ({
  StylePicker: ({ value }: { value: string }) => <button type="button">风格:{value}</button>,
}));

import { OrthographicGenerationView } from "./orthographic-generation-view";

afterEach(cleanup);

type Props = ComponentProps<typeof OrthographicGenerationView>;

function createProps(overrides: Partial<Props> = {}): Props {
  return {
    selectedScene: null,
    styleId: "ink",
    aspectRatio: "16:9",
    prompt: "English prompt",
    promptZh: "中文提示词",
    promptLanguage: "zh",
    image: null,
    views: { front: null, back: null, left: null, right: null },
    isGenerating: false,
    progress: 0,
    isSplitting: false,
    onStyleChange: vi.fn(),
    onAspectRatioChange: vi.fn(),
    onPromptChange: vi.fn(),
    onCancel: vi.fn(),
    onGenerate: vi.fn(),
    onUpload: vi.fn(),
    onCopyPrompt: vi.fn(),
    onSplit: vi.fn(),
    onSave: vi.fn(),
    ...overrides,
  };
}

describe("OrthographicGenerationView", () => {
  it("renders the empty state and delegates generation and cancellation", () => {
    const props = createProps();
    render(<OrthographicGenerationView {...props} />);

    fireEvent.click(screen.getByRole("button", { name: "生成四视图" }));
    fireEvent.click(screen.getByRole("button", { name: "取消" }));

    expect(props.onGenerate).toHaveBeenCalledOnce();
    expect(props.onCancel).toHaveBeenCalledOnce();
    expect(screen.queryByAltText("四视图预览")).toBeNull();
  });

  it("edits and copies the Chinese prompt with the original language contract", () => {
    const props = createProps();
    render(<OrthographicGenerationView {...props} />);

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "更新后的提示词" } });
    fireEvent.click(screen.getByRole("button", { name: "复制" }));

    expect(props.onPromptChange).toHaveBeenCalledWith("更新后的提示词", true);
    expect(props.onCopyPrompt).toHaveBeenCalledWith(false);
  });

  it("delegates splitting and saving when generated views are present", () => {
    const props = createProps({
      image: "sheet.png",
      views: { front: "front.png", back: null, left: null, right: null },
    });
    render(<OrthographicGenerationView {...props} />);

    fireEvent.click(screen.getByRole("button", { name: "切割为 4 个视角" }));
    fireEvent.click(screen.getByRole("button", { name: "保存视角图片到场景" }));

    expect(props.onSplit).toHaveBeenCalledOnce();
    expect(props.onSave).toHaveBeenCalledOnce();
    expect(screen.getByAltText("四视图预览").getAttribute("src")).toBe("sheet.png");
    expect(screen.getByAltText("正面").getAttribute("src")).toBe("front.png");
  });
});
