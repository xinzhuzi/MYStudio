import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { resolveProjectRootPath } from "../storage/storage-paths";
import { findBackupDecoder } from "./backup-decoder-registry";
import { buildArtifactId, projectEditingProjects, projectEntityExtractions, projectNovelChapters, projectProductionTracks, projectScriptEpisodes, projectStoryboards, projectTTSVoiceLines, projectVideoCandidates } from "@/lib/artifacts/artifact-projection";
import { classifyProjectRootStage } from "@/lib/artifacts/project-layout";
import type { ArtifactRecord, ArtifactStage } from "@/types/artifacts";
import type { ScriptData } from "@/types/script";
import { BACKUP_ROOT_DIRS, BACKUP_SUFFIX_RE, collectChapterReferences, inferMixedArtifactKind, inferMixedArtifactName } from "./inventory-shared";

/**
 * 清单扫描解码——项目文件枚举 + 备份解码器注册表分发解码。file-size-reduction P1 拆出,体逐字保留。
 */
/**
 * Scan persisted JSON, backup, media and other files in the project root.
 */
export async function scanProjectFiles(dataRoot: string, projectId: string): Promise<
  Array<{ filePath: string; relativePath: string; kind: "json" | "backup" | "media" | "other"; special?: "symlink" | "special-file" }>
> {
  const projectRoot = resolveProjectRootPath(dataRoot, projectId);

  // Check if project root exists
  if (!fs.existsSync(projectRoot)) {
    return [];
  }

  const files: Array<{ filePath: string; relativePath: string; kind: "json" | "backup" | "media" | "other"; special?: "symlink" | "special-file" }> = [];

  async function scanDirectory(
    dirPath: string,
    relativePrefix: string,
    insideBackupRoot: boolean,
  ) {
    const entries = await fsp.readdir(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.name === ".artifact-delete-journal.json" || /^\.artifact-delete-.*\.bundle\.json$/i.test(entry.name)) continue;
      // Skip macOS Finder metadata — pure noise, never a real artifact. Prevents
      // .DS_Store files from polluting the artifact inventory in cross-platform
      // copies of a project data dir.
      if (entry.name === ".DS_Store" || entry.name === "._.DS_Store") continue;
      const fullPath = path.join(dirPath, entry.name);
      const relativePath = relativePrefix
        ? `${relativePrefix}/${entry.name}`
        : entry.name;

      const stat = await fsp.lstat(fullPath);
      if (stat.isSymbolicLink()) {
        files.push({ filePath: fullPath, relativePath, kind: "other", special: "symlink" });
      } else if (entry.isDirectory()) {
        // Skip hidden directories and node_modules
        if (!entry.name.startsWith(".") && entry.name !== "node_modules") {
          const entersBackupRoot = insideBackupRoot
            || relativePrefix === "" && BACKUP_ROOT_DIRS.has(entry.name);
          await scanDirectory(fullPath, relativePath, entersBackupRoot);
        }
      } else if (entry.isFile()) {
        const kind = BACKUP_SUFFIX_RE.test(entry.name) || insideBackupRoot
          ? "backup"
          : /\.json$/i.test(entry.name)
            ? "json"
            : /\.(?:png|jpe?g|webp|gif|mp4|webm|mov|wav|mp3|m4a|aac|flac)$/i.test(entry.name)
              ? "media"
              : "other";
        files.push({
          filePath: fullPath,
          relativePath,
          kind,
        });
      } else {
        files.push({ filePath: fullPath, relativePath, kind: "other", special: "special-file" });
      }
    }
  }

  await scanDirectory(projectRoot, "", false);
  return files;
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
    // 未识别 JSON 同样走布局契约表(store/→project-store 等);根级文件兜底 media-library
    const stage: ArtifactStage = fileKind === "backup" ? "backup" : classifyProjectRootStage(filePath);

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

