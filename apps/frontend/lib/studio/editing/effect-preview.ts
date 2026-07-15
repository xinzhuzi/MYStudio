import type {
  EditingEffect,
  EditingPreviewSupport,
  EditingProjectV1,
} from "@/types/editing";
import { getEditingEffectDefinition } from "./effect-registry";

export interface EditingEffectPreviewModel {
  effects: Array<EditingEffect & { preview: EditingPreviewSupport }>;
  capability: EditingPreviewSupport;
  filter?: string;
  transform?: string;
  transformOrigin?: string;
  playbackRate: number;
  notice: string;
}

export function buildEditingEffectPreview(
  project: EditingProjectV1,
  clipId: string,
): EditingEffectPreviewModel {
  const clip = project.clips.find((item) => item.id === clipId);
  const effects = project.effects
    .filter((effect) => effect.enabled && effect.targetClipId === clipId)
    .sort((left, right) => left.startUs - right.startUs || left.id.localeCompare(right.id))
    .map((effect) => ({
      ...effect,
      preview: getEditingEffectDefinition(effect.effectId)?.preview ?? "final-only",
    }));
  const filters: string[] = [];
  const transforms: string[] = [];
  let transformOrigin: string | undefined;
  let playbackRate = clip?.speed ?? 1;

  for (const effect of effects) {
    if (effect.effectId === "blur") {
      filters.push(`blur(${numberParam(effect.params.radius, 4)}px)`);
    } else if (effect.effectId === "glow") {
      const intensity = numberParam(effect.params.intensity, 0.4);
      filters.push(`brightness(${decimal(1 + intensity * 0.2)})`, `saturate(${decimal(1 + intensity * 0.5)})`);
    } else if (effect.effectId === "glitch") {
      const intensity = numberParam(effect.params.intensity, 0.35);
      filters.push(`contrast(${decimal(1 + intensity * 0.3)})`, `saturate(${decimal(1 + intensity)})`);
    } else if (effect.effectId === "chromaticAberration") {
      const offset = numberParam(effect.params.offset, 3);
      filters.push(`hue-rotate(${decimal(offset * 2)}deg)`, "saturate(1.12)");
    } else if (effect.effectId === "grain") {
      const amount = numberParam(effect.params.amount, 0.12);
      filters.push(`contrast(${decimal(1 + amount * 0.2)})`);
    } else if (effect.effectId === "panZoom") {
      transforms.push(`scale(${decimal(numberParam(effect.params.scaleTo, 1.06))})`);
      transformOrigin = `${decimal(numberParam(effect.params.x, 0.5) * 100)}% ${decimal(numberParam(effect.params.y, 0.5) * 100)}%`;
    } else if (effect.effectId === "shake") {
      const intensity = numberParam(effect.params.intensity, 0.25);
      transforms.push(`translate(${decimal(intensity * 4)}px, ${decimal(intensity * -3)}px)`);
    } else if (effect.effectId === "speed") {
      playbackRate *= numberParam(effect.params.rate, 1);
    }
  }

  const capability = effects.some((effect) => effect.preview === "final-only")
    ? "final-only"
    : effects.some((effect) => effect.preview === "approximate")
      ? "approximate"
      : "full";
  return {
    effects,
    capability,
    ...(filters.length ? { filter: filters.join(" ") } : {}),
    ...(transforms.length ? { transform: transforms.join(" ") } : {}),
    ...(transformOrigin ? { transformOrigin } : {}),
    playbackRate,
    notice: capability === "full"
      ? "浏览器完整预览"
      : capability === "approximate"
        ? "近似预览，最终效果以 FFmpeg 成片为准"
        : "仅最终成片可见，以 FFmpeg 成片为准",
  };
}

function numberParam(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function decimal(value: number) {
  return Number(value.toFixed(4)).toString();
}
