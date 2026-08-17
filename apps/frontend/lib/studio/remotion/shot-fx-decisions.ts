// 2D 镜头表现配方（共享单源）：CLI 全管线与 App 一键成片共用，
// 保证两条入口产出一致。
// 配方 = 运镜 + 特效成套（motion 与 fx 是一体的镜头表达，AI 整套选择，
// 不做独立叠加——避免「AI 选漂浮、关键词强叠爆点抖动」的不连贯组合）。
// 产出契约形状的 EditingEffect[]（panZoom/shake/glow/grain/chromaticAberration），
// 经 plan.effects 正门进入合成（build-composition-props 消费），章节渲染身份哈希
// 含 plan.effects → 运镜变化自动触发缓存失效。不再做渲染时直注。
// 优先级：分镜记录上的 AI 选择（shotFx.motion，由 shot-fx-ai 写入）>
// 关键词命中（映射到成套配方）> 镜序轮换 7 基础运镜。
// 锐度纪律：源图已上采样到合成分辨率，panZoom 再放大即二次软化——
// 常规镜缩放上限 1.08，动作 punch 上限 1.12，颗粒 0.035。
// AI 只选配方 ID，参数一律取本表常量，缩放纪律不可能被 AI 破坏。

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
  | "gloom-pull";

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

export interface ShotFxRecipe {
  panZoom: ShotFxPanZoom;
  fx: ShotFxRecipeFx;
}

/**
 * 镜头表现配方表（唯一权威来源，含缩放纪律上限）。
 * 前七项为无特效基础运镜（轮换用）；后五项为运镜+特效成套配方。
 */
export const SHOT_FX_MOTION_PRESETS: Readonly<Record<ShotFxMotionId, ShotFxRecipe>> = {
  "push-in": {
    panZoom: { fromScale: 1.0, toScale: 1.05, originX: 0.5, originY: 0.5 },
    fx: {},
  },
  "pull-out": {
    panZoom: { fromScale: 1.07, toScale: 1.0, originX: 0.5, originY: 0.5 },
    fx: {},
  },
  "pan-right": {
    panZoom: { fromScale: 1.03, toScale: 1.08, originX: 0.72, originY: 0.5 },
    fx: {},
  },
  "pan-left": {
    panZoom: { fromScale: 1.03, toScale: 1.08, originX: 0.28, originY: 0.5 },
    fx: {},
  },
  "tilt-down": {
    panZoom: { fromScale: 1.02, toScale: 1.07, originX: 0.5, originY: 0.68 },
    fx: {},
  },
  "tilt-up": {
    panZoom: { fromScale: 1.02, toScale: 1.07, originX: 0.5, originY: 0.32 },
    fx: {},
  },
  drift: {
    panZoom: { fromScale: 1.01, toScale: 1.04, originX: 0.5, originY: 0.5 },
    fx: {},
  },
  // 动作爆点：急推 + 明显抖动（6px）+ RGB 色差分离
  "punch-in": {
    panZoom: { fromScale: 1.0, toScale: 1.12, originX: 0.5, originY: 0.5 },
    fx: { shakeIntensity: 0.25, chromaOffset: 3 },
  },
  // 退场收尾：拉远离席，纯净无特效
  "leave-pull": {
    panZoom: { fromScale: 1.07, toScale: 1.0, originX: 0.5, originY: 0.5 },
    fx: {},
  },
  // 追逐/奔逃：快推（贴上限）+ 轻微抖动（3px）
  "chase-in": {
    panZoom: { fromScale: 1.0, toScale: 1.08, originX: 0.5, originY: 0.5 },
    fx: { shakeIntensity: 0.125 },
  },
  // 灵光/焰火/仙阵：缓推 + 暖调强辉光
  "aura-push": {
    panZoom: { fromScale: 1.0, toScale: 1.05, originX: 0.5, originY: 0.5 },
    fx: { glowIntensity: 0.5 },
  },
  // 阴暗/夜雾/深渊：缓拉 + 暗调弱辉光
  "gloom-pull": {
    panZoom: { fromScale: 1.07, toScale: 1.0, originX: 0.5, originY: 0.5 },
    fx: { glowIntensity: 0.25 },
  },
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

export interface ShotFxStoryboardInput {
  id: string;
  prompt?: string;
  line?: string;
  /** AI 运镜选择结果（装饰层，不进 sourceFingerprint）；非法值按无提示处理。 */
  shotFx?: { motion?: unknown; source?: unknown };
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

/** 无 AI 提示时的规则配方（关键词优先，未命中按镜序轮换）。AI 启发式兜底共用本函数，保证两级兜底一致。 */
export function resolveRuleShotFxMotion(text: string, clipIndex: number): ShotFxMotionId {
  return keywordShotFxMotion(text, clipIndex)
    ?? SHOT_FX_MOTION_ROTATION[clipIndex % SHOT_FX_MOTION_ROTATION.length];
}

/** shotFx 决策产出的效果 ID 前缀（合并器据此幂等去重）。 */
const SHOT_FX_EFFECT_ID_PREFIX = "effect-shot-fx-";

/**
 * 为整章视觉片段产出镜头表现配方 EditingEffect[]（契约参数形状：
 * panZoom 用 scaleFrom/scaleTo/x/y；fx 用 effect-registry 的参数表）。
 * 特效随配方成套产出（不独立叠加）；grain 为全局质感层恒常驻。
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

    // 颗粒全局质感常驻（独立于配方）。
    pushEffect("grain", "grain", { amount: 0.035 });

    if (recipe.fx.shakeIntensity !== undefined) {
      pushEffect("shake", "shake", { intensity: recipe.fx.shakeIntensity });
      counts.shake += 1;
    }
    if (recipe.fx.chromaOffset !== undefined) {
      pushEffect("chroma", "chromaticAberration", { offset: recipe.fx.chromaOffset });
      counts.chroma += 1;
    }
    if (recipe.fx.glowIntensity !== undefined) {
      pushEffect("glow", "glow", { intensity: recipe.fx.glowIntensity });
      counts.glow += 1;
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
