"use client";

// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

// 09-10 全屏 ComfyUI 合一(用户裁定):freedom 视图=整屏 ComfyUI 画布,
// TTS 配音室=球面板可达子态;沉浸视图无应用 chrome,悬浮球=导航枢纽
// (阶段跳转照常可用=先落工作流阶段档再跳视图)。

import { toast } from "sonner";
import { ComfyCanvasStudio } from "./comfy-canvas/ComfyCanvasStudio";
import { TtsStudio } from "./TtsStudio";
import { FreedomOrbNav } from "./FreedomOrbNav";
import { useFreedomStore } from "@/stores/assist/freedom-store";
import { useStudioStore } from "@/stores/studio/studio-store";
import { useMediaPanelStore } from "@/stores/navigation/media-panel-store";
import { WorkflowStatusOrb, useWorkflowReadiness, resolveVisibleWorkflowStage } from "../studio/workflow-stage";
import { resolveProductionEpisodeId } from "../studio/workflow-helpers";

export function ComfyWorkspace() {
  const activeStudio = useFreedomStore((state) => state.activeStudio);
  const setActiveStudio = useFreedomStore((state) => state.setActiveStudio);
  const setActiveTab = useMediaPanelStore((state) => state.setActiveTab);

  // 球数据面与工作流视图同源(阶段就绪弧+待推进面板);输入全部来自中央 store
  const {
    workflowConfig,
    setWorkflowConfig,
    novelChapters,
    agentWorkData,
    entityExtractions,
    scriptPlans,
    seriesBible,
    storyboards,
    productionTracks,
    videoCandidates,
  } = useStudioStore();
  const readiness = useWorkflowReadiness({
    workflowConfig,
    novelChapters,
    agentWorkData,
    entityExtractions,
    scriptPlans,
    seriesBible,
    storyboards,
    productionTracks,
    videoCandidates,
    episodeId: resolveProductionEpisodeId(useStudioStore.getState()),
  });

  // 阶段/视图入口点击:同款手册门禁(与工作流视图 handleStageChange 一致),
  // 落档后跳工作流视图——useWorkflowStageState 的同步效应会接上该阶段。
  const handleStageChange = (stageId: string) => {
    const visibleStage = resolveVisibleWorkflowStage(stageId);
    const cfg = useStudioStore.getState().workflowConfig;
    if (
      visibleStage !== "manuals" &&
      (!cfg.visualManualId || !cfg.directorManualId)
    ) {
      toast.error("请先选择视觉风格与导演手册，才能进入下一步");
      return;
    }
    setWorkflowConfig({ workflowStage: visibleStage });
    setActiveTab("studio");
  };

  return (
    <div className="relative h-full w-full min-h-0 min-w-0 bg-background" data-comfy-workspace>
      {activeStudio === "tts" ? <TtsStudio /> : <ComfyCanvasStudio />}
      <WorkflowStatusOrb
        readiness={readiness}
        activeStage={resolveVisibleWorkflowStage(workflowConfig.workflowStage)}
        onStageChange={handleStageChange}
        navigation={<FreedomOrbNav mode={activeStudio} onModeChange={setActiveStudio} />}
      />
    </div>
  );
}
