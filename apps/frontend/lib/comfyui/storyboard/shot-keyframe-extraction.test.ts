// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import {
  buildShotKeyframeExtractRequest,
  keyframeOutputDir,
  mergeExtractedKeyframes,
  nextKeyframeFrameId,
  pickEvenly,
  sanitizePathSegment,
  saveVideoFramesAsKeyframes,
} from "./shot-keyframe-extraction";
import { validateStoryboardKeyframes } from "@/lib/studio/keyframes";
import type { StoryboardItem, StoryboardKeyframe } from "@/types/studio";

function videoShot(overrides: Partial<StoryboardItem> = {}): StoryboardItem {
  return {
    id: "sb-1",
    index: 1,
    trackKey: "001-1",
    episodeId: "chapter-001",
    duration: 6,
    durationTarget: 6,
    prompt: "p",
    videoDesc: "v",
    associateAssetsNames: [],
    mediaRef: { kind: "video", path: "project-file://p1/remotion/outputs/shots/chapter-001/sb-1/h3/ambient_v1_1.mp4" },
    ...overrides,
  } as unknown as StoryboardItem;
}

function frame(id: number, inUs: number, path = `project-file://p1/f${id}.jpg`): StoryboardKeyframe {
  return { frameId: `sb-1-kf-${id}`, mediaRef: { kind: "image", path }, inUs };
}

describe("buildShotKeyframeExtractRequest", () => {
  it("视频镜 project-file:// → 请求带安全目录与词干", () => {
    const request = buildShotKeyframeExtractRequest({
      projectId: "p1",
      storyboard: videoShot(),
      mode: { kind: "single", timestampS: 2.5 },
    });
    expect(request).not.toBeNull();
    expect(request?.videoUrl).toBe("project-file://p1/remotion/outputs/shots/chapter-001/sb-1/h3/ambient_v1_1.mp4");
    expect(request?.relativeOutDir).toBe(keyframeOutputDir(videoShot()));
    expect(request?.fileStem).toBe("sb-1");
  });

  it("非视频/跨项目/无项目 → null(调用方走禁用态)", () => {
    expect(buildShotKeyframeExtractRequest({ projectId: null, storyboard: videoShot(), mode: { kind: "single", timestampS: 1 } })).toBeNull();
    expect(buildShotKeyframeExtractRequest({
      projectId: "p1",
      storyboard: videoShot({ mediaRef: { kind: "image", path: "project-file://p1/a.jpg" } }),
      mode: { kind: "single", timestampS: 1 },
    })).toBeNull();
    expect(buildShotKeyframeExtractRequest({
      projectId: "p2",
      storyboard: videoShot(),
      mode: { kind: "single", timestampS: 1 },
    })).toBeNull();
    expect(buildShotKeyframeExtractRequest({
      projectId: "p1",
      storyboard: videoShot({ mediaRef: { kind: "video", path: "/abs/path.mp4" } }),
      mode: { kind: "single", timestampS: 1 },
    })).toBeNull();
  });

  it("sanitizePathSegment:中文/特殊字符镜 id 净化", () => {
    expect(sanitizePathSegment("镜 0１/两")).toMatch(/^[A-Za-z0-9._-]+$/);
    expect(sanitizePathSegment("")).toBe("shot");
  });
});

describe("pickEvenly", () => {
  it("9 取 4 首尾必含;≤keep 全量", () => {
    const items = [1, 2, 3, 4, 5, 6, 7, 8, 9];
    expect(pickEvenly(items, 4)[0]).toBe(1);
    expect(pickEvenly(items, 4).at(-1)).toBe(9);
    expect(pickEvenly(items, 4)).toHaveLength(4);
    expect(pickEvenly([1, 2, 3], 4)).toEqual([1, 2, 3]);
  });
});

describe("mergeExtractedKeyframes", () => {
  it("替换模式(自动抽帧 3):整批重建,首帧 inUs=0,序列过校验", () => {
    const merged = mergeExtractedKeyframes({
      storyboardId: "sb-1",
      existing: [frame(1, 0), frame(2, 3_000_000)],
      extracted: [
        { url: "project-file://p1/k1.jpg", timestampS: 0 },
        { url: "project-file://p1/k2.jpg", timestampS: 3 },
        { url: "project-file://p1/k3.jpg", timestampS: 5.94 },
      ],
      durationLimitS: 6,
      replace: true,
    });
    expect(merged.frames).toHaveLength(3);
    expect(merged.frames[0]?.inUs).toBe(0);
    expect(merged.frames.map((item) => item.mediaRef.path)).toEqual([
      "project-file://p1/k1.jpg",
      "project-file://p1/k2.jpg",
      "project-file://p1/k3.jpg",
    ]);
    expect(validateStoryboardKeyframes(merged.frames, { shotDurationUs: 6_000_000 })).toEqual([]);
  });

  it("替换模式 5/9 帧档:候选均匀挑 ≤4,丢弃数如实(末帧带尾保护,t<镜长)", () => {
    // 与主进程 sampleUniformTimestamps 同口径:末帧 = duration - min(50ms, 1%)
    const extracted = Array.from({ length: 9 }, (_, index) => ({
      url: `project-file://p1/k${index}.jpg`,
      timestampS: (5.94 * index) / 8,
    }));
    const merged = mergeExtractedKeyframes({
      storyboardId: "sb-1",
      existing: [],
      extracted,
      durationLimitS: 6,
      replace: true,
    });
    expect(merged.frames).toHaveLength(4);
    expect(merged.skipped).toBe(5);
    expect(validateStoryboardKeyframes(merged.frames, { shotDurationUs: 6_000_000 })).toEqual([]);
  });

  it("追加模式(存为关键帧):空序列首帧入 0;有帧按时间戳接尾", () => {
    const fresh = mergeExtractedKeyframes({
      storyboardId: "sb-1",
      existing: [],
      extracted: [{ url: "project-file://p1/k1.jpg", timestampS: 2.1 }],
      durationLimitS: 6,
      replace: false,
    });
    expect(fresh.frames).toHaveLength(1);
    expect(fresh.frames[0]?.inUs).toBe(0);

    const appended = mergeExtractedKeyframes({
      storyboardId: "sb-1",
      existing: [frame(1, 0)],
      extracted: [{ url: "project-file://p1/k2.jpg", timestampS: 3.2 }],
      durationLimitS: 6,
      replace: false,
    });
    expect(appended.frames).toHaveLength(2);
    expect(appended.frames[1]?.inUs).toBe(3_200_000);
    expect(appended.frames[1]?.frameId).toBe("sb-1-kf-2");
    expect(validateStoryboardKeyframes(appended.frames, { shotDurationUs: 6_000_000 })).toEqual([]);
  });

  it("追加模式已满 4 帧:返回原序列并标记 full", () => {
    const existing = [frame(1, 0), frame(2, 1_000_000), frame(3, 2_000_000), frame(4, 3_000_000)];
    const merged = mergeExtractedKeyframes({
      storyboardId: "sb-1",
      existing,
      extracted: [{ url: "project-file://p1/k5.jpg", timestampS: 4 }],
      durationLimitS: 6,
      replace: false,
    });
    expect(merged.frames).toBe(existing);
    expect(merged.full).toBe(true);
    expect(merged.skipped).toBe(1);
  });

  it("追加时刻越镜长:帧被跳过(末帧须小于镜时长)", () => {
    const merged = mergeExtractedKeyframes({
      storyboardId: "sb-1",
      existing: [frame(1, 0)],
      extracted: [{ url: "project-file://p1/k2.jpg", timestampS: 6.5 }],
      durationLimitS: 6,
      replace: false,
    });
    expect(merged.frames).toHaveLength(1);
    expect(merged.skipped).toBe(1);
  });

  it("nextKeyframeFrameId 沿用最大后缀+1", () => {
    expect(nextKeyframeFrameId([frame(1, 0), frame(7, 1)], "sb-1")).toBe("sb-1-kf-8");
    expect(nextKeyframeFrameId([], "sb-1")).toBe("sb-1-kf-1");
  });
});

describe("saveVideoFramesAsKeyframes(编排,依赖全注入)", () => {
  function makeDeps(frames: StoryboardKeyframe[]) {
    const shot = videoShot({ keyframes: frames });
    const setKeyframes = vi.fn();
    return {
      shot,
      setKeyframes,
      deps: {
        bridge: {
          extract: vi.fn(async () => ({
            schemaVersion: 1 as const,
            success: true,
            durationS: 6,
            frames: [{ url: "project-file://p1/k1.jpg", timestampS: 2.5 }],
          })),
        },
        getStoryboard: () => shot,
        setKeyframes,
      },
    };
  }

  it("成功链:抽帧→合并→setStoryboardKeyframes(edit)", async () => {
    const { deps, setKeyframes } = makeDeps([]);
    const result = await saveVideoFramesAsKeyframes(
      { projectId: "p1", storyboard: videoShot(), mode: { kind: "single", timestampS: 2.5 } },
      deps,
    );
    expect(result.ok).toBe(true);
    expect(result.added).toBe(1);
    expect(setKeyframes).toHaveBeenCalledWith("sb-1", expect.anything(), "edit");
    const written = setKeyframes.mock.calls[0]?.[1] as StoryboardKeyframe[];
    expect(written[0]?.mediaRef.path).toBe("project-file://p1/k1.jpg");
  });

  it("桥失败:ok=false+大白话,不抛出不落库", async () => {
    const { deps, setKeyframes } = makeDeps([]);
    const failing = {
      ...deps,
      bridge: { extract: vi.fn(async () => ({ schemaVersion: 1 as const, success: false, frames: [], message: "视频文件不存在或已被移动" })) },
    };
    const result = await saveVideoFramesAsKeyframes(
      { projectId: "p1", storyboard: videoShot(), mode: { kind: "single", timestampS: 1 } },
      failing,
    );
    expect(result.ok).toBe(false);
    expect(result.message).toContain("不存在");
    expect(setKeyframes).not.toHaveBeenCalled();
  });

  it("无桥/跨项目视频:ok=false(面板据此禁用按钮)", async () => {
    const result = await saveVideoFramesAsKeyframes(
      { projectId: "p1", storyboard: videoShot(), mode: { kind: "single", timestampS: 1 } },
      { bridge: null },
    );
    expect(result.ok).toBe(false);
  });
});
