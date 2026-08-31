import type { ChapterVideoCompositionProps, CompositionAudioClipProps } from "./composition-props";
import { validateChapterVideoCompositionProps } from "./composition-props-validation";
import { usToFrames } from "./timing";
import { resolveSubtitleAuthority } from "@/lib/studio/video-workflow/subtitle-authority";
import type { TimelineRenderPlan } from "@/types/editing";
import type { RemotionChapterManifestV2, RemotionCurrentSlotV1 } from "@/types/remotion-workspace";
import type { HyperFramesOverlayWindowV1, RemotionChapterGateAcceptedV1 } from "@rendering/contracts/video-workflow";
import { TEXT_HYPERFRAMES_TEMPLATES, buildDuckingEnvelope, inspectChapterVideoSource, projectEnvelopeForDuration, projectHyperFramesOverlay } from "./composition-audio-subtitle";
import { compareTimelineClips, deriveSubtitleSfxClips, deriveTransitionSfxClips, requireCapabilityUrl } from "./composition-clip-effects";
import { buildCompositionProps } from "./composition-shot";

/**
 * 章节成片合成 props——章级类型/构建器/字幕权威校验。file-size-reduction P1 拆出,体逐字保留。
 */
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
  // 章节共享音频的 chapterStartUs 在编辑(音频)时间轴上,而合成帧网格是转场
  // 重叠压缩后的布局轴(与字幕 layoutShiftFrames 同源)。经"所属镜头锚点"
  // 映射:owner 布局起点 + 镜内偏移;跨边界时长按起终点映射差取值。
  const visualPlanClips = input.plan.clips
    .filter((clip) => clip.trackKind === "video" || clip.trackKind === "image")
    .sort(compareTimelineClips);
  const layoutFromByClipId = new Map(base.visualClips.map((clip) => [clip.clipId, clip.from]));
  const chapterUsToLayoutFrame = (timeUs: number): number => {
    let owner = visualPlanClips[0];
    for (const clip of visualPlanClips) {
      if (clip.startUs <= timeUs) owner = clip;
      else break;
    }
    if (!owner) return 0;
    const layoutFrom = layoutFromByClipId.get(owner.id) ?? 0;
    return Math.max(0, layoutFrom + usToFrames(timeUs - owner.startUs, base.fps));
  };
  const audioClips: Array<CompositionAudioClipProps & { renderScope: "chapter" }> =
    input.chapterManifest.sharedAudioBindings.flatMap((binding) => {
      const from = chapterUsToLayoutFrame(binding.chapterStartUs);
      const requestedDurationInFrames = Math.max(
        1,
        chapterUsToLayoutFrame(binding.chapterStartUs + binding.durationUs) - from,
      );
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

export function overlaps(leftStart: number, leftDuration: number, rightStart: number, rightDuration: number): boolean {
  return leftStart < rightStart + rightDuration && rightStart < leftStart + leftDuration;
}

/** 中文字幕舒适阅读约 4.5 字/秒；短促台词（如 0.3s 的「找死！」）按语音时长
 * 展示会"赶字"，观众读不完。 */
