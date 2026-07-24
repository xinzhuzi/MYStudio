import { describe, expect, it } from 'vitest';
import { selectContactSheetLayout } from './scene-viewpoint-layout-selection';

describe('selectContactSheetLayout', () => {
  it.each([0, 1, 4])('uses 2x2 for %s viewpoints', (viewpointCount) => {
    expect(selectContactSheetLayout(viewpointCount)).toEqual({
      gridLayout: { rows: 2, cols: 2 },
      viewpointsPerPage: 4,
    });
  });

  it.each([5, 9, 10])('uses 3x3 for %s viewpoints', (viewpointCount) => {
    expect(selectContactSheetLayout(viewpointCount)).toEqual({
      gridLayout: { rows: 3, cols: 3 },
      viewpointsPerPage: 9,
    });
  });
});
