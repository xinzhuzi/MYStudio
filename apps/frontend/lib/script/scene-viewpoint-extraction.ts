// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.

import type { Shot } from '@/types/script';
import { getShotSearchableText } from './scene-shot-text';
import type { ViewpointConfig } from './scene-viewpoint-defaults';
import type { SceneViewpoint } from './scene-viewpoint-types';

export type ViewpointKeywordMap = Readonly<Record<string, ViewpointConfig>>;

type DefaultViewpoint = Pick<
  SceneViewpoint,
  'id' | 'name' | 'nameEn' | 'keyProps' | 'keyPropsEn' | 'description' | 'descriptionEn'
>;

const DEFAULT_VIEWPOINTS: DefaultViewpoint[] = [
  {
    id: 'overview',
    name: '全景',
    nameEn: 'Overview',
    keyProps: [],
    keyPropsEn: [],
    description: '整体空间布局',
    descriptionEn: 'Overall spatial layout',
  },
  {
    id: 'detail',
    name: '细节',
    nameEn: 'Detail View',
    keyProps: [],
    keyPropsEn: [],
    description: '装饰细节特写',
    descriptionEn: 'Decorative details close-up',
  },
];

function createDefaultViewpoints(): DefaultViewpoint[] {
  return DEFAULT_VIEWPOINTS.map((viewpoint) => ({
    ...viewpoint,
    keyProps: [...viewpoint.keyProps],
    keyPropsEn: [...viewpoint.keyPropsEn],
  }));
}

/** Extract the bounded set of viewpoints used by the legacy contact-sheet flow. */
export function extractViewpointsFromShots(
  shots: Shot[],
  maxViewpoints: number = 6,
  keywordMap: ViewpointKeywordMap,
): SceneViewpoint[] {
  const viewpointMap = new Map<string, SceneViewpoint>();

  for (const shot of shots) {
    const actionText = shot.actionSummary || '';

    for (const [keyword, config] of Object.entries(keywordMap)) {
      if (!actionText.includes(keyword)) continue;

      if (!viewpointMap.has(config.id)) {
        viewpointMap.set(config.id, {
          id: config.id,
          name: config.name,
          nameEn: config.nameEn,
          shotIds: [shot.id],
          keyProps: [...config.propsZh],
          keyPropsEn: [...config.propsEn],
          description: '',
          descriptionEn: '',
          gridIndex: viewpointMap.size,
        });
        continue;
      }

      const existing = viewpointMap.get(config.id)!;
      if (!existing.shotIds.includes(shot.id)) existing.shotIds.push(shot.id);
      for (const prop of config.propsZh) {
        if (!existing.keyProps.includes(prop)) existing.keyProps.push(prop);
      }
      for (const prop of config.propsEn) {
        if (!existing.keyPropsEn.includes(prop)) existing.keyPropsEn.push(prop);
      }
    }
  }

  const viewpoints = Array.from(viewpointMap.values())
    .sort((a, b) => b.shotIds.length - a.shotIds.length)
    .slice(0, maxViewpoints);

  viewpoints.forEach((viewpoint, index) => { viewpoint.gridIndex = index; });

  const defaults = createDefaultViewpoints();
  while (viewpoints.length < maxViewpoints && defaults.length > 0) {
    const viewpoint = defaults.shift()!;
    if (viewpoints.some((item) => item.id === viewpoint.id)) continue;
    viewpoints.push({ ...viewpoint, shotIds: [], gridIndex: viewpoints.length });
  }

  return viewpoints;
}

/** Match a shot to an existing viewpoint, preserving explicit associations first. */
export function matchShotToViewpoint(
  shot: Shot,
  viewpoints: SceneViewpoint[],
  keywordMap: ViewpointKeywordMap,
): string | null {
  for (const viewpoint of viewpoints) {
    if (viewpoint.shotIds.includes(shot.id)) return viewpoint.id;
  }

  const actionText = shot.actionSummary || '';
  for (const [keyword, config] of Object.entries(keywordMap)) {
    if (!actionText.includes(keyword)) continue;
    const matchedViewpoint = viewpoints.find((viewpoint) => viewpoint.id === config.id);
    if (matchedViewpoint) return matchedViewpoint.id;
  }

  const overview = viewpoints.find((viewpoint) => viewpoint.id === 'overview');
  return overview?.id || viewpoints[0]?.id || null;
}

/** Extract every matched viewpoint and route unrecognised shots to overview. */
export function extractAllViewpointsFromShots(
  shots: Shot[],
  _sceneLocation: string | undefined,
  keywordMap: ViewpointKeywordMap,
): SceneViewpoint[] {
  const viewpointMap = new Map<string, SceneViewpoint>();
  const matchedShotIds = new Set<string>();

  for (const shot of shots) {
    const searchText = getShotSearchableText(shot);
    let shotMatched = false;

    for (const [keyword, config] of Object.entries(keywordMap)) {
      if (!searchText.includes(keyword)) continue;
      shotMatched = true;

      if (!viewpointMap.has(config.id)) {
        viewpointMap.set(config.id, {
          id: config.id,
          name: config.name,
          nameEn: config.nameEn,
          shotIds: [shot.id],
          keyProps: [...config.propsZh],
          keyPropsEn: [...config.propsEn],
          description: '',
          descriptionEn: '',
          gridIndex: viewpointMap.size,
        });
        continue;
      }

      const existing = viewpointMap.get(config.id)!;
      if (!existing.shotIds.includes(shot.id)) existing.shotIds.push(shot.id);
      for (const prop of config.propsZh) {
        if (!existing.keyProps.includes(prop)) existing.keyProps.push(prop);
      }
      for (const prop of config.propsEn) {
        if (!existing.keyPropsEn.includes(prop)) existing.keyPropsEn.push(prop);
      }
    }

    if (shotMatched) matchedShotIds.add(shot.id);
  }

  const unmatchedShots = shots.filter((shot) => !matchedShotIds.has(shot.id));
  if (unmatchedShots.length > 0) {
    const overview = viewpointMap.get('overview');
    if (!overview) {
      const defaultOverview = createDefaultViewpoints()[0];
      viewpointMap.set('overview', {
        ...defaultOverview,
        shotIds: unmatchedShots.map((shot) => shot.id),
        gridIndex: viewpointMap.size,
      });
    } else {
      for (const shot of unmatchedShots) {
        if (!overview.shotIds.includes(shot.id)) overview.shotIds.push(shot.id);
      }
    }
  }

  const viewpoints = Array.from(viewpointMap.values())
    .sort((a, b) => b.shotIds.length - a.shotIds.length);
  const defaults = createDefaultViewpoints();
  defaults[1].description = '细节特写';

  while (viewpoints.length < 6 && defaults.length > 0) {
    const viewpoint = defaults.shift()!;
    if (viewpoints.some((item) => item.id === viewpoint.id)) continue;
    viewpoints.push({ ...viewpoint, shotIds: [], gridIndex: viewpoints.length });
  }

  viewpoints.forEach((viewpoint, index) => { viewpoint.gridIndex = index; });
  return viewpoints;
}
