import { useCallback } from "react";
import { aiManager } from "@/lib/ai/ai-manager";
import { findCharacterByDescription } from "@/lib/script/ai-character-finder";
import { findSceneByDescription } from "@/lib/script/ai-scene-finder";
import type { EpisodeRawScript, ProjectBackground, ScriptCharacter, ScriptScene } from "@/types/script";

interface UseScriptEntityLookupOptions {
  background?: ProjectBackground;
  episodes: EpisodeRawScript[];
  characters: ScriptCharacter[];
  scenes: ScriptScene[];
}

export function useScriptEntityLookup({
  background,
  episodes,
  characters,
  scenes,
}: UseScriptEntityLookupOptions) {
  const findCharacter = useCallback(async (query: string) => {
    const featureConfig = aiManager.featureConfig("script_analysis");
    if (!featureConfig) return { found: false, name: "", message: "请先配置 AI 接口" };
    if (!background) return { found: false, name: "", message: "请先导入剧本" };
    try {
      const result = await findCharacterByDescription(query, background, episodes, characters, {
        apiKey: featureConfig.allApiKeys.join(","),
        provider: featureConfig.platform,
        baseUrl: featureConfig.baseUrl,
      });
      return {
        found: result.found,
        name: result.name,
        message: result.message,
        character: result.character,
      };
    } catch (error) {
      console.error("[handleAIFindCharacter] 错误:", error);
      return { found: false, name: "", message: "查找失败，请重试" };
    }
  }, [background, characters, episodes]);

  const findScene = useCallback(async (query: string) => {
    const featureConfig = aiManager.featureConfig("script_analysis");
    if (!featureConfig) return { found: false, message: "请先配置 AI 接口" };
    if (!background) return { found: false, message: "请先导入剧本" };
    try {
      const result = await findSceneByDescription(query, background, episodes, scenes, {
        apiKey: featureConfig.allApiKeys.join(","),
        provider: featureConfig.platform,
        baseUrl: featureConfig.baseUrl,
      });
      return { found: result.found, message: result.message, scene: result.scene };
    } catch (error) {
      console.error("[handleAIFindScene] 错误:", error);
      return { found: false, message: "查找失败，请重试" };
    }
  }, [background, episodes, scenes]);

  return { handleAIFindCharacter: findCharacter, handleAIFindScene: findScene };
}
