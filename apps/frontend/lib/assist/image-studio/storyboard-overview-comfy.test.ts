// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

import { describe, expect, it } from "vitest";

import {
  shotPreview2Name,
  buildStoryboardOverviewWorkflow,
  shotDescription,
  shotLabel,
  shotMediaStatus,
  shotPreviewName,
} from "@/lib/assist/image-studio/storyboard-overview-comfy";
import type { StoryboardItem } from "@/types/studio";

function shot(id: string, index: number, episodeId = "chapter-001", overrides: Partial<StoryboardItem> = {}): StoryboardItem {
  return {
    id,
    episodeId,
    index,
    duration: 2,
    videoDesc: `第${index}镜`,
    ...overrides,
  } as StoryboardItem;
}

describe("章节分镜总览图生成器(批7)", () => {
  it("12 镜:网格布局(10/列=两列)、id/label/状态齐、报告可读", () => {
    const storyboards = Array.from({ length: 12 }, (_, i) => shot(`sb-${i + 1}`, i + 1));
    const result = buildStoryboardOverviewWorkflow(storyboards);
    const ui = result.ui as { nodes: Array<{ id: number; title?: string; pos: [number, number]; widgets_values: unknown[] }>; groups: unknown[] };

    expect(result.report).toEqual({ shots: 12, chapters: ["chapter-001"], name: "分镜总览 · chapter-001" });
    expect(ui.nodes).toHaveLength(12);
    // 第 11 镜跨列(x 增量=NODE_WIDTH+COLUMN_GAP=450)
    expect(ui.nodes[10].pos[0]).toBeGreaterThan(ui.nodes[0].pos[0]);
    // widget 序=shot_id/label/desc/status
    // 09-14 裁定:镜节点只留标号(label=纯标号,描述只住隐藏 widgets)
    expect(ui.nodes[0].widgets_values).toEqual(["sb-1", "S01", "第1镜", "图— 视频—"]);
    // 09-12 标题栏=镜号(固定节点不回落类型名)
    expect(ui.nodes[0].title).toBe("S01");
    expect(ui.groups).toHaveLength(1);
  });

  it("媒体状态:图✓/视频✓ 按 mediaRef 判定;label 截断 14 字", () => {
    expect(shotMediaStatus(shot("a", 1, "e", { mediaRef: { kind: "image", path: "p.png" } as never }))).toBe("图✓ 视频—");
    expect(shotLabel(shot("a", 1, "e", { videoDesc: "一二三四五六七八九十一二三十四五六" }))).toBe("S01");
  });

  it("图片带:带图镜写 myPreview(名按 shot id 净化),无图镜不写键;描述截断 80 字", () => {
    const withImage = shot("scene:S 01/02", 1, "chapter-001", { mediaRef: { kind: "image", path: "p.png" } as never });
    expect(shotPreviewName(withImage)).toBe("my-shot-scene_S_01_02.jpg");
    expect(shotPreviewName(shot("a", 1, "e", { mediaRef: { kind: "video", path: "v.mp4" } as never }))).toBe("");
    expect(shotPreviewName(shot("a", 1))).toBe("");

    const nodes = (buildStoryboardOverviewWorkflow([withImage, shot("b", 2)]).ui as {
      nodes: Array<{ properties: Record<string, unknown> }>;
    }).nodes;
    expect(nodes[0].properties.myPreview).toBe("my-shot-scene_S_01_02.jpg");
    expect("myPreview" in nodes[1].properties).toBe(false);
    // 双帧(09-14 用户裁定:每镜多张图都上屏):帧2 名 -k2.jpg;无帧2=空串
    expect(shotPreview2Name({ ...withImage, keyframes: [
      { mediaRef: withImage.mediaRef },
      { mediaRef: { kind: "image", path: "project-file://b.png" } },
    ] } as never)).toBe("my-shot-scene_S_01_02-k2.jpg");
    expect(shotPreview2Name(withImage as never)).toBe("");

    const long = "字".repeat(120);
    expect(shotDescription(shot("a", 1, "e", { videoDesc: long }))).toBe(`${"字".repeat(80)}…`);
  });

  it("多章:章序分组排序稳定;空表零节点不炸", () => {
    const mixed = [shot("b", 2, "ch-2"), shot("a", 1, "ch-1")];
    const result = buildStoryboardOverviewWorkflow(mixed);
    const ui = result.ui as { nodes: Array<{ widgets_values: unknown[] }> };
    expect(ui.nodes[0].widgets_values[0]).toBe("a");
    expect(result.report.chapters).toEqual(["ch-1", "ch-2"]);

    const empty = buildStoryboardOverviewWorkflow([]);
    expect((empty.ui as { nodes: unknown[] }).nodes).toHaveLength(0);
  });
});
