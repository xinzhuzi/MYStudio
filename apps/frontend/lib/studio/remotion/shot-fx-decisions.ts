// 2D 镜头语言 + 镜头特效决策（共享单源）：CLI 全管线与 App 一键成片共用，
// 保证两条入口产出一致。
// 产出契约形状的 EditingEffect[]（panZoom/shake/glow/grain/chromaticAberration），
// 经 plan.effects 正门进入合成（build-composition-props 消费），章节渲染身份哈希
// 含 plan.effects → 运镜变化自动触发缓存失效。不再做渲染时直注。
// 运镜优先级：分镜记录上的 AI 选择（shotFx.motion，由 shot-fx-ai 写入）>
// 动作/退场关键词命中 > 镜序轮换 7 模式保证节奏变化。
// 锐度纪律：源图已上采样到合成分辨率，panZoom 再放大即二次软化——
// 常规镜缩放上限 1.08，动作 punch 上限 1.12，颗粒 0.035。
// AI 只选模式 ID，参数一律取本表常量，缩放纪律不可能被 AI 破坏。

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
  | "leave-pull";

/** 各运镜模式的 panZoom 参数（唯一权威来源，含缩放纪律上限）。 */
export const SHOT_FX_MOTION_PRESETS: Readonly<Record<ShotFxMotionId, ShotFxPanZoom>> = {
  "push-in": { fromScale: 1.0, toScale: 1.05, originX: 0.5, originY: 0.5 },
  "pull-out": { fromScale: 1.07, toScale: 1.0, originX: 0.5, originY: 0.5 },
  "pan-right": { fromScale: 1.03, toScale: 1.08, originX: 0.72, originY: 0.5 },
  "pan-left": { fromScale: 1.03, toScale: 1.08, originX: 0.28, originY: 0.5 },
  "tilt-down": { fromScale: 1.02, toScale: 1.07, originX: 0.5, originY: 0.68 },
  "tilt-up": { fromScale: 1.02, toScale: 1.07, originX: 0.5, originY: 0.32 },
  drift: { fromScale: 1.01, toScale: 1.04, originX: 0.5, originY: 0.5 },
  "punch-in": { fromScale: 1.0, toScale: 1.12, originX: 0.5, originY: 0.5 },
  "leave-pull": { fromScale: 1.07, toScale: 1.0, originX: 0.5, originY: 0.5 },
};

/** 无关键词命中时的镜序轮换（节奏变化用）。 */
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

export interface ShotFxPanZoom {
  fromScale: number;
  toScale: number;
  originX: number;
  originY: number;
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

/** 关键词命中的运镜（动作→punch；退场→pull，仅偶数镜启用与历史行为一致）。 */
export function keywordShotFxMotion(text: string): "punch-in" | "leave-pull" | undefined {
  const isAction = /爆|劈|砸|抽|撞|轰|厮杀|鞭/.test(text);
  if (isAction) return "punch-in";
  const isLeave = /退|远|离|别|消失/.test(text);
  if (isLeave) return "leave-pull";
  return undefined;
}

/** 无 AI 提示时的规则运镜（关键词优先，未命中按镜序轮换）。AI 启发式兜底共用本函数，保证两级兜底一致。 */
export function resolveRuleShotFxMotion(text: string, clipIndex: number): ShotFxMotionId {
  const keyword = keywordShotFxMotion(text);
  if (keyword === "punch-in") return keyword;
  if (keyword === "leave-pull" && clipIndex % 2 === 0) return keyword;
  return SHOT_FX_MOTION_ROTATION[clipIndex % SHOT_FX_MOTION_ROTATION.length];
}

/** shotFx 决策产出的效果 ID 前缀（合并器据此幂等去重）。 */
const SHOT_FX_EFFECT_ID_PREFIX = "effect-shot-fx-";

/**
 * 为整章视觉片段产出 2D 运镜 + 特效 EditingEffect[]（契约参数形状：
 * panZoom 用 scaleFrom/scaleTo/x/y；fx 用 effect-registry 的参数表）。
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
    const isAction = /爆|劈|砸|抽|撞|轰|厮杀|鞭/.test(text);
    const isChase = /追|逃|奔|闯/.test(text);
    const isAura = /灵|焰|火|辉|光|秘|仙|阵/.test(text);
    const isDark = /阴|暗|夜|雾|影|渊/.test(text);
    const aiHint = storyboard?.shotFx?.motion;
    const motionId = isShotFxMotionId(aiHint) ? aiHint : resolveRuleShotFxMotion(text, visualIndex);
    const panZoom = SHOT_FX_MOTION_PRESETS[motionId];

    effects.push({
      id: `${SHOT_FX_EFFECT_ID_PREFIX}panzoom-${clip.id}`,
      effectId: "panZoom",
      targetClipId: clip.id,
      startUs: clip.startUs,
      durationUs: clip.durationUs,
      params: {
        scaleFrom: panZoom.fromScale,
        scaleTo: panZoom.toScale,
        x: panZoom.originX,
        y: panZoom.originY,
      },
      enabled: true,
    });
    counts.motion += 1;

    // 颗粒全局质感常驻；shake/chroma/glow 按氛围词（与历史直注行为一致）。
    effects.push({
      id: `${SHOT_FX_EFFECT_ID_PREFIX}grain-${clip.id}`,
      effectId: "grain",
      targetClipId: clip.id,
      startUs: clip.startUs,
      durationUs: clip.durationUs,
      params: { amount: 0.035 },
      enabled: true,
    });
    if (isAction || isChase) {
      effects.push({
        id: `${SHOT_FX_EFFECT_ID_PREFIX}shake-${clip.id}`,
        effectId: "shake",
        targetClipId: clip.id,
        startUs: clip.startUs,
        durationUs: clip.durationUs,
        // registry intensity 0..1；0.25→amplitudePx 6（明显）、0.125→3（轻微）
        params: { intensity: isAction ? 0.25 : 0.125 },
        enabled: true,
      });
      counts.shake += 1;
    }
    if (isAction) {
      effects.push({
        id: `${SHOT_FX_EFFECT_ID_PREFIX}chroma-${clip.id}`,
        effectId: "chromaticAberration",
        targetClipId: clip.id,
        startUs: clip.startUs,
        durationUs: clip.durationUs,
        params: { offset: 3 },
        enabled: true,
      });
      counts.chroma += 1;
    }
    if (isAura || isDark) {
      effects.push({
        id: `${SHOT_FX_EFFECT_ID_PREFIX}glow-${clip.id}`,
        effectId: "glow",
        targetClipId: clip.id,
        startUs: clip.startUs,
        durationUs: clip.durationUs,
        params: { intensity: isAura ? 0.5 : 0.25 },
        enabled: true,
      });
      counts.glow += 1;
    }
    visualIndex += 1;
  }

  return { effects, counts };
}

/**
 * 将 shotFx 决策效果并入 plan.effects（幂等）：
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
