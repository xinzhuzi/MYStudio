import type { NovelChapter } from "@/types/studio";

export function buildNovelImportSummary(chapters: NovelChapter[]) {
  return {
    chapterCount: chapters.length,
  };
}
