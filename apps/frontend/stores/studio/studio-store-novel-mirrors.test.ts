import { describe, expect, it, vi } from "vitest";
import type { NovelChapter } from "@/types/studio";
import {
  loadNovelChapterMirror,
  loadSourceBibleMirror,
  removeNovelChapterMirrors,
  syncNovelChapterMirrors,
  syncSourceBibleMirror,
} from "./studio-store-novel-mirrors";

// 1127 正文真源读回（Task 5 Step 1）：完整正文文件解析对象 / 失败与无桥 → null / 读桥参数
const chapter2MirrorMarkdown = [
  "# 第2章：暮色灵猫结替身",
  "",
  "> 卷：第一卷",
  "> 源ID：chapter-002",
  "> 修订：2",
  "> 来源：2_暮色灵猫结替身.md",
  "",
  "正文第一段。",
  "",
  "## 事件分析",
  "",
  "摘要：灵猫替身被识破。",
  "状态：",
  "涉及角色：王离",
].join("\n");

describe("loadNovelChapterMirror（正文文件完整读回）", () => {
  it("读到完整正文文件时返回解析出的完整镜像对象", async () => {
    const readText = vi.fn().mockResolvedValue({ success: true, text: chapter2MirrorMarkdown });

    const mirror = await loadNovelChapterMirror("project-1", { index: 2 }, { readText });

    expect(mirror).toEqual({
      title: "第2章：暮色灵猫结替身",
      volume: "第一卷",
      sourceId: "chapter-002",
      revision: 2,
      sourceName: "2_暮色灵猫结替身.md",
      sourceText: "正文第一段。",
      eventSummary: "灵猫替身被识破。",
      eventState: "涉及角色：王离",
    });
  });

  it("readText 失败信封、裸 reject、空文本、无桥、无项目 id 均返回 null", async () => {
    expect(await loadNovelChapterMirror("project-1", { index: 2 }, {
      readText: vi.fn().mockResolvedValue({ success: false }),
    })).toBeNull();
    expect(await loadNovelChapterMirror("project-1", { index: 2 }, {
      readText: vi.fn().mockRejectedValue(new Error("io")),
    })).toBeNull();
    expect(await loadNovelChapterMirror("project-1", { index: 2 }, {
      readText: vi.fn().mockResolvedValue({ success: true, text: "" }),
    })).toBeNull();
    expect(await loadNovelChapterMirror("project-1", { index: 2 }, undefined)).toBeNull();
    expect(await loadNovelChapterMirror(null, { index: 2 }, {
      readText: vi.fn().mockResolvedValue({ success: true, text: chapter2MirrorMarkdown }),
    })).toBeNull();
  });

  it("调用参数为 {projectId, relativePath, raw: true}（16MB 通道）", async () => {
    const readText = vi.fn().mockResolvedValue({ success: true, text: chapter2MirrorMarkdown });

    await loadNovelChapterMirror("project-1", { index: 2 }, { readText });

    expect(readText).toHaveBeenCalledWith({
      projectId: "project-1",
      relativePath: "novel/chapters/chapter-002.md",
      raw: true,
    });
  });
});

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
      [
        "# 第1章 雨夜",
        "",
        "> 卷：正文卷",
        "> 源ID：chapter-source-id",
        "> 修订：1",
        "",
        "王离进城。",
      ].join("\n"),
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

describe("source bible mirror", () => {
  it("writes the bible to the project novel dir on save", () => {
    const writeText = vi.fn().mockResolvedValue(undefined);

    syncSourceBibleMirror("project-1", "# 原著圣经\n\n## 一句话主线\n主线", { writeText });

    expect(writeText).toHaveBeenCalledWith(
      "_p/project-1/novel/source-memory/MEMORY.md",
      "# 原著圣经\n\n## 一句话主线\n主线",
    );
  });

  it("skips writing without a project or bridge", () => {
    const writeText = vi.fn();
    syncSourceBibleMirror(null, "x", { writeText });
    syncSourceBibleMirror("project-1", "x", undefined);
    expect(writeText).not.toHaveBeenCalled();
  });

  it("heals from the project file reading the envelope shape", async () => {
    const readText = vi.fn().mockResolvedValue({ success: true, text: "# 原著圣经" });
    const text = await loadSourceBibleMirror("project-1", { readText });
    expect(readText).toHaveBeenCalledWith({
      projectId: "project-1",
      relativePath: "novel/source-memory/MEMORY.md",
    });
    expect(text).toBe("# 原著圣经");
  });

  it("returns empty on failure envelopes, raw strings and missing bridges", async () => {
    expect(await loadSourceBibleMirror("p", { readText: vi.fn().mockResolvedValue({ success: false }) })).toBe("");
    expect(await loadSourceBibleMirror("p", { readText: vi.fn().mockResolvedValue("# 裸串兼容") })).toBe("# 裸串兼容");
    expect(await loadSourceBibleMirror("p", { readText: vi.fn().mockRejectedValue(new Error("io")) })).toBe("");
    expect(await loadSourceBibleMirror("p", undefined)).toBe("");
  });
});
