// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import type { StoryboardItem, StoryboardKeyframe } from "@/types/studio";
import { useStudioStore } from "./studio-store";
import {
  buildKeyframeId,
  effectiveKeyframes,
  normalizeStoryboardKeyframes,
  validateStoryboardKeyframes,
} from "@/lib/studio/keyframes";

afterEach(() => {
  useStudioStore.getState().resetStudioWorkflow();
});

function shot(partial: Partial<StoryboardItem> = {}): StoryboardItem {
  return {
    id: partial.id ?? "sb-1",
    episodeId: "chapter-001",
    index: partial.index ?? 1,
    trackKey: "001-1",
    prompt: "船桩压住前景。",
    videoDesc: "船桩压住前景。",
    duration: 12,
    durationTarget: 12,
    assetIds: [],
    shouldGenerateImage: true,
    state: "idle",
    ...partial,
  } as StoryboardItem;
}

function frame(n: number, inUs: number, path?: string): StoryboardKeyframe {
  return {
    frameId: buildKeyframeId("sb-1", n),
    mediaRef: { kind: "image" as const, path: path ?? `project-file://p/kf-${n}.png` },
    inUs,
    origin: { kind: "generated" },
  };
}

describe("keyframes 纯函数(不变式校验)", () => {
  it("接受合法 2 帧序列", () => {
    expect(validateStoryboardKeyframes([frame(1, 0), frame(2, 6000)], { shotDurationUs: 12000 })).toEqual([]);
  });

  it("拒绝:帧数越界/非严格递增/首帧非0/末帧超镜时长/非法协议", () => {
    expect(validateStoryboardKeyframes([])).toContain("帧数须在 1..4,实为 0");
    expect(
      validateStoryboardKeyframes([frame(1, 0), frame(2, 0), frame(3, 1000)]).join(),
    ).toContain("未严格递增");
    expect(validateStoryboardKeyframes([frame(1, 500)]).join()).toContain("首帧 inUs 须为 0");
    expect(
      validateStoryboardKeyframes([frame(1, 0), frame(2, 13000)], { shotDurationUs: 12000 }).join(),
    ).toContain("须小于镜时长");
    expect(
      validateStoryboardKeyframes([frame(1, 0, "data:image/png;base64,xxx")]).join(),
    ).toContain("受管协议纪律");
    expect(
      validateStoryboardKeyframes([frame(1, 0), frame(1, 3000)]).join(),
    ).toContain("frameId 重复");
  });

  it("allowEmptySlots 放行规划空槽,其余来源拒绝空 path", () => {
    const empty = { ...frame(1, 0), mediaRef: { kind: "image" as const, path: "" } };
    expect(validateStoryboardKeyframes([empty]).join()).toContain("缺 mediaRef.path");
    expect(
      validateStoryboardKeyframes([empty], { allowEmptySlots: true }),
    ).toEqual([]);
  });

  it("effectiveKeyframes:无 keyframes 时由 mediaRef 合成单帧;全空返回空", () => {
    const single = effectiveKeyframes({ mediaRef: { kind: "image" as const, path: "project-file://p/a.png" } });
    expect(single).toHaveLength(1);
    expect(single[0].inUs).toBe(0);
    expect(effectiveKeyframes({})).toEqual([]);
    const two = effectiveKeyframes({ keyframes: [frame(1, 0), frame(2, 4000)] });
    expect(two).toHaveLength(2);
  });

  it("normalize 仅排序不修数(首帧非0留给校验拒绝)", () => {
    const sorted = normalizeStoryboardKeyframes([frame(2, 6000), frame(1, 999)]);
    expect(sorted.map((item) => item.inUs)).toEqual([999, 6000]);
    expect(validateStoryboardKeyframes(sorted).join()).toContain("首帧 inUs 须为 0");
  });
});

describe("setStoryboardKeyframes(唯一写入口)", () => {
  it("写入合法序列:I1 首帧镜像 mediaRef + 媒体任务轨迹", () => {
    const store = useStudioStore.getState();
    store.replaceStoryboardsForEpisode("chapter-001", [shot()]);
    useStudioStore.getState().setStoryboardKeyframes(
      "sb-1",
      [frame(1, 0, "project-file://p/a.png"), frame(2, 6000, "project-file://p/b.png")],
      "backfill",
    );
    const updated = useStudioStore.getState().storyboards.find((item) => item.id === "sb-1");
    expect(updated?.keyframes).toHaveLength(2);
    expect(updated?.mediaRef?.path).toBe("project-file://p/a.png");
    // 媒体落地即 ready(与生图回写同语义;回接首跑实证缺口)
    expect(updated?.state).toBe("ready");
    const tasks = useStudioStore.getState().mediaTasks.filter((task) => task.targetId === "sb-1");
    expect(tasks.length).toBeGreaterThan(0);
    expect(tasks[tasks.length - 1].outputRefs).toContain("project-file://p/b.png");
  });

  it("非法序列抛错且不落库", () => {
    useStudioStore.getState().replaceStoryboardsForEpisode("chapter-001", [shot()]);
    expect(() =>
      useStudioStore.getState().setStoryboardKeyframes("sb-1", [frame(1, 500)], "edit"),
    ).toThrow("首帧 inUs 须为 0");
    const updated = useStudioStore.getState().storyboards.find((item) => item.id === "sb-1");
    expect(updated?.keyframes).toBeUndefined();
  });

  it("plan 来源允许空槽且不覆盖既有 mediaRef", () => {
    useStudioStore.getState().replaceStoryboardsForEpisode("chapter-001", [
      shot({ mediaRef: { kind: "image" as const, path: "project-file://p/existing.png" } }),
    ]);
    useStudioStore.getState().setStoryboardKeyframes(
      "sb-1",
      [
        { frameId: buildKeyframeId("sb-1", 1), mediaRef: { kind: "image" as const, path: "" }, inUs: 0 },
        { frameId: buildKeyframeId("sb-1", 2), mediaRef: { kind: "image" as const, path: "" }, inUs: 6000 },
      ],
      "plan",
    );
    const updated = useStudioStore.getState().storyboards.find((item) => item.id === "sb-1");
    expect(updated?.keyframes).toHaveLength(2);
    expect(updated?.mediaRef?.path).toBe("project-file://p/existing.png");
  });

  it("bindStoryboardMedia 换图同步首帧(防双源分叉)", () => {
    useStudioStore.getState().replaceStoryboardsForEpisode("chapter-001", [
      shot({ mediaRef: { kind: "image" as const, path: "project-file://p/old.png" } }),
    ]);
    useStudioStore.getState().setStoryboardKeyframes(
      "sb-1",
      [frame(1, 0, "project-file://p/old.png"), frame(2, 6000, "project-file://p/b.png")],
      "backfill",
    );
    useStudioStore.getState().bindStoryboardMedia("sb-1", {
      kind: "image",
      path: "project-file://p/up4x-new.png",
    });
    const updated = useStudioStore.getState().storyboards.find((item) => item.id === "sb-1");
    expect(updated?.mediaRef?.path).toBe("project-file://p/up4x-new.png");
    expect(updated?.keyframes?.[0].mediaRef.path).toBe("project-file://p/up4x-new.png");
    expect(updated?.keyframes?.[1].mediaRef.path).toBe("project-file://p/b.png");
  });
});
