// 2D 镜头语言 + 镜头特效决策（共享单源）：CLI 全管线与 App 一键成片共用，
// 保证两条入口产出一致。
// 规则：动作/氛围关键词命中优先；未命中按镜序轮换 7 模式保证节奏变化。
// 锐度纪律：源图已上采样到合成分辨率，panZoom 再放大即二次软化——
// 常规镜缩放上限 1.08，动作 punch 上限 1.12，颗粒 0.035。

export interface ShotFxStoryboardInput {
  id: string;
  prompt?: string;
  line?: string;
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

const MOTION_ROTATION: readonly ShotFxPanZoom[] = [
  { fromScale: 1.0, toScale: 1.05, originX: 0.5, originY: 0.5 },   // 推近
  { fromScale: 1.07, toScale: 1.0, originX: 0.5, originY: 0.5 },  // 拉远
  { fromScale: 1.03, toScale: 1.08, originX: 0.72, originY: 0.5 },// 右移
  { fromScale: 1.03, toScale: 1.08, originX: 0.28, originY: 0.5 },// 左移
  { fromScale: 1.02, toScale: 1.07, originX: 0.5, originY: 0.68 },// 下摇
  { fromScale: 1.02, toScale: 1.07, originX: 0.5, originY: 0.32 },// 上摇
  { fromScale: 1.01, toScale: 1.04, originX: 0.5, originY: 0.5 }, // 漂浮
];

const PUNCH_MOTION: ShotFxPanZoom = { fromScale: 1.0, toScale: 1.12, originX: 0.5, originY: 0.5 };
const PULL_MOTION: ShotFxPanZoom = { fromScale: 1.07, toScale: 1.0, originX: 0.5, originY: 0.5 };

export function buildShotFxByClipId(input: {
  planClips: readonly ShotFxPlanClipLike[];
  visualClips: readonly ShotFxVisualClipLike[];
  storyboards: readonly ShotFxStoryboardInput[];
}): ShotFxResult {
  const textByShotId = new Map(
    input.storyboards.map((storyboard) => [storyboard.id, `${String(storyboard.prompt ?? "")}\n${String(storyboard.line ?? "")}`]),
  );
  const planClipByClipId = new Map(input.planClips.map((clip) => [clip.id, clip]));
  const byClipId = new Map<string, ShotFxDecision>();
  const counts = { motion: 0, shake: 0, glow: 0, chroma: 0 };

  input.visualClips.forEach((clip, clipIndex) => {
    const storyboardId = planClipByClipId.get(clip.clipId)?.source?.evidence?.storyboardId;
    if (!storyboardId) return;
    const text = textByShotId.get(storyboardId) ?? "";
    const isAction = /爆|劈|砸|抽|撞|轰|厮杀|鞭/.test(text);
    const isChase = /追|逃|奔|闯/.test(text);
    const isAura = /灵|焰|火|辉|光|秘|仙|阵/.test(text);
    const isDark = /阴|暗|夜|雾|影|渊/.test(text);
    const isLeave = /退|远|离|别|消失/.test(text);
    let motion = MOTION_ROTATION[clipIndex % MOTION_ROTATION.length];
    if (isAction) motion = PUNCH_MOTION;
    else if (isLeave && clipIndex % 2 === 0) motion = PULL_MOTION;
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
