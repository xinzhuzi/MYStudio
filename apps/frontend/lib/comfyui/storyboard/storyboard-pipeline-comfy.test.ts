// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
// 分镜流程链载荷与模板注入契约测试(09-11 旧画布迁移;09-15 零实体裁定后
// 只测存留件:摘要/载荷/注入契约——旧整图构建器已退役删除)。

import { describe, expect, it } from "vitest";
import type { StoryboardItem } from "@/types/studio";
import { buildStageNodePayload, buildStageSummaries } from "./storyboard-pipeline-comfy";

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
    expect(storyboard.tiles![0].preview).toContain("my-shot-");
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
    expect(byKey("storyboard").actions![0]).toEqual({ kind: "generate-images", label: "一键生图", disabled: false });
    expect(byKey("remotionProduction").actions![0].kind).toBe("generate-videos");
    expect(byKey("workbench").actions![0]).toMatchObject({ kind: "rebuild-workbench-tracks" });
    expect(byKey("script").actions).toBeUndefined();
  });

  it("面板迁移动作收编(1120 分镜面板退役):storyboard 节点带批量全家,remotionProduction 带 H3 全家", () => {
    const byKey = (k: string) => payloads.find((p) => p.key === k)!;
    const storyboardActions = byKey("storyboard").actions!;
    // 批量五新钮:重出(paid 两步确认)/停止(常驻)/自动绑定/章流水线/导演台导入
    expect(storyboardActions.map((a) => a.kind)).toEqual([
      "generate-images", "generate-images-force", "generate-images-stop",
      "auto-bind-assets", "chapter-pipeline-start", "daoyan-import",
    ]);
    const force = storyboardActions.find((a) => a.kind === "generate-images-force")!;
    expect(force.paid).toBe(true);
    expect(force.disabled).toBe(false); // 有分镜可重出
    expect(storyboardActions.find((a) => a.kind === "generate-images-stop")!.disabled).toBeUndefined(); // 常驻,宿主侧幂等
    // H3 全家归单镜生产节点(通道B 与通道A generate-videos 分置)
    const remotionActions = byKey("remotionProduction").actions!;
    expect(remotionActions.map((a) => a.kind)).toEqual([
      "generate-videos", "h3-start", "h3-start", "h3-stop",
      "h3-import-orphans", "h3-archive-backfill", "open-final-video",
    ]);
    const tiers = remotionActions.filter((a) => a.kind === "h3-start").map((a) => a.noteKey);
    expect(tiers).toEqual(["480p", "960p"]);
    expect(remotionActions.filter((a) => a.kind === "h3-start").every((a) => a.disabled === false)).toBe(true);
    expect(remotionActions.find((a) => a.kind === "h3-stop")!.disabled).toBeUndefined(); // 常驻
  });

  it("面板迁移动作禁用语义随数据:零分镜时生图/重出/H3 发车全禁用(与面板原口径一致)", () => {
    const empty = buildStageNodePayload({
      novelChapters: [], scriptPlans: [], entityExtractions: [], storyboards: [],
      flowData: { ...flowData, storyboardTable: "" } as never,
    });
    const storyboardActions = empty.find((p) => p.key === "storyboard")!.actions!;
    expect(storyboardActions.find((a) => a.kind === "generate-images")!.disabled).toBe(true);
    expect(storyboardActions.find((a) => a.kind === "generate-images-force")!.disabled).toBe(true);
    expect(storyboardActions.find((a) => a.kind === "auto-bind-assets")!.disabled).toBe(true);
    const remotionActions = empty.find((p) => p.key === "remotionProduction")!.actions!;
    expect(remotionActions.filter((a) => a.kind === "h3-start").every((a) => a.disabled === true)).toBe(true);
    // 停止/流水线/导入类不依赖分镜数,保持可用(宿主侧幂等/自有校验)
    expect(storyboardActions.find((a) => a.kind === "generate-images-stop")!.disabled).toBeUndefined();
    expect(storyboardActions.find((a) => a.kind === "chapter-pipeline-start")!.disabled).toBeUndefined();
  });
});

// ── 09-14 通用化:零文件模板注入契约 ──────────────────────────────
describe("buildStageInjections/applyStageInjections(通用模板注入)", () => {
  it("captures the source project on every stage without mutating payloads", async () => {
    const { buildStageInjections } = await import("./storyboard-pipeline-comfy");
    const payload = { key: "script", lines: ["source"] };
    const injections = buildStageInjections({
      summaries: [{ key: "script", title: "Script" }, { key: "storyboardTable", title: "Shots" }],
      payloads: [payload],
      originProjectId: "project-a",
      originEpisodeId: "chapter-a",
    });
    expect(injections.map((entry) => entry.properties.myOriginProjectId)).toEqual(["project-a", "project-a"]);
    expect(injections[0].properties.myStage).toMatchObject({ originProjectId: "project-a" });
    expect(injections.map((entry) => entry.properties.myOriginEpisodeId)).toEqual(["chapter-a", "chapter-a"]);
    expect(injections[0].properties.myStage).toMatchObject({ originEpisodeId: "chapter-a" });
    expect(payload).toEqual({ key: "script", lines: ["source"] });
  });
  it("注入块按模板槽位 id 对齐;载荷进 properties.myStage,模板本体零改动", async () => {
    const { buildStageInjections, applyStageInjections, MAINLINE_TAB_NAME, STAGE_TEMPLATE_REPO_ID } =
      await import("./storyboard-pipeline-comfy");
    expect(MAINLINE_TAB_NAME).toBe("分镜工作流.json");
    expect(STAGE_TEMPLATE_REPO_ID).toContain("repo:0_分镜/");
    const injections = buildStageInjections({
      summaries: [
        { key: "script", title: "剧本", summary: "已导入 1 章", status: "已完成" },
        { key: "storyboardTable", title: "分镜表", summary: "38 个分镜", status: "已完成" },
      ],
      payloads: [{ key: "script", lines: ["第一行"] } as never],
    });
    expect(injections).toHaveLength(2);
    expect(injections[0].id).toBe(1); // 模板槽位契约:script=1
    expect(injections[1].id).toBe(3); // storyboardTable=3
    const template = { nodes: [
      { id: 1, type: "MyStage", properties: {}, widgets_values: ["script", "剧本", "", ""] },
      { id: 3, type: "MyStage", properties: {}, widgets_values: ["storyboardTable", "分镜表", "", ""] },
    ], links: [] };
    const graph = applyStageInjections(template, injections) as { nodes: Array<{ properties: Record<string, unknown>; widgets_values: unknown[] }> };
    expect((graph.nodes[0].properties.myStage as { lines: string[] }).lines).toEqual(["第一行"]);
    expect(graph.nodes[1].widgets_values[2]).toBe("38 个分镜");
    // 模板本体不被改写(克隆注入)
    expect(template.nodes[0].properties).toEqual({});
  });
});
