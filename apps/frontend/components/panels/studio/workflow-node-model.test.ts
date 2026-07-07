import { describe, expect, it } from "vitest";
import {
  PRODUCTION_FLOW_EDGES,
  PRODUCTION_FLOW_NODE_IDS,
  buildAssetLibraryMatchNamesForProductionFlow,
  buildAssetLibraryMediaMapForProductionFlow,
  buildProductionFlowModel,
} from "./workflow-node-model";
import { buildWorkbenchAssetMediaMap } from "./WorkbenchTab";
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
            {
              parentAssetId: "scene-1",
              state: "雪夜视角",
              reason: "第二场转入雪夜远景",
            },
            {
              parentAssetId: "missing-parent",
              state: "缺父资产状态",
              reason: "应标记缺父资产",
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
      "衍生 1/2 已完成",
      "缺父资产 1",
    ]);
    expect(
      model.nodes.find((node) => node.id === "assets")?.previewLines.join("\n"),
    ).toContain("角色 · Smoke角色");
    const assetNode = model.nodes.find((node) => node.id === "assets");
    expect(assetNode?.previewKind).toBe("asset-derivation");
    expect(assetNode?.actions).toEqual([
      expect.objectContaining({
        id: "sync-derived-assets",
        label: "落地衍生资产",
        disabled: false,
      }),
      expect.objectContaining({
        id: "generate-derived-assets",
        label: "生成衍生图片",
        disabled: false,
      }),
    ]);
    expect(assetNode?.assetGroups?.[0]?.source.mediaPath).toBe("/tmp/char.png");
    expect(assetNode?.assetGroups?.[0]?.derived[0]).toMatchObject({
      name: "雨夜破衣",
      mediaPath: "/tmp/char-rain.png",
      reason: "第一场受伤状态",
      isDerived: true,
      parentAssetId: "char-1",
      runtimeType: "role",
      generationState: "已完成",
    });
    expect(assetNode?.assetGroups?.[1]?.derived[0]).toMatchObject({
      name: "雪夜视角",
      parentAssetId: "scene-1",
      runtimeType: "scene",
      generationState: "未生成",
    });
    expect(assetNode?.assetSummary).toMatchObject({
      planned: 3,
      linked: 2,
      completed: 1,
      missingParent: 1,
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
    ).toContain("### ① 主题立意\n断剑夜访道口镇");
    expect(
      model.nodes
        .find((node) => node.id === "scriptPlan")
        ?.previewLines.join("\n"),
    ).toContain("雨夜破衣");
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
    expect(model.nodes.find((node) => node.id === "storyboard")?.actions).toEqual([
      expect.objectContaining({
        id: "generate-storyboard-images",
        label: "补生成分镜图",
        disabled: false,
      }),
      expect.objectContaining({
        id: "rebuild-workbench-tracks",
        label: "重建视频轨道",
        disabled: false,
      }),
    ]);
    expect(
      model.nodes
        .find((node) => node.id === "workbench")
        ?.previewLines.join("\n"),
    ).toContain("SMOKE_FINAL_EXPORT.mp4");
    const workbench = model.nodes.find((node) => node.id === "workbench") as
      | (NonNullable<(typeof model.nodes)[number]> & {
          workbenchTracks?: Array<{
            id: string;
            duration: number;
            storyboardCount: number;
            mediaCount: number;
            videoCount: number;
            selectedVideoPath?: string;
          }>;
          finalExportPath?: string;
        })
      | undefined;
    expect(workbench?.previewKind).toBe("workbench-lanes");
    expect(workbench?.workbenchTracks?.[0]).toMatchObject({
      id: "track-1",
      duration: 5,
      storyboardCount: 1,
      mediaCount: 1,
      videoCount: 1,
      selectedVideoPath: "/tmp/final.mp4",
    });
    expect(workbench?.finalExportPath).toContain("SMOKE_FINAL_EXPORT.mp4");
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
    expect(model.nodes.find((node) => node.id === "storyboard")?.actions).toEqual([
      expect.objectContaining({
        id: "generate-storyboard-images",
        label: "生成分镜图",
        disabled: true,
      }),
      expect.objectContaining({
        id: "rebuild-workbench-tracks",
        label: "重建视频轨道",
        disabled: true,
      }),
    ]);
    expect(model.nodes.find((node) => node.id === "assets")?.actions).toEqual([
      expect.objectContaining({
        id: "sync-derived-assets",
        label: "落地衍生资产",
        disabled: true,
      }),
      expect.objectContaining({
        id: "generate-derived-assets",
        label: "生成衍生图片",
        disabled: true,
      }),
    ]);
  });

  it("keeps Toonflow-style existing derivative links from the asset library", () => {
    const assetMediaById = buildWorkbenchAssetMediaMap(
      [
        {
          id: "char-1",
          name: "独孤剑尘",
          description: "白衣剑修",
          visualTraits: "white robe swordsman",
          views: [],
          variations: [
            {
              id: "var-1",
              name: "落魄江湖客",
              visualPrompt: "damaged robe",
              referenceImage: "project-file://daojie/assets/char-1-var-1.png",
              imageWorkflowId: "asset-flow-char-1-var-1",
            },
          ],
          thumbnailUrl: "project-file://daojie/assets/char-1.png",
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      [
        {
          id: "scene-1",
          name: "道口镇",
          location: "山道小镇",
          time: "夜",
          atmosphere: "冷雨",
          referenceImage: "project-file://daojie/assets/scene-1.png",
          createdAt: 1,
          updatedAt: 1,
        },
        {
          id: "scene-1-night",
          name: "道口镇夜雨视角",
          location: "山道小镇",
          time: "夜",
          atmosphere: "雨雾",
          parentSceneId: "scene-1",
          viewpointName: "夜雨视角",
          referenceImage: "project-file://daojie/assets/scene-1-night.png",
          imageWorkflowId: "asset-flow-scene-1-night",
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      [
        {
          id: "prop-1",
          name: "断剑",
          description: "旧剑",
          imageUrl: "project-file://daojie/assets/prop-1.png",
          folderId: null,
          createdAt: 1,
        },
        {
          id: "prop-1-broken",
          name: "断剑·裂纹版",
          description: "裂纹更明显",
          imageUrl: "project-file://daojie/assets/prop-1-broken.png",
          parentId: "prop-1",
          category: "裂纹版",
          imageWorkflowId: "asset-flow-prop-1-broken",
          folderId: null,
          createdAt: 1,
        },
      ],
    );
    const model = buildProductionFlowModel({
      agentWorkData: [],
      entityExtractions: [
        {
          id: "extract-1",
          episodeId: "chapter-001",
          characters: [
            { characterId: "char-1", name: "独孤剑尘", aliases: [] },
          ],
          scenes: [{ sceneId: "scene-1", name: "道口镇" }],
          props: [{ assetId: "prop-1", name: "断剑" }],
        },
      ],
      scriptPlans: [],
      storyboards: [],
      productionTracks: [],
      videoCandidates: [],
      assetMediaById,
    });

    const assetNode = model.nodes.find((node) => node.id === "assets");
    const groups = assetNode?.assetGroups ?? [];
    expect(groups.find((group) => group.source.id === "char-1")?.source.mediaPath).toBe(
      "project-file://daojie/assets/char-1.png",
    );
    expect(groups.find((group) => group.source.id === "char-1")?.derived[0]).toMatchObject({
      id: "var-1",
      name: "落魄江湖客",
      parentAssetId: "char-1",
      mediaPath: "project-file://daojie/assets/char-1-var-1.png",
      generationState: "已完成",
      imageWorkflowId: "asset-flow-char-1-var-1",
    });
    expect(groups.find((group) => group.source.id === "scene-1")?.derived[0]).toMatchObject({
      id: "scene-1-night",
      name: "夜雨视角",
      parentAssetId: "scene-1",
      mediaPath: "project-file://daojie/assets/scene-1-night.png",
      imageWorkflowId: "asset-flow-scene-1-night",
    });
    expect(groups.find((group) => group.source.id === "prop-1")?.derived[0]).toMatchObject({
      id: "prop-1-broken",
      name: "裂纹版",
      parentAssetId: "prop-1",
      mediaPath: "project-file://daojie/assets/prop-1-broken.png",
      imageWorkflowId: "asset-flow-prop-1-broken",
    });
    expect(assetNode?.assetSummary).toMatchObject({
      planned: 3,
      linked: 3,
      completed: 3,
      missingParent: 0,
    });
  });

  it("syncs script asset management library matches into the derived asset node", () => {
    const entityExtractions = [
      {
        id: "extract-1",
        episodeId: "chapter-001",
        characters: [
          { characterId: "char-1", name: "独孤剑尘", aliases: [] },
        ],
        scenes: [{ sceneId: "scene-1", name: "矿场" }],
        props: [{ assetId: "prop-1", name: "断剑" }],
      },
    ];
    const scriptPlans = [
      {
        id: "plan-1",
        episodeId: "chapter-001",
        theme: "",
        visualStyle: "",
        narrativeRhythm: "",
        sceneIntents: [],
        soundDirection: "",
        transitions: "",
        derivedAssetPlan: [
          {
            parentAssetId: "char-1",
            state: "雨夜破衣",
            reason: "剧本资产管理中已有衍生图",
          },
          {
            parentAssetId: "scene-1",
            state: "低机位推进",
            reason: "剧本资产管理中已有场景衍生图",
          },
          {
            parentAssetId: "prop-1",
            state: "断剑破损版",
            reason: "剧本资产管理中已有道具衍生图",
          },
        ],
      },
    ];
    const assetMediaById = buildAssetLibraryMediaMapForProductionFlow({
      entityExtractions,
      scriptPlans,
      matchesByType: {
        role: {
          "独孤剑尘": {
            id: "asset-role-1",
            source: "manying-local",
            type: "role",
            name: "独孤剑尘",
            thumbnailUrl: "project-file://daojie/assets/dugu.png",
            prompt: "白衣剑修基础形象",
          },
          "雨夜破衣": {
            id: "asset-role-1-rain",
            source: "manying-local",
            type: "role",
            name: "雨夜破衣",
            previewUrl: "project-file://daojie/assets/dugu-rain.png",
            prompt: "雨夜破衣状态",
            imageWorkflowId: "asset-flow-dugu-rain",
          },
        },
        scene: {
          "矿场": {
            id: "asset-scene-1",
            source: "manying-local",
            type: "scene",
            name: "矿场",
            thumbnailUrl: "project-file://daojie/assets/mine.png",
          },
          "低机位推进": {
            id: "asset-scene-1-low",
            source: "manying-local",
            type: "scene",
            name: "低机位推进",
            previewUrl: "project-file://daojie/assets/mine-low.png",
            imageWorkflowId: "asset-flow-mine-low",
          },
        },
        tool: {
          "断剑": {
            id: "asset-prop-1",
            source: "manying-local",
            type: "tool",
            name: "断剑",
            thumbnailUrl: "project-file://daojie/assets/sword.png",
          },
          "断剑破损版": {
            id: "asset-prop-1-broken",
            source: "manying-local",
            type: "tool",
            name: "断剑破损版",
            previewUrl: "project-file://daojie/assets/sword-broken.png",
            imageWorkflowId: "asset-flow-sword-broken",
          },
        },
      },
    });

    const model = buildProductionFlowModel({
      agentWorkData: [],
      entityExtractions,
      scriptPlans,
      storyboards: [],
      productionTracks: [],
      videoCandidates: [],
      assetMediaById,
    });

    const assetNode = model.nodes.find((node) => node.id === "assets");
    const sourceGroup = assetNode?.assetGroups?.find(
      (group) => group.source.id === "char-1",
    );
    expect(sourceGroup?.source.mediaPath).toBe(
      "project-file://daojie/assets/dugu.png",
    );
    expect(sourceGroup?.source.prompt).toBe("白衣剑修基础形象");
    expect(sourceGroup?.derived[0]).toMatchObject({
      name: "雨夜破衣",
      mediaPath: "project-file://daojie/assets/dugu-rain.png",
      prompt: "雨夜破衣状态",
      parentAssetId: "char-1",
      generationState: "已完成",
      imageWorkflowId: "asset-flow-dugu-rain",
      imageWorkflowTarget: {
        kind: "asset",
        assetType: "character",
        parentId: "char-1",
        id: "asset-role-1-rain",
      },
    });
    expect(assetNode?.assetGroups?.find((group) => group.source.id === "scene-1")?.derived[0]).toMatchObject({
      name: "低机位推进",
      mediaPath: "project-file://daojie/assets/mine-low.png",
      imageWorkflowId: "asset-flow-mine-low",
      imageWorkflowTarget: {
        kind: "asset",
        assetType: "scene",
        parentId: "scene-1",
        id: "asset-scene-1-low",
      },
    });
    expect(assetNode?.assetGroups?.find((group) => group.source.id === "prop-1")?.derived[0]).toMatchObject({
      name: "断剑破损版",
      mediaPath: "project-file://daojie/assets/sword-broken.png",
      imageWorkflowId: "asset-flow-sword-broken",
      imageWorkflowTarget: {
        kind: "asset",
        assetType: "prop",
        parentId: "prop-1",
        id: "asset-prop-1-broken",
      },
    });
    expect(assetNode?.assetSummary).toMatchObject({
      planned: 3,
      linked: 3,
      completed: 3,
      missingParent: 0,
    });
  });

  it("adds an image workflow target for direct derived media without one", () => {
    const entityExtractions = [
      {
        id: "extract-1",
        episodeId: "chapter-001",
        characters: [
          { characterId: "char-1", name: "独孤剑尘", aliases: [] },
        ],
        scenes: [],
        props: [],
      },
    ];

    const model = buildProductionFlowModel({
      agentWorkData: [],
      entityExtractions,
      scriptPlans: [],
      storyboards: [],
      productionTracks: [],
      videoCandidates: [],
      assetMediaById: {
        "char-1": {
          id: "char-1",
          name: "独孤剑尘",
          path: "project-file://daojie/assets/dugu.png",
        },
        "char-1-grey": {
          id: "char-1-grey",
          name: "灰衫入镇态",
          path: "project-file://daojie/assets/dugu-grey.png",
          parentAssetId: "char-1",
          state: "灰衫入镇态",
          imageWorkflowId: "asset-flow-char-1-grey",
        },
      },
    });

    const assetNode = model.nodes.find((node) => node.id === "assets");
    const derived = assetNode?.assetGroups?.find((group) => group.source.id === "char-1")?.derived[0];
    expect(derived).toMatchObject({
      id: "char-1-grey",
      imageWorkflowId: "asset-flow-char-1-grey",
      sourceImagePath: "project-file://daojie/assets/dugu.png",
      imageWorkflowTarget: {
        kind: "asset",
        assetType: "character",
        parentId: "char-1",
        id: "char-1-grey",
      },
    });
  });

  it("links Toonflow numeric assetsId derivatives back to MYStudio parent assets", () => {
    const entityExtractions = [
      {
        id: "extract-1",
        episodeId: "chapter-001",
        characters: [],
        scenes: [{ sceneId: "scene-1", name: "道口镇街口" }],
        props: [],
      },
    ];
    const scriptPlans = [
      {
        id: "plan-1",
        episodeId: "chapter-001",
        theme: "",
        visualStyle: "",
        narrativeRhythm: "",
        sceneIntents: [],
        soundDirection: "",
        transitions: "",
        derivedAssetPlan: [
          {
            parentAssetId: "2521",
            toonflowAssetsId: 2521,
            state: "晨雾版",
            reason: "Toonflow 衍生资产已有父资产数字 ID",
          },
        ],
      },
    ];

    const model = buildProductionFlowModel({
      agentWorkData: [],
      entityExtractions,
      scriptPlans,
      storyboards: [],
      productionTracks: [],
      videoCandidates: [],
      assetMediaById: {
        "toonflow-db:2521": {
          id: "toonflow-db:2521",
          name: "道口镇街口",
          path: "toonflow-asset://oss/1/assets/scene/base.png",
          toonflowAssetId: 2521,
        },
        "toonflow-db:3230": {
          id: "toonflow-db:3230",
          name: "晨雾版",
          path: "toonflow-asset://oss/1/assets/scene/fog.png",
          state: "晨雾版",
          reason: "已有 Toonflow 子资产",
          parentAssetId: "toonflow-db:2521",
          toonflowAssetId: 3230,
          toonflowParentAssetId: 2521,
          imageWorkflowId: "1",
        },
      },
    });

    const assetNode = model.nodes.find((node) => node.id === "assets");
    const group = assetNode?.assetGroups?.find((item) => item.source.id === "scene-1");
    expect(group?.source.mediaPath).toBe("toonflow-asset://oss/1/assets/scene/base.png");
    expect(group?.derived[0]).toMatchObject({
      id: "scene-1:晨雾版",
      name: "晨雾版",
      parentAssetId: "scene-1",
      mediaPath: "toonflow-asset://oss/1/assets/scene/fog.png",
      imageWorkflowId: "1",
      sourceImagePath: "toonflow-asset://oss/1/assets/scene/base.png",
    });
    expect(assetNode?.assetSummary).toMatchObject({
      planned: 1,
      linked: 1,
      completed: 1,
      missingParent: 0,
    });
  });

  it("includes Toonflow numeric derived states in asset library match names", () => {
    const entityExtractions = [
      {
        id: "extract-1",
        episodeId: "chapter-001",
        characters: [],
        scenes: [{ sceneId: "scene-1", name: "道口镇街口" }],
        props: [],
      },
    ];
    const scriptPlans = [
      {
        id: "plan-1",
        episodeId: "chapter-001",
        theme: "",
        visualStyle: "",
        narrativeRhythm: "",
        sceneIntents: [],
        soundDirection: "",
        transitions: "",
        derivedAssetPlan: [
          {
            parentAssetId: "2521",
            toonflowAssetsId: 2521,
            state: "晨雾版",
            reason: "Toonflow 衍生资产已有父资产数字 ID",
          },
        ],
      },
    ];

    const matchNames = buildAssetLibraryMatchNamesForProductionFlow({
      entityExtractions,
      scriptPlans,
    });

    expect(matchNames.scene).toContain("道口镇街口");
    expect(matchNames.scene).toContain("晨雾版");
  });
});
