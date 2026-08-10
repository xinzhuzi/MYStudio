import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useProjectStore } from "@/stores/project/project-store";
import { useStudioStore } from "@/stores/studio/studio-store";
import {
  buildRemotionProductionProfile,
  syncRemotionWorkspaceProductionProfile,
} from "@/lib/studio/remotion/remotion-workspace-storage";
import type { ImageWorkflowOpenContext } from "@/types/studio";
import { resolveProductionEpisodeId } from "./workflow-helpers";
import { useNovelPipelineActions } from "./useNovelPipelineActions";
import { useProductionFlowModel } from "./useProductionFlowModel";
import { useProductionPlanningActions } from "./useProductionPlanningActions";
import { useScriptStageActions } from "./useScriptStageActions";
import { useStudioManualCatalog } from "./useStudioManualCatalog";
import { useWorkflowNodeEditor } from "./useWorkflowNodeEditor";
import { useWorkflowReadiness } from "./useWorkflowReadiness";
import { useWorkflowStageState } from "./useWorkflowStageState";
import { useChapterAutoVideoActions } from "./useChapterAutoVideoActions";
import type { ProductionFlowNodeAction } from "./workflow-node-model";

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
    updateNovelChapter,
    setWorkflowConfig,
    saveAgentWorkData,
    saveEntityExtraction,
    saveScriptPlan,
    saveSeriesBible,
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

  useEffect(() => {
    const projectId = activeProject?.id;
    if (!projectId || typeof window === "undefined" || !window.fileStorage) return;
    const profile = buildRemotionProductionProfile(workflowConfig);
    const timer = window.setTimeout(() => {
      void syncRemotionWorkspaceProductionProfile(projectId, profile).catch((error: unknown) => {
        console.warn("[StudioView] Failed to sync Remotion production profile:", error);
      });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [
    activeProject?.id,
    workflowConfig.episodeDurationMin,
    workflowConfig.platformSpec,
    workflowConfig.visualManualId,
    workflowConfig.directorManualId,
    workflowConfig.stylePositioning,
  ]);

  // Fallback aligns with the default project name in project-store.ts
  // ("漫影工作室项目"), not the bare brand name, so a project-less state still
  // shows a valid project name rather than a mismatched placeholder. See task #12.
  const projectName = activeProject?.name ?? "漫影工作室项目";

  const productionEpisodeId = resolveProductionEpisodeId(
    useStudioStore.getState(),
  );
  const chapterStoryboards = storyboards.filter(
    (storyboard) => storyboard.episodeId === productionEpisodeId,
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
    productionEpisodeId,
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
    workflowNodeEditJson,
    workflowNodeEditReadOnlyJson,
    setWorkflowNodeDraft,
    openNodeEditor,
    openNodeJson,
    closeNodeEditor,
    saveWorkflowNodeEdit,
  } = useWorkflowNodeEditor({
    productionFlowModel,
    projectId: activeProject?.id,
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
    onVideoUseReviewRequired: () => handleStageChange("workbench"),
  });
  const handleProductionFlowNodeAction = useCallback(
    async (action: ProductionFlowNodeAction) => {
      if (action.id === "enqueue-remotion-shots") {
        await handleRunChapterAutoVideo();
        return;
      }
      await handleProductionNodeAction(action);
    },
    [handleProductionNodeAction, handleRunChapterAutoVideo],
  );

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
    remotionShotSlots: productionFlowModel.remotionShotSlots,
    openNodeEditor,
    openNodeJson,
    handleProductionNodeAction: handleProductionFlowNodeAction,
    chapterAutoVideoStatus,
    chapterAutoVideoRunning,
    handleRunChapterAutoVideo,
    handleOpenFinalVideo,
    assetImageWorkflowContext,
    openAssetImageWorkflow,
    closeAssetImageWorkflow,
    storyboards,
    chapterStoryboards,
    productionTracks,
    videoCandidates,
    editingWorkflowNodeId,
    workflowNodeDraft,
    workflowNodeEditTitle,
    workflowNodeEditWritable,
    workflowNodeEditJson,
    workflowNodeEditReadOnlyJson,
    setWorkflowNodeDraft,
    closeNodeEditor,
    saveWorkflowNodeEdit,
    handleEnterWorkflowNodeStage,
  };
}
