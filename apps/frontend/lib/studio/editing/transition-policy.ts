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
      return { curve: "linear" };
    case "flash":
      return { intensity: 0.8 };
    case "blackout":
      return { hold: 0.15 };
    case "cut":
      return {};
  }
}
