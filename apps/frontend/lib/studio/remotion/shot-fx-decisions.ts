// 2D 镜头表现（共享单源）：CLI 全管线与 App 一键成片共用，
// 保证两条入口产出一致。
// 模型 = 运镜(13) × 特效插件(可组合)：AI 每镜选 1 个运镜 + 0~2 个量化特效
// 插件（自由组合防观看疲劳、成套风格）；未显式配置特效时按运镜配方的
// 默认特效兜底。特效插件强度内置（registry 数值域），不可越界配置。
// 产出契约形状的 EditingEffect[]（panZoom/shake/glow/grain/chromaticAberration），
// 经 plan.effects 正门进入合成（build-composition-props 消费），章节渲染身份哈希
// 含 plan.effects → 镜头表现变化自动触发缓存失效。不再做渲染时直注。
// 优先级：分镜记录上的 AI 选择（shotFx.motion + shotFx.addons）>
// 关键词命中（映射到成套配方）> 镜序轮换 7 基础运镜。
// 锐度纪律：源图已上采样到合成分辨率，panZoom 再放大即二次软化——
// 常规镜缩放上限 1.08，动作 punch 上限 1.12，颗粒 0.035。

import { isCinematicLutId } from "./cinematic-luts";
import type { EditingEffect } from "@/types/editing";

export type ShotFxMotionId =
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

export interface ShotFxRecipe {
  panZoom: ShotFxPanZoom;
  fx: ShotFxRecipeFx;
  /** 环境动画(叠加在 panZoom 之上的周期运动;null=无) */
  ambient: ShotFxAmbient | null;
}

/**
 * 镜头表现配方表（唯一权威来源，含缩放纪律上限）。
 * 前七项为无特效基础运镜（轮换用）；后六项为带默认特效的成套配方
 * （未显式配置特效插件时的兜底）；hold 为锁帧节奏对比（仅 AI 可选）。
 */
export const SHOT_FX_MOTION_PRESETS: Readonly<Record<ShotFxMotionId, ShotFxRecipe>> = {
  "push-in": {
    panZoom: { fromScale: 1.0, toScale: 1.05, originX: 0.5, originY: 0.5 },
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
    fx: { shakeIntensity: 0.25, chromaOffset: 3 },
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
  shotFx?: { motion?: unknown; addons?: unknown; grade?: unknown; source?: unknown };
}

export interface ShotFxPlanClipLike {
  id: string;
  trackKind: string;
  startUs: number;
  durationUs: number;
  source?: { evidence?: { storyboardId?: string } };
}

export interface ShotFxResult {
  effects: EditingEffect[];
  counts: { motion: number; shake: number; glow: number; chroma: number };
}

/** 关键词命中的成套配方（动作>追逐>灵光>暗涌；退场仅偶数镜启用与历史行为一致）。 */
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
 */
export function buildShotFxEditingEffects(input: {
  planClips: readonly ShotFxPlanClipLike[];
  storyboards: readonly ShotFxStoryboardInput[];
}): ShotFxResult {
  const storyboardById = new Map(input.storyboards.map((storyboard) => [storyboard.id, storyboard]));
  const effects: EditingEffect[] = [];
  const counts = { motion: 0, shake: 0, glow: 0, chroma: 0 };

  let visualIndex = 0;
  for (const clip of input.planClips) {
    if (clip.trackKind !== "video" && clip.trackKind !== "image") continue;
    const storyboardId = clip.source?.evidence?.storyboardId;
    if (!storyboardId) continue;
    const storyboard = storyboardById.get(storyboardId);
    const text = storyboard
      ? `${String(storyboard.prompt ?? "")}\n${String(storyboard.line ?? "")}`
      : "";
    const aiHint = storyboard?.shotFx?.motion;
    const motionId = isShotFxMotionId(aiHint) ? aiHint : resolveRuleShotFxMotion(text, visualIndex);
    const recipe = SHOT_FX_MOTION_PRESETS[motionId];

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

    pushEffect("panzoom", "panZoom", {
      scaleFrom: recipe.panZoom.fromScale,
      scaleTo: recipe.panZoom.toScale,
      x: recipe.panZoom.originX,
      y: recipe.panZoom.originY,
    });
    counts.motion += 1;

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

    // 成片调色（08-18-haldclut-grade AI 选型）：storyboard.shotFx.grade 携带
    // AI 逐镜选择的 LUT（闭集校验+blend 钳 0..1）；非法值按缺省=不调色。
    const grade = storyboard?.shotFx?.grade as { lutId?: unknown; blend?: unknown } | undefined;
    if (grade && typeof grade.lutId === "string" && isCinematicLutId(grade.lutId)) {
      const blendRaw = Number(grade.blend ?? 1);
      const blend = Number.isFinite(blendRaw) ? Math.min(1, Math.max(0, blendRaw)) : 1;
      pushEffect("grade", "grade", { lutId: grade.lutId, blend });
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
