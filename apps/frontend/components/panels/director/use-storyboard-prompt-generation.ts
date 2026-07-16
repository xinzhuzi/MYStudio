import { useCallback } from "react";
import { toast } from "sonner";
import { aiManager } from "@/lib/ai/ai-manager";
import { generateScenePrompts } from "@/lib/storyboard/scene-prompt-generator";
import type { DirectorProjectData, DirectorStore, SplitScene } from "@/stores/director-store";

type UseStoryboardPromptGenerationOptions = {
  storyboardImage: string | null;
  scenes: SplitScene[];
  storyboardConfig: DirectorProjectData["storyboardConfig"];
  setIsGeneratingPrompts: (value: boolean) => void;
  updateSplitSceneImagePrompt: DirectorStore["updateSplitSceneImagePrompt"];
  updateSplitSceneVideoPrompt: DirectorStore["updateSplitSceneVideoPrompt"];
  updateSplitSceneEndFramePrompt: DirectorStore["updateSplitSceneEndFramePrompt"];
  updateSplitSceneNeedsEndFrame: DirectorStore["updateSplitSceneNeedsEndFrame"];
};

export function useStoryboardPromptGeneration({
  storyboardImage,
  scenes,
  storyboardConfig,
  setIsGeneratingPrompts,
  updateSplitSceneImagePrompt,
  updateSplitSceneVideoPrompt,
  updateSplitSceneEndFramePrompt,
  updateSplitSceneNeedsEndFrame,
}: UseStoryboardPromptGenerationOptions) {
  return useCallback(async () => {
    if (!storyboardImage || scenes.length === 0) {
      toast.error("无法生成提示词：缺失故事板或分镜");
      return;
    }
    const featureConfig = aiManager.featureConfig("image_understanding");
    setIsGeneratingPrompts(true);
    toast.info("正在根据分镜内容生成提示词...");
    try {
      const prompts = await generateScenePrompts({
        storyboardImage,
        storyPrompt: storyboardConfig.storyPrompt || "视频分镜",
        scenes: scenes.map((scene) => ({
          id: scene.id,
          row: scene.row,
          col: scene.col,
          actionSummary: scene.actionSummary,
          cameraMovement: scene.cameraMovement,
          dialogue: scene.dialogue,
          sceneName: scene.sceneName,
          sceneDescription: scene.sceneLocation,
        })),
        apiKey: featureConfig?.apiKey || "",
        provider: featureConfig?.platform || "",
        baseUrl: featureConfig?.baseUrl?.replace(/\/+$/, "") || "",
        model: featureConfig?.models?.[0] || "",
      });
      let updatedCount = 0;
      let endFrameCount = 0;
      prompts.forEach((prompt) => {
        if (!prompt.videoPrompt && !prompt.imagePrompt) return;
        updateSplitSceneImagePrompt(prompt.id, prompt.imagePrompt, prompt.imagePromptZh);
        updateSplitSceneVideoPrompt(prompt.id, prompt.videoPrompt, prompt.videoPromptZh);
        updateSplitSceneNeedsEndFrame(prompt.id, prompt.needsEndFrame);
        if (prompt.needsEndFrame && prompt.endFramePrompt) {
          updateSplitSceneEndFramePrompt(prompt.id, prompt.endFramePrompt, prompt.endFramePromptZh);
          endFrameCount++;
        }
        updatedCount++;
      });
      toast.success(`成功生成 ${updatedCount} 个分镜的提示词（${endFrameCount} 个需要尾帧）`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "未知错误";
      console.error("[SplitScenes] Prompt generation failed:", error);
      toast.error(`生成失败: ${message}`);
    } finally {
      setIsGeneratingPrompts(false);
    }
  }, [scenes, setIsGeneratingPrompts, storyboardConfig.storyPrompt, storyboardImage, updateSplitSceneEndFramePrompt, updateSplitSceneImagePrompt, updateSplitSceneNeedsEndFrame, updateSplitSceneVideoPrompt]);
}
