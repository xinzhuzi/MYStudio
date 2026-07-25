import { describe, expect, it, vi } from "vitest";
import type { NovelChapter } from "@/types/studio";
import { removeNovelChapterMirrors, syncNovelChapterMirrors } from "./studio-store-novel-mirrors";

const chapter: NovelChapter = {
  id: "chapter-source-id",
  index: 1,
  volume: "正文卷",
  title: "第1章 雨夜",
  sourceText: "王离进城。",
  importedAt: 1710000000000,
};

describe("studio novel mirror side effects", () => {
  it("writes the stable project-scoped mirror key and content", () => {
    const writeText = vi.fn().mockResolvedValue(undefined);

    syncNovelChapterMirrors("project-1", [chapter], { writeText });

    expect(writeText).toHaveBeenCalledWith(
      "_p/project-1/novel/chapters/chapter-001.md",
      ["# 第1章 雨夜", "", "> 卷：正文卷", "", "王离进城。"].join("\n"),
    );
  });

  it("removes the same stable mirror key without changing chapter identity", () => {
    const removeText = vi.fn().mockResolvedValue(undefined);

    removeNovelChapterMirrors("project-1", [chapter], { removeText });

    expect(removeText).toHaveBeenCalledWith("_p/project-1/novel/chapters/chapter-001.md");
  });

  it("does not touch the bridge when project identity or capability is absent", () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const removeText = vi.fn().mockResolvedValue(undefined);

    syncNovelChapterMirrors(undefined, [chapter], { writeText });
    removeNovelChapterMirrors("project-1", [chapter], { removeText: undefined });

    expect(writeText).not.toHaveBeenCalled();
    expect(removeText).not.toHaveBeenCalled();
  });
});
