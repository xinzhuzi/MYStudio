import { describe, expect, it, vi } from 'vitest';

import type { SceneShotSource } from './shot-content-parser';
import { generateShotsForEpisode } from './episode-shot-generation';

function source(id: string, name: string, rawContent: string): SceneShotSource {
  return {
    id,
    name,
    location: name,
    time: '日',
    atmosphere: '安静',
    rawContent,
    dialogues: [],
    actions: [],
  };
}

describe('episode shot generation', () => {
  it('keeps scene order, continuous shot indexes, and progress messages', async () => {
    const onProgress = vi.fn();
    const shots = await generateShotsForEpisode([
      source('scene-1', '桥头', '△ 甲走向桥头'),
      source('scene-2', '河岸', '△ 甲停下\n△ 甲回头'),
    ], 'episode-1', [{ id: 'character-1', name: '甲' }], onProgress);

    expect(shots.map((shot) => [shot.index, shot.sceneRefId])).toEqual([
      [1, 'scene-1'],
      [2, 'scene-2'],
      [3, 'scene-2'],
    ]);
    expect(onProgress.mock.calls.map(([message]) => message)).toEqual([
      '处理场景 1/2: 桥头',
      '处理场景 2/2: 河岸',
    ]);
  });

  it('returns no shots and emits no progress for an empty episode', async () => {
    const onProgress = vi.fn();
    await expect(generateShotsForEpisode([], 'episode-1', [], onProgress)).resolves.toEqual([]);
    expect(onProgress).not.toHaveBeenCalled();
  });
});
