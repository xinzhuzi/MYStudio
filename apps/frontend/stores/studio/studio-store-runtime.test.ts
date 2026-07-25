// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { NovelChapter } from "@/types/studio";
import { useProjectStore } from "../project/project-store";
import {
  createStudioWorkflowId,
  removeNovelChapterMirrorsForActiveProject,
  syncNovelChapterMirrorsForActiveProject,
} from "./studio-store-runtime";
import {
  removeNovelChapterMirrors,
  syncNovelChapterMirrors,
} from "./studio-store-novel-mirrors";

vi.mock("./studio-store-novel-mirrors", () => ({
  removeNovelChapterMirrors: vi.fn(),
  syncNovelChapterMirrors: vi.fn(),
}));

const chapter: NovelChapter = {
  id: "chapter-source-id",
  index: 1,
  volume: "正文卷",
  title: "第1章 雨夜",
  sourceText: "王离进城。",
  importedAt: 1710000000000,
};

afterEach(() => {
  vi.clearAllMocks();
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

  it("passes the active project and exact preload bridge to novel mirrors", () => {
    const projectFiles = {
      writeText: vi.fn().mockResolvedValue(undefined),
      removeText: vi.fn().mockResolvedValue(undefined),
    };
    const chapters = [chapter];
    vi.stubGlobal("window", {
      projectFiles,
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

    syncNovelChapterMirrorsForActiveProject(chapters);
    removeNovelChapterMirrorsForActiveProject(chapters);

    expect(syncNovelChapterMirrors).toHaveBeenCalledWith(
      "project-1",
      chapters,
      projectFiles,
    );
    expect(removeNovelChapterMirrors).toHaveBeenCalledWith(
      "project-1",
      chapters,
      projectFiles,
    );
    expect(vi.mocked(syncNovelChapterMirrors).mock.calls[0]?.[2]).toBe(projectFiles);
    expect(vi.mocked(removeNovelChapterMirrors).mock.calls[0]?.[2]).toBe(projectFiles);
  });

  it("safely passes no bridge when window or projectFiles is unavailable", () => {
    const chapters = [chapter];

    for (const rendererWindow of [undefined, {}]) {
      vi.clearAllMocks();
      vi.stubGlobal("window", rendererWindow);

      syncNovelChapterMirrorsForActiveProject(chapters);
      removeNovelChapterMirrorsForActiveProject(chapters);

      expect(syncNovelChapterMirrors).toHaveBeenCalledWith(
        "default-project",
        chapters,
        undefined,
      );
      expect(removeNovelChapterMirrors).toHaveBeenCalledWith(
        "default-project",
        chapters,
        undefined,
      );
    }
  });
});
