import { describe, expect, it } from "vitest";
import {
  PRODUCTION_FLOW_EDGES,
  PRODUCTION_FLOW_NODE_IDS,
  buildProductionFlowModel,
} from "./workflow-node-model";
import type { StudioManualCatalog } from "@/lib/studio/manuals";

const manualCatalog: StudioManualCatalog = {
  visual: [
    {
      id: "visual-rain-ink",
      kind: "visual",
      name: "雨夜水墨风格",
      modules: {
        director_planning_style: "视觉风格导演规划规则：雨夜、断剑、冷光、压迫纵深。",
        director_storyboard: "视觉风格分镜提示词规则：水墨人物、动作、构图。",
        director_storyboard_table_style: "视觉风格分镜表规则：水墨镜头节奏和转场。",
        art_storyboard_video: "视觉风格视频提示词规则：首帧和动态描述。",
      },
      images: [],
      builtin: true,
      source: "bundled",
      completenessScore: 1,
      moduleCount: 1,
      imageCount: 0,
    },
  ],
  director: [
    {
      id: "director-xianxia",
      kind: "director",
      name: "仙侠悬疑叙事",
      modules: {
        director_planning_narrative: "题材导演规划规则：保留台词、按场次拆分、强化悬疑节奏。",
        director_storyboard_table_narrative: "题材分镜表规则：道劫叙事、角色和道具必须入镜。",
      },
      images: [],
      builtin: true,
      source: "bundled",
      completenessScore: 1,
      moduleCount: 1,
      imageCount: 0,
    },
  ],
};

describe("production workflow node model", () => {
  it("defines the Toonflow production nodes and fixed edges", () => {
    expect(PRODUCTION_FLOW_NODE_IDS).toEqual([
      "script",
      "scriptPlan",
      "assets",
      "storyboardTable",
      "storyboard",
      "workbench",
    ]);

    expect(PRODUCTION_FLOW_EDGES).toEqual([
      ["script", "scriptPlan"],
      ["script", "assets"],
      ["scriptPlan", "storyboardTable"],
      ["storyboardTable", "storyboard"],
      ["storyboard", "workbench"],
    ]);
  });

  it("maps MYStudio production data to node status, metrics, and stage targets", () => {
    const model = buildProductionFlowModel({
      agentWorkData: [
        {
          id: "work-script",
          key: "scriptDraft",
          data: "SMOKE_SCRIPT_LINE\n第一章剧本正文".repeat(12),
          createdAt: 1,
          updatedAt: 1,
        },
        {
          id: "work-table",
          key: "storyboardTable",
          data: "SMOKE_SHOT_TABLE_ROW\n镜头 2",
          createdAt: 1,
          updatedAt: 1,
        },
        {
          id: "work-export",
          key: "productionPlan",
          data: "本地成片输出: /tmp/SMOKE_FINAL_EXPORT.mp4",
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      entityExtractions: [
        {
          id: "extract-1",
          episodeId: "chapter-001",
          characters: [
            { characterId: "char-1", name: "Smoke角色", aliases: [] },
          ],
          scenes: [{ sceneId: "scene-1", name: "Smoke场景" }],
          props: [{ assetId: "prop-1", name: "Smoke道具" }],
        },
      ],
      scriptPlans: [
        {
          id: "plan-1",
          episodeId: "chapter-001",
          theme: "断剑夜访道口镇",
          visualStyle: "雨夜古镇",
          narrativeRhythm: "压迫推进",
          sceneIntents: [],
          soundDirection: "低沉悬疑",
          transitions: "雨声转场",
          derivedAssetPlan: [
            {
              parentAssetId: "char-1",
              state: "雨夜破衣",
              reason: "第一场受伤状态",
            },
          ],
        },
      ],
      storyboards: [
        {
          id: "shot-1",
          episodeId: "chapter-001",
          index: 1,
          trackKey: "track-1",
          trackId: "track-1",
          duration: 5,
          prompt: "SMOKE_STORYBOARD_PROMPT",
          videoDesc: "镜头推进",
          assetIds: ["asset-1"],
          state: "ready",
          mediaRef: { kind: "image", path: "/tmp/shot.png" },
        },
      ],
      productionTracks: [
        {
          id: "track-1",
          episodeId: "chapter-001",
          trackKey: "track-1",
          storyboardIds: ["shot-1"],
          prompt: "track",
          duration: 5,
          candidateVideoIds: ["candidate-1"],
          selectedVideoId: "candidate-1",
          state: "ready",
        },
      ],
      videoCandidates: [
        {
          id: "candidate-1",
          trackId: "track-1",
          provider: "ffmpeg-local",
          filePath: "/tmp/final.mp4",
          state: "ready",
          createdAt: 1,
        },
      ],
      workflowConfig: {
        visualManualId: "visual-rain-ink",
        directorManualId: "director-xianxia",
      },
      manualCatalog,
      assetMediaById: {
        "char-1": {
          id: "char-1",
          name: "Smoke角色",
          path: "/tmp/char.png",
        },
        "var-1": {
          id: "var-1",
          name: "雨夜破衣",
          path: "/tmp/char-rain.png",
        },
      },
    });

    expect(model.nodes.map((node) => node.id)).toEqual(PRODUCTION_FLOW_NODE_IDS);
    expect(model.edges).toEqual(PRODUCTION_FLOW_EDGES);
    expect(model.nodes.map((node) => node.targetStage)).toEqual([
      "script",
      "storyboard",
      "assets",
      "storyboard",
      "storyboard",
      "workbench",
    ]);
    expect(model.nodes.every((node) => node.status === "ready")).toBe(true);
    expect(model.nodes.map((node) => node.id)).toContain("assets");
    expect(model.nodes.find((node) => node.id === "assets")?.label).toBe(
      "衍生资产",
    );
    expect(model.nodes.find((node) => node.id === "assets")?.metrics).toEqual([
      "3 个资产",
      "1 角色",
      "1 场景",
      "1 道具",
    ]);
    expect(
      model.nodes.find((node) => node.id === "assets")?.previewLines.join("\n"),
    ).toContain("角色 · Smoke角色");
    const assetNode = model.nodes.find((node) => node.id === "assets");
    expect(assetNode?.previewKind).toBe("asset-derivation");
    expect(assetNode?.assetGroups?.[0]?.source.mediaPath).toBe("/tmp/char.png");
    expect(assetNode?.assetGroups?.[0]?.derived[0]).toMatchObject({
      name: "雨夜破衣",
      mediaPath: "/tmp/char-rain.png",
      reason: "第一场受伤状态",
      isDerived: true,
    });
    expect(
      model.nodes
        .find((node) => node.id === "storyboard")
        ?.metrics.join("\n"),
    ).not.toContain("资产");
    expect(
      model.nodes.find((node) => node.id === "workbench")?.metrics,
    ).toContain("1 个候选");
    expect(
      model.nodes.find((node) => node.id === "workbench")?.metrics,
    ).toContain("已导出成片");
    expect(model.nodes.find((node) => node.id === "script")?.metrics).toContain(
      "当前剧本",
    );
    expect(
      model.nodes.find((node) => node.id === "script")?.metrics.join("\n"),
    ).not.toContain("份剧本");
    expect(
      model.nodes.find((node) => node.id === "script")?.previewLines.join("\n"),
    ).toContain("SMOKE_SCRIPT_LINE");
    expect(
      model.nodes
        .find((node) => node.id === "scriptPlan")
        ?.previewLines.join("\n"),
    ).toContain("主题：断剑夜访道口镇");
    expect(model.nodes.find((node) => node.id === "scriptPlan")?.actions).toEqual([
      expect.objectContaining({
        id: "generate-director-plan",
        label: "重新生成导演规划",
        disabled: false,
      }),
    ]);
    expect(model.nodes.find((node) => node.id === "scriptPlan")?.skill).toMatchObject({
      id: "production_execution_director_plan",
      source: "toonflow-runtime",
    });
    expect(model.nodes.find((node) => node.id === "scriptPlan")?.skills).toEqual([
      expect.objectContaining({
        id: "production_execution_director_plan",
        role: "base",
      }),
      expect.objectContaining({
        id: "visual-rain-ink/director_planning_style",
        role: "visual-style",
      }),
      expect.objectContaining({
        id: "visual-rain-ink/director_storyboard",
        role: "visual-storyboard",
      }),
      expect.objectContaining({
        id: "visual-rain-ink/director_storyboard_table_style",
        role: "visual-storyboard-table",
      }),
      expect.objectContaining({
        id: "director-xianxia/director_planning_narrative",
        role: "director-narrative",
      }),
      expect.objectContaining({
        id: "director-xianxia/director_storyboard_table_narrative",
        role: "director-storyboard-table",
      }),
    ]);
    expect(
      model.nodes
        .find((node) => node.id === "scriptPlan")
        ?.skills?.map((skill) => skill.summaryLines.join("\n"))
        .join("\n"),
    ).toContain("视觉风格导演规划规则");
    expect(
      model.nodes
        .find((node) => node.id === "scriptPlan")
        ?.skills?.map((skill) => skill.summaryLines.join("\n"))
        .join("\n"),
    ).toContain("题材导演规划规则");
    expect(
      model.nodes
        .find((node) => node.id === "storyboardTable")
        ?.skills?.map((skill) => skill.id),
    ).toEqual(
      expect.arrayContaining([
        "production_execution_storyboard_table",
        "visual-rain-ink/director_storyboard_table_style",
        "director-xianxia/director_storyboard_table_narrative",
        "toonflow-production/storyboard_table_techniques",
      ]),
    );
    expect(
      model.nodes
        .find((node) => node.id === "storyboard")
        ?.skills?.map((skill) => skill.id),
    ).toEqual(
      expect.arrayContaining([
        "production_execution_storyboard_panel",
        "production_execution_storyboard_gen",
        "visual-rain-ink/director_storyboard",
        "visual-rain-ink/art_storyboard_video",
        "toonflow-production/storyboard_prompt_techniques",
      ]),
    );
    expect(
      model.nodes
        .find((node) => node.id === "storyboardTable")
        ?.previewLines.join("\n"),
    ).toContain("SMOKE_SHOT_TABLE_ROW");
    expect(
      model.nodes.find((node) => node.id === "storyboardTable")?.actions,
    ).toEqual([
      expect.objectContaining({
        id: "generate-storyboard-table",
        label: "重新生成分镜表",
        disabled: false,
      }),
    ]);
    expect(
      model.nodes
        .find((node) => node.id === "storyboard")
        ?.previewLines.join("\n"),
    ).toContain("镜头推进");
    expect(
      model.nodes
        .find((node) => node.id === "workbench")
        ?.previewLines.join("\n"),
    ).toContain("SMOKE_FINAL_EXPORT.mp4");
  });

  it("does not mark the workbench ready before final export exists", () => {
    const model = buildProductionFlowModel({
      agentWorkData: [],
      entityExtractions: [],
      scriptPlans: [],
      storyboards: [],
      productionTracks: [
        {
          id: "track-1",
          episodeId: "chapter-001",
          trackKey: "track-1",
          storyboardIds: [],
          prompt: "track",
          duration: 5,
          candidateVideoIds: ["candidate-1"],
          selectedVideoId: "candidate-1",
          state: "ready",
        },
      ],
      videoCandidates: [
        {
          id: "candidate-1",
          trackId: "track-1",
          provider: "ffmpeg-local",
          filePath: "/tmp/track.mp4",
          state: "ready",
          createdAt: 1,
        },
      ],
    });

    const workbench = model.nodes.find((node) => node.id === "workbench");
    expect(workbench?.status).toBe("pending");
    expect(workbench?.metrics).toContain("待导出成片");
  });

  it("exposes node-local generate actions and AI prompt inputs for incomplete workflow nodes", () => {
    const model = buildProductionFlowModel({
      agentWorkData: [
        {
          id: "work-script",
          key: "scriptDraft",
          data: "第一章剧本正文",
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      entityExtractions: [],
      scriptPlans: [
        {
          id: "plan-1",
          episodeId: "chapter-001",
          theme: "断剑夜访道口镇",
          visualStyle: "雨夜古镇",
          narrativeRhythm: "压迫推进",
          sceneIntents: [],
          soundDirection: "低沉悬疑",
          transitions: "雨声转场",
          derivedAssetPlan: [],
        },
      ],
      storyboards: [],
      productionTracks: [],
      videoCandidates: [],
    });

    expect(model.nodes).toHaveLength(6);
    expect(model.nodes.find((node) => node.id === "scriptPlan")?.actions).toEqual([
      expect.objectContaining({
        id: "generate-director-plan",
        label: "重新生成导演规划",
        disabled: false,
        promptPlaceholder: expect.stringContaining("给导演规划补充要求"),
      }),
    ]);
    expect(model.nodes.find((node) => node.id === "storyboardTable")?.actions).toEqual([
      expect.objectContaining({
        id: "generate-storyboard-table",
        label: "生成分镜表",
        disabled: false,
        promptPlaceholder: expect.stringContaining("给分镜表补充要求"),
      }),
    ]);
  });
});
