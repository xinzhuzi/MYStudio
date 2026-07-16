import type { Shot } from "@/types/script";
import { useCharacterLibraryStore } from "@/stores/character-library-store";
import { useScriptStore } from "@/stores/script-store";
import { getVariationForEpisode } from "./character-stage-analyzer";
import type { ShotFactoryParams } from "./shot-content-parser";

export function matchCharacterVariationsForEpisode(
  characterIds: string[],
  episodeIndex: number,
): Record<string, string> {
  const characterVariations: Record<string, string> = {};
  const characterLibrary = useCharacterLibraryStore.getState();

  for (const characterId of characterIds) {
    const projects = Object.values(useScriptStore.getState().projects);
    for (const project of projects) {
      const scriptCharacter = project.scriptData?.characters.find((character) => character.id === characterId);
      if (scriptCharacter?.characterLibraryId) {
        const libraryCharacter = characterLibrary.getCharacterById(scriptCharacter.characterLibraryId);
        if (libraryCharacter && libraryCharacter.variations.length > 0) {
          const matchedVariation = getVariationForEpisode(libraryCharacter.variations, episodeIndex);
          if (matchedVariation) {
            characterVariations[characterId] = matchedVariation.id;
            console.log(
              `[VariationMatch] 角色 ${scriptCharacter.name} 第${episodeIndex}集 -> 使用变体 "${matchedVariation.name}"`,
            );
          }
        }
        break;
      }
    }
  }
  return characterVariations;
}

export function getEpisodeIndexFromId(episodeId: string): number {
  const match = episodeId.match(/ep_(\d+)/);
  return match ? parseInt(match[1], 10) : 1;
}

export function createShot(params: ShotFactoryParams): Shot {
  const episodeIndex = getEpisodeIndexFromId(params.episodeId);
  const characterVariations = matchCharacterVariationsForEpisode(params.characterIds, episodeIndex);
  return {
    id: `shot_${Date.now()}_${params.index}`,
    index: params.index,
    episodeId: params.episodeId,
    sceneRefId: params.sceneRefId,
    actionSummary: params.actionSummary,
    visualDescription: params.visualDescription,
    dialogue: params.dialogue,
    characterNames: params.characterNames,
    characterIds: params.characterIds,
    characterVariations,
    shotSize: params.shotSize,
    duration: params.duration,
    ambientSound: params.ambientSound,
    cameraMovement: params.cameraMovement || "Static",
    imageStatus: "idle",
    imageProgress: 0,
    videoStatus: "idle",
    videoProgress: 0,
  };
}
