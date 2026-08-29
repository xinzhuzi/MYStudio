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
    const canvasSource = readFileSync(
      fileURLToPath(new URL("./WorkflowNodeCanvas.tsx", import.meta.url)),
      "utf8",
    );

    expect(viewModelSource).toContain("useChapterAutoVideoActions");
    expect(viewModelSource).toContain("chapterAutoVideoStatus");
    expect(viewModelSource).toContain("handleRunChapterAutoVideo");
    expect(viewModelSource).toContain("enqueue-remotion-shots");
    expect(viewModelSource).toContain("handleOpenFinalVideo");
    expect(indexSource).toContain("chapterAutoVideoStatus={viewModel.chapterAutoVideoStatus}");
    expect(indexSource).toContain("onRunChapterAutoVideo={viewModel.handleRunChapterAutoVideo}");
    expect(indexSource).toContain("onOpenFinalVideo={viewModel.handleOpenFinalVideo}");
    expect(canvasSource).toContain("一键第一章成片");
    expect(canvasSource).toContain("第一章成片中");
    expect(canvasSource).toContain("失败：${chapterAutoVideoStatus.error}");
    expect(canvasSource).toContain("chapterAutoVideoStatus?.finalPath");
    expect(canvasSource).toMatch(
      /<span[^>]*break-all[^>]*>\s*\{chapterAutoVideoStatus\.finalPath\}\s*<\/span>/,
    );
    expect(canvasSource).toContain("void onOpenFinalVideo?.()");
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

  it("keeps image workflow files in project-scoped storage instead of the asset library", () => {
    const canvasSource = readFileSync(
      fileURLToPath(new URL("./image-workflow/ImageWorkflowCanvas.tsx", import.meta.url)),
      "utf8",
    );
    const assetBridgeSource = readFileSync(
      fileURLToPath(new URL("./image-workflow/image-workflow-asset-bridge.ts", import.meta.url)),
      "utf8",
    );
    const generationSource = [
      "./image-workflow/use-image-workflow-generation.ts",
      "./image-workflow/run-image-workflow-node-generation.ts",
    ].map((rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8")).join("\n");
    const actionsSource = readFileSync(
      fileURLToPath(new URL("./image-workflow/use-image-workflow-actions.ts", import.meta.url)),
      "utf8",
    );
    const workflowSource = `${canvasSource}\n${assetBridgeSource}\n${generationSource}\n${actionsSource}`;

    expect(canvasSource).toContain("useImageWorkflowActions");
    expect(actionsSource).toContain("getProjectFilesBridge()?.writeBinary");
    expect(canvasSource).toContain("useImageWorkflowGeneration");
    expect(generationSource).toContain("getProjectFilesBridge()?.saveImage");
    expect(workflowSource).toContain("project-file://");
    expect(canvasSource).toContain("initialAssetContext.imageWorkflowId");
    expect(canvasSource).toContain("useScopedWorkflowLifecycle");
    const lifecycleSource = readFileSync(
      fileURLToPath(new URL("./image-workflow/use-scoped-workflow-lifecycle.ts", import.meta.url)),
      "utf8",
    );
    expect(lifecycleSource).toContain("assetWorkflowContextKey");
    expect(canvasSource).not.toContain("saveImageToLocal");
    expect(canvasSource).not.toContain("window.studioAssets?.saveMaterial");
  });

  it("keeps image workflow detail chrome theme-aware for derived asset drill-down", () => {
    const canvasSource = readFileSync(
      fileURLToPath(new URL("./image-workflow/ImageWorkflowCanvas.tsx", import.meta.url)),
      "utf8",
    );
    const nodeSource = readFileSync(
      fileURLToPath(new URL("./image-workflow/image-workflow-node-card.tsx", import.meta.url)),
      "utf8",
    );
    const sidebarSource = readFileSync(
      fileURLToPath(new URL("./image-workflow/image-workflow-sidebar.tsx", import.meta.url)),
      "utf8",
    );
    const paletteSource = readFileSync(
      fileURLToPath(new URL("./image-workflow/image-workflow-palette.tsx", import.meta.url)),
      "utf8",
    );
    const workflowSource = `${canvasSource}\n${nodeSource}\n${sidebarSource}\n${paletteSource}`;

    expect(canvasSource).toContain("bg-background text-foreground");
    expect(workflowSource).toContain("bg-card/96");
    expect(workflowSource).toContain("text-card-foreground");
    expect(canvasSource).toContain("bg-muted/20");
    expect(canvasSource).toContain('Background color="hsl(var(--border))"');
    expect(canvasSource).toContain("CanvasViewportControls");
    expect(canvasSource).not.toContain("<Controls");
    expect(workflowSource).not.toContain("border-white/");
    expect(workflowSource).not.toContain("bg-black/");
    expect(workflowSource).not.toContain("bg-white/[");
    expect(workflowSource).not.toContain("text-zinc-");
    expect(workflowSource).not.toContain("text-gray-");
    expect(workflowSource).not.toContain("bg-[#181917]");
    expect(workflowSource).not.toContain("bg-[#111210]");
  });

  it("keeps image workflow drill-down navigable and non-blank", () => {
    const canvasSource = readFileSync(
      fileURLToPath(new URL("./image-workflow/ImageWorkflowCanvas.tsx", import.meta.url)),
      "utf8",
    );
    const nodeSource = readFileSync(
      fileURLToPath(new URL("./image-workflow/image-workflow-node-card.tsx", import.meta.url)),
      "utf8",
    );
    const sidebarSource = readFileSync(
      fileURLToPath(new URL("./image-workflow/image-workflow-sidebar.tsx", import.meta.url)),
      "utf8",
    );
    const graphUtilsSource = readFileSync(
      fileURLToPath(new URL("./image-workflow/image-workflow-graph-utils.ts", import.meta.url)),
      "utf8",
    );
    const indexSource = readFileSync(
      fileURLToPath(new URL("./index.tsx", import.meta.url)),
      "utf8",
    );
    const viewModelSource = readFileSync(
      fileURLToPath(new URL("./useStudioViewModel.ts", import.meta.url)),
      "utf8",
    );

    expect(canvasSource).toContain("onBack");
    const toolbarSource = readFileSync(
      fileURLToPath(new URL("./image-workflow/image-workflow-canvas-toolbar.tsx", import.meta.url)),
      "utf8",
    );
    expect(toolbarSource).toContain("返回");
    expect(toolbarSource).not.toContain(["返回", "工作流"].join(""));
    // 08-30 精简裁定:来源/回写目标只留侧栏一处;风格依据折叠;低频操作入「更多」
    expect(toolbarSource).toContain("风格依据 {styleTraceChips.length} 项");
    expect(toolbarSource).toContain('data-image-workflow-more');
    expect(canvasSource).toContain("initialAssetContext?.sourceLabel");
    expect(canvasSource).toContain("workflowWritebackTargetLabel");
    expect(toolbarSource).toContain("运行生成");
    expect(toolbarSource).toContain("写回目标");
    expect(canvasSource).toContain("isScopedWorkflowDetail");
    expect(canvasSource).toContain("canUseGlobalWorkflowControls");
    expect(sidebarSource).toContain("data-scoped-image-workflow-summary");
    expect(nodeSource).toContain("data-toonflow-generated-prompt-panel");
    expect(nodeSource).toContain("data-toonflow-generated-prompt-textarea");
    expect(graphUtilsSource).toContain("findLinkedPromptNodeForGenerated");
    expect(canvasSource).toContain("w-full flex-1 grid-cols-[minmax(0,1fr)_320px]");
    expect(canvasSource).toContain("当前图片工作流没有节点");
    expect(graphUtilsSource).toContain("context.sourceImagePath || context.resultImagePath");
    expect(graphUtilsSource).toContain("当前分镜参考图");
    expect(canvasSource).toContain("flowInstance?.fitView");
    expect(graphUtilsSource).toContain("focusNodeIdsForGenerated");
    // 08-30 裁定:fitView 只在换流/打开时触发,选中/节点数不再驱动
    // (旧标记 focusedFitNodeKey 已拆,新稳定键=initialAssetContextKey)
    expect(canvasSource).toContain("initialAssetContextKey");
    expect(graphUtilsSource).toContain("slice(0, 3)");
    expect(indexSource).toContain("onBack={viewModel.closeAssetImageWorkflow}");
    expect(viewModelSource).toContain("closeAssetImageWorkflow");
  });

  it("keeps drill-down image workflow detail scoped to the opened node", () => {
    const canvasSource = readFileSync(
      fileURLToPath(new URL("./image-workflow/ImageWorkflowCanvas.tsx", import.meta.url)),
      "utf8",
    );
    const graphUtilsSource = readFileSync(
      fileURLToPath(new URL("./image-workflow/image-workflow-graph-utils.ts", import.meta.url)),
      "utf8",
    );
    const scopedPendingSource = readFileSync(
      fileURLToPath(new URL("./image-workflow/image-workflow-scoped-pending.tsx", import.meta.url)),
      "utf8",
    );
    const toolbarSource = readFileSync(
      fileURLToPath(new URL("./image-workflow/image-workflow-canvas-toolbar.tsx", import.meta.url)),
      "utf8",
    );

    expect(canvasSource).toContain("const canUseGlobalWorkflowControls = !isScopedWorkflowDetail;");
    expect(canvasSource).toContain("initialAssetContext.imageWorkflowId");
    expect(canvasSource).toContain("findStoryboardWorkflowForContext(imageWorkflows, initialAssetContext)");
    expect(canvasSource).toContain("selectedGraph && selectedGraph.id === scopedWorkflow?.id");
    expect(canvasSource).toContain("scopedPendingWritebackTargetLabel");
    expect(canvasSource).toContain("<ImageWorkflowScopedPending");
    expect(canvasSource).toContain("writebackTargetLabel={scopedPendingWritebackTargetLabel}");
    expect(graphUtilsSource).toContain("openContextTargetLabel");
    expect(toolbarSource).toContain("{canUseGlobalWorkflowControls ? (");
    expect(toolbarSource).toContain("{selectedEdgeId && canUseGlobalWorkflowControls ? (");
    expect(scopedPendingSource).toContain("data-scoped-image-workflow-summary");
    expect(toolbarSource).toContain("data-image-workflow-selector");
    expect(toolbarSource).toContain('optgroup label="本章分镜"');
    // 展示层铁律(08-30 裁定):不同功能模块分组列出,不扁平混排
    expect(toolbarSource).toContain('optgroup label="资产工作流"');
    expect(toolbarSource).toContain('optgroup label="自由工作流"');
    // 合并裁定(2026-08-30):旧流已在持久化层清理,选择器不再分组列出
    expect(toolbarSource).not.toContain("上一代遗留");
    expect(toolbarSource).toContain("data-image-workflow-global-action");
  });

  it("keeps image workflow toolbar actions bound to the opened graph target", () => {
    const canvasSource = readFileSync(
      fileURLToPath(new URL("./image-workflow/ImageWorkflowCanvas.tsx", import.meta.url)),
      "utf8",
    );
    const graphUtilsSource = readFileSync(
      fileURLToPath(new URL("./image-workflow/image-workflow-graph-utils.ts", import.meta.url)),
      "utf8",
    );

    expect(canvasSource).toContain("preferredGeneratedNodeId");
    const lifecycleSource = readFileSync(
      fileURLToPath(new URL("./image-workflow/use-scoped-workflow-lifecycle.ts", import.meta.url)),
      "utf8",
    );
    expect(lifecycleSource).toContain("activeGraphTargetKeyRef");
    expect(lifecycleSource).toContain("resolveOpenContextGeneratedNodeId");
    expect(graphUtilsSource).toContain("context.resultImagePath");
    expect(lifecycleSource).toContain('target: { kind: "free" }');
    expect(lifecycleSource).toContain("setTargetStoryboardId(");
    expect(lifecycleSource).toContain("? activeGraph.target.id");
    expect(lifecycleSource).toContain(": \"\"");
  });

  it("hydrates legacy image workflows with prompt nodes from every entry path", () => {
    const lifecycleSource = readFileSync(
      fileURLToPath(new URL("./image-workflow/use-scoped-workflow-lifecycle.ts", import.meta.url)),
      "utf8",
    );
    expect(lifecycleSource).toContain("ensureImageWorkflowPromptNodes(");
    expect(lifecycleSource).toContain("ensureStoryboardImageResult(activeGraph, storyboardMediaPath)");
    expect(lifecycleSource).toContain("if (ensured !== activeGraph) upsertImageWorkflow(ensured);");
  });

  it("auto-tidies overlapping legacy layouts once per session without fighting manual drags", () => {
    const lifecycleSource = readFileSync(
      fileURLToPath(new URL("./image-workflow/use-scoped-workflow-lifecycle.ts", import.meta.url)),
      "utf8",
    );
    expect(lifecycleSource).toContain("imageWorkflowHasOverlappingCards(ensured)");
    expect(lifecycleSource).toContain("tidyImageWorkflowLayout(ensured)");
    expect(lifecycleSource).toContain("autoTidiedGraphIdsRef");
  });

  it("does not keep the removed Skill conversation implementation mounted", () => {
    const source = readFileSync(
      fileURLToPath(new URL("./index.tsx", import.meta.url)),
      "utf8",
    );

    expect(source).not.toContain('TabsContent value="skill"');
    expect(source).not.toContain("function SkillTab");
    expect(source).not.toContain("Skill 对话任务");
    expect(source).not.toContain("lastContextPackage");
    expect(source).not.toContain("handleBuildContext");
    expect(source).not.toContain("agentDraft");
  });

  it("does not keep removed Skill context preview state in the studio store", () => {
    const source = readFileSync(
      fileURLToPath(
        new URL("../../../stores/studio/studio-store.ts", import.meta.url),
      ),
      "utf8",
    );

    expect(source).not.toContain("lastContextPackage");
    expect(source).not.toContain("buildContext");
    expect(source).not.toContain("buildSkillContextPackage");
  });

  it("renders Toonflow-style nodes inside the storyboard video generation stage", () => {
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
    const canvasSource = readFileSync(
      fileURLToPath(new URL("./WorkflowNodeCanvas.tsx", import.meta.url)),
      "utf8",
    );
    const productionNodeSource = readFileSync(
      fileURLToPath(new URL("./WorkflowProductionNode.tsx", import.meta.url)),
      "utf8",
    );
    const previewSource = [
      "../../ui/local-image.tsx",
      "../../../lib/media/preview-src.ts",
      "previews/text-preview.tsx",
      "previews/asset-derivation-preview.tsx",
      "previews/asset-flow-card.tsx",
      "previews/storyboard-table-preview.tsx",
      "previews/storyboard-grid-preview.tsx",
      "previews/workbench-lane-preview.tsx",
      "previews/remotion-shot-preview.tsx",
    ]
      .map((name) => readFileSync(fileURLToPath(new URL(`./${name}`, import.meta.url)), "utf8"))
      .join("\n");
    const flowUiSource = [canvasSource, productionNodeSource, previewSource].join("\n");
    const modelSource = readFileSync(
      fileURLToPath(new URL("./workflow-node-model.ts", import.meta.url)),
      "utf8",
    );
    const previewModelSource = readFileSync(
      fileURLToPath(
        new URL("./storyboard-preview-model.ts", import.meta.url),
      ),
      "utf8",
    );
    const editDialogSource = readFileSync(
      fileURLToPath(
        new URL("./WorkflowNodeEditDialog.tsx", import.meta.url),
      ),
      "utf8",
    );
    const nodeEditorHookSource = readFileSync(
      fileURLToPath(new URL("./useWorkflowNodeEditor.ts", import.meta.url)),
      "utf8",
    );
    const productionPlanningHookSource = readFileSync(
      fileURLToPath(
        new URL("./useProductionPlanningActions.ts", import.meta.url),
      ),
      "utf8",
    );
    const zoomProbeSource = readFileSync(
      fileURLToPath(
        new URL("../../../../build/smoke/measure-workflow-zoom-performance.mjs", import.meta.url),
      ),
      "utf8",
    );

    expect(indexSource).toContain("WorkflowNodeCanvas");
    expect(indexSource).not.toContain('TabsContent value="flow"');
    expect(indexSource).toContain('ScrollArea className="h-full min-h-0 flex-1 scrollbar-hidden"');
    expect(indexSource).toContain("flex h-full min-h-0 flex-col bg-background p-5");
    expect(indexSource).toContain('value="storyboard"');
    expect(indexSource).toContain("data-[state=active]:flex data-[state=inactive]:hidden");
    expect(indexSource).toContain(
      'isVisible={viewModel.activeWorkflowTab === "storyboard"}',
    );
    expect(indexSource).not.toContain("flex min-h-full flex-col bg-background p-5");
    expect(indexSource).not.toContain("<StoryboardTab");
    expect(indexSource).not.toContain(
      "production-agent-workspace .workflow-node-canvas",
    );
    expect(canvasSource).toContain('@xyflow/react');
    expect(canvasSource).toContain("ReactFlow");
    expect(canvasSource).not.toContain("<Controls");
    expect(canvasSource).toContain("CanvasViewportControls");
    const viewportControlsSource = readFileSync(
      fileURLToPath(new URL("./CanvasViewportControls.tsx", import.meta.url)),
      "utf8",
    );
    expect(viewportControlsSource).toContain("workflow-node-viewport-controls");
    expect(viewportControlsSource).toContain("bg-card p-1 text-xs text-card-foreground");
    expect(viewportControlsSource).toContain("useReactFlow");
    expect(viewportControlsSource).toContain("useOnViewportChange");
    expect(viewportControlsSource).toContain('aria-label="缩小画布"');
    expect(viewportControlsSource).toContain('aria-label="放大画布"');
    expect(viewportControlsSource).toContain('aria-label="适配画布"');
    expect(canvasSource).toContain("useNodesState");
    expect(canvasSource).toContain("useUpdateNodeInternals");
    expect(canvasSource).toContain("CanvasVisibilityMeasurementRefresh");
    expect(canvasSource).toContain('aria-label="重排当前画布"');
    expect(canvasSource).toContain("const PRODUCTION_CANVAS_MIN_ZOOM = 0.18");
    expect(canvasSource).toContain("const PRODUCTION_CANVAS_MAX_ZOOM = 2.0");
    expect(canvasSource).toContain("maxZoom: 0.72,");
    expect(canvasSource).toContain(
      "flowInstance.fitView({ ...FIT_VIEW_OPTIONS, duration: 0 })",
    );
    expect(canvasSource).toContain("minZoom={PRODUCTION_CANVAS_MIN_ZOOM}");
    expect(canvasSource).toContain("maxZoom={PRODUCTION_CANVAS_MAX_ZOOM}");
    expect(canvasSource).toContain("onlyRenderVisibleElements");
    // 08-30 收敛 Phase2:手势层(打标/门闸/平滑缩放)单源 useCanvasGestureKernel,
    // 主画布以策略注入消费(类名/立即摘标/视口所有权接管)
    expect(canvasSource).toContain("useCanvasGestureKernel({");
    expect(canvasSource).toContain('interactingClass: "workflow-node-canvas-interacting"');
    expect(canvasSource).toContain("classRemovalDelayMs: 0");
    expect(canvasSource).toContain("onUserGestureStart: claimViewportForUser");
    const gestureKernelSource = readFileSync(
      fileURLToPath(new URL("./use-canvas-gesture-kernel.ts", import.meta.url)),
      "utf8",
    );
    expect(gestureKernelSource).toContain('el.classList.add(interactingClass)');
    expect(gestureKernelSource).toContain("interactionDeferBegin()");
    expect(gestureKernelSource).toContain("interactionDeferEnd()");
    expect(viewportControlsSource).toContain("{zoomPercent}%");
    expect(canvasSource).not.toContain("Background,");
    expect(canvasSource).not.toContain("<Background");
    expect(canvasSource).toContain("workflow-node-canvas");
    expect(canvasSource).toContain("workflow-node-static-background");
    expect(canvasSource).toContain("workflow-node-toolbar");
    expect(canvasSource).toContain("pointer-events-none absolute left-5 top-5 z-30");
    expect(canvasSource).toContain("pointer-events-auto inline-flex h-9");
    expect(canvasSource).toContain("production-flow-reactflow");
    expect(canvasSource).toContain("production-flow-reactflow absolute inset-0");
    expect(productionNodeSource).toContain("data-flow-node-id={data.node.id}");
    expect(productionNodeSource).toContain("script: \"w-[1040px]\"");
    expect(previewSource).toContain("script: \"max-h-[560px]\"");
    expect(canvasSource).toContain("PRODUCTION_NODE_WIDTH_PX[");
    expect(canvasSource).toContain("const PRODUCTION_LAYOUT_GUTTER = 200");
    expect(canvasSource).toContain("const PRODUCTION_BRANCH_GUTTER = 200");
    expect(canvasSource).toContain("function measuredProductionPositions");
    expect(canvasSource).toContain("instance.getInternalNode(nodeId)");
    expect(canvasSource).toContain("const hasAllMeasurements = currentNodeIds.every");
    expect(canvasSource).toContain("flowInstance.getInternalNode(nodeId)?.measured");
    expect(canvasSource).toContain("const PRODUCTION_LAYOUT_MEASUREMENT_TIMEOUT_MS = 10_000");
    expect(canvasSource).toContain("const retryMeasurementUntil = performance.now()");
    expect(canvasSource).toContain(
      "pendingLayoutFrameRef.current = window.requestAnimationFrame(applyMeasuredLayout)",
    );
    expect(canvasSource).not.toContain("if (!hasAllMeasurements) return;");
    expect(canvasSource).toContain("function nextProductionNodeX");
    expect(canvasSource).toContain("const scriptPlanX = nextProductionNodeX(\"script\", scriptX, measuredNodes)");
    expect(canvasSource).toContain("const storyboardTableX = nextProductionNodeX(\"scriptPlan\", scriptPlanX, measuredNodes)");
    expect(canvasSource).toContain("const storyboardX = nextProductionNodeX(\"storyboardTable\", storyboardTableX, measuredNodes)");
    expect(canvasSource).toContain("const remotionProductionX = nextProductionNodeX(\"storyboard\", storyboardX, measuredNodes)");
    expect(canvasSource).toContain("const workbenchX = nextProductionNodeX(\"remotionProduction\", remotionProductionX, measuredNodes)");
    expect(canvasSource).toContain("x: centerProductionNodeUnder(\"script\", \"assets\", scriptX, measuredNodes)");
    expect(canvasSource).toContain("type: \"smoothstep\"");
    expect(canvasSource).toContain("interactionWidth: 10");
    expect(canvasSource).toContain("const resetLayout = useCallback");
    expect(canvasSource).toContain("onClick={resetLayout}");
    expect(canvasSource).not.toContain("assets: { x: 0, y: 660 }");
    expect(canvasSource).not.toContain("fitCanvasAfterLayout");
    expect(canvasSource).toContain("onInit={(instance)");
    expect(canvasSource).toContain("pendingLayoutFrameRef");
    expect(canvasSource).toContain("cancelPendingLayoutWork");
    expect(canvasSource).toContain("userViewportOwnedRef");
    expect(canvasSource).toContain("measuredLayoutKeyRef");
    expect(canvasSource).toContain("layoutVersionRef");
    expect(canvasSource).toContain("measuredNodeDimensionsRef");
    expect(canvasSource).toContain("dimensionsChanged");
    // 程序性视口不关闸语义已随手势层收敛进 kernel(if (event) 分支)
    expect(gestureKernelSource).toContain("if (event) {");
    expect(canvasSource).not.toContain("\n          fitView\n");
    expect(productionNodeSource).toContain('id="script-assets-source"');
    expect(canvasSource).toContain('sourceHandle:');
    expect(canvasSource).toContain('targetHandle: `${target}-target`');
    expect(canvasSource).toContain('source === "script" && target === "assets"');
    expect(flowUiSource).not.toContain('role="button"');
    expect(flowUiSource).not.toContain("onClick={() => data.onStageChange(data.node.targetStage)}");
    expect(productionNodeSource).toContain("进入");
    expect(productionNodeSource).toContain("编辑");
    expect(productionNodeSource).toContain("Edit3");
    expect(productionNodeSource).toContain("WRITABLE_NODE_IDS");
    expect(productionNodeSource).toContain("canEditNode");
    expect(productionNodeSource).toContain("canOpenJson");
    expect(productionNodeSource).toContain('data.node.id === "storyboardTable" || data.node.id === "storyboard"');
    expect(productionNodeSource).toContain('data.node.id === "storyboard" ? "Remotion JSON" : "Remotion 分镜源数据"');
    expect(productionNodeSource).toContain("COMPACT_HEADER_NODE_IDS");
    expect(productionNodeSource).toContain('const useCompactHeader = COMPACT_HEADER_NODE_IDS.includes(data.node.id);');
    expect(productionNodeSource).toContain("showStatusChip");
    expect(productionNodeSource).toContain('data.node.status !== "ready" && !useCompactHeader');
    expect(productionNodeSource).not.toContain('data.node.status === "ready" ? "READY" : "TODO"');
    expect(productionNodeSource).not.toContain(
      'mt-0.5 block text-[11px] uppercase tracking-[0.18em]',
    );
    expect(productionNodeSource).not.toContain(
      "rounded-md border border-border bg-muted/30 px-2 py-1",
    );
    expect(canvasSource).toContain("onNodeEdit?: (nodeId: ProductionFlowNodeId) => void");
    expect(canvasSource).toContain("onNodeJson?: (nodeId: ProductionFlowNodeId) => void");
    expect(productionNodeSource).toContain("data.onNodeEdit?.(data.node.id)");
    expect(productionNodeSource).toContain("data.onStageChange(data.node.targetStage)");
    expect(canvasSource).not.toContain("workflow-node-connector");
    for (const node of [
      "script",
      "scriptPlan",
      "assets",
      "storyboardTable",
      "storyboard",
      "remotionProduction",
      "workbench",
    ]) {
      expect(modelSource).toContain(`"${node}"`);
    }
    for (const edge of [
      '["script", "scriptPlan"]',
      '["script", "assets"]',
      '["scriptPlan", "storyboardTable"]',
      '["storyboardTable", "storyboard"]',
      '["storyboard", "remotionProduction"]',
      '["remotionProduction", "workbench"]',
    ]) {
      expect(modelSource).toContain(edge);
    }
    expect(canvasSource).toContain("production-video-stage");
    expect(canvasSource).not.toContain("production-agent-panel");
    expect(canvasSource).not.toContain("ProductionAgent");
    expect(productionNodeSource).toContain("data.node.previewTitle");
    expect(productionNodeSource).toContain("const UNFRAMED_PREVIEW_NODE_IDS");
    expect(productionNodeSource).toContain('"script",');
    expect(productionNodeSource).toContain('"scriptPlan",');
    expect(productionNodeSource).toContain('"storyboardTable",');
    expect(productionNodeSource).toContain("const showPreviewChrome =");
    expect(productionNodeSource).toContain("!UNFRAMED_PREVIEW_NODE_IDS.includes(data.node.id)");
    expect(productionNodeSource).not.toContain(
      'data.node.id !== "scriptPlan" && data.node.id !== "storyboardTable"',
    );
    expect(productionNodeSource).toContain("{showPreviewChrome ? (");
    expect(productionNodeSource).toContain(
      'showPreviewChrome && "rounded-md border border-border bg-muted/20 p-3"',
    );
    expect(productionNodeSource).toContain("NodePointerCard");
    expect(productionNodeSource).toContain("NodePointerCard");
    expect(flowUiSource).not.toContain("max-h-[calc(100vh-210px)] overflow-y-auto");
    expect(productionNodeSource).toContain("workflow-node-titlebar");
    expect(flowUiSource).toContain("nowheel");
    expect(previewSource).toContain("workflow-node-markdown-preview nodrag nopan nowheel overflow-y-auto");
    expect(previewSource).toContain("modelValue={buildPreviewMarkdown(node)}");
    expect(previewSource).toContain("md-editor-preview-transparent");
    expect(previewSource).toContain('scriptPlan: "h-[520px]"');
    expect(previewSource).toContain('node.id === "scriptPlan"');
    expect(previewSource).toContain("max-h-[430px] overflow-auto");
    expect(previewSource).toContain("nodrag nowheel max-h-[430px] overflow-auto");
    expect(previewSource).toContain("min-w-[1920px]");
    expect(previewSource).toContain("关联资产名称");
    expect(previewSource).toContain("角色动作");
    expect(previewSource).toContain("空间关系");
    expect(previewSource).toContain("关联资产ID");
    expect(previewSource).toContain("row.title");
    expect(previewSource).toContain("row.titleEn");
    expect(previewSource).toContain("sticky top-0");
    expect(previewSource).toContain("max-h-[360px] overflow-y-auto");
    expect(previewSource).toContain("nodrag nowheel max-h-[360px] overflow-y-auto");
    expect(previewSource).toContain("grid-cols-[repeat(auto-fit,minmax(132px,1fr))]");
    expect(flowUiSource).not.toContain("min-h-0 flex-1 space-y-4 overflow-y-auto");
    expect(flowUiSource).not.toContain("space-y-1.5 overflow-hidden text-[11px]");
    expect(flowUiSource).not.toContain("max-h-[430px] overflow-hidden rounded");
    expect(productionNodeSource).toContain("data.node.actions?.length");
    expect(productionNodeSource).toContain("data.onNodeAction?.({");
    expect(productionNodeSource).toContain("runningActionId");
    expect(productionNodeSource).toContain("任务已提交，正在等待 AI 返回");
    expect(productionNodeSource).toContain('role="status"');
    expect(productionNodeSource).toContain("正在生成中，请稍候");
    expect(productionNodeSource).toContain("生成期间不能重复提交");
    expect(productionNodeSource).toContain("<textarea");
    expect(productionNodeSource).toContain("action.promptPlaceholder");
    expect(productionNodeSource).toContain("action.showPromptInput !== false");
    expect(productionNodeSource).toContain("action.showPromptInput === false");
    expect(productionNodeSource).toContain("userInstruction");
    expect(productionNodeSource).toContain("输入内容会附加到本次 AI 任务");
    expect(productionNodeSource).toContain("nodrag nopan nowheel");
    expect(productionNodeSource).toContain("onPointerDown={(event) => event.stopPropagation()}");
    expect(modelSource).toContain("generate-director-plan");
    expect(modelSource).toContain("generate-storyboard-table");
    expect(modelSource).toContain("showPromptInput: false");
    expect(viewModelSource).toContain("useProductionPlanningActions");
    expect(productionPlanningHookSource).toContain("handleDirectorPlan");
    expect(productionPlanningHookSource).toContain("handleStoryboardTable");
    expect(productionPlanningHookSource).toContain("【本次节点补充要求】");
    expect(productionPlanningHookSource).toContain("buildStoryboardTableMessages");
    expect(productionPlanningHookSource).toContain("parseStoryboardTable");
    expect(productionPlanningHookSource).toContain("requireShotSemantics: true");
    expect(productionPlanningHookSource).toContain("toStoryboardItems");
    expect(indexSource).toContain("editingWorkflowNodeId");
    expect(indexSource).toContain("workflowNodeDraft");
    expect(indexSource).toContain("saveWorkflowNodeEdit");
    expect(nodeEditorHookSource).toContain("saveWorkflowNodeEdit");
    expect(nodeEditorHookSource).toContain('saveAgentWorkData("directorPlan"');
    expect(nodeEditorHookSource).toContain("saveAgentWorkData(\"storyboardTable\"");
    expect(indexSource).toContain("<WorkflowNodeEditDialog");
    expect(editDialogSource).toContain("MdEditor");
    expect(editDialogSource).toContain("readOnly={!writable}");
    expect(editDialogSource).toContain("编辑当前节点 FlowData Markdown");
    expect(previewSource).toContain("buildPreviewMarkdown");
    expect(modelSource).toContain("previewTextLines");
    expect(modelSource).toContain('previewTextLines(ctx.flowData.script, "暂无剧本内容", 220)');
    expect(modelSource).toContain("const DIRECTOR_PLAN_PREVIEW_MAX_LINES = 600");
    expect(modelSource).toContain('previewKind: "table"');
    expect(modelSource).toContain('previewKind: "storyboard-grid"');
    expect(previewModelSource).toContain("parseStoryboardTable");
    expect(modelSource).toContain('previewTitle: "剧本内容"');
    expect(modelSource).toContain('previewTitle: "导演规划"');
    expect(modelSource).toContain("DIRECTOR_PLAN_PREVIEW_MAX_LINES");
    expect(modelSource).toContain('previewTitle: "剧本资产"');
    expect(modelSource).toContain('label: "衍生资产"');
    expect(modelSource).toContain('previewTitle: "分镜表"');
    expect(modelSource).toContain('previewTitle: "分镜面板"');
    expect(modelSource).toContain('previewTitle: "原生 Remotion Studio"');
    expect(canvasSource).toContain("fitView");
    expect(canvasSource).toContain("grid h-full min-h-[calc(100vh-190px)] w-full flex-1");
    expect(canvasSource).not.toContain("h-[calc(100vh-176px)]");
    expect(canvasSource).not.toContain("h-[760px]");
    expect(canvasSource).toContain("panOnDrag={false}");
    expect(canvasSource).toContain("panOnScroll={false}");
    expect(canvasSource).toContain("zoomOnScroll");
    expect(canvasSource).toContain("zoomOnPinch");
    expect(canvasSource).toContain("nodesDraggable");
    expect(canvasSource).toContain("nodeDragThreshold={2}");
    expect(canvasSource).not.toContain("nodesDraggable={false}");
    expect(canvasSource).toContain("elementsSelectable");
    expect(canvasSource).not.toContain("elementsSelectable={false}");
    expect(canvasSource).toContain("onNodesChange={onNodesChange}");
    expect(canvasSource).not.toContain("nodeDragHandle");
    expect(indexSource).not.toContain("activeValue={activeWorkflowTab}");
    expect(zoomProbeSource).toContain("MYSTUDIO_ZOOM_PROBE_INPUT_REPORT_PATH");
    expect(zoomProbeSource).toContain('report.result?.source !== "real-project-clone"');
    expect(zoomProbeSource).toContain("for (let cycle = 1; cycle <= 5; cycle += 1)");
    expect(zoomProbeSource).toContain('measureRound(cdp, "fit", cycle, child.pid)');
    expect(zoomProbeSource).toContain("nodeRects");
    expect(zoomProbeSource).toContain("overlappingNodePairs");
    expect(zoomProbeSource).toContain("clippedNodeIds");
    expect(zoomProbeSource).toContain("panStability");
  });

  it("keeps the workflow status and stage entry surface above stage content", () => {
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
    const statusSource = readFileSync(
      fileURLToPath(
        new URL("./WorkflowStageStatusBar.tsx", import.meta.url),
      ),
      "utf8",
    );
    const readinessHookSource = readFileSync(
      fileURLToPath(new URL("./useWorkflowReadiness.ts", import.meta.url)),
      "utf8",
    );

    expect(indexSource).toContain("WorkflowStageStatusBar");
    expect(viewModelSource).toContain("useWorkflowReadiness");
    expect(readinessHookSource).toContain("buildWorkflowReadiness");
    expect(statusSource).toContain("待推进：");
    expect(statusSource).toContain("切换阶段");
    expect(statusSource).toContain("DropdownMenu");
    expect(statusSource).toContain("选择工作流阶段");
    expect(statusSource).not.toContain("当前所在：");
    expect(statusSource).not.toContain("当前阶段：");
    expect(statusSource).not.toContain("activeStageReadiness");
    expect(statusSource).not.toContain("进度 {readiness.progress}%");
    expect(statusSource).not.toContain("flex-col gap-3 lg:flex-row");
    expect(statusSource).not.toContain("进入待处理阶段");
    expect(statusSource).toContain("bg-success/8");
    expect(statusSource).toContain("bg-warning/12");
    expect(statusSource).not.toContain("点击当前阶段按钮可展开全部阶段");
    expect(indexSource).toContain("onStageChange={viewModel.handleStageChange}");
    expect(statusSource).not.toContain('onClick={() => onStageChange("flow")}');
    expect(statusSource).toContain("readiness.stages.map");
    expect(statusSource).toContain("onClick={() => onStageChange(stage.id)}");
    expect(statusSource).not.toContain("WorkflowStageCard");
    expect(statusSource).not.toContain("StageCard");
    expect(statusSource).not.toContain("TabsTrigger");
  });
});
