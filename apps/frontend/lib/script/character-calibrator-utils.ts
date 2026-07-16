import type { CalibrationStrictness, EpisodeRawScript } from '@/types/script';

export interface CharacterStats {
  name: string;
  sceneCount: number;
  dialogueCount: number;
  episodes: number[];
  firstEpisode: number;
  lastEpisode: number;
  dialogueSamples: string[];
  sceneSamples: string[];
}

/** Collects deterministic episode/scene statistics without provider or store dependencies. */
export function collectCharacterStats(
  characterNames: string[],
  episodeScripts: EpisodeRawScript[],
): Map<string, CharacterStats> {
  const stats = new Map<string, CharacterStats>();
  if (!characterNames || !Array.isArray(characterNames)) {
    console.warn('[collectCharacterStats] characterNames 无效');
    return stats;
  }
  if (!episodeScripts || !Array.isArray(episodeScripts)) {
    console.warn('[collectCharacterStats] episodeScripts 无效');
    return stats;
  }
  for (const name of characterNames) {
    if (!name) continue;
    stats.set(name, { name, sceneCount: 0, dialogueCount: 0, episodes: [], firstEpisode: Infinity, lastEpisode: 0, dialogueSamples: [], sceneSamples: [] });
  }
  for (const ep of episodeScripts) {
    if (!ep || !ep.scenes) continue;
    const epIndex = ep.episodeIndex ?? 0;
    for (const scene of ep.scenes) {
      if (!scene) continue;
      for (const charName of scene.characters || []) {
        if (!charName) continue;
        for (const name of characterNames) {
          if (!name || !(charName === name || charName.includes(name) || name.includes(charName))) continue;
          const s = stats.get(name);
          if (!s) continue;
          s.sceneCount++;
          if (!s.episodes.includes(epIndex)) s.episodes.push(epIndex);
          s.firstEpisode = Math.min(s.firstEpisode, epIndex);
          s.lastEpisode = Math.max(s.lastEpisode, epIndex);
          if (s.sceneSamples.length < 3) s.sceneSamples.push(`第${epIndex}集: ${scene.sceneHeader || '未知场景'}`);
        }
      }
      for (const dialogue of scene.dialogues || []) {
        if (!dialogue || !dialogue.character) continue;
        for (const name of characterNames) {
          if (!name || !(dialogue.character === name || dialogue.character.includes(name))) continue;
          const s = stats.get(name);
          if (!s) continue;
          s.dialogueCount++;
          if (s.dialogueSamples.length < 3) s.dialogueSamples.push(`${dialogue.character}: ${(dialogue.line || '').slice(0, 30)}...`);
        }
      }
    }
  }
  for (const s of stats.values()) if (s.firstEpisode === Infinity) s.firstEpisode = 0;
  return stats;
}

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
