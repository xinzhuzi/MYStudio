import path from "node:path";
import { parseProjectFileUrl } from "@/electron/storage/storage-paths";
import type {
  EditingEffect,
  TimelineRenderClip,
  TimelineRenderPlan,
} from "@/types/editing";
import type {
  ChapterVideoCompositionProps,
  CompositionAudioClipProps,
  CompositionEnvelopePoint,
  CompositionFade,
  CompositionLayerSpec,
  CompositionOverlayClipProps,
  CompositionPanZoom,
  CompositionProps,
  CompositionTransform,
  CompositionTransitionProps,
  CompositionVisualClipProps,
} from "./composition-props";
import type { CompositionVisualFx } from "./visual-fx";
import { validateChapterVideoCompositionProps } from "./composition-props-validation";
import type {
  HyperFramesOverlayWindowV1,
  RemotionChapterGateAcceptedV1,
} from "@rendering/contracts/video-workflow";
import type {
  RemotionChapterManifestV2,
  RemotionCurrentSlotV1,
} from "@/types/remotion-workspace";
import { validateRemotionCurrentSlot as validateCurrentSlot } from "@/lib/studio/remotion/remotion-slot-validation";
import {
  clipDurationInFrames,
  layoutVisualTimeline,
  MICROSECONDS_PER_SECOND,
  usToFrames,
} from "./timing";
import { resolveSubtitleAuthority } from "@/lib/studio/video-workflow/subtitle-authority";
import { DEFAULT_SUBTITLE_FONT_ID } from "@/lib/studio/remotion/subtitle-fonts";
import { isCinematicLutId } from "@/lib/studio/remotion/cinematic-luts";
import {
  SUBTITLE_SFX_DURATION_FRAMES,
  SUBTITLE_SFX_OFFSET_FRAMES,
  SUBTITLE_SFX_VOLUME,
  subtitleSfxAssetFor,
} from "@/lib/studio/remotion/subtitle-sfx";

const CAPABILITY_URL = /^http:\/\/127\.0\.0\.1:\d+\/[a-f0-9]{64}\/[A-Za-z0-9._~-]+$/;
const TEXT_HYPERFRAMES_TEMPLATES = new Set(["title-card", "kinetic-caption"]);

export function buildCompositionProps(
  plan: TimelineRenderPlan,
  mediaUrlByClipId: Readonly<Record<string, string>>,
  lutUrlById?: Readonly<Record<string, string>>,
  layerUrlByClipId?: Readonly<Record<string, { backgroundSrc: string; subjectSrc: string; parallax?: number }>>,
): CompositionProps {
  const fps = plan.renderSettings.fps;
  // ambient（环境动画）效果：sin/cos 周期运动叠加在 panZoom 之上(2026-08-19)。
  const ambientEffectByClipId = new Map(
    plan.effects
      .filter((effect) => effect.enabled && effect.effectId === "ambient" && effect.targetClipId)
      .map((effect) => [effect.targetClipId!, effect]),
  );
  // grade（成片调色）效果：params{lutId,blend}，lutId 闭集 fail-closed。
  const gradeEffectByClipId = new Map(
    plan.effects
      .filter((effect) => effect.enabled && effect.effectId === "grade" && effect.targetClipId)
      .map((effect) => [effect.targetClipId!, effect]),
  );
  // onTwos(帧步进)/gradePulse(调色脉动)效果:08-19 第二批决策层接入。
  const onTwosByClipId = new Map(
    plan.effects
      .filter((effect) => effect.enabled && effect.effectId === "onTwos" && effect.targetClipId)
      .map((effect) => [effect.targetClipId!, Math.round(clampRange(numberParam(effect.params.step, 2), 2, 3))]),
  );
  const gradePulseByClipId = new Map(
    plan.effects
      .filter((effect) => effect.enabled && effect.effectId === "gradePulse" && effect.targetClipId)
      .map((effect) => [effect.targetClipId!, {
        amp: clampRange(numberParam(effect.params.amp, 0.08), 0.01, 0.5),
        freq: clampRange(numberParam(effect.params.freq, 0.3), 0.05, 2),
      }]),
  );
  const visualClips = plan.clips
    .filter((clip) => clip.trackKind === "video" || clip.trackKind === "image")
    .sort(compareTimelineClips);
  const visualTiming = layoutVisualTimeline(
    visualClips.map((clip) => ({ clipId: clip.id, durationUs: clip.durationUs })),
    plan.transitions.map((transition) => ({
      fromClipId: transition.fromClipId,
      toClipId: transition.toClipId,
      effectId: transition.effectId,
      durationUs: transition.durationUs,
    })),
    fps,
  );
  const timingById = new Map(visualTiming.clips.map((timing) => [timing.clipId, timing]));
  const panZoomByClipId = new Map(
    plan.effects
      .filter((effect) => effect.effectId === "panZoom" && effect.targetClipId)
      .map((effect) => [effect.targetClipId!, effect]),
  );
  const fxEffectsByClipId = new Map<string, EditingEffect[]>();
  for (const effect of plan.effects) {
    if (!effect.enabled || !effect.targetClipId) continue;
    if (!VISUAL_FX_EFFECT_IDS.has(effect.effectId)) continue;
    const list = fxEffectsByClipId.get(effect.targetClipId);
    if (list) list.push(effect);
    else fxEffectsByClipId.set(effect.targetClipId, [effect]);
  }
  const compositionVisuals: CompositionVisualClipProps[] = visualClips.map((clip) => {
    const timing = timingById.get(clip.id);
    if (!timing) throw new Error(`视觉片段缺少统一时序: ${clip.id}`);
    return {
      clipId: clip.id,
      kind: clip.source.kind === "storyboardVideo" || clip.source.kind === "videoCandidate"
        ? "video"
        : clip.trackKind === "video" && clip.source.kind !== "storyboardImage"
          ? "video"
          : "image",
      src: requireCapabilityUrl(mediaUrlByClipId[clip.id], clip.id),
      from: timing.from,
      durationInFrames: timing.durationInFrames,
      transform: clip.transform ?? defaultTransform(),
      panZoom: panZoomForClip(panZoomByClipId.get(clip.id)),
      fx: visualFxForClip(fxEffectsByClipId.get(clip.id)),
      ...gradeForClip(gradeEffectByClipId.get(clip.id), lutUrlById, clip.id, gradePulseByClipId.get(clip.id)),
      ...(onTwosByClipId.has(clip.id) ? { frameStep: onTwosByClipId.get(clip.id) } : {}),
      ...ambientForClip(ambientEffectByClipId.get(clip.id)),
      trimStartFrames: usToFrames(clip.trimStartUs, fps),
      playbackRate: clip.speed,
      muted: clip.muted,
      // 图层分离分层渲染(08-19):仅静帧片段;注入时把旧二元组转换为
      // layerStack(bg damp=1-0.4·parallax 与旧公式一致→既有成片像素级不变),
      // N 层渲染接管;Child2 的 atmosphere 效果将在此追加 template 层。
      ...(layerUrlByClipId?.[clip.id] && (clip.source.kind === "storyboardImage" || clip.trackKind === "image")
        ? { layerStack: layerStackFromLegacyTuple(layerUrlByClipId[clip.id]) }
        : {}),
    };
  });
  const audioClips: CompositionAudioClipProps[] = plan.clips
    .filter((clip) => clip.trackKind === "voice" || clip.trackKind === "bgm" || clip.trackKind === "sfx")
    .sort(compareTimelineClips)
    .map((clip) => ({
      clipId: clip.id,
      kind: audioKind(clip),
      src: requireCapabilityUrl(mediaUrlByClipId[clip.id], clip.id),
      from: usToFrames(clip.startUs, fps),
      durationInFrames: clipDurationInFrames(clip.durationUs, fps),
      volume: clip.muted ? 0 : clip.volume,
      trimStartFrames: usToFrames(clip.trimStartUs, fps),
      playbackRate: clip.speed,
      fade: fadeForClip(clip, fps),
      envelope: envelopeForClip(clip, fps),
    }));
  const subtitles = plan.renderSettings.subtitleMode === "burn-in"
    ? readableSubtitleCues(
        plan.clips
          .filter((clip) => clip.trackKind === "text" && typeof clip.source.text === "string")
          .sort(compareTimelineClips)
          .map((clip) => {
            // 字幕与视觉 clip 在 plan 层同处"音频时间线"（各镜时长直加），而视觉经
            // layoutVisualTimeline 压缩（转场重叠）——字幕必须用同一份 layout 偏移
            // 换算，否则随片长线性滞后（片尾可达数十秒）。
            const owner = visualClips.find((visual) => overlaps(clip.startUs, clip.durationUs, visual.startUs, visual.durationUs));
            const ownerTiming = owner ? timingById.get(owner.id) : undefined;
            const layoutShiftFrames = owner && ownerTiming
              ? usToFrames(owner.startUs, fps) - ownerTiming.from
              : 0;
            const from = Math.max(0, usToFrames(clip.startUs, fps) - layoutShiftFrames);
            return {
              cueId: clip.id,
              text: clip.source.text!.trim(),
              from,
              audioSpanFrames: clipDurationInFrames(clip.durationUs, fps),
            };
          })
          .filter((cue) => cue.text.length > 0 && cue.from < visualTiming.durationInFrames),
        visualTiming.durationInFrames,
        fps,
      )
    : [];
  const transitions: CompositionTransitionProps[] = plan.transitions.map((transition) => {
    const from = timingById.get(transition.fromClipId);
    const to = timingById.get(transition.toClipId);
    if (!from || !to) throw new Error(`转场引用不存在的视觉片段: ${transition.id}`);
    return {
      fromClipId: transition.fromClipId,
      toClipId: transition.toClipId,
      effectId: transition.effectId,
      overlapFrames: Math.max(0, from.from + from.durationInFrames - to.from),
    };
  });
  return {
    width: plan.renderSettings.width,
    height: plan.renderSettings.height,
    fps,
    durationInFrames: visualTiming.durationInFrames,
    visualClips: compositionVisuals,
    transitions,
    audioClips,
    subtitles,
    subtitleFont: plan.renderSettings.subtitleFont ?? DEFAULT_SUBTITLE_FONT_ID,
  };
}

/**
 * 旧 layers 二元组 → layerStack(08-19 multilayer-composition Child1):
 * 背景层 damp=1-0.4·parallax(与旧 bgDamp 公式逐值一致,既有双层成片像素级
 * 不变),主体层 damp=1(吃满运镜)。ambient 保留在 clip 级(旧路径主体独享
 * ambient 的行为由渲染端 layerStack 分支同样支持——此处不迁移,避免双重施加)。
 */
export function layerStackFromLegacyTuple(tuple: {
  backgroundSrc: string;
  subjectSrc: string;
  parallax?: number;
}): CompositionLayerSpec[] {
  const parallax = Math.min(1, Math.max(0, tuple.parallax ?? 0.5));
  return [
    { role: "background", src: tuple.backgroundSrc, panZoomDamp: 1 - 0.4 * parallax },
    { role: "subject", src: tuple.subjectSrc, panZoomDamp: 1 },
  ];
}

export interface ChapterVideoSourceInput {
  plan: TimelineRenderPlan;
  currentShotSlots: readonly RemotionCurrentSlotV1[];
  chapterManifest: RemotionChapterManifestV2;
  /** Absolute paths resolved by the host for the current shot slots. The
   * persisted slot keeps project-relative outputPath, while video-use EDL
   * projection may persist an absolute path; both must resolve to one source. */
  currentShotSlotPaths?: Readonly<Record<string, string>>;
  /** Accepted video-use evidence authorizes editable EDL derived inputs. */
  videoWorkflowGate?: RemotionChapterGateAcceptedV1;
}

export interface ChapterVideoCompositionInput extends ChapterVideoSourceInput {
  mediaUrlByClipId: Readonly<Record<string, string>>;
  mediaUrlByBindingId: Readonly<Record<string, string>>;
  /** LUT 资产 URL（lutId → media-bridge URL；渲染入口注册 frontend/assets/luts）。
   * plan.effects 含 grade 效果时必填，缺失 fail-closed。 */
  lutUrlById?: Readonly<Record<string, string>>;
  /** 转场音效资产 URL（sfx 名 → media-bridge URL；渲染入口注册 frontend/assets/sfx）。
   * 提供时对每个非 cut 转场派生一条 sfx 音轨（08-18-sfx-beat，kind="sfx"）。 */
  sfxUrlById?: Readonly<Record<string, string>>;
  /** 转场音效派生开关（默认 false——2026-08-19 用户裁定转场≠音效）。 */
  transitionSfxEnabled?: boolean;
  /** 字幕句音效类别（storyboardId → subtitle-sfx.ts 类别 id；host 从分镜记录
   * shotFx.sfx 读出）。subtitleSfxEnabled 开启时按字幕 cue 帧派生音轨。 */
  sfxCategoryByStoryboardId?: Readonly<Record<string, string>>;
  /** BGM 节拍时刻（µs，升序；ffmpeg 能量峰预计算——渲染期禁异步，M11 口径）。
   * 提供时 sfx 起点向最近节拍吸附（|Δ|≤4 帧且不越转场窗），出界回退原时刻。 */
  beatTimesUs?: readonly number[];
  /** 图层分离分层资产(08-19):clipId → 背景/主体层 URL;仅对静帧片段生效。 */
  layerUrlByClipId?: Readonly<Record<string, { backgroundSrc: string; subjectSrc: string; parallax?: number }>>;
  hyperFramesOverlay?: {
    src: string;
    windows: readonly HyperFramesOverlayWindowV1[];
  };
  /** 主进程渲染主机注入的自定义字体面（capability URL；仅当前字幕字体为
   * custom:* 时非空，烧录端 delayRender 挂载）。 */
  customFontFaces?: Array<{ family: string; url: string }>;
}

export interface ChapterVoiceInterval {
  startFrame: number;
  endFrame: number;
}

export type ChapterVoiceIntervalResult =
  | { success: true; value: ChapterVoiceInterval[] }
  | { success: false; issues: Array<{ path: string; message: string }> };

export type ChapterVideoCompositionResult =
  | { success: true; value: ChapterVideoCompositionProps }
  | { success: false; issues: Array<{ path: string; message: string }> };

/**
 * Projects a validated chapter plan into the ChapterVideo target. Every
 * visual clip must be backed by the matching current Remotion shot slot. Shared
 * audio is projected only from the validated current chapter manifest.
 */
export function buildChapterVideoCompositionProps(
  input: ChapterVideoCompositionInput,
): ChapterVideoCompositionResult {
  const authorityValidation = validateCompositionSubtitleAuthority(input);
  if (!authorityValidation.success) return authorityValidation;
  const sourceValidation = inspectChapterVideoSource(input);
  if (!sourceValidation.success) return sourceValidation;

  const base = buildCompositionProps(input.plan, input.mediaUrlByClipId, input.lutUrlById, input.layerUrlByClipId);
  const audioClips: Array<CompositionAudioClipProps & { renderScope: "chapter" }> =
    input.chapterManifest.sharedAudioBindings.flatMap((binding) => {
      const from = usToFrames(binding.chapterStartUs, base.fps);
      const requestedDurationInFrames = clipDurationInFrames(binding.durationUs, base.fps);
      const durationInFrames = Math.min(
        requestedDurationInFrames,
        Math.max(0, base.durationInFrames - from),
      );
      // A shared track may intentionally outlive the edited chapter. It is
      // still valid manifest data, but there is no frame to render after the
      // chapter boundary; omit that empty projection instead of handing
      // Remotion an out-of-range Sequence.
      if (durationInFrames <= 0) return [];
      return {
        clipId: binding.bindingId,
        kind: binding.role,
        src: requireCapabilityUrl(input.mediaUrlByBindingId[binding.bindingId], binding.bindingId),
        from,
        durationInFrames,
        volume: binding.volume,
        renderScope: "chapter",
        trimStartFrames: usToFrames(binding.sourceStartUs, base.fps),
        playbackRate: 1,
        fade: {
          fadeInFrames: Math.min(usToFrames(binding.fadeInUs, base.fps), durationInFrames),
          fadeOutFrames: Math.min(usToFrames(binding.fadeOutUs, base.fps), durationInFrames),
        },
        envelope: projectEnvelopeForDuration(binding.envelope, durationInFrames, base.fps),
        duckingEnvelope: buildDuckingEnvelope({
          voiceIntervals: sourceValidation.value,
          clipFrom: from,
          durationInFrames,
          ducking: binding.ducking,
          fps: base.fps,
        }),
      };
    });
  // 转场音效派生音轨——2026-08-19 用户拍板停用：转场≠音效，机械式每转场配一声
  // 不专业；专业做法=音效跟随叙事内容（剑击配金属声/雷鸣配雷声），由 AI 从
  // 台词/旁白中识别戏剧性时刻插入，不与转场绑定。sfxUrlById 传入时仍生效
  // （保留管线供未来剧本驱动音效使用），standalone 默认不传=零派生。
  if (input.sfxUrlById && Object.keys(input.sfxUrlById).length > 0 && input.transitionSfxEnabled === true) {
    audioClips.push(...deriveTransitionSfxClips(base, input.beatTimesUs, input.sfxUrlById));
  }
  // 字幕驱动音效（08-19 任务3）：音效随文字诉说——分镜记录 shotFx.sfx 的语义
  // 类别 × 字幕 cue 帧派生（每镜≤1 条、音量克制）；与上面的转场派生严格隔离，
  // 独立开关 subtitleSfxEnabled（默认 false）。
  if (
    input.plan.renderSettings.subtitleSfxEnabled === true
    && input.sfxUrlById
    && Object.keys(input.sfxUrlById).length > 0
  ) {
    audioClips.push(...deriveSubtitleSfxClips({
      plan: input.plan,
      sfxUrlById: input.sfxUrlById,
      categoryByStoryboardId: input.sfxCategoryByStoryboardId ?? {},
    }));
  }
  const overlayClips = projectHyperFramesOverlay(input.hyperFramesOverlay, base.durationInFrames, base.fps);
  const suppressedCueIds = authorityValidation.suppressedCueIds;
  const props: ChapterVideoCompositionProps = {
    ...base,
    target: "chapter",
    projectId: input.plan.projectId,
    chapterId: input.plan.episodeId,
    editingProjectId: input.plan.editingProjectId,
    editingRevision: input.plan.editingRevision,
    visualClips: base.visualClips.map((clip) => ({ ...clip, muted: false })),
    subtitles: base.subtitles.filter((cue) => !suppressedCueIds.has(cue.cueId)),
    audioClips,
    ...(input.customFontFaces?.length ? { customFonts: input.customFontFaces } : {}),
    ...(overlayClips.length > 0 ? { overlayClips } : {}),
  };
  const validation = validateChapterVideoCompositionProps(props);
  if (!validation.success) return { success: false, issues: validation.issues };
  return { success: true, value: validation.value };
}

type AuthorityValidation =
  | { success: true; suppressedCueIds: Set<string> }
  | { success: false; issues: Array<{ path: string; message: string }> };

/** Validate explicit subtitle ownership before media bridge/browser startup. */
function validateCompositionSubtitleAuthority(input: ChapterVideoCompositionInput): AuthorityValidation {
  return validateSubtitleAuthorityForTimeline(input.plan, input.hyperFramesOverlay?.windows);
}

/** Pure authority gate used before media bridge/browser startup. */
export function validateSubtitleAuthorityForTimeline(
  plan: TimelineRenderPlan,
  hyperFramesWindows: readonly HyperFramesOverlayWindowV1[] = [],
): AuthorityValidation {
  const visualClips = plan.clips.filter((clip) => clip.trackKind === "video" || clip.trackKind === "image");
  const authorityIntervals = visualClips
    .map((clip) => ({
      intervalId: clip.id,
      authority: clip.source.evidence?.subtitleAuthority,
      cues: plan.clips
        .filter((cue) => cue.trackKind === "text" && overlaps(cue.startUs, cue.durationUs, clip.startUs, clip.durationUs))
        .map((cue) => ({ cueId: cue.id, text: cue.source.text ?? "", startUs: cue.startUs, durationUs: cue.durationUs })),
      overlayCueIds: hyperFramesWindows
        .filter((window) => TEXT_HYPERFRAMES_TEMPLATES.has(window.templateId))
        .filter((window) => overlaps(window.startUs, window.durationUs, clip.startUs, clip.durationUs))
        .map((window) => window.cueId),
    }));
  if (authorityIntervals.length === 0) return { success: true, suppressedCueIds: new Set() };
  const resolved = resolveSubtitleAuthority(authorityIntervals);
  if (resolved.blocked) {
    return {
      success: false,
      issues: resolved.issues.map((issue) => ({ path: issue.path, message: issue.message })),
    };
  }
  const embeddedText = resolved.intervals.find((interval) => interval.mode === "source-embedded" && interval.cues.length > 0);
  if (embeddedText) {
    return { success: false, issues: [{ path: `visualIntervals`, message: "source-embedded 禁止 Remotion text clip" }] };
  }
  const suppressedCueIds = new Set(
    resolved.intervals.flatMap((interval) => interval.cues
      .filter((cue) => cue.owner !== "remotion-text")
      .map((cue) => cue.cueId)),
  );
  if (resolved.intervals.some((interval) => interval.mode === "source-embedded"
    && (hyperFramesWindows.some((window) => {
      const visual = visualClips.find((clip) => clip.id === interval.intervalId);
      return TEXT_HYPERFRAMES_TEMPLATES.has(window.templateId)
        && (visual ? overlaps(window.startUs, window.durationUs, visual.startUs, visual.durationUs) : false);
    }) ?? false))) {
    return { success: false, issues: [{ path: "hyperFramesOverlay", message: "source-embedded 禁止 HyperFrames overlay" }] };
  }
  return { success: true, suppressedCueIds };
}

function overlaps(leftStart: number, leftDuration: number, rightStart: number, rightDuration: number): boolean {
  return leftStart < rightStart + rightDuration && rightStart < leftStart + leftDuration;
}

/** 中文字幕舒适阅读约 4.5 字/秒；短促台词（如 0.3s 的「找死！」）按语音时长
 * 展示会"赶字"，观众读不完。 */
const SUBTITLE_READ_CHARS_PER_SEC = 4.5;
const SUBTITLE_MIN_DURATION_US = 900_000;

interface SubtitleCueDraft {
  cueId: string;
  text: string;
  from: number;
  audioSpanFrames: number;
}

/**
 * 把音频对齐的句级 cue 投影成可读字幕：停留时长取 max(语音时长, 可读下限)，
 * 延长只占语音结束后的静默段（画面应等语音与字幕结束再切，见转场钳制），
 * 且不得越过下一条 cue 的起点（防双字幕同屏）与 composition 末帧
 * （fail-closed 校验禁止越界 Sequence）。
 */
export function readableSubtitleCues(
  drafts: readonly SubtitleCueDraft[],
  compositionDurationInFrames: number,
  fps: number,
): Array<{ cueId: string; text: string; from: number; durationInFrames: number }> {
  const projected = drafts.map((draft) => ({ ...draft, durationInFrames: 0 }));
  for (let index = 0; index < projected.length; index += 1) {
    const cue = projected[index]!;
    const next = projected[index + 1];
    const ceiling = Math.min(
      compositionDurationInFrames,
      next ? next.from - 1 : Number.MAX_SAFE_INTEGER,
    );
    const minReadableFrames = usToFrames(
      Math.max(
        SUBTITLE_MIN_DURATION_US,
        Math.ceil((cue.text.length / SUBTITLE_READ_CHARS_PER_SEC) * MICROSECONDS_PER_SECOND),
      ),
      fps,
    );
    cue.durationInFrames = Math.max(
      1,
      Math.min(ceiling - cue.from, Math.max(cue.audioSpanFrames, minReadableFrames)),
    );
  }
  return projected.map(({ cueId, text, from, durationInFrames }) => ({
    cueId,
    text,
    from,
    durationInFrames,
  }));
}

function projectEnvelopeForDuration(
  envelope: RemotionChapterManifestV2["sharedAudioBindings"][number]["envelope"],
  durationInFrames: number,
  fps: number,
): CompositionEnvelopePoint[] {
  const projected = envelope
    .map((point) => ({ frame: usToFrames(point.timeUs, fps), gain: point.gain }))
    .filter((point) => point.frame <= durationInFrames);
  if (projected.length === 0) return [];
  if (projected[0]!.frame > 0) {
    projected.unshift({ frame: 0, gain: projected[0]!.gain });
  }
  const last = projected[projected.length - 1]!;
  if (last.frame < durationInFrames) {
    projected.push({ frame: durationInFrames, gain: last.gain });
  }
  return projected;
}

export function mapEditedVoiceIntervals(
  input: ChapterVideoSourceInput,
): ChapterVoiceIntervalResult {
  return inspectChapterVideoSource(input);
}

function projectHyperFramesOverlay(
  overlay: ChapterVideoCompositionInput["hyperFramesOverlay"],
  compositionDurationInFrames: number,
  fps: number,
): CompositionOverlayClipProps[] {
  if (!overlay || overlay.windows.length === 0) return [];
  const endUs = Math.max(...overlay.windows.map((window) => window.startUs + window.durationUs));
  const durationInFrames = clipDurationInFrames(endUs, fps);
  if (durationInFrames > compositionDurationInFrames) {
    throw new Error("HyperFrames overlay 时长超出 ChapterVideo composition");
  }
  return [{
    clipId: "hyperframes-overlay",
    src: overlay.src,
    from: 0,
    durationInFrames,
  }];
}

function inspectChapterVideoSource(
  input: ChapterVideoSourceInput,
): ChapterVoiceIntervalResult {
  const issues: Array<{ path: string; message: string }> = [];
  const manifest = input.chapterManifest;
  if (manifest.projectId !== input.plan.projectId
    || manifest.chapterId !== input.plan.episodeId
    || manifest.sourceSnapshotHash !== input.plan.sourceSnapshotHash) {
    issues.push({ path: "chapterManifest", message: "chapter manifest 与当前 plan 的 project/chapter/source identity 不一致" });
  }
  const editingAudio = input.plan.clips.filter((clip) => (
    clip.trackKind === "voice" || clip.trackKind === "bgm" || clip.trackKind === "sfx"
  ));
  if (editingAudio.length > 0) {
    issues.push({ path: "plan.clips", message: "ChapterVideo 禁止从 EditingProject 投影 voice/BGM/SFX 音频" });
  }
  const slotsByShotId = new Map<string, RemotionCurrentSlotV1>();
  const validShotSlots: Array<{ index: number; shotId: string }> = [];
  for (const [index, slot] of input.currentShotSlots.entries()) {
    const validation = validateCurrentSlot(slot);
    if (!validation.success) {
      issues.push({ path: `currentShotSlots[${index}]`, message: validation.issues.map((issue) => issue.message).join("；") });
      continue;
    }
    if (validation.value.projectId !== input.plan.projectId
      || validation.value.target.kind !== "shot"
      || validation.value.target.chapterId !== input.plan.episodeId
      || validation.value.evidence.compositionId !== "StoryboardShot"
      || validation.value.evidence.renderer.actual !== "remotion") {
      issues.push({ path: `currentShotSlots[${index}]`, message: "shot current slot 不属于当前项目/章节或不是 Remotion 成功输出" });
      continue;
    }
    if (slotsByShotId.has(validation.value.target.shotId)) {
      issues.push({ path: `currentShotSlots[${index}]`, message: "同一 shot 不得提供多个 current slot" });
      continue;
    }
    slotsByShotId.set(validation.value.target.shotId, validation.value);
    validShotSlots.push({ index, shotId: validation.value.target.shotId });
  }

  const visualClips = input.plan.clips
    .filter((clip) => clip.trackKind === "video" || clip.trackKind === "image")
    .sort(compareTimelineClips);
  if (visualClips.length === 0) {
    issues.push({ path: "plan.clips", message: "章节必须包含至少一个 Remotion shot visual clip" });
  }
  // flat-shot-mp4 projection deliberately has one clean MP4 visual clip and
  // no storyboardId. It still carries the accepted artifact fingerprint so
  // the final gate can bind the source without pretending it is 43 shots.
  const flatProjection = visualClips.length === 1
    && visualClips[0]?.source.kind === "storyboardVideo"
    && typeof visualClips[0]?.source.evidence?.storyboardId !== "string";
  if (flatProjection) {
    const clip = visualClips[0]!;
    const sourcePath = clip.source.path?.trim() ?? "";
    if (!path.isAbsolute(sourcePath)) {
      issues.push({ path: "visualClips[0].source.path", message: "flat-shot-mp4 必须绑定绝对 clean MP4 路径" });
    }
    if (!isSha256(clip.source.evidence?.sourceFingerprint)) {
      issues.push({ path: "visualClips[0].source.evidence.sourceFingerprint", message: "flat-shot-mp4 缺少 video-use artifact SHA-256" });
    }
    if (input.videoWorkflowGate) {
      if (input.videoWorkflowGate.mode !== "flat-shot-mp4") {
        issues.push({ path: "videoWorkflowGate.mode", message: "flat projection 必须绑定 flat-shot-mp4 gate" });
      } else {
        if (clip.source.evidence?.sourceFingerprint !== input.videoWorkflowGate.videoUseArtifactSha256) {
          issues.push({ path: "visualClips[0].source.evidence.sourceFingerprint", message: "flat clean MP4 未绑定当前 video-use artifact" });
        }
        if (!input.videoWorkflowGate.videoUseFlatShotMp4Path
          || !pathsEquivalentForComposition(sourcePath, input.videoWorkflowGate.videoUseFlatShotMp4Path)) {
          issues.push({ path: "visualClips[0].source.path", message: "flat clean MP4 路径与 video-use gate 不一致" });
        }
      }
    }
  }
  const requiredShotIds = new Set<string>();
  const manifestShotById = new Map(manifest.shots.map((shot) => [shot.shotId, shot]));
  for (const [index, clip] of visualClips.entries()) {
    if (flatProjection) continue;
    const sourceKind = clip.source.kind;
    const storyboardId = typeof clip.source.evidence?.storyboardId === "string"
      ? clip.source.evidence.storyboardId
      : undefined;
    if (storyboardId) {
      if (requiredShotIds.has(storyboardId)) {
        issues.push({ path: `visualClips[${index}].source.evidence.storyboardId`, message: "章节不得重复绑定同一 Remotion shot" });
      }
      requiredShotIds.add(storyboardId);
    }
    const slot = storyboardId ? slotsByShotId.get(storyboardId) : undefined;
    const manifestShot = storyboardId ? manifestShotById.get(storyboardId) : undefined;
    if (sourceKind !== "storyboardVideo" || !storyboardId || !slot) {
      issues.push({ path: `visualClips[${index}]`, message: "章节视觉片段必须绑定当前 Remotion shot MP4" });
      continue;
    }
    if (slot.target.kind !== "shot") {
      issues.push({ path: `visualClips[${index}]`, message: "章节视觉片段 current slot target 必须是 shot" });
      continue;
    }
    if (!manifestShot || manifestShot.storyboardId !== storyboardId) {
      issues.push({ path: `visualClips[${index}].source.evidence.storyboardId`, message: "视觉片段未精确匹配 chapter manifest shot/storyboard identity" });
      continue;
    }
    const requestedSourcePath = clip.source.path?.trim() ?? "";
    const resolvedCurrentSlotPath = input.currentShotSlotPaths?.[storyboardId] ?? slot.outputPath;
    const requestedProjectRelativePath = projectFileRelativePath(requestedSourcePath, input.plan.projectId);
    const matchesCurrentSlot = requestedSourcePath === slot.outputPath
      || requestedProjectRelativePath === slot.outputPath
      || pathsEquivalentForComposition(requestedSourcePath, resolvedCurrentSlotPath);
    const matchesAcceptedDerivedInput = !matchesCurrentSlot
      && input.videoWorkflowGate?.mode === "editable-edl"
      && clip.source.evidence?.sourceFingerprint === input.videoWorkflowGate.videoUseArtifactSha256
      && path.isAbsolute(requestedSourcePath)
      && input.videoWorkflowGate.videoUseDerivedInputs?.some((entry) =>
        path.resolve(entry.derivedPath) === path.resolve(requestedSourcePath),
      );
    // Identity construction runs before the final gate is available. Allow a
    // clearly marked absolute derived path to participate in the hash, while
    // the accepted gate below remains mandatory before any media is rendered.
    const provisionalDerivedInput = !matchesCurrentSlot
      && !input.videoWorkflowGate
      && path.isAbsolute(requestedSourcePath)
      && isSha256(clip.source.evidence?.sourceFingerprint);
    if (!matchesCurrentSlot && !matchesAcceptedDerivedInput && !provisionalDerivedInput) {
      issues.push({ path: `visualClips[${index}].source.path`, message: "视觉片段路径与 current shot slot 不一致" });
    }
    if (clip.source.evidence?.remotionJobId !== slot.job.jobId
      || clip.source.evidence?.remotionEvidenceSha256 !== slot.evidence.sha256) {
      issues.push({ path: `visualClips[${index}].source.evidence`, message: "视觉片段缺少匹配的 Remotion job/evidence identity" });
    }
    if (slot.target.kind !== "shot" || clip.source.evidence?.outputVersion !== slot.target.shotRevision) {
      issues.push({ path: `visualClips[${index}].source.evidence.outputVersion`, message: "视觉片段 shot revision 与 current slot 不一致" });
    }
    if (manifestShot.revision !== slot.target.shotRevision) {
      issues.push({ path: `chapterManifest.shots.${manifestShot.shotId}.revision`, message: "chapter manifest shot revision 与 current slot 不一致" });
    }
  }
  if (!flatProjection) {
    for (const { index, shotId } of validShotSlots) {
      if (!requiredShotIds.has(shotId)) {
        issues.push({ path: `currentShotSlots[${index}]`, message: "current shot slot 不得包含章节未引用的额外 shot" });
      }
    }
  }
  const manifestRequired = new Set(manifest.requiredShotIds);
  if (!flatProjection && (manifestRequired.size !== requiredShotIds.size
    || [...requiredShotIds].some((shotId) => !manifestRequired.has(shotId)))) {
    issues.push({ path: "chapterManifest.requiredShotIds", message: "chapter manifest required shots 与编辑后的视觉片段不一致" });
  }
  for (const binding of manifest.sharedAudioBindings) {
    if (binding.renderScope !== "chapter" || (binding.role !== "bgm" && binding.role !== "ambience")) {
      issues.push({ path: `chapterManifest.sharedAudioBindings.${binding.bindingId}`, message: "ChapterVideo 共享音频只允许 chapter-scoped BGM/ambience/sfx" });
    }
  }
  if (issues.length > 0) return { success: false, issues };

  if (flatProjection) return { success: true, value: [] };

  const visualTiming = layoutVisualTimeline(
    visualClips.map((clip) => ({ clipId: clip.id, durationUs: clip.durationUs })),
    input.plan.transitions.map((transition) => ({
      fromClipId: transition.fromClipId,
      toClipId: transition.toClipId,
      effectId: transition.effectId,
      durationUs: transition.durationUs,
    })),
    input.plan.renderSettings.fps,
  );
  const timingById = new Map(visualTiming.clips.map((timing) => [timing.clipId, timing]));
  const transitionIssues = validateTransitionVoiceSafety(
    input.plan.transitions,
    visualClips,
    timingById,
    manifestShotById,
    visualTiming.fps,
  );
  if (transitionIssues.length > 0) return { success: false, issues: transitionIssues };
  const voiceIntervals: ChapterVoiceInterval[] = [];
  for (const clip of visualClips) {
    const storyboardId = clip.source.evidence.storyboardId;
    const shot = manifestShotById.get(storyboardId!);
    const timing = timingById.get(clip.id);
    if (!shot || !timing) continue;
    const sourceEndUs = clip.trimStartUs + clip.durationUs * clip.speed;
    for (const binding of shot.audioBindings) {
      if (binding.role !== "voice") continue;
      const intersectionStartUs = Math.max(binding.shotStartUs, clip.trimStartUs);
      const intersectionEndUs = Math.min(binding.shotStartUs + binding.durationUs, sourceEndUs);
      if (intersectionEndUs <= intersectionStartUs) continue;
      const startFrame = Math.max(
        timing.from,
        timing.from + usToFrames((intersectionStartUs - clip.trimStartUs) / clip.speed, visualTiming.fps),
      );
      const endFrame = Math.min(
        timing.from + timing.durationInFrames,
        timing.from + usToFrames((intersectionEndUs - clip.trimStartUs) / clip.speed, visualTiming.fps),
      );
      if (endFrame > startFrame) voiceIntervals.push({ startFrame, endFrame });
    }
  }
  return { success: true, value: mergeVoiceIntervals(voiceIntervals) };
}

function pathsEquivalentForComposition(left: string, right: string): boolean {
  if (!left || !right) return false;
  const normalize = (value: string) => path.normalize(value.replace(/^\/private\/var(?:\/|$)/, "/var/"));
  return normalize(left) === normalize(right);
}

function projectFileRelativePath(sourcePath: string, projectId: string): string | null {
  try {
    const parsed = parseProjectFileUrl(sourcePath);
    return parsed?.projectId === projectId ? parsed.relativePath : null;
  } catch {
    return null;
  }
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

export function buildDuckingEnvelope(input: {
  voiceIntervals: readonly ChapterVoiceInterval[];
  clipFrom: number;
  durationInFrames: number;
  ducking: RemotionChapterManifestV2["sharedAudioBindings"][number]["ducking"];
  fps: number;
}): CompositionEnvelopePoint[] {
  if (!input.ducking.enabled || input.voiceIntervals.length === 0) {
    return [{ frame: 0, gain: 1 }, { frame: input.durationInFrames, gain: 1 }];
  }
  const holdGain = 10 ** (input.ducking.reductionDb / 20);
  const attackFrames = usToFrames(input.ducking.attackUs, input.fps);
  const releaseFrames = usToFrames(input.ducking.releaseUs, input.fps);
  const values = Array.from({ length: input.durationInFrames + 1 }, (_, localFrame) => {
    const chapterFrame = input.clipFrom + localFrame;
    let gain = 1;
    for (const interval of input.voiceIntervals) {
      gain = Math.min(gain, duckGainAtFrame(chapterFrame, interval, holdGain, attackFrames, releaseFrames));
    }
    return gain;
  });
  return compressFrameEnvelope(values);
}

function duckGainAtFrame(
  frame: number,
  interval: ChapterVoiceInterval,
  holdGain: number,
  attackFrames: number,
  releaseFrames: number,
): number {
  if (frame < interval.startFrame) {
    if (attackFrames === 0 || frame <= interval.startFrame - attackFrames) return 1;
    const progress = (frame - (interval.startFrame - attackFrames)) / attackFrames;
    return 1 + (holdGain - 1) * progress;
  }
  if (frame <= interval.endFrame) return holdGain;
  if (releaseFrames === 0 || frame >= interval.endFrame + releaseFrames) return 1;
  const progress = (frame - interval.endFrame) / releaseFrames;
  return holdGain + (1 - holdGain) * progress;
}

function compressFrameEnvelope(values: readonly number[]): CompositionEnvelopePoint[] {
  if (values.length <= 1) return [{ frame: 0, gain: values[0] ?? 1 }];
  const points: CompositionEnvelopePoint[] = [{ frame: 0, gain: values[0]! }];
  let previousSlope = values[1]! - values[0]!;
  for (let frame = 2; frame < values.length; frame += 1) {
    const slope = values[frame]! - values[frame - 1]!;
    if (Math.abs(slope - previousSlope) > 1e-12) {
      points.push({ frame: frame - 1, gain: values[frame - 1]! });
    }
    previousSlope = slope;
  }
  const lastFrame = values.length - 1;
  if (points.at(-1)?.frame !== lastFrame) points.push({ frame: lastFrame, gain: values[lastFrame]! });
  return points;
}

function mergeVoiceIntervals(intervals: readonly ChapterVoiceInterval[]): ChapterVoiceInterval[] {
  const ordered = [...intervals].sort((left, right) => left.startFrame - right.startFrame || left.endFrame - right.endFrame);
  const merged: ChapterVoiceInterval[] = [];
  for (const interval of ordered) {
    const previous = merged.at(-1);
    if (previous && interval.startFrame <= previous.endFrame) {
      previous.endFrame = Math.max(previous.endFrame, interval.endFrame);
    } else {
      merged.push({ ...interval });
    }
  }
  return merged;
}

/**
 * 章节转场安全门禁：shot MP4 内烧录语音（voice 绑定从头起播），转场重叠会把
 * 下一镜整体提前——重叠一旦越过上一镜语音尾，两镜语音就会在溶镜里同时播放
 * （拼接点"挤压感"的根源）。fail-closed：转场只允许吃上一镜语音结束后的静默尾。
 */
export function validateTransitionVoiceSafety(
  transitions: ReadonlyArray<{ fromClipId: string; toClipId: string; effectId: string }>,
  visualClips: ReadonlyArray<Pick<TimelineRenderClip, "id" | "trackKind" | "startUs" | "durationUs" | "trimStartUs" | "speed" | "source">>,
  timingById: ReadonlyMap<string, { from: number; durationInFrames: number }>,
  manifestShotById: ReadonlyMap<string, RemotionChapterManifestV2["shots"][number]>,
  fps: number,
): Array<{ path: string; message: string }> {
  const issues: Array<{ path: string; message: string }> = [];
  const clipById = new Map(visualClips.map((clip) => [clip.id, clip]));
  for (const [index, transition] of transitions.entries()) {
    if (transition.effectId === "cut") continue;
    const fromClip = clipById.get(transition.fromClipId);
    const toTiming = timingById.get(transition.toClipId);
    const fromTiming = timingById.get(transition.fromClipId);
    if (!fromClip || !fromTiming || !toTiming) continue;
    const storyboardId = fromClip.source.evidence?.storyboardId;
    const shot = typeof storyboardId === "string" ? manifestShotById.get(storyboardId) : undefined;
    if (!shot) continue;
    const sourceEndUs = fromClip.trimStartUs + fromClip.durationUs * fromClip.speed;
    let voiceEndUs = -Infinity;
    for (const binding of shot.audioBindings) {
      if (binding.role !== "voice") continue;
      voiceEndUs = Math.max(voiceEndUs, Math.min(binding.shotStartUs + binding.durationUs, sourceEndUs));
    }
    if (voiceEndUs === -Infinity) continue;
    const voiceEndFrame = fromTiming.from
      + usToFrames((voiceEndUs - fromClip.trimStartUs) / fromClip.speed, fps);
    if (toTiming.from < voiceEndFrame - 1) {
      issues.push({
        path: `plan.transitions[${index}]`,
        message: `转场 ${transition.effectId} 重叠侵入上一镜语音区：下一镜提前到第 ${toTiming.from} 帧，上一镜语音到第 ${voiceEndFrame} 帧才结束——重叠只允许吃上一镜语音结束后的静默尾`,
      });
    }
  }
  return issues;
}

// 转场→音效语义映射（08-18-sfx-beat；Kenney CC0，assets/sfx/）。
const SFX_SFX_DURATION_FRAMES = 15;
function sfxAssetForTransition(effectId: string): string | null {
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
function deriveSubtitleSfxClips(input: {
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
    const src = input.sfxUrlById[asset];
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

function deriveTransitionSfxClips(
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

function ambientForClip(
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

function gradeForClip(
  effect: Pick<EditingEffect, "params"> | undefined,
  lutUrlById: Readonly<Record<string, string>> | undefined,
  clipId: string,
  pulse?: { amp: number; freq: number },
): { grade?: { lutId: string; lutSrc?: string; blend: number; blendPulse?: { amp: number; freq: number } } } {
  if (!effect) return {};
  const params = effect.params as { lutId?: unknown; blend?: unknown } | undefined;
  const lutId = String(params?.lutId ?? "");
  if (!isCinematicLutId(lutId)) {
    throw new Error(`镜 ${clipId} 的 grade.lutId 不在 LUT 闭集: ${lutId || "(空)"}`);
  }
  const blendRaw = Number(params?.blend ?? 1);
  const blend = Number.isFinite(blendRaw) ? Math.min(1, Math.max(0, blendRaw)) : 1;
  const lutSrc = lutUrlById?.[lutId];
  if (!lutSrc) {
    throw new Error(`镜 ${clipId} 的 grade 缺少 LUT 资源 URL（渲染入口须注册 LUT 资产: ${lutId}）`);
  }
  return { grade: { lutId, lutSrc, blend, ...(pulse ? { blendPulse: pulse } : {}) } };
}

function panZoomForClip(effect: Pick<EditingEffect, "params"> | undefined): CompositionPanZoom | undefined {
  if (!effect) return undefined;
  return {
    fromScale: numberParam(effect.params.scaleFrom, 1),
    toScale: numberParam(effect.params.scaleTo, 1.06),
    originX: numberParam(effect.params.x, 0.5),
    originY: numberParam(effect.params.y, 0.5),
  };
}

/** plan.effects 中映射到合成层 CompositionVisualFx 的效果 ID（registry 已定义参数表）。 */
const VISUAL_FX_EFFECT_IDS: ReadonlySet<string> = new Set([
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
function visualFxForClip(effects: readonly EditingEffect[] | undefined): CompositionVisualFx | undefined {
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

function clampRange(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function fadeForClip(clip: TimelineRenderClip, fps: number): CompositionFade | undefined {
  if (clip.fadeInUs === undefined && clip.fadeOutUs === undefined) return undefined;
  return {
    fadeInFrames: usToFrames(clip.fadeInUs ?? 0, fps),
    fadeOutFrames: usToFrames(clip.fadeOutUs ?? 0, fps),
  };
}

function envelopeForClip(
  clip: TimelineRenderClip,
  fps: number,
): CompositionEnvelopePoint[] | undefined {
  return clip.envelope?.map((point) => ({
    frame: usToFrames(point.timeUs, fps),
    gain: point.gain,
  }));
}

function defaultTransform(): CompositionTransform {
  return { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 };
}

function compareTimelineClips(left: TimelineRenderClip, right: TimelineRenderClip): number {
  return left.startUs - right.startUs || left.id.localeCompare(right.id);
}

function requireCapabilityUrl(value: string | undefined, clipId: string): string {
  if (!value || !CAPABILITY_URL.test(value)) {
    throw new Error(`片段 ${clipId} 缺少 127.0.0.1 capability URL`);
  }
  return value;
}

function numberParam(value: string | number | boolean | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function audioKind(clip: TimelineRenderClip): "voice" | "bgm" | "sfx" {
  if (clip.trackKind === "voice" || clip.trackKind === "bgm" || clip.trackKind === "sfx") {
    return clip.trackKind;
  }
  throw new Error(`非音频片段不能投影为音频: ${clip.id}`);
}
