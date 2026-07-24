import type { CharacterVariation } from "@/stores/character-library-store";
import type { CharacterConsistencyElements, CharacterStageInfo } from "@/types/script";

interface BuildCharacterStageVariationOptions {
  stageInfo?: CharacterStageInfo;
  consistencyElements?: CharacterConsistencyElements;
  visualPromptEn?: string;
  visualPromptZh?: string;
}

export function buildCharacterStageVariation({
  stageInfo,
  consistencyElements,
  visualPromptEn,
  visualPromptZh,
}: BuildCharacterStageVariationOptions): Omit<CharacterVariation, "id"> | undefined {
  if (!stageInfo) return undefined;

  const identityPrompt = [
    consistencyElements?.facialFeatures,
    consistencyElements?.bodyType,
    consistencyElements?.uniqueMarks,
  ].filter(Boolean).join(", ");
  const stagePrompt = [stageInfo.ageDescription, stageInfo.stageName].filter(Boolean).join(", ");

  return {
    name: stageInfo.stageName,
    visualPrompt: visualPromptEn || [identityPrompt, stagePrompt].filter(Boolean).join(", "),
    ...(visualPromptZh ? { visualPromptZh } : {}),
    isStageVariation: true,
    episodeRange: stageInfo.episodeRange,
    ...(stageInfo.ageDescription ? { ageDescription: stageInfo.ageDescription } : {}),
    stageDescription: stageInfo.stageName,
  };
}

export function hasMatchingStageVariation(
  variations: readonly CharacterVariation[],
  stageInfo: CharacterStageInfo,
): boolean {
  return variations.some((variation) => (
    variation.isStageVariation
    && variation.name === stageInfo.stageName
    && variation.episodeRange?.[0] === stageInfo.episodeRange[0]
    && variation.episodeRange?.[1] === stageInfo.episodeRange[1]
  ));
}
