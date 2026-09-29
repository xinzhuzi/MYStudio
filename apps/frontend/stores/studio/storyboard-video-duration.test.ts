// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
// @vitest-environment jsdom

/**
 * B1 h3DurationUs 真实时长回写(2026-09-29):
 * 摸底结论=桥回收链已有回写先例(writeback-consumer),其余能把视频落到分镜的
 * 通路是 store 层两个通用绑定动作(bindStoryboardMedia / bindMaterialToStoryboard,
 * 含视频素材路径)。本文件锁它们的时长回写契约:
 * - video 落账 + 探测合法值 → 写入;
 * - video 落账 + 假 probe 非法值(0/负/小数/NaN)→ 不得写入垃圾时长;
 * - video 换片而新片时长未知 → 旧片时长不得冒充(清空,静默降级名义时长);
 * - image/audio 落账 → 字段不参与(仅 video 镜有意义,types 口径)。
 */

import { afterEach, describe, expect, it } from "vitest";

import { useStudioStore } from "./studio-store";

afterEach(() => {
  useStudioStore.getState().resetStudioWorkflow();
});

function addShot(id: string, extra: Partial<Parameters<ReturnType<typeof useStudioStore.getState>["addStoryboard"]>[0]> = {}) {
  const store = useStudioStore.getState();
  return store.addStoryboard({
    id,
    episodeId: "chapter-001",
    prompt: "雨夜街巷",
    ...extra,
  });
}

describe("bindStoryboardMedia 视频时长回写", () => {
  it("video + 合法正整数微秒 → h3DurationUs 写入", () => {
    addShot("sb-video-1");
    useStudioStore.getState().bindStoryboardMedia("sb-video-1", {
      kind: "video",
      path: "project-file://project-1/remotion/outputs/shots/chapter-001/sb-video-1/h3/ambient_v1_1.mp4",
    }, 5_166_666);

    const shot = useStudioStore.getState().storyboards.find((item) => item.id === "sb-video-1");
    expect(shot?.mediaRef).toMatchObject({ kind: "video" });
    expect(shot?.h3DurationUs).toBe(5_166_666);
  });

  it.each([0, -5_166_666, 5.5, Number.NaN])("video + 假 probe 非法值 %p → 不写入时长", (probeResult) => {
    addShot("sb-video-illegal");
    useStudioStore.getState().bindStoryboardMedia("sb-video-illegal", {
      kind: "video",
      path: "project-file://project-1/remotion/outputs/shots/chapter-001/sb-video-illegal/h3/ambient_v1_1.mp4",
    }, probeResult);

    const shot = useStudioStore.getState().storyboards.find((item) => item.id === "sb-video-illegal");
    expect(shot?.mediaRef).toMatchObject({ kind: "video" });
    expect(shot?.h3DurationUs).toBeUndefined();
  });

  it("video 换片而新片时长未知 → 旧片时长清空(不得冒充新片真实时长)", () => {
    addShot("sb-video-rebind", { mediaRef: { kind: "video", path: "project-file://project-1/h3/old.mp4" } });
    useStudioStore.setState({
      storyboards: useStudioStore.getState().storyboards.map((item) =>
        item.id === "sb-video-rebind" ? { ...item, h3DurationUs: 4_000_000 } : item,
      ),
    });

    useStudioStore.getState().bindStoryboardMedia("sb-video-rebind", {
      kind: "video",
      path: "project-file://project-1/h3/new.mp4",
    });

    const shot = useStudioStore.getState().storyboards.find((item) => item.id === "sb-video-rebind");
    expect(shot?.mediaRef).toMatchObject({ kind: "video", path: "project-file://project-1/h3/new.mp4" });
    expect(shot?.h3DurationUs).toBeUndefined();
  });

  it("image 落账不触碰 h3DurationUs(仅 video 镜有意义)", () => {
    addShot("sb-image-bind");
    useStudioStore.getState().bindStoryboardMedia("sb-image-bind", {
      kind: "image",
      path: "project-file://project-1/frames/f1.png",
    }, 5_166_666);

    const shot = useStudioStore.getState().storyboards.find((item) => item.id === "sb-image-bind");
    expect(shot?.mediaRef).toMatchObject({ kind: "image" });
    expect(shot?.h3DurationUs).toBeUndefined();
  });
});

describe("bindMaterialToStoryboard 视频素材时长回写", () => {
  it("视频素材 + 合法时长 → 写入", () => {
    const store = useStudioStore.getState();
    const shotId = addShot("sb-material-video");
    const materialId = store.addMaterial({
      name: "h3-clip.mp4",
      localPath: "project-file://project-1/h3/material.mp4",
      size: 1024,
    });
    store.bindMaterialToStoryboard(shotId, materialId, 5_166_666);

    const shot = useStudioStore.getState().storyboards.find((item) => item.id === shotId);
    expect(shot?.mediaRef).toMatchObject({ kind: "video" });
    expect(shot?.h3DurationUs).toBe(5_166_666);
  });

  it.each([0, -1, 5.5])("视频素材 + 假 probe 非法值 %p → 不写入时长", (probeResult) => {
    const store = useStudioStore.getState();
    const shotId = addShot("sb-material-illegal");
    const materialId = store.addMaterial({
      name: "h3-bad.mp4",
      localPath: "project-file://project-1/h3/bad.mp4",
      size: 1024,
    });
    store.bindMaterialToStoryboard(shotId, materialId, probeResult);

    const shot = useStudioStore.getState().storyboards.find((item) => item.id === shotId);
    expect(shot?.mediaRef).toMatchObject({ kind: "video" });
    expect(shot?.h3DurationUs).toBeUndefined();
  });

  it("图片素材绑定 → 字段不参与", () => {
    const store = useStudioStore.getState();
    const shotId = addShot("sb-material-image");
    const materialId = store.addMaterial({
      name: "frame.png",
      localPath: "project-file://project-1/frames/frame.png",
      size: 2048,
    });
    store.bindMaterialToStoryboard(shotId, materialId, 5_166_666);

    const shot = useStudioStore.getState().storyboards.find((item) => item.id === shotId);
    expect(shot?.mediaRef).toMatchObject({ kind: "image" });
    expect(shot?.h3DurationUs).toBeUndefined();
  });
});
