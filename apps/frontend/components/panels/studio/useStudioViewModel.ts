import { useCallback, useState, type ReactNode } from "react";
import { useProjectStore } from "@/stores/project-store";
import { useStudioStore } from "@/stores/studio-store";
import type { ImageWorkflowOpenContext } from "@/types/studio";
import { resolveProductionEpisodeId } from "./workflow-helpers";
import { useNovelPipelineActions } from "./useNovelPipelineActions";
import { useProductionFlowModel } from "./useProductionFlowModel";
import { useProductionPlanningActions } from "./useProductionPlanningActions";
import { useProductionRenderActions } from "./useProductionRenderActions";
import { useScriptStageActions } from "./useScriptStageActions";
import { useStudioManualCatalog } from "./useStudioManualCatalog";
import { useWorkflowNodeEditor } from "./useWorkflowNodeEditor";
import { useWorkflowReadiness } from "./useWorkflowReadiness";
import { useWorkflowStageState } from "./useWorkflowStageState";
import { useChapterAutoVideoActions } from "./useChapterAutoVideoActions";

export function useStudioViewModel() {
  const activeProject = useProjectStore((state) => state.activeProject);
  const {
    novelChapters,
    agentWorkData,
    entityExtractions,
    scriptPlans,
    seriesBible,
    storyboards,
    productionTracks,
    videoCandidates,
    workflowConfig,
    appendNovelText,
    replaceNovelText,
    deleteNovelChapters,
    updateNovelChapter,
    setWorkflowConfig,
    saveAgentWorkData,
    saveEntityExtraction,
    saveScriptPlan,
    saveSeriesBible,
    rebuildTracks,
    addVideoCandidate,
    updateVideoCandidate,
    selectVideoCandidate,
    deleteVideoCandidate,
  } = useStudioStore();
  const [novelDraft, setNovelDraft] = useState("");
  const { activeWorkflowTab, handleStageChange } = useWorkflowStageState({
    activeProjectId: activeProject?.id,
    workflowStage: workflowConfig.workflowStage,
    setWorkflowConfig,
  });
  const [, setNovelHeaderActions] = useState<ReactNode>(null);
  const [scriptHeaderActions, setScriptHeaderActions] =
    useState<ReactNode>(null);
  const [, setAssetsHeaderActions] = useState<ReactNode>(null);
  const [assetImageWorkflowContext, setAssetImageWorkflowContext] =
    useState<ImageWorkflowOpenContext>();
  const manualCatalog = useStudioManualCatalog();

  const projectName = activeProject?.name ?? "漫影工作室";

  const productionEpisodeId = resolveProductionEpisodeId(
    useStudioStore.getState(),
  );
  const directorPlan = scriptPlans.find(
    (item) => item.episodeId === productionEpisodeId,
  );
  const aspectRatio = seriesBible?.aspectRatio ?? workflowConfig.platformSpec;
  const workflowReadiness = useWorkflowReadiness({
    workflowConfig,
    novelChapters,
    agentWorkData,
    entityExtractions,
    scriptPlans,
    seriesBible,
    storyboards,
    productionTracks,
    videoCandidates,
    episodeId: productionEpisodeId,
  });
  const productionFlowModel = useProductionFlowModel({
    agentWorkData,
    entityExtractions,
    scriptPlans,
    storyboards,
    productionTracks,
    videoCandidates,
    workflowConfig,
    manualCatalog,
  });
  const {
    editingWorkflowNodeId,
    workflowNodeDraft,
    workflowNodeEditTitle,
    workflowNodeEditWritable,
    setWorkflowNodeDraft,
    openNodeEditor,
    closeNodeEditor,
    saveWorkflowNodeEdit,
  } = useWorkflowNodeEditor({
    productionFlowModel,
    productionEpisodeId,
    saveAgentWorkData,
    saveScriptPlan,
  });
  const handleNovelFile = async (file?: File) => {
    if (!file) return;
    const text = await file.text();
    setNovelDraft(text);
  };

  const { handleNovelEventAnalysis, handleEntityExtraction } =
    useNovelPipelineActions({
      activeProjectId: activeProject?.id,
      projectName,
      saveAgentWorkData,
      saveEntityExtraction,
      updateNovelChapter,
    });

  const { handleProductionNodeAction } = useProductionPlanningActions({
    activeProjectId: activeProject?.id,
    manualCatalog,
    productionEpisodeId,
    handleStageChange,
    saveAgentWorkData,
    saveScriptPlan,
    saveSeriesBible,
  });
  const {
    chapterAutoVideoStatus,
    chapterAutoVideoRunning,
    handleRunChapterAutoVideo,
    handleOpenFinalVideo,
  } = useChapterAutoVideoActions({
    activeProjectId: activeProject?.id,
    productionEpisodeId,
    handleProductionNodeAction,
  });

  const {
    scriptStyleSummary,
    scriptDirectorContext,
    scriptStreaming,
    handleScriptStage,
    handleStageReview,
  } = useScriptStageActions({
    workflowConfig,
    manualCatalog,
    projectName,
    novelChapterCount: novelChapters.length,
    agentWorkData,
    saveAgentWorkData,
  });
  const {
    renderingTrackId,
    merging,
    mergeOutput,
    handleRenderTrack,
    handleMergeEpisode,
  } = useProductionRenderActions({
    productionTracks,
    storyboards,
    videoCandidates,
    addVideoCandidate,
    updateVideoCandidate,
    selectVideoCandidate,
    saveAgentWorkData,
  });

  const handleEnterWorkflowNodeStage = () => {
    if (editingWorkflowNodeId) {
      const node = productionFlowModel.nodes.find(
        (item) => item.id === editingWorkflowNodeId,
      );
      if (node) handleStageChange(node.targetStage);
    }
    closeNodeEditor();
  };

  const openAssetImageWorkflow = useCallback(
    (context: ImageWorkflowOpenContext) => {
      setAssetImageWorkflowContext(context);
      handleStageChange("imageWorkflow");
    },
    [handleStageChange],
  );
  const closeAssetImageWorkflow = useCallback(() => {
    const returnStage = assetImageWorkflowContext?.sourceStage || "storyboard";
    setAssetImageWorkflowContext(undefined);
    handleStageChange(returnStage);
  }, [assetImageWorkflowContext?.sourceStage, handleStageChange]);

  return {
    activeWorkflowTab,
    workflowReadiness,
    handleStageChange,
    novelDraft,
    setNovelDraft,
    handleNovelFile,
    appendNovelText,
    replaceNovelText,
    deleteNovelChapters,
    novelChapters,
    updateNovelChapter,
    handleNovelEventAnalysis,
    setNovelHeaderActions,
    workflowConfig,
    setWorkflowConfig,
    manualCatalog,
    agentWorkData,
    saveAgentWorkData,
    scriptStyleSummary,
    scriptDirectorContext,
    scriptStreaming,
    handleScriptStage,
    handleStageReview,
    scriptHeaderActions,
    setScriptHeaderActions,
    entityExtractions,
    handleEntityExtraction,
    saveEntityExtraction,
    setAssetsHeaderActions,
    productionEpisodeId,
    scriptPlanCount: scriptPlans.length,
    hasSeriesBible: Boolean(seriesBible),
    projectId: activeProject?.id,
    projectName,
    directorPlan,
    aspectRatio,
    productionFlowNodes: productionFlowModel.nodes,
    openNodeEditor,
    handleProductionNodeAction,
    chapterAutoVideoStatus,
    chapterAutoVideoRunning,
    handleRunChapterAutoVideo,
    handleOpenFinalVideo,
    assetImageWorkflowContext,
    openAssetImageWorkflow,
    closeAssetImageWorkflow,
    storyboards,
    productionTracks,
    videoCandidates,
    renderingTrackId,
    merging,
    mergeOutput,
    rebuildTracks,
    handleRenderTrack,
    selectVideoCandidate,
    deleteVideoCandidate,
    handleMergeEpisode,
    editingWorkflowNodeId,
    workflowNodeDraft,
    workflowNodeEditTitle,
    workflowNodeEditWritable,
    setWorkflowNodeDraft,
    closeNodeEditor,
    saveWorkflowNodeEdit,
    handleEnterWorkflowNodeStage,
  };
}
