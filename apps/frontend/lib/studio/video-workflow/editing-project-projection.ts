import type { EditingClip, EditingProjectV1, EditingTransition, SubtitleAuthority } from "@/types/editing";
import type { RemotionCurrentSlotV1 } from "@/types/remotion-workspace";
import { validateEditingProject } from "@/lib/studio/editing/validation";
import { transitionParams } from "@/lib/studio/editing/transition-policy";
import {
  createTimelineEdlEntries,
  validateVideoUseChapterArtifact,
  type VideoUseChapterArtifactV1,
} from "@rendering/contracts/video-workflow";
import { resolveSubtitleAuthority } from "./subtitle-authority";

export interface VideoWorkflowEditingProjectArtifactRefs {
  mode: VideoUseChapterArtifactV1["mode"];
  videoUseArtifactSha256: string;
  flatShotMp4Path?: string;
  subtitleCues: VideoUseChapterArtifactV1["subtitles"];
  overlaySlots: VideoUseChapterArtifactV1["overlaySlots"];
}

export type VideoWorkflowEditingProjectProjectionResult =
  | { success: true; project: EditingProjectV1; artifactRefs: VideoWorkflowEditingProjectArtifactRefs }
  | { success: false; issues: Array<{ path: string; message: string }> };

/**
 * video-use 清洗产物（clean MP4 + 对齐 cue）的产品默认字幕归属：Remotion 烧录。
 * 08-18 前的产物从不写 subtitleAuthority → 渲染层 fail-closed 阻断（靠数据手术
 * 续命）。此默认只用于补缺，不覆盖显式写入的归属。
 */
export function defaultCleanRemotionSubtitleAuthority(
  artifact: VideoUseChapterArtifactV1,
  now: number,
): SubtitleAuthority {
  return {
    mode: "clean-remotion",
    evidence: {
      mode: "clean-remotion",
      decision: "imported-manifest",
      sourceFingerprint: artifact.evidence.artifactSha256,
      evidencePaths: ["video-use-artifact.json"],
      reviewer: "automated",
      reviewedAt: now,
      note: "video-use 清洗产物默认 Remotion 烧录（08-18 五缺口修复）",
    },
  };
}

/** Projects an accepted video-use artifact into the persisted editing timeline.
 * In flat mode the clean MP4 is the sole new visual source. Ordinary subtitle
 * cues become the one Remotion subtitle track; cues assigned to HyperFrames
 * remain overlay metadata and are not duplicated as text clips.
 *
 * shotSlots（可选）提供当前 Remotion shot 输出槽：写入剪辑身份证据
 * （remotionJobId/evidence SHA/revision）并优先采用槽位相对路径，
 * 使渲染门禁「current shot slot 身份/路径一致」按构造满足。
 */
export function projectVideoUseArtifactToEditingProject(input: {
  project: EditingProjectV1;
  artifact: unknown;
  now: number;
  shotSlots?: readonly RemotionCurrentSlotV1[];
}): VideoWorkflowEditingProjectProjectionResult {
  const parsed = validateVideoUseChapterArtifact(input.artifact);
  if (!parsed.success) return { success: false, issues: parsed.issues };
  const artifact = parsed.value;
  const { project } = input;
  if (artifact.projectId !== project.projectId || artifact.chapterId !== project.episodeId) {
    return { success: false, issues: [{ path: "identity", message: "video-use artifact 与 EditingProject project/chapter 不一致" }] };
  }
  // 08-20 修(死循环根因之二):旧闸只认精确 N+1,配合预览编号 max() 跳号,
  // 失败轮次积累后编号永远追不上(r58-r69 十二轮实测)。artifact 自带完整
  // EDL+槽位(自包含),向前应用语义安全——只拒旧不拒新,一次应用即重对齐。
  if (artifact.revision <= project.revision) {
    return { success: false, issues: [{ path: "revision", message: "video-use artifact 已被后续工程修订覆盖(artifact revision 过旧)" }] };
  }
  if (artifact.status !== "accepted" || artifact.stage !== "ready") {
    return { success: false, issues: [{ path: "artifact", message: "仅允许 ready/accepted artifact 投影" }] };
  }
  if (!Number.isSafeInteger(input.now) || input.now < 0) {
    return { success: false, issues: [{ path: "now", message: "时间戳无效" }] };
  }
  const visualTrack = project.tracks.find((track) => track.kind === "video" || track.kind === "image");
  if (!visualTrack) return { success: false, issues: [{ path: "tracks", message: "EditingProject 缺少视觉轨道" }] };
  const oldVisual = new Map(project.clips.filter((clip) => clip.trackId === visualTrack.id).map((clip) => [clip.source.evidence.storyboardId, clip]));
  const subtitleTracks = project.tracks.filter(
    (track) => track.kind === "text" && track.name.includes("字幕"),
  );
  const subtitleTrack = subtitleTracks.find((track) => track.name === "字幕") ?? subtitleTracks[0];
  const subtitleTrackId = subtitleTrack?.id ?? `${project.id}-video-use-subtitles`;
  const subtitleTrackIds = new Set(subtitleTracks.map((track) => track.id));
  const oldSubtitles = project.clips.filter((clip) => subtitleTrackIds.has(clip.trackId));
  const edl = createTimelineEdlEntries(artifact.edl);
  const refs: VideoWorkflowEditingProjectArtifactRefs = {
    mode: artifact.mode,
    videoUseArtifactSha256: artifact.evidence.artifactSha256,
    ...(artifact.flatShotMp4Path ? { flatShotMp4Path: artifact.flatShotMp4Path } : {}),
    subtitleCues: artifact.subtitles,
    overlaySlots: artifact.overlaySlots,
  };
  const persistedAuthority = (artifact as VideoUseChapterArtifactV1 & { subtitleAuthority?: SubtitleAuthority }).subtitleAuthority
    ?? defaultCleanRemotionSubtitleAuthority(artifact, input.now);
  const slotByShotId = new Map(
    (input.shotSlots ?? [])
      .filter((slot) => slot.target.kind === "shot")
      .map((slot) => [slot.target.kind === "shot" ? slot.target.shotId : "", slot]),
  );
  const subtitleAuthority = resolveSubtitleAuthority([{
    intervalId: `${artifact.mode}-${artifact.revision}`,
    authority: persistedAuthority,
    cues: artifact.subtitles.map((cue) => ({ cueId: cue.cueId, text: cue.text, startUs: cue.startUs, durationUs: cue.durationUs })),
    overlayCueIds: artifact.overlaySlots.map((slot) => slot.cueId),
    // Projection consumes the accepted clean/EDL artifact, never the burned-in preview.
    previewSubtitlesBurnedIn: false,
  }]);
  if (subtitleAuthority.blocked) return { success: false, issues: subtitleAuthority.issues.map((issue) => ({ path: issue.path, message: issue.message })) };
  const resolvedCues = subtitleAuthority.intervals[0]?.cues ?? [];
  let nextVisual: EditingClip[];
  if (artifact.mode === "flat-shot-mp4") {
    const sourcePath = artifact.flatShotMp4Path;
    if (!sourcePath) return { success: false, issues: [{ path: "flatShotMp4Path", message: "flat 模式缺少 clean MP4" }] };
    const durationUs = Math.max(...edl.map((entry) => entry.timelineStartUs + entry.durationUs));
    const existing = oldVisual.values().next().value as EditingClip | undefined;
    nextVisual = [{
      ...(existing ?? { id: `video-use-flat-${project.id}-${artifact.revision}`, name: "video-use clean MP4", trimStartUs: 0, speed: 1, volume: 1, muted: false }),
      trackId: visualTrack.id,
      startUs: 0,
      durationUs,
      source: {
        kind: "storyboardVideo",
        path: sourcePath,
        evidence: { sourceFingerprint: artifact.evidence.artifactSha256, subtitleAuthority: persistedAuthority },
      },
    }];
  } else {
    nextVisual = edl.map((entry, index) => {
      const existing = oldVisual.get(entry.shotId);
      const slot = slotByShotId.get(entry.shotId);
      const identity = slot?.target.kind === "shot"
        ? {
          remotionJobId: slot.job.jobId,
          remotionEvidenceSha256: slot.evidence.sha256,
          // 08-20 修:main.ts 章节身份闸要求 remotionInputHash 三全——漏写此字段
          // 导致每次 video-use 应用后「当前章节镜头与 slot identity 不一致」必挂,
          // 一键成片链永远到不了入队步(实测 r58-r61 四轮复现)。
          remotionInputHash: slot.job.inputHash,
          outputVersion: slot.target.shotRevision,
        }
        : {};
      return {
        ...(existing ?? { id: `video-use-${entry.shotId}-${index}`, name: entry.shotId, trimStartUs: entry.sourceInUs, speed: 1, volume: 1, muted: false }),
        trackId: visualTrack.id,
        startUs: entry.timelineStartUs,
        durationUs: entry.durationUs,
        trimStartUs: entry.sourceInUs,
        source: {
          kind: "storyboardVideo" as const,
          // 槽位相对路径与 current slot 按构造逐字一致（渲染门禁直配）；
          // 无槽位时回退 EDL 源路径（保持旧行为，由门禁兜底判定）。
          path: slot?.target.kind === "shot" ? slot.outputPath : entry.sourcePath,
          evidence: {
            ...(existing?.source.evidence ?? {}),
            storyboardId: entry.shotId,
            sourceFingerprint: artifact.evidence.artifactSha256,
            subtitleAuthority: persistedAuthority,
            ...identity,
          },
        },
      };
    });
  }
  const nextSubtitles: EditingClip[] = artifact.subtitles
    .filter((cue) => resolvedCues.find((resolved) => resolved.cueId === cue.cueId)?.owner === "remotion-text")
    .map((cue, index) => ({
      id: `video-use-subtitle-${artifact.revision}-${cue.cueId}`,
      trackId: subtitleTrackId,
      name: `字幕 ${index + 1}`,
      source: {
        kind: "text",
        text: cue.text,
        evidence: {
          storyboardId: cue.shotId,
          cueId: cue.cueId,
          sourceFingerprint: artifact.evidence.artifactSha256,
          subtitleAuthority: persistedAuthority,
        },
      },
      startUs: cue.startUs,
      durationUs: cue.durationUs,
      trimStartUs: 0,
      speed: 1,
      volume: 0,
      muted: true,
      subtitle: { sourceFormat: "generated" },
    }));
  // Rebuild transitions from the accepted EDL boundary decisions. Visual
  // clips were just re-projected, so stale transitions are replaced
  // wholesale — the accepted artifact is the single source of transition
  // truth. "cut" and absent boundaries stay implicit hard cuts.
  const nextTransitions: EditingTransition[] = [];
  if (artifact.mode !== "flat-shot-mp4") {
    for (let index = 0; index < edl.length - 1; index += 1) {
      const entry = edl[index]!;
      const following = edl[index + 1]!;
      const transition = entry.transitionToNext;
      if (!transition || transition.effectId === "cut") continue;
      const fromClip = nextVisual[index];
      const toClip = nextVisual[index + 1];
      if (!fromClip || !toClip) continue;
      nextTransitions.push({
        id: `transition-${entry.shotId}-${following.shotId}`,
        fromClipId: fromClip.id,
        toClipId: toClip.id,
        effectId: transition.effectId,
        durationUs: transition.durationUs,
        params: transitionParams(transition.effectId),
      });
    }
  }
  const replacedClips = new Set<EditingClip>([...oldVisual.values(), ...oldSubtitles]);
  const clips = [...project.clips.filter((clip) => !replacedClips.has(clip)), ...nextVisual, ...nextSubtitles];
  const mappedTracks = project.tracks
    .filter((track) => !subtitleTrackIds.has(track.id) || track.id === subtitleTrackId)
    .map((track) => {
      if (track.id === visualTrack.id) return { ...track, clipIds: nextVisual.map((clip) => clip.id) };
      if (track.id === subtitleTrackId) return { ...track, clipIds: nextSubtitles.map((clip) => clip.id) };
      return track;
    });
  const tracks = subtitleTrack || nextSubtitles.length === 0
    ? mappedTracks
    : [...mappedTracks, {
        id: subtitleTrackId,
        kind: "text" as const,
        name: "字幕",
        order: Math.max(-1, ...project.tracks.map((track) => track.order)) + 1,
        clipIds: nextSubtitles.map((clip) => clip.id),
        muted: false,
        locked: false,
      }];
  const next: EditingProjectV1 = {
    ...project,
    revision: artifact.revision,
    manuallyEdited: true,
    clips,
    tracks,
    transitions: nextTransitions,
    renderSettings: { ...project.renderSettings, subtitleMode: subtitleAuthority.subtitleMode },
    updatedAt: input.now,
  };
  const validated = validateEditingProject(next);
  if (!validated.success) {
    return {
      success: false,
      issues: validated.issues.map((issue) => ({ path: issue.path, message: issue.message })),
    };
  }
  return { success: true, project: validated.value, artifactRefs: refs };
}
