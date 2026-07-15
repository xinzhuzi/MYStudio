// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";

vi.mock("@/components/ui/style-picker", () => ({
  StylePicker: ({ value }: { value: string }) => <button type="button">风格:{value}</button>,
}));

import { ContactSheetGenerationView } from "./contact-sheet-generation-view";

afterEach(cleanup);

type Props = ComponentProps<typeof ContactSheetGenerationView>;

function createProps(overrides: Partial<Props> = {}): Props {
  return {
    prompt: "English prompt",
    promptZh: "中文提示词",
    promptLanguage: "zh",
    promptPages: [
      { prompt: "page one", promptZh: "第一页" },
      { prompt: "page two", promptZh: "第二页" },
    ],
    pendingViewpoints: [{ id: "v1", name: "正面", keyProps: ["桌子"], gridIndex: 0, pageIndex: 0, shotIndexes: [1] }],
    extractedViewpoints: [],
    currentPageIndex: 0,
    styleId: "ink",
    aspectRatio: "16:9",
    layout: "2x2",
    image: null,
    splitImages: {},
    isGenerating: false,
    progress: 0,
    isSplitting: false,
    onCancel: vi.fn(),
    onPageChange: vi.fn(),
    onStyleChange: vi.fn(),
    onAspectRatioChange: vi.fn(),
    onLayoutChange: vi.fn(),
    onGenerate: vi.fn(),
    onUpload: vi.fn(),
    onPromptChange: vi.fn(),
    onCopyPrompt: vi.fn(),
    onSplit: vi.fn(),
    onSave: vi.fn(),
    ...overrides,
  };
}

describe("ContactSheetGenerationView", () => {
  it("delegates paging, generation, and cancellation", () => {
    const props = createProps();
    render(<ContactSheetGenerationView {...props} />);

    fireEvent.click(screen.getByRole("button", { name: "下一页" }));
    fireEvent.click(screen.getByRole("button", { name: "生成联合图（自动切割并保存）" }));
    fireEvent.click(screen.getByRole("button", { name: "取消" }));

    expect(props.onPageChange).toHaveBeenCalledWith(1);
    expect(props.onGenerate).toHaveBeenCalledOnce();
    expect(props.onCancel).toHaveBeenCalledOnce();
  });

  it("keeps the view mounted while clearing and copying the Chinese prompt", () => {
    const props = createProps();
    render(<ContactSheetGenerationView {...props} />);

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "复制" }));

    expect(props.onPromptChange).toHaveBeenCalledWith("", true);
    expect(props.onCopyPrompt).toHaveBeenCalledWith(false);
    expect(screen.getByText("多视角联合图")).toBeTruthy();
  });

  it("delegates split and save for generated output", () => {
    const props = createProps({
      image: "sheet.png",
      splitImages: { v1: { imageUrl: "front.png", gridIndex: 0 } },
    });
    render(<ContactSheetGenerationView {...props} />);

    fireEvent.click(screen.getByRole("button", { name: "切割为 1 个视角" }));
    fireEvent.click(screen.getByRole("button", { name: "保存视角图片到场景" }));

    expect(props.onSplit).toHaveBeenCalledOnce();
    expect(props.onSave).toHaveBeenCalledOnce();
    expect(screen.getByAltText("联合图预览").getAttribute("src")).toBe("sheet.png");
  });
});
