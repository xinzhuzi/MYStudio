import type { CompositionAudioClipProps, CompositionEnvelopePoint, CompositionFade, CompositionPanZoom, CompositionProps, CompositionTransform } from "./composition-props";
import { layoutVisualTimeline, usToFrames } from "./timing";
import type { CompositionVisualFx } from "./visual-fx";
import { isCinematicLutId } from "@/lib/studio/remotion/cinematic-luts";
import { SUBTITLE_SFX_DURATION_FRAMES, SUBTITLE_SFX_OFFSET_FRAMES, SUBTITLE_SFX_VOLUME, subtitleSfxAssetFor } from "@/lib/studio/remotion/subtitle-sfx";
import type { EditingEffect, TimelineRenderClip, TimelineRenderPlan } from "@/types/editing";
import { overlaps } from "./composition-chapter-video";

/**
 * 片段效果族——转场/字幕 SFX 剪辑派生、氛围、调色、pan-zoom、视觉特效。file-size-reduction P1 拆出,体逐字保留。
 */
export const SFX_SFX_DURATION_FRAMES = 15;
export function sfxAssetForTransition(effectId: string): string | null {
  if (effectId === "cut") return null;
  if (effectId === "crossfade") return "sfx-warm";
  if (effectId === "fade") return "sfx-soft";
  if (effectId === "flash") return "sfx-flash";
  if (effectId === "blackout") return "sfx-boom";
  if (effectId.startsWith("gl:")) {
    const n = effectId.slice(3).toLowerCase();
    if (n.includes("zoom") || n.includes("scale") || n.includes("push")) return "sfx-zoom";
    if (n.includes("glitch") || n.includes("pixel") || n.includes("mosaic")) return "sfx-glitch";
    if (n.includes("swap") || n.includes("dissolve") || n.includes("melt") || n.includes("wave") || n.includes("fade")) return "sfx-dissolve";
    return "sfx-whoosh";
  }
  return null;
}

/**
 * 字幕驱动音效派生（08-19 任务3）：音效随文字诉说。每个 text clip（句级字幕
 * cue）按其所属镜头的 shotFx.sfx 语义类别取资产，起点=cue 投影帧+2 帧起振、
 * 时长 15 帧短 one-shot、音量 0.4 克制；同一镜最多 1 条（首 cue 命中）。
 * 帧换算与字幕烧录同口径：plan 层音频时间线 → layoutVisualTimeline 压缩偏移。
 */
export function deriveSubtitleSfxClips(input: {
  plan: TimelineRenderPlan;
  sfxUrlById: Readonly<Record<string, string>>;
  categoryByStoryboardId: Readonly<Record<string, string>>;
}): Array<CompositionAudioClipProps & { renderScope: "chapter" }> {
  const fps = input.plan.renderSettings.fps;
  const visualClips = input.plan.clips
    .filter((clip) => clip.trackKind === "video" || clip.trackKind === "image")
    .sort(compareTimelineClips);
  const visualTiming = layoutVisualTimeline(
    visualClips.map((clip) => ({ clipId: clip.id, durationUs: clip.durationUs })),
    input.plan.transitions.map((transition) => ({
      fromClipId: transition.fromClipId,
      toClipId: transition.toClipId,
      effectId: transition.effectId,
      durationUs: transition.durationUs,
    })),
    fps,
  );
  const timingById = new Map(visualTiming.clips.map((timing) => [timing.clipId, timing]));
  const cueClips = input.plan.clips
    .filter((clip) => clip.trackKind === "text" && typeof clip.source.text === "string")
    .sort(compareTimelineClips);
  const scoredByShotId = new Set<string>();
  const out: Array<CompositionAudioClipProps & { renderScope: "chapter" }> = [];
  for (const cue of cueClips) {
    // cue 与视觉 clip 在 plan 层同处音频时间线；owner 用重叠区间判定（与字幕烧录同款）。
    const owner = visualClips.find((visual) =>
      overlaps(cue.startUs, cue.durationUs, visual.startUs, visual.durationUs));
    const storyboardId = owner?.source.evidence?.storyboardId;
    if (!owner || !storyboardId) continue;
    if (scoredByShotId.has(storyboardId)) continue; // 每镜最多 1 条
    const category = input.categoryByStoryboardId[storyboardId];
    if (!category) continue;
    const asset = subtitleSfxAssetFor(category);
    if (!asset) continue; // 无资产类别（雨/脚步/钟/火）标注跳过
    // 注册键=sfx-<name>（各渲染入口统一约定：sfx-<file>.ogg → sfx-<name>）。
    const src = input.sfxUrlById[asset] ?? input.sfxUrlById[`sfx-${asset}`];
    if (!src) continue;
    const ownerTiming = timingById.get(owner.id);
    if (!ownerTiming) continue;
    const layoutShiftFrames = usToFrames(owner.startUs, fps) - ownerTiming.from;
    const from = Math.max(0, usToFrames(cue.startUs, fps) - layoutShiftFrames + SUBTITLE_SFX_OFFSET_FRAMES);
    const durationInFrames = Math.min(
      SUBTITLE_SFX_DURATION_FRAMES,
      Math.max(0, visualTiming.durationInFrames - from),
    );
    if (durationInFrames <= 0) continue;
    scoredByShotId.add(storyboardId);
    out.push({
      clipId: `sfx-subtitle-${cue.id}`,
      kind: "sfx",
      src: requireCapabilityUrl(src, `sfx-subtitle-${cue.id}`),
      from,
      durationInFrames,
      volume: SUBTITLE_SFX_VOLUME,
      renderScope: "chapter",
      trimStartFrames: 0,
      playbackRate: 1,
    });
  }
  return out;
}

export function deriveTransitionSfxClips(
  base: CompositionProps,
  beatTimesUs: readonly number[] | undefined,
  sfxUrlById: Readonly<Record<string, string>> | undefined,
): Array<CompositionAudioClipProps & { renderScope: "chapter" }> {
  if (!sfxUrlById || Object.keys(sfxUrlById).length === 0) return [];
  const clipsById = new Map(base.visualClips.map((c) => [c.clipId, c]));
  const beatFrames = (beatTimesUs ?? []).map((us) => usToFrames(us, base.fps));
  const out: Array<CompositionAudioClipProps & { renderScope: "chapter" }> = [];
  base.transitions.forEach((transition, index) => {
    if (transition.overlapFrames <= 0) return;
    const asset = sfxAssetForTransition(transition.effectId);
    if (!asset) return;
    const src = sfxUrlById[asset];
    if (!src) return;
    const fromClip = clipsById.get(transition.fromClipId);
    if (!fromClip) return;
    // 转场窗起点=出镜尾起点；sfx 起点（默认=窗起点）向最近节拍吸附。
    const windowStart = fromClip.from + fromClip.durationInFrames - transition.overlapFrames;
    const windowEnd = windowStart + transition.overlapFrames;
    let from = windowStart;
    if (beatFrames.length > 0) {
      let best = -1;
      let bestDelta = Number.POSITIVE_INFINITY;
      for (const b of beatFrames) {
        const d = Math.abs(b - windowStart);
        if (d < bestDelta) { bestDelta = d; best = b; }
      }
      // 吸附钳制：|Δ|≤4 帧且不越转场窗（静默尾预算区），出界回退原时刻。
      if (best >= 0 && bestDelta <= 4 && best >= windowStart && best <= windowEnd) {
        from = best;
      }
    }
    const durationInFrames = Math.min(SFX_SFX_DURATION_FRAMES, Math.max(0, base.durationInFrames - from));
    if (durationInFrames <= 0) return;
    out.push({
      clipId: `sfx-transition-${index}`,
      kind: "sfx",
      src: requireCapabilityUrl(src, `sfx-transition-${index}`),
      from,
      durationInFrames,
      volume: 1,
      renderScope: "chapter",
      trimStartFrames: 0,
      playbackRate: 1,
    });
  });
  return out;
}

export function ambientForClip(
  effect: Pick<EditingEffect, "params"> | undefined,
): { ambient?: import("./pan-zoom").CompositionAmbient } {
  if (!effect) return {};
  const p = effect.params as Record<string, unknown> | undefined;
  if (!p || typeof p.type !== "string") return {};
  const types = ["float", "breathe", "sway", "pulse", "flow"] as const;
  if (!types.includes(p.type as never)) return {};
  const num = (v: unknown, d: number) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : d;
  };
  return {
    ambient: {
      type: p.type as "float" | "breathe" | "sway" | "pulse" | "flow",
      ampX: Math.min(0.05, Math.max(0, num(p.ampX, 0))),
      ampY: Math.min(0.05, Math.max(0, num(p.ampY, 0))),
      ampScale: Math.min(0.03, Math.max(0, num(p.ampScale, 0))),
      ampRot: Math.min(1, Math.max(0, num(p.ampRot, 0))),
      freq: Math.min(0.8, Math.max(0.1, num(p.freq, 0.2))),
      phase: Math.min(1, Math.max(0, num(p.phase, 0))),
    },
  };
}

export function gradeForClip(
  effect: Pick<EditingEffect, "params"> | undefined,
  lutUrlById: Readonly<Record<string, string>> | undefined,
  clipId: string,
  pulse?: { amp: number; freq: number },
): { grade?: { lutId: string; lutSrc?: string; blend: number; blendPulse?: { amp: number; freq: number } } } {
  if (!effect) return {};
  const params = effect.params as { lutId?: unknown; blend?: unknown } | undefined;
  const lutId = String(params?.lutId ?? "");
  if (!isCinematicLutId(lutId)) {
    throw new Error(`镜 ${clipId} 的 grade.lutId 不在 LUT 闭集：${lutId || "(空)"}`);
  }
  // 08-21 用户裁定:LUT 调色尽量压低，观众看不出来为佳——避免色彩占据主视觉不好看。
  // blend 默认从 1→0.05(5%),保留微妙的胶片感而不破坏画面原生色调。
  const blendRaw = Number(params?.blend ?? 0.05);
  const blend = Number.isFinite(blendRaw) ? Math.min(1, Math.max(0, blendRaw)) : 0.05;
  const lutSrc = lutUrlById?.[lutId];
  if (!lutSrc) {
    throw new Error(`镜 ${clipId} 的 grade 缺少 LUT 资源 URL（渲染入口须注册 LUT 资产：${lutId}）`);
  }
  return { grade: { lutId, lutSrc, blend, ...(pulse ? { blendPulse: pulse } : {}) } };
}

/** panZoom 缓动白名单（08-21 spring 接入）：非法/缺省一律回退 cubic（历史行为）。 */
const PAN_ZOOM_EASING_VALUES = ["cubic", "spring"] as const;

export function panZoomForClip(effect: Pick<EditingEffect, "params"> | undefined): CompositionPanZoom | undefined {
  if (!effect) return undefined;
  const easing = (PAN_ZOOM_EASING_VALUES as readonly string[]).includes(String(effect.params.easing))
    ? (String(effect.params.easing) as CompositionPanZoom["easing"])
    : undefined;
  return {
    fromScale: numberParam(effect.params.scaleFrom, 1),
    toScale: numberParam(effect.params.scaleTo, 1.06),
    originX: numberParam(effect.params.x, 0.5),
    originY: numberParam(effect.params.y, 0.5),
    ...(easing ? { easing } : {}),
  };
}

/** plan.effects 中映射到合成层 CompositionVisualFx 的效果 ID（registry 已定义参数表）。 */
export const VISUAL_FX_EFFECT_IDS: ReadonlySet<string> = new Set([
  "shake",
  "glow",
  "grain",
  "chromaticAberration",
  // 08-19 第二批:残影/速度剪影/神光(进 CompositionVisualFx)
  "afterimage",
  "speedSilhouette",
  "godRays",
]);

/**
 * 把同一片段的多个 fx 效果合并为 CompositionVisualFx。
 * 参数换算（registry → 合成层）：shake intensity 0..1 → amplitudePx ×24
 * （0.25→6px 明显、0.125→3px 轻微）；glow/grain 数值域一致直传
 * （grain amount → opacity）；chromaticAberration offset → chroma offsetPx。
 */
export function visualFxForClip(effects: readonly EditingEffect[] | undefined): CompositionVisualFx | undefined {
  if (!effects || effects.length === 0) return undefined;
  const fx: CompositionVisualFx = {};
  for (const effect of effects) {
    if (effect.effectId === "shake") {
      fx.shake = { amplitudePx: clampRange(numberParam(effect.params.intensity, 0.25), 0, 1) * 24 };
    } else if (effect.effectId === "glow") {
      fx.glow = { intensity: clampRange(numberParam(effect.params.intensity, 0.4), 0, 1) };
    } else if (effect.effectId === "grain") {
      fx.grain = { opacity: clampRange(numberParam(effect.params.amount, 0.12), 0, 1) };
    } else if (effect.effectId === "chromaticAberration") {
      fx.chroma = { offsetPx: clampRange(numberParam(effect.params.offset, 3), 0, 24) };
    } else if (effect.effectId === "afterimage") {
      fx.afterimage = {
        copies: Math.round(clampRange(numberParam(effect.params.copies, 3), 1, 5)),
        offsetPx: clampRange(numberParam(effect.params.offset, 26), 4, 80),
        opacity: clampRange(numberParam(effect.params.opacity, 0.5), 0.05, 1),
      };
    } else if (effect.effectId === "speedSilhouette") {
      const direction = String(effect.params.direction ?? "ltr");
      fx.speedSilhouette = { direction: direction === "rtl" ? "rtl" : "ltr" };
    } else if (effect.effectId === "godRays") {
      fx.godRays = {
        intensity: clampRange(numberParam(effect.params.intensity, 0.6), 0, 1),
        hue: clampRange(numberParam(effect.params.hue, 45), 0, 360),
      };
    }
  }
  if (
    fx.shake === undefined && fx.glow === undefined
    && fx.grain === undefined && fx.chroma === undefined
    && fx.afterimage === undefined && fx.speedSilhouette === undefined
    && fx.godRays === undefined
  ) {
    return undefined;
  }
  return fx;
}

export function clampRange(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function fadeForClip(clip: TimelineRenderClip, fps: number): CompositionFade | undefined {
  if (clip.fadeInUs === undefined && clip.fadeOutUs === undefined) return undefined;
  return {
    fadeInFrames: usToFrames(clip.fadeInUs ?? 0, fps),
    fadeOutFrames: usToFrames(clip.fadeOutUs ?? 0, fps),
  };
}

export function envelopeForClip(
  clip: TimelineRenderClip,
  fps: number,
): CompositionEnvelopePoint[] | undefined {
  return clip.envelope?.map((point) => ({
    frame: usToFrames(point.timeUs, fps),
    gain: point.gain,
  }));
}

export function defaultTransform(): CompositionTransform {
  return { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 };
}

export function compareTimelineClips(left: TimelineRenderClip, right: TimelineRenderClip): number {
  return left.startUs - right.startUs || left.id.localeCompare(right.id);
}

/** 按场分段导出的帧布局：与正式 ChapterVideo 渲染同源（同排序、同
 * layoutVisualTimeline、同转场重叠折叠），供入队侧计算场帧区间。 */
export function layoutChapterVisualClipTimings(plan: TimelineRenderPlan): {
  clips: Array<{ clipId: string; storyboardId: string; from: number; durationInFrames: number }>;
  durationInFrames: number;
} {
  const visualClips = plan.clips
    .filter((clip) => clip.trackKind === "video" || clip.trackKind === "image")
    .sort(compareTimelineClips);
  const timing = layoutVisualTimeline(
    visualClips.map((clip) => ({ clipId: clip.id, durationUs: clip.durationUs })),
    plan.transitions.map((transition) => ({
      fromClipId: transition.fromClipId,
      toClipId: transition.toClipId,
      effectId: transition.effectId,
      durationUs: transition.durationUs,
    })),
    plan.renderSettings.fps,
  );
  const storyboardIdByClipId = new Map(
    visualClips.map((clip) => [clip.id, clip.source.evidence.storyboardId ?? ""]),
  );
  return {
    clips: timing.clips.map((clip) => ({
      clipId: clip.clipId,
      storyboardId: storyboardIdByClipId.get(clip.clipId) ?? "",
      from: clip.from,
      durationInFrames: clip.durationInFrames,
    })),
    durationInFrames: timing.durationInFrames,
  };
}

export function requireCapabilityUrl(value: string | undefined, clipId: string): string {
  if (!value || !CAPABILITY_URL.test(value)) {
    throw new Error(`片段 ${clipId} 缺少 127.0.0.1 capability URL`);
  }
  return value;
}

export function numberParam(value: string | number | boolean | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function audioKind(clip: TimelineRenderClip): "voice" | "bgm" | "sfx" {
  if (clip.trackKind === "voice" || clip.trackKind === "bgm" || clip.trackKind === "sfx") {
    return clip.trackKind;
  }
  throw new Error(`非音频片段不能投影为音频: ${clip.id}`);
}

const CAPABILITY_URL = /^http:\/\/127\.0\.0\.1:\d+\/[a-f0-9]{64}\/[A-Za-z0-9._~-]+$/;
