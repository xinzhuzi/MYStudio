import type { EditingClip, EditingProjectV1, EditingTransition, SubtitleAuthority } from "@/types/editing";
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

/** Projects an accepted video-use artifact into the persisted editing timeline.
 * In flat mode the clean MP4 is the sole new visual source. Ordinary subtitle
 * cues become the one Remotion subtitle track; cues assigned to HyperFrames
 * remain overlay metadata and are not duplicated as text clips.
 */
export function projectVideoUseArtifactToEditingProject(input: {
  project: EditingProjectV1;
  artifact: unknown;
  now: number;
}): VideoWorkflowEditingProjectProjectionResult {
  const parsed = validateVideoUseChapterArtifact(input.artifact);
  if (!parsed.success) return { success: false, issues: parsed.issues };
  const artifact = parsed.value;
  const { project } = input;
  if (artifact.projectId !== project.projectId || artifact.chapterId !== project.episodeId) {
    return { success: false, issues: [{ path: "identity", message: "video-use artifact 与 EditingProject project/chapter 不一致" }] };
  }
  if (artifact.revision !== project.revision + 1) {
    return { success: false, issues: [{ path: "revision", message: "video-use artifact 必须作为 EditingProject 的下一 revision 应用" }] };
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
  const subtitleTrack = project.tracks.find((track) => track.kind === "text" && track.name === "字幕");
  const subtitleTrackId = subtitleTrack?.id ?? `${project.id}-video-use-subtitles`;
  const oldSubtitles = subtitleTrack
    ? project.clips.filter((clip) => clip.trackId === subtitleTrack.id)
    : [];
  const edl = createTimelineEdlEntries(artifact.edl);
  const refs: VideoWorkflowEditingProjectArtifactRefs = {
    mode: artifact.mode,
    videoUseArtifactSha256: artifact.evidence.artifactSha256,
    ...(artifact.flatShotMp4Path ? { flatShotMp4Path: artifact.flatShotMp4Path } : {}),
    subtitleCues: artifact.subtitles,
    overlaySlots: artifact.overlaySlots,
  };
  const persistedAuthority = (artifact as VideoUseChapterArtifactV1 & { subtitleAuthority?: SubtitleAuthority }).subtitleAuthority;
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
      return {
        ...(existing ?? { id: `video-use-${entry.shotId}-${index}`, name: entry.shotId, trimStartUs: entry.sourceInUs, speed: 1, volume: 1, muted: false }),
        trackId: visualTrack.id,
        startUs: entry.timelineStartUs,
        durationUs: entry.durationUs,
        trimStartUs: entry.sourceInUs,
        source: {
          kind: "storyboardVideo",
          path: entry.sourcePath,
          evidence: {
            ...(existing?.source.evidence ?? {}),
            storyboardId: entry.shotId,
            sourceFingerprint: artifact.evidence.artifactSha256,
            subtitleAuthority: persistedAuthority,
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
  const mappedTracks = project.tracks.map((track) => {
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
