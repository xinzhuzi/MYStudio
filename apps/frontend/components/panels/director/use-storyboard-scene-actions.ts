import { useCallback } from "react";
import { toast } from "sonner";
import { persistSceneImage } from "@/lib/utils/image-persist";
import {
  useDirectorStore,
  type DurationType,
  type EmotionTag,
  type ShotSizeType,
  type SoundEffectTag,
  type SplitScene,
} from "@/stores/director-store";

type UseStoryboardSceneActionsOptions = {
  scenes: Array<Pick<SplitScene, "id" | "characterVariationMap">>;
  onBack?: () => void;
  formatDeletedSceneNumber: (sceneId: number) => number;
};

export function useStoryboardSceneActions({
  scenes,
  onBack,
  formatDeletedSceneNumber,
}: UseStoryboardSceneActionsOptions) {
  const {
    updateSplitSceneEndFrame,
    updateSplitSceneCharacters,
    updateSplitSceneCharacterVariationMap,
    updateSplitSceneEmotions,
    updateSplitSceneShotSize,
    updateSplitSceneDuration,
    updateSplitSceneAmbientSound,
    updateSplitSceneSoundEffects,
    updateSplitSceneImage,
    updateSplitSceneImageStatus,
    deleteSplitScene,
    resetStoryboard,
  } = useDirectorStore();

  const updateEndFrame = useCallback((sceneId: number, imageUrl: string | null) => {
    updateSplitSceneEndFrame(sceneId, imageUrl);
  }, [updateSplitSceneEndFrame]);

  const updateCharacters = useCallback((sceneId: number, characterIds: string[]) => {
    updateSplitSceneCharacters(sceneId, characterIds);
    const currentMap = scenes.find((scene) => scene.id === sceneId)?.characterVariationMap;
    if (!currentMap) return;
    const selectedIds = new Set(characterIds);
    const prunedMap = Object.fromEntries(
      Object.entries(currentMap).filter(([characterId, variationId]) => selectedIds.has(characterId) && variationId),
    );
    const changed = Object.keys(prunedMap).length !== Object.keys(currentMap).length
      || Object.entries(prunedMap).some(([characterId, variationId]) => currentMap[characterId] !== variationId);
    if (changed) updateSplitSceneCharacterVariationMap(sceneId, prunedMap);
  }, [scenes, updateSplitSceneCharacterVariationMap, updateSplitSceneCharacters]);

  const updateCharacterVariationMap = useCallback((sceneId: number, value: Record<string, string>) => {
    updateSplitSceneCharacterVariationMap(sceneId, value);
  }, [updateSplitSceneCharacterVariationMap]);

  const updateEmotions = useCallback((sceneId: number, value: EmotionTag[]) => updateSplitSceneEmotions(sceneId, value), [updateSplitSceneEmotions]);
  const updateShotSize = useCallback((sceneId: number, value: ShotSizeType | null) => updateSplitSceneShotSize(sceneId, value), [updateSplitSceneShotSize]);
  const updateDuration = useCallback((sceneId: number, value: DurationType) => updateSplitSceneDuration(sceneId, value), [updateSplitSceneDuration]);
  const updateAmbientSound = useCallback((sceneId: number, value: string) => updateSplitSceneAmbientSound(sceneId, value), [updateSplitSceneAmbientSound]);
  const updateSoundEffects = useCallback((sceneId: number, value: SoundEffectTag[]) => updateSplitSceneSoundEffects(sceneId, value), [updateSplitSceneSoundEffects]);

  const deleteScene = useCallback((sceneId: number) => {
    deleteSplitScene(sceneId);
    toast.success(`分镜 ${formatDeletedSceneNumber(sceneId)} 已删除`);
  }, [deleteSplitScene, formatDeletedSceneNumber]);

  const removeImage = useCallback((sceneId: number) => {
    updateSplitSceneImage(sceneId, "", undefined, undefined, undefined);
    updateSplitSceneImageStatus(sceneId, { imageStatus: "idle", imageProgress: 0, imageError: null });
  }, [updateSplitSceneImage, updateSplitSceneImageStatus]);

  const uploadImage = useCallback(async (sceneId: number, imageDataUrl: string) => {
    const { localPath, httpUrl } = await persistSceneImage(imageDataUrl, sceneId, "first");
    updateSplitSceneImage(sceneId, localPath, undefined, undefined, httpUrl || undefined);
  }, [updateSplitSceneImage]);

  const goBack = useCallback(() => {
    resetStoryboard();
    onBack?.();
  }, [onBack, resetStoryboard]);

  return {
    updateEndFrame,
    updateCharacters,
    updateCharacterVariationMap,
    updateEmotions,
    updateShotSize,
    updateDuration,
    updateAmbientSound,
    updateSoundEffects,
    deleteScene,
    removeImage,
    uploadImage,
    goBack,
  };
}
