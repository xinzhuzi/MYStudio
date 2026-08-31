import type { ArtifactRecord } from "@/types/artifacts";
import type { ScriptScene as Scene } from "@/types/script";
import type { StudioWorkflowState } from "@/stores/studio/studio-store";
import type { DirectorState } from "@/stores/director/director-store-types";
import type { EditingStore } from "@/stores/editing/editing-store";
import type { TtsStore } from "@/stores/tts/tts-store";
import type { RemotionRenderJobV1 } from "@/types/remotion-workspace";
import { projectBaseAssets, projectContinuityBibles, projectEditingProjects, projectEditingRenders, projectEditingRuns, projectMediaFiles, projectRemotionArtifacts } from "./projection-media";
import { projectAgentWorkflows, projectEntityExtractions, projectNovelChapters, projectScriptEpisodes, projectScriptScenes } from "./projection-script";
import { LegacyEditingRenderRecord, MediaStoreState, RemotionStoreState, ScriptStoreState, resolveChapterProjectionScope } from "./projection-shared";
import { buildLegacyTtsSceneOwnership, projectProductionTracks, projectSceneSegmentArtifacts, projectStoryboards, projectTTSVoiceLines, projectVideoCandidates } from "./projection-storyboard";

export interface ProjectionResult {
  artifacts: ArtifactRecord[];
  legacyMappings: LegacyMappingResult[];
}

export interface LegacyMappingResult {
  rule: "episode-1-to-index" | "numeric-tts-sceneid" | "missing-media-ownership" | "continuity-no-episodeid" | "trackkey-index-derived" | "scriptdata-no-top-level-episodeid";
  status: "resolved" | "blocked" | "ambiguous";
  input: unknown;
  outputArtifactId?: string;
  reason?: string;
}


export function projectAllFromStores(
  studioState: StudioWorkflowState,
  scriptState: ScriptStoreState,
  _directorState: DirectorState,
  editingState: EditingStore,
  ttsState: TtsStore,
  mediaState: MediaStoreState,
  remotionState: RemotionStoreState | RemotionRenderJobV1[],
  projectId: string,
  chapterId?: string,
  libraryCharacters?: { id: string; name: string }[],
  libraryScenes?: { id: string; name: string }[],
  libraryProps?: { id: string; name: string }[]
): ProjectionResult {
  const artifacts: ArtifactRecord[] = [];
  const legacyMappings: LegacyMappingResult[] = [];
  const scriptData = "scriptData" in scriptState ? scriptState.scriptData : scriptState;
  const legacyTtsSceneOwnership = buildLegacyTtsSceneOwnership(scriptData.episodes, scriptData.scenes);
  const remotionSnapshot = Array.isArray(remotionState)
    ? {
        jobs: remotionState.map((job) => ({
          id: job.jobId,
          projectId: job.projectId,
          chapterId: job.target?.chapterId })) }
    : remotionState;
  const ttsVoiceLines = Object.entries(ttsState.projects[projectId]?.voiceLines ?? {}).map(([id, line]) => ({
    ...line,
    id,
    projectId: line.projectId ?? projectId,
    audioRef: line.audioLocalPath ?? line.audioFilePath }));

  const chapterScope = resolveChapterProjectionScope(studioState.novelChapters, scriptData.episodes, chapterId);
  const projectionChapterId = chapterScope.canonicalId;

  // Novel chapters - resolve legacy episode-N identifiers only when exactly
  // one persisted chapter has the corresponding 1-based index.
  if (chapterId) {
    legacyMappings.push({
      rule: "episode-1-to-index",
      status: chapterScope.legacyMappingStatus,
      input: { original: chapterId, normalized: projectionChapterId },
      reason: chapterScope.legacyMappingStatus === "resolved"
        ? chapterScope.resolvedByIndex
          ? "Mapped the requested legacy episode index to the unique novel chapter and script episode"
          : "Legacy episode index uniquely agrees with the target novel chapter and script episode"
        : chapterScope.legacyMappingStatus === "blocked"
          ? "Legacy episode index is missing or duplicated in novel chapters or script episodes"
          : undefined });
  }

  // Project each domain
  artifacts.push(...projectNovelChapters(
    studioState.novelChapters,
    projectId,
    projectionChapterId,
    chapterScope.novelChapterIds,
  ));
  artifacts.push(...projectAgentWorkflows(studioState.agentWorkData, projectId, projectionChapterId, chapterScope.legacyEpisodeIds));
  artifacts.push(...projectEntityExtractions(studioState.entityExtractions, projectId, projectionChapterId));
  artifacts.push(...projectScriptEpisodes(scriptData.episodes, projectId, projectionChapterId));

  // Resolve ScriptData episode IDs for scenes/shots
  const scenesById = new Map(scriptData.scenes.map((scene) => [scene.id, scene]));
  scriptData.episodes.forEach((ep) => {
    if (!projectionChapterId || ep.id === projectionChapterId) {
      const scenes = ep.sceneIds.map((sceneId) => scenesById.get(sceneId)).filter((scene): scene is Scene => scene !== undefined);
      artifacts.push(...projectScriptScenes(scenes, projectId, ep.id, ep.id));
    }
  });

  artifacts.push(...projectStoryboards(studioState.storyboards, projectId, projectionChapterId));
  artifacts.push(...projectProductionTracks(studioState.productionTracks, projectId, projectionChapterId));
  const scopedTracks = studioState.productionTracks.filter(
    (track) => !projectionChapterId || track.episodeId === projectionChapterId,
  );
  for (const track of scopedTracks) {
    artifacts.push(...projectVideoCandidates(
      studioState.videoCandidates,
      projectId,
      track.episodeId,
      track.id,
    ));
  }
  const knownTrackIds = new Set(studioState.productionTracks.map((track) => track.id));
  // 08-24：无法归轨且 stale 的候选（legacy ffmpeg 场分段等）不再投影成「章节
  // 视频产出」——数据保留在 store，产物树只显示当前口径的产出。
  const unresolvedCandidates = studioState.videoCandidates.filter(
    (candidate) => !knownTrackIds.has(candidate.trackId) && !candidate.stale,
  );
  artifacts.push(...projectVideoCandidates(unresolvedCandidates, projectId));
  artifacts.push(...projectSceneSegmentArtifacts(
    studioState.sceneSegments ?? [],
    projectId,
    projectionChapterId,
  ));
  artifacts.push(...projectTTSVoiceLines(
    ttsVoiceLines,
    projectId,
    projectionChapterId,
    scriptData.scenes,
    legacyTtsSceneOwnership,
  ));
  artifacts.push(...projectEditingProjects(Object.values(editingState.editingProjects), projectId, projectionChapterId));
  artifacts.push(...projectEditingRuns(Object.values(editingState.autoEditingRuns), projectId, projectionChapterId));
  artifacts.push(...projectEditingRenders(
    Object.values(editingState.timelineRenderRecordsByEditingProjectId).map((record) => {
      const persisted = record as unknown as LegacyEditingRenderRecord;
      return {
        id: persisted.evidence?.jobId ?? persisted.id ?? `render-${persisted.episodeId ?? "unknown"}`,
        projectId: persisted.projectId ?? projectId,
        episodeId: persisted.episodeId,
        startedAt: persisted.evidence?.mtimeMs ?? persisted.startedAt ?? persisted.completedAt ?? Date.now(),
        completedAt: persisted.completedAt,
        outputPath: persisted.evidence?.path ?? persisted.outputPath };
    }),
    projectId,
    projectionChapterId,
  ));
  artifacts.push(...projectRemotionArtifacts(projectId, remotionSnapshot.manifest, remotionSnapshot.jobs, projectionChapterId));
  artifacts.push(...projectContinuityBibles(studioState.continuityAssetVersions, projectId, projectionChapterId));
  artifacts.push(...projectMediaFiles(mediaState.mediaFiles, projectId, projectionChapterId));

  // Base assets are always included (project-scoped, not chapter-specific)
  const chars = libraryCharacters ?? [];
  const scns = libraryScenes ?? [];
  const prps = libraryProps ?? [];
  artifacts.push(...projectBaseAssets(chars, scns, prps, projectId, projectionChapterId));

  // Check for TTS legacy numeric sceneId mappings.  Only exact script-graph
  // ownership is resolved; zero/multiple matches remain fail-closed blockers.
  const legacyTTS = ttsVoiceLines.filter((line) => !line.chapterId);
  const resolvedLegacyTTS = legacyTTS.filter((line) => {
    const matches = legacyTtsSceneOwnership.get(line.sceneId) ?? [];
    return matches.length === 1;
  });
  const blockedLegacyTTS = legacyTTS.filter((line) => {
    const matches = legacyTtsSceneOwnership.get(line.sceneId) ?? [];
    return matches.length !== 1;
  });
  if (resolvedLegacyTTS.length > 0) {
    legacyMappings.push({
      rule: "numeric-tts-sceneid",
      status: "resolved",
      input: { count: resolvedLegacyTTS.length, sampleIds: resolvedLegacyTTS.slice(0, 3).map((line) => line.sceneId) },
      reason: "Resolved by exact numeric ScriptScene.id and unique Episode.sceneIds ownership" });
  }
  if (blockedLegacyTTS.length > 0) {
    legacyMappings.push({
      rule: "numeric-tts-sceneid",
      status: "blocked",
      input: { count: blockedLegacyTTS.length, sampleIds: blockedLegacyTTS.slice(0, 3).map((line) => line.sceneId) },
      reason: "Numeric sceneId has no unique exact ScriptScene/Episode ownership mapping" });
  }

  // Check for missing media ownership
  const unownedMedia = mediaState.mediaFiles.filter(f => f.projectId === projectId && !f.chapterId);
  if (unownedMedia.length > 0) {
    legacyMappings.push({
      rule: "missing-media-ownership",
      status: "ambiguous",
      input: { count: unownedMedia.length, sampleIds: unownedMedia.slice(0, 3).map(f => f.id) },
      reason: "Media files lack chapterId ownership field - requires reverse reference scan" });
  }

  return { artifacts, legacyMappings };
}


export { buildArtifactId, resolveChapterProjectionScope } from "./projection-shared";
export type { ArtifactKind, ArtifactStage, ChapterProjectionScope, ContinuityAssetVersionWithOwnership, EditingProject, EditingRenderRecord, EditingRun, LegacyEditingRenderRecord, MediaStoreState, ProjectableMediaFile, ProjectableSceneVoiceLine, RemotionStoreState, ScriptStoreState } from "./projection-shared";
export { projectAgentWorkflows, projectEntityExtractions, projectNovelChapters, projectScriptEpisodes, projectScriptScenes } from "./projection-script";
export { buildLegacyTtsSceneOwnership, projectProductionTracks, projectSceneSegmentArtifacts, projectStoryboards, projectTTSVoiceLines, projectVideoCandidates } from "./projection-storyboard";
export type { LegacyTtsSceneOwnership } from "./projection-storyboard";
export { projectBaseAssets, projectContinuityBibles, projectEditingProjects, projectEditingRenders, projectEditingRuns, projectMediaFiles, projectRemotionArtifacts } from "./projection-media";
