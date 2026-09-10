"use client";

// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

// 09-10 全屏 ComfyUI 合一(用户裁定):freedom 视图=整屏 ComfyUI 画布,
// TTS 配音室=本地模型球可达子态;沉浸视图无应用 chrome,本地模型球=唯一出入。
// 09-10 终裁(两球功能一致):本地模型球也带「切换阶段」——点击=手册门禁后
// 落工作流阶段档并跳转(Q3「两步路径」反转),接线照旧与工作流视图同源。

import { toast } from "sonner";
import { ComfyCanvasStudio } from "./comfy-canvas/ComfyCanvasStudio";
import { TtsStudio } from "./TtsStudio";
import { LocalModelOrb } from "./LocalModelOrb";
import { useFreedomStore } from "@/stores/assist/freedom-store";
import { useStudioStore } from "@/stores/studio/studio-store";
import { useMediaPanelStore } from "@/stores/navigation/media-panel-store";
import { useWorkflowReadiness, resolveVisibleWorkflowStage } from "../studio/workflow-stage";
import { resolveProductionEpisodeId } from "../studio/workflow-helpers";

export function ComfyWorkspace() {
  const activeStudio = useFreedomStore((state) => state.activeStudio);
  const setActiveStudio = useFreedomStore((state) => state.setActiveStudio);
  const setActiveTab = useMediaPanelStore((state) => state.setActiveTab);

  // 球数据面与工作流视图同源(阶段就绪弧);输入全部来自中央 store
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

  // 阶段入口点击:同款手册门禁(与工作流视图 handleStageChange 一致),
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
      <LocalModelOrb
        mode={activeStudio}
        onModeChange={setActiveStudio}
        readiness={readiness}
        activeStage={resolveVisibleWorkflowStage(workflowConfig.workflowStage)}
        onStageChange={handleStageChange}
      />
    </div>
  );
}
