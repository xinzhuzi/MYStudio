// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
/**
 * Scene Viewpoint Generator
 * 
 * 从场景校准数据和分镜动作描写中提取视角需求，
 * 生成多视角联合图提示词，用于生成 6 格联合图。
 */

import type { ScriptScene, SceneViewpointData, Shot } from '@/types/script';
import {
  detectEnvironmentType as detectEnvironment,
  type EnvironmentKeywords,
  type SceneEnvironmentType,
} from './scene-environment';
import {
  extractAllViewpointsFromShots as extractAllViewpointsFromShotsImpl,
  extractViewpointsFromShots as extractViewpointsFromShotsImpl,
  matchShotToViewpoint as matchShotToViewpointImpl,
} from './scene-viewpoint-extraction';
import { VIEWPOINT_KEYWORDS } from './scene-viewpoint-keywords';
import {
  getDefaultViewpointsForEnvironment,
  isViewpointCompatibleWithEnvironment,
} from './scene-viewpoint-defaults';
import {
  assignViewpointImages as assignViewpointImagesImpl,
  groupViewpointsIntoPages as groupViewpointsIntoPagesImpl,
  type ViewpointImageAssignment,
  type ViewpointSplitResult,
} from './scene-viewpoint-layout-utils';
import { selectContactSheetLayout } from './scene-viewpoint-layout-selection';
import { buildMultiPageContactSheetPrompt } from './scene-viewpoint-prompt-builder';
import { buildSingleContactSheetPrompt } from './scene-viewpoint-single-prompt-builder';
import { preparePendingViewpoint } from './scene-viewpoint-transform-utils';
import { buildSceneDescriptions } from './scene-viewpoint-descriptions';
import type { SceneViewpoint } from './scene-viewpoint-types';
export type { SceneViewpoint } from './scene-viewpoint-types';
export type { SceneEnvironmentType } from './scene-environment';
export { buildSceneDescriptions } from './scene-viewpoint-descriptions';
export {
  getDefaultViewpointsForEnvironment,
  isViewpointCompatibleWithEnvironment,
} from './scene-viewpoint-defaults';
export type { ViewpointConfig } from './scene-viewpoint-defaults';

type SceneViewpointSource = SceneViewpointData & Partial<Pick<
  SceneViewpoint,
  'nameEn' | 'keyPropsEn' | 'description' | 'descriptionEn'
>>;

// ==================== 类型定义 ====================

/**
 * 联合图生成配置
 */
export interface ContactSheetConfig {
  scene: ScriptScene;
  shots: Shot[];
  styleTokens: string[];
  aspectRatio: '16:9' | '9:16';
  maxViewpoints?: number; // 默认 6
}

/**
 * 联合图生成结果
 */
export interface ContactSheetPromptResult {
  prompt: string;           // 英文提示词
  promptZh: string;         // 中文提示词
  viewpoints: SceneViewpoint[];
  gridLayout: {
    rows: number;
    cols: number;
  };
}

// ==================== 环境类型定义 ====================

/**
 * 场景环境类型
 */
// SceneEnvironmentType is re-exported above for backwards compatibility.

/**
 * 环境类型关键词检测
 * 用于从场景地点推断环境类型
 */
const ENVIRONMENT_KEYWORDS: Record<SceneEnvironmentType, string[]> = {
  // === 古代场景（优先检测） ===
  ancient_indoor: [
    // 宫廷/皇家
    '宫殿', '宫', '殿', '皇宫', '宫门', '内廷', '御书房', '御花园', '太和殿', '乾清宫',
    '坐厉宫', '冷宫', '东宫', '西宫', '后宫',
    // 府邸/民居
    '府邸', '府', '宅', '宅院', '大宅', '老宅', '内宅', '外宅',
    '堂屋', '正堂', '大堂', '厅堂', '厅',
    '闺房', '内室', '绣楼', '书馆', '花厅',
    // 公共建筑
    '客栈', '酒楼', '酒肃', '茶楼', '茶馆', '饭庄', '庙', '寺', '寺庙', '禅房',
    '道观', '尼姑庵', '龙门客栈', '悦来客栈',
    '祁堂', '调堆', '灵堂', '宗祠',
    '衙门', '公堂', '大理寺',
    // 古代具体房间
    '书房', '琴房', '内堂', '账房', '茶房', '库房',
  ],
  ancient_outdoor: [
    // 城市
    '城门', '城墙', '城楼', '城外', '城内', '皇城',
    '集市', '集', '市集', '庙会', '夜市', '东市', '西市',
    '街', '长街', '巷', '巷子', '巷口',
    '牌坊', '广场', '点将台', '校场',
    // 道路/旅途
    '官道', '驿站', '驿道', '山路', '山道', '古道', '商道', '街道',
    '模到', '南道', '北道',
    // 自然/庭院
    '庭院', '庭', '院', '前院', '后院', '内院', '外院',
    '花园', '后花园', '御花园', '池塘', '荷塘', '亝子',
    '山野', '林间', '溓畔', '桥头', '渡口', '码头',
  ],
  ancient_vehicle: [
    '马车', '车', '轿子', '轿', '牛车', '马', '骑马',
    '船', '客船', '商船', '渔船', '画舷', '小船', '帆船', '舜',
    '车内', '轿内', '舱内', '船舱',
  ],
  
  // === 现代场景 ===
  vehicle: [
    '大巴', '巴士', '公交', '汽车', '轿车', '出租车', '的士', 'uber',
    '火车', '高铁', '动车', '地铁', '列车',
    '飞机', '航班', '机舱',
    '游艇', '渡轮', '轮船', '游轮',
    '车内', '车上', '车厢',
  ],
  outdoor: [
    '公路', '马路', '街道', '街头', '路边', '十字路口',
    '公园', '广场', '操场', '球场',
    '乡村', '田野', '山', '河', '海边', '沙滩', '森林', '树林',
    '院子', '庭院', '花园', '天台', '楼顶', '屋顶',
    '停车场', '加油站',
  ],
  indoor_home: [
    '家', '住宅', '公寓', '别墅', '宿舍',
    '客厅', '卧室', '厨房', '餐厅', '书房', '卫生间', '浴室', '阳台',
    '房间', '屋内', '屋里',
  ],
  indoor_work: [
    '办公室', '公司', '写字楼', '会议室', '工厂', '车间', '仓库',
    '店', '商店', '超市', '商场',
  ],
  indoor_public: [
    '医院', '诊所', '病房', '手术室',
    '学校', '教室', '图书馆', '食堂',
    '餐厅', '酒店', '宾馆', '旅馆', '咖啡厅', '酒吧', 'KTV',
    '派出所', '警局', '法院', '监狱',
    '银行', '邮局', '机场', '车站', '码头',
  ],
  unknown: [],
};

/**
 * 清理场景地点字符串，移除人物信息等无关内容
 */
/**
 * 从场景地点推断环境类型
 */
export function detectEnvironmentType(location: string): SceneEnvironmentType {
  return detectEnvironment(location, ENVIRONMENT_KEYWORDS as EnvironmentKeywords);
}


// ==================== 核心函数 ====================

/**
 * 从分镜动作描写中提取视角需求
 */
export function extractViewpointsFromShots(
  shots: Shot[],
  maxViewpoints: number = 6
): SceneViewpoint[] {
  return extractViewpointsFromShotsImpl(shots, maxViewpoints, VIEWPOINT_KEYWORDS);
}

/**
 * 生成联合图提示词
 * 优先使用 AI 分析的视角，如果没有则回退到关键词提取
 */
export function generateContactSheetPrompt(config: ContactSheetConfig): ContactSheetPromptResult {
  const { scene, shots, styleTokens, aspectRatio, maxViewpoints = 6 } = config;
  
  // 优先使用 AI 分析的视角（来自 scene.viewpoints）
  let viewpoints: SceneViewpoint[];
  let isAIAnalyzed = false;
  
  if (scene.viewpoints && scene.viewpoints.length > 0) {
    // 使用 AI 分析的视角
    console.log(`[generateContactSheetPrompt] 使用 AI 分析视角: ${scene.viewpoints.length} 个`);
    const sourceViewpoints: SceneViewpointSource[] = scene.viewpoints;
    viewpoints = sourceViewpoints.slice(0, maxViewpoints).map((v, idx) => ({
      id: v.id || `viewpoint_${idx}`,
      name: v.name || '未命名视角',
      nameEn: v.nameEn || 'Unnamed Viewpoint',
      shotIds: v.shotIds || [],
      keyProps: v.keyProps || [],
      keyPropsEn: v.keyPropsEn || [],
      description: v.description || '',
      descriptionEn: v.descriptionEn || '',
      gridIndex: idx,
    }));
    isAIAnalyzed = true;
  } else {
    // 回退到关键词提取
    console.log('[generateContactSheetPrompt] 没有 AI 视角，回退到关键词提取');
    viewpoints = extractViewpointsFromShots(shots, maxViewpoints);
  }
  
  // 构建场景基础描述
  const { sceneDescEn, sceneDescZh } = buildSceneDescriptions(scene);
  
  // 为每个视角生成描述
  viewpoints.forEach((vp, index) => {
    const propsZh = vp.keyProps.length > 0 ? `，包含${vp.keyProps.join('、')}` : '';
    const propsEn = vp.keyPropsEn.length > 0 ? ` with ${vp.keyPropsEn.join(', ')}` : '';
    
    vp.description = `${vp.name}视角${propsZh}`;
    vp.descriptionEn = `${vp.nameEn} angle${propsEn}`;
  });
  const { prompt, promptZh, gridLayout } = buildSingleContactSheetPrompt({
    viewpoints,
    sceneName: scene.name,
    sceneLocation: scene.location,
    styleTokens,
    aspectRatio,
    sceneDescEn,
    sceneDescZh,
    isAIAnalyzed,
  });

  return {
    prompt,
    promptZh,
    viewpoints,
    gridLayout,
  };
}

/**
 * 根据切割结果关联视角
 * 将切割后的图片分配给对应的视角
 */
export function assignViewpointImages(
  viewpoints: SceneViewpoint[],
  splitResults: ViewpointSplitResult[],
  gridLayout: { rows: number; cols: number }
): Map<string, ViewpointImageAssignment> {
  return assignViewpointImagesImpl(viewpoints, splitResults, gridLayout);
}

/**
 * 根据分镜动作自动匹配最佳视角
 */
export function matchShotToViewpoint(
  shot: Shot,
  viewpoints: SceneViewpoint[]
): string | null {
  return matchShotToViewpointImpl(shot, viewpoints, VIEWPOINT_KEYWORDS);
}

// ==================== 动态视角和分页支持 ====================

import type { 
  PendingViewpointData, 
  ContactSheetPromptSet 
} from '@/stores/navigation/media-panel-store';

/**
* 提取视角（不限数量）
 * 返回所有识别到的视角，不再限制为6个
 * 
 * 视角是从分镜内容中提取的，不做环境过滤
 * 
 * @param shots 分镜列表
 * @param sceneLocation 场景地点（仅用于补充默认视角）
 */
export function extractAllViewpointsFromShots(
  shots: Shot[],
  sceneLocation?: string
): SceneViewpoint[] {
  return extractAllViewpointsFromShotsImpl(shots, sceneLocation, VIEWPOINT_KEYWORDS);
}

/**
 * 将视角分组为联合图页
 * 每页最多 6 个视角
 */
export function groupViewpointsIntoPages(
  viewpoints: SceneViewpoint[],
  viewpointsPerPage: number = 6
): SceneViewpoint[][] {
  return groupViewpointsIntoPagesImpl(viewpoints, viewpointsPerPage);
}

/**
 * 生成联合图的提示词
 * 返回 PendingViewpointData 和 ContactSheetPromptSet 用于传递给场景库
 * 
 * 布局选择逻辑：
 * - 视角 ≤ 6：使用 2x3 或 3x2（1 张图）
 * - 视角 7-9：使用 3x3（1 张图）
 * - 视角 > 9：分多张图
 */
export function generateMultiPageContactSheetData(
  config: ContactSheetConfig,
  shots: Shot[] // 用于获取分镜序号
): {
  viewpoints: PendingViewpointData[];
  contactSheetPrompts: ContactSheetPromptSet[];
} {
  const { scene, styleTokens, aspectRatio } = config;
  
  // 提取所有视角（传入场景地点进行环境过滤）
  const sceneLocation = scene.location || scene.name || '';
  const allViewpoints = extractAllViewpointsFromShots(config.shots, sceneLocation);
  
  // 根据视角数量和宽高比自动选择最优布局
  // 强制使用 NxN 布局 (2x2 或 3x3) 以保证宽高比一致性，与 Director 面板保持一致
  const vpCount = allViewpoints.length;
  const { gridLayout, viewpointsPerPage } = selectContactSheetLayout(vpCount);
  
  console.log('[ContactSheet] 布局选择:', { vpCount, aspectRatio, gridLayout, viewpointsPerPage });
  
  // 分页
  const pages = groupViewpointsIntoPages(allViewpoints, viewpointsPerPage);
  
  // 构建场景基础描述
  const { sceneDescEn, sceneDescZh } = buildSceneDescriptions(scene);
  
  const styleStr = styleTokens.length > 0 
    ? styleTokens.join(', ') 
    : 'anime style, soft colors, detailed background';
  
  // 构建分镜 ID 到序号的映射
  const shotIdToIndex = new Map<string, number>();
  shots.forEach(shot => {
    shotIdToIndex.set(shot.id, shot.index);
  });
  
  // 生成 PendingViewpointData
  const pendingViewpoints: PendingViewpointData[] = [];
  
  pages.forEach((pageViewpoints, pageIndex) => {
    pageViewpoints.forEach((vp, idx) => {
      pendingViewpoints.push(preparePendingViewpoint(vp, idx, pageIndex, shotIdToIndex));
    });
  });
  
  // 生成每页的 ContactSheetPromptSet
  const contactSheetPrompts: ContactSheetPromptSet[] = pages.map((pageViewpoints, pageIndex) => {
    return buildMultiPageContactSheetPrompt({
      pageViewpoints,
      pageIndex,
      gridLayout,
      aspectRatio,
      styleStr,
      styleTokens,
      sceneName: scene.name,
      sceneLocation: scene.location,
      sceneDescEn,
      sceneDescZh,
    });
    /*
    const totalCells = gridLayout.rows * gridLayout.cols;
    const paddedCount = totalCells;
    const actualCount = pageViewpoints.length;
    
    // 构建增强版提示词 — 对齐导演面板 generateGridAndSlice 的三层风格夹击结构
    const promptParts: string[] = [];
    
    // 1. 核心指令区 (Instruction Block) — 使用与导演面板一致的 storyboard grid 术语
    promptParts.push('<instruction>');
    promptParts.push(`Generate a clean ${gridLayout.rows}x${gridLayout.cols} storyboard grid with exactly ${paddedCount} equal-sized panels.`);
    promptParts.push(`Overall Image Aspect Ratio: ${aspectRatio}.`);
    
    // 明确指定单个格子的宽高比，防止 AI 混淆
    const panelAspect = aspectRatio === '16:9' ? '16:9 (horizontal landscape)' : '9:16 (vertical portrait)';
    promptParts.push(`Each individual panel must have a ${panelAspect} aspect ratio.`);
    
    // 全局视觉风格（前置到指令区，权重最高 — 三层夹击第一层）
    if (styleStr) {
      promptParts.push(`MANDATORY Visual Style for ALL panels: ${styleStr}`);
    }
    
    promptParts.push('Structure: No borders between panels, no text, no watermarks, no speech bubbles.');
    promptParts.push('Consistency: Maintain consistent perspective, lighting, color grading, and visual style across ALL panels.');
    promptParts.push('Subject: Interior design and architectural details only, NO people.');
    promptParts.push('</instruction>');
    
    // 2. 布局描述
    promptParts.push(`Layout: ${gridLayout.rows} rows, ${gridLayout.cols} columns, reading order left-to-right, top-to-bottom.`);
    
    // 3. 场景信息
    if (sceneDescEn) {
      promptParts.push(`Scene Context: ${sceneDescEn}`);
    }
    
    // 4. 每个格子的内容描述 — 每格附带 [same style] 锚定（三层夹击第二层）
    const styleAnchor = styleStr ? ' [same style]' : '';
    pageViewpoints.forEach((vp, idx) => {
      const row = Math.floor(idx / gridLayout.cols) + 1;
      const col = (idx % gridLayout.cols) + 1;
      
      const content = vp.keyPropsEn.length > 0 
        ? `showing ${vp.keyPropsEn.join(', ')}` 
        : (vp.nameEn === 'Overview' ? 'wide shot showing the entire room layout' : `${vp.nameEn} angle of the room`);
      
      promptParts.push(`Panel [row ${row}, col ${col}] (no people): ${content}${styleAnchor}`);
    });
    
    // 5. 空白占位格描述
    for (let i = actualCount; i < paddedCount; i++) {
      const row = Math.floor(i / gridLayout.cols) + 1;
      const col = (i % gridLayout.cols) + 1;
      promptParts.push(`Panel [row ${row}, col ${col}]: empty placeholder, solid gray background`);
    }
    
    // 6. 全局风格尾部再次强调（三层夹击第三层）
    if (styleStr) {
      promptParts.push(`IMPORTANT - Apply this EXACT style uniformly to every panel: ${styleStr}`);
    }
    
    // 7. 负面提示词
    promptParts.push('Negative constraints: text, watermark, split screen borders, speech bubbles, blur, distortion, bad anatomy, people, characters, distorted grid, uneven panels.');
    
    const prompt = promptParts.join('\n');

    // 中文提示词
    const gridItemsZh = pageViewpoints.map((vp, i) => 
      `[${i + 1}] ${vp.name}：${vp.description}`
    ).join('\n');
    
    const promptZh = `一张精确的 ${gridLayout.rows}行${gridLayout.cols}列 网格图（共 ${totalCells} 个格子），展示同一个「${scene.name || scene.location}」场景的不同视角。
${sceneDescZh}

${totalCells} 个格子分别展示：${gridItemsZh}。

重要：
- 必须精确生成 ${gridLayout.rows} 行 ${gridLayout.cols} 列，不能多也不能少。
- 这是一张干净的参考图，图片上不要添加任何文字覆盖。
- 不要添加标签、标题、说明文字、水印或任何类型的文字。

风格：${styleTokens.length > 0 ? styleTokens.join('、') : '动画风格，柔和色彩，细节丰富'}，所有格子光照一致，格子之间用细白边框分隔，只有背景，没有人物。`;
    
    return {
      pageIndex,
      prompt,
      promptZh,
      viewpointIds: pageViewpoints.map(vp => vp.id),
      gridLayout,
    }; */
  });
  
  return {
    viewpoints: pendingViewpoints,
    contactSheetPrompts,
  };
}

/**
 * 从已有的 viewpoints 数据构建联合图数据
 * 用于从剧本面板跳转到场景库时，直接使用 AI 分析的视角
 * 
 * @param viewpoints - 来自 ScriptScene.viewpoints 的视角数据
 * @param scene - 场景信息（用于生成提示词）
 * @param shots - 分镜列表（用于获取分镜序号）
 * @param styleTokens - 风格标记
 * @param aspectRatio - 宽高比
 */
export function buildContactSheetDataFromViewpoints(
  viewpoints: Array<{
    id: string;
    name: string;
    nameEn?: string;
    shotIds: string[];
    keyProps: string[];
    gridIndex: number;
  }>,
  scene: Pick<ScriptScene, 'name' | 'location' | 'architectureStyle' | 'lightingDesign' | 'colorPalette' | 'eraDetails' | 'visualPrompt' | 'visualPromptEn'>,
  shots: Shot[],
  styleTokens: string[],
  aspectRatio: '16:9' | '9:16' = '16:9'
): {
  viewpoints: PendingViewpointData[];
  contactSheetPrompts: ContactSheetPromptSet[];
} {
  // 根据视角数量选择布局
  const vpCount = viewpoints.length;
  const { gridLayout, viewpointsPerPage } = selectContactSheetLayout(vpCount);
  
  console.log('[buildContactSheetDataFromViewpoints] 使用 AI 视角构建联合图数据:', {
    vpCount,
    gridLayout,
    viewpointsPerPage,
    // 调试：场景美术设计字段
    sceneFields: {
      name: scene.name,
      location: scene.location,
      architectureStyle: scene.architectureStyle,
      lightingDesign: scene.lightingDesign,
      colorPalette: scene.colorPalette,
      eraDetails: scene.eraDetails,
    },
  });
  
  // 分页
  const pages: typeof viewpoints[] = [];
  for (let i = 0; i < viewpoints.length; i += viewpointsPerPage) {
    const page = viewpoints.slice(i, i + viewpointsPerPage);
    // 重新分配页内 gridIndex (0-based)
    page.forEach((v, idx) => { v.gridIndex = idx; });
    pages.push(page);
  }
  
  // 构建场景描述（美术设计字段）
  const { sceneDescEn, sceneDescZh } = buildSceneDescriptions(scene);
  
  // 视觉提示词（AI 场景校准生成的详细场景描述）
  const visualPromptZh = scene.visualPrompt || '';
  const visualPromptEn = scene.visualPromptEn || '';
  
  console.log('[buildContactSheetDataFromViewpoints] 场景描述:', {
    sceneDescZh,
    sceneDescEn,
    visualPromptZh: visualPromptZh ? visualPromptZh.substring(0, 50) + '...' : '(无)',
    visualPromptEn: visualPromptEn ? visualPromptEn.substring(0, 50) + '...' : '(无)',
  });
  
  const styleStr = styleTokens.length > 0 
    ? styleTokens.join(', ') 
    : 'anime style, soft colors, detailed background';
  
  // 构建分镜 ID 到序号的映射
  const shotIdToIndex = new Map<string, number>();
  shots.forEach(shot => {
    shotIdToIndex.set(shot.id, shot.index);
  });
  
  // 生成 PendingViewpointData
  const pendingViewpoints: PendingViewpointData[] = [];
  
  pages.forEach((pageViewpoints, pageIndex) => {
    pageViewpoints.forEach((vp, idx) => {
      // 获取关联分镜的序号
      const shotIndexes = vp.shotIds
        .map(id => shotIdToIndex.get(id))
        .filter((idx): idx is number => idx !== undefined)
        .sort((a, b) => a - b);
      
      pendingViewpoints.push({
        id: vp.id,
        name: vp.name,
        nameEn: vp.nameEn || vp.name, // 如果没有英文名，使用中文名
        shotIds: vp.shotIds,
        shotIndexes,
        keyProps: vp.keyProps,
        keyPropsEn: [], // 可能没有英文道具名，留空
        gridIndex: idx,
        pageIndex,
      });
    });
  });
  
  // 生成每页的 ContactSheetPromptSet
  const contactSheetPrompts: ContactSheetPromptSet[] = pages.map((pageViewpoints, pageIndex) => {
    const totalCells = gridLayout.rows * gridLayout.cols;
    const paddedCount = totalCells;
    const actualCount = pageViewpoints.length;
    
    // 构建英文提示词 — 对齐导演面板三层风格注入
    const promptParts: string[] = [];
    
    // 计算每格的宽高比描述
    const panelAspect = aspectRatio === '16:9' ? '16:9 (horizontal landscape)' : '9:16 (vertical portrait)';
    
    promptParts.push('<instruction>');
    promptParts.push(`Generate a clean ${gridLayout.rows}x${gridLayout.cols} storyboard grid with exactly ${paddedCount} equal-sized panels.`);
    promptParts.push(`Overall Image Aspect Ratio: ${aspectRatio}.`);
    promptParts.push(`Each individual panel must have a ${panelAspect} aspect ratio.`);
    // Layer 1: MANDATORY 风格前置（instruction 区内，最高优先级）
    promptParts.push(`MANDATORY Visual Style for ALL panels: ${styleStr}`);
    promptParts.push('Structure: No borders between panels, no text, no watermarks, no speech bubbles.');
    promptParts.push('Consistency: Maintain consistent perspective, lighting, color grading, and visual style across ALL panels.');
    promptParts.push('Subject: Interior design and architectural details only, NO people.');
    promptParts.push('</instruction>');
    
    promptParts.push(`Layout: ${gridLayout.rows} rows, ${gridLayout.cols} columns, reading order left-to-right, top-to-bottom.`);
    
    if (sceneDescEn) {
      promptParts.push(`Scene Context: ${sceneDescEn}`);
    }
    
    // 添加视觉提示词（英文）
    if (visualPromptEn) {
      promptParts.push(`Visual Description: ${visualPromptEn}`);
    }
    
    // 每个格子的内容描述 + Layer 2: 每格风格锚定
    pageViewpoints.forEach((vp, idx) => {
      const row = Math.floor(idx / gridLayout.cols) + 1;
      const col = (idx % gridLayout.cols) + 1;
      const vpNameEn = vp.nameEn || vp.name;
      const content = vp.keyProps.length > 0 
        ? `showing ${vp.keyProps.join(', ')}` 
        : (vpNameEn === 'Overview' || vp.name === '全景' ? 'wide shot showing the entire room layout' : `${vpNameEn} angle of the room`);
      
      promptParts.push(`Panel [row ${row}, col ${col}] (no people): ${content} [same style]`);
    });
    
    // 空白占位格
    for (let i = actualCount; i < paddedCount; i++) {
      const row = Math.floor(i / gridLayout.cols) + 1;
      const col = (i % gridLayout.cols) + 1;
      promptParts.push(`Panel [row ${row}, col ${col}]: empty placeholder, solid gray background`);
    }
    
    // Layer 3: 尾部风格强调（首尾夹击）
    promptParts.push(`IMPORTANT - Apply this EXACT style uniformly to every panel: ${styleStr}`);
    promptParts.push('Negative constraints: text, watermark, split screen borders, speech bubbles, blur, distortion, bad anatomy, people, characters, distorted grid, uneven panels.');
    
    const prompt = promptParts.join('\n');
    
    // 中文提示词
    const gridItemsZh = pageViewpoints.map((vp, i) => {
      const content = vp.keyProps.length > 0 
        ? `展示${vp.keyProps.join('、')}` 
        : (vp.name === '全景' ? '展示整个空间布局的宽角度全景' : `${vp.name}视角`);
      return `[${i + 1}] ${vp.name}：${content}`;
    }).join('\n');
    
    const promptZh = `一张精确的 ${gridLayout.rows}行${gridLayout.cols}列 网格图（共 ${totalCells} 个格子），展示同一个「${scene.name || scene.location}」场景的不同视角。
${sceneDescZh}${visualPromptZh ? `\n场景氛围：${visualPromptZh}` : ''}

${totalCells} 个格子分别展示：
${gridItemsZh}

重要：
- 必须精确生成 ${gridLayout.rows} 行 ${gridLayout.cols} 列，不能多也不能少。
- 这是一张干净的参考图，图片上不要添加任何文字覆盖。
- 不要添加标签、标题、说明文字、水印或任何类型的文字。

风格：${styleTokens.length > 0 ? styleTokens.join('、') : '动画风格，柔和色彩，细节丰富'}，所有格子光照一致，格子之间用细白边框分隔，只有背景，没有人物。`;
    
    return {
      pageIndex,
      prompt,
      promptZh,
      viewpointIds: pageViewpoints.map(vp => vp.id),
      gridLayout,
    };
  });
  
  return {
    viewpoints: pendingViewpoints,
    contactSheetPrompts,
  };
}
