// vsc 章级配方(开篇/章尾)分发——批D 章级能力(design §5)。
//
// 与 camera 五卡(vsc-camera-recipes.tsx)同款纪律:
// - id 闭集/类型守卫/章段帧数真源=chapter-vsc-registry.ts(纯数据);
//   本文件聚合 React 组件映射+fail-closed 分发(未知 id 渲染前拒,
//   spec §3;props 校验是第一闸,这里是渲染前最后一闸)。
// - **主进程图禁 import 本文件**:组件文件合法携带 @fontsource CSS(合成
//   bundle 侧),进主图即 require("*.css") 启动死(2026-10-10 装机冒烟
//   事故);主图只准 import chapter-vsc-registry。
// - 章级配方不进镜头运镜注册表 VSC_RECIPES(那是 shotFx.motion 闭集,槽位
//   不同):开篇/章尾是 ChapterVideo 前后段,不是逐镜效果——槽位分离故
//   注册表分离,命名同守 vsc: 前缀铁律。

import type {
  CompositionChapterOpening,
  CompositionChapterOutro,
} from "../composition-props";
import { BrandInkOpen } from "./brand-ink-open";
import { GrainDissolve } from "./grain-dissolve-outro";
import {
  chapterRecipeDurationFrames,
  isVscChapterOpeningRecipeId,
  isVscChapterOutroRecipeId,
  VSC_BRAND_INK_OPEN_ID,
  VSC_CHAPTER_OPENING_IDS,
  VSC_CHAPTER_OUTRO_IDS,
  VSC_GRAIN_DISSOLVE_ID,
} from "./chapter-vsc-registry";

// 纯数据项再导出:合成 bundle 侧既有消费方(entry/TargetCompositions/测试)不改。
export {
  chapterRecipeDurationFrames,
  isVscChapterOpeningRecipeId,
  isVscChapterOutroRecipeId,
  VSC_CHAPTER_OPENING_IDS,
  VSC_CHAPTER_OUTRO_IDS,
};

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
