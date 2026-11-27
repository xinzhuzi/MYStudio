// @vitest-environment jsdom
// Task 9(R10/D22):useLibraryDramaScript 单测——「无 App 内草稿时读漫剧剧本库文件
// (novel/drama/<章>_漫剧.md)」的回落读取 hook(真源自 AssetsTab effect 抽出,AssetsTab/ScriptTab 共用)。
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const readTextMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/bridge/project-files", () => ({
  getProjectFilesBridge: () => ({ readText: readTextMock }),
}));

import { useLibraryDramaScript } from "./use-library-drama-script";
import { useProjectStore } from "@/stores/project/project-store";

describe("useLibraryDramaScript", () => {
  beforeEach(() => {
    readTextMock.mockReset();
    useProjectStore.setState({ activeProjectId: "proj-drama" });
  });

  afterEach(() => {
    cleanup();
    useProjectStore.setState({ activeProjectId: "default-project" });
  });

  it("启用且读到文本:text 为该文本、failed false,按 novel/drama/<章>_漫剧.md 路径读桥", async () => {
    readTextMock.mockResolvedValue({ success: true, text: "# 剧本库正文\n\n△动作。" });

    const { result } = renderHook(() =>
      useLibraryDramaScript({ chapterId: "chapter-001", enabled: true }),
    );

    await waitFor(() => {
      expect(result.current.text).toBe("# 剧本库正文\n\n△动作。");
    });
    expect(result.current.failed).toBe(false);
    expect(readTextMock).toHaveBeenCalledTimes(1);
    expect(readTextMock).toHaveBeenCalledWith({
      projectId: "proj-drama",
      relativePath: "novel/drama/chapter-001_漫剧.md",
    });
  });

  it("桥读取失败:text null、failed true", async () => {
    readTextMock.mockResolvedValue({ success: false, error: "ENOENT" });

    const { result } = renderHook(() =>
      useLibraryDramaScript({ chapterId: "chapter-002", enabled: true }),
    );

    await waitFor(() => {
      expect(result.current.failed).toBe(true);
    });
    expect(result.current.text).toBeNull();
  });

  it("enabled false:不调用读桥,text/failed 保持空态", () => {
    const { result } = renderHook(() =>
      useLibraryDramaScript({ chapterId: "chapter-003", enabled: false }),
    );

    expect(readTextMock).not.toHaveBeenCalled();
    expect(result.current.text).toBeNull();
    expect(result.current.failed).toBe(false);
  });
});
