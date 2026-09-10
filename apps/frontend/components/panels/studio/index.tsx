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
import { useStoryboardBatchGeneration } from "./image-workflow/use-storyboard-batch-generation";

export function StudioView() {
  const viewModel = useStudioViewModel();
  const storyboardBatch = useStoryboardBatchGeneration({
    storyboards: viewModel.chapterStoryboards,
    projectName: viewModel.projectName,
  });

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
