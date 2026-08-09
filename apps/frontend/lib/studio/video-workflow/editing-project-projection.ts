import type { EditingClip, EditingProjectV1 } from "@/types/editing";
import {
  createTimelineEdlEntries,
  validateVideoUseChapterArtifact,
  type VideoUseChapterArtifactV1,
} from "@rendering/contracts/video-workflow";

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
 * In flat mode the clean MP4 is the sole new visual source; subtitle/audio/
 * overlay metadata stays in artifactRefs and is never duplicated as clips.
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
  const edl = createTimelineEdlEntries(artifact.edl);
  const refs: VideoWorkflowEditingProjectArtifactRefs = {
    mode: artifact.mode,
    videoUseArtifactSha256: artifact.evidence.artifactSha256,
    ...(artifact.flatShotMp4Path ? { flatShotMp4Path: artifact.flatShotMp4Path } : {}),
    subtitleCues: artifact.subtitles,
    overlaySlots: artifact.overlaySlots,
  };
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
      source: { kind: "storyboardVideo", path: sourcePath, evidence: { sourceFingerprint: artifact.evidence.artifactSha256 } },
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
        source: { kind: "storyboardVideo", path: entry.sourcePath, evidence: { ...(existing?.source.evidence ?? {}), storyboardId: entry.shotId, sourceFingerprint: artifact.evidence.artifactSha256 } },
      };
    });
  }
  const replacedIds = new Set(oldVisual.values());
  const clips = [...project.clips.filter((clip) => !replacedIds.has(clip)), ...nextVisual];
  const next: EditingProjectV1 = { ...project, revision: artifact.revision, manuallyEdited: true, clips, tracks: project.tracks.map((track) => track.id === visualTrack.id ? { ...track, clipIds: nextVisual.map((clip) => clip.id) } : track), updatedAt: input.now };
  return { success: true, project: next, artifactRefs: refs };
}
