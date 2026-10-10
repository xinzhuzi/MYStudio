// vsc 章级配方注册表(纯数据,零 React/零 CSS import)。
//
// 为什么存在:主进程图(composition-props-validation 等)只需要 id 闭集、
// 类型守卫与章段帧数;而配方组件文件(brand-ink-open.tsx 等)为合成 bundle
// 合法携带 @fontsource CSS import——一旦组件文件被主图 import,CSS 会以
// require("*.css") 进入 Node 主进程,打包态启动即死(2026-10-10 装机冒烟
// "No Electron page target" 事故根因)。故常量真源在此,组件文件反向依赖
// 本注册表;主图侧只准 import 本文件,禁 import 任何 recipes/*.tsx。

import type {
  CompositionChapterOpening,
  CompositionChapterOutro,
} from "../composition-props";

export const VSC_BRAND_INK_OPEN_ID = "vsc:brand-ink-open";
export const BRAND_INK_OPEN_DURATION = 104;
export const VSC_GRAIN_DISSOLVE_ID = "vsc:grain-dissolve";
export const GRAIN_DISSOLVE_DURATION = 60;

/** 开篇 id 闭集(单卡;后续扩卡在此聚合,勿另造字符串)。 */
export const VSC_CHAPTER_OPENING_IDS = [VSC_BRAND_INK_OPEN_ID] as const;

/** 章尾 id 闭集(单卡)。 */
export const VSC_CHAPTER_OUTRO_IDS = [VSC_GRAIN_DISSOLVE_ID] as const;

export function isVscChapterOpeningRecipeId(value: unknown): value is CompositionChapterOpening["recipeId"] {
  return typeof value === "string" && (VSC_CHAPTER_OPENING_IDS as readonly string[]).includes(value);
}

export function isVscChapterOutroRecipeId(value: unknown): value is CompositionChapterOutro["recipeId"] {
  return typeof value === "string" && (VSC_CHAPTER_OUTRO_IDS as readonly string[]).includes(value);
}

/** 章段帧数(id→定稿时长;未知 id throw=fail-closed)。 */
export function chapterRecipeDurationFrames(id: string): number {
  if (id === VSC_BRAND_INK_OPEN_ID) return BRAND_INK_OPEN_DURATION;
  if (id === VSC_GRAIN_DISSOLVE_ID) return GRAIN_DISSOLVE_DURATION;
  throw new Error(`未知 vsc 章级配方(渲染前拒,fail-closed): ${id}`);
}
