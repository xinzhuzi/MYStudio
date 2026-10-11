// 2D 镜头表现（共享单源）：CLI 全管线与 App 一键成片共用，
// 保证两条入口产出一致。
// 模型 = 运镜(18 legacy + 7 vsc:*) × 特效插件(可组合)：AI 每镜选 1 个运镜
// + 0~2 个量化特效插件（自由组合防观看疲劳、成套风格）；未显式配置特效时
// 按运镜配方的默认特效兜底。特效插件强度内置（registry 数值域），不可越界配置。
// 产出契约形状的 EditingEffect[]（panZoom/shake/glow/grain/chromaticAberration），
// 经 plan.effects 正门进入合成（build-composition-props 消费），章节渲染身份哈希
// 含 plan.effects → 镜头表现变化自动触发缓存失效。不再做渲染时直注。
// 优先级：分镜记录上的 AI 选择（shotFx.motion + shotFx.addons）>
// 关键词命中（映射到成套配方）> 镜序轮换 7 基础运镜。
// 锐度纪律：源图已上采样到合成分辨率，panZoom 再放大即二次软化——
// 常规镜缩放上限 1.08，动作 punch 上限 1.12，颗粒 0.035。
//
// vsc:* 扩容(10-10 批B,决议 D1/D2/D3/D4):
// - 运镜闭集 = LegacyMotionId(18,永不退役,存量工程逐字节兼容) ∪ VscMotionId(7,
//   video-shotcraft 嫁接,注册表真源 vsc-recipes.ts);两类同池等权混排(D2)。
// - vsc camera 五卡经 vscMotion 效果只带 recipe id(D4 参数烧死卡片默认值),
//   组件整体接管渲染,伴生 fx/grain/grade 不叠加(与 cinematic 分支同纪律);
//   depth 两卡(parallax-glide/dolly-zoom)=LayeredVisualClip 层系数配方:
//   panZoom 驱动照发+vscMotion id,分层镜由投影端施加层系数。
// - 章级配额(dolly-zoom ≤1、crash-zoom ≤2)在此守卫:超额 vsc 回落镜序轮换。

import { isCinematicLutId } from "./cinematic-luts";
import { isAtmosphereTemplateId } from "./atmosphere-templates";
import { isVscMotionId, vscRecipeQuota, type VscMotionId } from "./vsc-recipes";
import type { EditingEffect } from "@/types/editing";

/** legacy 18 值闭集(2026-08 起冻结:旧值不动永不退役,D2)。 */
export type LegacyMotionId =
  | "push-in"
  | "pull-out"
  | "pan-right"
  | "pan-left"
  | "tilt-down"
  | "tilt-up"
  | "drift"
  | "punch-in"
  | "leave-pull"
  | "chase-in"
  | "aura-push"
  | "gloom-pull"
  | "hold"
  // 环境动画(2026-08-19): 让静态画面「活」起来——sin/cos 周期运动叠加在 panZoom 之上
  | "float"     // 漂浮:缓慢上下浮动,如水面悬浮
  | "breathe"   // 呼吸:微缩放脉动,画面有生命感
  | "sway"      // 摇摆:左右轻晃,如风中景物
  | "pulse"     // 脉动:推拉交替,呼吸变焦
  | "flow"      // 流动:多轴慢移,无方向感漫游
;

/** 运镜闭集(10-10 批B 扩容,D2):legacy 18 与 vsc 7 同池等权,legacy 永不退役。 */
export type ShotFxMotionId = LegacyMotionId | VscMotionId;

/** 可组合特效插件 ID（量化档位，强度内置不可配置）。 */
export type ShotFxAddonId =
  | "shake-soft"
  | "shake-hard"
  | "glow-warm"
  | "glow-dim"
  | "chroma"
  // 08-19 第二批:残影/速度剪影/神光/帧步进/调色脉动
  | "afterimage"
  | "speed-silhouette"
  | "god-rays"
  | "on-twos"
  | "grade-pulse";

export interface ShotFxPanZoom {
  fromScale: number;
  toScale: number;
  originX: number;
  originY: number;
  /** 缓动曲线（08-21 spring 接入）：缺省=cubic 历史行为；"spring"=Remotion 弹性曲线。 */
  easing?: "cubic" | "spring";
}

/** 配方特效参数（registry 数值域：shake intensity 0..1（×24=amplitudePx）、glow intensity 0..1、chroma offset 0..24）。 */
export interface ShotFxRecipeFx {
  shakeIntensity?: number;
  glowIntensity?: number;
  chromaOffset?: number;
}

export interface ShotFxAmbient {
  /** 动画类型 */
  type: "float" | "breathe" | "sway" | "pulse" | "flow";
  /** X 轴振幅(画面宽度百分比, 0..0.05) */
  ampX: number;
  /** Y 轴振幅(画面高度百分比, 0..0.05) */
  ampY: number;
  /** 缩放振幅(0..0.03) */
  ampScale: number;
  /** 旋转振幅(度, 0..1) */
  ampRot: number;
  /** 频率(周期/秒, 0.1..0.8) */
  freq: number;
  /** 相位偏移(0..1, 防相邻镜同相) */
  phase: number;
}

/** vsc depth 层系数配方(depth-layer-moves 卡转写;LayeredVisualClip 消费):
 *  同一条 panZoom 驱动 × 各层系数=视差;blur/降饱和锚让层间关系读作「景深」
 *  (卡片:没有锚读作"贴片乱飞";主阅读层/主体必须高清无 blur)。 */
export interface ShotFxVscLayerCoefficients {
  /** 背景层(层栈 role=background):系数围绕 1.0 收敛,1=吃满驱动。 */
  background: { panZoomDamp: number; blurFromPx?: number; blurToPx?: number; saturate?: number; opacity?: number };
  /** 主体层(role=subject):dolly-zoom 钉死=0(不参与任何变换)。 */
  subject: { panZoomDamp: number };
  /** 前景层(role=foreground;无前景分层的镜自然缺省)。 */
  foreground?: { panZoomDamp: number; blurFromPx?: number; blurToPx?: number };
}

export interface ShotFxRecipe {
  panZoom: ShotFxPanZoom;
  fx: ShotFxRecipeFx;
  /** 环境动画(叠加在 panZoom 之上的周期运动;null=无) */
  ambient: ShotFxAmbient | null;
  /**
   * vsc:* 运镜(10-10 批B):
   * - render="component"(camera 五卡):组件整体接管渲染——本条 panZoom/fx/ambient
   *   仅作卡片曲线的档案值,决策层不发射 panZoom 效果,伴生特效不叠加
   *   (与 cinematic 分支同纪律;参数烧死卡片默认值=决议 D4)。
   * - render="layeredDepth"(depth 两卡):panZoom 驱动照常发射,层系数由投影端
   *   施加进 layerStack(无分层源的镜=驱动单图近似,系数自然不生效)。
   */
  vsc?: {
    render: "component" | "layeredDepth";
    layers?: ShotFxVscLayerCoefficients;
  };
}

/** 镜头表现配方表（唯一权威来源，含缩放纪律上限）。
 * 前七项为无特效基础运镜（轮换用）；后六项为带默认特效的成套配方
 * （未显式配置特效插件时的兜底）；hold 为锁帧节奏对比（仅 AI 可选）。
 * vsc:* 七项(10-10 批B):camera 五卡 panZoom=卡片曲线档案值(不发射,组件直渲);
 * depth 两卡 panZoom=驱动曲线(照常发射)。锐度纪律(≤1.08/1.12)只辖 legacy 18,
 * vsc 卡片曲线有自己的域(如 dolly 膨胀 1→2.25)——闭集校验单测按域分治。
 */
export const SHOT_FX_MOTION_PRESETS: Readonly<Record<ShotFxMotionId, ShotFxRecipe>> = {
  "push-in": {
    // 入场推进用弹性缓动（08-21）：spring 约 5% 过冲的「呼吸感」入场；
    // 其余运镜保持 cubic 历史曲线，避免全片风格突变。
    panZoom: { fromScale: 1.0, toScale: 1.05, originX: 0.5, originY: 0.5, easing: "spring" },
    fx: {},
    ambient: null,
  },
  "pull-out": {
    panZoom: { fromScale: 1.07, toScale: 1.0, originX: 0.5, originY: 0.5 },
    fx: {},
    ambient: null,
  },
  "pan-right": {
    panZoom: { fromScale: 1.03, toScale: 1.08, originX: 0.72, originY: 0.5 },
    fx: {},
    ambient: null,
  },
  "pan-left": {
    panZoom: { fromScale: 1.03, toScale: 1.08, originX: 0.28, originY: 0.5 },
    fx: {},
    ambient: null,
  },
  "tilt-down": {
    panZoom: { fromScale: 1.02, toScale: 1.07, originX: 0.5, originY: 0.68 },
    fx: {},
    ambient: null,
  },
  "tilt-up": {
    panZoom: { fromScale: 1.02, toScale: 1.07, originX: 0.5, originY: 0.32 },
    fx: {},
    ambient: null,
  },
  drift: {
    panZoom: { fromScale: 1.01, toScale: 1.04, originX: 0.5, originY: 0.5 },
    fx: {},
    ambient: null,
  },
  // 动作爆点：急推，默认成套 强抖+色差
  "punch-in": {
    panZoom: { fromScale: 1.0, toScale: 1.12, originX: 0.5, originY: 0.5 },
    // 08-21 用户裁定:去掉 punch-in 默认 chromaOffset——色差特效在大面积红色画面上
    // 会产生难看的红青色块分离,破坏整体色调统一性。
    fx: { shakeIntensity: 0.25 },
    ambient: null,
  },
  // 退场收尾：拉远离席，默认无特效
  "leave-pull": {
    panZoom: { fromScale: 1.07, toScale: 1.0, originX: 0.5, originY: 0.5 },
    fx: {},
    ambient: null,
  },
  // 追逐/奔逃：快推（贴上限），默认成套 轻抖
  "chase-in": {
    panZoom: { fromScale: 1.0, toScale: 1.08, originX: 0.5, originY: 0.5 },
    fx: { shakeIntensity: 0.125 },
    ambient: null,
  },
  // 灵光/焰火/仙阵：缓推，默认成套 暖调强辉光
  "aura-push": {
    panZoom: { fromScale: 1.0, toScale: 1.05, originX: 0.5, originY: 0.5 },
    fx: { glowIntensity: 0.5 },
    ambient: null,
  },
  // 阴暗/夜雾/深渊：缓拉，默认成套 暗调弱辉光
  "gloom-pull": {
    panZoom: { fromScale: 1.07, toScale: 1.0, originX: 0.5, originY: 0.5 },
    fx: { glowIntensity: 0.25 },
    ambient: null,
  },
  // 锁帧：刻意静止，爆点前后的节奏对比（仅 AI 可选，不进轮换）
  hold: {
    panZoom: { fromScale: 1.0, toScale: 1.0, originX: 0.5, originY: 0.5 },
    fx: {},
    ambient: null,
  },
  // ── 环境动画: sin/cos 周期运动,叠加在 panZoom 上让画面活起来 ──
  "float": {
    panZoom: { fromScale: 1.03, toScale: 1.05, originX: 0.5, originY: 0.5 },
    fx: {},
    ambient: { type: "float", ampX: 0, ampY: 0.008, ampScale: 0, ampRot: 0, freq: 0.25, phase: 0 },
  },
  "breathe": {
    panZoom: { fromScale: 1.02, toScale: 1.04, originX: 0.5, originY: 0.5 },
    fx: {},
    ambient: { type: "breathe", ampX: 0, ampY: 0, ampScale: 0.008, ampRot: 0, freq: 0.15, phase: 0 },
  },
  "sway": {
    panZoom: { fromScale: 1.04, toScale: 1.06, originX: 0.5, originY: 0.5 },
    fx: {},
    ambient: { type: "sway", ampX: 0.006, ampY: 0, ampScale: 0, ampRot: 0.3, freq: 0.2, phase: 0 },
  },
  "pulse": {
    panZoom: { fromScale: 1.02, toScale: 1.06, originX: 0.5, originY: 0.5 },
    fx: {},
    ambient: { type: "pulse", ampX: 0, ampY: 0, ampScale: 0.012, ampRot: 0, freq: 0.12, phase: 0 },
  },
  "flow": {
    panZoom: { fromScale: 1.03, toScale: 1.05, originX: 0.5, originY: 0.5 },
    fx: {},
    ambient: { type: "flow", ampX: 0.008, ampY: 0.006, ampScale: 0.003, ampRot: 0.15, freq: 0.1, phase: 0 },
  },
  // ── vsc:* 七档(10-10 批B,video-shotcraft 嫁接;注册表真源 vsc-recipes.ts) ──
  // camera 五卡:组件直渲,vscMotion 效果只带 recipe id(D4);panZoom 字段为卡片
  // 曲线档案值(不发射),fx/ambient 恒空(震屏/暗角等在组件曲线内)。
  "vsc:crash-zoom-punch": {
    // 急推点名:6f 1→2.6,rebound 过冲回弹 5.8%(impact 款震屏 14px 在组件内)。
    panZoom: { fromScale: 1.0, toScale: 2.6, originX: 0.5, originY: 0.5 },
    fx: {},
    ambient: null,
    vsc: { render: "component" },
  },
  "vsc:dutch-roll-to-level": {
    // 斜角滚正:-10° 悬置(漂移 ±0.8°/2px)→ 14f 冲过 0 过冲 +1.2° → 10f 收 0。
    panZoom: { fromScale: 1.15, toScale: 1.08, originX: 0.5, originY: 0.5 },
    fx: {},
    ambient: null,
    vsc: { render: "component" },
  },
  "vsc:slow-push-in": {
    // 慢推压迫:120f 匀加速(Easing.in quad)1.00→1.14,暗角 0→0.5 同曲线渐深。
    panZoom: { fromScale: 1.0, toScale: 1.14, originX: 0.5, originY: 0.5 },
    fx: {},
    ambient: null,
    vsc: { render: "component" },
  },
  "vsc:pull-back-isolation": {
    // 拉远孤立(单镜版):2.2 特写 → 110f out(cubic) → 0.62 大远景孤悬;
    // 背景 60–110f 沉黑、主体光晕 60–100f 淡入(全在组件内)。
    panZoom: { fromScale: 2.2, toScale: 0.62, originX: 0.5, originY: 0.5 },
    fx: {},
    ambient: null,
    vsc: { render: "component" },
  },
  "vsc:drone-dive-landing": {
    // 无人机俯冲:20f 悬停(rotateX 72°/0.42 全景)→ 25f in(cubic) 82% 行程
    // → 20f out(poly5) 气垫 → 1.35 特写;全场 motion-blur(220/9)。
    panZoom: { fromScale: 0.42, toScale: 1.35, originX: 0.5, originY: 0.5 },
    fx: {},
    ambient: null,
    vsc: { render: "component" },
  },
  // depth 两卡:LayeredVisualClip 层系数配方——panZoom 驱动照常发射,层 damp
  // 梯度+blur/降饱和锚由投影端施加(depth-layer-moves 卡参数表转写)。
  "vsc:parallax-glide": {
    // 视差滑轨:同一驱动 × 层系数 0.35/0.7/1.4;背景退成环境(blur 2px+降饱和
    // 0.92+opacity 0.85),主阅读层无锚,前景掠过镜头(blur 3px)。
    panZoom: { fromScale: 1.04, toScale: 1.1, originX: 0.68, originY: 0.5 },
    fx: {},
    ambient: null,
    vsc: {
      render: "layeredDepth",
      layers: {
        background: { panZoomDamp: 0.35, blurFromPx: 2, blurToPx: 2, saturate: 0.92, opacity: 0.85 },
        subject: { panZoomDamp: 0.7 },
        foreground: { panZoomDamp: 1.4, blurFromPx: 3, blurToPx: 3 },
      },
    },
  },
  "vsc:dolly-zoom": {
    // 伪 dolly-zoom:主体层钉死(damp 0=纹丝不动),背景层膨胀 1→2.25
    // + blur 0→3.5px 渐深;无分层源的镜退化为驱动单图近似(全幅 2.25)。
    // 章级配额 ≤1(vsc-recipes quota;决策守卫+contracts 校验器双闸)。
    panZoom: { fromScale: 1.0, toScale: 2.25, originX: 0.5, originY: 0.5 },
    fx: {},
    ambient: null,
    vsc: {
      render: "layeredDepth",
      layers: {
        background: { panZoomDamp: 1, blurFromPx: 0, blurToPx: 3.5 },
        subject: { panZoomDamp: 0 },
      },
    },
  },
};

/** 特效插件表（量化档位 → 契约效果与参数；同种效果互斥，取首个）。 */
export const SHOT_FX_ADDON_PRESETS: Readonly<
  Record<ShotFxAddonId, { effectId: "shake" | "glow" | "chromaticAberration" | "afterimage" | "speedSilhouette" | "godRays" | "onTwos" | "gradePulse"; params: Record<string, number | string> }>
> = {
  "shake-soft": { effectId: "shake", params: { intensity: 0.125 } },
  "shake-hard": { effectId: "shake", params: { intensity: 0.25 } },
  "glow-warm": { effectId: "glow", params: { intensity: 0.5 } },
  "glow-dim": { effectId: "glow", params: { intensity: 0.25 } },
  chroma: { effectId: "chromaticAberration", params: { offset: 3 } },
  afterimage: { effectId: "afterimage", params: { copies: 3, offset: 26, opacity: 0.5 } },
  "speed-silhouette": { effectId: "speedSilhouette", params: { direction: "ltr" } },
  "god-rays": { effectId: "godRays", params: { intensity: 0.6, hue: 45 } },
  "on-twos": { effectId: "onTwos", params: { step: 2 } },
  "grade-pulse": { effectId: "gradePulse", params: { amp: 0.08, freq: 0.3 } },
};

/** 无关键词命中时的镜序轮换（7 基础运镜，节奏变化用）。 */
export const SHOT_FX_MOTION_ROTATION: readonly ShotFxMotionId[] = [
  "push-in",
  "pull-out",
  "pan-right",
  "pan-left",
  "tilt-down",
  "tilt-up",
  "drift",
];

export function isShotFxMotionId(value: unknown): value is ShotFxMotionId {
  return typeof value === "string" && value in SHOT_FX_MOTION_PRESETS;
}

export function isShotFxAddonId(value: unknown): value is ShotFxAddonId {
  return typeof value === "string" && value in SHOT_FX_ADDON_PRESETS;
}

export interface ShotFxStoryboardInput {
  id: string;
  prompt?: string;
  line?: string;
  /**
   * AI 镜头表现选择结果（装饰层，不进 sourceFingerprint）。
   * addons 为 AI 显式配置的特效插件（空数组=显式无特效）；缺省=用运镜配方默认特效。
   * 非法值一律按缺省处理。
   */
  shotFx?: { motion?: unknown; addons?: unknown; grade?: unknown; atmosphere?: unknown; source?: unknown };
}

/** 章节统一色调（08-19 导演定调）：钉死值全章覆盖，跳过逐镜 AI grade。 */
export interface ChapterGradeOverride {
  lutId: string;
  blend: number;
}

export interface ShotFxPlanClipLike {
  id: string;
  trackKind: string;
  startUs: number;
  durationUs: number;
  source?: {
    /** 素材来源(TimelineRenderClip.source.kind 全量在场,纯拓宽向后兼容)。 */
    kind?: string;
    evidence?: { storyboardId?: string; remotionJobId?: string };
  };
}

/**
 * 素材形态门(10-11 H3 主线分工):H3/真实视频镜只吃装配层,静图产线镜吃完整创作链。
 * 判定表(design 真源,实现与测试逐行对齐):
 * - videoCandidate            → assembly-only(production track = H3 线)
 * - storyboardImage           → 创作链(静图产线)
 * - storyboardVideo+remotionJobId → 创作链(Remotion 逐镜队列产物,静图+运镜已烘)
 * - storyboardVideo 无证据     → assembly-only(mediaRef 视频=已有真实运动)
 * - 其他/未识别 kind / 无 source → assembly-only(未知素材按真实视频保守处理,fail-closed)
 */
export function isAssemblyOnlyClip(clip: ShotFxPlanClipLike): boolean {
  switch (clip.source?.kind) {
    case "storyboardImage":
      return false;
    case "storyboardVideo":
      return !clip.source.evidence?.remotionJobId;
    case "videoCandidate":
      return true;
    default:
      return true;
  }
}

export interface ShotFxResult {
  effects: EditingEffect[];
  counts: { motion: number; vsc: number; shake: number; glow: number; chroma: number };
}

/**
 * vsc 章级配额守卫(select 级共用):按镜头顺序保留前 quota 个同名 vsc 运镜,
 * 超额者回落镜序轮换(确定性,与 clipIndex 对齐渲染侧规则)。legacy 永不配额(D2)。
 * AI 路径与 heuristic 路径共用,保证 shotFx 数据与渲染效果一致(不出现
 * 数据写 dolly、效果落轮换的分裂)。
 */
export function enforceVscMotionQuota(
  motions: Record<string, ShotFxMotionId>,
  orderedShotIds: readonly string[],
): Record<string, ShotFxMotionId> {
  const usage = new Map<VscMotionId, number>();
  const out: Record<string, ShotFxMotionId> = { ...motions };
  orderedShotIds.forEach((shotId, index) => {
    const motion = out[shotId];
    if (!motion || !isVscMotionId(motion)) return;
    const quota = vscRecipeQuota(motion);
    const used = usage.get(motion) ?? 0;
    if (quota !== undefined && used >= quota) {
      out[shotId] = SHOT_FX_MOTION_ROTATION[index % SHOT_FX_MOTION_ROTATION.length];
      return;
    }
    usage.set(motion, used + 1);
  });
  return out;
}

/** 关键词命中的成套配方（动作>追逐>灵光>暗涌；退场仅偶数镜启用与历史行为一致；
 * vsc 关键词(10-10 批B)排在 legacy 之后——legacy 命中永不改判(D2 存量兼容),
 * vsc 词与 legacy 词表零重叠,只接 legacy 覆盖不到的镜头语义）。 */
export function keywordShotFxMotion(
  text: string,
  clipIndex: number,
): ShotFxMotionId | undefined {
  const isAction = /爆|劈|砸|抽|撞|轰|厮杀|鞭/.test(text);
  if (isAction) return "punch-in";
  const isChase = /追|逃|奔|闯/.test(text);
  if (isChase) return "chase-in";
  const isAura = /灵|焰|火|辉|光|秘|仙|阵/.test(text);
  if (isAura) return "aura-push";
  const isDark = /阴|暗|夜|雾|影|渊/.test(text);
  if (isDark) return "gloom-pull";
  const isLeave = /退|远|离|别|消失/.test(text);
  if (isLeave && clipIndex % 2 === 0) return "leave-pull";
  // ── vsc:* 关键词兜底(10-10 批B;词表与 legacy 零重叠,确定性同级) ──
  if (/俯冲|俯瞰|扎下|俯扑/.test(text)) return "vsc:drone-dive-landing";
  if (/天旋地转|眩晕|世界崩塌|压来/.test(text)) return "vsc:dolly-zoom";
  if (/斜|倾覆|歪/.test(text)) return "vsc:dutch-roll-to-level";
  if (/纵深|景深|滑轨/.test(text)) return "vsc:parallax-glide";
  if (/蓄力|压迫|凝重|窒/.test(text)) return "vsc:slow-push-in";
  if (/孤身|孤悬|只剩|形单/.test(text)) return "vsc:pull-back-isolation";
  if (/点名|盯住|锁向/.test(text)) return "vsc:crash-zoom-punch";
  return undefined;
}

/**
 * 第二批手法的规则档位（08-19 决策层接入）：动作→残影、追逐→速度剪影、
 * 灵光→神光、动作偶数镜→帧步进。仅规则兜底路径注入；AI 显式配置 addons 时全权由 AI。
 */
export function ruleShotFxAddons(text: string, clipIndex: number): ShotFxAddonId[] {
  const addons: ShotFxAddonId[] = [];
  if (/爆|劈|砸|抽|撞|轰|厮杀|鞭/.test(text)) {
    addons.push("afterimage");
    if (clipIndex % 2 === 0) addons.push("on-twos");
  }
  if (/追|逃|奔|闯/.test(text)) addons.push("speed-silhouette");
  if (/灵|焰|火|辉|光|秘|仙|阵/.test(text)) addons.push("god-rays");
  return addons;
}

/** 无 AI 提示时的规则配方（关键词优先，未命中按镜序轮换）。AI 启发式兜底共用本函数，保证两级兜底一致。 */
export function resolveRuleShotFxMotion(text: string, clipIndex: number): ShotFxMotionId {
  return keywordShotFxMotion(text, clipIndex)
    ?? SHOT_FX_MOTION_ROTATION[clipIndex % SHOT_FX_MOTION_ROTATION.length];
}

/**
 * 转场语义桶的规则兜底（08-19 转场决策层，AI 不可用时）：
 * 情绪断裂（血祭/死亡/诀别）→ blackout、动作爆点 → impact-frame、其余不产出
 * （=硬切，交回 boundary 优先级链里更上层的分镜语义/导演计划）。
 * 断裂词优先于爆点词——血祭边界同时带动作时，窒息停顿比急闪更贴叙事。
 */
export function ruleTransitionOut(
  fromText: string,
  toText: string,
): "blackout" | "impact-frame" | undefined {
  const pair = `${fromText}\n${toText}`;
  if (/血祭|死亡|诀别|殉|葬|灭门|崩溃|断裂|永别/.test(pair)) return "blackout";
  if (/爆|劈|砸|轰|撞|雷霆|厮杀/.test(toText)) return "impact-frame";
  return undefined;
}

/** shotFx 决策产出的效果 ID 前缀（合并器据此幂等去重）。 */
const SHOT_FX_EFFECT_ID_PREFIX = "effect-shot-fx-";

/**
 * 为整章视觉片段产出镜头表现 EditingEffect[]（契约参数形状：
 * panZoom 用 scaleFrom/scaleTo/x/y；fx 用 effect-registry 的参数表）。
 * 特效来源：AI 显式插件配置（shotFx.addons，空数组=无特效）>
 * 运镜配方默认特效；同种效果取首个（互斥）。grain 为全局质感层恒常驻。
 * 依赖 plan clip 的 startUs/durationUs 提供效果时间窗（validation 要求全片段覆盖）。
 * chapterGrade 钉死时全章统一 grade（08-19 导演定调），逐镜 AI grade 被覆盖。
 */
export function buildShotFxEditingEffects(input: {
  planClips: readonly ShotFxPlanClipLike[];
  storyboards: readonly ShotFxStoryboardInput[];
  chapterGrade?: ChapterGradeOverride;
  /** 氛围层模式（08-19 multilayer Child2）："off"=全章关闭（人工覆盖）。 */
  atmosphereMode?: "ai" | "off";
}): ShotFxResult {
  const storyboardById = new Map(input.storyboards.map((storyboard) => [storyboard.id, storyboard]));
  const effects: EditingEffect[] = [];
  const counts = { motion: 0, vsc: 0, shake: 0, glow: 0, chroma: 0 };
  // vsc 章级配额(决策侧守卫;contracts 校验器 fail-closed 二闸):
  // dolly-zoom ≤1、crash-zoom ≤2(vsc-recipes quota 真源)。
  const vscUsage = new Map<VscMotionId, number>();

  let visualIndex = 0;
  for (const clip of input.planClips) {
    if (clip.trackKind !== "video" && clip.trackKind !== "image") continue;
    const storyboardId = clip.source?.evidence?.storyboardId;
    if (!storyboardId) continue;
    // 素材形态门(10-11 H3 主线分工:创作全前置,Remotion 只做装配):H3/真实视频镜
    // 零自动创作层(panZoom/vscMotion/grade/atmosphere/grain 全停,含 chapterGrade
    // 钉死分支——门在其之前短路);轮换指数不推进(节奏只服务静图产线镜序);
    // vsc 配额不消耗。人工效果不受门辖(merge 前缀纪律照旧)。
    if (isAssemblyOnlyClip(clip)) continue;
    const storyboard = storyboardById.get(storyboardId);
    const text = storyboard
      ? `${String(storyboard.prompt ?? "")}\n${String(storyboard.line ?? "")}`
      : "";
    const aiHint = storyboard?.shotFx?.motion;
    const requested = isShotFxMotionId(aiHint) ? aiHint : resolveRuleShotFxMotion(text, visualIndex);
    // 配额超额的 vsc 运镜回落镜序轮换(AI/关键词/直写数据三来源同守卫)。
    let motionId: ShotFxMotionId = requested;
    if (isVscMotionId(requested)) {
      const quota = vscRecipeQuota(requested);
      const used = vscUsage.get(requested) ?? 0;
      if (quota !== undefined && used >= quota) {
        motionId = SHOT_FX_MOTION_ROTATION[visualIndex % SHOT_FX_MOTION_ROTATION.length];
      } else {
        vscUsage.set(requested, used + 1);
      }
    }
    const recipe = SHOT_FX_MOTION_PRESETS[motionId];
    const vscCamera = recipe.vsc?.render === "component";
    const vscDepth = recipe.vsc?.render === "layeredDepth";

    const pushEffect = (
      suffix: string,
      effectId: EditingEffect["effectId"],
      params: Record<string, string | number | boolean>,
    ): void => {
      effects.push({
        id: `${SHOT_FX_EFFECT_ID_PREFIX}${suffix}-${clip.id}`,
        effectId,
        targetClipId: clip.id,
        startUs: clip.startUs,
        durationUs: clip.durationUs,
        params,
        enabled: true,
      });
    };

    // vsc camera 五卡(10-10 批B):组件整体接管渲染(D3 直写 shotFx 自动决策链)。
    // vscMotion 效果只带 recipe id(D4 参数烧死);panZoom/fx/grain/grade/atmosphere/
    // ambient 一律不叠加——配方自带完整相机处理(与 cinematic 分支同纪律,
    // 决策与渲染两侧一致,不存在"注册表说支持、渲染静默丢"的伴生特效)。
    if (vscCamera) {
      pushEffect("vsc", "vscMotion", { recipe: motionId });
      counts.vsc += 1;
      visualIndex += 1;
      continue;
    }

    pushEffect("panzoom", "panZoom", {
      scaleFrom: recipe.panZoom.fromScale,
      scaleTo: recipe.panZoom.toScale,
      x: recipe.panZoom.originX,
      y: recipe.panZoom.originY,
      // 08-21 spring 接线：配方标注才透传，未标注配方不带该键（cubic 历史行为）。
      ...(recipe.panZoom.easing ? { easing: recipe.panZoom.easing } : {}),
    });
    counts.motion += 1;

    // depth 两卡(10-10 批B):panZoom 驱动照发,vscMotion id 让投影端识别配方
    // 并把层系数(0.35/0.7/1.4 梯度+blur/降饱和锚)施加进 layerStack;
    // 无分层源的镜=驱动单图近似。伴生特效(颗粒/调色/氛围)照常(panZoom 家族)。
    if (vscDepth) {
      pushEffect("vsc", "vscMotion", { recipe: motionId });
      counts.vsc += 1;
    }

    // 颗粒全局质感常驻（独立于配方与插件）。
    pushEffect("grain", "grain", { amount: 0.035 });

    // 环境动画(2026-08-19): sin/cos 周期运动——AI 选了环境动画运镜时注入 ambient 效果
    if (recipe.ambient) {
      pushEffect("ambient", "ambient", {
        type: recipe.ambient.type,
        ampX: recipe.ambient.ampX,
        ampY: recipe.ambient.ampY,
        ampScale: recipe.ambient.ampScale,
        ampRot: recipe.ambient.ampRot,
        freq: recipe.ambient.freq,
        phase: recipe.ambient.phase,
      });
    }

    // 成片调色：chapterGrade 钉死（08-19 导演定调）全章覆盖；否则用
    // storyboard.shotFx.grade 的 AI 逐镜选择（闭集校验+blend 钳 0..1）;
    // 非法值按缺省=不调色。08-21 用户裁定：blend 完全透传配置——代码不设
    // 审美上限，压低调色由「不配 chapterGrade + AI 提示词引导 0.02~0.15」
    // 实现（store 不再钉死,决策层不得复加硬钳）。
    const pinnedGrade = input.chapterGrade;
    if (pinnedGrade && isCinematicLutId(pinnedGrade.lutId)) {
      const blendRaw = Number(pinnedGrade.blend);
      const blend = Number.isFinite(blendRaw) ? Math.min(1, Math.max(0, blendRaw)) : 0.05;
      pushEffect("grade", "grade", { lutId: pinnedGrade.lutId, blend });
    } else {
      const grade = storyboard?.shotFx?.grade as { lutId?: unknown; blend?: unknown } | undefined;
      if (grade && typeof grade.lutId === "string" && isCinematicLutId(grade.lutId)) {
        const blendRaw = Number(grade.blend ?? 0.05);
        const blend = Number.isFinite(blendRaw) ? Math.min(1, Math.max(0, blendRaw)) : 0.05;
        pushEffect("grade", "grade", { lutId: grade.lutId, blend });
      }
    }

    // 氛围层(08-19 multilayer Child2):AI 逐镜选层(storyboard.shotFx.atmosphere
    // 闭集校验+去重+上限 2)→ atmosphere 效果条目;off 模式全章关闭。
    if (input.atmosphereMode !== "off") {
      const rawAtmosphere = storyboard?.shotFx?.atmosphere;
      if (Array.isArray(rawAtmosphere)) {
        const seen = new Set<string>();
        for (const template of rawAtmosphere) {
          if (!isAtmosphereTemplateId(template) || seen.has(template)) continue;
          seen.add(template);
          if (seen.size > 2) break;
          pushEffect(`atmosphere-${template}`, "atmosphere", { template, intensity: 1 });
        }
      }
    }

    // 特效来源：AI 显式插件配置（空数组=无特效）> 配方默认；同种效果取首个（互斥）。
    type FxEntry = { effectId: "shake" | "glow" | "chromaticAberration" | "afterimage" | "speedSilhouette" | "godRays" | "onTwos" | "gradePulse"; params: Record<string, number | string> };
    const fxEntries: FxEntry[] = [];
    const rawAddons = storyboard?.shotFx?.addons;
    if (Array.isArray(rawAddons)) {
      for (const addon of rawAddons) {
        if (isShotFxAddonId(addon)) fxEntries.push(SHOT_FX_ADDON_PRESETS[addon]);
      }
    } else {
      // 规则兜底注入第二批手法(动作→残影/追逐→剪影/灵光→神光/动作偶数镜→帧步进)
      for (const addon of ruleShotFxAddons(text, visualIndex)) {
        fxEntries.push(SHOT_FX_ADDON_PRESETS[addon]);
      }
      if (recipe.fx.shakeIntensity !== undefined) {
        fxEntries.push({ effectId: "shake", params: { intensity: recipe.fx.shakeIntensity } });
      }
      if (recipe.fx.glowIntensity !== undefined) {
        fxEntries.push({ effectId: "glow", params: { intensity: recipe.fx.glowIntensity } });
      }
      if (recipe.fx.chromaOffset !== undefined) {
        fxEntries.push({ effectId: "chromaticAberration", params: { offset: recipe.fx.chromaOffset } });
      }
    }
    const fxByKind = new Map<string, FxEntry>();
    for (const entry of fxEntries) {
      if (!fxByKind.has(entry.effectId)) fxByKind.set(entry.effectId, entry);
    }
    for (const entry of fxByKind.values()) {
      const suffix = entry.effectId === "chromaticAberration" ? "chroma" : entry.effectId;
      pushEffect(suffix, entry.effectId, entry.params);
      if (entry.effectId === "shake") counts.shake += 1;
      else if (entry.effectId === "glow") counts.glow += 1;
      else if (entry.effectId === "chromaticAberration") counts.chroma += 1;
    }
    visualIndex += 1;
  }

  return { effects, counts };
}

/**
 * 将 shotFx 配方效果并入 plan.effects（幂等）：
 * 旧 run 的 shotFx 效果（ID 前缀识别）与同 effectId+targetClipId 的既有条目
 * （如 auto-editing 的均匀 panZoom）被本轮决策替换；其余人工效果保留。
 */
export function mergeShotFxEditingEffects(
  existingEffects: readonly EditingEffect[],
  input: {
    planClips: readonly ShotFxPlanClipLike[];
    storyboards: readonly ShotFxStoryboardInput[];
    chapterGrade?: ChapterGradeOverride;
    atmosphereMode?: "ai" | "off";
  },
): ShotFxResult {
  const built = buildShotFxEditingEffects(input);
  const replacedKeys = new Set(
    built.effects.map((effect) => `${effect.effectId}:${effect.targetClipId}`),
  );
  const kept = existingEffects.filter((effect) => {
    if (effect.id.startsWith(SHOT_FX_EFFECT_ID_PREFIX)) return false;
    if (effect.targetClipId && replacedKeys.has(`${effect.effectId}:${effect.targetClipId}`)) {
      return false;
    }
    return true;
  });
  const effects = [...kept, ...built.effects].sort(
    (left, right) => left.startUs - right.startUs || left.id.localeCompare(right.id),
  );
  return { effects, counts: built.counts };
}
