import { useCallback } from "react";
import { toast } from "sonner";
import { getStyleTokens } from "@/lib/constants/visual-styles";
import { buildContactSheetDataFromViewpoints } from "@/lib/script/scene-viewpoint-generator";
import type {
  PendingCharacterData,
  PendingDirectorData,
  PendingSceneData,
  Tab,
} from "@/stores/media-panel-store";
import type {
  ProjectBackground,
  PromptLanguage,
  ScriptData,
  Shot,
} from "@/types/script";

type UseScriptNavigationOptions = {
  scriptData: ScriptData | null;
  shots: Shot[];
  styleId: string;
  promptLanguage: PromptLanguage;
  projectBackground: ProjectBackground | null;
  activeEpisodeIndex: number | null;
  activeEpisodeId?: string;
  setActiveTab: (tab: Tab) => void;
  selectLibraryCharacter: (characterId: string) => void;
  goToCharacterWithData: (data: PendingCharacterData) => void;
  goToSceneWithData: (data: PendingSceneData) => void;
  goToDirectorWithData: (data: PendingDirectorData) => void;
};

export function useScriptNavigation({
  scriptData,
  shots,
  styleId,
  promptLanguage,
  projectBackground,
  activeEpisodeIndex,
  activeEpisodeId,
  setActiveTab,
  selectLibraryCharacter,
  goToCharacterWithData,
  goToSceneWithData,
  goToDirectorWithData,
}: UseScriptNavigationOptions) {
  const handleGoToCharacterLibrary = useCallback((characterId: string) => {
    const character = scriptData?.characters.find((item) => item.id === characterId);
    if (!character) {
      setActiveTab("characters");
      toast.info("已跳转到角色库");
      return;
    }
    if (character.characterLibraryId) {
      selectLibraryCharacter(character.characterLibraryId);
      setActiveTab("characters");
      toast.info(`已跳转到角色库，选中「${character.name}」`);
      return;
    }
    goToCharacterWithData({
      name: character.name,
      gender: character.gender,
      age: character.age,
      personality: character.personality,
      role: character.role,
      traits: character.traits,
      skills: character.skills,
      keyActions: character.keyActions,
      appearance: character.appearance,
      relationships: character.relationships,
      tags: character.tags,
      notes: character.notes,
      styleId,
      promptLanguage,
      visualPromptEn: character.visualPromptEn,
      visualPromptZh: character.visualPromptZh,
      identityAnchors: character.identityAnchors,
      negativePrompt: character.negativePrompt,
      stageInfo: character.stageInfo,
      consistencyElements: character.consistencyElements,
      storyYear: projectBackground?.storyStartYear,
      era: projectBackground?.era || projectBackground?.timelineSetting,
      sourceEpisodeIndex: activeEpisodeIndex ?? undefined,
      sourceEpisodeId: activeEpisodeId,
    });
    toast.success(`已跳转到角色库，角色「${character.name}」信息已填充到生成控制台`);
  }, [activeEpisodeId, activeEpisodeIndex, goToCharacterWithData, projectBackground, promptLanguage, scriptData, selectLibraryCharacter, setActiveTab, styleId]);

  const handleGoToSceneLibrary = useCallback((sceneId: string) => {
    const scene = scriptData?.scenes.find((item) => item.id === sceneId);
    if (!scene) {
      setActiveTab("scenes");
      toast.info("已跳转到场景库");
      return;
    }
    const hasViewpoints = Boolean(scene.viewpoints?.length);
    const hasCalibrationData = scene.architectureStyle || scene.keyProps?.length || scene.lightingDesign;
    if (hasViewpoints) {
      const invalidViewpoints = scene.viewpoints!.filter((viewpoint) => !viewpoint.name || !viewpoint.id);
      if (invalidViewpoints.length > 0) {
        console.warn("[handleGoToSceneLibrary] 发现不完整的 viewpoints:", invalidViewpoints);
        toast.warning('视角数据不完整，请重新执行"AI 分析场景视角"');
        return;
      }
      const contactSheetData = buildContactSheetDataFromViewpoints(
        scene.viewpoints!,
        scene,
        shots,
        getStyleTokens(styleId),
        "16:9",
      );
      console.log("[handleGoToSceneLibrary] 使用 AI 分析数据生成联合图:", {
        sceneId: scene.id,
        viewpointsCount: scene.viewpoints!.length,
        pendingViewpointsCount: contactSheetData.viewpoints.length,
        contactSheetPromptsCount: contactSheetData.contactSheetPrompts.length,
      });
      goToSceneWithData({
        name: scene.name || scene.location,
        location: scene.location,
        time: scene.time,
        atmosphere: scene.atmosphere,
        styleId,
        tags: scene.tags,
        notes: scene.notes,
        visualPrompt: scene.visualPrompt,
        visualPromptEn: scene.visualPromptEn,
        architectureStyle: scene.architectureStyle,
        lightingDesign: scene.lightingDesign,
        colorPalette: scene.colorPalette,
        eraDetails: scene.eraDetails,
        keyProps: scene.keyProps,
        spatialLayout: scene.spatialLayout,
        viewpoints: contactSheetData.viewpoints,
        contactSheetPrompts: contactSheetData.contactSheetPrompts,
        sourceEpisodeIndex: activeEpisodeIndex ?? undefined,
        sourceEpisodeId: activeEpisodeId,
        promptLanguage,
      });
      toast.success(
        `已跳转到场景库，场景「${scene.name || scene.location}」已填充\n` +
        `✔ ${scene.viewpoints!.length} 个 AI 分析视角已加载`,
      );
      return;
    }
    goToSceneWithData({
      name: scene.name || scene.location,
      location: scene.location,
      time: scene.time,
      atmosphere: scene.atmosphere,
      styleId,
      tags: scene.tags,
      notes: scene.notes,
      ...(hasCalibrationData && {
        visualPrompt: scene.visualPrompt,
        visualPromptEn: scene.visualPromptEn,
        architectureStyle: scene.architectureStyle,
        lightingDesign: scene.lightingDesign,
        colorPalette: scene.colorPalette,
        eraDetails: scene.eraDetails,
        keyProps: scene.keyProps,
        spatialLayout: scene.spatialLayout,
      }),
      sourceEpisodeIndex: activeEpisodeIndex ?? undefined,
      sourceEpisodeId: activeEpisodeId,
      promptLanguage,
    });
    toast.success(`已跳转到场景库，场景「${scene.name || scene.location}」基础信息已填充`);
  }, [activeEpisodeId, activeEpisodeIndex, goToSceneWithData, promptLanguage, scriptData, shots, setActiveTab, styleId]);

  const handleGoToDirector = useCallback((shotId: string) => {
    const shot = shots.find((item) => item.id === shotId);
    if (!shot) {
      setActiveTab("director");
      toast.info("已跳转到AI导演");
      return;
    }
    const scene = scriptData?.scenes.find((item) => item.id === shot.sceneRefId);
    const promptParts: string[] = [];
    if (scene) {
      promptParts.push(`场景：${scene.location || scene.name}`);
      if (scene.time) promptParts.push(`时间：${scene.time}`);
      if (scene.atmosphere) promptParts.push(`氛围：${scene.atmosphere}`);
    }
    if (shot.actionSummary) promptParts.push(`\n动作：${shot.actionSummary}`);
    if (shot.dialogue) promptParts.push(`对白：「${shot.dialogue}」`);
    goToDirectorWithData({
      storyPrompt: promptParts.join("\n"),
      characterNames: shot.characterNames,
      sceneLocation: scene?.location,
      sceneTime: scene?.time,
      shotId,
      sceneCount: 1,
      styleId,
      sourceType: "shot",
      sourceEpisodeIndex: activeEpisodeIndex ?? undefined,
      sourceEpisodeId: activeEpisodeId,
    });
    toast.success("已跳转到AI导演，分镜内容已填充");
  }, [activeEpisodeId, activeEpisodeIndex, goToDirectorWithData, scriptData, setActiveTab, shots, styleId]);

  const handleGoToDirectorFromScene = useCallback((sceneId: string) => {
    const scene = scriptData?.scenes.find((item) => item.id === sceneId);
    if (!scene) {
      setActiveTab("director");
      toast.info("已跳转到AI导演");
      return;
    }
    const sceneShots = shots.filter((item) => item.sceneRefId === sceneId);
    const shotCount = sceneShots.length || 1;
    const promptParts = [`场景：${scene.location || scene.name}`];
    if (scene.time) promptParts.push(`时间：${scene.time}`);
    if (scene.atmosphere) promptParts.push(`氛围：${scene.atmosphere}`);
    if (sceneShots.length > 0) {
      promptParts.push(`\n--- 分镜列表 (${sceneShots.length}个) ---`);
      sceneShots.forEach((shot, index) => {
        promptParts.push([
          `\n[分镜${index + 1}]`,
          shot.actionSummary ? `动作：${shot.actionSummary}` : null,
          shot.dialogue ? `对白：「${shot.dialogue}」` : null,
        ].filter(Boolean).join(" "));
      });
    }
    const characterNames = new Set<string>();
    sceneShots.forEach((shot) => shot.characterNames?.forEach((name) => characterNames.add(name)));
    goToDirectorWithData({
      storyPrompt: promptParts.join("\n"),
      characterNames: Array.from(characterNames),
      sceneLocation: scene.location,
      sceneTime: scene.time,
      sceneCount: shotCount,
      styleId,
      sourceType: "scene",
      sourceEpisodeIndex: activeEpisodeIndex ?? undefined,
      sourceEpisodeId: activeEpisodeId,
    });
    toast.success(`已跳转到AI导演，场景「${scene.name || scene.location}」已填充 (${shotCount}个分镜)`);
  }, [activeEpisodeId, activeEpisodeIndex, goToDirectorWithData, scriptData, setActiveTab, shots, styleId]);

  return {
    handleGoToCharacterLibrary,
    handleGoToSceneLibrary,
    handleGoToDirector,
    handleGoToDirectorFromScene,
  };
}
