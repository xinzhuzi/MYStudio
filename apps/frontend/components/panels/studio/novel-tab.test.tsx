// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NovelChapterTable } from "./NovelChapterTable";
import { NovelTab } from "./NovelTab";
import { SOURCE_BIBLE_TEMPLATE } from "@/lib/studio/source-bible";
import type { NovelChapter } from "@/types/studio";

// jsdom 缺少 Radix 依赖的浏览器 API，最小 shim。
(globalThis as any).ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
(globalThis as any).matchMedia ??= () => ({
  matches: false,
  addEventListener() {},
  removeEventListener() {},
});

afterEach(() => {
  cleanup();
  delete (window as unknown as { sourceMemory?: unknown }).sourceMemory;
});

const chapter: NovelChapter = {
  id: "c1",
  index: 1,
  volume: "正文卷",
  title: "第1章 测试",
  sourceText: "正文内容",
  importedAt: 0,
};

function renderNovelTab() {
  render(
    <NovelTab
      novelDraft=""
      setNovelDraft={vi.fn()}
      handleNovelFile={vi.fn()}
      appendNovelText={vi.fn()}
      replaceNovelText={vi.fn()}
      novelChapters={[chapter]}
      updateNovelChapter={vi.fn()}
      analyzeEvents={vi.fn()}
      sourceBible=""
      saveSourceBible={vi.fn()}
      generateBibleDraft={vi.fn(async () => SOURCE_BIBLE_TEMPLATE)}
      setHeaderActions={vi.fn()}
    />,
  );
}

describe("NovelTab 章节表操作列去重", () => {
  it("保留「编辑」「删除」，移除冗余的「查看详情」", () => {
    renderNovelTab();
    expect(screen.getByText("编辑")).toBeTruthy();
    expect(screen.getByText("删除")).toBeTruthy();
    expect(screen.queryByText("查看详情")).toBeNull();
  });

  it("在内容区保留小说导入和批量操作入口", () => {
    renderNovelTab();

    expect(screen.getByRole("button", { name: /导入原文/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /批量删除/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /事件分析/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /原著圣经/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /原著记忆库/ })).toBeTruthy();
    expect(screen.getByPlaceholderText("搜索章节名称或正文...")).toBeTruthy();
  });

  it("原著记忆库对话框默认关闭，点击入口后展示状态与检索自测", async () => {
    (window as unknown as { sourceMemory?: unknown }).sourceMemory = {
      status: vi.fn(async () => ({
        success: true,
        status: "partial",
        buildId: "b1",
        recordCount: 9,
        structuredCount: 2,
        rawCount: 7,
        degradedReason: "extraction-pending:2",
      })),
      search: vi.fn(async () => ({ success: true, hits: [] })),
      build: vi.fn(async () => ({ success: true })),
      stageRecords: vi.fn(async () => ({ success: true, accepted: 0 })),
      commitBuild: vi.fn(async () => ({ success: true, status: "ready" })),
    };

    renderNovelTab();
    expect(screen.queryByText("结构化记录")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /原著记忆库/ }));
    await waitFor(() => expect(screen.getByText("部分完成")).toBeTruthy());
    expect(screen.getByText(/2 个章节待智能抽取/)).toBeTruthy();
    expect(screen.getByPlaceholderText(/检索自测/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /重建记忆库/ })).toBeTruthy();

    delete (window as unknown as { sourceMemory?: unknown }).sourceMemory;
  });

  it("事件分析操作使用品牌目录里的 AI 图标", () => {
    const source = readFileSync(
      "frontend/components/panels/studio/NovelTab.tsx",
      "utf8",
    );
    const iconSource = readFileSync(
      "frontend/assets/brand/ai-event-analysis-icon.svg",
      "utf8",
    );

    expect(source).toContain("@/assets/brand/ai-event-analysis-icon.svg");
    expect(source).toContain('alt=""');
    expect(iconSource).toContain("<svg");
    expect(iconSource).toContain("AI");
  });
});

describe("NovelChapterTable", () => {
  it("渲染章节行并保留原有操作按钮", () => {
    render(
      <NovelChapterTable
        chapters={[chapter]}
        selectedIds={new Set()}
        allVisibleSelected={false}
        emptyState={null}
        onDelete={vi.fn()}
        onEdit={vi.fn()}
        onToggleAllVisible={vi.fn()}
        onToggleChapter={vi.fn()}
      />,
    );

    expect(screen.getByText("第1章 测试")).toBeTruthy();
    expect(screen.getByText("编辑")).toBeTruthy();
    expect(screen.getByText("删除")).toBeTruthy();
  });

  it("未登记人物名时在事件摘要列显示警告标记", () => {
    render(
      <NovelChapterTable
        chapters={[{ ...chapter, eventNameWarnings: ["神秘老者"] }]}
        selectedIds={new Set()}
        allVisibleSelected={false}
        emptyState={null}
        onDelete={vi.fn()}
        onEdit={vi.fn()}
        onToggleAllVisible={vi.fn()}
        onToggleChapter={vi.fn()}
      />,
    );

    const marker = document.querySelector('span[title*="神秘老者"]');
    expect(marker).toBeTruthy();
    expect(marker?.getAttribute("title")).toContain("未在原著圣经人物表登记");
  });
});
