import { describe, expect, it, vi } from "vitest";
import { NovelEmptyState } from "./NovelTab";

describe("NovelEmptyState", () => {
  it("renders an import button when the novel library is empty", () => {
    const onImport = vi.fn();
    const element = NovelEmptyState({ hasNovelChapters: false, onImport });

    expect(element.type).toBe("button");
    expect(element.props.onClick).toBe(onImport);
    expect(JSON.stringify(element.props.children)).toContain("导入原文");
  });

  it("keeps search-empty copy passive when chapters exist", () => {
    const element = NovelEmptyState({ hasNovelChapters: true, onImport: vi.fn() });

    expect(element.type).toBe("span");
    expect(element.props.children).toBe("没有匹配的章节。");
  });
});
