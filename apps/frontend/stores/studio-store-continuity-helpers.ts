import { markContinuityDependentsStale } from "@/lib/studio/visual-continuity";
import type {
  ContinuityAssetVersion,
  ProductionTrack,
  StoryboardItem,
  VideoCandidate,
} from "@/types/studio";

export function continuityAssetVersionKey(version: Pick<ContinuityAssetVersion, "assetId" | "versionId">) {
  return `${version.assetId}:${version.versionId}`;
}

export function invalidateStoryboardsForAssetVersionChanges(
  storyboards: StoryboardItem[],
  changedKeys: Set<string>,
  staleReason = "引用的角色、场景或道具基准资产已变化",
  reviewReason = "引用资产已变化，必须重新生成并审核",
) {
  const staleSince = Date.now();
  const directlyAffectedIds = storyboards
    .filter((storyboard) => storyboard.orderedReferenceManifest?.some((reference) => (
      changedKeys.has(`${reference.assetId}:${reference.versionId ?? ""}`)
    )))
    .map((storyboard) => storyboard.id);
  let next = storyboards.map((storyboard) => directlyAffectedIds.includes(storyboard.id)
    ? {
        ...storyboard,
        stale: true,
        staleReason,
        staleSince,
        visualReview: storyboard.visualReview
          ? {
              ...storyboard.visualReview,
              status: "pending" as const,
              reasons: [reviewReason],
            }
          : storyboard.visualReview,
      }
    : storyboard);
  for (const storyboardId of directlyAffectedIds) {
    next = markContinuityDependentsStale(next, storyboardId, staleSince);
  }
  return next;
}

export function mergeStoryboardReplacement(previous: StoryboardItem, next: StoryboardItem, staleReason: string): StoryboardItem {
  const previousFingerprint = previous.sourceFingerprint ?? storyboardSourceFingerprint(previous);
  const nextFingerprint = storyboardSourceFingerprint(next);
  const sourceChanged = previousFingerprint !== nextFingerprint;
  const hasOutput = Boolean(previous.mediaRef || previous.audioRef || previous.imageWorkflowId || previous.imageWorkflowNodeId);
  const freshWrite = Boolean(
    next.mediaRef !== previous.mediaRef ||
      next.audioRef !== previous.audioRef ||
      next.imageWorkflowId !== previous.imageWorkflowId ||
      next.imageWorkflowNodeId !== previous.imageWorkflowNodeId,
  );
  const visualInputChanged = Boolean(
    next.mediaRef !== previous.mediaRef ||
      next.imageWorkflowId !== previous.imageWorkflowId ||
      next.imageWorkflowNodeId !== previous.imageWorkflowNodeId,
  );
  if (freshWrite) {
    return {
      ...next,
      stale: false,
      staleReason: undefined,
      staleSince: undefined,
      sourceFingerprint: nextFingerprint,
      outputVersion: (previous.outputVersion ?? 0) + 1,
      visualReview: visualInputChanged && next.visualReview
        ? {
            ...next.visualReview,
            status: "pending",
            reasons: ["分镜画面或连续性输入已变化，必须重新审核"],
          }
        : next.visualReview,
    };
  }
  if (sourceChanged && hasOutput) {
    return {
      ...next,
      ...markStale(next, staleReason),
      sourceFingerprint: nextFingerprint,
      outputVersion: previous.outputVersion,
    };
  }
  return {
    ...next,
    sourceFingerprint: nextFingerprint,
    outputVersion: previous.outputVersion,
  };
}

export function markStale<T extends { stale?: boolean; staleReason?: string; staleSince?: number }>(item: T, reason: string): T {
  return {
    ...item,
    stale: true,
    staleReason: reason,
    staleSince: Date.now(),
  };
}

export function storyboardSourceFingerprint(item: Partial<StoryboardItem>) {
  return stableHash({
    episodeId: item.episodeId,
    index: item.index,
    trackKey: item.trackKey,
    duration: item.duration,
    prompt: item.prompt,
    videoDesc: item.videoDesc,
    assetIds: item.assetIds ?? [],
    shouldGenerateImage: item.shouldGenerateImage,
    orderedReferenceManifest: item.orderedReferenceManifest ?? [],
    continuityState: item.continuityState
      ? { ...item.continuityState, inputFingerprint: undefined }
      : undefined,
    lines: item.lines,
    speakerId: item.speakerId,
  });
}

export function trackSourceFingerprint(track: ProductionTrack, storyboards: StoryboardItem[]) {
  return stableHash({
    episodeId: track.episodeId,
    trackKey: track.trackKey,
    storyboardIds: track.storyboardIds,
    prompt: track.prompt,
    duration: track.duration,
    storyboardFingerprints: track.storyboardIds.map(
      (id) => storyboards.find((storyboard) => storyboard.id === id)?.sourceFingerprint,
    ),
  });
}

export function videoCandidateFingerprint(candidate: Partial<VideoCandidate>) {
  return stableHash({
    trackId: candidate.trackId,
    provider: candidate.provider,
    filePath: candidate.filePath,
  });
}

function stableHash(value: unknown) {
  return JSON.stringify(value, (_key, nested) => {
    if (!nested || typeof nested !== "object" || Array.isArray(nested)) return nested;
    return Object.keys(nested)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = (nested as Record<string, unknown>)[key];
        return acc;
      }, {});
  });
}
