// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
// 分镜流程链工作流生成器测试(旧画布迁移 09-11)。

import { describe, expect, it } from "vitest";
import type { StoryboardItem } from "@/types/studio";
import { buildStageNodePayload, buildStageSummaries, buildStoryboardPipelineWorkflow, computeStageNodeSize } from "./storyboard-pipeline-comfy";

function shot(index: number, media: "image" | "video" | "none" = "none"): StoryboardItem {
  return {
    id: `sb-${index}`,
    index,
    episodeId: "chapter-001",
    videoDesc: `第${index}镜`,
    mediaRef: media === "none" ? null : { kind: media, path: `/x/${index}.${media}` },
  } as unknown as StoryboardItem;
}

describe("buildStageSummaries(环节摘要,语义照旧画布 node-builders 降档)", () => {
  it("空数据=全部未开始;有数据=计数+状态推进", () => {
    const empty = buildStageSummaries({
      novelChapters: [], scriptPlans: [], entityExtractions: [], storyboards: [], productionTracks: [],
    });
    expect(empty.find((s) => s.key === "script")?.summary).toBe("还没有导入小说原文");
    expect(empty.every((s) => s.status === "未开始")).toBe(true);

    const filled = buildStageSummaries({
      novelChapters: [{ id: "c1" }, { id: "c2" }],
      scriptPlans: [{}, {}],
      entityExtractions: [{}],
      storyboards: [shot(1, "image"), shot(2, "video"), shot(3)],
      productionTracks: [{}],
    });
    expect(filled.find((s) => s.key === "script")?.summary).toBe("已导入 2 章原文");
    expect(filled.find((s) => s.key === "scriptPlan")?.summary).toBe("2 份导演规划");
    expect(filled.find((s) => s.key === "assets")?.summary).toBe("已提取 1 批(角色/场景/道具)");
    expect(filled.find((s) => s.key === "storyboardTable")?.summary).toBe("3 个分镜");
    expect(filled.find((s) => s.key === "storyboard")?.summary).toBe("3 个分镜 · 1 张画面已生成");
    expect(filled.find((s) => s.key === "remotionProduction")?.summary).toBe("1/3 个分镜已有视频");
    expect(filled.find((s) => s.key === "workbench")?.summary).toBe("1 条制作轨");
    expect(filled.find((s) => s.key === "script")?.status).toBe("已完成");
    expect(filled.find((s) => s.key === "storyboard")?.status).toBe("进行中");
  });
});

describe("buildStoryboardPipelineWorkflow(链工作流)", () => {
  const summaries = buildStageSummaries({
    novelChapters: [{ id: "c1" }], scriptPlans: [], entityExtractions: [],
    storyboards: [shot(1, "image"), shot(2)], productionTracks: [],
  });
  const result = buildStoryboardPipelineWorkflow({ summaries, storyboards: [shot(1, "image"), shot(2)] });

  it("七环节节点+六条链边(照旧画布 PRODUCTION_FLOW_EDGES;assets 挂剧本)", () => {
    expect(result.report.stages).toBe(7);
    expect(result.report.edges).toBe(6);
    const ui = result.ui as { nodes: Array<{ id: number; type: string; widgets_values: unknown[] }>; links: number[][] };
    const stages = ui.nodes.filter((n) => n.type === "ManyingStage");
    expect(stages).toHaveLength(7);
    // 边端点(节点 id:script=1..workbench=6,assets=7)
    expect(ui.links.map((l) => `${l[1]}→${l[3]}`)).toEqual(["1→2", "1→7", "2→3", "3→4", "4→5", "5→6"]);
    // widgets 顺序=INPUT_TYPES:stage_key/title/summary/status
    const script = stages.find((n) => n.widgets_values[0] === "script")!;
    expect(script.widgets_values[1]).toBe("剧本");
  });

  it("09-12 节点标题栏=环节名(固定节点不再全显类型名「漫影 环节」)", () => {
    const ui = result.ui as { nodes: Array<{ type: string; title?: string; widgets_values?: unknown[] }> };
    const stages = ui.nodes.filter((n) => n.type === "ManyingStage");
    const byTitle = Object.fromEntries(stages.map((n) => [n.widgets_values?.[0], n.title]));
    expect(byTitle).toEqual({
      script: "剧本", scriptPlan: "导演规划", assets: "衍生资产", storyboardTable: "分镜表",
      storyboard: "分镜面板", remotionProduction: "单镜视频生产", workbench: "视频工作台",
    });
    // 子图引用节点标题=子图名(不回落 uuid 型名)
    const refNode = ui.nodes.find((n) => n.type !== "ManyingStage");
    expect(refNode?.title).toContain("分镜内容");
  });

  it("镜子节点住子图:主图零 ManyingShot,definitions 装镜节点;09-12 裁定零组框", () => {
    const ui = result.ui as {
      nodes: Array<{ id: number; type: string; pos: number[]; widgets_values?: unknown[] }>;
      groups: unknown[];
      definitions: { subgraphs: Array<{ id: string; name: string; nodes: Array<{ type: string }>; inputNode: { id: number }; outputNode: { id: number } }> };
    };
    // 主图只留整条流程:七环节+一个子图引用节点,零 ManyingShot
    const mainShots = ui.nodes.filter((n) => n.type === "ManyingShot");
    expect(mainShots).toHaveLength(0);
    expect(ui.nodes).toHaveLength(8); // 7 环节 + 1 子图引用
    // 子图定义:镜节点全在子图里(类型照旧 ManyingShot)
    const subs = ui.definitions.subgraphs;
    expect(subs).toHaveLength(1);
    const sub = subs[0];
    expect(sub.nodes.filter((n) => n.type === "ManyingShot")).toHaveLength(2);
    expect(sub.inputNode.id).toBe(-10);
    expect(sub.outputNode.id).toBe(-20);
    expect(sub.name).toContain("chapter-001");
    // 09-12 用户裁定:节点后不加 group 组框
    expect(ui.groups).toHaveLength(0);
    // 主图 id 唯一
    const ids = new Set(ui.nodes.map((n) => n.id));
    expect(ids.size).toBe(ui.nodes.length);
  });

  it("标题恒「分镜工作流」不带章;extra 标记链工作流", () => {
    expect(result.report.name).toBe("分镜工作流");
    expect((result.ui as { extra: Record<string, unknown> }).extra.manyingPipeline).toBe(true);
  });
});

describe("buildStageNodePayload(v2 全量内容,照老 flow 画布)", () => {
  const flowData = {
    script: Array.from({ length: 70 }, (_, i) => `第${i + 1}行正文内容,足够长以触发换行与截断判定。`).join("\n"),
    scriptPlan: "节奏压迫,保留对白",
    assets: [
      { id: "a1", name: "赵四", type: "character", episodeId: "chapter-001" },
      { id: "a2", name: "守门人", type: "character", episodeId: "chapter-001" },
      { id: "a3", name: "断云崖", type: "scene", episodeId: "chapter-001" },
      { id: "a4", name: "断剑", type: "prop", episodeId: "chapter-001" },
    ],
    storyboardTable: "镜1:远景,雨夜山门,3s\n镜2:中景,少年持剑,4s",
    storyboard: [],
    workbench: { tracks: [{ id: "t1", prompt: "主线轨", state: "pending", storyboardIds: ["sb-1", "sb-2"], medias: [], videoList: [] }], finalExportPath: "/proj/out/chapter-001.mp4" },
  };
  const payloads = buildStageNodePayload({
    novelChapters: [{ id: "c1" }],
    scriptPlans: [{}],
    entityExtractions: [{}],
    storyboards: [shot(1, "image"), shot(2, "video"), shot(3)],
    flowData: flowData as never,
  });

  it("四态状态+指标+description(对齐老 builders 语义)", () => {
    const script = payloads.find((p) => p.key === "script")!;
    expect(script.status).toBe("ready");
    expect(script.statusText).toBe("已完成");
    expect(script.description).toBe("章节剧本与正文台词输入。");
    const storyboard = payloads.find((p) => p.key === "storyboard")!;
    expect(storyboard.status).toBe("pending");
    expect(storyboard.metrics).toEqual(["3 个分镜", "1 个画面", "1 个视频"]);
  });

  it("正文段落化全量展示(09-13 用户裁定:禁截断):源行=独立段落,空行分隔", () => {
    const lines = payloads.find((p) => p.key === "script")!.previewLines!;
    expect(lines).not.toContain("…正文较长已截断 · 进阶段面板看全文");
    expect(lines.some((l, i) => i > 0 && l === "" && lines[i - 1] !== "")).toBe(true);
    const plan = payloads.find((p) => p.key === "scriptPlan")!.previewLines!;
    expect(plan).toEqual(["节奏压迫,保留对白"]);
  });

  it("tiles 全量带缩略图名;shots 视频/配音双状态;资产分组;轨道全列", () => {
    const storyboard = payloads.find((p) => p.key === "storyboard")!;
    expect(storyboard.tiles).toHaveLength(3);
    expect(storyboard.tiles![0].preview).toContain("manying-shot-");
    expect(storyboard.tiles![1]).toMatchObject({ index: 2, hasVideo: true });
    const remotion = payloads.find((p) => p.key === "remotionProduction")!;
    expect(remotion.shots).toHaveLength(3);
    expect(remotion.shots!.map((x) => [x.videoReady, x.imageReady])).toEqual([[false, true], [true, false], [false, false]]);
    expect(remotion.shots!.every((x) => typeof x.sfxReady === "boolean" && x.revision >= 1)).toBe(true);
    expect(storyboard.tiles!.every((t) => "lines" in t)).toBe(true);
    const assets = payloads.find((p) => p.key === "assets")!;
    expect(assets.assetGroups).toEqual({ characters: ["赵四", "守门人"], scenes: ["断云崖"], props: ["断剑"] });
    const workbench = payloads.find((p) => p.key === "workbench")!;
    expect(workbench.tracks![0]).toMatchObject({ name: "主线轨", count: 2, duration: 0, mediaCount: 0 });
    expect(workbench.finalExport).toBe(true);
  });

  it("动作载荷(09-12 功能完备):五环节带按钮,paid 金标+禁用态随数据", () => {
    const byKey = (k: string) => payloads.find((p) => p.key === k)!;
    expect(byKey("scriptPlan").actions).toEqual([
      { kind: "generate-director-plan", label: "重新生成导演规划", paid: true, disabled: false },
    ]);
    expect(byKey("storyboardTable").actions![0]).toMatchObject({ kind: "generate-storyboard-table", paid: true });
    expect(byKey("storyboard").actions).toEqual([{ kind: "generate-images", label: "一键生图", disabled: false }]);
    expect(byKey("remotionProduction").actions![0].kind).toBe("generate-videos");
    expect(byKey("workbench").actions![0]).toMatchObject({ kind: "rebuild-workbench-tracks" });
    expect(byKey("script").actions).toBeUndefined();
  });

  it("computeStageNodeSize:旧画布口径保留(高度随 previewLines 行数计)", () => {
    const script = payloads.find((p) => p.key === "script")!;
    const [w, h] = computeStageNodeSize(script);
    expect(w).toBe(560);
    expect(h).toBeGreaterThanOrEqual(300);
    expect(computeStageNodeSize(undefined)).toEqual([560, 170]);
  });

  it("buildStoryboardPipelineWorkflow 接载荷:properties.manyingStage+尺寸+零组框+widgets 契约不变", () => {
    const summaries = buildStageSummaries({
      novelChapters: [{ id: "c1" }], scriptPlans: [], entityExtractions: [],
      storyboards: [shot(1, "image")], productionTracks: [],
    });
    const result = buildStoryboardPipelineWorkflow({
      summaries, storyboards: [shot(1, "image")], payloads,
    });
    const ui = result.ui as {
      nodes: Array<{ id: number; type: string; pos: number[]; size: number[]; properties: Record<string, unknown>; widgets_values: unknown[] }>;
      groups: unknown[];
    };
    const stages = ui.nodes.filter((n) => n.type === "ManyingStage");
    const script = stages.find((n) => n.widgets_values[0] === "script")!;
    expect((script.properties.manyingStage as { previewTitle: string }).previewTitle).toBe("剧本内容");
    expect(script.size[0]).toBe(600); // 正方形常理尺寸(引擎 syncSize 同口径)
    // 09-12 用户裁定:节点后不加 group 组框
    expect(ui.groups).toHaveLength(0);
    // widgets 四件套形状不变(契约稳定)
    expect(script.widgets_values).toHaveLength(4);
  });

  it("不传 payloads=零载荷零内容尺寸(旧调用兼容)", () => {
    const summaries = buildStageSummaries({
      novelChapters: [], scriptPlans: [], entityExtractions: [], storyboards: [], productionTracks: [],
    });
    const result = buildStoryboardPipelineWorkflow({ summaries, storyboards: [] });
    const stages = (result.ui as { nodes: Array<{ type: string; properties: Record<string, unknown>; size: number[] }> })
      .nodes.filter((n) => n.type === "ManyingStage");
    expect(stages.every((n) => !("manyingStage" in n.properties))).toBe(true);
    expect(stages.every((n) => n.size[1] === 600)).toBe(true); // 正方形常理尺寸
  });
});
