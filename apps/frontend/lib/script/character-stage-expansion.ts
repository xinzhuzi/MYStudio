import type { PromptLanguage, ScriptCharacter } from "@/types/script";
import type { CharacterStageAnalysis } from "./character-stage-analyzer";

export interface CharacterStageExpansionResult {
  characters: ScriptCharacter[];
  stageCount: number;
  multiStageCharacterCount: number;
}

export function expandCharacterStages(
  characters: readonly ScriptCharacter[],
  analyses: readonly CharacterStageAnalysis[],
  promptLanguage: PromptLanguage,
): CharacterStageExpansionResult {
  const expandedBaseCharacters = characters.map((character) => ({ ...character }));
  const stageCharacters: ScriptCharacter[] = [];
  const multiStageAnalyses = analyses.filter((analysis) => analysis.needsMultiStage);
  const expandedCharacterIds = new Set<string>();

  for (const analysis of multiStageAnalyses) {
    if (analysis.stages.length === 0) continue;
    const baseCharacterIndex = expandedBaseCharacters.findIndex(
      (character) => character.name === analysis.characterName,
    );
    if (baseCharacterIndex === -1) continue;

    const baseCharacter = expandedBaseCharacters[baseCharacterIndex];
    if (expandedCharacterIds.has(baseCharacter.id)) continue;
    expandedCharacterIds.add(baseCharacter.id);
    const stageCharacterIds = analysis.stages.map((stage, stageIndex) => {
      const stageCharacterId = `${baseCharacter.id}_stage_${stageIndex}_${stage.name.replace(/\s+/g, "_")}`;
      stageCharacters.push({
        id: stageCharacterId,
        name: `${baseCharacter.name}（${stage.name}）`,
        gender: baseCharacter.gender,
        age: stage.ageDescription,
        personality: baseCharacter.personality,
        role: `${stage.stageDescription}\n\n原始角色背景：${baseCharacter.role || ""}`,
        traits: baseCharacter.traits,
        appearance: baseCharacter.appearance,
        relationships: baseCharacter.relationships,
        tags: [...(baseCharacter.tags || []), stage.name, "阶段角色"],
        baseCharacterId: baseCharacter.id,
        stageInfo: {
          stageName: stage.name,
          episodeRange: stage.episodeRange,
          ageDescription: stage.ageDescription,
        },
        consistencyElements: analysis.consistencyElements,
        visualPromptEn: promptLanguage === "zh" ? undefined : [
          analysis.consistencyElements.facialFeatures,
          analysis.consistencyElements.bodyType,
          analysis.consistencyElements.uniqueMarks,
          stage.visualPromptEn,
        ].filter(Boolean).join(", "),
        visualPromptZh: promptLanguage === "en" ? undefined : stage.visualPromptZh,
        identityAnchors: baseCharacter.identityAnchors,
        negativePrompt: baseCharacter.negativePrompt,
      });
      return stageCharacterId;
    });

    expandedBaseCharacters[baseCharacterIndex] = {
      ...baseCharacter,
      stageCharacterIds,
      consistencyElements: analysis.consistencyElements,
      tags: [...(baseCharacter.tags || []).filter((tag) => tag !== "protagonist"), "父角色"],
      notes: `此角色有 ${stageCharacterIds.length} 个阶段版本，请分别为各阶段版本生成形象`,
    };
  }

  const orderedCharacters = expandedBaseCharacters.flatMap((character) => [
    character,
    ...stageCharacters.filter((stageCharacter) => stageCharacter.baseCharacterId === character.id),
  ]);

  return {
    characters: orderedCharacters,
    stageCount: stageCharacters.length,
    multiStageCharacterCount: expandedCharacterIds.size,
  };
}
