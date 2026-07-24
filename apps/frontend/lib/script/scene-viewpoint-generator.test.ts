import { describe, expect, it } from 'vitest';
import {
  buildSceneDescriptions,
  extractAllViewpointsFromShots,
  extractViewpointsFromShots,
  generateContactSheetPrompt,
  matchShotToViewpoint,
} from './scene-viewpoint-generator';
import { buildMultiPageContactSheetPrompt } from './scene-viewpoint-prompt-builder';
import { preparePendingViewpoint } from './scene-viewpoint-transform-utils';

describe('buildSceneDescriptions', () => {
  it('keeps bilingual fields in the prompt contract order', () => {
    expect(buildSceneDescriptions({
      architectureStyle: '中式古典',
      colorPalette: '暖色调',
      eraDetails: '明清时期',
      lightingDesign: '自然光',
    })).toEqual({
      sceneDescEn: 'Architecture: 中式古典. Color palette: 暖色调. Era: 明清时期. Lighting: 自然光',
      sceneDescZh: '建筑风格：中式古典，色彩基调：暖色调，时代特征：明清时期，光影设计：自然光',
    });
  });

  it('omits empty optional fields without adding separators', () => {
    expect(buildSceneDescriptions({
      architectureStyle: '工业风',
      colorPalette: '',
      eraDetails: undefined,
      lightingDesign: '冷光',
    })).toEqual({
      sceneDescEn: 'Architecture: 工业风. Lighting: 冷光',
      sceneDescZh: '建筑风格：工业风，光影设计：冷光',
    });
  });
});

describe('buildMultiPageContactSheetPrompt', () => {
  it('keeps deterministic panel ordering and placeholder semantics', () => {
    const result = buildMultiPageContactSheetPrompt({
      pageViewpoints: [{
        id: 'overview', name: '全景', nameEn: 'Overview', shotIds: [],
        keyProps: [], keyPropsEn: [], description: '整体空间布局', descriptionEn: 'Overall spatial layout', gridIndex: 0,
      }],
      pageIndex: 2, gridLayout: { rows: 2, cols: 2 }, aspectRatio: '16:9',
      styleStr: 'ink wash', styleTokens: ['水墨'], sceneName: '客栈', sceneLocation: '街边',
      sceneDescEn: 'Architecture: timber', sceneDescZh: '建筑风格：木构',
    });
    expect(result.pageIndex).toBe(2);
    expect(result.viewpointIds).toEqual(['overview']);
    expect(result.prompt).toContain('Panel [row 1, col 1] (no people): wide shot showing the entire room layout [same style]');
    expect(result.prompt).toContain('Panel [row 1, col 2]: empty placeholder, solid gray background');
    expect(result.promptZh).toContain('展示同一个「客栈」场景');
  });
});

describe('preparePendingViewpoint', () => {
  it('preserves viewpoint mutation while sorting only resolved shot indexes', () => {
    const viewpoint = {
      id: 'table', name: '案几', nameEn: 'Ancient Table', shotIds: ['b', 'missing', 'a'],
      keyProps: ['案几'], keyPropsEn: ['table'], description: '', descriptionEn: '', gridIndex: 9,
    };
    const pending = preparePendingViewpoint(viewpoint, 2, 1, new Map([['a', 8], ['b', 3]]));

    expect(pending).toMatchObject({ id: 'table', shotIndexes: [3, 8], gridIndex: 2, pageIndex: 1 });
    expect(viewpoint).toMatchObject({ description: '案几视角，包含案几', descriptionEn: 'Ancient Table angle with table', gridIndex: 2 });
  });
});

describe('viewpoint extraction compatibility', () => {
  it('merges keyword matches into one viewpoint and preserves ranked props', () => {
    const viewpoints = extractViewpointsFromShots([
      { id: 'shot-1', actionSummary: '人物坐在案几前' } as never,
      { id: 'shot-2', actionSummary: '人物提笔写字，案几上有茶具' } as never,
    ], 1);

    expect(viewpoints).toHaveLength(1);
    expect(viewpoints[0]).toMatchObject({
      id: 'ancient_table',
      shotIds: ['shot-1', 'shot-2'],
      keyProps: expect.arrayContaining(['案几', '茶具', '笔墨']),
      gridIndex: 0,
    });
  });

  it('routes unmatched searchable shot content to the overview viewpoint', () => {
    const viewpoints = extractAllViewpointsFromShots([
      { id: 'matched', actionSummary: '人物望向窗外' } as never,
      { id: 'unmatched', actionSummary: '人物沉默', dialogue: '我不知道' } as never,
    ]);

    expect(viewpoints.find((viewpoint) => viewpoint.id === 'overview')?.shotIds).toContain('unmatched');
    expect(viewpoints.find((viewpoint) => viewpoint.id === 'looking')?.shotIds).toContain('matched');
  });

  it('keeps the legacy descriptions for each extraction entry point', () => {
    expect(extractViewpointsFromShots([], 2)[1].description).toBe('装饰细节特写');
    expect(extractAllViewpointsFromShots([], undefined)[1].description).toBe('细节特写');
  });

  it('prefers an explicit shot association before keyword fallback', () => {
    const viewpoints = [
      {
        id: 'explicit', name: '显式', nameEn: 'Explicit', shotIds: ['shot-1'],
        keyProps: [], keyPropsEn: [], description: '', descriptionEn: '', gridIndex: 0,
      },
      {
        id: 'conversation', name: '对话区', nameEn: 'Conversation Area', shotIds: [],
        keyProps: [], keyPropsEn: [], description: '', descriptionEn: '', gridIndex: 1,
      },
    ];

    expect(matchShotToViewpoint({ id: 'shot-1', actionSummary: '人物交谈' } as never, viewpoints)).toBe('explicit');
    expect(matchShotToViewpoint({ id: 'shot-2', actionSummary: '人物交谈' } as never, viewpoints)).toBe('conversation');
  });
});

describe('generateContactSheetPrompt compatibility', () => {
  it('preserves the single-sheet grid, style anchors, and fallback source label', () => {
    const result = generateContactSheetPrompt({
      scene: { name: '客栈', location: '街边' } as never,
      shots: [{ id: 'shot-1', actionSummary: '人物望向窗外' } as never],
      styleTokens: ['ink wash'],
      aspectRatio: '16:9',
      maxViewpoints: 2,
    });

    expect(result.gridLayout).toEqual({ rows: 2, cols: 2 });
    expect(result.prompt).toContain('Generate a clean 2x2 storyboard grid');
    expect(result.prompt).toContain('MANDATORY Visual Style for ALL panels: ink wash');
    expect(result.prompt).toContain('Panel [row 1, col 2] (no people): LOOKING VIEW: Looking View angle [same style]');
    expect(result.prompt).toContain('Panel [row 2, col 1]: empty placeholder, solid gray background');
    expect(result.promptZh).toContain('「客栈」场景');
    expect(result.promptZh).toContain('关键词提取');
  });
});
