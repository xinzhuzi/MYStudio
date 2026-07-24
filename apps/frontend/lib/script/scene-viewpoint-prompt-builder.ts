import type { SceneViewpoint } from './scene-viewpoint-types';

export interface ContactSheetPromptBuildInput {
  pageViewpoints: SceneViewpoint[];
  pageIndex: number;
  gridLayout: { rows: number; cols: number };
  aspectRatio: '16:9' | '9:16';
  styleStr: string;
  styleTokens: string[];
  sceneName?: string;
  sceneLocation: string;
  sceneDescEn: string;
  sceneDescZh: string;
}

export interface ContactSheetPromptBuildResult {
  pageIndex: number;
  prompt: string;
  promptZh: string;
  viewpointIds: string[];
  gridLayout: { rows: number; cols: number };
}

/** Pure, deterministic assembly for one multi-page contact-sheet prompt. */
export function buildMultiPageContactSheetPrompt(
  input: ContactSheetPromptBuildInput,
): ContactSheetPromptBuildResult {
  const { pageViewpoints, pageIndex, gridLayout, aspectRatio, styleStr, styleTokens, sceneName, sceneLocation, sceneDescEn, sceneDescZh } = input;
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
  pageViewpoints.forEach((vp, idx) => {
    const row = Math.floor(idx / gridLayout.cols) + 1;
    const col = (idx % gridLayout.cols) + 1;
    const content = vp.keyPropsEn.length > 0 ? `showing ${vp.keyPropsEn.join(', ')}` : (vp.nameEn === 'Overview' ? 'wide shot showing the entire room layout' : `${vp.nameEn} angle of the room`);
    promptParts.push(`Panel [row ${row}, col ${col}] (no people): ${content}${styleAnchor}`);
  });
  for (let i = pageViewpoints.length; i < totalCells; i++) {
    const row = Math.floor(i / gridLayout.cols) + 1;
    const col = (i % gridLayout.cols) + 1;
    promptParts.push(`Panel [row ${row}, col ${col}]: empty placeholder, solid gray background`);
  }
  if (styleStr) promptParts.push(`IMPORTANT - Apply this EXACT style uniformly to every panel: ${styleStr}`);
  promptParts.push('Negative constraints: text, watermark, split screen borders, speech bubbles, blur, distortion, bad anatomy, people, characters, distorted grid, uneven panels.');
  const gridItemsZh = pageViewpoints.map((vp, i) => `[${i + 1}] ${vp.name}：${vp.description}`).join('\n');
  const promptZh = `一张精确的 ${gridLayout.rows}行${gridLayout.cols}列 网格图（共 ${totalCells} 个格子），展示同一个「${sceneName || sceneLocation}」场景的不同视角。
${sceneDescZh}

${totalCells} 个格子分别展示：${gridItemsZh}。

重要：
- 必须精确生成 ${gridLayout.rows} 行 ${gridLayout.cols} 列，不能多也不能少。
- 这是一张干净的参考图，图片上不要添加任何文字覆盖。
- 不要添加标签、标题、说明文字、水印或任何类型的文字。

风格：${styleTokens.length > 0 ? styleTokens.join('、') : '动画风格，柔和色彩，细节丰富'}，所有格子光照一致，格子之间用细白边框分隔，只有背景，没有人物。`;
  return { pageIndex, prompt: promptParts.join('\n'), promptZh, viewpointIds: pageViewpoints.map(vp => vp.id), gridLayout };
}
