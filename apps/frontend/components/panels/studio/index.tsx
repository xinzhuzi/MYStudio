import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { ManualsTab } from "./ManualsTab";
import { NovelTab } from "./NovelTab";
import { ScriptTab } from "./ScriptTab";
import { StoryboardPanelTab } from "./StoryboardPanelTab";
import { WorkbenchTab } from "./WorkbenchTab";
import { ScriptAssetManagementTab } from "./ScriptAssetManagementTab";
import { ComfyCanvasSwap } from "../assist/comfy-canvas/ComfyCanvasSwap";
import { useStudioViewModel } from "./useStudioViewModel";
import { useState } from "react";
import { NodeDocViewer } from "./NodeDocViewer";
import { ScriptEditorDialog } from "./ScriptEditorDialog";
import { useStoryboardBatchGeneration } from "./image-workflow/use-storyboard-batch-generation";

export function StudioView() {
  const viewModel = useStudioViewModel();
  // 文档弹窗(09-13:环节节点「全文」按钮 → NodeDocViewer 老控件重新接线)
  const [docNodeId, setDocNodeId] = useState<string | null>(null);
  const storyboardBatch = useStoryboardBatchGeneration({
    storyboards: viewModel.chapterStoryboards,
    projectName: viewModel.projectName,
  });
  // 漫影侧栏制作动作宿主侧(09-11 旧画布功能迁移收口):运行中防重入
  const sidebarActions = {
    onGenerateImages: () => {
      if (!storyboardBatch.state.running) storyboardBatch.start();
    },
    onGenerateVideos: () => {
      if (!viewModel.chapterAutoVideoRunning) void viewModel.handleRunChapterAutoVideo();
    },
    // 09-12 功能完备(用户终裁:节点功能要像之前):老画布环节动作回流,
    // 走老画布同款派发器 handleProductionNodeAction(付费生成/重建轨道);
    // note=补充要求(09-12 B1:userInstruction 语义,老画布输入框等价)
    onGenerateDirectorPlan: (note?: string) => {
      void viewModel.handleProductionNodeAction({
        id: "generate-director-plan",
        label: "生成导演规划",
        targetStage: "storyboard",
        userInstruction: note ?? "",
      });
    },
    onGenerateStoryboardTable: (note?: string) => {
      void viewModel.handleProductionNodeAction({
        id: "generate-storyboard-table",
        label: "生成分镜表",
        targetStage: "storyboard",
        userInstruction: note ?? "",
      });
    },
    onRebuildWorkbenchTracks: () => {
      void viewModel.handleProductionNodeAction({
        id: "rebuild-workbench-tracks",
        label: "重建视频轨道",
        targetStage: "workbench",
      });
    },
    // 09-13 用户裁定:节点「全文/编辑」回流——老画布文档弹窗(NodeDocViewer
    // +编辑器状态机)重新接线;note=环节 key
    onViewNodeDoc: (stageKey: string) => {
      setDocNodeId(stageKey);
    },
    onEditNodeDoc: (stageKey: string) => {
      viewModel.openNodeEditor(stageKey as Parameters<typeof viewModel.openNodeEditor>[0]);
    },
  };

  return (
    <div className="studio-workspace studio-workspace-workflow h-full bg-panel">
      <Tabs
        value={viewModel.activeWorkflowTab}
        onValueChange={viewModel.handleStageChange}
        className="flex h-full flex-col"
      >
      {/* 09-10 终裁:唯一悬浮球上提至 Layout 应用层(全视图在场),
          本视图不再单独挂球 */}
      <ScrollArea className="h-full min-h-0 flex-1 scrollbar-hidden">
          {/* 画布阶段(分镜制作/分镜画布)去内边距贴边全屏;内容阶段保留 p-5 */}
          <div
            className={`flex h-full min-h-0 flex-col bg-background ${
              viewModel.activeWorkflowTab === "storyboard" || viewModel.activeWorkflowTab === "imageWorkflow" ? "p-0" : "p-5"
            }`}
          >
            <TabsContent value="novel" className="m-0">
              <NovelTab
                novelDraft={viewModel.novelDraft}
                setNovelDraft={viewModel.setNovelDraft}
                handleNovelFile={viewModel.handleNovelFile}
                appendNovelText={viewModel.appendNovelText}
                replaceNovelText={viewModel.replaceNovelText}
                novelChapters={viewModel.novelChapters}
                updateNovelChapter={viewModel.updateNovelChapter}
                analyzeEvents={viewModel.handleNovelEventAnalysis}
                sourceBible={viewModel.sourceBible}
                saveSourceBible={viewModel.saveSourceBible}
                generateBibleDraft={viewModel.generateSourceBibleDraft}
              />
            </TabsContent>

            <TabsContent value="manuals" className="m-0">
              <ManualsTab
                workflowConfig={viewModel.workflowConfig}
                setWorkflowConfig={viewModel.setWorkflowConfig}
                manualCatalog={viewModel.manualCatalog}
              />
            </TabsContent>

            <TabsContent value="script" className="m-0">
              <ScriptTab
                novelChapters={viewModel.novelChapters}
                agentWorkData={viewModel.agentWorkData}
                saveAgentWorkData={viewModel.saveAgentWorkData}
                runStage={viewModel.handleScriptStage}
                runReview={viewModel.handleStageReview}
                previewStageUserMessage={viewModel.previewStageUserMessage}
                manualContext={viewModel.scriptStyleSummary}
                directorContext={viewModel.scriptDirectorContext}
                styleSummary={viewModel.scriptStyleSummary}
                scriptStreaming={viewModel.scriptStreaming}
              />
            </TabsContent>

            <TabsContent value="assets" className="m-0">
              <ScriptAssetManagementTab
                novelChapters={viewModel.novelChapters}
                agentWorkData={viewModel.agentWorkData}
                entityExtractions={viewModel.entityExtractions}
                extractAssets={viewModel.handleEntityExtraction}
                updateExtraction={viewModel.saveEntityExtraction}
                productionEpisodeId={viewModel.productionEpisodeId}
                scriptPlanCount={viewModel.scriptPlanCount}
                hasSeriesBible={viewModel.hasSeriesBible}
                derivationNode={viewModel.productionFlowNodes.find(
                  (n) => n.previewKind === "asset-derivation",
                )}
                onOpenAssetImageWorkflow={viewModel.openAssetImageWorkflow}
              />
            </TabsContent>

            <TabsContent
              value="storyboard"
              className="m-0 min-h-0 flex-1"
            >
              {/* 09-10 用户裁定:进入工作流阶段即展示本章分镜总览(分镜内容优先);
                  09-11 补裁定:漫影侧栏按模块分内容,工作流模块默认「分镜」页签 */}
              <ComfyCanvasSwap autoOpenOverview manyingScope="workflow" sidebarActions={sidebarActions} stageFlowNodes={viewModel.productionFlowNodes} />
            </TabsContent>

            <TabsContent
              value="storyboardPanel"
              className="m-0 min-h-0 flex-1 data-[state=active]:flex data-[state=inactive]:hidden"
            >
              <StoryboardPanelTab
                storyboards={viewModel.chapterStoryboards}
                onOpenImageWorkflow={viewModel.openAssetImageWorkflow}
                onBackToCanvas={() => viewModel.handleStageChange("storyboard")}
                batch={storyboardBatch}
                chapterAutoVideo={{
                  status: viewModel.chapterAutoVideoStatus,
                  running: viewModel.chapterAutoVideoRunning,
                  run: () => void viewModel.handleRunChapterAutoVideo(),
                  openFinal: viewModel.handleOpenFinalVideo,
                }}
              />
            </TabsContent>

            <TabsContent
              value="imageWorkflow"
              className="m-0 min-h-0 flex-1"
            >
              {/* 分镜画布(资产/单镜图编辑)=分镜生产语境,漫影侧栏默认「分镜」页签 */}
              <ComfyCanvasSwap manyingScope="workflow" sidebarActions={sidebarActions} stageFlowNodes={viewModel.productionFlowNodes} />
            </TabsContent>

            <TabsContent value="workbench" className="m-0">
              <WorkbenchTab
                projectId={viewModel.projectId}
                projectName={viewModel.projectName}
                episodeId={viewModel.productionEpisodeId}
                directorPlan={viewModel.directorPlan}
                aspectRatio={viewModel.aspectRatio}
                storyboards={viewModel.chapterStoryboards}
                remotionShotSlots={viewModel.remotionShotSlots ?? []}
                onBackToCanvas={() => viewModel.handleStageChange("storyboard")}
              />
            </TabsContent>

          </div>
        </ScrollArea>
      </Tabs>
      {docNodeId ? (
        <NodeDocViewer
          node={viewModel.productionFlowNodes.find((n) => n.id === docNodeId) ?? viewModel.productionFlowNodes[0]}
          onClose={() => setDocNodeId(null)}
          onEdit={(id) => {
            setDocNodeId(null);
            viewModel.openNodeEditor(id);
          }}
        />
      ) : null}
      {viewModel.editingWorkflowNodeId && viewModel.workflowNodeEditWritable ? (
        <ScriptEditorDialog
          open
          title={viewModel.workflowNodeEditTitle}
          value={viewModel.workflowNodeDraft}
          onOpenChange={(open) => { if (!open) viewModel.closeNodeEditor(); }}
          onChange={viewModel.setWorkflowNodeDraft}
          onCancel={viewModel.closeNodeEditor}
          onSave={viewModel.saveWorkflowNodeEdit}
        />
      ) : null}
    </div>
  );
}
