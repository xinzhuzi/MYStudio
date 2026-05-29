import { describe, expect, it } from "vitest";
import { buildNovelImportSummary } from "./novel-import-guide";
import type { NovelChapter } from "@/types/studio";

describe("buildNovelImportSummary", () => {
  it("only exposes the chapter count for the compact novel library header", () => {
    const chapters: NovelChapter[] = [
      chapter("chapter-001", 1, "第1章：剑主夜访道口镇", "第一章正文"),
      chapter("chapter-002", 2, "第2章：旧账", "第二章正文"),
    ];

    expect(buildNovelImportSummary(chapters)).toEqual({
      chapterCount: 2,
    });
  });
});

function chapter(id: string, index: number, title: string, sourceText: string): NovelChapter {
  return {
    id,
    index,
    title,
    sourceText,
    importedAt: 1710000000000,
  };
}
