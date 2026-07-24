// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { NovelChapter } from "@/types/studio";
import { useProjectStore } from "./project-store";
import {
  createStudioWorkflowId,
  removeNovelChapterMirrorsForActiveProject,
  syncNovelChapterMirrorsForActiveProject,
} from "./studio-store-runtime";

const chapter: NovelChapter = {
  id: "chapter-source-id",
  index: 1,
  volume: "正文卷",
  title: "第1章 雨夜",
  sourceText: "王离进城。",
  importedAt: 1710000000000,
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  useProjectStore.setState({
    activeProjectId: "default-project",
    activeProject: useProjectStore
      .getState()
      .projects.find((project) => project.id === "default-project") ?? null,
  });
});

describe("studio store runtime helpers", () => {
  it("creates the same timestamp and random suffix id shape", () => {
    vi.spyOn(Date, "now").mockReturnValue(1710000000000);
    vi.spyOn(Math, "random").mockReturnValue(0.5);

    expect(createStudioWorkflowId("run")).toMatch(/^run-1710000000000-[a-z0-9]+$/);
  });

  it("uses the active project and window file bridge for novel mirrors", () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const removeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("window", {
      projectFiles: { writeText, removeText },
    });
    useProjectStore.setState({
      activeProjectId: "project-1",
      activeProject: {
        id: "project-1",
        name: "测试项目",
        createdAt: 1,
        updatedAt: 1,
      },
    });

    syncNovelChapterMirrorsForActiveProject([chapter]);
    removeNovelChapterMirrorsForActiveProject([chapter]);

    expect(writeText).toHaveBeenCalledWith(
      "_p/project-1/novel/chapters/chapter-001.md",
      ["# 第1章 雨夜", "", "> 卷：正文卷", "", "王离进城。"].join("\n"),
    );
    expect(removeText).toHaveBeenCalledWith("_p/project-1/novel/chapters/chapter-001.md");
  });
});
