import { useCallback, useEffect, useRef, useState } from "react";
import {
  consumeInteractionDeferArrivalSuppression,
  interactionDeferBegin,
  interactionDeferEnd,
} from "./previews/interaction-defer";
import { useStudioStore } from "@/stores/studio/studio-store";
import { toast } from "sonner";
import { resolveVisibleWorkflowStage } from "./workflow-tabs";

type StudioStore = ReturnType<typeof useStudioStore.getState>;

export function useWorkflowStageState({
  activeProjectId,
  workflowStage,
  setWorkflowConfig,
}: {
  activeProjectId?: string;
  workflowStage?: string;
  setWorkflowConfig: StudioStore["setWorkflowConfig"];
}) {
  const [activeWorkflowTab, setActiveWorkflowTab] = useState(
    resolveVisibleWorkflowStage(workflowStage),
  );

  const handleStageChange = useCallback(
    (value: string) => {
      const visibleStage = resolveVisibleWorkflowStage(value);
      const cfg = useStudioStore.getState().workflowConfig;
      if (
        visibleStage !== "manuals" &&
        (!cfg.visualManualId || !cfg.directorManualId)
      ) {
        toast.error("请先选择视觉风格与导演手册，才能进入下一步");
        return;
      }
      setActiveWorkflowTab(visibleStage);
      setWorkflowConfig({ workflowStage: visibleStage });
    },
    [setWorkflowConfig],
  );

  const prevProjectIdRef = useRef<string | undefined>(activeProjectId);
  useEffect(() => {
    if (activeProjectId !== prevProjectIdRef.current) {
      prevProjectIdRef.current = activeProjectId;
      setActiveWorkflowTab(
        resolveVisibleWorkflowStage(
          useStudioStore.getState().workflowConfig.workflowStage,
        ),
      );
    }
  }, [activeProjectId]);

  const prevStageRef = useRef<string | null>(null);
  useEffect(() => {
    const visibleStage = resolveVisibleWorkflowStage(workflowStage);
    const isFirstArrival = prevStageRef.current === null;
    const stageChanged = !isFirstArrival && prevStageRef.current !== visibleStage;
    prevStageRef.current = visibleStage;
    setActiveWorkflowTab((current) =>
      current === visibleStage ? current : visibleStage,
    );
    // 阶段进入 = 一次交互(用户裁定 2026-08-26):新阶段图片先占位,静止 5s
    // 后统一加载。首挂载跳过(冷启直入/初次进工作台不延迟,装机 smoke 依赖);
    // 测试桥程序化设阶段的豁免在此消费(时序:桥先行标志,本效应后行)。
    // 画布(storyboard)=纯指针卡零图片,门闸无意义(2026-08-26 用户实弹
    // 「为什么左下角的提示还有」);仅对含图片的阶段面板关闸。
    const isCanvasStage = visibleStage === "storyboard";
    if (stageChanged && !isCanvasStage && !consumeInteractionDeferArrivalSuppression()) {
      interactionDeferBegin();
      interactionDeferEnd();
    } else {
      consumeInteractionDeferArrivalSuppression();
    }
  }, [workflowStage]);

  return {
    activeWorkflowTab,
    handleStageChange,
  };
}
