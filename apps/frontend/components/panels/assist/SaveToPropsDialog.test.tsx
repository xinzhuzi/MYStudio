// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  addProp: vi.fn(),
  saveImageToLocal: vi.fn(),
  toastSuccess: vi.fn(),
  toastWarning: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@/stores/library/props-library-store", () => ({
  usePropsLibraryStore: () => ({
    folders: [{ id: "f1", name: "分类一", parentId: null, createdAt: 1 }],
    addProp: mocks.addProp,
    addFolder: vi.fn(),
    setSelectedFolderId: vi.fn(),
  }),
}));
vi.mock("@/lib/media/image-storage", () => ({
  saveImageToLocal: mocks.saveImageToLocal,
}));
vi.mock("sonner", () => ({
  toast: { success: mocks.toastSuccess, warning: mocks.toastWarning, error: mocks.toastError },
}));
vi.mock("@/components/ui/image-resolution-badge", () => ({
  ResolutionBadge: () => null,
}));

import { SaveToPropsDialog } from "./SaveToPropsDialog";

const persistToProps = (url: string, _category: string, filename: string) =>
  Promise.resolve(`local-image://props/${filename}?from=${url}`);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  mocks.saveImageToLocal.mockImplementation(persistToProps);
});

function renderDialog(imageUrls: string[], previewUrl?: string) {
  return render(
    <SaveToPropsDialog
      open
      onOpenChange={vi.fn()}
      imageUrls={imageUrls}
      previewUrl={previewUrl}
      prompt="山门晨雾"
    />,
  );
}

describe("SaveToPropsDialog 批量保存", () => {
  it("多张:逐张落库,名称自动顺序编号,toast 报张数", async () => {
    renderDialog(["local-image://ai-image/a.png", "local-image://ai-image/b.png", "local-image://ai-image/c.png"]);
    fireEvent.change(screen.getByLabelText("道具名称(每张自动追加编号)"), { target: { value: "法宝" } });
    fireEvent.click(screen.getByRole("button", { name: "保存 3 张" }));

    await waitFor(() => expect(mocks.addProp).toHaveBeenCalledTimes(3));
    expect(mocks.saveImageToLocal).toHaveBeenCalledTimes(3);
    const names = mocks.addProp.mock.calls.map((call) => call[0].name);
    expect(names).toEqual(["法宝-1", "法宝-2", "法宝-3"]);
    // 三张都进同一次选择的目录,prompt 作为描述带过去
    for (const call of mocks.addProp.mock.calls) {
      expect(call[0].description).toBe("山门晨雾");
      expect(call[0].folderId).toBeNull();
    }
    expect(mocks.toastSuccess).toHaveBeenCalledTimes(1);
    expect(mocks.toastWarning).not.toHaveBeenCalled();
  });

  it("单张:行为与旧版一致——一条记录,无编号后缀", async () => {
    renderDialog(["local-image://ai-image/only.png"]);
    fireEvent.change(screen.getByLabelText("道具名称"), { target: { value: "单件" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => expect(mocks.addProp).toHaveBeenCalledTimes(1));
    expect(mocks.addProp.mock.calls[0][0].name).toBe("单件");
    expect(screen.queryByText(/共 \d+ 张/)).toBeNull();
  });

  it("多张:预览带张数角标,previewUrl 优先于首张(主图预览)", () => {
    renderDialog(["local-image://ai-image/a.png", "local-image://ai-image/b.png"], "local-image://ai-image/b.png");
    expect(screen.getByText("共 2 张")).toBeTruthy();
    expect(screen.getByAltText("预览").getAttribute("src")).toBe("local-image://ai-image/b.png");
  });

  it("落库失败回落原 URL:记录仍创建,toast 如实报未落库张数(深审 P2-1)", async () => {
    // 第 2 张保存失败(saveImageToLocal 静默回落原 URL,不抛错)
    mocks.saveImageToLocal.mockImplementationOnce(persistToProps)
      .mockImplementationOnce((url: string) => Promise.resolve(url))
      .mockImplementationOnce(persistToProps);
    renderDialog(["local-image://ai-image/a.png", "https://remote.example/x.png", "local-image://ai-image/c.png"]);
    fireEvent.change(screen.getByLabelText("道具名称(每张自动追加编号)"), { target: { value: "法宝" } });
    fireEvent.click(screen.getByRole("button", { name: "保存 3 张" }));

    await waitFor(() => expect(mocks.addProp).toHaveBeenCalledTimes(3));
    // 回落张的道具记录 imageUrl=原 URL(未丢)
    expect(mocks.addProp.mock.calls[1][0].imageUrl).toBe("https://remote.example/x.png");
    expect(mocks.toastWarning).toHaveBeenCalledTimes(1);
    expect(mocks.toastWarning.mock.calls[0][0]).toContain("2/3");
    expect(mocks.toastWarning.mock.calls[0][0]).toContain("1 张未能落库");
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
  });
});
