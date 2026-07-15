import { useCallback } from "react";
import { toast } from "sonner";
import { aiManager } from "@/lib/ai/ai-manager";
import { generateEpisodeShots } from "@/lib/script/full-script-service";
import type { ScriptViewpointStatus } from "@/stores/script-store";
import type { PromptLanguage } from "@/types/script";

export function useScriptEpisodeGeneration({
  projectId,
  styleId,
  targetDuration,
  promptLanguage,
  setViewpointAnalysisStatus,
}: {
  projectId: string;
  styleId: string;
  targetDuration: string;
  promptLanguage: PromptLanguage;
  setViewpointAnalysisStatus: (status: ScriptViewpointStatus) => void;
}) {
  return useCallback(async (episodeIndex: number) => {
    const featureConfig = aiManager.featureConfig("script_analysis");
    console.log("[handleGenerateEpisodeShots] featureConfig:", featureConfig ? "已配置" : "未配置");
    console.log("[handleGenerateEpisodeShots] allApiKeys:", featureConfig?.allApiKeys?.length || 0);
    if (!featureConfig) {
      toast.warning("未配置智谱 API，AI 视角分析将跳过");
    }

    try {
      toast.info(`正在为第 ${episodeIndex} 集生成分镜...`);
      setViewpointAnalysisStatus("analyzing");
      const apiKey = featureConfig?.allApiKeys?.join(",") || "";
      const provider = featureConfig?.platform === "zhipu" ? "zhipu" : "openai";
      console.log("[handleGenerateEpisodeShots] apiKey length:", apiKey.length);
      console.log(
        "[handleGenerateEpisodeShots] provider:",
        provider,
        "(from config:",
        featureConfig?.platform,
        ")",
      );
      const result = await generateEpisodeShots(
        episodeIndex,
        projectId,
        {
          apiKey,
          provider,
          baseUrl: featureConfig?.baseUrl,
          styleId,
          targetDuration,
          promptLanguage,
        },
        (message) => console.log(`[ScriptView] ${message}`),
      );
      if (result.viewpointAnalyzed) {
        setViewpointAnalysisStatus("completed");
      } else {
        setViewpointAnalysisStatus("error");
        toast.error(`AI 视角分析未执行：${result.viewpointSkippedReason || "未知原因"}`);
      }
      toast.success(`第 ${episodeIndex} 集分镜生成完成！共 ${result.shots.length} 个分镜`);
      return result;
    } catch (error) {
      const current = error instanceof Error ? error : new Error(String(error));
      console.error("[ScriptView] Episode shot generation failed:", current);
      toast.error(`分镜生成失败: ${current.message}`);
      setViewpointAnalysisStatus("error");
      return {
        shots: [],
        viewpointAnalyzed: false,
        viewpointSkippedReason: current.message,
      };
    }
  }, [projectId, promptLanguage, setViewpointAnalysisStatus, styleId, targetDuration]);
}
