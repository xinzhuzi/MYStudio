import type { Character } from "@/stores/library/character-library-store";
import type { Scene } from "@/stores/library/scene-store";
import type { ScriptCharacter, ScriptScene, Shot } from "@/types/script";
import type { ViewpointMatchResult } from "@/lib/scene/viewpoint-matcher";

interface MapScriptCharactersOptions {
  scriptCharacterIds: string[];
  characterNames?: string[];
  scriptCharacters: ScriptCharacter[];
  libraryCharacters: Character[];
}

export function mapScriptCharactersToLibraryIds({
  scriptCharacterIds,
  characterNames,
  scriptCharacters,
  libraryCharacters,
}: MapScriptCharactersOptions): string[] {
  const libraryIds: string[] = [];
  const addedIds = new Set<string>();

  for (const scriptCharacterId of scriptCharacterIds) {
    const scriptCharacter = scriptCharacters.find(
      (character) => character.id === scriptCharacterId,
    );
    if (!scriptCharacter) continue;

    if (
      scriptCharacter.characterLibraryId &&
      !addedIds.has(scriptCharacter.characterLibraryId)
    ) {
      const linkedLibraryCharacter = libraryCharacters.find(
        (character) => character.id === scriptCharacter.characterLibraryId,
      );
      if (linkedLibraryCharacter) {
        libraryIds.push(linkedLibraryCharacter.id);
        addedIds.add(linkedLibraryCharacter.id);
        continue;
      }
      console.warn(
        `[ContextPanel] Invalid characterLibraryId "${scriptCharacter.characterLibraryId}" for script character "${scriptCharacter.name}", fallback to name matching`,
      );
    }

    const libraryCharacter = libraryCharacters.find(
      (character) => character.name === scriptCharacter.name,
    );
    if (libraryCharacter && !addedIds.has(libraryCharacter.id)) {
      libraryIds.push(libraryCharacter.id);
      addedIds.add(libraryCharacter.id);
    }
  }

  for (const characterName of characterNames || []) {
    if (!characterName) continue;

    let libraryCharacter = libraryCharacters.find(
      (character) => character.name === characterName,
    );
    if (!libraryCharacter) {
      libraryCharacter = libraryCharacters.find(
        (character) =>
          character.name.includes(characterName) ||
          characterName.includes(character.name),
      );
    }

    if (libraryCharacter && !addedIds.has(libraryCharacter.id)) {
      libraryIds.push(libraryCharacter.id);
      addedIds.add(libraryCharacter.id);
    }
  }

  return libraryIds;
}

interface FindQuickSceneViewpointOptions {
  shot: Shot;
  scene: ScriptScene;
  sceneLibraryScenes: Scene[];
  shotIndexInScene?: number;
}

export function findQuickSceneViewpointMatch({
  shot,
  scene,
  sceneLibraryScenes,
  shotIndexInScene,
}: FindQuickSceneViewpointOptions): ViewpointMatchResult | null {
  const sceneName = scene.name || "";
  const parentScene = sceneLibraryScenes.find(
    (libraryScene) =>
      !libraryScene.parentSceneId &&
      !libraryScene.isViewpointVariant &&
      (libraryScene.name.includes(sceneName) ||
        sceneName.includes(libraryScene.name)),
  );

  if (!parentScene) {
    return null;
  }

  const variants = sceneLibraryScenes
    .filter((libraryScene) => libraryScene.parentSceneId === parentScene.id)
    .sort((left, right) => left.createdAt - right.createdAt);

  if (variants.length === 0) {
    return {
      sceneLibraryId: parentScene.id,
      viewpointId: undefined,
      sceneReferenceImage:
        parentScene.referenceImage || parentScene.referenceImageBase64,
      matchedSceneName: parentScene.name,
      matchMethod: "fallback",
      confidence: 0.5,
    };
  }

  const variantWithShot = variants.find((variant) =>
    variant.shotIds?.includes(shot.id),
  );
  if (variantWithShot) {
    return {
      sceneLibraryId: variantWithShot.id,
      viewpointId: variantWithShot.viewpointId,
      sceneReferenceImage:
        variantWithShot.referenceImage || variantWithShot.referenceImageBase64,
      matchedSceneName: variantWithShot.viewpointName || variantWithShot.name,
      matchMethod: "keyword",
      confidence: 0.98,
    };
  }

  const matchedViewpoint = scene.viewpoints?.find((viewpoint) =>
    viewpoint.shotIds?.includes(shot.id),
  );
  if (matchedViewpoint) {
    const matchedVariant = variants.find((variant) => {
      const variantName = variant.viewpointName || variant.name || "";
      return (
        variantName.includes(matchedViewpoint.name) ||
        matchedViewpoint.name.includes(variantName)
      );
    });
    if (matchedVariant) {
      return {
        sceneLibraryId: matchedVariant.id,
        viewpointId: matchedVariant.viewpointId,
        sceneReferenceImage:
          matchedVariant.referenceImage || matchedVariant.referenceImageBase64,
        matchedSceneName: matchedVariant.viewpointName || matchedVariant.name,
        matchMethod: "keyword",
        confidence: 0.95,
      };
    }
  }

  const variantIndex =
    shotIndexInScene !== undefined ? shotIndexInScene % variants.length : 0;
  const matchedVariant = variants[variantIndex];

  return {
    sceneLibraryId: matchedVariant.id,
    viewpointId: matchedVariant.viewpointId,
    sceneReferenceImage:
      matchedVariant.referenceImage || matchedVariant.referenceImageBase64,
    matchedSceneName: matchedVariant.viewpointName || matchedVariant.name,
    matchMethod: "keyword",
    confidence: 0.9,
  };
}
