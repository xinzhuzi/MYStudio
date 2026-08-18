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

vi.mock("@/lib/ai/ai-manager", () => ({
  aiManager: {
    text: vi.fn(async () => ({
      success: true,
      text: "## 改编口味\n快节奏强钩子，单集结尾必留悬念\n\n## 叙事偏好\n多用对白推进，旁白只做转场\n\n## 口味雷点\n不要回忆杀开场",
    })),
  },
}));

import { AuthorPreferenceDialog } from "./AuthorPreferenceDialog";

const mocks = vi.hoisted(() => ({
  getItem: vi.fn(async () => null),
  setItem: vi.fn(async () => true),
}));

describe("AuthorPreferenceDialog AI 起草", () => {
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

  it("AI 生成（跳过问答）→ 草稿进编辑器 → 手动保存才落盘", async () => {
    render(<AuthorPreferenceDialog open onOpenChange={() => {}} />);

    // 编辑器先载入模板
    await waitFor(() =>
      expect(screen.getByTestId("pref-editor") as HTMLTextAreaElement).toBeTruthy(),
    );

    fireEvent.click(screen.getByRole("button", { name: /AI 生成/ }));
    // 问答面板出现，答案不保存的说明在场
    expect(await screen.findByText(/只用于本次生成，不保存/)).toBeTruthy();

    fireEvent.click(await screen.findByRole("button", { name: /跳过问题直接生成/ }));

    // 草稿进编辑器（AI 不直接落盘）
    await waitFor(() => {
      const editor = screen.getByTestId("pref-editor") as HTMLTextAreaElement;
      expect(editor.value).toContain("# 作者偏好");
      expect(editor.value).toContain("快节奏强钩子");
    });
    expect(mocks.setItem).not.toHaveBeenCalled();

    fireEvent.click(await screen.findByRole("button", { name: /^保存$/ }));
    await waitFor(() =>
      expect(mocks.setItem).toHaveBeenCalledWith(
        "author-preference.md",
        expect.stringContaining("快节奏强钩子"),
      ),
    );
  });

  it("问答作答路径：选项进入生成上下文（经 aiManager 消息断言）", async () => {
    const { aiManager } = await import("@/lib/ai/ai-manager");
    render(<AuthorPreferenceDialog open onOpenChange={() => {}} />);
    await waitFor(() => expect(screen.getByTestId("pref-editor")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: /AI 生成/ }));
    fireEvent.click(await screen.findByLabelText("仙侠"));
    fireEvent.click(await screen.findByRole("radio", { name: /大胆改编/ }));
    fireEvent.click(await screen.findByRole("button", { name: /^生成草稿$/ }));

    await waitFor(() =>
      expect(screen.getByTestId("pref-editor") as HTMLTextAreaElement).toBeTruthy(),
    );
    await waitFor(() => expect(aiManager.text).toHaveBeenCalled());
    const call = (aiManager.text as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
      messages: { content: string }[];
    };
    const userContent = call.messages.map((m) => m.content).join("\n");
    expect(userContent).toContain("题材偏好：仙侠");
    expect(userContent).toContain("改编幅度：大胆改编");
  });
});
