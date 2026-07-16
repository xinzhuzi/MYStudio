import { getStyleById } from '@/lib/constants/visual-styles';
import type { Scene } from '@/stores/scene-store';
import type { ContactSheetPromptSet, PendingViewpointData } from '@/stores/media-panel-store';

import type { ContactSheetLayout } from './generation-panel-utils';

interface ContactSheetLayoutSyncInput {
  aspectRatio: '16:9' | '9:16';
  viewpoints: PendingViewpointData[];
  prompts: ContactSheetPromptSet[];
  currentPageIndex: number;
  hasCurrentPrompt: boolean;
  selectedScene: Scene | null;
  styleId: string;
}

export interface ContactSheetLayoutSyncResult {
  layout: ContactSheetLayout;
  prompts: ContactSheetPromptSet[];
  prompt: string | null;
  promptZh: string | null;
}

export function buildContactSheetLayoutSync(
  input: ContactSheetLayoutSyncInput,
): ContactSheetLayoutSyncResult | null {
  if (input.viewpoints.length === 0 || input.prompts.length === 0) return null;

  const dimensions = input.viewpoints.length <= 4
    ? { rows: 2, cols: 2 }
    : { rows: 3, cols: 3 };
  const layout = `${dimensions.rows}x${dimensions.cols}` as ContactSheetLayout;
  const prompts = input.prompts.map((prompt) => ({ ...prompt, gridLayout: dimensions }));
  const currentPage = prompts[input.currentPageIndex] || prompts[0];
  if (!currentPage || !input.hasCurrentPrompt) {
    return { layout, prompts, prompt: null, promptZh: null };
  }

  const isLandscape = input.aspectRatio === '16:9';
  const totalCells = dimensions.rows * dimensions.cols;
  const sceneName = input.selectedScene?.name || input.selectedScene?.location || 'scene';
  const stylePreset = getStyleById(input.styleId);
  const stylePrompt = stylePreset?.prompt || 'anime style, soft colors';
  const pageViewpoints = input.viewpoints.filter((viewpoint) => viewpoint.pageIndex === currentPage.pageIndex);
  const promptParts = [
    '<instruction>',
    `Generate a clean ${dimensions.rows}x${dimensions.cols} architectural concept grid with exactly ${totalCells} equal-sized panels.`,
    `Overall Image Aspect Ratio: ${input.aspectRatio}.`,
    `Each individual panel must have a ${isLandscape ? '16:9 (horizontal landscape)' : '9:16 (vertical portrait)'} aspect ratio.`,
    'Structure: No borders between panels, no text, no watermarks.',
    'Consistency: Maintain consistent perspective, lighting, and style across all panels.',
    'Subject: Interior design and architectural details only, NO people.',
    '</instruction>',
    `Layout: ${dimensions.rows} rows, ${dimensions.cols} columns, reading order left-to-right, top-to-bottom.`,
  ];

  const sceneContextMatch = currentPage.prompt.match(/Scene Context: ([^\n]+)/);
  if (sceneContextMatch?.[1]) promptParts.push(`Scene Context: ${sceneContextMatch[1]}`);
  const visualDescriptionMatch = currentPage.prompt.match(/Visual Description: ([^\n]+)/);
  if (visualDescriptionMatch?.[1]) promptParts.push(`Visual Description: ${visualDescriptionMatch[1]}`);

  pageViewpoints.forEach((viewpoint, index) => {
    const row = Math.floor(index / dimensions.cols) + 1;
    const col = (index % dimensions.cols) + 1;
    const content = viewpoint.keyPropsEn.length > 0
      ? `showing ${viewpoint.keyPropsEn.join(', ')}`
      : viewpoint.nameEn === 'Overview'
        ? 'wide shot showing the entire room layout'
        : `${viewpoint.nameEn || viewpoint.name} angle of the room`;
    promptParts.push(`Panel [row ${row}, col ${col}] (no people): ${content}`);
  });
  for (let index = pageViewpoints.length; index < totalCells; index += 1) {
    const row = Math.floor(index / dimensions.cols) + 1;
    const col = (index % dimensions.cols) + 1;
    promptParts.push(`Panel [row ${row}, col ${col}]: empty placeholder, solid gray background`);
  }
  promptParts.push(`Style: ${stylePrompt}`);
  promptParts.push('Negative constraints: text, watermark, split screen borders, speech bubbles, blur, distortion, bad anatomy, people, characters.');

  const gridItemsZh = pageViewpoints.map((viewpoint, index) => {
    const content = viewpoint.keyProps.length > 0
      ? `展示${viewpoint.keyProps.join('、')}`
      : viewpoint.name === '全景'
        ? '展示整个房间布局的宽角度全景'
        : `${viewpoint.name}视角`;
    return `[${index + 1}] ${viewpoint.name}：${content}`;
  }).join('\n');

  const sceneDescriptionMatch = currentPage.promptZh.match(/不同视角。\n([^\n]*(?:建筑风格|色彩基调|时代特征|光影设计)[^\n]*)/);
  const sceneDescription = sceneDescriptionMatch?.[1]?.trim() || [
    input.selectedScene?.architectureStyle && `建筑风格：${input.selectedScene.architectureStyle}`,
    input.selectedScene?.colorPalette && `色彩基调：${input.selectedScene.colorPalette}`,
    input.selectedScene?.eraDetails && `时代特征：${input.selectedScene.eraDetails}`,
    input.selectedScene?.lightingDesign && `光影设计：${input.selectedScene.lightingDesign}`,
  ].filter(Boolean).join('，');
  const visualPromptMatch = currentPage.promptZh.match(/场景氛围：([^\n]+)/);
  const visualPrompt = visualPromptMatch?.[1]?.trim() || input.selectedScene?.visualPrompt || '';
  const promptZh = `一张精确的 ${dimensions.rows}行${dimensions.cols}列 网格图（共 ${totalCells} 个格子），展示同一个「${sceneName}」场景的不同视角。
${sceneDescription}${visualPrompt ? `\n场景氛围：${visualPrompt}` : ''}

${totalCells} 个格子分别展示：
${gridItemsZh}

重要：
- 必须精确生成 ${dimensions.rows} 行 ${dimensions.cols} 列，不能多也不能少。
- 这是一张干净的参考图，图片上不要添加任何文字覆盖。
- 不要添加标签、标题、说明文字、水印或任何类型的文字。

风格：${stylePreset?.name || '动画风格'}，所有格子光照一致，格子之间用细白边框分隔，只有背景，没有人物。`;

  return { layout, prompts, prompt: promptParts.join('\n'), promptZh };
}
