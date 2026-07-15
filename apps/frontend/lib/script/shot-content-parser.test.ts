import { describe, expect, it } from 'vitest';

import { generateShotsFromSceneContent, type ShotFactoryParams } from './shot-content-parser';

const scene = (rawContent: string, atmosphere = '夜雨') => ({
  id: 'scene-1', name: '雨夜', location: '旧码头', time: '夜', atmosphere, rawContent,
  dialogues: [], actions: [],
});
const factory = (params: ShotFactoryParams) => params as never;

describe('generateShotsFromSceneContent', () => {
  it('parses dialogue, parenthetical, character ids, duration, and indexes', () => {
    const longDialogue = '很长'.repeat(20);
    const shots = generateShotsFromSceneContent(
      scene(`人物：甲\n甲：（低声）${longDialogue}`),
      'ep_2', 4, [{ id: 'char-1', name: '甲' }], factory,
    );
    expect(shots).toHaveLength(1);
    expect(shots[0]).toMatchObject({ index: 4, episodeId: 'ep_2', characterIds: ['char-1'], shotSize: 'MS' });
    expect(shots[0].dialogue).toContain('甲（低声）');
  });

  it('parses actions, subtitles, flashbacks, and ambient sound in source order', () => {
    const shots = generateShotsFromSceneContent(
      scene('△甲站在码头远望海面\n【字幕：三年后】\n【闪回：旧日】', '晴'),
      'ep_1', 1, [{ id: 'char-1', name: '甲' }], factory,
    );
    expect(shots.map((shot) => shot.index)).toEqual([1, 2, 3]);
    expect(shots[0]).toMatchObject({ characterIds: ['char-1'], shotSize: 'WS', ambientSound: '海浪声、海鸥声' });
    expect(shots[1].actionSummary).toBe('字幕显示');
    expect(shots[2]).toMatchObject({ actionSummary: '闪回：旧日', duration: 2 });
  });

  it('creates an establishing shot when no content produces a shot', () => {
    const shots = generateShotsFromSceneContent(scene('**场景说明**'), 'ep_1', 7, [], factory);
    expect(shots).toEqual([expect.objectContaining({
      index: 7, actionSummary: '雨夜 建立镜头', shotSize: 'WS', ambientSound: '雨声',
    })]);
  });
});
