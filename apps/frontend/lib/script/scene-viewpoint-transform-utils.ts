import type { PendingViewpointData } from '@/stores/media-panel-store';
import type { SceneViewpoint } from './scene-viewpoint-types';

/**
 * Enrich a viewpoint with its generated descriptions and convert it to the
 * pending-viewpoint shape used by the contact-sheet handoff.
 *
 * The viewpoint mutation and ordering are intentional: callers historically
 * observe the updated description/gridIndex on the original object.
 */
export function preparePendingViewpoint(
  viewpoint: SceneViewpoint,
  gridIndex: number,
  pageIndex: number,
  shotIdToIndex: ReadonlyMap<string, number>,
): PendingViewpointData {
  const propsZh = viewpoint.keyProps.length > 0 ? `，包含${viewpoint.keyProps.join('、')}` : '';
  const propsEn = viewpoint.keyPropsEn.length > 0 ? ` with ${viewpoint.keyPropsEn.join(', ')}` : '';
  viewpoint.description = `${viewpoint.name}视角${propsZh}`;
  viewpoint.descriptionEn = `${viewpoint.nameEn} angle${propsEn}`;
  viewpoint.gridIndex = gridIndex;

  const shotIndexes = viewpoint.shotIds
    .map(id => shotIdToIndex.get(id))
    .filter((index): index is number => index !== undefined)
    .sort((a, b) => a - b);

  return {
    id: viewpoint.id,
    name: viewpoint.name,
    nameEn: viewpoint.nameEn,
    shotIds: viewpoint.shotIds,
    shotIndexes,
    keyProps: viewpoint.keyProps,
    keyPropsEn: viewpoint.keyPropsEn,
    gridIndex: viewpoint.gridIndex,
    pageIndex,
  };
}
