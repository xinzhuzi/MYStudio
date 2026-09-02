// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  addProp: vi.fn(),
  saveImageToLocal: vi.fn(),
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
  toast: { success: vi.fn(), error: vi.fn() },
}));
vi.mock("@/components/ui/image-resolution-badge", () => ({
  ResolutionBadge: () => null,
}));

import { SaveToPropsDialog } from "./SaveToPropsDialog";

mocks.saveImageToLocal.mockImplementation(
  async (url: string, _category: string, filename: string) => `local-image://props/${filename}?from=${url}`,
);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  mocks.saveImageToLocal.mockImplementation(
    async (url: string, _category: string, filename: string) => `local-image://props/${filename}?from=${url}`,
  );
});

function renderDialog(imageUrls: string[]) {
  return render(
    <SaveToPropsDialog
      open
      onOpenChange={vi.fn()}
      imageUrls={imageUrls}
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
  });

  it("单张:行为与旧版一致——一条记录,无编号后缀", async () => {
    renderDialog(["local-image://ai-image/only.png"]);
    fireEvent.change(screen.getByLabelText("道具名称"), { target: { value: "单件" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => expect(mocks.addProp).toHaveBeenCalledTimes(1));
    expect(mocks.addProp.mock.calls[0][0].name).toBe("单件");
    expect(screen.queryByText(/共 \d+ 张/)).toBeNull();
  });

  it("多张:预览带张数角标,无空名兜底冲突", () => {
    renderDialog(["local-image://ai-image/a.png", "local-image://ai-image/b.png"]);
    expect(screen.getByText("共 2 张")).toBeTruthy();
  });
});
