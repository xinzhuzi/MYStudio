import { describe, expect, it } from 'vitest';
import type { SceneViewpoint } from './scene-viewpoint-types';
import { assignViewpointImages, groupViewpointsIntoPages } from './scene-viewpoint-layout-utils';

function viewpoint(id: string, gridIndex: number): SceneViewpoint {
  return {
    id,
    name: id,
    nameEn: id,
    shotIds: [],
    keyProps: [],
    keyPropsEn: [],
    description: '',
    descriptionEn: '',
    gridIndex,
  };
}

describe('scene viewpoint layout helpers', () => {
  it('maps sliced tiles by row and column while preserving the viewpoint grid index', () => {
    const result = assignViewpointImages(
      [viewpoint('overview', 0), viewpoint('detail', 3)],
      [
        { id: 1, dataUrl: 'data:overview', row: 0, col: 0 },
        { id: 2, dataUrl: 'data:detail', row: 1, col: 1 },
      ],
      { rows: 2, cols: 2 },
    );

    expect([...result.entries()]).toEqual([
      ['overview', { imageUrl: 'data:overview', gridIndex: 0 }],
      ['detail', { imageUrl: 'data:detail', gridIndex: 3 }],
    ]);
  });

  it('omits viewpoints with no matching tile', () => {
    const result = assignViewpointImages(
      [viewpoint('overview', 0), viewpoint('detail', 1)],
      [{ id: 1, dataUrl: 'data:overview', row: 0, col: 0 }],
      { rows: 1, cols: 2 },
    );

    expect(result.has('overview')).toBe(true);
    expect(result.has('detail')).toBe(false);
  });

  it('pages viewpoints and resets each page grid index', () => {
    const viewpoints = [viewpoint('a', 8), viewpoint('b', 8), viewpoint('c', 8)];
    const pages = groupViewpointsIntoPages(viewpoints, 2);

    expect(pages.map((page) => page.map(({ id, gridIndex }) => [id, gridIndex]))).toEqual([
      [['a', 0], ['b', 1]],
      [['c', 0]],
    ]);
  });
});
