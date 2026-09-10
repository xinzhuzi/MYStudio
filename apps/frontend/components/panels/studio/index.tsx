import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { ManualsTab } from "./ManualsTab";
import { NovelTab } from "./NovelTab";
import { ScriptTab } from "./ScriptTab";
import { StoryboardPanelTab } from "./StoryboardPanelTab";
import { WorkbenchTab } from "./WorkbenchTab";
import { ScriptAssetManagementTab } from "./ScriptAssetManagementTab";
import { ComfyCanvasSwap } from "../assist/comfy-canvas/ComfyCanvasSwap";
import { WorkflowStatusOrb } from "./workflow-stage";
import { useStudioViewModel } from "./useStudioViewModel";
import { useStoryboardBatchGeneration } from "./image-workflow/use-storyboard-batch-generation";
import { useStoryboardBatchUpscale } from "./image-workflow/use-storyboard-batch-upscale";

export function StudioView() {
  const viewModel = useStudioViewModel();
  const storyboardBatch = useStoryboardBatchGeneration({
    storyboards: viewModel.chapterStoryboards,
    projectName: viewModel.projectName,
  });
  const storyboardUpscale = useStoryboardBatchUpscale({
    storyboards: viewModel.chapterStoryboards,
  });

  return (
    <div className="studio-workspace studio-workspace-workflow h-full bg-panel">
      <Tabs
        value={viewModel.activeWorkflowTab}
        onValueChange={viewModel.handleStageChange}
        className="flex h-full flex-col"
      >
      {/* 悬浮球置于 ScrollArea 之外(fixed 定位,滚动不移位);
          阶段状态与切换入口全由此承载(2026-09-10 横幅退役裁定) */}
      <WorkflowStatusOrb
        readiness={viewModel.workflowReadiness}
        activeStage={viewModel.activeWorkflowTab}
        onStageChange={viewModel.handleStageChange}
      />
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
                setHeaderActions={viewModel.setNovelHeaderActions}
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
                setHeaderActions={viewModel.setScriptHeaderActions}
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
                setHeaderActions={viewModel.setAssetsHeaderActions}
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
              <ComfyCanvasSwap title="分镜制作 · ComfyUI" />
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
                upscale={storyboardUpscale}
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
              <ComfyCanvasSwap
                title="分镜画布 · ComfyUI"
                onBack={viewModel.closeAssetImageWorkflow}
              />
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
    </div>
  );
}
