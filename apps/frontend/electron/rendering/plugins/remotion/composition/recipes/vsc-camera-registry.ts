// vsc camera 五卡 id 闭集(纯数据,零 React/零组件 import)。
//
// 与 chapter-vsc-registry.ts 同款纪律:主进程图与 preload 图
// (composition-props-validation、lib/studio/remotion/vsc-recipes 等)只准
// import 本文件,禁 import vsc-camera-recipes.tsx 及五个组件文件(组件合法
// 携带 remotion/@remotion/motion-blur/CSS 依赖,进 preload/主图即
// "module not found: remotion" 装载失败,2026-10-10 装机冒烟事故根因)。
// 字面量受 CompositionVscCameraRecipeId 联合类型(composition-props.ts)
// 钳制,且 vsc-camera-recipes 的 Record 映射键再钳一次——漂移即类型错。

import type { CompositionVscCameraRecipeId } from "../composition-props";

/** 全链命名锚(design §1.4:vsc: 前缀+卡名 kebab-case,注册表/校验器同一名字)。 */
export const VSC_CRASH_ZOOM_PUNCH_ID = "vsc:crash-zoom-punch";
export const VSC_DUTCH_ROLL_TO_LEVEL_ID = "vsc:dutch-roll-to-level";
export const VSC_SLOW_PUSH_IN_ID = "vsc:slow-push-in";
export const VSC_PULL_BACK_ISOLATION_ID = "vsc:pull-back-isolation";
export const VSC_DRONE_DIVE_LANDING_ID = "vsc:drone-dive-landing";

/** camera 五卡 id 闭集(单卡真源=上方常量,此处只聚合)。 */
export const VSC_CAMERA_RECIPE_IDS: readonly CompositionVscCameraRecipeId[] = [
  VSC_CRASH_ZOOM_PUNCH_ID,
  VSC_DUTCH_ROLL_TO_LEVEL_ID,
  VSC_SLOW_PUSH_IN_ID,
  VSC_PULL_BACK_ISOLATION_ID,
  VSC_DRONE_DIVE_LANDING_ID,
];

export function isVscCameraRecipeId(value: unknown): value is CompositionVscCameraRecipeId {
  return typeof value === "string" && (VSC_CAMERA_RECIPE_IDS as readonly string[]).includes(value);
}
