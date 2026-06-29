// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { cleanup, render, screen } from "@testing-library/react";
import { NovelChapterTable } from "./NovelChapterTable";
import { NovelTab } from "./NovelTab";
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

afterEach(cleanup);

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
      deleteNovelChapters={vi.fn()}
      novelChapters={[chapter]}
      updateNovelChapter={vi.fn()}
      analyzeEvents={vi.fn()}
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
    expect(screen.getByPlaceholderText("搜索章节名称或正文...")).toBeTruthy();
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
});
