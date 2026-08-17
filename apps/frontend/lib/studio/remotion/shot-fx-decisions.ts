// 2D 镜头语言 + 镜头特效决策（共享单源）：CLI 全管线与 App 一键成片共用，
// 保证两条入口产出一致。
// 运镜优先级：分镜记录上的 AI 选择（shotFx.motion，由 shot-fx-ai 写入）>
// 动作/退场关键词命中 > 镜序轮换 7 模式保证节奏变化。
// 锐度纪律：源图已上采样到合成分辨率，panZoom 再放大即二次软化——
// 常规镜缩放上限 1.08，动作 punch 上限 1.12，颗粒 0.035。
// AI 只选模式 ID，参数一律取本表常量，缩放纪律不可能被 AI 破坏。

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

export interface ShotFxDecision {
  panZoom: ShotFxPanZoom;
  fx: Record<string, unknown>;
}

export interface ShotFxPlanClipLike {
  id: string;
  trackKind: string;
  source?: { evidence?: { storyboardId?: string } };
}

export interface ShotFxVisualClipLike {
  clipId: string;
}

export interface ShotFxResult {
  byClipId: Map<string, ShotFxDecision>;
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

export function buildShotFxByClipId(input: {
  planClips: readonly ShotFxPlanClipLike[];
  visualClips: readonly ShotFxVisualClipLike[];
  storyboards: readonly ShotFxStoryboardInput[];
}): ShotFxResult {
  const storyboardById = new Map(input.storyboards.map((storyboard) => [storyboard.id, storyboard]));
  const planClipByClipId = new Map(input.planClips.map((clip) => [clip.id, clip]));
  const byClipId = new Map<string, ShotFxDecision>();
  const counts = { motion: 0, shake: 0, glow: 0, chroma: 0 };

  input.visualClips.forEach((clip, clipIndex) => {
    const storyboardId = planClipByClipId.get(clip.clipId)?.source?.evidence?.storyboardId;
    if (!storyboardId) return;
    const storyboard = storyboardById.get(storyboardId);
    const text = storyboard
      ? `${String(storyboard.prompt ?? "")}\n${String(storyboard.line ?? "")}`
      : "";
    const isAction = /爆|劈|砸|抽|撞|轰|厮杀|鞭/.test(text);
    const isChase = /追|逃|奔|闯/.test(text);
    const isAura = /灵|焰|火|辉|光|秘|仙|阵/.test(text);
    const isDark = /阴|暗|夜|雾|影|渊/.test(text);
    const aiHint = storyboard?.shotFx?.motion;
    const motionId = isShotFxMotionId(aiHint) ? aiHint : resolveRuleShotFxMotion(text, clipIndex);
    const motion = SHOT_FX_MOTION_PRESETS[motionId];
    const fx: Record<string, unknown> = { grain: { opacity: 0.035 } };
    if (isAction || isChase) {
      fx.shake = { amplitudePx: isAction ? 6 : 3 };
      counts.shake += 1;
    }
    if (isAction) {
      fx.chroma = { offsetPx: 3 };
      counts.chroma += 1;
    }
    if (isAura) {
      fx.glow = { intensity: 0.5 };
      counts.glow += 1;
    } else if (isDark) {
      fx.glow = { intensity: 0.25 };
      counts.glow += 1;
    }
    byClipId.set(clip.clipId, { panZoom: motion, fx });
    counts.motion += 1;
  });

  return { byClipId, counts };
}
