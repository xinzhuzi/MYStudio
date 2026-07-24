import { describe, expect, it } from 'vitest';
import type { Shot } from '@/types/script';
import {
  extractAllViewpointsFromShots,
  extractViewpointsFromShots,
  matchShotToViewpoint,
  type ViewpointKeywordMap,
} from './scene-viewpoint-extraction';
import type { SceneViewpoint } from './scene-viewpoint-types';

const keywordMap = {
  案几: {
    id: 'table',
    name: '案几',
    nameEn: 'Table',
    propsZh: ['案几'],
    propsEn: ['table'],
    environments: [],
  },
  茶具: {
    id: 'table',
    name: '案几',
    nameEn: 'Table',
    propsZh: ['茶具'],
    propsEn: ['tea set'],
    environments: [],
  },
  屏风: {
    id: 'screen',
    name: '屏风',
    nameEn: 'Screen',
    propsZh: ['屏风'],
    propsEn: ['screen'],
    environments: [],
  },
  对话: {
    id: 'conversation',
    name: '对话区',
    nameEn: 'Conversation',
    propsZh: [],
    propsEn: [],
    environments: [],
  },
} satisfies ViewpointKeywordMap;

function shot(partial: Partial<Shot> & { id: string }): Shot {
  return partial as Shot;
}

function viewpoint(id: string, shotIds: string[]): SceneViewpoint {
  return {
    id,
    name: id,
    nameEn: id,
    shotIds,
    keyProps: [],
    keyPropsEn: [],
    description: '',
    descriptionEn: '',
    gridIndex: 0,
  };
}

describe('scene viewpoint extraction', () => {
  it('merges duplicate keyword ids, ranks by matched shot count, and resets grid indexes', () => {
    const result = extractViewpointsFromShots([
      shot({ id: 'shot-1', actionSummary: '人物坐在案几前，旁边有茶具' }),
      shot({ id: 'shot-2', actionSummary: '手放在案几上' }),
      shot({ id: 'shot-3', actionSummary: '人物经过屏风' }),
    ], 2, keywordMap);

    expect(result.map(({ id, gridIndex }) => [id, gridIndex])).toEqual([
      ['table', 0],
      ['screen', 1],
    ]);
    expect(result[0]).toMatchObject({
      shotIds: ['shot-1', 'shot-2'],
      keyProps: ['案几', '茶具'],
      keyPropsEn: ['table', 'tea set'],
    });
  });

  it('prefers explicit shot associations before falling back to keyword matching', () => {
    const viewpoints = [
      viewpoint('explicit', ['shot-1']),
      viewpoint('conversation', []),
      viewpoint('overview', []),
    ];

    expect(matchShotToViewpoint(
      shot({ id: 'shot-1', actionSummary: '人物对话' }),
      viewpoints,
      keywordMap,
    )).toBe('explicit');
    expect(matchShotToViewpoint(
      shot({ id: 'shot-2', actionSummary: '人物对话' }),
      viewpoints,
      keywordMap,
    )).toBe('conversation');
    expect(matchShotToViewpoint(
      shot({ id: 'shot-3', actionSummary: '人物沉默' }),
      viewpoints,
      keywordMap,
    )).toBe('overview');
  });

  it('matches all searchable shot fields and routes unrecognised shots to overview', () => {
    const result = extractAllViewpointsFromShots([
      shot({ id: 'dialogue-shot', dialogue: '我们在这里对话。' }),
      shot({ id: 'visual-shot', visualDescription: '镜头掠过屏风。' }),
      shot({ id: 'unmatched-shot', actionSummary: '人物停下脚步。' }),
    ], undefined, keywordMap);

    expect(result.find((item) => item.id === 'conversation')?.shotIds).toEqual(['dialogue-shot']);
    expect(result.find((item) => item.id === 'screen')?.shotIds).toEqual(['visual-shot']);
    expect(result.find((item) => item.id === 'overview')?.shotIds).toEqual(['unmatched-shot']);
    expect(result.map(({ gridIndex }) => gridIndex)).toEqual(result.map((_, index) => index));
  });
});
