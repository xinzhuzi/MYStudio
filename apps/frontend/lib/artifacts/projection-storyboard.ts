import type { ArtifactRecord } from "@/types/artifacts";
import type { Episode, ScriptScene as Scene } from "@/types/script";
import type { ProductionTrack, SceneSegmentRecord, StoryboardItem, VideoCandidate } from "@/types/studio";
import { ProjectableSceneVoiceLine, buildArtifactId } from "./projection-shared";

/**
 * 分镜域投影——分镜/生产轨/视频候选/场段/TTS 旁白(含旧版归属映射)。file-size-reduction P1 拆出,体逐字保留。
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
 * Map scene segments (Remotion chapter-scene frameRange renders) to artifacts.
 * Chapter-owned via record.chapterId; upstream is the storyboard chain.
 */
export function projectSceneSegmentArtifacts(
  segments: SceneSegmentRecord[],
  projectId: string,
  chapterId?: string,
): ArtifactRecord[] {
  return segments
    .filter((segment) => !chapterId || segment.chapterId === chapterId)
    .map((segment) => {
      const artId = buildArtifactId("production", "scene-segment", segment.id);
      return {
        id: artId,
        projectId,
        chapterId: segment.chapterId,
        stage: "production",
        kind: "scene-segment",
        state: "active",
        name: `场 ${segment.sceneNo} 分段 · ${segment.sceneName}`,
        createdAt: segment.createdAt,
        updatedAt: segment.createdAt,
        physicalRefs: [
          {
            type: "exports",
            path: segment.outputAbsolutePath,
            bytes: undefined,
            hash256: undefined },
        ],
        upstreamIds: segment.storyboardIds.map((storyboardId) =>
          buildArtifactId("storyboard", "storyboard-item", storyboardId)),
        downstreamIds: [],
        deletePolicy: "delete-exclusive-downstream",
        editRoute: `/studio/scene-segment/${segment.id}`,
        retainedReason: undefined,
        blockerReason: undefined };
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
