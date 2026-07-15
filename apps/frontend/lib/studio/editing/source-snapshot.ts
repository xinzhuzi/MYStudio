import type { ScriptPlan, StoryboardItem, ProductionTrack, VideoCandidate } from "@/types/studio";

export interface EditingSourceSnapshotInput {
  projectId: string;
  episodeId: string;
  aspectRatio?: string;
  directorPlan?: ScriptPlan;
  storyboards: StoryboardItem[];
  productionTracks: ProductionTrack[];
  videoCandidates: VideoCandidate[];
}

export async function buildEditingSourceSnapshotHash(
  input: EditingSourceSnapshotInput,
) {
  const canonical = JSON.stringify({
    projectId: input.projectId,
    episodeId: input.episodeId,
    aspectRatio: input.aspectRatio ?? "9:16",
    directorPlan: input.directorPlan ?? null,
    storyboards: input.storyboards
      .filter((item) => item.episodeId === input.episodeId)
      .sort((left, right) => left.index - right.index || left.id.localeCompare(right.id))
      .map((item) => ({
        id: item.id,
        index: item.index,
        trackId: item.trackId,
        duration: item.duration,
        durationTarget: item.durationTarget,
        line: item.ttsSpokenText ?? item.line ?? item.lines,
        mediaRef: item.mediaRef,
        audioRef: item.audioRef,
        sourceFingerprint: item.sourceFingerprint,
        outputVersion: item.outputVersion,
        stale: item.stale,
      })),
    productionTracks: input.productionTracks
      .filter((item) => item.episodeId === input.episodeId)
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((item) => ({
        id: item.id,
        storyboardIds: [...item.storyboardIds],
        selectedVideoId: item.selectedVideoId,
        duration: item.duration,
        sourceFingerprint: item.sourceFingerprint,
        outputVersion: item.outputVersion,
        stale: item.stale,
      })),
    videoCandidates: input.videoCandidates
      .filter((item) => input.productionTracks.some((track) => track.id === item.trackId))
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((item) => ({
        id: item.id,
        trackId: item.trackId,
        state: item.state,
        filePath: item.filePath,
        sourceFingerprint: item.sourceFingerprint,
        outputVersion: item.outputVersion,
        stale: item.stale,
      })),
  });
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonical),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
