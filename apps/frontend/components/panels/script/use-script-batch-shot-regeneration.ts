import { useCallback } from "react";
import { toast } from "sonner";
import { aiManager } from "@/lib/ai/ai-manager";
import { regenerateAllEpisodeShots } from "@/lib/script/full-script-service";
import type { PromptLanguage } from "@/types/script";

type UseScriptBatchShotRegenerationOptions = {
  projectId: string;
  episodeCount: number;
  styleId: string;
  targetDuration: string;
  promptLanguage: PromptLanguage;
};

export function useScriptBatchShotRegeneration({
  projectId,
  episodeCount,
  styleId,
  targetDuration,
  promptLanguage,
}: UseScriptBatchShotRegenerationOptions) {
  return useCallback(async () => {
    const featureConfig = aiManager.featureConfig("script_analysis");

    if (episodeCount === 0) {
      toast.error("没有可生成的集");
      return;
    }

    try {
      toast.info(`正在为全部 ${episodeCount} 集生成分镜...（可能需要较长时间）`);
      await regenerateAllEpisodeShots(
        projectId,
        {
          apiKey: featureConfig?.allApiKeys.join(",") || "",
          provider: (featureConfig?.platform === "zhipu" ? "zhipu" : "openai") as string,
          styleId,
          targetDuration,
          promptLanguage,
        },
        (current, total, message) => {
          console.log(`[ScriptView] ${message} (${current}/${total})`);
        },
      );
      toast.success(`全部 ${episodeCount} 集分镜生成完成！`);
    } catch (error) {
      const err = error as Error;
      console.error("[ScriptView] All episodes shot generation failed:", err);
      toast.error(`分镜生成失败: ${err.message}`);
    }
  }, [episodeCount, projectId, promptLanguage, styleId, targetDuration]);
}
