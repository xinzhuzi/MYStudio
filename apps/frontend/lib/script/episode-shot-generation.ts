import type { Shot } from '@/types/script';

import { generateShotsFromSceneContent, type SceneShotSource } from './shot-content-parser';
import { createShot } from './shot-factory-service';

export async function generateShotsForEpisode(
  scenes: SceneShotSource[],
  episodeId: string,
  characters: Array<{ id: string; name: string }>,
  onProgress?: (message: string) => void,
): Promise<Shot[]> {
  const shots: Shot[] = [];
  let shotIndex = 1;

  for (let index = 0; index < scenes.length; index += 1) {
    const scene = scenes[index];
    onProgress?.(`处理场景 ${index + 1}/${scenes.length}: ${scene.name || scene.location}`);
    const sceneShots = generateShotsFromSceneContent(
      scene,
      episodeId,
      shotIndex,
      characters,
      createShot,
    );
    shots.push(...sceneShots);
    shotIndex += sceneShots.length;
  }

  return shots;
}
