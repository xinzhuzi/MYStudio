import { useCallback } from "react";
import type { ScriptScene, Shot } from "@/types/script";
import type { Scene } from "@/stores/scene-store";
import { generateContactSheetPrompt, type SceneViewpoint } from "@/lib/script/scene-viewpoint-generator";
import { getStyleById } from "@/lib/constants/visual-styles";
import { aiManager } from "@/lib/ai/ai-manager";
import { useAppSettingsStore } from "@/stores/app-settings-store";
import { toast } from "sonner";
import { buildContactSheetCopyText, type ContactSheetLayout } from "./generation-panel-utils";

interface UseContactSheetControllerOptions {
  selectedScene: Scene | null;
  allShots: Shot[];
  name: string;
  location: string;
  styleId: string;
  contactSheetAspectRatio: "16:9" | "9:16";
  contactSheetLayout: ContactSheetLayout;
  contactSheetPrompt: string | null;
  contactSheetPromptZh: string | null;
  setContactSheetPrompt: (prompt: string | null) => void;
  setContactSheetPromptZh: (prompt: string | null) => void;
  setExtractedViewpoints: (viewpoints: SceneViewpoint[]) => void;
  setContactSheetImage: (imageUrl: string | null) => void;
  setIsGeneratingContactSheet: (isGenerating: boolean) => void;
  setContactSheetProgress: (progress: number) => void;
}

export function useContactSheetController(options: UseContactSheetControllerOptions) {
  const {
    selectedScene,
    allShots,
    name,
    location,
    styleId,
    contactSheetAspectRatio,
    contactSheetLayout,
    contactSheetPrompt,
    contactSheetPromptZh,
    setContactSheetPrompt,
    setContactSheetPromptZh,
    setExtractedViewpoints,
    setContactSheetImage,
    setIsGeneratingContactSheet,
    setContactSheetProgress,
  } = options;

  const handleGenerateContactSheetPrompt = useCallback(() => {
    if (!selectedScene) {
      toast.error("请先选择场景");
      return;
    }
    const sceneShots = allShots.filter(
      (shot) => shot.sceneRefId === selectedScene.id || shot.sceneId === selectedScene.id,
    );
    if (sceneShots.length === 0) toast.warning("该场景没有关联的分镜，将使用默认视角");
    const stylePreset = getStyleById(styleId);
    const sceneData = {
      ...selectedScene,
      name: name || selectedScene.name,
      location: location || selectedScene.location,
    } as unknown as ScriptScene;
    const result = generateContactSheetPrompt({
      scene: sceneData,
      shots: sceneShots,
      styleTokens: stylePreset?.prompt ? [stylePreset.prompt] : ["anime style", "soft colors"],
      aspectRatio: contactSheetAspectRatio,
    });
    setContactSheetPrompt(result.prompt);
    setContactSheetPromptZh(result.promptZh);
    setExtractedViewpoints(result.viewpoints);
    const sourceText = sceneData.viewpoints?.length ? "AI 分析" : "关键词提取";
    toast.success(`${sourceText} ${result.viewpoints.length} 个视角，提示词已生成`);
  }, [allShots, contactSheetAspectRatio, location, name, selectedScene, setContactSheetPrompt, setContactSheetPromptZh, setExtractedViewpoints, styleId]);

  const handleCopyPrompt = useCallback(async (isEnglish: boolean) => {
    const prompt = isEnglish ? contactSheetPrompt : contactSheetPromptZh;
    if (!prompt) return;
    try {
      await navigator.clipboard.writeText(buildContactSheetCopyText({
        isEnglish,
        prompt,
        styleId,
        aspectRatio: contactSheetAspectRatio,
        layout: contactSheetLayout,
      }));
      toast.success(isEnglish ? "英文提示词已复制（含风格和宽高比）" : "中文提示词已复制（含风格和宽高比）");
    } catch (error) {
      console.error("[ContactSheet] 复制提示词失败:", error);
      toast.error("复制提示词失败");
    }
  }, [contactSheetAspectRatio, contactSheetLayout, contactSheetPrompt, contactSheetPromptZh, styleId]);

  const handleGenerateContactSheetImage = useCallback(async () => {
    if (!contactSheetPrompt) {
      toast.error("请先生成提示词");
      return;
    }
    const featureConfig = aiManager.featureConfig("character_generation");
    if (!featureConfig) {
      toast.error(aiManager.featureNotConfiguredMessage("character_generation"));
      return;
    }
    const apiKey = featureConfig.apiKey;
    const baseUrl = featureConfig.baseUrl?.replace(/\/+$/, "") || "";
    const model = featureConfig.models?.[0] || "";
    if (!apiKey || !baseUrl || !model) {
      toast.error("图片生成 API 未配置");
      return;
    }

    setIsGeneratingContactSheet(true);
    setContactSheetProgress(0);
    try {
      const stylePreset = getStyleById(styleId);
      const negativePrompt = stylePreset?.category === "real"
        ? "blurry, low quality, watermark, text, labels, titles, captions, words, letters, numbers, annotations, subtitles, typography, font, writing, people, characters, anime, cartoon, distorted grid, uneven panels"
        : "blurry, low quality, watermark, text, labels, titles, captions, words, letters, numbers, annotations, subtitles, typography, font, writing, people, characters, distorted grid, uneven panels";
      let finalPrompt = contactSheetPrompt;
      const isChinese = /[\u4e00-\u9fa5]/.test(finalPrompt) && !finalPrompt.includes("<instruction>");
      if (isChinese) {
        const dimensions = contactSheetLayout === "2x2" ? { rows: 2, cols: 2 } : { rows: 3, cols: 3 };
        const panelAspect = contactSheetAspectRatio === "16:9" ? "16:9 (horizontal landscape)" : "9:16 (vertical portrait)";
        finalPrompt = [
          "<instruction>",
          `Generate a clean ${dimensions.rows}x${dimensions.cols} storyboard grid with exactly ${dimensions.rows * dimensions.cols} equal-sized panels.`,
          `Overall Image Aspect Ratio: ${contactSheetAspectRatio}.`,
          `Each individual panel must have a ${panelAspect} aspect ratio.`,
          stylePreset?.prompt ? `MANDATORY Visual Style for ALL panels: ${stylePreset.prompt}` : "",
          "Structure: No borders between panels, no text, no watermarks, no speech bubbles.",
          "Consistency: Maintain consistent perspective, lighting, color grading, and visual style across ALL panels.",
          "</instruction>",
          "",
          contactSheetPrompt,
          "",
          `Negative constraints: ${negativePrompt}`,
        ].filter(Boolean).join("\n");
      } else if (!finalPrompt.includes("Negative constraints:")) {
        finalPrompt += `\nNegative constraints: ${negativePrompt}`;
      }

      setContactSheetProgress(20);
      const imageSettings = useAppSettingsStore.getState().imageGenerationSettings;
      const result = await aiManager.imageGrid({
        model,
        prompt: finalPrompt,
        apiKey,
        baseUrl,
        aspectRatio: contactSheetAspectRatio,
        resolution: imageSettings.defaultResolution,
        keyManager: featureConfig.keyManager,
      });
      if (!result.imageUrl) throw new Error("图片生成失败：未返回图片 URL");

      let finalImageUrl = result.imageUrl;
      if (/^https?:\/\//.test(finalImageUrl)) {
        try {
          const response = await fetch(finalImageUrl);
          if (!response.ok) throw new Error(`图片下载失败: HTTP ${response.status}`);
          const blob = await response.blob();
          finalImageUrl = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(String(reader.result));
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          });
          console.log("[ContactSheet] HTTP→base64 转换成功");
        } catch {
          console.warn("[ContactSheet] HTTP→base64 转换失败，使用原URL");
        }
      }
      setContactSheetProgress(100);
      setContactSheetImage(finalImageUrl);
      toast.success("联合图生成成功，可以进行切割");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[ContactSheet] 生成失败:", error);
      toast.error(`生成失败: ${message}`);
    } finally {
      setIsGeneratingContactSheet(false);
      setContactSheetProgress(0);
    }
  }, [contactSheetAspectRatio, contactSheetLayout, contactSheetPrompt, setContactSheetImage, setContactSheetProgress, setIsGeneratingContactSheet, styleId]);

  return { handleGenerateContactSheetPrompt, handleCopyPrompt, handleGenerateContactSheetImage };
}
