// @vitest-environment jsdom
// 导演台 p3 成片导入器测试(1115 实弹 FR,App 侧):
// parse 容错落空表不抛错;匹配镜 fetch→writeBinary(exports/{章}/{镜}/daoyan-p3.mp4)
// →probeMedia→updateStoryboard 字段齐(mediaRef/h3DurationUs 整数化/state/stale);
// 浮点时长整数化;probe 失败 crypto.subtle 兜底 sha;同 path 同 sha 幂等零写回;
// sha 变 outputVersion+1;unmatched 只报告不落库(D-1);单镜失败不拦其余镜;
// base 解析失败抛可读错误;默认 deps 全链(stub fetch/projectFiles/studioRenderer+真 store)。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DAOYAN_P3_FILENAME,
  importDaoyanChapterVideos,
  parseDaoyanChapterVideosReply,
  type DaoyanVideoImportDeps,
} from "@/lib/comfyui/storyboard/daoyan-video-import";
import { buildProjectFileUrl } from "@/lib/upscale/project-file-url";
import { useStudioStore } from "@/stores/studio/studio-store";
import type { StoryboardItem } from "@/types/studio";

const PROBE_SHA = "probe-sha-0000000000000000000000000000000000000000000000000000000000aa";
const HELLO_SHA = "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"; // sha256("hello")

function storyboard(id: string, episodeId = "chapter-001"): StoryboardItem {
  return {
    id,
    episodeId,
    index: 1,
    trackId: `track-${id}`,
    trackKey: `track-${id}`,
    duration: 4,
    prompt: "p",
    videoDesc: "d",
  } as unknown as StoryboardItem;
}

function entry(segId: string): { seg_id: string; filename: string; subfolder: string; url: string; size: number; mtime: number } {
  return {
    seg_id: segId,
    filename: `p3-recavsr-${segId}.mp4`,
    subfolder: `video/导演台/chapter-001/${segId}`,
    url: `/view?filename=p3-recavsr-${segId}.mp4&type=output&subfolder=video%2F%E5%AF%BC%E6%BC%94%E5%8F%B0%2Fchapter-001%2F${segId}`,
    size: 1024,
    mtime: 1_760_000_000_000,
  };
}

const initialStudioState = useStudioStore.getState();

/** 注入式 deps 包:默认全通(mock 可逐测覆写),并记录调用。 */
function makeDeps(overrides: Partial<DaoyanVideoImportDeps> = {}) {
  const calls = {
    videoFetches: [] as Array<{ base: string; url: string }>,
    writeBinary: [] as Array<{ projectId: string; relativePath: string }>,
    updateStoryboard: [] as Array<{ id: string; updates: Partial<StoryboardItem> }>,
  };
  const bytes = new Uint8Array([1, 2, 3, 4]).buffer;
  const deps: DaoyanVideoImportDeps = {
    resolveBase: async () => "http://127.0.0.1:8188",
    fetchListReply: async () => ({ videos: [entry("sb-1"), entry("sb-2")], count: 2 }),
    fetchVideoBytes: async (base, video) => {
      calls.videoFetches.push({ base, url: video.url });
      return bytes;
    },
    writeBinary: async (projectId, relativePath) => {
      calls.writeBinary.push({ projectId, relativePath });
      return { success: true, url: buildProjectFileUrl(projectId, relativePath) };
    },
    probeMedia: async () => ({ sha256: PROBE_SHA, duration: 3.5 }),
    sha256Hex: async () => "fallback-sha",
    updateStoryboard: (id, updates) => {
      calls.updateStoryboard.push({ id, updates });
    },
    ...overrides,
  };
  return { deps, calls, bytes };
}

beforeEach(() => {
  useStudioStore.setState(initialStudioState, true);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("parseDaoyanChapterVideosReply(容错解析)", () => {
  it("畸形输入(非对象/videos 非数组/缺字段条目)容错落空表/剔除,不抛错", () => {
    expect(parseDaoyanChapterVideosReply(null)).toEqual([]);
    expect(parseDaoyanChapterVideosReply(42)).toEqual([]);
    expect(parseDaoyanChapterVideosReply("json")).toEqual([]);
    expect(parseDaoyanChapterVideosReply({})).toEqual([]);
    expect(parseDaoyanChapterVideosReply({ videos: "not-array" })).toEqual([]);
    expect(parseDaoyanChapterVideosReply({ videos: [{ nope: 1 }], error: "x" })).toEqual([]);
    // 缺 seg_id / 缺 url / 空串 → 条目剔除;唯一合法条目保留并归一
    expect(parseDaoyanChapterVideosReply({
      videos: [null, 7, { url: "/view?x=1" }, { seg_id: "sb-1" }, { seg_id: "", url: "/view" }, entry("sb-1")],
    })).toEqual([
      {
        segId: "sb-1",
        url: entry("sb-1").url,
        filename: entry("sb-1").filename,
        subfolder: entry("sb-1").subfolder,
        size: 1024,
        mtime: 1_760_000_000_000,
      },
    ]);
  });
});

describe("importDaoyanChapterVideos(导入链)", () => {
  it("匹配镜走 fetch→writeBinary(exports/{章}/{镜}/daoyan-p3.mp4)→probeMedia→updateStoryboard 字段齐", async () => {
    const { deps, calls } = makeDeps();
    const result = await importDaoyanChapterVideos({
      chapterId: "chapter-001",
      projectId: "proj-1",
      storyboards: [storyboard("sb-1"), storyboard("sb-2")],
      deps,
    });
    expect(result).toMatchObject({ updated: 2, unchanged: 0, skippedUnmatched: [], failed: [] });
    expect(calls.videoFetches).toEqual([
      { base: "http://127.0.0.1:8188", url: entry("sb-1").url },
      { base: "http://127.0.0.1:8188", url: entry("sb-2").url },
    ]);
    expect(calls.writeBinary).toEqual([
      { projectId: "proj-1", relativePath: `exports/chapter-001/sb-1/${DAOYAN_P3_FILENAME}` },
      { projectId: "proj-1", relativePath: `exports/chapter-001/sb-2/${DAOYAN_P3_FILENAME}` },
    ]);
    expect(calls.updateStoryboard).toHaveLength(2);
    expect(calls.updateStoryboard[0]).toEqual({
      id: "sb-1",
      updates: {
        mediaRef: {
          kind: "video",
          path: "project-file://proj-1/exports/chapter-001/sb-1/daoyan-p3.mp4",
          contentSha256: PROBE_SHA,
        },
        h3DurationUs: 3_500_000,
        state: "ready",
        stale: false,
        outputVersion: 1,
      },
    });
  });

  it("probe duration=4.916666(浮点)→h3DurationUs=4916666(整数化,非 frames×41666.67 浮点)", async () => {
    const { deps, calls } = makeDeps({ probeMedia: async () => ({ sha256: PROBE_SHA, duration: 4.916666 }) });
    await importDaoyanChapterVideos({
      chapterId: "chapter-001",
      projectId: "proj-1",
      storyboards: [storyboard("sb-1")],
      deps: { ...deps, fetchListReply: async () => ({ videos: [entry("sb-1")], count: 1 }) },
    });
    const updates = calls.updateStoryboard[0]!.updates;
    expect(Number.isInteger(updates.h3DurationUs)).toBe(true);
    expect(updates.h3DurationUs).toBe(4_916_666);
  });

  it("probe 失败→crypto.subtle.digest 兜底 sha 仍写入,h3DurationUs=undefined", async () => {
    const bytes = new TextEncoder().encode("hello").buffer;
    const calls: Array<{ id: string; updates: Partial<StoryboardItem> }> = [];
    const result = await importDaoyanChapterVideos({
      chapterId: "chapter-001",
      projectId: "proj-1",
      storyboards: [storyboard("sb-1")],
      deps: {
        resolveBase: async () => "http://127.0.0.1:8188",
        fetchListReply: async () => ({ videos: [entry("sb-1")], count: 1 }),
        fetchVideoBytes: async () => bytes,
        probeMedia: async () => null,
        writeBinary: async () => ({ success: true }),
        updateStoryboard: (id, updates) => {
          calls.push({ id, updates });
        },
        // sha256Hex 不注入:走默认 crypto.subtle.digest(环境已探明可用)
      },
    });
    expect(result.updated).toBe(1);
    expect(calls[0]!.updates.mediaRef).toEqual({
      kind: "video",
      path: "project-file://proj-1/exports/chapter-001/sb-1/daoyan-p3.mp4",
      contentSha256: HELLO_SHA,
    });
    expect(calls[0]!.updates.h3DurationUs).toBeUndefined();
  });

  it("重导同 path 且 probe sha 与现 mediaRef.contentSha256 相同→零 updateStoryboard 调用(幂等,不动 outputVersion)", async () => {
    const shot = {
      ...storyboard("sb-1"),
      outputVersion: 3,
      mediaRef: {
        kind: "video" as const,
        path: buildProjectFileUrl("proj-1", "exports/chapter-001/sb-1/daoyan-p3.mp4"),
        contentSha256: PROBE_SHA,
      },
    };
    const { deps, calls } = makeDeps();
    const result = await importDaoyanChapterVideos({
      chapterId: "chapter-001",
      projectId: "proj-1",
      storyboards: [shot as StoryboardItem],
      deps: { ...deps, fetchListReply: async () => ({ videos: [entry("sb-1")], count: 1 }) },
    });
    expect(result.updated).toBe(0);
    expect(result.unchanged).toBe(1);
    expect(calls.updateStoryboard).toHaveLength(0);
  });

  it("sha 变→outputVersion=旧+1", async () => {
    const shot = {
      ...storyboard("sb-1"),
      outputVersion: 2,
      mediaRef: {
        kind: "video" as const,
        path: buildProjectFileUrl("proj-1", "exports/chapter-001/sb-1/daoyan-p3.mp4"),
        contentSha256: "old-sha",
      },
    };
    const { deps, calls } = makeDeps();
    await importDaoyanChapterVideos({
      chapterId: "chapter-001",
      projectId: "proj-1",
      storyboards: [shot as StoryboardItem],
      deps: { ...deps, fetchListReply: async () => ({ videos: [entry("sb-1")], count: 1 }) },
    });
    expect(calls.updateStoryboard).toHaveLength(1);
    expect(calls.updateStoryboard[0]!.updates.outputVersion).toBe(3);
  });

  it("seg_id 无匹配分镜或 episodeId≠chapterId→入 skippedUnmatched、不 addStoryboard 不 updateStoryboard", async () => {
    const otherChapter = storyboard("sb-9", "chapter-999");
    useStudioStore.setState({ storyboards: [storyboard("sb-1"), otherChapter] as never });
    const before = useStudioStore.getState().storyboards.slice();
    const { deps, calls } = makeDeps({
      fetchListReply: async () => ({ videos: [entry("sb-gone"), entry("sb-9")], count: 2 }),
    });
    const result = await importDaoyanChapterVideos({
      chapterId: "chapter-001",
      projectId: "proj-1",
      storyboards: useStudioStore.getState().storyboards,
      deps,
    });
    expect(result.updated).toBe(0);
    expect(result.skippedUnmatched).toEqual([
      { segId: "sb-gone", reason: "分镜不在册" },
      { segId: "sb-9", reason: "分镜属他章(chapter-999)" },
    ]);
    expect(calls.videoFetches).toHaveLength(0);
    expect(calls.writeBinary).toHaveLength(0);
    expect(calls.updateStoryboard).toHaveLength(0);
    // store 分镜清单原样(D-1:unmatched 零落库)
    expect(useStudioStore.getState().storyboards).toEqual(before);
  });

  it("单镜 fetch 失败→failed[] 记行不抛错,其余镜继续", async () => {
    const { deps, calls } = makeDeps({
      fetchVideoBytes: async (_base, video) => {
        if (video.segId === "sb-1") throw new Error("下载炸了");
        return new Uint8Array([9]).buffer;
      },
    });
    const result = await importDaoyanChapterVideos({
      chapterId: "chapter-001",
      projectId: "proj-1",
      storyboards: [storyboard("sb-1"), storyboard("sb-2")],
      deps,
    });
    expect(result.updated).toBe(1);
    expect(result.failed).toEqual([{ segId: "sb-1", reason: "下载炸了" }]);
    expect(calls.updateStoryboard.map((row) => row.id)).toEqual(["sb-2"]);
  });

  it("引擎 base 解析失败→抛可读错误(入口 toast)", async () => {
    const { deps } = makeDeps({ resolveBase: async () => "" });
    await expect(importDaoyanChapterVideos({
      chapterId: "chapter-001",
      projectId: "proj-1",
      storyboards: [storyboard("sb-1")],
      deps,
    })).rejects.toThrow("引擎地址解析失败");
    const { deps: throwing } = makeDeps({
      resolveBase: async () => {
        throw new Error("引擎客户端不可用(仅桌面应用支持导入导演台视频)");
      },
    });
    await expect(importDaoyanChapterVideos({
      chapterId: "chapter-001",
      projectId: "proj-1",
      storyboards: [storyboard("sb-1")],
      deps: throwing,
    })).rejects.toThrow("引擎客户端不可用");
  });

  it("默认 deps 全链:fetch 清单/下载 URL 形状+projectFiles 桥+studioRenderer 探测+真 store 写回", async () => {
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.includes("/my_daoyan/chapter_videos")) {
        return new Response(JSON.stringify({ videos: [entry("sb-1")], count: 1 }), { status: 200 });
      }
      return new Response(new Uint8Array([7, 7, 7]), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const writeBinary = vi.fn(async () => ({ success: true as const }));
    vi.stubGlobal("projectFiles", { writeBinary });
    vi.stubGlobal("studioRenderer", {
      probeMedia: async () => ({ path: "x", sizeBytes: 3, mtimeMs: 1, sha256: PROBE_SHA, duration: 4.916666, streams: [] }),
    });
    useStudioStore.setState({ storyboards: [storyboard("sb-1")] as never });

    const result = await importDaoyanChapterVideos({
      chapterId: "chapter-001",
      projectId: "proj-1",
      storyboards: useStudioStore.getState().storyboards,
      deps: { resolveBase: async () => "http://127.0.0.1:8188" },
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0]![0])).toBe("http://127.0.0.1:8188/my_daoyan/chapter_videos?chapter=chapter-001");
    expect(String(fetchMock.mock.calls[1]![0])).toBe(`http://127.0.0.1:8188${entry("sb-1").url}`);
    expect(writeBinary).toHaveBeenCalledWith({
      projectId: "proj-1",
      relativePath: "exports/chapter-001/sb-1/daoyan-p3.mp4",
      bytes: expect.any(ArrayBuffer),
    });
    expect(result).toMatchObject({ updated: 1, unchanged: 0, failed: [] });
    const after = useStudioStore.getState().storyboards.find((item) => item.id === "sb-1")!;
    expect(after.mediaRef).toEqual({
      kind: "video",
      path: "project-file://proj-1/exports/chapter-001/sb-1/daoyan-p3.mp4",
      contentSha256: PROBE_SHA,
    });
    expect(after.h3DurationUs).toBe(4_916_666);
    expect(after.state).toBe("ready");
    expect(after.stale).toBe(false);
    expect(after.outputVersion).toBe(1);
  });
});
