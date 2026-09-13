// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
import { describe, expect, it } from "vitest";
import type { StudioFlowData } from "@/lib/studio/studio-flow-data";
import { buildNodeDocMarkdown } from "./node-doc-content";

const flowData = {
  script: "<script>\n# 第一幕\n\n少年拾剑。\n</script>",
  scriptPlan: "<scriptPlan>\n## 场次\n\n夜 · 外\n</scriptPlan>",
  assets: [
    { id: "a1", name: "独孤剑尘", type: "character", note: "断臂散修", episodeId: "c1" },
    { id: "a2", name: "断剑崖", type: "scene", episodeId: "c1" },
    { id: "a3", name: "青盐鞭", type: "prop", note: "冷光", episodeId: "c1" },
  ],
  storyboardTable: "<storyboardTable>\n| 镜号 | 画面 |\n| --- | --- |\n| 1 | 断剑崖 |\n</storyboardTable>",
  storyboard: [
    { id: "s1", index: 1, videoDesc: "断剑崖全貌", prompt: "远景", track: "t1", duration: 3, associateAssetsIds: [], shouldGenerateImage: true, lines: "谁在捣鬼" },
    { id: "s2", index: 2, videoDesc: "拾剑", prompt: "特写", track: "t1", duration: 2, associateAssetsIds: [], shouldGenerateImage: true },
  ],
  workbench: {
    tracks: [
      { id: "t1", prompt: "主轨", state: "succeeded", reason: undefined, duration: 5, storyboardIds: ["s1", "s2"], selectVideoId: undefined, selectedVideoId: undefined, selectedVideoPath: undefined, medias: [] },
    ],
  },
} as unknown as StudioFlowData;

const node = (id: string, extra: Record<string, unknown> = {}) =>
  ({ id, ...extra }) as unknown as Parameters<typeof buildNodeDocMarkdown>[0];

describe("buildNodeDocMarkdown(七型全文,禁截断)", () => {
  it("script/scriptPlan:剥数据包装标签,正文全量", () => {
    expect(buildNodeDocMarkdown(node("script"), flowData)).toBe("# 第一幕\n\n少年拾剑。");
    expect(buildNodeDocMarkdown(node("scriptPlan"), flowData)).toBe("## 场次\n\n夜 · 外");
  });

  it("assets:三组全列,含备注", () => {
    const md = buildNodeDocMarkdown(node("assets"), flowData);
    expect(md).toContain("## 角色（1）");
    expect(md).toContain("**独孤剑尘**：断臂散修");
    expect(md).toContain("## 场景（1）");
    expect(md).toContain("## 道具（1）");
    expect(md).toContain("**青盐鞭**：冷光");
  });

  it("storyboard:逐镜全字段(画面/台词/提示词),零截断", () => {
    const md = buildNodeDocMarkdown(node("storyboard"), flowData);
    expect(md).toContain("## 分镜全文（2 镜）");
    expect(md).toContain("### S01 · 3s");
    expect(md).toContain("画面：断剑崖全貌");
    expect(md).toContain("台词：「谁在捣鬼」");
    expect(md).toContain("提示词：特写");
  });

  it("remotionProduction:逐镜状态行", () => {
    const shotsNode = node("remotionProduction", { remotionShots: [
      { shotId: "sb-1", index: 1, title: "断剑崖", status: "succeeded", progress: 1, revision: 2, ttsStatus: "ready" },
      { shotId: "sb-2", index: 2, title: "拾剑", status: "failed", progress: 0, error: "超时" },
    ] });
    const md = buildNodeDocMarkdown(shotsNode, flowData);
    expect(md).toContain("## 单镜视频生产（2 镜）");
    expect(md).toContain("#01 断剑崖** — ✅ 完成 · 配音:ready · v2");
    expect(md).toContain("#02 拾剑** — ❌ 失败 · （超时）");
  });

  it("workbench:轨道全列", () => {
    const md = buildNodeDocMarkdown(node("workbench"), flowData);
    expect(md).toContain("## 视频工作台轨道（1）");
    expect(md).toContain("**t1** — 5s · succeeded · 关联分镜 2");
    expect(md).toContain("主轨");
  });

  it("storyboardTable 兜底 md:剥标签;空数据=占位语", () => {
    expect(buildNodeDocMarkdown(node("storyboardTable"), flowData)).toContain("| 1 | 断剑崖 |");
    const empty = { ...flowData, script: "", assets: [], storyboard: [], workbench: { tracks: [] } } as unknown as StudioFlowData;
    expect(buildNodeDocMarkdown(node("script"), empty)).toBe("暂无剧本内容");
    expect(buildNodeDocMarkdown(node("assets"), empty)).toBe("暂无衍生资产");
    expect(buildNodeDocMarkdown(node("storyboard"), empty)).toBe("暂无分镜内容");
    expect(buildNodeDocMarkdown(node("workbench"), empty)).toBe("暂无视频工作台轨道");
    expect(buildNodeDocMarkdown(node("unknown"), empty)).toBe("暂无内容");
  });
});
