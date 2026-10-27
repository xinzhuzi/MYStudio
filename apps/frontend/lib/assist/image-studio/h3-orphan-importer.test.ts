// @vitest-environment jsdom
// 孤儿导入器测试(PRD 10-27-storyboard-h3-dual-channel §14.3.4):
// 扫描=一次递归 IPC/文件名白名单异名计数/孤儿判定(已挂不重复)/unmatched 报告;
// 导入=逐字段同构 defaultApplyVideoToStoryboard/id 尾号逐片重数/幂等(文件名指纹)/
// 升序导入/坏文件名零导入零抛错/不动 mediaRef。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  importH3OrphanVideos,
  scanH3OrphanVideos,
  type H3OrphanFile,
} from "@/lib/assist/image-studio/h3-orphan-importer";
import { buildProjectFileUrl } from "@/lib/upscale/project-file-url";
import { useStudioStore } from "@/stores/studio/studio-store";
import type { StoryboardItem } from "@/types/studio";

function storyboard(id: string, episodeId = "chapter-001"): StoryboardItem {
  return {
    id,
    episodeId,
    index: 1,
    trackId: `track-${id}`,
    duration: 4,
    prompt: "p",
    videoDesc: "d",
  } as unknown as StoryboardItem;
}

/** 构造孤儿文件字面量(相对路径与文件名同源自洽)。 */
function orphan(shotId: string, policy: string, version: number, timestamp: number, episodeId = "chapter-001"): H3OrphanFile {
  const filename = `${policy}_v${version}_${timestamp}.mp4`;
  return {
    relativePath: `remotion/outputs/shots/${episodeId}/${shotId}/h3/${filename}`,
    filename,
    policy,
    version,
    timestamp,
  };
}

const initialStudioState = useStudioStore.getState();

function stubList(files: string[]): void {
  vi.stubGlobal("projectFiles", {
    list: vi.fn(async () => ({ success: true as const, files })),
  });
}

beforeEach(() => {
  useStudioStore.setState(initialStudioState, true);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("scanH3OrphanVideos(扫描+对拍)", () => {
  it("一次递归 IPC 拿全树:list 恰一次且 relativePath=remotion/outputs/shots;空树零报告", async () => {
    stubList([]);
    const result = await scanH3OrphanVideos({ projectId: "proj-1", storyboards: [storyboard("sb-1")] });
    const list = (globalThis as { projectFiles?: { list: unknown } }).projectFiles?.list as ReturnType<typeof vi.fn>;
    expect(list).toHaveBeenCalledTimes(1);
    expect(list).toHaveBeenCalledWith({ projectId: "proj-1", relativePath: "remotion/outputs/shots" });
    expect(result.reports).toEqual([]);
    expect(result.unmatched).toEqual([]);
    expect(result.skippedFilenames).toBe(0);
  });

  it("文件名白名单:异名跳过计数;非 {章}/{镜}/h3/ 形状整条忽略;孤儿判定=已挂同 relativePath 不重复", async () => {
    useStudioStore.setState({
      videoCandidates: [
        {
          id: "h3-sb-1-1",
          trackId: "track-sb-1",
          provider: "h3-comfyui",
          filePath: buildProjectFileUrl("proj-1", "remotion/outputs/shots/chapter-001/sb-1/h3/ambient_v2_2000.mp4"),
          meta: { policy: "ambient", bridgeItemId: 7, originProjectId: "proj-1", storyboardId: "sb-1" },
          state: "ready",
          createdAt: 1,
        },
      ],
    });
    stubList([
      "chapter-001/sb-1/h3/ambient_v1_1000.mp4", // 孤儿
      "chapter-001/sb-1/h3/ambient_v2_2000.mp4", // 已挂候选 → 非孤儿
      "chapter-001/sb-1/h3/随便起的名.mp4", // 异名 → 白名单挡下计数
      "chapter-001/sb-1/other/ambient_v1_5.mp4", // 非 h3/ 直下形状 → 非 H3 片域忽略
    ]);
    const result = await scanH3OrphanVideos({ projectId: "proj-1", storyboards: [storyboard("sb-1")] });
    expect(result.skippedFilenames).toBe(1);
    expect(result.reports).toHaveLength(1);
    expect(result.reports[0]!.shotId).toBe("sb-1");
    expect(result.reports[0]!.episodeId).toBe("chapter-001");
    expect(result.reports[0]!.orphans).toEqual([
      {
        relativePath: "remotion/outputs/shots/chapter-001/sb-1/h3/ambient_v1_1000.mp4",
        filename: "ambient_v1_1000.mp4",
        policy: "ambient",
        version: 1,
        timestamp: 1000,
      },
    ]);
    // 跨项目已挂候选不算已挂(照消费器 alreadyAdded 口径):同 relativePath 属他项目 → 仍孤儿
    useStudioStore.setState({
      videoCandidates: [
        {
          id: "h3-sb-1-1",
          trackId: "track-sb-1",
          provider: "h3-comfyui",
          filePath: buildProjectFileUrl("proj-2", "remotion/outputs/shots/chapter-001/sb-1/h3/ambient_v1_1000.mp4"),
          meta: { policy: "ambient", bridgeItemId: 7, originProjectId: "proj-2", storyboardId: "sb-1" },
          state: "ready",
          createdAt: 1,
        },
      ],
    });
    const crossProject = await scanH3OrphanVideos({ projectId: "proj-1", storyboards: [storyboard("sb-1")] });
    // 候选清单已被替换:两片均无本项目挂载(v2 原挂载候选不在了),v1 虽有他项目同路径候选仍孤儿
    expect(crossProject.reports[0]!.orphans.map((file) => file.filename)).toEqual([
      "ambient_v1_1000.mp4",
      "ambient_v2_2000.mp4",
    ]);
  });

  it("unmatched 报告:分镜已删/他章分组列文件数,禁静默", async () => {
    stubList([
      "chapter-001/sb-gone/h3/ambient_v1_1000.mp4",
      "chapter-999/sb-1/h3/ambient_v1_1000.mp4",
    ]);
    const result = await scanH3OrphanVideos({ projectId: "proj-1", storyboards: [storyboard("sb-1")] });
    expect(result.reports).toEqual([]);
    expect(result.unmatched).toEqual([
      { episodeId: "chapter-001", shotId: "sb-gone", files: 1 },
      { episodeId: "chapter-999", shotId: "sb-1", files: 1 },
    ]);
  });

  it("桥不可用/列举失败抛错(入口自行降级)", async () => {
    await expect(scanH3OrphanVideos({ projectId: "proj-1", storyboards: [] })).rejects.toThrow("项目文件桥不可用");
    vi.stubGlobal("projectFiles", { list: vi.fn(async () => ({ success: false as const, error: "目录没了" })) });
    await expect(scanH3OrphanVideos({ projectId: "proj-1", storyboards: [] })).rejects.toThrow("目录没了");
  });
});

describe("importH3OrphanVideos(导入为候选)", () => {
  it("逐字段同构断言+升序导入+id 尾号逐片重数(乱序入参按版本升挂)", async () => {
    const files = [
      orphan("sb-1", "ambient", 2, 2000),
      orphan("sb-2", "full", 1, 3000),
      orphan("sb-1", "ambient", 1, 1000),
    ];
    const { imported, skipped } = await importH3OrphanVideos({
      projectId: "proj-1",
      storyboards: [storyboard("sb-1"), storyboard("sb-2")],
      files,
    });
    expect(imported).toBe(3);
    expect(skipped).toBe(0);
    const candidates = useStudioStore.getState().videoCandidates;
    expect(candidates).toHaveLength(3);
    // sb-1 两片按 version 升序:尾号 1=v1,尾号 2=v2;sb-2 独立计数
    expect(candidates[0]).toMatchObject({
      id: "h3-sb-1-1",
      trackId: "track-sb-1",
      provider: "h3-comfyui",
      state: "ready",
      filePath: buildProjectFileUrl("proj-1", "remotion/outputs/shots/chapter-001/sb-1/h3/ambient_v1_1000.mp4"),
      createdAt: 1000,
      meta: {
        policy: "ambient",
        bridgeItemId: "orphan:ambient_v1_1000.mp4",
        originProjectId: "proj-1",
        storyboardId: "sb-1",
      },
    });
    expect(candidates[1]).toMatchObject({
      id: "h3-sb-1-2",
      filePath: buildProjectFileUrl("proj-1", "remotion/outputs/shots/chapter-001/sb-1/h3/ambient_v2_2000.mp4"),
      createdAt: 2000,
      meta: { bridgeItemId: "orphan:ambient_v2_2000.mp4", storyboardId: "sb-1" },
    });
    expect(candidates[2]).toMatchObject({
      id: "h3-sb-2-1",
      trackId: "track-sb-2",
      meta: { policy: "full", bridgeItemId: "orphan:full_v1_3000.mp4", storyboardId: "sb-2" },
    });
  });

  it("幂等=文件名指纹:二次导入零新增(全部 skipped)", async () => {
    const files = [orphan("sb-1", "ambient", 1, 1000), orphan("sb-1", "ambient", 2, 2000)];
    const input = { projectId: "proj-1", storyboards: [storyboard("sb-1")], files };
    const first = await importH3OrphanVideos(input);
    expect(first).toEqual({ imported: 2, skipped: 0 });
    const second = await importH3OrphanVideos(input);
    expect(second).toEqual({ imported: 0, skipped: 2 });
    expect(useStudioStore.getState().videoCandidates).toHaveLength(2);
  });

  it("坏文件名/路径形状不合/镜不在册:零导入零抛错,计入 skipped", async () => {
    const badName: H3OrphanFile = {
      relativePath: "remotion/outputs/shots/chapter-001/sb-1/h3/坏名.mp4",
      filename: "坏名.mp4",
      policy: "ambient",
      version: 1,
      timestamp: 1000,
    };
    const badPath: H3OrphanFile = {
      relativePath: "media/other/sb-1/h3/ambient_v1_1000.mp4",
      filename: "ambient_v1_1000.mp4",
      policy: "ambient",
      version: 1,
      timestamp: 1000,
    };
    const mismatch: H3OrphanFile = {
      relativePath: "remotion/outputs/shots/chapter-001/sb-1/h3/ambient_v1_1000.mp4",
      filename: "ambient_v1_9999.mp4",
      policy: "ambient",
      version: 1,
      timestamp: 9999,
    };
    const goneShot = orphan("sb-gone", "ambient", 1, 1000);
    const { imported, skipped } = await importH3OrphanVideos({
      projectId: "proj-1",
      storyboards: [storyboard("sb-1")],
      files: [badName, badPath, mismatch, goneShot],
    });
    expect(imported).toBe(0);
    expect(skipped).toBe(4);
    expect(useStudioStore.getState().videoCandidates).toHaveLength(0);
  });

  it("只挂候选:不动 mediaRef/h3DurationUs/h3AudioPolicy/audioMix(§14.3.3 设为当前候令)", async () => {
    const shot = {
      ...storyboard("sb-1"),
      mediaRef: { kind: "image" as const, path: "project-file://proj-1/frame.png" },
      audioMix: "tts-stack" as const,
    };
    useStudioStore.setState({ storyboards: [shot] as never });
    await importH3OrphanVideos({
      projectId: "proj-1",
      storyboards: [shot],
      files: [orphan("sb-1", "ambient", 1, 1000)],
    });
    const after = useStudioStore.getState().storyboards[0]!;
    expect(after.mediaRef).toEqual({ kind: "image", path: "project-file://proj-1/frame.png" });
    expect(after.audioMix).toBe("tts-stack");
    expect(after.h3DurationUs).toBeUndefined();
    expect(after.h3AudioPolicy).toBeUndefined();
  });
});
