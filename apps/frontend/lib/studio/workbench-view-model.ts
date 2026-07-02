import type {
  ProductionTrack,
  StoryboardItem,
  VideoCandidate,
} from "@/types/studio";

export type ToonflowWorkbenchMediaSource = "storyboard" | "assets";
export type ToonflowWorkbenchMediaType = "image" | "video" | "audio";

export interface ToonflowWorkbenchMedia {
  id: string;
  sources: ToonflowWorkbenchMediaSource;
  fileType: ToonflowWorkbenchMediaType;
  src: string;
  path: string;
  prompt?: string;
  name?: string;
  index?: number;
}

export interface ToonflowWorkbenchAssetMedia {
  id: string;
  name: string;
  fileType: ToonflowWorkbenchMediaType;
  path: string;
  prompt?: string;
  parentAssetId?: string;
  parentAssetName?: string;
  state?: string;
  reason?: string;
}

export interface ToonflowWorkbenchVideo {
  id: string;
  src: string;
  path?: string;
  state: VideoCandidate["state"];
  errorReason?: string;
  selected: boolean;
}

export interface ToonflowWorkbenchTrack {
  id: string;
  name: string;
  prompt: string;
  state: ProductionTrack["state"];
  reason?: string;
  duration: number;
  selectVideoId?: string;
  medias: ToonflowWorkbenchMedia[];
  videoList: ToonflowWorkbenchVideo[];
}

export interface ToonflowWorkbenchModel {
  trackList: ToonflowWorkbenchTrack[];
  selectedReadyCount: number;
  canMergeEpisode: boolean;
}

export function buildToonflowWorkbenchModel(input: {
  tracks: ProductionTrack[];
  storyboards: StoryboardItem[];
  candidates: VideoCandidate[];
  assetMediaById?: Record<string, ToonflowWorkbenchAssetMedia | undefined>;
  fileExists?: (filePath: string) => boolean;
}): ToonflowWorkbenchModel {
  const fileExists = input.fileExists ?? (() => true);
  const storyboardById = new Map(
    input.storyboards.map((storyboard) => [storyboard.id, storyboard]),
  );
  const candidatesByTrack = groupCandidates(input.candidates);
  const trackList = input.tracks.map((track) => {
    const videoList = (candidatesByTrack.get(track.id) ?? []).map(
      (candidate) => ({
        id: candidate.id,
        src:
          candidate.filePath && fileExists(candidate.filePath)
            ? candidate.filePath
            : "",
        path:
          candidate.filePath && fileExists(candidate.filePath)
            ? candidate.filePath
            : undefined,
        state: candidate.state,
        errorReason: candidate.errorReason,
        selected: track.selectedVideoId === candidate.id,
      }),
    );
    return {
      id: track.id,
      name: track.trackKey || track.id,
      prompt: track.prompt,
      state: track.state,
      reason: track.reason,
      duration: track.duration,
      selectVideoId: track.selectedVideoId,
      medias: track.storyboardIds.flatMap((storyboardId) =>
        toWorkbenchMedias(
          storyboardById.get(storyboardId),
          input.assetMediaById ?? {},
          fileExists,
        ),
      ),
      videoList,
    };
  });
  const selectedReadyCount = trackList.filter((track) =>
    track.videoList.some((video) => video.selected && video.state === "ready" && video.path),
  ).length;
  return {
    trackList,
    selectedReadyCount,
    canMergeEpisode:
      trackList.length > 0 && selectedReadyCount === trackList.length,
  };
}

function groupCandidates(candidates: VideoCandidate[]) {
  const grouped = new Map<string, VideoCandidate[]>();
  for (const candidate of candidates) {
    grouped.set(candidate.trackId, [
      ...(grouped.get(candidate.trackId) ?? []),
      candidate,
    ]);
  }
  return grouped;
}

function toWorkbenchMedias(
  storyboard: StoryboardItem | undefined,
  assetMediaById: Record<string, ToonflowWorkbenchAssetMedia | undefined>,
  fileExists: (filePath: string) => boolean,
): ToonflowWorkbenchMedia[] {
  if (!storyboard) return [];
  const assetMedias = storyboard.assetIds
    .map((assetId) => assetMediaById[assetId])
    .filter(
      (asset): asset is ToonflowWorkbenchAssetMedia =>
        Boolean(asset?.path && fileExists(asset.path)),
    )
    .map((asset) => ({
      id: asset.id,
      sources: "assets" as const,
      fileType: asset.fileType,
      src: asset.path,
      path: asset.path,
      prompt: asset.prompt,
      name: asset.name,
      index: storyboard.index,
    }));
  const storyboardMedias = [storyboard.mediaRef, storyboard.audioRef]
    .filter((media): media is NonNullable<StoryboardItem["mediaRef"]> =>
      Boolean(media?.path && fileExists(media.path)),
    )
    .map((media) => ({
      id: storyboard.id,
      sources: "storyboard" as const,
      fileType: media.kind,
      src: media.path,
      path: media.path,
      prompt: storyboard.videoDesc || storyboard.prompt,
      name: `分镜 ${storyboard.index}`,
      index: storyboard.index,
    }));
  return [...assetMedias, ...storyboardMedias];
}
