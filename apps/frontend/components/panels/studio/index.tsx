import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { ManualsTab } from "./ManualsTab";
import { NovelTab } from "./NovelTab";
import { ScriptTab } from "./ScriptTab";
import { WorkbenchTab } from "./WorkbenchTab";
import { ScriptAssetManagementTab } from "./ScriptAssetManagementTab";
import { WorkflowNodeCanvas } from "./WorkflowNodeCanvas";
import { WorkflowNodeEditDialog } from "./WorkflowNodeEditDialog";
import { WorkflowStageStatusBar } from "./WorkflowStageStatusBar";
import {
  resolveProductionEpisodeId,
  resolveScriptPlanEpisodeId,
  resolveScriptTextForEpisode,
} from "./workflow-helpers";
import { useStudioViewModel } from "./useStudioViewModel";

export {
  resolveProductionEpisodeId,
  resolveScriptPlanEpisodeId,
  resolveScriptTextForEpisode,
} from "./workflow-helpers";
export { WORKFLOW_TABS, resolveVisibleWorkflowStage } from "./workflow-tabs";
export { AssetsTab } from "./AssetsTab";
export { ScriptAssetManagementTab } from "./ScriptAssetManagementTab";
export { WorkbenchTab } from "./WorkbenchTab";
export { NovelEmptyState, NovelTab } from "./NovelTab";
export { ScriptTab } from "./ScriptTab";
export { ManualsTab } from "./ManualsTab";
export { WorkflowNodeEditDialog } from "./WorkflowNodeEditDialog";
export { WorkflowStageStatusBar } from "./WorkflowStageStatusBar";

export function StudioView() {
  const viewModel = useStudioViewModel();

  return (
    <div className="studio-workspace studio-workspace-workflow h-full bg-[#20201f]">
      <Tabs
        value={viewModel.activeWorkflowTab}
        onValueChange={viewModel.handleStageChange}
        className="flex h-full flex-col"
      >
        <ScrollArea className="h-full min-h-0 flex-1 scrollbar-hidden">
          <div className="flex h-full min-h-0 flex-col bg-background p-5">
            <WorkflowStageStatusBar
              readiness={viewModel.workflowReadiness}
              activeStage={viewModel.activeWorkflowTab}
              onStageChange={viewModel.handleStageChange}
              stageActions={viewModel.scriptHeaderActions}
            />

            <TabsContent value="novel" className="m-0">
              <NovelTab
                novelDraft={viewModel.novelDraft}
                setNovelDraft={viewModel.setNovelDraft}
                handleNovelFile={viewModel.handleNovelFile}
                appendNovelText={viewModel.appendNovelText}
                replaceNovelText={viewModel.replaceNovelText}
                deleteNovelChapters={viewModel.deleteNovelChapters}
                novelChapters={viewModel.novelChapters}
                updateNovelChapter={viewModel.updateNovelChapter}
                analyzeEvents={viewModel.handleNovelEventAnalysis}
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
              />
            </TabsContent>

            <TabsContent
              value="storyboard"
              className="m-0 min-h-0 flex-1 data-[state=active]:flex data-[state=inactive]:hidden"
            >
              <WorkflowNodeCanvas
                projectName={viewModel.projectName}
                nodes={viewModel.productionFlowNodes}
                onStageChange={viewModel.handleStageChange}
                onNodeEdit={viewModel.openNodeEditor}
                onNodeAction={viewModel.handleProductionNodeAction}
              />
            </TabsContent>

            <TabsContent value="workbench" className="m-0">
              <WorkbenchTab
                storyboards={viewModel.storyboards}
                tracks={viewModel.productionTracks}
                candidates={viewModel.videoCandidates}
                renderingTrackId={viewModel.renderingTrackId}
                merging={viewModel.merging}
                mergeOutput={viewModel.mergeOutput}
                rebuildTracks={viewModel.rebuildTracks}
                renderTrack={viewModel.handleRenderTrack}
                selectVideoCandidate={viewModel.selectVideoCandidate}
                deleteVideoCandidate={viewModel.deleteVideoCandidate}
                mergeEpisode={viewModel.handleMergeEpisode}
              />
            </TabsContent>
          </div>
        </ScrollArea>
      </Tabs>
      <WorkflowNodeEditDialog
        open={Boolean(viewModel.editingWorkflowNodeId)}
        title={viewModel.workflowNodeEditTitle}
        value={viewModel.workflowNodeDraft}
        writable={viewModel.workflowNodeEditWritable}
        onValueChange={viewModel.setWorkflowNodeDraft}
        onClose={viewModel.closeNodeEditor}
        onSave={viewModel.saveWorkflowNodeEdit}
        onEnterStage={viewModel.handleEnterWorkflowNodeStage}
      />
    </div>
  );
}
