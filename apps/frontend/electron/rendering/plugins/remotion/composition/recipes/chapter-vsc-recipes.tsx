// vsc 章级配方(开篇/章尾)分发——批D 章级能力(design §5)。
//
// 与 camera 五卡(vsc-camera-recipes.tsx)同款纪律:
// - id 闭集常量真源=两个配方组件文件;本文件聚合映射+fail-closed 分发
//   (未知 id 渲染前拒,spec §3;props 校验是第一闸,这里是渲染前最后一闸)。
// - 章级配方不进镜头运镜注册表 VSC_RECIPES(那是 shotFx.motion 闭集,槽位
//   不同):开篇/章尾是 ChapterVideo 前后段,不是逐镜效果——槽位分离故
//   注册表分离,命名同守 vsc: 前缀铁律。
// - 章段帧数(chapterRecipeDurationFrames)是 entry.tsx metadata 扩章长与
//   TargetCompositions Sequence 排布的单一真源。

import type {
  CompositionChapterOpening,
  CompositionChapterOutro,
} from "../composition-props";
import {
  BrandInkOpen,
  BRAND_INK_OPEN_DURATION,
  VSC_BRAND_INK_OPEN_ID,
} from "./brand-ink-open";
import {
  GrainDissolve,
  GRAIN_DISSOLVE_DURATION,
  VSC_GRAIN_DISSOLVE_ID,
} from "./grain-dissolve-outro";

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

/**
 * 开篇段渲染:ChapterVideoComposition 前段的 fail-closed 分发
 * (未知 recipeId 在此 throw;文案非空由 props 校验先行把关)。
 */
export function ChapterOpeningRecipe(
  opening: CompositionChapterOpening,
): React.ReactElement {
  if (opening.recipeId !== VSC_BRAND_INK_OPEN_ID) {
    throw new Error(`未知 vsc 开篇配方(渲染前拒,fail-closed): ${opening.recipeId}`);
  }
  return <BrandInkOpen wordmark={opening.wordmark} {...(opening.kicker ? { kicker: opening.kicker } : {})} />;
}

/**
 * 章尾段渲染:ChapterVideoComposition 尾段的 fail-closed 分发。
 */
export function ChapterOutroRecipe(outro: CompositionChapterOutro): React.ReactElement {
  if (outro.recipeId !== VSC_GRAIN_DISSOLVE_ID) {
    throw new Error(`未知 vsc 章尾配方(渲染前拒,fail-closed): ${outro.recipeId}`);
  }
  return <GrainDissolve tagline={outro.tagline} shortMark={outro.shortMark} />;
}
