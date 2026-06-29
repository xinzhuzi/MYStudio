import { useCallback, useEffect, useRef, useState } from "react";
import { useStudioStore } from "@/stores/studio-store";
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
