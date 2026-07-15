import path from "node:path";
import type {
  EditingAudioEnvelopePoint,
  EditingEffect,
  TimelineRenderClip,
  TimelineRenderPlan,
} from "../types/editing";
import { serializeSrt } from "../lib/studio/editing/subtitle-codec";

export interface TimelineResolvedInput {
  clipId: string;
  sourcePath: string;
}

export interface TimelineFfmpegCommandInput {
  plan: TimelineRenderPlan;
  resolvedInputs: TimelineResolvedInput[];
  outputPath: string;
  subtitlePath?: string;
}

export interface TimelineFfmpegCommand {
  args: string[];
  filterGraph: string;
  totalDurationUs: number;
  inputManifest: Array<{
    clipId: string;
    trackId: string;
    trackKind: TimelineRenderClip["trackKind"];
    sourcePath: string;
  }>;
}

const VISUAL_TRACK_KINDS = new Set(["video", "image"]);
const AUDIO_TRACK_KINDS = new Set(["voice", "bgm", "sfx"]);

export function buildTimelineFfmpegCommand(
  input: TimelineFfmpegCommandInput,
): TimelineFfmpegCommand {
  const { plan } = input;
  const resolvedByClipId = new Map(
    input.resolvedInputs.map((item) => [item.clipId, item.sourcePath]),
  );
  const visualClips = plan.clips
    .filter((clip) => VISUAL_TRACK_KINDS.has(clip.trackKind))
    .sort(byTimelinePosition);
  const audioClips = plan.clips
    .filter((clip) => AUDIO_TRACK_KINDS.has(clip.trackKind) && !clip.muted)
    .sort(byTimelinePosition);
  if (visualClips.length === 0) throw new Error("时间线缺少主画面片段");
  const effectsByClipId = groupEffectsByClipId(plan.effects);

  const args = ["-nostdin", "-hide_banner", "-y"];
  const inputManifest: TimelineFfmpegCommand["inputManifest"] = [];
  const inputIndexByClipId = new Map<string, number>();

  for (const clip of [...visualClips, ...audioClips]) {
    const sourcePath = requiredResolvedPath(clip, resolvedByClipId);
    const inputIndex = inputIndexByClipId.size;
    inputIndexByClipId.set(clip.id, inputIndex);
    inputManifest.push({ clipId: clip.id, trackId: clip.trackId, trackKind: clip.trackKind, sourcePath });
    const playbackRate = clipPlaybackRate(clip, effectsByClipId.get(clip.id) ?? []);
    const duration = seconds(clip.durationUs);
    if (visualClips.includes(clip) && isImageClip(clip, sourcePath)) {
      args.push(
        "-framerate", String(plan.renderSettings.fps),
        "-loop", "1",
        "-t", duration,
        "-i", sourcePath,
      );
    } else {
      if (clip.trimStartUs > 0) args.push("-ss", seconds(clip.trimStartUs));
      args.push("-t", seconds(Math.round(clip.durationUs * playbackRate)), "-i", sourcePath);
    }
  }

  const graph: string[] = [];
  const durationByClipId = new Map(visualClips.map((clip) => [clip.id, clip.durationUs]));
  visualClips.forEach((clip, index) => {
    const inputIndex = inputIndexByClipId.get(clip.id)!;
    const sourcePath = requiredResolvedPath(clip, resolvedByClipId);
    const clipEffects = effectsByClipId.get(clip.id) ?? [];
    const playbackRate = clipPlaybackRate(clip, clipEffects);
    const base = [
      `scale=${plan.renderSettings.width}:${plan.renderSettings.height}:force_original_aspect_ratio=decrease`,
      `pad=${plan.renderSettings.width}:${plan.renderSettings.height}:(ow-iw)/2:(oh-ih)/2`,
      "setsar=1",
      "format=yuv420p",
    ];
    base.push(...buildVisualEffectFilters(
      clip,
      clipEffects,
      plan,
      isImageClip(clip, sourcePath),
    ));
    base.push(
      `fps=${plan.renderSettings.fps}`,
      playbackRate === 1
        ? "setpts=PTS-STARTPTS"
        : `setpts=(PTS-STARTPTS)/${decimal(playbackRate)}`,
      `trim=duration=${seconds(clip.durationUs)}`,
    );
    graph.push(`[${inputIndex}:v]${base.join(",")}[v${index}]`);
  });

  let currentVideoLabel = "v0";
  let currentDurationUs = visualClips[0]!.durationUs;
  for (let index = 1; index < visualClips.length; index += 1) {
    const previous = visualClips[index - 1]!;
    const current = visualClips[index]!;
    const transition = plan.transitions.find(
      (item) => item.fromClipId === previous.id && item.toClipId === current.id,
    );
    const outputLabel = `vjoin${index}`;
    if (!transition || transition.effectId === "cut") {
      graph.push(`[${currentVideoLabel}][v${index}]concat=n=2:v=1:a=0[${outputLabel}]`);
      currentDurationUs += current.durationUs;
    } else {
      const durationUs = Math.min(
        transition.durationUs,
        Math.floor(Math.min(durationByClipId.get(previous.id)!, durationByClipId.get(current.id)!) * 0.15),
      );
      const duration = seconds(durationUs);
      const currentHeadDuration = seconds(currentDurationUs - durationUs);
      const nextTailStart = duration;
      const currentHeadSource = `current-head-source-${index}`;
      const currentTailSource = `current-tail-source-${index}`;
      const nextHeadSource = `next-head-source-${index}`;
      const nextTailSource = `next-tail-source-${index}`;
      const currentHead = `current-head-${index}`;
      const currentTail = `current-tail-${index}`;
      const nextHead = `next-head-${index}`;
      const nextTail = `next-tail-${index}`;
      const transitionLabel = `transition-${index}`;
      graph.push(
        `[${currentVideoLabel}]split=2[${currentHeadSource}][${currentTailSource}]`,
        `[${currentHeadSource}]trim=duration=${currentHeadDuration},setpts=PTS-STARTPTS[${currentHead}]`,
        `[${currentTailSource}]trim=start=${currentHeadDuration}:duration=${duration},setpts=PTS-STARTPTS[${currentTail}]`,
        `[v${index}]split=2[${nextHeadSource}][${nextTailSource}]`,
        `[${nextHeadSource}]trim=duration=${duration},setpts=PTS-STARTPTS[${nextHead}]`,
        `[${nextTailSource}]trim=start=${nextTailStart},setpts=PTS-STARTPTS[${nextTail}]`,
        `[${currentTail}][${nextHead}]${blendFilter(transition.effectId, duration)}[${transitionLabel}]`,
        `[${currentHead}][${transitionLabel}][${nextTail}]concat=n=3:v=1:a=0[${outputLabel}]`,
      );
      currentDurationUs += current.durationUs - durationUs;
    }
    currentVideoLabel = outputLabel;
  }

  const subtitleClips = plan.clips
    .filter((clip) => clip.trackKind === "text" && clip.source.text?.trim())
    .sort(byTimelinePosition);
  if (plan.renderSettings.subtitleMode === "burn-in" && subtitleClips.length > 0 && input.subtitlePath) {
    graph.push(
      `[${currentVideoLabel}]subtitles='${escapeFilterPath(input.subtitlePath)}':force_style='FontSize=24,PrimaryColour=&Hffffff&,OutlineColour=&H000000&,Outline=2,Alignment=2'[video-out]`,
    );
    currentVideoLabel = "video-out";
  }

  const audioLabels: string[] = [];
  const voiceIntervals = mergeAudioIntervals(
    audioClips.filter((clip) => clip.trackKind === "voice"),
  );
  audioClips.forEach((clip, index) => {
    const inputIndex = inputIndexByClipId.get(clip.id)!;
    const playbackRate = clipPlaybackRate(clip, []);
    const filters = [
      ...buildAtempoFilters(playbackRate),
      `atrim=duration=${seconds(clip.durationUs)}`,
      "asetpts=PTS-STARTPTS",
      `volume='${buildClipGainExpression(clip, voiceIntervals, plan)}':eval=frame`,
    ];
    if (clip.fadeInUs && clip.fadeInUs > 0) {
      filters.push(`afade=t=in:st=0:d=${seconds(Math.min(clip.fadeInUs, clip.durationUs))}`);
    }
    if (clip.fadeOutUs && clip.fadeOutUs > 0) {
      const fadeDurationUs = Math.min(clip.fadeOutUs, clip.durationUs);
      filters.push(`afade=t=out:st=${seconds(clip.durationUs - fadeDurationUs)}:d=${seconds(fadeDurationUs)}`);
    }
    const delayMs = Math.max(0, Math.round(clip.startUs / 1_000));
    filters.push(`adelay=${delayMs}|${delayMs}`);
    const label = `a${index}`;
    graph.push(`[${inputIndex}:a]${filters.join(",")}[${label}]`);
    audioLabels.push(`[${label}]`);
  });

  if (audioLabels.length > 0) {
    graph.push(
      `${audioLabels.join("")}amix=inputs=${audioLabels.length}:duration=longest:dropout_transition=0,loudnorm=I=${decimal(plan.renderSettings.loudnessLufs)}:TP=${decimal(plan.renderSettings.truePeakDbtp)}:LRA=11[audio-out]`,
    );
  } else {
    graph.push(`anullsrc=r=48000:cl=stereo,atrim=duration=${seconds(currentDurationUs)}[audio-out]`);
  }

  const filterGraph = graph.join(";");
  args.push(
    "-filter_complex", filterGraph,
    "-map", `[${currentVideoLabel}]`,
    "-map", "[audio-out]",
    "-c:v", "libx264",
    "-preset", "medium",
    "-crf", "23",
    "-pix_fmt", "yuv420p",
    "-r", String(plan.renderSettings.fps),
    "-c:a", "aac",
    "-ar", "48000",
    "-b:a", "192k",
    "-movflags", "+faststart",
    "-t", seconds(currentDurationUs),
    "-progress", "pipe:1",
    "-nostats",
    input.outputPath,
  );

  return { args, filterGraph, totalDurationUs: currentDurationUs, inputManifest };
}

export function buildTimelineSubtitleSrt(plan: TimelineRenderPlan) {
  return serializeSrt(plan.clips
    .filter((clip) => clip.trackKind === "text" && clip.source.text?.trim())
    .sort(byTimelinePosition)
    .map((clip) => ({
      startUs: clip.startUs,
      endUs: clip.startUs + clip.durationUs,
      text: clip.source.text!.trim(),
    })));
}

function groupEffectsByClipId(effects: EditingEffect[]) {
  const grouped = new Map<string, EditingEffect[]>();
  for (const effect of effects) {
    if (!effect.enabled || !effect.targetClipId) continue;
    const current = grouped.get(effect.targetClipId) ?? [];
    current.push(effect);
    grouped.set(effect.targetClipId, current);
  }
  for (const items of grouped.values()) {
    items.sort((left, right) => left.startUs - right.startUs || left.id.localeCompare(right.id));
  }
  return grouped;
}

function clipPlaybackRate(clip: TimelineRenderClip, effects: EditingEffect[]) {
  return effects
    .filter((effect) => effect.effectId === "speed")
    .reduce((rate, effect) => rate * numberParam(effect.params.rate, 1), clip.speed);
}

function buildVisualEffectFilters(
  clip: TimelineRenderClip,
  effects: EditingEffect[],
  plan: TimelineRenderPlan,
  imageClip: boolean,
) {
  const filters: string[] = [];
  for (const effect of effects) {
    const enable = effectEnable(effect, clip);
    if (effect.effectId === "panZoom") {
      const scaleFrom = numberParam(effect.params.scaleFrom, 1);
      const scaleTo = numberParam(effect.params.scaleTo, 1.06);
      const x = numberParam(effect.params.x, 0.5);
      const y = numberParam(effect.params.y, 0.5);
      if (imageClip) {
        const frames = Math.max(1, Math.round((clip.durationUs / 1_000_000) * plan.renderSettings.fps));
        const step = frames <= 1 ? 0 : (scaleTo - scaleFrom) / (frames - 1);
        filters.push(
          `zoompan=z='min(max(zoom,${decimal(scaleFrom)})+${decimal(step)},${decimal(scaleTo)})':x='(iw-iw/zoom)*${decimal(x)}':y='(ih-ih/zoom)*${decimal(y)}':d=1:s=${plan.renderSettings.width}x${plan.renderSettings.height}:fps=${plan.renderSettings.fps}`,
        );
      } else {
        const duration = seconds(clip.durationUs);
        const progress = `min(max(t/${duration},0),1)`;
        const scale = `${decimal(scaleFrom)}+(${decimal(scaleTo)}-${decimal(scaleFrom)})*${progress}`;
        filters.push(
          `scale=w='trunc(iw*(${scale})/2)*2':h='trunc(ih*(${scale})/2)*2':eval=frame`,
          `crop=${plan.renderSettings.width}:${plan.renderSettings.height}:'(iw-ow)*${decimal(x)}':'(ih-oh)*${decimal(y)}'`,
        );
      }
    } else if (effect.effectId === "shake") {
      const intensity = numberParam(effect.params.intensity, 0.25);
      const frequency = numberParam(effect.params.frequency, 8);
      const margin = Math.max(2, Math.round(Math.min(plan.renderSettings.width, plan.renderSettings.height) * 0.02 * intensity));
      const localStart = seconds(effect.startUs - clip.startUs);
      const localEnd = seconds(effect.startUs - clip.startUs + effect.durationUs);
      const active = `between(t,${localStart},${localEnd})`;
      filters.push(
        `crop=w='iw-${margin * 2}':h='ih-${margin * 2}':x='if(${active},${margin}+${margin}*sin(2*PI*${decimal(frequency)}*t),${margin})':y='if(${active},${margin}+${margin}*cos(2*PI*${decimal(frequency)}*t),${margin})'`,
        `scale=${plan.renderSettings.width}:${plan.renderSettings.height}`,
      );
    } else if (effect.effectId === "glitch") {
      const intensity = numberParam(effect.params.intensity, 0.35);
      const offset = Math.max(1, Math.round(intensity * 8));
      const strength = Math.max(1, Math.round(intensity * 20));
      filters.push(
        `rgbashift=rh=${offset}:bh=-${offset}${enable}`,
        `noise=alls=${strength}:all_seed=7331:allf=a+u${enable}`,
      );
    } else if (effect.effectId === "chromaticAberration") {
      const offset = Math.round(numberParam(effect.params.offset, 3));
      filters.push(`rgbashift=rh=${offset}:bh=-${offset}${enable}`);
    } else if (effect.effectId === "blur") {
      filters.push(`gblur=sigma=${decimal(numberParam(effect.params.radius, 4))}${enable}`);
    } else if (effect.effectId === "glow") {
      const intensity = numberParam(effect.params.intensity, 0.4);
      filters.push(`eq=brightness=${decimal(intensity * 0.2)}:saturation=${decimal(1 + intensity * 0.5)}${enable}`);
    } else if (effect.effectId === "grain") {
      const amount = numberParam(effect.params.amount, 0.12);
      filters.push(`noise=alls=${Math.max(1, Math.round(amount * 30))}:all_seed=1337:allf=a+u${enable}`);
    }
  }
  return filters;
}

function effectEnable(effect: EditingEffect, clip: TimelineRenderClip) {
  const start = seconds(effect.startUs - clip.startUs);
  const end = seconds(effect.startUs - clip.startUs + effect.durationUs);
  return `:enable='between(t,${start},${end})'`;
}

function buildAtempoFilters(rate: number) {
  if (rate === 1) return [];
  const factors: number[] = [];
  let remaining = rate;
  while (remaining < 0.5) {
    factors.push(0.5);
    remaining /= 0.5;
  }
  while (remaining > 2) {
    factors.push(2);
    remaining /= 2;
  }
  if (Math.abs(remaining - 1) > 0.000001) factors.push(remaining);
  return factors.map((factor) => `atempo=${decimal(factor)}`);
}

interface AudioInterval {
  startUs: number;
  endUs: number;
}

function buildClipGainExpression(
  clip: TimelineRenderClip,
  voiceIntervals: AudioInterval[],
  plan: TimelineRenderPlan,
) {
  const envelope = buildEnvelopeExpression(clip.envelope);
  const ducking = clip.trackKind === "bgm"
    ? buildDuckingExpression(clip, voiceIntervals, plan)
    : "1";
  return [decimal(clip.volume), envelope, ducking]
    .filter((factor, index) => index === 0 || factor !== "1")
    .map((factor, index) => index === 0 ? factor : `(${factor})`)
    .join("*");
}

function buildEnvelopeExpression(points: EditingAudioEnvelopePoint[] | undefined) {
  if (!points?.length) return "1";
  let expression = decimal(points.at(-1)!.gain);
  for (let index = points.length - 2; index >= 0; index -= 1) {
    const left = points[index]!;
    const right = points[index + 1]!;
    const start = seconds(left.timeUs);
    const end = seconds(right.timeUs);
    const duration = seconds(right.timeUs - left.timeUs);
    expression = `if(lt(t,${end}),${decimal(left.gain)}+(${decimal(right.gain)}-${decimal(left.gain)})*(t-${start})/${duration},${expression})`;
  }
  const first = points[0]!;
  if (first.timeUs > 0) {
    const end = seconds(first.timeUs);
    expression = `if(lt(t,${end}),1+(${decimal(first.gain)}-1)*t/${end},${expression})`;
  }
  return expression;
}

function buildDuckingExpression(
  clip: TimelineRenderClip,
  intervals: AudioInterval[],
  plan: TimelineRenderPlan,
) {
  if (intervals.length === 0) return "1";
  const policy = plan.renderSettings.audioDucking;
  const duckGain = Math.pow(10, policy.reductionDb / 20);
  const clipStartSeconds = clip.startUs / 1_000_000;
  const clipEndUs = clip.startUs + clip.durationUs;
  const relevant = intervals.filter((interval) =>
    interval.endUs + policy.releaseUs > clip.startUs
      && interval.startUs < clipEndUs,
  );
  let expression = "1";
  for (let index = relevant.length - 1; index >= 0; index -= 1) {
    const interval = relevant[index]!;
    const start = interval.startUs / 1_000_000 - clipStartSeconds;
    const attackEnd = start + policy.attackUs / 1_000_000;
    const end = interval.endUs / 1_000_000 - clipStartSeconds;
    const releaseEnd = end + policy.releaseUs / 1_000_000;
    const attack = policy.attackUs > 0
      ? `if(lt(t,${decimal(attackEnd)}),1-(1-${decimal(duckGain)})*(t-${decimal(start)})/${seconds(policy.attackUs)},`
      : "";
    const release = policy.releaseUs > 0
      ? `if(lt(t,${decimal(releaseEnd)}),${decimal(duckGain)}+(1-${decimal(duckGain)})*(t-${decimal(end)})/${seconds(policy.releaseUs)},${expression})`
      : expression;
    const active = `if(lte(t,${decimal(end)}),${decimal(duckGain)},${release})`;
    const ducked = `${attack}${active}${attack ? ")" : ""}`;
    expression = start <= 0
      ? ducked
      : `if(lt(t,${decimal(start)}),${expression},${ducked})`;
  }
  return expression;
}

function mergeAudioIntervals(clips: TimelineRenderClip[]): AudioInterval[] {
  const ordered = clips
    .map((clip) => ({ startUs: clip.startUs, endUs: clip.startUs + clip.durationUs }))
    .sort((left, right) => left.startUs - right.startUs || left.endUs - right.endUs);
  const merged: AudioInterval[] = [];
  for (const interval of ordered) {
    const previous = merged.at(-1);
    if (previous && interval.startUs <= previous.endUs) {
      previous.endUs = Math.max(previous.endUs, interval.endUs);
    } else {
      merged.push({ ...interval });
    }
  }
  return merged;
}

function requiredResolvedPath(clip: TimelineRenderClip, paths: Map<string, string>) {
  const value = paths.get(clip.id)?.trim();
  if (!value) throw new Error(`片段缺少已解析素材路径: ${clip.id}`);
  return value;
}

function isImageClip(clip: TimelineRenderClip, sourcePath: string) {
  if (clip.source.kind === "storyboardImage") return true;
  return new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"])
    .has(path.extname(sourcePath).toLowerCase());
}

function byTimelinePosition(left: TimelineRenderClip, right: TimelineRenderClip) {
  return left.startUs - right.startUs || left.id.localeCompare(right.id);
}

function blendFilter(effectId: string, duration: string) {
  if (effectId === "fade" || effectId === "blackout") {
    return `blend=c0_expr='if(lt(T/${duration},0.5),A*(1-2*T/${duration})+16*(2*T/${duration}),B*(2*T/${duration}-1)+16*(2-2*T/${duration}))':c1_expr='if(lt(T/${duration},0.5),A*(1-2*T/${duration})+128*(2*T/${duration}),B*(2*T/${duration}-1)+128*(2-2*T/${duration}))':c2_expr='if(lt(T/${duration},0.5),A*(1-2*T/${duration})+128*(2*T/${duration}),B*(2*T/${duration}-1)+128*(2-2*T/${duration}))'`;
  }
  if (effectId === "flash") {
    return `blend=c0_expr='if(lt(T/${duration},0.5),A*(1-2*T/${duration})+235*(2*T/${duration}),B*(2*T/${duration}-1)+235*(2-2*T/${duration}))':c1_expr='if(lt(T/${duration},0.5),A*(1-2*T/${duration})+128*(2*T/${duration}),B*(2*T/${duration}-1)+128*(2-2*T/${duration}))':c2_expr='if(lt(T/${duration},0.5),A*(1-2*T/${duration})+128*(2*T/${duration}),B*(2*T/${duration}-1)+128*(2-2*T/${duration}))'`;
  }
  return `blend=all_expr='A*(1-min(T/${duration},1))+B*min(T/${duration},1)'`;
}

function numberParam(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function seconds(valueUs: number) {
  return decimal(valueUs / 1_000_000);
}

function decimal(value: number) {
  return Number(value.toFixed(6)).toString();
}

function escapeFilterPath(filePath: string) {
  return filePath.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");
}
