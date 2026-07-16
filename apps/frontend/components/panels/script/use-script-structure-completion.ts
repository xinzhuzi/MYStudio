import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { importSingleEpisodeContent } from "@/lib/script/full-script-service";
import type { ScriptStructureStatus } from "@/stores/script-store";
import type { ScriptData } from "@/types/script";

type UseScriptStructureCompletionOptions = {
  projectId: string;
  activeEpisodeIndex: number | null;
  effectiveRawScript: string;
  scriptData: ScriptData | null;
  status: ScriptStructureStatus;
  setStatus: (status: ScriptStructureStatus) => void;
};

export function useScriptStructureCompletion({
  projectId,
  activeEpisodeIndex,
  effectiveRawScript,
  scriptData,
  status,
  setStatus,
}: UseScriptStructureCompletionOptions) {
  const [overwriteConfirmOpen, setOverwriteConfirmOpen] = useState(false);
  const previousEpisodeRef = useRef<{ index: number | null; rawLength: number }>({
    index: null,
    rawLength: 0,
  });
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const completeStructure = useCallback(async () => {
    if (activeEpisodeIndex == null || !scriptData) return;
    setStatus("processing");
    try {
      const result = await importSingleEpisodeContent(
        effectiveRawScript,
        activeEpisodeIndex,
        projectId,
      );
      if (result.success) {
        setStatus("completed");
        if (result.sceneCount > 0) {
          toast.success(`结构补全完成：解析出 ${result.sceneCount} 个场景`);
        }
      } else {
        setStatus("error");
        toast.error(result.error || "结构补全失败");
      }
    } catch (error) {
      setStatus("error");
      console.error("[handleStructureCompletion]", error);
    }

    if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
    resetTimerRef.current = setTimeout(() => setStatus("idle"), 3000);
  }, [activeEpisodeIndex, effectiveRawScript, projectId, scriptData, setStatus]);

  useEffect(() => {
    const previous = previousEpisodeRef.current;
    const currentLength = effectiveRawScript.length;
    const currentIndex = activeEpisodeIndex ?? null;

    if (previous.index !== currentIndex) {
      previousEpisodeRef.current = { index: currentIndex, rawLength: currentLength };
      return;
    }

    previousEpisodeRef.current = { index: currentIndex, rawLength: currentLength };
    if (activeEpisodeIndex == null || status !== "idle") return;

    if (previous.rawLength < 20 && currentLength > 50) {
      const episode = scriptData?.episodes.find((item) => item.index === activeEpisodeIndex);
      if (episode && episode.sceneIds.length > 0) {
        setOverwriteConfirmOpen(true);
      } else {
        void completeStructure();
      }
    }
  }, [activeEpisodeIndex, completeStructure, effectiveRawScript, scriptData, status]);

  useEffect(() => () => {
    if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
  }, []);

  return {
    overwriteConfirmOpen,
    setOverwriteConfirmOpen,
    completeStructure,
  };
}
