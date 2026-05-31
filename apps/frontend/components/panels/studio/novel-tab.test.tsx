// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { NovelTab } from "./index";
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
});
