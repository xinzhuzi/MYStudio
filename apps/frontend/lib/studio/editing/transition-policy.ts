import type {
  EditingClip,
  EditingTransition,
} from "@/types/editing";

export function explicitTransitionEffect(
  hint: string | undefined,
): EditingTransition["effectId"] | null {
  if (!hint) return null;
  if (/黑场/.test(hint)) return "blackout";
  if (/闪白/.test(hint)) return "flash";
  if (/叠化|交叉淡化|cross\s*fade/i.test(hint)) return "crossfade";
  if (/淡入|淡出|\bfade\b/i.test(hint)) return "fade";
  return null;
}

/**
 * Styled transition vocabulary from the director plan's structured ⑥ section.
 * Each style word deterministically maps to one of the five built-in
 * transition effects; the mapping lives here (single source) so the app
 * auto-editing path and the video-use chapter path share one semantic table.
 * "同场景硬切" intentionally has no entry — same-scene boundaries stay hard
 * cuts and must not produce a transition record at all.
 */
export interface StyleWordTransition {
  styleWord: string;
  effectId: Exclude<EditingTransition["effectId"], "cut">;
  durationUs: number;
}

const STYLE_WORD_TRANSITIONS: ReadonlyArray<{ match: RegExp } & StyleWordTransition> = [
  // gl:* 升级（08-18-gl-transitions Step C）：只升级语义高度贴合的词，其余保留已验证基线；
  // gl: id 必须来自 gl-transition-registry 白名单（孪生测试守护，fail-closed 拒未知值）。
  { match: /水墨晕染/, styleWord: "水墨晕染", effectId: "gl:swap", durationUs: 1_000_000 },
  { match: /灵气色彩/, styleWord: "灵气色彩", effectId: "crossfade", durationUs: 800_000 },
  { match: /境界跃迁/, styleWord: "境界跃迁", effectId: "gl:CrossZoom", durationUs: 500_000 },
  { match: /四季流转/, styleWord: "四季流转", effectId: "fade", durationUs: 800_000 },
  { match: /剑痕/, styleWord: "剑痕", effectId: "flash", durationUs: 300_000 },
  { match: /血祭/, styleWord: "血祭", effectId: "blackout", durationUs: 800_000 },
  { match: /梦境|前世/, styleWord: "梦境", effectId: "gl:ButterflyWaveScrawler", durationUs: 1_000_000 },
  { match: /空镜呼吸/, styleWord: "空镜呼吸", effectId: "fade", durationUs: 1_000_000 },
];

export const SAME_SCENE_STYLE_WORD = "同场景硬切";

/**
 * 转场语义桶（08-19 转场决策层）：AI 在约 10 个量化档位里选，不直接面对
 * 124 种 GL 转场。每桶映射一个具体 effectId（全部来自既有闭集，三镜像零改动）
 * + 默认时长；消费端经 clampTransitionDurationUs 对相邻镜钳制。
 * "cut" 不设桶条目——硬切=无 intent 记录（与既有边界语义一致）。
 */
export type TransitionSemanticBucketId =
  | "fade"
  | "crossfade"
  | "blackout"
  | "impact-frame"
  | "ink-bleed"
  | "flash"
  | "dream-warp"
  | "zoom-warp"
  | "wind-sweep"
  | "burn";

export interface TransitionSemanticBucket {
  id: TransitionSemanticBucketId;
  effectId: Exclude<EditingTransition["effectId"], "cut">;
  durationUs: number;
  /** AI 指南用语（何时选这桶）。 */
  when: string;
}

export const TRANSITION_SEMANTIC_BUCKETS: readonly TransitionSemanticBucket[] = [
  { id: "fade", effectId: "fade", durationUs: 800_000, when: "时间流逝、段落收束、舒缓空镜衔接" },
  { id: "crossfade", effectId: "crossfade", durationUs: 800_000, when: "情绪延续的柔和换场、灵气流转、同场景缓切" },
  { id: "blackout", effectId: "blackout", durationUs: 800_000, when: "血祭/死亡/诀别、情绪断裂、重大转折的窒息停顿" },
  { id: "impact-frame", effectId: "impact-frame", durationUs: 300_000, when: "动作爆点、雷霆一击、高潮瞬间" },
  { id: "ink-bleed", effectId: "ink-bleed", durationUs: 1_000_000, when: "水墨意境、时空转换、回忆涌现（稀缺使用）" },
  { id: "flash", effectId: "flash", durationUs: 300_000, when: "闪白惊变、剑光乍现、瞬间震撼" },
  { id: "dream-warp", effectId: "gl:ButterflyWaveScrawler", durationUs: 1_000_000, when: "入梦/前世/恍惚出神（稀缺使用）" },
  { id: "zoom-warp", effectId: "gl:CrossZoom", durationUs: 500_000, when: "境界跃迁、速度爆发、时空穿梭" },
  { id: "wind-sweep", effectId: "gl:wind", durationUs: 700_000, when: "风起云涌、场景横移、气势扫过" },
  { id: "burn", effectId: "gl:FilmBurn", durationUs: 600_000, when: "劫火焚天、烈焰吞噬、灼热转场" },
];

const TRANSITION_BUCKET_BY_ID: ReadonlyMap<string, TransitionSemanticBucket> = new Map(
  TRANSITION_SEMANTIC_BUCKETS.map((bucket) => [bucket.id, bucket]),
);

export function isTransitionSemanticBucketId(value: unknown): value is TransitionSemanticBucketId {
  return typeof value === "string" && TRANSITION_BUCKET_BY_ID.has(value);
}

/** 桶 id → 具体转场（effectId + 默认时长）；未知桶返回 null（fail-closed 落硬切）。 */
export function semanticBucketTransition(
  bucketId: string,
): (TransitionSemanticBucket & { styleWord: string }) | null {
  const bucket = TRANSITION_BUCKET_BY_ID.get(bucketId);
  return bucket ? { ...bucket, styleWord: bucket.id } : null;
}

export function styleWordTransition(styleWord: string | undefined): StyleWordTransition | null {
  if (!styleWord?.trim()) return null;
  const entry = STYLE_WORD_TRANSITIONS.find((candidate) => candidate.match.test(styleWord));
  if (!entry) return null;
  const { match: _match, ...transition } = entry;
  return transition;
}

/** Clamp a transition duration against both neighboring shot lengths.
 * Bounds: 200ms minimum, min(neighbor/2, 800ms) maximum — a transition must
 * never outlive half of its shortest neighbor. */
export function clampTransitionDurationUs(
  requestedUs: number,
  neighborDurationUs: ReadonlyArray<number>,
): number {
  const MIN_TRANSITION_US = 200_000;
  const MAX_TRANSITION_US = 1_200_000;
  const neighborCeil = neighborDurationUs.length > 0
    ? Math.min(...neighborDurationUs.map((duration) => Math.floor(duration / 2)))
    : MAX_TRANSITION_US;
  const ceiling = Math.min(MAX_TRANSITION_US, Math.max(0, neighborCeil));
  return Math.min(Math.max(requestedUs, MIN_TRANSITION_US), Math.max(MIN_TRANSITION_US, ceiling));
}

export function explicitTransitionDuration(
  from: Pick<EditingClip, "durationUs">,
  to: Pick<EditingClip, "durationUs">,
  preset: { maxTransitionUs: number; maxTransitionRatio: number },
) {
  const ratioDuration = Math.floor(
    Math.min(from.durationUs, to.durationUs) * preset.maxTransitionRatio,
  );
  if (ratioDuration < 1) return 0;
  return Math.min(preset.maxTransitionUs, ratioDuration);
}

export function transitionParams(
  effectId: EditingTransition["effectId"],
): EditingTransition["params"] {
  switch (effectId) {
    case "fade":
      return { opacity: 1 };
    case "crossfade":
      return { curve: "ease-in-out" };
    case "flash":
      return { intensity: 0.55 };
    case "blackout":
      return { hold: 0.15 };
    case "cut":
      return {};
    default:
      // gl:*：shader 私有参数走 registry defaultUniforms，params 层保持空。
      return {};
  }
}
