import { useCallback } from "react";
import { toast } from "sonner";
import { aiManager } from "@/lib/ai/ai-manager";
import { generateScriptFromIdea, generateShotList, parseScript } from "@/lib/script/script-parser";
import type { ScriptData, Shot } from "@/types/script";

interface LibraryCharacterSummary {
  name: string;
  visualTraits?: string;
  description?: string;
}

interface UseScriptAuthoringActionsOptions {
  projectId: string;
  rawScript: string;
  language: string;
  targetDuration: string;
  styleId: string;
  sceneCount?: string;
  shotCount?: string;
  scriptData: ScriptData | null;
  libraryCharacters: LibraryCharacterSummary[];
  setRawScript: (projectId: string, script: string) => void;
  setParseStatus: (projectId: string, status: "idle" | "parsing" | "ready" | "error", error?: string) => void;
  setScriptData: (projectId: string, data: ScriptData) => void;
  setShots: (projectId: string, shots: Shot[]) => void;
  setShotStatus: (projectId: string, status: "idle" | "generating" | "ready" | "error", error?: string) => void;
  importFullScript: (script: string) => Promise<unknown>;
}

export function useScriptAuthoringActions({
  projectId,
  rawScript,
  language,
  targetDuration,
  styleId,
  sceneCount,
  shotCount,
  scriptData,
  libraryCharacters,
  setRawScript,
  setParseStatus,
  setScriptData,
  setShots,
  setShotStatus,
  importFullScript,
}: UseScriptAuthoringActionsOptions) {
  const generateShots = useCallback(async (data?: ScriptData | null) => {
    const targetData = data || scriptData;
    if (!targetData) return;
    const featureConfig = aiManager.featureConfig("script_analysis");
    if (!featureConfig) return;
    const baseUrl = featureConfig.baseUrl?.replace(/\/+$/, "");
    const model = featureConfig.models?.[0];
    if (!baseUrl || !model) {
      toast.error("请先在设置中配置「剧本分析」的 Base URL 和模型");
      setShotStatus(projectId, "error", "缺少 Base URL 或模型配置");
      return;
    }

    setShotStatus(projectId, "generating");
    setShots(projectId, []);
    let accumulatedShots: Shot[] = [];
    try {
      const characterDescriptions: Record<string, string> = {};
      targetData.characters.forEach((character) => {
        const libraryCharacter = libraryCharacters.find(
          (item) => item.name === character.name || item.name.includes(character.name),
        );
        if (libraryCharacter) {
          characterDescriptions[character.id] = libraryCharacter.visualTraits || libraryCharacter.description || "";
        }
      });
      const result = await generateShotList(
        targetData,
        {
          apiKey: featureConfig.allApiKeys.join(","),
          provider: featureConfig.platform === "zhipu" ? "zhipu" : "openai",
          baseUrl,
          model,
          targetDuration,
          styleId,
          characterDescriptions,
          shotCount: shotCount ? Number.parseInt(shotCount) : undefined,
        },
        (completed, total) => console.log(`[ScriptView] 进度: ${completed}/${total} 场景`),
        (newShots, sceneIndex) => {
          const reindexedShots = newShots.map((shot, index) => ({
            ...shot,
            id: `shot-${accumulatedShots.length + index + 1}`,
            index: accumulatedShots.length + index + 1,
          }));
          accumulatedShots = [...accumulatedShots, ...reindexedShots];
          setShots(projectId, [...accumulatedShots]);
          console.log(`[ScriptView] 场景 ${sceneIndex + 1} 完成，已生成 ${accumulatedShots.length} 个分镜`);
        },
      );
      setShots(projectId, result);
      setShotStatus(projectId, "ready");
      toast.success(`生成完成: ${result.length} 个分镜`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[ScriptView] Shot generation failed:", error);
      setShotStatus(projectId, "error", message);
      toast.error(`分镜生成失败: ${message}`);
    }
  }, [libraryCharacters, projectId, scriptData, setShotStatus, setShots, shotCount, styleId, targetDuration]);

  const generateFromIdea = useCallback(async (idea: string) => {
    const featureConfig = aiManager.featureConfig("script_analysis");
    if (!featureConfig) {
      toast.error(aiManager.featureNotConfiguredMessage("script_analysis"));
      return;
    }
    const baseUrl = featureConfig.baseUrl?.replace(/\/+$/, "");
    const model = featureConfig.models?.[0];
    if (!baseUrl || !model) {
      toast.error("请先在设置中配置「剧本分析」的 Base URL 和模型");
      return;
    }
    setParseStatus(projectId, "parsing");
    try {
      const generatedScript = await generateScriptFromIdea(idea, {
        apiKey: featureConfig.allApiKeys.join(","),
        provider: featureConfig.platform === "zhipu" ? "zhipu" : "openai",
        baseUrl,
        model,
        language,
        targetDuration,
        sceneCount: sceneCount ? Number.parseInt(sceneCount) : undefined,
        shotCount: shotCount ? Number.parseInt(shotCount) : undefined,
        styleId,
      });
      setRawScript(projectId, generatedScript);
      setParseStatus(projectId, "idle");
      toast.success("剧本生成成功！正在自动导入...");
      await importFullScript(generatedScript);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[ScriptView] Script generation failed:", error);
      setParseStatus(projectId, "error", message);
      toast.error(`剧本生成失败: ${message}`);
    }
  }, [importFullScript, language, projectId, sceneCount, setParseStatus, setRawScript, shotCount, styleId, targetDuration]);

  const parse = useCallback(async () => {
    if (!rawScript.trim()) {
      toast.error("请输入剧本内容");
      return;
    }
    const featureConfig = aiManager.featureConfig("script_analysis");
    if (!featureConfig) {
      toast.error(aiManager.featureNotConfiguredMessage("script_analysis"));
      return;
    }
    const baseUrl = featureConfig.baseUrl?.replace(/\/+$/, "");
    const model = featureConfig.models?.[0];
    if (!baseUrl || !model) {
      toast.error("请先在设置中配置「剧本分析」的 Base URL 和模型");
      setParseStatus(projectId, "error", "缺少 Base URL 或模型配置");
      return;
    }
    setParseStatus(projectId, "parsing");
    try {
      const result = await parseScript(rawScript, {
        apiKey: featureConfig.allApiKeys.join(","),
        provider: featureConfig.platform === "zhipu" ? "zhipu" : "openai",
        baseUrl,
        model,
        language,
        sceneCount: sceneCount ? Number.parseInt(sceneCount) : undefined,
        shotCount: shotCount ? Number.parseInt(shotCount) : undefined,
      });
      if (!result.episodes?.length) {
        result.episodes = [{ id: "default", index: 1, title: result.title || "第1集", sceneIds: result.scenes.map((scene) => scene.id) }];
      }
      setScriptData(projectId, result);
      setParseStatus(projectId, "ready");
      toast.success(`解析完成: ${result.characters.length} 角色, ${result.scenes.length} 场景`);
      await generateShots(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[ScriptView] Parse failed:", error);
      setParseStatus(projectId, "error", message);
      toast.error(`解析失败: ${message}`);
    }
  }, [generateShots, language, projectId, rawScript, sceneCount, setParseStatus, setScriptData, shotCount]);

  return { handleGenerateFromIdea: generateFromIdea, handleParse: parse, handleGenerateShots: generateShots };
}
