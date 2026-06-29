import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { WORKFLOW_TABS, resolveVisibleWorkflowStage } from "./index";

describe("studio workflow tabs", () => {
  it("keeps model configuration out of the workflow navigation", () => {
    expect(WORKFLOW_TABS.map((tab) => tab.value)).toEqual([
      "manuals",
      "novel",
      "script",
      "assets",
      "generation",
      "storyboard",
      "workbench",
    ]);
    expect(WORKFLOW_TABS.map((tab) => tab.label)).toEqual([
      "风格与导演",
      "小说导入",
      "策划编剧",
      "剧本资产提取",
      "剧本资产管理",
      "分镜视频生成",
      "视频工作台",
    ]);
    expect(WORKFLOW_TABS.some((tab) => tab.label === "配置中心")).toBe(false);
    expect(WORKFLOW_TABS.some((tab) => tab.value === "skill")).toBe(false);
  });

  it("falls back to the first visible workflow tab for hidden or stale persisted stages", () => {
    expect(resolveVisibleWorkflowStage("generation")).toBe("generation");
    expect(resolveVisibleWorkflowStage("flow")).toBe("storyboard");
    expect(resolveVisibleWorkflowStage("skill")).toBe("manuals");
    expect(resolveVisibleWorkflowStage("unknown-stage")).toBe("manuals");
    expect(resolveVisibleWorkflowStage(undefined)).toBe("manuals");
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
    const canvasSource = readFileSync(
      fileURLToPath(new URL("./WorkflowNodeCanvas.tsx", import.meta.url)),
      "utf8",
    );
    const modelSource = readFileSync(
      fileURLToPath(new URL("./workflow-node-model.ts", import.meta.url)),
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
    expect(canvasSource).toContain("Controls");
    expect(canvasSource).toContain("CanvasViewportControls");
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
    expect(canvasSource).toContain("data-flow-node-id={data.node.id}");
    expect(canvasSource).toContain("script: \"w-[1040px]\"");
    expect(canvasSource).toContain("script: \"max-h-[560px]\"");
    expect(canvasSource).toContain("assets: { x: 0, y: 660 }");
    expect(canvasSource).toContain("fitCanvasAfterLayout");
    expect(canvasSource).toContain("onInit={(instance)");
    expect(canvasSource).toContain('id="script-assets-source"');
    expect(canvasSource).toContain('sourceHandle:');
    expect(canvasSource).toContain('targetHandle: `${target}-target`');
    expect(canvasSource).toContain('source === "script" && target === "assets"');
    expect(canvasSource).not.toContain('role="button"');
    expect(canvasSource).not.toContain("onClick={() => data.onStageChange(data.node.targetStage)}");
    expect(canvasSource).toContain("进入");
    expect(canvasSource).toContain("编辑");
    expect(canvasSource).toContain("Edit3");
    expect(canvasSource).toContain("onNodeEdit?: (nodeId: ProductionFlowNodeId) => void");
    expect(canvasSource).toContain("data.onNodeEdit?.(data.node.id)");
    expect(canvasSource).toContain("data.onStageChange(data.node.targetStage)");
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
    expect(canvasSource).toContain("data.node.previewTitle");
    expect(canvasSource).toContain("StoryboardTablePreview");
    expect(canvasSource).toContain("StoryboardGridPreview");
    expect(canvasSource).not.toContain("max-h-[calc(100vh-210px)] overflow-y-auto");
    expect(canvasSource).toContain("workflow-node-titlebar");
    expect(canvasSource).toContain("nowheel");
    expect(canvasSource).toContain("space-y-1.5 overflow-y-auto");
    expect(canvasSource).toContain("nodrag nopan nowheel space-y-1.5 overflow-y-auto");
    expect(canvasSource).toContain('scriptPlan: "h-[520px]"');
    expect(canvasSource).toContain('node.id === "scriptPlan"');
    expect(canvasSource).toContain("max-h-[430px] overflow-auto");
    expect(canvasSource).toContain("nodrag nowheel max-h-[430px] overflow-auto");
    expect(canvasSource).toContain("min-w-[1920px]");
    expect(canvasSource).toContain("关联资产名称");
    expect(canvasSource).toContain("角色动作");
    expect(canvasSource).toContain("空间关系");
    expect(canvasSource).toContain("关联资产ID");
    expect(canvasSource).toContain("row.title");
    expect(canvasSource).toContain("row.titleEn");
    expect(canvasSource).toContain("sticky top-0");
    expect(canvasSource).toContain("max-h-[320px] overflow-y-auto");
    expect(canvasSource).toContain("nodrag nowheel max-h-[320px] overflow-y-auto");
    expect(canvasSource).not.toContain("min-h-0 flex-1 space-y-4 overflow-y-auto");
    expect(canvasSource).not.toContain("space-y-1.5 overflow-hidden text-[11px]");
    expect(canvasSource).not.toContain("max-h-[430px] overflow-hidden rounded");
    expect(canvasSource).toContain("data.node.actions?.length");
    expect(canvasSource).toContain("data.onNodeAction?.({");
    expect(canvasSource).toContain("runningActionId");
    expect(canvasSource).toContain("正在提交本节点 AI 任务");
    expect(canvasSource).toContain("生成中");
    expect(canvasSource).toContain("<textarea");
    expect(canvasSource).toContain("action.promptPlaceholder");
    expect(canvasSource).toContain("userInstruction");
    expect(canvasSource).toContain("输入内容会附加到本次 AI 任务");
    expect(canvasSource).toContain("nodrag nopan nowheel");
    expect(canvasSource).toContain("onPointerDown={(event) => event.stopPropagation()}");
    expect(modelSource).toContain("generate-director-plan");
    expect(modelSource).toContain("generate-storyboard-table");
    expect(indexSource).toContain("handleDirectorPlan(productionEpisodeId, action.userInstruction");
    expect(indexSource).toContain("handleStoryboardTable");
    expect(indexSource).toContain("【本次节点补充要求】");
    expect(indexSource).toContain("buildStoryboardTableMessages");
    expect(indexSource).toContain("parseStoryboardTable");
    expect(indexSource).toContain("toStoryboardItems");
    expect(indexSource).toContain("editingWorkflowNodeId");
    expect(indexSource).toContain("workflowNodeDraft");
    expect(indexSource).toContain("handleWorkflowNodeEditSave");
    expect(indexSource).toContain("saveAgentWorkData(\"storyboardTable\"");
    expect(indexSource).toContain("MdEditor");
    expect(indexSource).toContain("readOnly={!workflowNodeEditWritable}");
    expect(indexSource).toContain("编辑当前节点 FlowData Markdown");
    expect(canvasSource).toContain("node.previewLines.map");
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
    const source = readFileSync(
      fileURLToPath(new URL("./index.tsx", import.meta.url)),
      "utf8",
    );

    expect(source).toContain("WorkflowStageStatusBar");
    expect(source).toContain("buildWorkflowReadiness");
    expect(source).toContain("当前所在：");
    expect(source).toContain("待推进：");
    expect(source).toContain("DropdownMenu");
    expect(source).toContain("当前阶段：");
    expect(source).toContain("选择工作流阶段");
    expect(source).not.toContain("进入待处理阶段");
    expect(source).toContain("bg-emerald-500/8");
    expect(source).toContain("bg-amber-500/12");
    expect(source).not.toContain("点击当前阶段按钮可展开全部阶段");
    expect(source).toContain("onStageChange={handleStageChange}");
    expect(source).not.toContain('onClick={() => onStageChange("flow")}');
    expect(source).toContain("readiness.stages.map");
    expect(source).toContain("onClick={() => onStageChange(stage.id)}");
    expect(source).not.toContain("WorkflowStageCard");
    expect(source).not.toContain("StageCard");
    expect(source).not.toContain("TabsTrigger");
  });
});
