// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-larger. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

 
import type { ArtifactRecord, DeletePolicy, RemotionManifest, RemotionJob } from "@/types/artifacts";
 
import type { NovelChapter, AgentWorkData, EntityExtractionResult, StoryboardItem, ProductionTrack, VideoCandidate, ContinuityAssetVersion } from "@/types/studio";
import type { Episode, ScriptData, ScriptScene as Scene } from "@/types/script";
import type { StudioWorkflowState } from "@/stores/studio/studio-store";
import type { DirectorState } from "@/stores/director/director-store-types";
import type { EditingStore } from "@/stores/editing/editing-store";
import type { AutoEditingRun, EditingProjectV1 } from "@/types/editing";
import type { TtsStore } from "@/stores/tts/tts-store";
import type { SceneVoiceLine } from "@/types/tts";
import type { MediaFile as CurrentMediaFile } from "@/types/media";
import type { RemotionRenderJobV1 } from "@/types/remotion-workspace";

// These projections consume persisted slices whose shapes intentionally vary by
// store version; keep the adapter boundary structural rather than importing
// non-existent legacy store interfaces.
type EditingProject = Pick<EditingProjectV1, "id" | "projectId" | "episodeId">;
type EditingRun = Pick<AutoEditingRun, "id" | "projectId" | "episodeId" | "startedAt" | "completedAt">;
type EditingRenderRecord = { id: string; projectId: string; episodeId?: string; startedAt: number; completedAt?: number; outputPath?: string };
type LegacyEditingRenderRecord = {
  id?: string;
  projectId?: string;
  episodeId?: string;
  startedAt?: number;
  completedAt?: number;
  outputPath?: string;
  evidence?: { jobId: string; path: string; mtimeMs: number };
};
type ProjectableSceneVoiceLine = Pick<SceneVoiceLine, "sceneId" | "projectId" | "chapterId"> & {
  id?: string;
  audioRef?: string;
  updatedAt?: number;
};
type ProjectableMediaFile = Pick<
  CurrentMediaFile,
  "id" | "name" | "type" | "projectId" | "chapterId" | "url" | "relativePath"
> & {
  /** Legacy persisted fields remain readable, but current writes use url/relativePath. */
  createdAt?: number;
  updatedAt?: number;
  localPath?: string;
  size?: number;
};
type MediaStoreState = { mediaFiles: ProjectableMediaFile[] };
type RemotionStoreState = { manifest?: RemotionManifest; jobs?: RemotionJob[] };
type ScriptStoreState = ScriptData | { scriptData: ScriptData };
type ContinuityAssetVersionWithOwnership = ContinuityAssetVersion & {
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
export function projectStoryboards(
  storyboards: StoryboardItem[],
  projectId: string,
  chapterId?: string
): ArtifactRecord[] {
  return storyboards
    .filter((sb) => !chapterId || sb.episodeId === chapterId)
    .map((sb) => {
      const artId = buildArtifactId("storyboard", "storyboard-item", sb.id);
      return {
        id: artId,
        projectId,
        chapterId,
        stage: "storyboard",
        kind: "storyboard-item",
        state: sb.state === "failed" ? "blocked" : "active",
        name: `Storyboard ${sb.index}`,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        physicalRefs: sb.mediaRef
          ? [
              {
                type: "project-file",
                path: sb.mediaRef.path,
                bytes: undefined,
                hash256: sb.mediaRef.contentSha256 },
            ]
          : [],
        upstreamIds: [buildArtifactId("script", "script-episode", sb.episodeId)],
        downstreamIds: [],
        deletePolicy: "delete-exclusive-downstream",
        editRoute: `/studio/storyboard/${sb.id}`,
        retainedReason: undefined,
        blockerReason: sb.state === "failed" ? "Failed rendering state" : undefined };
    });
}

/**
 * Map production tracks to production-track artifacts
 * Resolves trackKey (index-derived runtime key) via episodeId
 */
export function projectProductionTracks(
  tracks: ProductionTrack[],
  projectId: string,
  chapterId?: string
): ArtifactRecord[] {
  return tracks
    .filter((t) => !chapterId || t.episodeId === chapterId)
    .map((track) => {
      const artId = buildArtifactId("production", "production-track", track.id);
      const candidateIds = track.candidateVideoIds.map((vid) => buildArtifactId("production", "video-candidate", vid));

      return {
        id: artId,
        projectId,
        chapterId,
        stage: "production",
        kind: "production-track",
        state: track.state === "failed" ? "blocked" : "active",
        name: `Track ${track.storyboardIds.length} shots`,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        physicalRefs: [],
        upstreamIds: track.storyboardIds.map((sid) => buildArtifactId("storyboard", "storyboard-item", sid)),
        downstreamIds: candidateIds,
        deletePolicy: "delete-exclusive-downstream",
        editRoute: `/studio/track/${track.id}`,
        retainedReason: undefined,
        blockerReason: track.state === "failed" ? "Failed rendering state" : undefined };
    });
}

/**
 * Map video candidates to video-candidate artifacts
 * Resolves via trackId -> track.episodeId
 */
export function projectVideoCandidates(
  candidates: VideoCandidate[],
  projectId: string,
  chapterId?: string,
  trackId?: string
): ArtifactRecord[] {
  return candidates
    .filter((c) => !trackId || c.trackId === trackId)
    .map((candidate) => {
      const artId = buildArtifactId("production", "video-candidate", candidate.id);
      const hasResolvedTrack = Boolean(trackId);
      return {
        id: artId,
        projectId,
        chapterId: hasResolvedTrack ? chapterId : undefined,
        stage: "production",
        kind: "video-candidate",
        state: candidate.state === "failed" ? "blocked" : "active",
        name: `Video Candidate ${candidate.id.slice(-6)}`,
        createdAt: candidate.createdAt,
        updatedAt: candidate.createdAt,
        physicalRefs: candidate.filePath
          ? [
              {
                type: "exports",
                path: candidate.filePath,
                bytes: undefined,
                hash256: undefined },
            ]
          : [],
        upstreamIds: [buildArtifactId("production", "production-track", candidate.trackId)],
        downstreamIds: [],
        deletePolicy: hasResolvedTrack
          ? "delete-exclusive-downstream"
          : "blocker-missing-ownership",
        editRoute: `/studio/video/${candidate.id}`,
        retainedReason: undefined,
        blockerReason: !hasResolvedTrack
          ? "Video candidate chapter ownership requires ProductionTrack.episodeId resolution"
          : candidate.state === "failed"
            ? "Failed rendering state"
            : undefined };
    });
}

/**
 * Map TTS voice lines to tts-scene-voice-line artifacts
 * Legacy numeric sceneId blocks unless uniquely mappable
 */
export type LegacyTtsSceneOwnership = ReadonlyMap<number, readonly string[]>;

/**
 * Build an exact legacy scene-id -> episode ownership index.
 *
 * Legacy TTS records only carry a numeric sceneId.  We may resolve one only
 * when the script graph contains the same numeric id as a string and exactly
 * one Episode references that scene id.  No positional or title-based
 * fallback is allowed because those values are not stable ownership keys.
 */
export function buildLegacyTtsSceneOwnership(
  episodes: Episode[],
  scriptScenes: Scene[],
): Map<number, string[]> {
  const knownSceneIds = new Set(scriptScenes.map((scene) => scene.id));
  const ownership = new Map<number, Set<string>>();

  for (const episode of episodes) {
    for (const sceneId of episode.sceneIds) {
      if (!knownSceneIds.has(sceneId) || !/^\d+$/.test(sceneId)) continue;
      const numericSceneId = Number(sceneId);
      if (!Number.isSafeInteger(numericSceneId)) continue;
      const chapterIds = ownership.get(numericSceneId) ?? new Set<string>();
      chapterIds.add(episode.id);
      ownership.set(numericSceneId, chapterIds);
    }
  }

  return new Map(
    Array.from(ownership.entries(), ([sceneId, chapterIds]) => [
      sceneId,
      Array.from(chapterIds).sort(),
    ]),
  );
}

export function projectTTSVoiceLines(
  lines: ProjectableSceneVoiceLine[],
  projectId: string,
  chapterId?: string,
  scriptScenes?: Scene[],
  legacySceneOwnership?: LegacyTtsSceneOwnership,
): ArtifactRecord[] {
  return lines
    .filter((line) => line.projectId === projectId)
    .map((line): ArtifactRecord => {
      const artId = buildArtifactId("voice", "tts-scene-voice-line", line.id ?? `tts-${line.sceneId}`);
      const exactScriptScene = scriptScenes?.some((scene) => scene.id === String(line.sceneId)) ?? false;
      const mappedChapterIds = legacySceneOwnership?.get(line.sceneId) ?? [];
      const mappedChapterId = mappedChapterIds.length === 1 && exactScriptScene
        ? mappedChapterIds[0]
        : undefined;
      const ownedChapterId = line.chapterId ?? mappedChapterId;
      return {
        id: artId,
        projectId,
        chapterId: ownedChapterId,
        stage: "voice",
        kind: "tts-scene-voice-line",
        state: "active",
        name: `Voice Line Scene ${line.sceneId}`,
        createdAt: line.updatedAt ?? 0,
        updatedAt: line.updatedAt ?? 0,
        physicalRefs: line.audioRef
          ? [
              {
                type: "exports",
                path: line.audioRef,
                bytes: undefined,
                hash256: undefined },
            ]
          : [],
        upstreamIds: [],
        downstreamIds: [],
        deletePolicy: ownedChapterId
          ? "delete-exclusive-downstream"
          : "blocker-missing-ownership",
        editRoute: `/tts/voice/${line.sceneId}`,
        retainedReason: undefined,
        blockerReason: !ownedChapterId ? "Missing chapter ownership (legacy numeric sceneId)" : undefined };
    })
    .filter((artifact) => !chapterId || !artifact.chapterId || artifact.chapterId === chapterId);
}

/**
 * Map editing projects to editing-project artifacts
 */
export function projectEditingProjects(
  projects: EditingProject[],
  projectId: string,
  chapterId?: string
): ArtifactRecord[] {
  return projects
    .filter((p) => p.projectId === projectId && (!chapterId || p.episodeId === chapterId))
    .map((project) => {
      const artId = buildArtifactId("editing", "editing-project", project.id);
      return {
        id: artId,
        projectId,
        chapterId,
        stage: "editing",
        kind: "editing-project",
        state: "active",
        name: `Editing Project ${project.id.slice(-6)}`,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        physicalRefs: [],
        upstreamIds: [],
        downstreamIds: [],
        deletePolicy: "delete-exclusive-downstream",
        editRoute: `/editing/project/${project.id}` };
    });
}

/**
 * Map editing runs to editing-run artifacts
 */
export function projectEditingRuns(
  runs: EditingRun[],
  projectId: string,
  chapterId?: string
): ArtifactRecord[] {
  return runs
    .filter((r) => r.projectId === projectId && (!chapterId || r.episodeId === chapterId))
    .map((run) => {
      const artId = buildArtifactId("editing", "editing-run", run.id);
      return {
        id: artId,
        projectId,
        chapterId,
        stage: "editing",
        kind: "editing-run",
        state: "active",
        name: `Editing Run ${run.id.slice(-6)}`,
        createdAt: run.startedAt,
        updatedAt: run.completedAt ?? run.startedAt,
        physicalRefs: [],
        upstreamIds: [],
        downstreamIds: [],
        deletePolicy: "delete-exclusive-downstream",
        editRoute: `/editing/run/${run.id}` };
    });
}

/**
 * Map editing render records to editing-render artifacts
 */
export function projectEditingRenders(
  renders: EditingRenderRecord[],
  projectId: string,
  chapterId?: string
): ArtifactRecord[] {
  return renders
    .filter((r) => r.projectId === projectId && (!chapterId || r.episodeId === chapterId))
    .map((render) => {
      const artId = buildArtifactId("editing", "editing-render", render.id);
      return {
        id: artId,
        projectId,
        chapterId,
        stage: "editing",
        kind: "editing-render",
        state: "active",
        name: `Editing Render ${render.id.slice(-6)}`,
        createdAt: render.startedAt,
        updatedAt: render.completedAt ?? render.startedAt,
        physicalRefs: render.outputPath
          ? [
              {
                type: "exports",
                path: render.outputPath,
                bytes: undefined,
                hash256: undefined },
            ]
          : [],
        upstreamIds: [],
        downstreamIds: [],
        deletePolicy: "delete-exclusive-downstream",
        editRoute: `/editing/render/${render.id}` };
    });
}

/**
 * Map Remotion manifests/jobs to remotion artifacts
 *
 * All Remotion records are chapter-scoped, never episode-scoped.
 */
export function projectRemotionArtifacts(
  projectId: string,
  manifest?: RemotionManifest,
  jobs?: RemotionJob[],
  chapterId?: string
): ArtifactRecord[] {
  const records: ArtifactRecord[] = [];

  if (
    manifest
    && (!manifest.projectId || manifest.projectId === projectId)
    && (!chapterId || manifest.chapterId === chapterId)
  ) {
    const manifestChapterId = manifest.chapterId;
    const artId = buildArtifactId("remotion", "remotion-manifest", manifestChapterId ?? "manifest");
    records.push({
      id: artId,
      projectId,
      chapterId: manifestChapterId,
      stage: "remotion",
      kind: "remotion-manifest",
      state: "active",
      name: "Remotion Manifest",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      physicalRefs: [],
      upstreamIds: [],
      downstreamIds: jobs?.map((j) => buildArtifactId("remotion", "remotion-job", j.id)) ?? [],
      deletePolicy: "delete-exclusive-downstream",
      editRoute: `/remotion/manifest` });
  }

  if (jobs) {
    // All Remotion records use chapterId, NEVER episodeId
    jobs
      .filter((j) => (!j.projectId || j.projectId === projectId) && (!chapterId || j.chapterId === chapterId))
      .forEach((job) => {
        const artId = buildArtifactId("remotion", "remotion-job", job.id);
        records.push({
          id: artId,
          projectId,
          chapterId: job.chapterId,
          stage: "remotion",
          kind: "remotion-job",
          state: "active",
          name: `Remotion Job ${job.id.slice(-6)}`,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          physicalRefs: [],
          upstreamIds: [buildArtifactId("remotion", "remotion-manifest", job.chapterId ?? "manifest")],
          downstreamIds: [],
          deletePolicy: "delete-exclusive-downstream",
          editRoute: `/remotion/job/${job.id}` });
      });
  }

  return records;
}

/**
 * Map continuity bible versions to continuity-bible artifacts
 */
export function projectContinuityBibles(
  versions: ContinuityAssetVersionWithOwnership[],
  projectId: string,
  chapterId?: string
): ArtifactRecord[] {
  return versions
    .filter((v) => v.assetKind === "character" || v.assetKind === "scene" || v.assetKind === "prop")
    .map((version) => {
      const explicitOwnerIds = Array.from(new Set(
        [version.chapterId, version.episodeId]
          .filter((value): value is string => typeof value === "string" && value.length > 0),
      ));
      const ownedChapterId = explicitOwnerIds.length === 1 ? explicitOwnerIds[0] : undefined;
      return { version, ownedChapterId };
    })
    .filter(({ ownedChapterId }) => !chapterId || !ownedChapterId || ownedChapterId === chapterId)
    .map(({ version, ownedChapterId }) => {
      const artId = buildArtifactId("assets", "continuity-bible", `${version.assetId}-${version.versionId}`);
      const ownershipResolved = Boolean(ownedChapterId);
      return {
        id: artId,
        projectId,
        chapterId: ownedChapterId,
        stage: "assets",
        kind: "continuity-bible",
        state: version.structurallyComplete ? "active" : "blocked",
        name: `${version.assetKind} Version: ${version.label}`,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        physicalRefs: version.referenceImagePaths.map((path, index) => ({
          type: "project-file" as const,
          path,
          bytes: undefined,
          hash256: version.referenceImageSha256?.[index] })),
        upstreamIds: [],
        downstreamIds: [],
        deletePolicy: ownershipResolved
          ? "retain-shared-reference"
          : "blocker-missing-ownership",
        editRoute: `/studio/continuity/${version.assetId}`,
        retainedReason: ownershipResolved
          ? "Base asset reference may be shared across chapters"
          : undefined,
        blockerReason: !ownershipResolved
          ? "Continuity version has no unique explicit chapter ownership"
          : !version.structurallyComplete
            ? "Incomplete structure"
            : undefined };
    });
}

/**
 * Map base assets (character/scene/prop) to protected artifacts
 */
export function projectBaseAssets(
  characters: { id: string; name: string }[],
  scenes: { id: string; name: string }[],
  props: { id: string; name: string }[],
  projectId: string,
  _chapterId?: string
): ArtifactRecord[] {
  const records: ArtifactRecord[] = [];

  characters.forEach((char) => {
    const artId = buildArtifactId("assets", "base-character", char.id);
    records.push({
      id: artId,
      projectId,
      chapterId: undefined,
      stage: "assets",
      kind: "base-character",
      state: "active",
      name: char.name,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      physicalRefs: [],
      upstreamIds: [],
      downstreamIds: [],
      deletePolicy: "protected-base-asset",
      editRoute: `/library/characters/${char.id}`,
      retainedReason: "Base character asset - never delete, may need migration" });
  });

  scenes.forEach((scene) => {
    const artId = buildArtifactId("assets", "base-scene", scene.id);
    records.push({
      id: artId,
      projectId,
      chapterId: undefined,
      stage: "assets",
      kind: "base-scene",
      state: "active",
      name: scene.name,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      physicalRefs: [],
      upstreamIds: [],
      downstreamIds: [],
      deletePolicy: "protected-base-asset",
      editRoute: `/library/scenes/${scene.id}`,
      retainedReason: "Base scene asset - never delete, may need migration" });
  });

  props.forEach((prop) => {
    const artId = buildArtifactId("assets", "base-prop", prop.id);
    records.push({
      id: artId,
      projectId,
      chapterId: undefined,
      stage: "assets",
      kind: "base-prop",
      state: "active",
      name: prop.name,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      physicalRefs: [],
      upstreamIds: [],
      downstreamIds: [],
      deletePolicy: "protected-base-asset",
      editRoute: `/library/props/${prop.id}`,
      retainedReason: "Base prop asset - never delete, may need migration" });
  });

  return records;
}

/**
 * Map media files - check ownership and retention policy
 */
export function projectMediaFiles(
  files: ProjectableMediaFile[],
  projectId: string,
  chapterId?: string,
  hasReverseReferences?: boolean
): ArtifactRecord[] {
  return files
    .filter((f) => f.projectId === projectId)
    .map((file) => {
      const artId = buildArtifactId("media-library", "media-file", file.id);
      const isChapterOwned = file.chapterId === chapterId;
      const isShared = !isChapterOwned && hasReverseReferences === false;
      const currentPath = file.relativePath
        ? { type: "project-file" as const, path: file.relativePath }
        : file.url?.startsWith("local-image://") || file.url?.startsWith("local-video://")
          ? { type: "local-media" as const, path: file.url }
          : file.url?.startsWith("project-file://")
            ? { type: "project-file" as const, path: file.url }
            : undefined;
      const legacyPath = !currentPath && file.localPath
        ? { type: "local-media" as const, path: file.localPath }
        : undefined;
      const physicalPath = currentPath ?? legacyPath;

      return {
        id: artId,
        projectId,
        chapterId: file.chapterId,
        stage: "media-library",
        kind: "media-file",
        state: isChapterOwned ? "active" : "active",
        name: file.name,
        createdAt: file.createdAt ?? Date.now(),
        updatedAt: file.updatedAt ?? file.createdAt ?? Date.now(),
        physicalRefs: physicalPath
          ? [
              {
                type: physicalPath.type,
                path: physicalPath.path,
                bytes: file.size,
                hash256: undefined },
            ]
          : [],
        upstreamIds: [],
        downstreamIds: [],
        deletePolicy: isChapterOwned
          ? "delete-exclusive-downstream"
          : isShared
          ? "retain-shared-reference"
          : "blocker-missing-ownership",
        editRoute: `/media/file/${file.id}`,
        retainedReason: isShared ? "Media not owned by target chapter" : undefined,
        blockerReason: !file.chapterId ? "Missing chapter ownership" : undefined };
    });
}

/**
 * Project all artifacts from a complete store snapshot
 * Returns projected records plus legacy mapping diagnostics
 */
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

interface ChapterProjectionScope {
  requestedId?: string;
  canonicalId?: string;
  novelChapterIds?: ReadonlySet<string>;
  legacyEpisodeIds: ReadonlySet<string>;
  resolvedByIndex: boolean;
  legacyMappingStatus: "resolved" | "blocked" | "ambiguous";
}

function resolveChapterProjectionScope(
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
  const unresolvedCandidates = studioState.videoCandidates.filter(
    (candidate) => !knownTrackIds.has(candidate.trackId),
  );
  artifacts.push(...projectVideoCandidates(unresolvedCandidates, projectId));
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
