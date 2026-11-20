import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { WORKFLOW_TABS, resolveVisibleWorkflowStage } from "./workflow-tabs";

describe("studio workflow tabs", () => {
  it("keeps model configuration out of the workflow navigation", () => {
    // 1120 分镜面板退役:storyboardPanel 条目摘除(功能迁引擎节点动作)
    expect(WORKFLOW_TABS.map((tab) => tab.value)).toEqual([
      "manuals",
      "novel",
      "script",
      "assets",
      "storyboard",
      "imageWorkflow",
      "workbench",
    ]);
    expect(WORKFLOW_TABS.map((tab) => tab.label)).toEqual([
      "风格与导演",
      "小说导入",
      "剧本生产阶段",
      "剧本资产管理",
      "分镜视频生成",
      "图像节点图",
      "视频工作台",
    ]);
    expect(WORKFLOW_TABS.some((tab) => tab.label === "配置中心")).toBe(false);
    expect(WORKFLOW_TABS.some((tab) => tab.label === "策划编剧")).toBe(false);
    expect(WORKFLOW_TABS.some((tab) => tab.value === "skill")).toBe(false);
    expect(WORKFLOW_TABS.some((tab) => tab.value === "storyboardPanel")).toBe(false);
  });

  it("falls back to the first visible workflow tab for hidden or stale persisted stages", () => {
    expect(resolveVisibleWorkflowStage("generation")).toBe("assets");
    expect(resolveVisibleWorkflowStage("flow")).toBe("storyboard");
    expect(resolveVisibleWorkflowStage("skill")).toBe("manuals");
    expect(resolveVisibleWorkflowStage("unknown-stage")).toBe("manuals");
    expect(resolveVisibleWorkflowStage(undefined)).toBe("manuals");
    // 1120 分镜面板退役:存量落盘 storyboardPanel 水合回落分镜画布
    // (零迁移成本根修:不回落 manuals 即不触发手册门禁 toast)
    expect(resolveVisibleWorkflowStage("storyboardPanel")).toBe("storyboard");
  });

  it("routes workflow orchestration through the studio view model hook", () => {
    const indexSource = readFileSync(
      fileURLToPath(new URL("../index.tsx", import.meta.url)),
      "utf8",
    );
    const viewModelSource = readFileSync(
      fileURLToPath(
        new URL("../useStudioViewModel.ts", import.meta.url),
      ),
      "utf8",
    );
    const hookSource = readFileSync(
      fileURLToPath(new URL("./useWorkflowStageState.ts", import.meta.url)),
      "utf8",
    );

    expect(indexSource).toContain("useStudioViewModel");
    expect(indexSource).not.toContain("useWorkflowStageState");
    // 1120 口径更新:面板退役后 StudioView 直用 useStudioStore 承载迁入的
    // 组件级消费(版本对候选订阅/混音直写 updateStoryboard,原在面板组件);
    // 阶段路由数据面仍禁直连(下三行负向钉保留)
    expect(indexSource).not.toContain("useWorkflowStageState");
    expect(indexSource).not.toContain("useProjectStore");
    expect(indexSource).not.toContain("setActiveWorkflowTab");
    expect(indexSource).not.toContain("prevProjectIdRef");
    expect(viewModelSource).toContain("useWorkflowStageState");
    expect(viewModelSource).toContain("useStudioStore");
    expect(viewModelSource).toContain("useProjectStore");
    expect(hookSource).toContain("setActiveWorkflowTab");
    expect(hookSource).toContain("prevProjectIdRef");
    expect(hookSource).toContain("请先选择视觉风格与导演手册");
  });

  it("wires one-click chapter video status, failure, and final output through the shared runner", () => {
    const indexSource = readFileSync(
      fileURLToPath(new URL("../index.tsx", import.meta.url)),
      "utf8",
    );
    const viewModelSource = readFileSync(
      fileURLToPath(new URL("../useStudioViewModel.ts", import.meta.url)),
      "utf8",
    );
    const hookSource = readFileSync(
      fileURLToPath(new URL("../useChapterAutoVideoActions.ts", import.meta.url)),
      "utf8",
    );
    // 1120 面板退役:章视频接线迁引擎节点动作(载荷 storyboard-pipeline-comfy)
    const pipelineSource = readFileSync(
      fileURLToPath(new URL("../../../../lib/assist/image-studio/storyboard-pipeline-comfy.ts", import.meta.url)),
      "utf8",
    );

    expect(viewModelSource).toContain("useChapterAutoVideoActions");
    expect(viewModelSource).toContain("chapterAutoVideoStatus");
    expect(viewModelSource).toContain("handleRunChapterAutoVideo");
    expect(viewModelSource).toContain("enqueue-remotion-shots");
    expect(viewModelSource).toContain("handleOpenFinalVideo");
    // 1120 章视频接线新宿主:运行出口=桥 generate-videos(宿主 onGenerateVideos
    // 同链 handleRunChapterAutoVideo);成品打开=桥 open-final-video(宿主按
    // finalPath 幂等,无成品 toast)
    expect(indexSource).toContain("onGenerateVideos: () => {");
    expect(indexSource).toContain("handleRunChapterAutoVideo");
    expect(indexSource).toContain("onOpenFinalVideo: () => {");
    expect(indexSource).toContain("viewModel.chapterAutoVideoStatus?.finalPath");
    expect(pipelineSource).toContain('kind: "generate-videos"');
    expect(pipelineSource).toContain('kind: "open-final-video"');
    expect(pipelineSource).toContain("一键生成所有视频");
    expect(pipelineSource).toContain("打开预看成片");
    expect(hookSource).toContain("runChapterAutoVideo");
    expect(hookSource).toContain("runStoryboardTtsGeneration");
    expect(hookSource).toContain("buildRemotionShotPlans");
    expect(hookSource).toContain("createReadyShotJob");
    expect(hookSource).toContain("window.remotionQueue");
    expect(hookSource).not.toContain("runProductionEpisodeMerge");
    expect(hookSource).toContain("window.electronAPI?.openPath(status.finalPath)");
  });

  it("builds the production flow model through the split hook", () => {
    const indexSource = readFileSync(
      fileURLToPath(new URL("../index.tsx", import.meta.url)),
      "utf8",
    );
    const hookSource = readFileSync(
      fileURLToPath(new URL("../useProductionFlowModel.ts", import.meta.url)),
      "utf8",
    );

    expect(indexSource).toContain("useStudioViewModel");
    expect(indexSource).not.toContain("useProductionFlowModel");
    expect(indexSource).not.toContain("buildWorkbenchAssetMediaMap");
    expect(indexSource).not.toContain("buildProductionFlowModel({");
    expect(hookSource).toContain("buildWorkbenchAssetMediaMap");
    expect(hookSource).toContain("getStudioAssetsBridge()?.batchMatch");
    expect(hookSource).toContain("buildAssetLibraryMatchNamesForProductionFlow");
    expect(hookSource).toContain("buildAssetLibraryMediaMapForProductionFlow");
    expect(hookSource).not.toContain("window.studioAssets?.saveMaterial");
    expect(hookSource).not.toContain("window.studioAssets?.add");
    expect(hookSource).not.toContain("window.studioAssets?.addImage");
    expect(hookSource).toContain("buildProductionFlowModel({");
  });

  it("keeps workflow generation data from automatically matching the independent asset library", () => {
    const hookSource = readFileSync(
      fileURLToPath(
        new URL("../useScriptAssetGenerationData.ts", import.meta.url),
      ),
      "utf8",
    );

    expect(hookSource).not.toContain("window.studioAssets");
    expect(hookSource).not.toContain("batchMatch");
    expect(hookSource).not.toContain("toRuntimeAssetType");
  });
});
