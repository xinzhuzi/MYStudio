import type {
  ProductionTrack,
  StoryboardItem,
  VideoCandidate,
} from "@/types/studio";

export function indexTracksByStoryboard(tracks: ProductionTrack[]) {
  const result = new Map<string, ProductionTrack>();
  for (const track of tracks) {
    for (const storyboardId of track.storyboardIds) {
      if (!result.has(storyboardId)) result.set(storyboardId, track);
    }
  }
  return result;
}

export function indexSelectedCandidates(
  tracks: ProductionTrack[],
  candidates: VideoCandidate[],
) {
  const result = new Map<string, VideoCandidate>();
  const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  for (const track of tracks) {
    if (track.stale || !track.selectedVideoId) continue;
    const candidate = byId.get(track.selectedVideoId);
    if (
      candidate
      && candidate.trackId === track.id
      && candidate.state === "ready"
      && !candidate.stale
      && candidate.filePath
    ) {
      result.set(track.id, candidate);
    }
  }
  return result;
}

export function indexCandidateTrimStarts(
  tracks: ProductionTrack[],
  storyboards: StoryboardItem[],
  baseDurationByStoryboardId: Map<string, number>,
) {
  const result = new Map<string, number>();
  const storyboardById = new Map(
    storyboards.map((storyboard) => [storyboard.id, storyboard]),
  );
  for (const track of tracks) {
    const ordered = track.storyboardIds
      .map((id) => storyboardById.get(id))
      .filter((item): item is StoryboardItem => Boolean(item))
      .sort((left, right) => left.index - right.index || left.id.localeCompare(right.id));
    let trimStartUs = 0;
    for (const storyboard of ordered) {
      result.set(storyboard.id, trimStartUs);
      trimStartUs += baseDurationByStoryboardId.get(storyboard.id) ?? 0;
    }
  }
  return result;
}
