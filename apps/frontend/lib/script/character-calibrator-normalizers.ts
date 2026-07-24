// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

import type {
  CharacterIdentityAnchors,
  CharacterNegativePrompt,
  PromptLanguage,
  ScriptCharacter,
} from '@/types/script';

/** AI-calibrated character data used by the calibration workflow. */
export interface CalibratedCharacter {
  id: string;
  name: string;
  importance: 'protagonist' | 'supporting' | 'minor' | 'extra';
  episodeRange?: [number, number];
  appearanceCount: number;
  role?: string;
  age?: string;
  gender?: string;
  relationships?: string;
  nameVariants: string[];
  visualPromptEn?: string;
  visualPromptZh?: string;
  facialFeatures?: string;
  uniqueMarks?: string;
  clothingStyle?: string;
  identityAnchors?: CharacterIdentityAnchors;
  negativePrompt?: CharacterNegativePrompt;
}

/** Converts calibrated results back to the script contract without dropping existing fields. */
export function convertToScriptCharacters(
  calibrated: CalibratedCharacter[],
  originalCharacters?: ScriptCharacter[],
  promptLanguage: PromptLanguage = 'zh+en',
): ScriptCharacter[] {
  return calibrated.map((character) => {
    const original = originalCharacters?.find((item) => item.name === character.name);
    const nextVisualPromptEn = character.visualPromptEn || original?.visualPromptEn;
    const nextVisualPromptZh = character.visualPromptZh || original?.visualPromptZh;

    return {
      ...original,
      id: character.id,
      name: character.name,
      role: character.role || original?.role,
      age: character.age || original?.age,
      gender: character.gender || original?.gender,
      relationships: character.relationships || original?.relationships,
      visualPromptEn: promptLanguage === 'zh' ? undefined : nextVisualPromptEn,
      visualPromptZh: promptLanguage === 'en' ? undefined : nextVisualPromptZh,
      appearance: character.facialFeatures || character.uniqueMarks || character.clothingStyle
        ? [character.facialFeatures, character.uniqueMarks, character.clothingStyle].filter(Boolean).join(', ')
        : original?.appearance,
      identityAnchors: character.identityAnchors || original?.identityAnchors,
      negativePrompt: character.negativePrompt || original?.negativePrompt,
      tags: [character.importance, `出场${character.appearanceCount}次`, ...(original?.tags || [])],
    };
  });
}

function cloneScriptCharactersForRecovery(
  characters: ScriptCharacter[] | undefined,
  source: 'calibrated' | 'existing' | 'series-meta' | 'raw',
): ScriptCharacter[] {
  if (!Array.isArray(characters) || characters.length === 0) return [];

  const seen = new Set<string>();
  const recovered: ScriptCharacter[] = [];

  for (let index = 0; index < characters.length; index += 1) {
    const character = characters[index];
    const name = character?.name?.trim();
    if (!name) continue;

    const key = (character.id && character.id.trim()) || name;
    if (seen.has(key)) continue;
    seen.add(key);

    recovered.push({
      ...character,
      id: character.id || `char_recovered_${index + 1}`,
      name,
      tags: Array.isArray(character.tags) && character.tags.length > 0
        ? [...new Set(character.tags.filter(Boolean))]
        : source === 'raw'
          ? ['minor', 'recovered']
          : character.tags,
    });
  }

  return recovered;
}

/** Chooses the first non-empty character source while preserving safe recovery semantics. */
export function resolveSafeScriptCharacters(
  preferredCharacters: ScriptCharacter[],
  options?: {
    existingCharacters?: ScriptCharacter[];
    seriesMetaCharacters?: ScriptCharacter[];
    rawCharacters?: ScriptCharacter[];
  },
): {
  characters: ScriptCharacter[];
  source: 'calibrated' | 'existing' | 'series-meta' | 'raw' | 'empty';
} {
  const candidates: Array<{
    source: 'calibrated' | 'existing' | 'series-meta' | 'raw';
    characters?: ScriptCharacter[];
  }> = [
    { source: 'calibrated', characters: preferredCharacters },
    { source: 'existing', characters: options?.existingCharacters },
    { source: 'series-meta', characters: options?.seriesMetaCharacters },
    { source: 'raw', characters: options?.rawCharacters },
  ];

  for (const candidate of candidates) {
    const characters = cloneScriptCharactersForRecovery(candidate.characters, candidate.source);
    if (characters.length > 0) return { characters, source: candidate.source };
  }

  return { characters: [], source: 'empty' };
}

/** Returns a new list ordered by importance and then appearance count. */
export function sortByImportance(characters: CalibratedCharacter[]): CalibratedCharacter[] {
  const order = { protagonist: 0, supporting: 1, minor: 2, extra: 3 };
  return [...characters].sort((a, b) => {
    const importanceOrder = order[a.importance] - order[b.importance];
    return importanceOrder !== 0 ? importanceOrder : b.appearanceCount - a.appearanceCount;
  });
}
