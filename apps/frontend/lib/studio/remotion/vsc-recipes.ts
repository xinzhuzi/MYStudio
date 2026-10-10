// vsc:* 镜头配方注册表(10-10 video-shotcraft×Remotion 嫁接,批B 建档)。
//
// 机读注册表,仿 hyperframes-registry-templates.ts(hy:* 370 模板池)先例:
// AI 摄影指南(shot-fx-ai)、SHOT_FX_MOTION_PRESETS 闭集(shot-fx-decisions)、
// effect-registry vscMotion 参数枚举、contracts 校验器(vsc-motion-contract)、
// composition props 投影(composition-shot)共用本表——一条 id 一个名字全链一致
// (design §1.4 命名铁律:vsc: 前缀 + 上游卡名/组件名 kebab-case)。
//
// 上游:Vincentawei1021/video-shotcraft @ 5ddbf521(Apache-2.0,改造说明见
// composition/ATTRIBUTION-vsc.md)。首批 7 档=grill 决议 D1(2026-10-10):
// camera 五卡走 composition/recipes/ 组件直渲(impl 指向组件文件=能力矩阵真源);
// depth 两卡无独立组件——落地为 LayeredVisualClip 层系数配方(系数记在
// SHOT_FX_MOTION_PRESETS 的 vsc.layers,本表 params 只做闭集档案)。
//
// D4(决议):首批配方参数烧死卡片默认值,AI 只选 id 不调参;storyboard 的
// motionParams 仅预留类型,键域=本表 params 声明,首批不接 AI 不接 UI。
//
// camera-dictionary 死代码前车之鉴:本表每一条都有消费点——决策层
// (SHOT_FX_MOTION_PRESETS 同 id 同参)、指南(MOTION_GUIDE)、校验器
// (effect-registry 枚举 + contracts fail-closed)、渲染(composition 分发),
// 由 vsc-recipes.test.ts 的接线断言守护。

// id 常量取自纯注册表 vsc-camera-registry(相对导入,固定 bundle 的 webpack
// 不解析 @/ 别名)。**禁直接 import recipes/*.tsx 组件文件**:组件合法携带
// remotion/@remotion/motion-blur/CSS 依赖,经本表会污染 preload 与主进程图
// (2026-10-10 装机"module not found: remotion"preload 装载失败事故根因)。
import {
  VSC_CRASH_ZOOM_PUNCH_ID,
  VSC_DUTCH_ROLL_TO_LEVEL_ID,
  VSC_SLOW_PUSH_IN_ID,
  VSC_PULL_BACK_ISOLATION_ID,
  VSC_DRONE_DIVE_LANDING_ID,
} from "../../../electron/rendering/plugins/remotion/composition/recipes/vsc-camera-registry";

/** depth 两卡无组件文件,本注册表即其 id 唯一真源(命名同 vsc: 前缀铁律)。 */
export const VSC_PARALLAX_GLIDE_ID = "vsc:parallax-glide";
export const VSC_DOLLY_ZOOM_ID = "vsc:dolly-zoom";

/** vsc 运镜 id 闭集(首批 7 档;camera 五卡 id 直接引用组件常量,勿另造字符串)。 */
export type VscMotionId =
  | typeof VSC_CRASH_ZOOM_PUNCH_ID
  | typeof VSC_DUTCH_ROLL_TO_LEVEL_ID
  | typeof VSC_SLOW_PUSH_IN_ID
  | typeof VSC_PULL_BACK_ISOLATION_ID
  | typeof VSC_DRONE_DIVE_LANDING_ID
  | typeof VSC_PARALLAX_GLIDE_ID
  | typeof VSC_DOLLY_ZOOM_ID;

/** vsc 渲染形态:camera 五卡=组件整体接管;depth 两卡=LayeredVisualClip 层系数。 */
export type VscRecipeRender = "component" | "layeredDepth";

/** 卡片类别(上游 references/shots/ 目录名)。 */
export type VscRecipeCategory =
  | "camera"
  | "rhythm"
  | "transition"
  | "typography"
  | "opening"
  | "outro"
  | "effects";

/** 配方参数闭集(D4:烧死卡片默认值;键域即 motionParams 预留字段的合法键)。 */
export type VscRecipeParams = Record<string, number | string | boolean>;

export interface VscRecipe {
  /** 全链命名锚(vsc: 前缀+kebab-case)。 */
  id: VscMotionId;
  /** 上游卡片出处(references/shots/<category>/<card>.md @ 5ddbf521)。 */
  sourceCard: string;
  category: VscRecipeCategory;
  /** 首批 7 档全部填 motion 槽(shotFx.motion)。 */
  slot: "motion";
  energy: "low" | "mid" | "high";
  /** 卡片时长字段的帧数化(@30fps;AI 指南与镜头时长匹配参考)。 */
  typicalDurationFrames: number;
  /** 章级配额(缺省=不限);dolly-zoom 全章 ≤1、crash-zoom ≤2(卡片/决议)。 */
  quota?: { perChapter: number };
  /** 卡片参数表转写(D4:烧死默认值,首批不可调)。 */
  params: VscRecipeParams;
  /** camera 五卡=composition/recipes/<file>.tsx(能力矩阵真源);
   * depth 两卡=LayeredVisualClip 层栈系数(无组件文件)。 */
  impl: string;
  /** 渲染形态:component=五卡组件直渲;layeredDepth=层系数配方。 */
  render: VscRecipeRender;
}

/** 首批 7 档注册表(闭集单源)。 */
export const VSC_RECIPES: Readonly<Record<VscMotionId, VscRecipe>> = {
  [VSC_CRASH_ZOOM_PUNCH_ID]: {
    id: VSC_CRASH_ZOOM_PUNCH_ID,
    sourceCard: "references/shots/camera/crash-zoom-punch.md @ 5ddbf521",
    category: "camera",
    slot: "motion",
    energy: "high",
    typicalDurationFrames: 44,
    quota: { perChapter: 2 },
    params: {
      startFrame: 30,
      zoomFrames: 6,
      fromScale: 1,
      toScale: 2.6,
      landing: "rebound",
      reboundFraction: 0.058,
      shakeAmplitudePx: 14,
      shakeTau: 1.8,
    },
    impl: "electron/rendering/plugins/remotion/composition/recipes/crash-zoom-punch.tsx",
    render: "component",
  },
  [VSC_DUTCH_ROLL_TO_LEVEL_ID]: {
    id: VSC_DUTCH_ROLL_TO_LEVEL_ID,
    sourceCard: "references/shots/camera/tension-camera-moves.md 式B @ 5ddbf521",
    category: "camera",
    slot: "motion",
    energy: "mid",
    typicalDurationFrames: 94,
    params: {
      rollFrame: 70,
      pushFrames: 14,
      settleFrames: 10,
      tiltDeg: -10,
      overshootDeg: 1.2,
      driftAmpDeg: 0.8,
      driftAmpPx: 2,
      fromScale: 1.15,
      toScale: 1.08,
    },
    impl: "electron/rendering/plugins/remotion/composition/recipes/dutch-roll-to-level.tsx",
    render: "component",
  },
  [VSC_SLOW_PUSH_IN_ID]: {
    id: VSC_SLOW_PUSH_IN_ID,
    sourceCard: "references/shots/camera/tension-camera-moves.md 式C @ 5ddbf521",
    category: "camera",
    slot: "motion",
    energy: "mid",
    typicalDurationFrames: 120,
    params: {
      durationFrames: 120,
      fromScale: 1,
      toScale: 1.14,
      vignetteMax: 0.5,
    },
    impl: "electron/rendering/plugins/remotion/composition/recipes/slow-push-in.tsx",
    render: "component",
  },
  [VSC_PULL_BACK_ISOLATION_ID]: {
    id: VSC_PULL_BACK_ISOLATION_ID,
    sourceCard: "references/shots/camera/tension-camera-moves.md 式D @ 5ddbf521(单镜版)",
    category: "camera",
    slot: "motion",
    energy: "low",
    typicalDurationFrames: 110,
    params: {
      pullFrames: 110,
      fromScale: 2.2,
      toScale: 0.62,
      darkStartFrame: 60,
      darkEndFrame: 110,
      glowStartFrame: 60,
      glowEndFrame: 100,
      glowMax: 0.35,
      sinkFromGray: 236,
      sinkToGray: 20,
    },
    impl: "electron/rendering/plugins/remotion/composition/recipes/pull-back-isolation.tsx",
    render: "component",
  },
  [VSC_DRONE_DIVE_LANDING_ID]: {
    id: VSC_DRONE_DIVE_LANDING_ID,
    sourceCard: "references/shots/camera/space-camera-moves.md 式C @ 5ddbf521",
    category: "camera",
    slot: "motion",
    energy: "high",
    typicalDurationFrames: 65,
    params: {
      diveStartFrame: 20,
      diveFrames: 25,
      landFrames: 20,
      diveShare: 0.82,
      fromRotateXDeg: 72,
      toRotateXDeg: 0,
      fromScale: 0.42,
      toScale: 1.35,
    },
    impl: "electron/rendering/plugins/remotion/composition/recipes/drone-dive-landing.tsx",
    render: "component",
  },
  [VSC_PARALLAX_GLIDE_ID]: {
    id: VSC_PARALLAX_GLIDE_ID,
    sourceCard: "references/shots/camera/depth-layer-moves.md 视差滑轨 @ 5ddbf521",
    category: "camera",
    slot: "motion",
    energy: "mid",
    typicalDurationFrames: 135,
    params: {
      driveFromScale: 1.04,
      driveToScale: 1.1,
      backgroundDamp: 0.35,
      subjectDamp: 0.7,
      foregroundDamp: 1.4,
      backgroundBlurPx: 2,
      backgroundSaturate: 0.92,
      backgroundOpacity: 0.85,
      foregroundBlurPx: 3,
    },
    impl: "LayeredVisualClip 层栈系数(层 damp 梯度+blur/降饱和锚;无组件文件)",
    render: "layeredDepth",
  },
  [VSC_DOLLY_ZOOM_ID]: {
    id: VSC_DOLLY_ZOOM_ID,
    sourceCard: "references/shots/camera/depth-layer-moves.md 伪dolly-zoom @ 5ddbf521",
    category: "camera",
    slot: "motion",
    energy: "high",
    typicalDurationFrames: 105,
    // 卡片自注「一支片 ≤1 次,日常段落用视差滑轨」——章级配额进 AI 指南+校验器。
    quota: { perChapter: 1 },
    params: {
      driveFromScale: 1,
      driveToScale: 2.25,
      subjectDamp: 0,
      backgroundDamp: 1,
      backgroundBlurFromPx: 0,
      backgroundBlurToPx: 3.5,
    },
    impl: "LayeredVisualClip 层栈系数(主体层钉死+背景层膨胀;无组件文件)",
    render: "layeredDepth",
  },
};

/** vsc id 有序闭集(effect-registry 枚举/AI 指南/校验器共用)。 */
export const VSC_MOTION_IDS: readonly VscMotionId[] = Object.keys(
  VSC_RECIPES,
) as VscMotionId[];

export function isVscMotionId(value: unknown): value is VscMotionId {
  return typeof value === "string" && value in VSC_RECIPES;
}

/** 章级配额查询(缺省=不限;决策层配额守卫与 contracts 校验器共用)。 */
export function vscRecipeQuota(id: VscMotionId): number | undefined {
  return VSC_RECIPES[id].quota?.perChapter;
}
