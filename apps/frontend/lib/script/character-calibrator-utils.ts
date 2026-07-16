import type { CalibrationStrictness } from '@/types/script';

export interface CharacterPriorityStats {
  sceneCount: number;
  dialogueCount: number;
  episodeCount: number;
}

export interface CharacterPriorityRecord extends CharacterPriorityStats {
  name: string;
  isGroupExtra: boolean;
  hasSpecificName: boolean;
  priority: number;
}

/** Purely classifies extracted names before they are sent to the AI. */
export function buildCharacterPriorityRecords(
  names: string[],
  stats: ReadonlyMap<string, CharacterPriorityStats>,
  strictness: CalibrationStrictness,
): CharacterPriorityRecord[] {
  return names.map((name) => {
    const current = stats.get(name);
    const isGroupExtra = strictness !== 'loose' && [
      '保安', '警察', '员工', '护士', '医生', '记者', '律师', '路人', '众人', '若干', '群众', '大妈',
    ].some((keyword) => name === keyword || name === `${keyword}1` || name === `${keyword}2`
      || name.startsWith('几名') || name.startsWith('两个') || name.startsWith('若干'));
    const hasSpecificName = (name.length >= 2 && name.length <= 4 && /[\u4e00-\u9fa5]/.test(name))
      || name.includes('哥') || name.includes('姐') || name.includes('董') || name.includes('总')
      || name.includes('老') || name.includes('小') || /^[A-Z][a-z]+$/.test(name);
    const sceneCount = current?.sceneCount || 0;
    const dialogueCount = current?.dialogueCount || 0;
    return {
      name,
      sceneCount,
      dialogueCount,
      episodeCount: current?.episodeCount || 0,
      isGroupExtra,
      hasSpecificName,
      priority: isGroupExtra ? -1000 : hasSpecificName ? 1000 + sceneCount + dialogueCount : sceneCount + dialogueCount,
    };
  }).sort((a, b) => b.priority - a.priority);
}
