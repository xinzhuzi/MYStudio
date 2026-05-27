// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
/**
 * Media-Type Tokens — 摄影参数 × 媒介类型翻译层
 *
 * 核心职责：根据视觉风格的 mediaType，将物理摄影 promptToken 翻译为
 * 该媒介能驾驭的等效表达。
 *
 * 翻译策略：
 * - cinematic  → 直通，保留全部物理摄影词汇
 * - animation  → 虚拟摄像机语义适配（轨道→视差平移、景深→层次模糊）
 * - stop-motion → 微缩实拍约束（轨道→微型滑轨、景深→微距镜头）
 * - graphic    → 跳过物理参数，灯光→色彩/情绪/节奏描述
 */

import type { MediaType } from '@/lib/constants/visual-styles';

// ==================== 字段类型 ====================

export type CinematographyField =
  | 'cameraRig'
  | 'shotSize'
  | 'movementSpeed'
  | 'depthOfField'
  | 'focusTransition'
  | 'lightingStyle'
  | 'lightingDirection'
  | 'colorTemperature'
  | 'atmosphericEffect'
  | 'effectIntensity'
  | 'playbackSpeed'
  | 'cameraAngle'
  | 'focalLength'
  | 'photographyTechnique';

// ==================== 翻译表 ====================

/**
 * 每种非-cinematic 媒介的字段级翻译表。
 * - key = preset id
 * - value = 替换后的 promptToken（空字符串 = 静默跳过）
 *
 * 不在表中的 preset id → 沿用原始 token（兼容未来新增预设）
 */
type FieldOverrides = Record<string, string>;

/**
 * 'skip' 表示该字段在该媒介下整体跳过（返回空字符串）
 */
type FieldStrategy = FieldOverrides | 'skip';

type MediaTranslationTable = Partial<Record<CinematographyField, FieldStrategy>>;

// ---------- animation ----------

const ANIMATION_TABLE: MediaTranslationTable = {
  cameraRig: {
    tripod:    'static frame composition,',
    handheld:  'slight camera wobble, animated shake,',
    steadicam: 'smooth gliding virtual camera,',
    dolly:     'smooth tracking with parallax layers,',
    crane:     'sweeping vertical arc camera,',
    drone:     'aerial sweeping bird-eye view,',
    shoulder:  'subtle animated camera sway,',
    slider:    'smooth lateral pan with depth shift,',
  },
  depthOfField: {
    'ultra-shallow': 'dreamy layered blur, strong foreground-background separation,',
    shallow:         'soft background blur, depth layers,',
    medium:          'moderate depth layering,',
    deep:            'all layers in sharp focus,',
    'split-diopter': 'dual-plane sharp focus, foreground and background clear,',
  },
  focusTransition: {
    none:           '',
    'rack-to-fg':   'focus shift to foreground layer,',
    'rack-to-bg':   'focus shift to background layer,',
    'rack-between': 'focus shift between character layers,',
    'pull-focus':   'focus tracking subject movement,',
  },
  // lightingStyle / lightingDirection / colorTemperature / movementSpeed / playbackSpeed
  // → 概念相通，不做翻译，沿用原始 token
  // cameraAngle / focalLength / photographyTechnique → 虚拟摄像机可直接使用
};

// ---------- stop-motion ----------

const STOP_MOTION_TABLE: MediaTranslationTable = {
  cameraRig: {
    tripod:    'locked miniature camera, tabletop framing,',
    handheld:  'subtle stop-motion jitter,',
    steadicam: 'smooth miniature track movement,',
    dolly:     'miniature rail push-in,',
    crane:     'overhead rig on miniature set,',
    drone:     'overhead crane angle, miniature landscape,',
    shoulder:  'gentle stop-motion wobble,',
    slider:    'miniature slider lateral movement,',
  },
  depthOfField: {
    'ultra-shallow': 'macro lens extreme bokeh, tilt-shift miniature feel,',
    shallow:         'macro lens shallow DOF, miniature scale emphasis,',
    medium:          'moderate DOF, miniature set visible,',
    deep:            'deep focus, full miniature set sharp,',
    'split-diopter': 'split focus, miniature foreground and background sharp,',
  },
  focusTransition: {
    none:           '',
    'rack-to-fg':   'rack focus to foreground prop,',
    'rack-to-bg':   'rack focus to miniature background,',
    'rack-between': 'rack focus between miniature figures,',
    'pull-focus':   'pull focus following figure movement,',
  },
  playbackSpeed: {
    'slow-motion-4x': 'fewer frames per movement, very deliberate pacing,',
    'slow-motion-2x': 'reduced frame rate, deliberate pacing,',
    normal:           '',
    'fast-2x':        'rapid frame sequence,',
    timelapse:        'rapid stop-motion sequence, time compression,',
  },
};

// ---------- graphic ----------

const GRAPHIC_TABLE: MediaTranslationTable = {
  // 物理摄影参数 → 全部跳过
  cameraRig:       'skip',
  movementSpeed:   'skip',
  depthOfField:    'skip',
  focusTransition: 'skip',
  lightingDirection: 'skip',
  cameraAngle:             'skip',
  focalLength:             'skip',
  photographyTechnique:    'skip',
  // 灯光风格 → 转译为色彩/情绪
  lightingStyle: {
    'high-key':    'bright palette, open composition,',
    'low-key':     'dark tones, heavy contrast areas,',
    silhouette:    'solid dark shapes against light ground,',
    chiaroscuro:   'strong light-dark contrast zones,',
    natural:       'natural color palette,',
    neon:          'vibrant neon color accents,',
    candlelight:   'warm golden amber tint,',
    moonlight:     'cool blue-silver tint,',
  },
  // 色温 → 色调倾向
  colorTemperature: {
    warm:          'warm orange-amber tones,',
    neutral:       'balanced neutral palette,',
    cool:          'cool blue tones,',
    'golden-hour': 'warm golden cast,',
    'blue-hour':   'twilight blue-purple cast,',
    mixed:         'mixed warm and cool accents,',
  },
  // 播放速度 → 节奏描述
  playbackSpeed: {
    'slow-motion-4x': 'slow deliberate pacing,',
    'slow-motion-2x': 'slow pacing,',
    normal:           '',
    'fast-2x':        'rapid sequence,',
    timelapse:        'compressed time sequence,',
  },
};

// ---------- 汇总查找 ----------

const TRANSLATION_TABLES: Partial<Record<MediaType, MediaTranslationTable>> = {
  animation:      ANIMATION_TABLE,
  'stop-motion':  STOP_MOTION_TABLE,
  graphic:        GRAPHIC_TABLE,
  // cinematic 不需要翻译表
};

// ==================== 核心函数 ====================

/**
 * 将摄影参数 token 翻译为当前媒介类型的等效表达。
 *
 * @param mediaType   - 当前视觉风格的媒介类型
 * @param field       - 摄影参数维度
 * @param presetId    - 预设 ID（如 'dolly', 'shallow'）
 * @param originalToken - 原始 promptToken（来自预设数据）
 * @returns 翻译后的 token；空字符串表示该参数在此媒介下不适用
 */
export function translateToken(
  mediaType: MediaType,
  field: CinematographyField,
  presetId: string,
  originalToken: string,
): string {
  // cinematic → 直通
  if (mediaType === 'cinematic') return originalToken;

  const table = TRANSLATION_TABLES[mediaType];
  if (!table) return originalToken;

  const strategy = table[field];

  // 该字段无特殊处理 → 沿用原始 token
  if (strategy === undefined) return originalToken;

  // 整体跳过
  if (strategy === 'skip') return '';

  // 查表替换
  const override = strategy[presetId];
  return override !== undefined ? override : originalToken;
}

/**
 * 判断某个字段在当前媒介下是否被跳过（UI 可用此决定是否显示灰色）
 */
export function isFieldSkipped(mediaType: MediaType, field: CinematographyField): boolean {
  if (mediaType === 'cinematic') return false;
  const table = TRANSLATION_TABLES[mediaType];
  return table?.[field] === 'skip';
}

/**
 * 获取媒介类型的简要指导说明（用于 AI 校准 system prompt）
 */
export function getMediaTypeGuidance(mediaType: MediaType): string {
  switch (mediaType) {
    case 'cinematic':
      return 'This is a cinematic/live-action visual style. Use full physical cinematography vocabulary — real camera rigs, lens optics, lighting setups.';
    case 'animation':
      return 'This is an animation style. Adapt camera terms to virtual camera equivalents — use parallax layers instead of physical dolly, layer blur instead of optical DOF. Keep lighting and mood concepts.';
    case 'stop-motion':
      return 'This is a stop-motion style. Frame everything as miniature/tabletop photography — macro lenses, miniature sets, practical lighting on small scale. Respect frame-by-frame pacing.';
    case 'graphic':
      return 'This is a highly abstract graphic style (pixel art, watercolor, line art, etc.). Do NOT use physical camera or lens terminology. Describe visual composition, color palette, mood, and rhythm instead.';
  }
}
