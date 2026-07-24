import type { SceneViewpoint } from './scene-viewpoint-types';

export interface ViewpointSplitResult {
  id: number;
  dataUrl: string;
  row: number;
  col: number;
}

export interface ViewpointImageAssignment {
  imageUrl: string;
  gridIndex: number;
}

/**
 * Associate sliced contact-sheet tiles with their viewpoint grid positions.
 * This helper is deliberately pure apart from the returned Map allocation.
 */
export function assignViewpointImages(
  viewpoints: SceneViewpoint[],
  splitResults: ViewpointSplitResult[],
  gridLayout: { rows: number; cols: number },
): Map<string, ViewpointImageAssignment> {
  const result = new Map<string, ViewpointImageAssignment>();

  for (const viewpoint of viewpoints) {
    const gridIndex = viewpoint.gridIndex;
    const row = Math.floor(gridIndex / gridLayout.cols);
    const col = gridIndex % gridLayout.cols;
    const splitResult = splitResults.find((candidate) => candidate.row === row && candidate.col === col);

    if (splitResult) {
      result.set(viewpoint.id, {
        imageUrl: splitResult.dataUrl,
        gridIndex,
      });
    }
  }

  return result;
}

/**
 * Partition viewpoints into contact-sheet pages and preserve the existing
 * page-local grid-index mutation used by the renderer.
 */
export function groupViewpointsIntoPages(
  viewpoints: SceneViewpoint[],
  viewpointsPerPage: number = 6,
): SceneViewpoint[][] {
  const pages: SceneViewpoint[][] = [];

  for (let i = 0; i < viewpoints.length; i += viewpointsPerPage) {
    const page = viewpoints.slice(i, i + viewpointsPerPage);
    page.forEach((viewpoint, index) => {
      viewpoint.gridIndex = index;
    });
    pages.push(page);
  }

  return pages;
}
