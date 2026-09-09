// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

import { describe, expect, it } from "vitest";

import {
  buildStoryboardOverviewWorkflow,
  shotLabel,
  shotMediaStatus,
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
    const ui = result.ui as { nodes: Array<{ id: number; pos: [number, number]; widgets_values: unknown[] }>; groups: unknown[] };

    expect(result.report).toEqual({ shots: 12, chapters: ["chapter-001"], name: "分镜总览 · chapter-001" });
    expect(ui.nodes).toHaveLength(12);
    // 第 11 镜跨列(x 增量=NODE_WIDTH+COLUMN_GAP=450)
    expect(ui.nodes[10].pos[0]).toBeGreaterThan(ui.nodes[0].pos[0]);
    // widget 序=shot_id/label/desc/status
    expect(ui.nodes[0].widgets_values).toEqual(["sb-1", "S01 · 第1镜", "第1镜", "图— 视频—"]);
    expect(ui.groups).toHaveLength(1);
  });

  it("媒体状态:图✓/视频✓ 按 mediaRef 判定;label 截断 14 字", () => {
    expect(shotMediaStatus(shot("a", 1, "e", { mediaRef: { kind: "image", path: "p.png" } as never }))).toBe("图✓ 视频—");
    expect(shotLabel(shot("a", 1, "e", { videoDesc: "一二三四五六七八九十一二三十四五六" }))).toBe("S01 · 一二三四五六七八九十一二三十");
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
