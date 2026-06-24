import type {
  EpisodeMergePlan,
  ProductionTrack,
  StoryboardItem,
  TrackRenderPlan,
  VideoCandidate,
} from "@/types/studio";

export function groupStoryboardsIntoTracks(storyboards: StoryboardItem[]): ProductionTrack[] {
  const sorted = [...storyboards].sort((a, b) => a.index - b.index);
  const groups = new Map<string, StoryboardItem[]>();

  for (const item of sorted) {
    const key = item.trackKey.trim() || `track-${item.index}`;
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }

  return [...groups.entries()].map(([trackKey, items], index) => {
    const trackId = items[0]?.trackId || `track-${String(index + 1).padStart(3, "0")}-${slugify(trackKey)}`;
    return {
      id: trackId,
      episodeId: items[0]?.episodeId ?? "",
      trackKey,
      storyboardIds: items.map((item) => item.id),
      prompt: items.map((item) => item.prompt).filter(Boolean).join("\n"),
      duration: items.reduce((sum, item) => sum + Math.max(0, Number(item.duration) || 0), 0),
      candidateVideoIds: [],
      state: "idle",
    };
  });
}

export function createTrackRenderPlan(track: ProductionTrack, storyboards: StoryboardItem[]): TrackRenderPlan {
  const byId = new Map(storyboards.map((item) => [item.id, item]));
  const inputs = track.storyboardIds
    .map((id) => byId.get(id))
    .filter((item): item is StoryboardItem => Boolean(item?.mediaRef && item.mediaRef.kind !== "audio"))
    .map((item) => ({
      storyboardId: item.id,
      sourcePath: item.mediaRef!.path,
      sourceKind: item.mediaRef!.kind === "video" ? "video" as const : "image" as const,
      duration: item.duration,
      audioPath: item.audioRef?.kind === "audio" ? item.audioRef.path : undefined,
    }));

  if (inputs.length === 0) {
    throw new Error("没有可用于本地合成的分镜素材");
  }

  return {
    kind: "track-candidate",
    trackId: track.id,
    duration: track.duration,
    inputs,
    subtitleText: extractSubtitle(storyboards.find((item) => track.storyboardIds.includes(item.id))?.videoDesc),
    ffmpegProfile: "ken-burns-h264-aac",
  };
}

export function createEpisodeMergePlan(candidates: VideoCandidate[]): EpisodeMergePlan {
  const readyInputs = candidates
    .filter((item) => item.state === "ready" && item.filePath)
    .map((item) => item.filePath as string);

  if (readyInputs.length === 0) {
    throw new Error("没有可拼接的已选视频");
  }

  return {
    kind: "episode-merge",
    inputs: readyInputs,
    ffmpegProfile: "concat-h264-aac",
  };
}

function extractSubtitle(videoDesc?: string) {
  const raw = videoDesc?.trim();
  if (!raw) return undefined;

  const lineMatch = raw.match(/台词[：:](.+?)(?:[；;]|$)/);
  const dialogue = (lineMatch?.[1] ?? raw).trim();
  if (!dialogue || /^(无|无台词|无对白)$/i.test(dialogue)) return undefined;

  const roleMatch = dialogue.match(/^.+?[：:](.+)$/);
  return (roleMatch?.[1] ?? dialogue).trim();
}

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32) || "track";
}
