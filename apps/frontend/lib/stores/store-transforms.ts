// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

/**
 * Slice 6 Store Transforms
 *
 * Pure transformation functions that compute next-state from current state.
 * DO NOT mutate stores directly - return new immutable snapshots.
 *
 * Purpose: Centralize immutable state transitions for all 7 core slices:
 * - Novel chapters (studio-store)
 * - Script episodes (script-store)
 * - Editing projects (editing-store)
 * - TTS voice lines (tts-store)
 * - Director continuity (director-store)
 * - Media files (media-store)
 * - Remotion manifests/jobs (remotion-workspace)
 */

import type { NovelChapter } from "@/types/studio";
import type { Episode, ScriptScene } from "@/types/script";
import type { AutoEditingRun, EditingProjectV1, TimelineRenderRecord } from "@/types/editing";
import type { SceneVoiceLine } from "@/types/tts";
import type { MediaFile } from "@/types/media";
import type { StoryboardItem } from "@/types/studio";
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import type { RemotionChapterManifestV1, RemotionShotDefinitionV2 } from "@/types/remotion-workspace";

// ============================================================================
// 1. Novel Chapters Transform (studio-store slice)
// ============================================================================

export interface NovelChaptersSnapshot {
  novelChapters: NovelChapter[];
}

export function studioTransformDeleteNovelChapters(
  snapshot: NovelChaptersSnapshot,
  idsToDelete: Set<string>
): NovelChaptersSnapshot {
  // Filter out deleted chapters while preserving Zustand envelope structure
  const retained = snapshot.novelChapters.filter(chapter => !idsToDelete.has(chapter.id));

  return {
    novelChapters: retained,
  };
}

// ============================================================================
// 2. Script Episodes Transform (script-store slice)
// ============================================================================

export interface ScriptDataSnapshot {
  projects: Record<string, {
    scriptData?: {
      episodes?: Episode[];
      scenes: ScriptScene[];
    };
    shots: { sceneRefId: string }[];
    episodeRawScripts?: { episodeIndex: number; title: string }[];
  }>;
}

export function scriptTransformDeleteEpisodes(
  snapshot: ScriptDataSnapshot,
  projectId: string,
  episodeIndices: number[]
): ScriptDataSnapshot {
  const indicesToDelete = new Set(episodeIndices);
  const project = snapshot.projects[projectId];

  if (!project?.scriptData?.episodes) {
    return snapshot;
  }

  const episodesToRetain = project.scriptData.episodes.filter(e => !indicesToDelete.has(e.index));
  const indexMap = new Map(episodesToRetain.map((episode, index) => [episode.index, index + 1]));

  // CRITICAL: Reindex to contiguous 1-based indices
  const reindexedEpisodes = episodesToRetain.map((e, i) => ({
    ...e,
    index: i + 1,
  }));

  const reindexedRawScripts = (project.episodeRawScripts || [])
    .filter((raw) => !indicesToDelete.has(raw.episodeIndex))
    .map((raw) => {
      const nextIndex = indexMap.get(raw.episodeIndex) ?? raw.episodeIndex;
      return {
        ...raw,
        episodeIndex: nextIndex,
        title: raw.title.replace(/^第\s*\d+\s*集/, `第 ${nextIndex} 集`),
      };
    });

  const sceneIdsToRemove = new Set(
    project.scriptData.episodes
      .filter(e => indicesToDelete.has(e.index))
      .flatMap(e => e.sceneIds || [])
  );

  return {
    projects: {
      ...snapshot.projects,
      [projectId]: {
        ...project,
        scriptData: {
          ...project.scriptData,
          episodes: reindexedEpisodes,
          scenes: project.scriptData.scenes.filter(s => !sceneIdsToRemove.has(s.id)),
        },
        shots: project.shots.filter(s => !sceneIdsToRemove.has(s.sceneRefId)),
        episodeRawScripts: reindexedRawScripts,
      },
    },
  };
}

// ============================================================================
// 3. Editing Projects Transform (editing-store slice)
// ============================================================================

export interface EditingProjectsSnapshot {
  editingProjects: Record<string, EditingProjectV1>;
  autoEditingRuns: Record<string, AutoEditingRun>;
  timelineRenderRecordsByEditingProjectId: Record<string, TimelineRenderRecord>;
  currentEditingProjectIdByEpisode: Record<string, string>;
  autoEditingRunIdsByEpisode: Record<string, string[]>;
}

export function editingTransformDeleteProjects(
  snapshot: EditingProjectsSnapshot,
  projectId: string,
  episodeId: string
): EditingProjectsSnapshot {
  const keysToDelete = Object.keys(snapshot.editingProjects).filter(id => {
    const project = snapshot.editingProjects[id];
    return project.projectId === projectId &&
           project.episodeId === episodeId;
  });

  // Build new primary indexes by retaining records
  const retainedProjects: EditingProjectsSnapshot["editingProjects"] = {};
  for (const id of Object.keys(snapshot.editingProjects)) {
    if (!keysToDelete.includes(id)) {
      retainedProjects[id] = snapshot.editingProjects[id];
    }
  }

  // Rebuild secondary indexes from retained records
  const retainedEpisodeMap: Record<string, string> = {};
  const retainedRunIdsByEpisode: Record<string, string[]> = {};

  for (const [id, project] of Object.entries(retainedProjects)) {
    const epKey = project.episodeId;
    if (epKey) {
      retainedEpisodeMap[epKey] = id;
    }
  }

  for (const run of Object.values(snapshot.autoEditingRuns)) {
    if (run.projectId === projectId) {
      const epKey = run.episodeId;
      if (epKey) {
        retainedRunIdsByEpisode[epKey] =
          (retainedRunIdsByEpisode[epKey] || []).concat(run.id);
      }
    }
  }

  return {
    editingProjects: retainedProjects,
    autoEditingRuns: snapshot.autoEditingRuns,
    timelineRenderRecordsByEditingProjectId: snapshot.timelineRenderRecordsByEditingProjectId,
    currentEditingProjectIdByEpisode: retainedEpisodeMap,
    autoEditingRunIdsByEpisode: retainedRunIdsByEpisode,
  };
}

// ============================================================================
// 4. TTS Voice Lines Transform (tts-store slice)
// ============================================================================

export interface TtsVoiceLinesSnapshot {
  voiceLines: Record<string, SceneVoiceLine>;
}

export function ttsTransformCleanupVoiceLines(
  snapshot: TtsVoiceLinesSnapshot,
  sceneIds: number[],
  episodeId?: string,
  chapterId?: string
): TtsVoiceLinesSnapshot {
  // Block ambiguous ownership (no guessing between episode/chapter)
  if ((episodeId && chapterId) || (!episodeId && !chapterId)) {
    // Return unchanged if ownership is unclear
    return {
      voiceLines: { ...snapshot.voiceLines },
    };
  }

  const scopeId = episodeId ?? chapterId!;
  const normalizedLines: Record<string, SceneVoiceLine> = {};
  const legacyIdsToMigrate: number[] = [];

  // First pass: identify lines to retain and flag legacy IDs for migration
  for (const [key, line] of Object.entries(snapshot.voiceLines)) {
    const numericSceneId = parseInt(key, 10);

    // Check if this is a legacy numeric reference
    if (!isNaN(numericSceneId) && Number.isInteger(numericSceneId)) {
      legacyIdsToMigrate.push(numericSceneId);

      // Only migrate if uniquely resolvable (not ambiguous)
      if (legacyIdsToMigrate.length === 1 && legacyIdsToMigrate[0] === numericSceneId) {
        // Uniquely resolvable - normalize ownership
        normalizedLines[scopeId] = {
          ...line,
          sceneId: numericSceneId,
        };
      } else {
        // Ambiguous - block migration, keep original or delete
        if (!sceneIds.includes(numericSceneId)) {
          // Delete if not in retention list
          continue;
        }
      }
    } else {
      // Non-legacy key - check if should be retained
      if (!sceneIds.includes(line.sceneId)) {
        continue;
      }
      normalizedLines[key] = { ...line };
    }
  }

  return {
    voiceLines: normalizedLines,
  };
}

// ============================================================================
// 5. Director Continuity Transform (director-store slice)
// ============================================================================

export interface DirectorContinuitySnapshot {
  storyboardItems: StoryboardItem[];
  continuityBibleVersions: { chapterId?: string; episodeId?: string }[];
}

/**
 * Cleanup director continuity for a deleted chapter.
 *
 * Storyboards are keyed by episodeId, so we only remove storyboards whose
 * episodeId belongs to the deleted chapter (passed explicitly via
 * episodeIdsInChapter). Without that mapping we NEVER guess - all storyboards
 * are preserved. Continuity bible versions matching chapterId (and not shared
 * with a surviving episode) are removed.
 */
export function directorTransformCleanupContinuity(
  snapshot: DirectorContinuitySnapshot,
  chapterId: string,
  episodeIdsInChapter: Set<string> = new Set()
): DirectorContinuitySnapshot {
  // Preserve storyboardItems; only remove those whose episodeId belongs to
  // the deleted chapter. Items without episodeId or in other episodes stay.
  const retainedStoryboards = snapshot.storyboardItems.filter(item => {
    if (!item.episodeId) return true;
    return !episodeIdsInChapter.has(item.episodeId);
  });

  // Remove chapter-only continuity bible versions. Versions that also carry an
  // episodeId (cross-chapter) are preserved to protect shared continuity.
  const retainedBibleVersions = snapshot.continuityBibleVersions.filter(version => {
    if (version.chapterId !== chapterId) return true;
    return version.episodeId !== undefined;
  });

  return {
    storyboardItems: retainedStoryboards,
    continuityBibleVersions: retainedBibleVersions,
  };
}

// ============================================================================
// 6. Media Files Transform (media-store slice)
// ============================================================================

export interface MediaFilesSnapshot {
  mediaFiles: MediaFile[];
}

export function mediaTransformFilterByOwnership(
  snapshot: MediaFilesSnapshot,
  projectRoot: string,
  chapterId?: string
): MediaFilesSnapshot {
  // Check if file is strictly under chapter-specific path (relative paths don't include projectRoot)
  const isChapterSpecific = (fileRelativePath: string) => {
    if (!chapterId) return false;
    // Relative paths are like "chapter-1/file.jpg" or "project-level/assets/img.png"
    // Only delete files that start with "chapterId/" - NOT the chapterId at root
    const basePath = chapterId + "/";
    return fileRelativePath.startsWith(basePath);
  };

  const retainedFiles = snapshot.mediaFiles.filter(file => !isChapterSpecific(file.relativePath ?? ""));

  return {
    mediaFiles: retainedFiles,
  };
}

// ============================================================================
// 7. Remotion Chapter Records Transform (remotion-workspace slice)
// ============================================================================

export interface RemotionManifestSnapshot {
  manifests: RemotionChapterManifestV1[];
}

export function remotionTransformRemoveChapterRecords(
  snapshot: RemotionManifestSnapshot,
  chapterId: string
): RemotionManifestSnapshot {
  // Match by chapterId ONLY (never episodeId in Remotion!)
  const retained = snapshot.manifests.filter(manifest => manifest.chapterId !== chapterId);

  return {
    manifests: retained,
  };
}
