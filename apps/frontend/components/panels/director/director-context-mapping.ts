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
      console.log(
        `[ContextPanel] Matched character "${characterName}" to library "${libraryCharacter.name}"`,
      );
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
    console.log(
      `[findMatchingSceneAndViewpointQuick] 未找到匹配的父场景: "${sceneName}"`,
    );
    return null;
  }

  const variants = sceneLibraryScenes
    .filter((libraryScene) => libraryScene.parentSceneId === parentScene.id)
    .sort((left, right) => left.createdAt - right.createdAt);
  console.log(
    `[findMatchingSceneAndViewpointQuick] 场景 "${sceneName}" 有 ${variants.length} 个视角变体`,
  );

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
    console.log(
      `[findMatchingSceneAndViewpointQuick] 通过场景库shotIds匹配: 分镜${shot.id} -> 视角 "${variantWithShot.viewpointName || variantWithShot.name}"`,
    );
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
      console.log(
        `[findMatchingSceneAndViewpointQuick] 通过剧本shotIds匹配: 分镜${shot.id} -> 视角 "${matchedVariant.viewpointName || matchedVariant.name}"`,
      );
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
  console.log(
    `[findMatchingSceneAndViewpointQuick] 通过序号匹配: 分镜序号 ${(shotIndexInScene ?? 0) + 1} -> 视角变体 ${variantIndex + 1}: "${matchedVariant.viewpointName || matchedVariant.name}"`,
  );

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
