import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { WORKFLOW_TABS, resolveVisibleWorkflowStage } from "./workflow-tabs";

describe("studio workflow tabs", () => {
  it("keeps model configuration out of the workflow navigation", () => {
    expect(WORKFLOW_TABS.map((tab) => tab.value)).toEqual([
      "manuals",
      "novel",
      "script",
      "assets",
      "storyboard",
      "storyboardPanel",
      "imageWorkflow",
      "workbench",
    ]);
    expect(WORKFLOW_TABS.map((tab) => tab.label)).toEqual([
      "风格与导演",
      "小说导入",
      "剧本生产阶段",
      "剧本资产管理",
      "分镜视频生成",
      "分镜面板",
      "图像节点图",
      "视频工作台",
    ]);
    expect(WORKFLOW_TABS.some((tab) => tab.label === "配置中心")).toBe(false);
    expect(WORKFLOW_TABS.some((tab) => tab.label === "策划编剧")).toBe(false);
    expect(WORKFLOW_TABS.some((tab) => tab.value === "skill")).toBe(false);
  });

  it("falls back to the first visible workflow tab for hidden or stale persisted stages", () => {
    expect(resolveVisibleWorkflowStage("generation")).toBe("assets");
    expect(resolveVisibleWorkflowStage("flow")).toBe("storyboard");
    expect(resolveVisibleWorkflowStage("skill")).toBe("manuals");
    expect(resolveVisibleWorkflowStage("unknown-stage")).toBe("manuals");
    expect(resolveVisibleWorkflowStage(undefined)).toBe("manuals");
  });

  it("routes workflow orchestration through the studio view model hook", () => {
    const indexSource = readFileSync(
      fileURLToPath(new URL("./index.tsx", import.meta.url)),
      "utf8",
    );
    const viewModelSource = readFileSync(
      fileURLToPath(
        new URL("./useStudioViewModel.ts", import.meta.url),
      ),
      "utf8",
    );
    const hookSource = readFileSync(
      fileURLToPath(new URL("./useWorkflowStageState.ts", import.meta.url)),
      "utf8",
    );

    expect(indexSource).toContain("useStudioViewModel");
    expect(indexSource).not.toContain("useWorkflowStageState");
    expect(indexSource).not.toContain("useStudioStore");
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
      fileURLToPath(new URL("./index.tsx", import.meta.url)),
      "utf8",
    );
    const viewModelSource = readFileSync(
      fileURLToPath(new URL("./useStudioViewModel.ts", import.meta.url)),
      "utf8",
    );
    const hookSource = readFileSync(
      fileURLToPath(new URL("./useChapterAutoVideoActions.ts", import.meta.url)),
      "utf8",
    );
    // 09-09 批8:主画布退役,章视频/超分接线迁入 StoryboardPanelTab(index.tsx 注入)
    const canvasSource = readFileSync(
      fileURLToPath(new URL("./StoryboardPanelTab.tsx", import.meta.url)),
      "utf8",
    );

    expect(viewModelSource).toContain("useChapterAutoVideoActions");
    expect(viewModelSource).toContain("chapterAutoVideoStatus");
    expect(viewModelSource).toContain("handleRunChapterAutoVideo");
    expect(viewModelSource).toContain("enqueue-remotion-shots");
    expect(viewModelSource).toContain("handleOpenFinalVideo");
    // 09-09 批8:章视频状态经 index.tsx 注入 StoryboardPanelTab.chapterAutoVideo;
    // 成片按钮文案迁面板(一键章视频/章视频合成中/打开章视频)
    expect(indexSource).toContain("status: viewModel.chapterAutoVideoStatus");
    expect(indexSource).toContain("run: () => void viewModel.handleRunChapterAutoVideo()");
    expect(indexSource).toContain("openFinal: viewModel.handleOpenFinalVideo");
    expect(canvasSource).toContain("一键章视频");
    expect(canvasSource).toContain("章视频合成中");
    expect(canvasSource).toContain("打开章视频");
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
      fileURLToPath(new URL("./index.tsx", import.meta.url)),
      "utf8",
    );
    const hookSource = readFileSync(
      fileURLToPath(new URL("./useProductionFlowModel.ts", import.meta.url)),
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
        new URL("./useScriptAssetGenerationData.ts", import.meta.url),
      ),
      "utf8",
    );

    expect(hookSource).not.toContain("window.studioAssets");
    expect(hookSource).not.toContain("batchMatch");
    expect(hookSource).not.toContain("toRuntimeAssetType");
  });
});
