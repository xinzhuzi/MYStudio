// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-larger. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

import path from "node:path";
import type {
  ArtifactRecord,
  ArtifactKind,
  ArtifactStage,
} from "@/types/artifacts";
import { findBackupDecoder } from "./backup-decoder-registry";
import type { ScriptData } from "@/types/script";
import {
  projectNovelChapters,
  projectEntityExtractions,
  projectScriptEpisodes,
  projectStoryboards,
  projectProductionTracks,
  projectVideoCandidates,
  projectTTSVoiceLines,
  projectEditingProjects,
  buildArtifactId,
} from "@/lib/artifacts/artifact-projection";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function firstText(data: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = data[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return undefined;
}

function inferMixedArtifactKind(stage: string, rawData: unknown): ArtifactKind {
  const data = asRecord(rawData);
  switch (stage) {
    case "novel":
      return "novel-chapter";
    case "analysis":
      return Array.isArray(data.entities) || Array.isArray(data.extractions)
        ? "director-entity-extraction"
        : "agent-workflow-result";
    case "script":
      return typeof data.sceneId === "string" || Array.isArray(data.dialogue) || Array.isArray(data.shots)
        ? "script-scene"
        : "script-episode";
    case "assets": {
      const subtype = firstText(data, ["subtype", "type", "assetType"]);
      if (subtype === "character") return data.category === "chapter-exclusive" ? "character-variant" : "base-character";
      if (subtype === "scene") return data.category === "chapter-exclusive" ? "scene-derivative" : "base-scene";
      if (subtype === "prop") return data.category === "chapter-exclusive" ? "prop-derivative" : "base-prop";
      return "media-file";
    }
    case "storyboard":
      return "storyboard-item";
    case "image":
      return "storyboard-image-workflow";
    case "voice":
      return "tts-scene-voice-line";
    case "production":
      return Array.isArray(data.candidateVideoIds) || Array.isArray(data.storyboardIds)
        ? "production-track"
        : "video-candidate";
    case "editing":
      return data.outputPath || data.outputRef ? "editing-render" : data.startedAt ? "editing-run" : "editing-project";
    case "remotion":
      return data.jobId || data.status ? "remotion-job" : data.manifestId || data.compositionId ? "remotion-manifest" : "remotion-output";
    case "export": {
      const pathValue = firstText(data, ["path", "filePath", "outputPath"]);
      if (/\.(?:mp4|webm|mov)$/i.test(pathValue ?? "")) return "export-video";
      if (/\.(?:wav|mp3|m4a|aac|flac)$/i.test(pathValue ?? "")) return "export-audio";
      if (/\.(?:png|jpe?g|webp|gif)$/i.test(pathValue ?? "")) return "export-frame";
      return "export-report";
    }
    default:
      return "media-file";
  }
}

function inferMixedArtifactName(stage: string, rawData: unknown, index: number): string {
  const data = asRecord(rawData);
  const name = firstText(data, ["name", "title", "displayName", "chapterTitle", "label", "filename", "fileName"]);
  if (name) return name;
  const id = firstText(data, ["id", "chapterId", "episodeId", "sceneId", "panelId", "jobId"]);
  return id ? `${stage} · ${id}` : `${stage} · 条目 ${index + 1}`;
}

const CHAPTER_REFERENCE_RE = /\b(?:chapter|episode)[-_]\d+\b/gi;

function collectChapterReferences(value: unknown, output = new Set<string>()): string[] {
  if (typeof value === "string") {
    for (const match of value.matchAll(CHAPTER_REFERENCE_RE)) output.add(match[0].toLowerCase());
  } else if (Array.isArray(value)) {
    for (const item of value) collectChapterReferences(item, output);
  } else if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      collectChapterReferences(key, output);
      collectChapterReferences(child, output);
    }
  }
  return [...output].sort();
}

/**
 * Decode raw JSON content using backup decoder registry
 * Returns explicit 'unknown' artifact type if no decoder found
 */
export function decodeRawContent(
  projectId: string,
  rawData: unknown,
  filePath: string,
  fileKind: "json" | "backup",
): { artifacts: ArtifactRecord[]; decoderFormat?: string } {
  const decoder = findBackupDecoder(rawData);

  if (!decoder) {
    console.warn(`No decoder found for ${filePath}`);
    const isTopLevelConfig = !filePath.includes("/");
    const pathChapters = collectChapterReferences(filePath);
    const contentChapters = collectChapterReferences(rawData);
    const [pathChapter] = pathChapters;
    const isExplicitChapterBackup = fileKind === "backup"
      && pathChapters.length === 1
      && contentChapters.every((chapter) => chapter === pathChapter);
    const relatedChapters = [...new Set([...pathChapters, ...contentChapters])];
    const chapterScopes: Array<string | undefined> = isExplicitChapterBackup
      ? [pathChapter]
      : relatedChapters.length > 0
        ? relatedChapters
        : [undefined];
    const stage: ArtifactStage = fileKind === "backup" ? "backup" : "media-library";

    return {
      artifacts: chapterScopes.map((relatedChapter) => {
        const isDirectDelete = isExplicitChapterBackup && relatedChapter === pathChapter;
        return {
          id: buildArtifactId("media-library", "media-file", relatedChapter ? `${filePath}@${relatedChapter}` : filePath),
          projectId,
          chapterId: relatedChapter,
          stage,
          kind: "media-file" as const,
          state: isDirectDelete ? "active" as const : "unknown" as const,
          name: fileKind === "backup"
            ? `未识别备份: ${path.basename(filePath)}`
            : isTopLevelConfig
              ? `未识别项目文件: ${path.basename(filePath)}`
              : `未识别产物: ${path.basename(filePath)}`,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          physicalRefs: [],
          upstreamIds: [],
          downstreamIds: [],
          deletePolicy: isDirectDelete ? "delete-exclusive-downstream" as const : "blocker-missing-ownership" as const,
          blockerReason: isDirectDelete
            ? undefined
            : fileKind === "backup"
              ? "备份格式无注册解码器,无法安全判定单章或跨章边界"
              : "持久化 JSON 无注册解码器,无法安全判定删除语义",
        };
      }),
    };
  }

  try {
    const result = decoder.decode(rawData);

    // Handle different decoder types
    if ("artifacts" in result && Array.isArray(result.artifacts)) {
      // MixedBackupDecoder format
      const records: ArtifactRecord[] = result.artifacts.map((artifact, index) => {
        const kind = inferMixedArtifactKind(artifact.stage, artifact.data);
        const artifactId = typeof artifact.data === "object" && artifact.data !== null && typeof (artifact.data as { id?: unknown }).id === "string"
          ? (artifact.data as { id: string }).id
          : `${artifact.chapterId || "root"}-${index}`;
        return {
        id: `${artifact.stage}:${kind}:${artifact.projectId || projectId}-${artifactId}`,
        projectId: artifact.projectId || projectId,
        chapterId: artifact.chapterId,
// eslint-disable-next-line @typescript-eslint/no-explicit-any
        stage: artifact.stage as any,
        kind,
        state: artifact.chapterId ? "active" : "unknown",
        name: inferMixedArtifactName(artifact.stage, artifact.data, index),
        createdAt: Date.now(),
        updatedAt: Date.now(),
        physicalRefs: [],
        upstreamIds: [],
        downstreamIds: [],
        deletePolicy: artifact.chapterId ? "delete-exclusive-downstream" : "blocker-missing-ownership",
        blockerReason: artifact.chapterId ? undefined : "Artifact has no unique chapter ownership",
        };
      });

      return {
        artifacts: records,
        decoderFormat: decoder.formatName,
      };
    }

    // Handle store decoders
    const records: ArtifactRecord[] = [];

    // Novel chapters
    if ("novelChapters" in result && Array.isArray(result.novelChapters)) {
      const novelRecords = projectNovelChapters(
        result.novelChapters,
        projectId,
        undefined,
      );
      records.push(...novelRecords);
    }

    // Entity extractions
    if ("entityExtractions" in result && Array.isArray(result.entityExtractions)) {
      const extractionRecords = projectEntityExtractions(
        result.entityExtractions,
        projectId,
        undefined,
      );
      records.push(...extractionRecords);
    }

    // Script episodes
    if ("scriptData" in result) {
      const scriptData = result.scriptData as ScriptData;
      if (Array.isArray(scriptData.episodes)) {
        const episodeRecords = projectScriptEpisodes(
          scriptData.episodes,
          projectId,
          undefined,
        );
        records.push(...episodeRecords);
      }
    }

    // Storyboard items
    if ("storyboardItems" in result && Array.isArray(result.storyboardItems)) {
      const storyboardRecords = projectStoryboards(
        result.storyboardItems,
        projectId,
        undefined,
      );
      records.push(...storyboardRecords);
    }

    // Production tracks
    if ("productionTracks" in result && Array.isArray(result.productionTracks)) {
      const trackRecords = projectProductionTracks(
        result.productionTracks,
        projectId,
        undefined,
      );
      records.push(...trackRecords);
    }

    // Video candidates
    if ("videoCandidates" in result && Array.isArray(result.videoCandidates)) {
      const candidateRecords = projectVideoCandidates(
        result.videoCandidates,
        projectId,
        undefined,
      );
      records.push(...candidateRecords);
    }

    // Scene voice lines
    if ("voiceLines" in result && Array.isArray(result.voiceLines)) {
      const voiceLineRecords = projectTTSVoiceLines(
        result.voiceLines,
        projectId,
        undefined,
      );
      records.push(...voiceLineRecords);
    }

    // Editing projects
    if ("editingProjects" in result && Array.isArray(result.editingProjects)) {
      const editingRecords = projectEditingProjects(
        result.editingProjects,
        projectId,
        undefined,
      );
      records.push(...editingRecords);
    }

    return {
      artifacts: records,
      decoderFormat: decoder.type,
    };
  } catch (error) {
    console.error(`Failed to decode ${filePath}:`, error);

    // Return unknown artifact on decode failure
    return {
      artifacts: [
        {
          id: buildArtifactId("media-library", "media-file", filePath),
          projectId,
          stage: "media-library",
          kind: "media-file",
          state: "unknown",
          name: `Decode error: ${path.basename(filePath)}`,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          physicalRefs: [],
          upstreamIds: [],
          downstreamIds: [],
          deletePolicy: "blocker-missing-ownership",
          retainedReason: `Decode failed: ${(error as Error).message}`,
        },
      ],
    };
  }
}
