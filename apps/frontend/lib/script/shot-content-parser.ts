import type { Shot } from '@/types/script';

export interface SceneShotSource {
  id: string;
  name?: string;
  location: string;
  time: string;
  atmosphere: string;
  rawContent: string;
  dialogues: Array<{ character: string; parenthetical?: string; line: string }>;
  actions: string[];
}

export interface ShotFactoryParams {
  index: number;
  episodeId: string;
  sceneRefId: string;
  actionSummary: string;
  visualDescription: string;
  dialogue?: string;
  characterNames: string[];
  characterIds: string[];
  shotSize: string;
  duration: number;
  ambientSound?: string;
  cameraMovement?: string;
}

export type ShotFactory = (params: ShotFactoryParams) => Shot;

function detectAmbientSound(text: string, atmosphere: string): string {
  if (text.includes('雨') || atmosphere.includes('雨')) return '雨声';
  if (text.includes('风') || atmosphere.includes('风')) return '风声';
  if (text.includes('海') || text.includes('码头')) return '海浪声、海鸥声';
  if (text.includes('街') || text.includes('市场')) return '街道喧嚣、人声鼎沸';
  if (text.includes('夜') || atmosphere.includes('夜')) return '夜晚寂静、虫鸣';
  if (text.includes('饭') || text.includes('吃')) return '餐具碰撞声';
  return '环境音';
}

export function generateShotsFromSceneContent(
  scene: SceneShotSource,
  episodeId: string,
  startIndex: number,
  characters: Array<{ id: string; name: string }>,
  createShot: ShotFactory,
): Shot[] {
  const shots: Shot[] = [];
  let index = startIndex;
  const lines = scene.rawContent.split('\n').filter((line) => line.trim());

  for (const line of lines) {
    const trimmedLine = line.trim();
    if (!trimmedLine) continue;
    if (trimmedLine.startsWith('人物') || trimmedLine.startsWith('**人物')) continue;
    if (trimmedLine.match(/^\*\*[^人物\*]+\*\*$/)) continue;

    const dialogueMatch = trimmedLine.match(/^([^：:（\([【\n△\*]{1,10})[：:]\s*(?:[（\(]([^）\)]+)[）\)])?\s*(.+)$/);
    if (dialogueMatch) {
      const charName = dialogueMatch[1].trim();
      const parenthetical = dialogueMatch[2]?.trim() || '';
      const dialogueText = dialogueMatch[3].trim();
      if (charName.match(/^[字幕旁白场景人物]/)) continue;
      const charId = characters.find((character) => character.name === charName)?.id || '';
      shots.push(createShot({
        index: index++, episodeId, sceneRefId: scene.id, actionSummary: `${charName}说话`,
        visualDescription: `${scene.location}，${charName}${parenthetical ? `（${parenthetical}）` : ''}说："${dialogueText.slice(0, 50)}${dialogueText.length > 50 ? '...' : ''}"`,
        dialogue: `${charName}${parenthetical ? `（${parenthetical}）` : ''}：${dialogueText}`,
        characterNames: [charName], characterIds: charId ? [charId] : [],
        shotSize: dialogueText.length > 30 ? 'MS' : 'CU',
        duration: Math.max(3, Math.ceil(dialogueText.length / 10)),
      }));
      continue;
    }

    if (trimmedLine.startsWith('△')) {
      const actionText = trimmedLine.slice(1).trim();
      const mentionedChars = characters.filter((character) => actionText.includes(character.name));
      shots.push(createShot({
        index: index++, episodeId, sceneRefId: scene.id, actionSummary: actionText,
        visualDescription: `${scene.location}，${actionText}`,
        characterNames: mentionedChars.map((character) => character.name),
        characterIds: mentionedChars.map((character) => character.id),
        shotSize: actionText.includes('全景') || actionText.includes('远') ? 'WS' : 'MS',
        duration: Math.max(2, Math.ceil(actionText.length / 15)),
        ambientSound: detectAmbientSound(actionText, scene.atmosphere),
      }));
      continue;
    }

    if (trimmedLine.startsWith('【') && trimmedLine.endsWith('】')) {
      const subtitleText = trimmedLine.slice(1, -1);
      if (subtitleText.includes('闪回')) {
        shots.push(createShot({
          index: index++, episodeId, sceneRefId: scene.id, actionSummary: subtitleText,
          visualDescription: `【${subtitleText}】画面渐变过渡`, characterNames: [], characterIds: [],
          shotSize: 'WS', duration: 2,
        }));
        continue;
      }
      if (subtitleText.startsWith('字幕')) {
        shots.push(createShot({
          index: index++, episodeId, sceneRefId: scene.id, actionSummary: '字幕显示',
          visualDescription: `画面叠加字幕：${subtitleText.replace('字幕：', '').replace('字幕:', '')}`,
          characterNames: [], characterIds: [], shotSize: 'WS', duration: 3,
        }));
      }
    }
  }

  if (shots.length === 0) {
    shots.push(createShot({
      index, episodeId, sceneRefId: scene.id,
      actionSummary: `${scene.name || scene.location} 建立镜头`,
      visualDescription: `${scene.location}，${scene.atmosphere}的氛围`,
      characterNames: [], characterIds: [], shotSize: 'WS', duration: 3,
      ambientSound: detectAmbientSound('', scene.atmosphere),
    }));
  }

  return shots;
}
