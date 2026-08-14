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
  { match: /水墨晕染/, styleWord: "水墨晕染", effectId: "crossfade", durationUs: 1_000_000 },
  { match: /灵气色彩/, styleWord: "灵气色彩", effectId: "crossfade", durationUs: 800_000 },
  { match: /境界跃迁/, styleWord: "境界跃迁", effectId: "flash", durationUs: 500_000 },
  { match: /四季流转/, styleWord: "四季流转", effectId: "fade", durationUs: 800_000 },
  { match: /剑痕/, styleWord: "剑痕", effectId: "flash", durationUs: 300_000 },
  { match: /血祭/, styleWord: "血祭", effectId: "blackout", durationUs: 800_000 },
  { match: /梦境|前世/, styleWord: "梦境", effectId: "fade", durationUs: 1_000_000 },
  { match: /空镜呼吸/, styleWord: "空镜呼吸", effectId: "fade", durationUs: 1_000_000 },
];

export const SAME_SCENE_STYLE_WORD = "同场景硬切";

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
  }
}
