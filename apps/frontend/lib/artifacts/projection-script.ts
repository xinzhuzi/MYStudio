import type { ArtifactRecord, DeletePolicy } from "@/types/artifacts";
import type { Episode, ScriptScene as Scene } from "@/types/script";
import type { AgentWorkData, EntityExtractionResult, NovelChapter } from "@/types/studio";
import { buildArtifactId } from "./projection-shared";

/**
 * 脚本域投影——小说章节/代理工作流/实体抽取/分集/分场。file-size-reduction P1 拆出,体逐字保留。
 */
/**
 * Map Studio novel chapters to novel-chapter artifacts
 */
export function projectNovelChapters(
  chapters: NovelChapter[],
  projectId: string,
  chapterId?: string,
  includedChapterIds?: ReadonlySet<string>,
): ArtifactRecord[] {
  return chapters
    .filter((chapter) => !chapterId || (
      includedChapterIds
        ? includedChapterIds.has(chapter.id)
        : chapter.id === chapterId
    ))
    .map((chapter) => {
    const artId = buildArtifactId("novel", "novel-chapter", chapter.id);
    return {
      id: artId,
      projectId,
      chapterId: chapterId ?? chapter.id,
      stage: "novel",
      kind: "novel-chapter",
      state: "active",
      name: chapter.title || `Chapter ${chapter.index}`,
      createdAt: chapter.importedAt,
      updatedAt: chapter.updatedAt ?? chapter.importedAt,
      physicalRefs: [], // No direct file ref in live state
      upstreamIds: [],
      downstreamIds: [],
      deletePolicy: "delete-exclusive-downstream" as DeletePolicy,
      editRoute: "/studio/novel" };
  });
}

/**
 * Map agent workflow results to agent-workflow-result artifacts
 */
export function projectAgentWorkflows(
  works: AgentWorkData[],
  projectId: string,
  chapterId?: string,
  legacyEpisodeIds: ReadonlySet<string> = new Set(),
): ArtifactRecord[] {
  return works
    .filter((w) => !chapterId || w.episodeId === chapterId || (w.episodeId !== undefined && legacyEpisodeIds.has(w.episodeId)))
    .map((work) => {
      const artId = buildArtifactId("analysis", "agent-workflow-result", work.id);
      return {
        id: artId,
        projectId,
        chapterId: chapterId ?? work.episodeId,
        stage: "analysis",
        kind: "agent-workflow-result",
        state: "active",
        name: `Agent Work: ${work.key}`,
        createdAt: work.createdAt,
        updatedAt: work.updatedAt,
        physicalRefs: [],
        upstreamIds: [],
        downstreamIds: [],
        deletePolicy: "delete-exclusive-downstream",
        editRoute: `/studio/agent/${work.key}` };
    });
}

/**
 * Map entity extraction to director-entity-extraction artifact
 */
export function projectEntityExtractions(
  extractions: EntityExtractionResult[],
  projectId: string,
  chapterId?: string
): ArtifactRecord[] {
  return extractions
    .filter((e) => !chapterId || e.episodeId === chapterId)
    .map((extraction) => {
      const artId = buildArtifactId("analysis", "director-entity-extraction", extraction.id);
      return {
        id: artId,
        projectId,
        chapterId,
        stage: "analysis",
        kind: "director-entity-extraction",
        state: "active",
        name: `Entity Extraction: ${extraction.id}`,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        physicalRefs: [],
        upstreamIds: [],
        downstreamIds: [],
        deletePolicy: "delete-exclusive-downstream",
        editRoute: `/director/entities/${extraction.id}` };
    });
}

/**
 * Map script episodes to script-episode and script-scene artifacts
 *
 * IMPORTANT: ScriptData does NOT have a top-level episodeId field.
 * Chapter identity is represented by Episode.id (stored in scriptData.episodes[] array).
 * This function uses Episode.id directly as the stable identity - no scriptData parameter needed.
 */
export function projectScriptEpisodes(
  episodes: Episode[],
  projectId: string,
  chapterId?: string
): ArtifactRecord[] {
  return episodes
    .filter((episode) => !chapterId || episode.id === chapterId)
    .map((episode) => {
    const artId = buildArtifactId("script", "script-episode", episode.id);

    return {
      id: artId,
      projectId,
      chapterId: episode.id,
      stage: "script",
      kind: "script-episode",
      state: "active",
      name: episode.title || `Episode ${episode.index}`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      physicalRefs: [],
      upstreamIds: [],
      downstreamIds: episode.sceneIds.map((sceneId) => buildArtifactId("script", "script-scene", sceneId)),
      deletePolicy: "delete-exclusive-downstream",
      editRoute: `/script/episode/${episode.id}` };
  });
}

export function projectScriptScenes(
  scenes: Scene[],
  projectId: string,
  chapterId?: string,
  parentEpisodeId?: string
): ArtifactRecord[] {
  return scenes.map((scene) => {
    const artId = buildArtifactId("script", "script-scene", scene.id);

    return {
      id: artId,
      projectId,
      chapterId,
      stage: "script",
      kind: "script-scene",
      state: "active",
      name: `Scene ${scene.id.slice(-6)}`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      physicalRefs: [],
      upstreamIds: parentEpisodeId ? [buildArtifactId("script", "script-episode", parentEpisodeId)] : [],
      downstreamIds: [],
      deletePolicy: "delete-exclusive-downstream",
      editRoute: `/script/scene/${scene.id}` };
  });
}

/**
 * Map storyboards to storyboard-item artifacts
 */
