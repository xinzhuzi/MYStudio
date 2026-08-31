import type { RemotionJob, RemotionManifest } from "@/types/artifacts";
import type { AutoEditingRun, EditingProjectV1 } from "@/types/editing";
import type { MediaFile as CurrentMediaFile } from "@/types/media";
import type { Episode, ScriptData } from "@/types/script";
import type { ContinuityAssetVersion, NovelChapter } from "@/types/studio";
import type { SceneVoiceLine } from "@/types/tts";

/**
 * 投影共享底座——结构适配类型、Stage/Kind、buildArtifactId、章节投影域解析。file-size-reduction P1 拆出,体逐字保留。
 */
// These projections consume persisted slices whose shapes intentionally vary by
// store version; keep the adapter boundary structural rather than importing
// non-existent legacy store interfaces.
export type EditingProject = Pick<EditingProjectV1, "id" | "projectId" | "episodeId">;
export type EditingRun = Pick<AutoEditingRun, "id" | "projectId" | "episodeId" | "startedAt" | "completedAt">;
export type EditingRenderRecord = { id: string; projectId: string; episodeId?: string; startedAt: number; completedAt?: number; outputPath?: string };
export type LegacyEditingRenderRecord = {
  id?: string;
  projectId?: string;
  episodeId?: string;
  startedAt?: number;
  completedAt?: number;
  outputPath?: string;
  evidence?: { jobId: string; path: string; mtimeMs: number };
};
export type ProjectableSceneVoiceLine = Pick<SceneVoiceLine, "sceneId" | "projectId" | "chapterId"> & {
  id?: string;
  audioRef?: string;
  updatedAt?: number;
};
export type ProjectableMediaFile = Pick<
  CurrentMediaFile,
  "id" | "name" | "type" | "projectId" | "chapterId" | "url" | "relativePath"
> & {
  /** Legacy persisted fields remain readable, but current writes use url/relativePath. */
  createdAt?: number;
  updatedAt?: number;
  localPath?: string;
  size?: number;
};
export type MediaStoreState = { mediaFiles: ProjectableMediaFile[] };
export type RemotionStoreState = { manifest?: RemotionManifest; jobs?: RemotionJob[] };
export type ScriptStoreState = ScriptData | { scriptData: ScriptData };
export type ContinuityAssetVersionWithOwnership = ContinuityAssetVersion & {
  chapterId?: string;
  episodeId?: string;
};

/**
 * Artifact stage identifier types
 */
export type ArtifactStage =
  | "novel"
  | "analysis"
  | "script"
  | "storyboard"
  | "production"
  | "voice"
  | "editing"
  | "remotion"
  | "assets"
  | "media-library";

/**
 * Artifact kind identifier types
 */
export type ArtifactKind =
  | "novel-chapter"
  | "agent-workflow-result"
  | "director-entity-extraction"
  | "script-episode"
  | "script-scene"
  | "storyboard-item"
  | "production-track"
  | "video-candidate"
  | "scene-segment"
  | "tts-scene-voice-line"
  | "editing-project"
  | "editing-run"
  | "editing-render"
  | "remotion-manifest"
  | "remotion-job"
  | "continuity-bible"
  | "base-character"
  | "base-scene"
  | "base-prop"
  | "media-file";

/**
 * Build a unique artifact ID from stage, kind, and underlying ID
 * Format: `${stage}:${kind}:${id}` ensures cross-stage uniqueness
 */
export function buildArtifactId(stage: ArtifactStage, kind: ArtifactKind, id: string): string {
  return `${stage}:${kind}:${id}`;
}


export interface ChapterProjectionScope {
  requestedId?: string;
  canonicalId?: string;
  novelChapterIds?: ReadonlySet<string>;
  legacyEpisodeIds: ReadonlySet<string>;
  resolvedByIndex: boolean;
  legacyMappingStatus: "resolved" | "blocked" | "ambiguous";
}

export function resolveChapterProjectionScope(
  chapters: NovelChapter[],
  episodes: Episode[],
  requestedId?: string,
): ChapterProjectionScope {
  if (!requestedId) {
    return {
      requestedId,
      canonicalId: undefined,
      novelChapterIds: undefined,
      legacyEpisodeIds: new Set(),
      resolvedByIndex: false,
      legacyMappingStatus: "ambiguous" };
  }

  const directEpisodeMatches = episodes.filter((episode) => episode.id === requestedId);
  const directChapterMatches = chapters.filter((chapter) => chapter.id === requestedId);
  const indexMatch = /^(?:chapter|episode)[-_](\d+)$/i.exec(requestedId);
  const requestedIndex = indexMatch ? Number.parseInt(indexMatch[1]!, 10) : undefined;
  let targetEpisode: Episode | undefined;
  let targetChapter: NovelChapter | undefined;
  let targetIndex: number | undefined;
  let resolvedByIndex = false;

  if (directEpisodeMatches.length === 1) {
    targetEpisode = directEpisodeMatches[0]!;
    targetIndex = targetEpisode.index;
    const indexedChapters = chapters.filter((chapter) => chapter.index === targetIndex);
    targetChapter = directChapterMatches.length === 1
      ? directChapterMatches[0]
      : indexedChapters.length === 1
        ? indexedChapters[0]
        : undefined;
  } else if (directChapterMatches.length === 1) {
    targetChapter = directChapterMatches[0]!;
    targetIndex = targetChapter.index;
    const indexedEpisodes = episodes.filter((episode) => episode.index === targetIndex);
    targetEpisode = indexedEpisodes.length === 1 ? indexedEpisodes[0] : undefined;
  } else if (requestedIndex !== undefined) {
    targetIndex = requestedIndex;
    const indexedEpisodes = episodes.filter((episode) => episode.index === targetIndex);
    const indexedChapters = chapters.filter((chapter) => chapter.index === targetIndex);
    if (indexedEpisodes.length === 1 && indexedChapters.length === 1) {
      targetEpisode = indexedEpisodes[0];
      targetChapter = indexedChapters[0];
      resolvedByIndex = true;
    }
  }

  const indexedEpisodes = targetIndex === undefined
    ? []
    : episodes.filter((episode) => episode.index === targetIndex);
  const indexedChapters = targetIndex === undefined
    ? []
    : chapters.filter((chapter) => chapter.index === targetIndex);
  const canonicalId = targetEpisode?.id ?? targetChapter?.id ?? requestedId;
  const legacyMappingResolved = targetIndex !== undefined
    && indexedEpisodes.length === 1
    && indexedChapters.length === 1
    && targetEpisode?.id === canonicalId
    && targetChapter?.id === indexedChapters[0]!.id;

  return {
    requestedId,
    canonicalId,
    novelChapterIds: new Set(targetChapter ? [targetChapter.id] : []),
    legacyEpisodeIds: legacyMappingResolved
      ? new Set([`episode-${targetIndex}`])
      : new Set(),
    resolvedByIndex,
    legacyMappingStatus: targetIndex === undefined
      ? "ambiguous"
      : legacyMappingResolved
        ? "resolved"
        : "blocked" };
}

