// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.

import type { SceneViewpoint } from './scene-viewpoint-types';

export interface SingleContactSheetPromptInput {
  viewpoints: SceneViewpoint[];
  sceneName?: string;
  sceneLocation: string;
  styleTokens: string[];
  aspectRatio: '16:9' | '9:16';
  sceneDescEn: string;
  sceneDescZh: string;
  isAIAnalyzed: boolean;
}

export interface SingleContactSheetPromptResult {
  prompt: string;
  promptZh: string;
  gridLayout: {
    rows: number;
    cols: number;
  };
}

/** Build the legacy single-sheet prompt after viewpoint selection is complete. */
export function buildSingleContactSheetPrompt({
  viewpoints,
  sceneName,
  sceneLocation,
  styleTokens,
  aspectRatio,
  sceneDescEn,
  sceneDescZh,
  isAIAnalyzed,
}: SingleContactSheetPromptInput): SingleContactSheetPromptResult {
  const vpCount = viewpoints.length;
  const gridLayout = vpCount <= 4 ? { rows: 2, cols: 2 } : { rows: 3, cols: 3 };
  const styleStr = styleTokens.length > 0
    ? styleTokens.join(', ')
    : 'anime style, soft colors, detailed background';
  const totalCells = gridLayout.rows * gridLayout.cols;
  const promptParts: string[] = [];

  promptParts.push('<instruction>');
  promptParts.push(`Generate a clean ${gridLayout.rows}x${gridLayout.cols} storyboard grid with exactly ${totalCells} equal-sized panels.`);
  promptParts.push(`Overall Image Aspect Ratio: ${aspectRatio}.`);
  const panelAspect = aspectRatio === '16:9' ? '16:9 (horizontal landscape)' : '9:16 (vertical portrait)';
  promptParts.push(`Each individual panel must have a ${panelAspect} aspect ratio.`);
  if (styleStr) promptParts.push(`MANDATORY Visual Style for ALL panels: ${styleStr}`);
  promptParts.push('Structure: No borders between panels, no text, no watermarks, no speech bubbles.');
  promptParts.push('Consistency: Maintain consistent perspective, lighting, color grading, and visual style across ALL panels.');
  promptParts.push('Subject: Interior design and architectural details only, NO people.');
  promptParts.push('</instruction>');
  promptParts.push(`Layout: ${gridLayout.rows} rows, ${gridLayout.cols} columns, reading order left-to-right, top-to-bottom.`);

  if (sceneDescEn) promptParts.push(`Scene Context: ${sceneDescEn}`);

  const styleAnchor = styleStr ? ' [same style]' : '';
  viewpoints.forEach((viewpoint, index) => {
    const row = Math.floor(index / gridLayout.cols) + 1;
    const col = (index % gridLayout.cols) + 1;
    promptParts.push(`Panel [row ${row}, col ${col}] (no people): ${viewpoint.nameEn.toUpperCase()}: ${viewpoint.descriptionEn}${styleAnchor}`);
  });

  for (let index = viewpoints.length; index < totalCells; index += 1) {
    const row = Math.floor(index / gridLayout.cols) + 1;
    const col = (index % gridLayout.cols) + 1;
    promptParts.push(`Panel [row ${row}, col ${col}]: empty placeholder, solid gray background`);
  }

  if (styleStr) promptParts.push(`IMPORTANT - Apply this EXACT style uniformly to every panel: ${styleStr}`);
  promptParts.push('Negative constraints: text, watermark, split screen borders, speech bubbles, blur, distortion, bad anatomy, people, characters, distorted grid, uneven panels.');

  const gridItemsZh = viewpoints.map((viewpoint, index) =>
    `[${index + 1}] ${viewpoint.name}：${viewpoint.description || viewpoint.name + '视角'}`
  ).join('\n');
  const viewpointSource = isAIAnalyzed ? '（AI 分析）' : '（关键词提取）';
  const promptZh = `一张${gridLayout.rows}x${gridLayout.cols}网格联合图，展示同一个「${sceneName || sceneLocation}」场景的${viewpoints.length}个不同机位视角${viewpointSource}。
${sceneDescZh}

网格布局（从左到右，从上到下）：
${gridItemsZh}

风格：${styleTokens.length > 0 ? styleTokens.join('、') : '动画风格，柔和色彩，细节丰富'}，${viewpoints.length}个格子保持一致的透视和光照。每个格子用细白线分隔。只有背景，没有人物。`;

  return { prompt: promptParts.join('\n'), promptZh, gridLayout };
}
