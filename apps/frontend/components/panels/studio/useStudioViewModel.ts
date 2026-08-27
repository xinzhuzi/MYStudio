import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useProjectStore } from "@/stores/project/project-store";
import { useStudioStore } from "@/stores/studio/studio-store";
import { loadSourceBibleMirrorForActiveProject } from "@/stores/studio/studio-store-runtime";
import { aiManager } from "@/lib/ai/ai-manager";
import {
  buildSourceBibleMessages,
  parseSourceBibleDraft,
  sampleChaptersForBible,
} from "@/lib/studio/source-bible";
import {
  buildRemotionProductionProfile,
  syncRemotionWorkspaceProductionProfile,
} from "@/lib/studio/remotion/remotion-workspace-storage";
import { subscribeRemotionShotRenderRequest } from "@/lib/studio/remotion-shot-render-request";
import type { ImageWorkflowOpenContext } from "@/types/studio";
import { resolveProductionEpisodeId, resolveScriptTextForEpisode, scriptPlanSourceFingerprint } from "./workflow-helpers";
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
    sourceBible,
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
    saveSourceBible,
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
// eslint-disable-next-line react-hooks/exhaustive-deps
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
  // 衍生模型/资产库匹配名单只看当前章(与 directorPlan 同一收口径):
  // 旧章的 ⑦ 预划不再并排展示,summary 与 batchMatch 名单不跨章累加。
  const chapterScriptPlans = scriptPlans.filter(
    (item) => item.episodeId === productionEpisodeId,
  );
  // 08-27 二期 R1:当前章剧本正文指纹(与导演规划落库同一提取源+同一公式),
  // 传给 production flow 做「预划已过期」比对;plan 侧无指纹时模型静默。
  const currentScriptFingerprint = scriptPlanSourceFingerprint(
    productionEpisodeId,
    resolveScriptTextForEpisode(
      { agentWorkData, novelChapters, scriptPlans },
      productionEpisodeId,
    ),
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
    scriptPlans: chapterScriptPlans,
    currentScriptFingerprint,
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

  // 原著圣经启动/切项目治愈：store 为空时从项目唯一常驻层 MEMORY.md 回读
  //（外部编辑器或手工落盘的圣经由此进入应用；store 已有内容时不覆盖）。
  useEffect(() => {
    const projectId = activeProject?.id;
    if (!projectId) return;
    let cancelled = false;
    void (async () => {
      if (useStudioStore.getState().sourceBible.trim()) return;
      const text = await loadSourceBibleMirrorForActiveProject();
      if (cancelled || !text.trim()) return;
      if (useStudioStore.getState().sourceBible.trim()) return;
      useStudioStore.getState().saveSourceBible(text);
    })();
    return () => {
      cancelled = true;
    };
  }, [activeProject?.id]);

  const { handleNovelEventAnalysis, handleEntityExtraction } =
    useNovelPipelineActions({
      activeProjectId: activeProject?.id,
      projectName,
      saveAgentWorkData,
      saveEntityExtraction,
      updateNovelChapter,
    });

  const generateSourceBibleDraft = useCallback(async (): Promise<string> => {
    const store = useStudioStore.getState();
    const sampledChapters = sampleChaptersForBible(store.novelChapters);
    if (!sampledChapters.length) {
      throw new Error("请先导入小说章节，再生成原著圣经");
    }
    const messages = buildSourceBibleMessages({
      projectName,
      genre: store.workflowConfig.novelGenre,
      sampledChapters,
    });
    const result = await aiManager.text({
      binding: { agent: "universalAi" },
      messages: [
        { role: "system", content: messages.system },
        { role: "user", content: messages.user },
      ],
      temperature: 0.4,
      maxTokens: 4096,
    });
    if (!result.success || !result.text) {
      throw new Error(result.error || "原著圣经生成失败");
    }
    return parseSourceBibleDraft(result.text);
  }, [projectName]);

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

  // 单镜生产:逐镜队列卡片按钮经 DOM 事件请求(避免节点画布→预览层层接线),
  // 收窄到单镜复用一键成片运行器——TTS/音频绑定/入队只碰该镜
  useEffect(
    () => subscribeRemotionShotRenderRequest(({ shotId }) => {
      void handleRunChapterAutoVideo({ onlyStoryboardIds: [shotId] });
    }),
    [handleRunChapterAutoVideo],
  );

  const {
    scriptStyleSummary,
    scriptDirectorContext,
    scriptStreaming,
    previewStageUserMessage,
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
    sourceBible,
    saveSourceBible,
    generateSourceBibleDraft,
    setNovelHeaderActions,
    workflowConfig,
    setWorkflowConfig,
    manualCatalog,
    agentWorkData,
    saveAgentWorkData,
    scriptStyleSummary,
    scriptDirectorContext,
    scriptStreaming,
    previewStageUserMessage,
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
