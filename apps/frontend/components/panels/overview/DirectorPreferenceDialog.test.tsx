// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("md-editor-rt", () => ({
  MdEditor: ({ modelValue, onChange }: { modelValue: string; onChange: (v: string) => void }) => (
    <textarea
      data-testid="pref-editor"
      value={modelValue}
      onChange={(e) => onChange((e.target as HTMLTextAreaElement).value)}
    />
  ),
}));

import { DirectorPreferenceDialog } from "./DirectorPreferenceDialog";

const mocks = vi.hoisted(() => ({
  getItem: vi.fn(async (): Promise<string | null> => null),
  setItem: vi.fn(async () => true),
}));

describe("DirectorPreferenceDialog 手工沉淀(2026-10-10 撤 AI 代写)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (window as unknown as { fileStorage?: unknown }).fileStorage = {
      getItem: mocks.getItem,
      setItem: mocks.setItem,
    };
  });

  afterEach(() => {
    cleanup();
    delete (window as unknown as { fileStorage?: unknown }).fileStorage;
  });

  it("空卡载入模板;编辑后手动保存才落盘新键", async () => {
    render(<DirectorPreferenceDialog open onOpenChange={() => {}} />);

    const editor = (await screen.findByTestId("pref-editor")) as HTMLTextAreaElement;
    // 空存储 → 模板即引导(md 四分类)
    expect(editor.value).toContain("# 导演偏好");
    expect(editor.value).toContain("## 改编原则");

    fireEvent.change(editor, { target: { value: "# 导演偏好\n\n## 改编原则\n- 长镜头优先\n" } });
    fireEvent.click(screen.getByRole("button", { name: /^保存$/ }));

    await waitFor(() =>
      expect(mocks.setItem).toHaveBeenCalledWith(
        "director-preference.md",
        expect.stringContaining("长镜头优先"),
      ),
    );
  });

  it("不再提供整卡 AI 代写入口(无 AI 生成按钮)", async () => {
    render(<DirectorPreferenceDialog open onOpenChange={() => {}} />);
    await screen.findByTestId("pref-editor");
    expect(screen.queryByRole("button", { name: /AI 生成/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /生成草稿/ })).toBeNull();
  });

  it("超 2000 字符禁保存", async () => {
    mocks.getItem.mockImplementation(async () => `# 导演偏好\n\n## 改编原则\n- ${"长".repeat(2100)}`);
    render(<DirectorPreferenceDialog open onOpenChange={() => {}} />);

    await waitFor(() => {
      const save = screen.getByRole("button", { name: /^保存$/ }) as HTMLButtonElement;
      expect(save.disabled).toBe(true);
    });
    expect(mocks.setItem).not.toHaveBeenCalled();
  });
});
