import { useCallback, useEffect, useRef, useState } from "react";
import {
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
      // 阶段进入 = 一次交互(用户裁定 2026-08-26):新阶段挂载的图片先占位,
      // 静止 5s 后统一加载,倒计时提示与画布/面板同款——否则进阶段瞬间
      // 全量加载抢主线程,「一点进入就卡」。
      interactionDeferBegin();
      interactionDeferEnd();
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

  useEffect(() => {
    const visibleStage = resolveVisibleWorkflowStage(workflowStage);
    setActiveWorkflowTab((current) =>
      current === visibleStage ? current : visibleStage,
    );
  }, [workflowStage]);

  return {
    activeWorkflowTab,
    handleStageChange,
  };
}
