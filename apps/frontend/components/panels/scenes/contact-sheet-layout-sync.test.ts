import { describe, expect, it } from 'vitest';

import { buildContactSheetLayoutSync } from './contact-sheet-layout-sync';

const viewpoint = {
  id: 'overview', name: '全景', nameEn: 'Overview', shotIds: [], shotIndexes: [],
  keyProps: ['木桌'], keyPropsEn: ['wooden table'], gridIndex: 0, pageIndex: 0,
};
const prompt = {
  pageIndex: 0,
  prompt: 'Scene Context: old town\nVisual Description: warm dawn',
  promptZh: '展示不同视角。\n建筑风格：明式，色彩基调：暖色\n场景氛围：晨雾',
  viewpointIds: ['overview'],
  gridLayout: { rows: 3, cols: 3 },
};

describe('contact sheet layout sync', () => {
  it('returns null without pending data', () => {
    expect(buildContactSheetLayoutSync({
      aspectRatio: '16:9', viewpoints: [], prompts: [], currentPageIndex: 0,
      hasCurrentPrompt: false, selectedScene: null, styleId: 'default',
    })).toBeNull();
  });

  it('rebuilds a square layout and preserves source scene descriptions', () => {
    const result = buildContactSheetLayoutSync({
      aspectRatio: '9:16', viewpoints: [viewpoint], prompts: [prompt], currentPageIndex: 0,
      hasCurrentPrompt: true, selectedScene: null, styleId: 'default',
    });
    expect(result?.layout).toBe('2x2');
    expect(result?.prompts[0].gridLayout).toEqual({ rows: 2, cols: 2 });
    expect(result?.prompt).toContain('9:16 (vertical portrait)');
    expect(result?.prompt).toContain('Scene Context: old town');
    expect(result?.prompt).toContain('empty placeholder');
    expect(result?.promptZh).toContain('建筑风格：明式，色彩基调：暖色');
    expect(result?.promptZh).toContain('场景氛围：晨雾');
  });

  it('uses the fallback prompt page index when the selected page is out of range', () => {
    const result = buildContactSheetLayoutSync({
      aspectRatio: '16:9', viewpoints: [viewpoint], prompts: [prompt], currentPageIndex: 99,
      hasCurrentPrompt: true, selectedScene: null, styleId: 'default',
    });
    expect(result?.prompt).toContain('showing wooden table');
    expect(result?.prompt).not.toContain('Panel [row 1, col 1]: empty placeholder');
  });
});
