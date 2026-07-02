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
    expect(hookSource).toContain("buildProductionFlowModel({");
  });

  it("keeps image workflow files in project-scoped storage instead of the asset library", () => {
    const canvasSource = readFileSync(
      fileURLToPath(new URL("./ImageWorkflowCanvas.tsx", import.meta.url)),
      "utf8",
    );

    expect(canvasSource).toContain("window.projectFiles?.writeBinary");
    expect(canvasSource).toContain("window.projectFiles?.saveImage");
    expect(canvasSource).toContain("project-file://");
    expect(canvasSource).not.toContain("saveImageToLocal");
    expect(canvasSource).not.toContain("window.studioAssets?.saveMaterial");
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
        new URL("../../../stores/studio-store.ts", import.meta.url),
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
    const previewSource = readFileSync(
      fileURLToPath(new URL("./WorkflowNodePreviews.tsx", import.meta.url)),
      "utf8",
    );
    const flowUiSource = [canvasSource, productionNodeSource, previewSource].join("\n");
    const modelSource = readFileSync(
      fileURLToPath(new URL("./workflow-node-model.ts", import.meta.url)),
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

    expect(indexSource).toContain("WorkflowNodeCanvas");
    expect(indexSource).not.toContain('TabsContent value="flow"');
    expect(indexSource).toContain('ScrollArea className="h-full min-h-0 flex-1 scrollbar-hidden"');
    expect(indexSource).toContain("flex h-full min-h-0 flex-col bg-background p-5");
    expect(indexSource).toContain('value="storyboard"');
    expect(indexSource).toContain("data-[state=active]:flex data-[state=inactive]:hidden");
    expect(indexSource).not.toContain("flex min-h-full flex-col bg-background p-5");
    expect(indexSource).not.toContain("<StoryboardTab");
    expect(indexSource).not.toContain(
      "production-agent-workspace .workflow-node-canvas",
    );
    expect(canvasSource).toContain('@xyflow/react');
    expect(canvasSource).toContain("ReactFlow");
    expect(canvasSource).not.toContain("<Controls");
    expect(canvasSource).toContain("CanvasViewportControls");
    expect(canvasSource).toContain("workflow-node-viewport-controls");
    expect(canvasSource).toContain("bg-card/95");
    expect(canvasSource).toContain("useNodesState");
    expect(canvasSource).toContain("useReactFlow");
    expect(canvasSource).toContain("useOnViewportChange");
    expect(canvasSource).toContain('aria-label="缩小画布"');
    expect(canvasSource).toContain('aria-label="放大画布"');
    expect(canvasSource).toContain('aria-label="适配画布"');
    expect(canvasSource).toContain("{zoomPercent}%");
    expect(canvasSource).toContain("Background");
    expect(canvasSource).toContain("workflow-node-canvas");
    expect(canvasSource).toContain("workflow-node-toolbar");
    expect(canvasSource).toContain("pointer-events-none absolute left-5 top-5 z-30");
    expect(canvasSource).toContain("pointer-events-auto inline-flex h-9");
    expect(canvasSource).toContain("production-flow-reactflow");
    expect(canvasSource).toContain("production-flow-reactflow absolute inset-0");
    expect(productionNodeSource).toContain("data-flow-node-id={data.node.id}");
    expect(productionNodeSource).toContain("script: \"w-[1040px]\"");
    expect(previewSource).toContain("script: \"max-h-[560px]\"");
    expect(canvasSource).toContain("assets: { x: 0, y: 660 }");
    expect(canvasSource).toContain("fitCanvasAfterLayout");
    expect(canvasSource).toContain("onInit={(instance)");
    expect(productionNodeSource).toContain('id="script-assets-source"');
    expect(canvasSource).toContain('sourceHandle:');
    expect(canvasSource).toContain('targetHandle: `${target}-target`');
    expect(canvasSource).toContain('source === "script" && target === "assets"');
    expect(flowUiSource).not.toContain('role="button"');
    expect(flowUiSource).not.toContain("onClick={() => data.onStageChange(data.node.targetStage)}");
    expect(productionNodeSource).toContain("进入");
    expect(productionNodeSource).toContain("编辑");
    expect(productionNodeSource).toContain("Edit3");
    expect(canvasSource).toContain("onNodeEdit?: (nodeId: ProductionFlowNodeId) => void");
    expect(productionNodeSource).toContain("data.onNodeEdit?.(data.node.id)");
    expect(productionNodeSource).toContain("data.onStageChange(data.node.targetStage)");
    expect(canvasSource).not.toContain("workflow-node-connector");
    for (const node of [
      "script",
      "scriptPlan",
      "assets",
      "storyboardTable",
      "storyboard",
      "workbench",
    ]) {
      expect(modelSource).toContain(`"${node}"`);
    }
    for (const edge of [
      '["script", "scriptPlan"]',
      '["script", "assets"]',
      '["scriptPlan", "storyboardTable"]',
      '["storyboardTable", "storyboard"]',
      '["storyboard", "workbench"]',
    ]) {
      expect(modelSource).toContain(edge);
    }
    expect(canvasSource).toContain("production-video-stage");
    expect(canvasSource).not.toContain("production-agent-panel");
    expect(canvasSource).not.toContain("ProductionAgent");
    expect(productionNodeSource).toContain("data.node.previewTitle");
    expect(productionNodeSource).toContain("StoryboardTablePreview");
    expect(productionNodeSource).toContain("StoryboardGridPreview");
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
    expect(previewSource).toContain("max-h-[320px] overflow-y-auto");
    expect(previewSource).toContain("nodrag nowheel max-h-[320px] overflow-y-auto");
    expect(flowUiSource).not.toContain("min-h-0 flex-1 space-y-4 overflow-y-auto");
    expect(flowUiSource).not.toContain("space-y-1.5 overflow-hidden text-[11px]");
    expect(flowUiSource).not.toContain("max-h-[430px] overflow-hidden rounded");
    expect(productionNodeSource).toContain("data.node.actions?.length");
    expect(productionNodeSource).toContain("data.onNodeAction?.({");
    expect(productionNodeSource).toContain("runningActionId");
    expect(productionNodeSource).toContain("正在提交本节点 AI 任务");
    expect(productionNodeSource).toContain("生成中");
    expect(productionNodeSource).toContain("<textarea");
    expect(productionNodeSource).toContain("action.promptPlaceholder");
    expect(productionNodeSource).toContain("userInstruction");
    expect(productionNodeSource).toContain("输入内容会附加到本次 AI 任务");
    expect(productionNodeSource).toContain("nodrag nopan nowheel");
    expect(productionNodeSource).toContain("onPointerDown={(event) => event.stopPropagation()}");
    expect(modelSource).toContain("generate-director-plan");
    expect(modelSource).toContain("generate-storyboard-table");
    expect(viewModelSource).toContain("useProductionPlanningActions");
    expect(productionPlanningHookSource).toContain("handleDirectorPlan");
    expect(productionPlanningHookSource).toContain("handleStoryboardTable");
    expect(productionPlanningHookSource).toContain("【本次节点补充要求】");
    expect(productionPlanningHookSource).toContain("buildStoryboardTableMessages");
    expect(productionPlanningHookSource).toContain("parseStoryboardTable");
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
    expect(modelSource).toContain('previewTextLines(flowData.script, "暂无剧本内容", 220)');
    expect(modelSource).toContain('previewKind: "table"');
    expect(modelSource).toContain('previewKind: "storyboard-grid"');
    expect(modelSource).toContain("parseStoryboardTable");
    expect(modelSource).toContain('previewTitle: "剧本内容"');
    expect(modelSource).toContain('previewTitle: "导演规划"');
    expect(modelSource).toContain('previewTextLines(flowData.scriptPlan, "暂无导演规划", 80)');
    expect(modelSource).toContain('previewTitle: "剧本资产"');
    expect(modelSource).toContain('label: "衍生资产"');
    expect(modelSource).toContain('previewTitle: "分镜表"');
    expect(modelSource).toContain('previewTitle: "分镜面板"');
    expect(modelSource).toContain('previewTitle: "视频工作台"');
    expect(canvasSource).toContain("fitView");
    expect(canvasSource).toContain("grid h-full min-h-[calc(100vh-190px)] w-full flex-1");
    expect(canvasSource).not.toContain("h-[calc(100vh-176px)]");
    expect(canvasSource).not.toContain("h-[760px]");
    expect(canvasSource).toContain("panOnDrag={[0]}");
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
    expect(statusSource).toContain("bg-emerald-500/8");
    expect(statusSource).toContain("bg-amber-500/12");
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
