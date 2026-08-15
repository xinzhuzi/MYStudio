// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-larger. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

/**
 * Read-only artifact inventory service
 *
 * Scans project root directory (_p/{projectId}/) for persisted JSON files,
 * decodes them using backup decoder registry, maps to ArtifactRecord via
 * projector functions, calculates physical file fingerprints, and detects
 * running jobs as blockers.
 *
 * Key constraints:
 * - Read-only mode: NO file modifications or deletions
 * - Thread-safe reads: Use withFileStorageMutationLocks
 * - Explicit 'unknown' artifact type if no decoder found
 * - Check REMOTION_TERMINAL_STATUSES for completed jobs only
 * - Legacy ownership detection: episode-1 mapping, numeric sceneId resolution
 */

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import type {
  InventoryResult,
 
  ArtifactRecord,
  ArtifactKind,
  Discrepancy,
  RunningJob,
  InventorySummary,
  PhysicalRef,
  ArtifactStage,
} from "@/types/artifacts";
import { findBackupDecoder } from "./backup-decoder-registry";
import {
  resolveProjectRootPath,
 
  resolveDataFilePath,
} from "../storage/storage-paths";
import { withProjectDeletionLock } from "../storage/project-mutex";
import { withFileStorageMutationLocks } from "../ipc/files/file-storage-ipc";
import {
 
} from "../rendering/contracts/timeline-renderer";
 
import type { RemotionManifest } from "@/types/artifacts";
import type { RemotionRenderJobV1 } from "@/types/remotion-workspace";
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

/** Terminal statuses that indicate job is complete (not running) */
const REMOTION_TERMINAL_STATUSES = [
  "succeeded",
  "failed",
  "canceled",
] as const;

type RemotionTerminalStatus = (typeof REMOTION_TERMINAL_STATUSES)[number];

/** Check if a status is terminal (completed) */
function isRemotionTerminalStatus(
  status: unknown,
): status is RemotionTerminalStatus {
  return typeof status === "string" &&
    REMOTION_TERMINAL_STATUSES.includes(status as RemotionTerminalStatus);
}

/**
 * Calculate SHA-256 fingerprint of a file
 */
async function calculateFileFingerprint(filePath: string): Promise<{
  bytes: number;
  hash256: string;
}> {
 
  await fsp.stat(filePath);
  const hash = createHash("sha256");
  const stream = fs.createReadStream(filePath);

  return new Promise((resolve, reject) => {
    let bytesRead = 0;

    stream.on("data", (chunk) => {
      hash.update(chunk);
      bytesRead += chunk.length;
    });

    stream.on("end", () => {
      resolve({
        bytes: bytesRead,
        hash256: hash.digest("hex"),
      });
    });

    stream.on("error", reject);
  });
}

function physicalRefType(
  fileKind: "json" | "backup" | "media" | "other",
  _decoderFormat?: string,
): PhysicalRef["type"] {
  if (fileKind === "backup") return "backup";
  // Decoder format describes the JSON payload, not its physical provenance.
  // Active project JSON must remain a project-file even when it uses a legacy
  // or mixed-backup decoder; only the scanner's suffix classification can mark
  // a source as backup.
  return "project-file";
}

function mergeArtifactRecords(existing: ArtifactRecord, incoming: ArtifactRecord): ArtifactRecord {
  const refs = new Map<string, PhysicalRef>();
  for (const ref of [...existing.physicalRefs, ...incoming.physicalRefs]) {
    refs.set(`${ref.type}:${ref.path}`, ref);
  }
  const physicalRefs = [...refs.values()];
  const referencedBytes = physicalRefs.reduce((sum, ref) => sum + (ref.bytes ?? 0), 0);
  return {
    ...existing,
    chapterId: existing.chapterId ?? incoming.chapterId,
    state: existing.state === "blocked" || incoming.state === "blocked"
      ? "blocked"
      : existing.state === "active" || incoming.state === "active"
        ? "active"
        : existing.state,
    bytes: referencedBytes || existing.bytes || incoming.bytes,
    physicalRefs,
  };
}

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

function legacyArtifactIdFor(artifact: ArtifactRecord): string {
  const parts = artifact.id.split(":");
  return parts.length >= 3 ? `${parts[0]}:media-file:${parts.slice(2).join(":")}` : artifact.id;
}

/**
 * Matches historical backup file suffixes so their physical source is
 * classified as `kind:"backup"`. Registered JSON content is still decoded;
 * unregistered or malformed content remains a fail-closed backup blocker.
 *
 * Matches (against the basename, anchored to end):
 * - `.bak`, `.bak-xxx`, `.bak_xxx`
 * - `.codex-xxx`, `.codex-white-screen-test-backup`
 * - `.smoke-xxx`
 *
 * Design notes:
 * - Every alternative ends with `$` and uses the no-dot class `[^.]*` after
 *   the separator, so `.codex-` / `.smoke-` only match as the FINAL suffix.
 *   This prevents false positives like `data.codex-backup.json`,
 *   `chapter.codex-snapshot.json` or `report.smoke-test.json` (the `.json`
 *   after `.codex-...` would otherwise be swallowed by a greedy `.*`).
 * - The char class is `[-_]` only — `-` at the start of a class is a literal,
 *   so this is a valid range-free class (no SyntaxError, unlike the addendum's
 *   invalid `[-_-.]` range).
 */
const BACKUP_SUFFIX_RE = /\.(?:bak(?:[-_][^.]*)?$|codex[-_][^.]*$|smoke[-_][^.]*$)/i;

/**
 * Project-root subdirectories that hold whole-store snapshots rather than live
 * data. Their contents are plain-named `.json` (e.g. `studio-workflow-store.json`)
 * with no `.bak`/`.codex` suffix, so files below these roots must inherit backup
 * provenance while still being decoded and merged into the logical inventory.
 *
 * - `backups` — chapter continuity snapshots and other historical project
 *   backups whose child JSON files do not carry a backup suffix.
 * - `visual-continuity-backups` — written by the chapter-video promote pipeline
 *   (`apps/build/chapter_video/pipeline/promote_chapter001_storyboard_continuity.py`)
 *   as `storyboard-promotion-<timestamp>-<sha>/studio-workflow-store.json`
 *   snapshots during storyboard promotion.
 *
 * Add further whole-store-snapshot roots here as they are introduced.
 */
const BACKUP_ROOT_DIRS = new Set<string>(["backups", "visual-continuity-backups"]);

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
 * Scan persisted JSON, backup, media and other files in the project root.
 */
async function scanProjectFiles(dataRoot: string, projectId: string): Promise<
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
function decodeRawContent(
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

/**
 * Detect running jobs from multiple sources
 */
async function detectRunningJobs(
  dataRoot: string,
  projectId: string,
  chapterId?: string,
): Promise<RunningJob[]> {
  const runningJobs: RunningJob[] = [];

  // 1. Check Remotion queue (from persistence)
  try {
    const remotionStorePath = resolveDataFilePath(
      dataRoot,
      `studio/remotion-manifest.json`,
    );

    if (fs.existsSync(remotionStorePath)) {
      const content = await fsp.readFile(remotionStorePath, "utf-8");
      const storeData = JSON.parse(content) as {
        manifest?: RemotionManifest;
        jobs?: RemotionRenderJobV1[];
      };

      if (storeData.jobs && Array.isArray(storeData.jobs)) {
        for (const job of storeData.jobs) {
          const jobId = job.jobId;
          if (!jobId) continue;

          // Check if job belongs to this project/chapter
          const matchesProject = job.projectId === projectId;
          const targetChapterId = typeof job.target === 'object' && job.target !== null && 'chapterId' in job.target
            ? (job.target as { chapterId: string }).chapterId
            : undefined;
          const matchesChapter = !chapterId || targetChapterId === chapterId;

          if (!matchesProject || !matchesChapter) continue;

          // Skip terminal status jobs (succeeded/failed/canceled)
          if (isRemotionTerminalStatus(job.status)) {
            continue;
          }

          // Job is running
          runningJobs.push({
            jobId,
            projectId: job.projectId,
            chapterId: targetChapterId,
            type: "remotion",
            startedAt: job.startedAt || Date.now(),
          });
        }
      }
    }
  } catch (error) {
    console.error("Failed to read Remotion queue:", error);
  }

  // 2. Check the TTS sidecar.  An unavailable sidecar is not a running job;
  // an explicit queued/generating record is a hard chapter blocker.
  try {
    const ttsRuntimeStatus = await checkTtsSidecarStatus(dataRoot, projectId, chapterId);
    runningJobs.push(...ttsRuntimeStatus);
  } catch (error) {
    console.error("Failed to check TTS sidecar:", error);
  }

  return runningJobs;
}

/**
 * Check TTS sidecar for running generations
 */
async function checkTtsSidecarStatus(
  dataRoot: string,
  projectId: string,
  chapterId?: string,
): Promise<RunningJob[]> {
  void dataRoot;
  if (typeof fetch !== "function") return [];
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 250);
  try {
    const response = await fetch("http://127.0.0.1:17593/status", { signal: controller.signal });
    if (!response.ok) return [];
    const body = await response.json() as { generations?: Array<Record<string, unknown>> };
    return (Array.isArray(body.generations) ? body.generations : [])
      .filter((generation) => generation.status === "queued" || generation.status === "generating")
      .filter((generation) => generation.project_id === projectId || generation.projectId === projectId)
      .filter((generation) => {
        const owningChapter = typeof generation.chapter_id === "string"
          ? generation.chapter_id
          : typeof generation.chapterId === "string"
            ? generation.chapterId
            : undefined;
        return !chapterId || !owningChapter || owningChapter === chapterId;
      })
      .map((generation) => ({
        jobId: String(generation.id ?? generation.generation_id ?? "tts-unknown"),
        projectId,
        chapterId: typeof generation.chapter_id === "string" ? generation.chapter_id : typeof generation.chapterId === "string" ? generation.chapterId : undefined,
        type: "tts" as const,
        startedAt: typeof generation.created_at === "number" ? generation.created_at * 1000 : Date.now(),
      }));
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Compare live artifacts with disk artifacts to find discrepancies
 */
function computeDiscrepancies(
  liveArtifacts: Map<string, ArtifactRecord>,
  diskArtifacts: Map<string, ArtifactRecord>,
): Discrepancy[] {
  const discrepancies: Discrepancy[] = [];

  // Check for disk artifacts not in live state
  for (const [diskId, diskArtifact] of diskArtifacts) {
    if (!liveArtifacts.has(diskId)) {
      discrepancies.push({
        type: "missing-index",
        description: `Artifact on disk not found in live state: ${diskArtifact.name}`,
        affectedArtifacts: [diskId],
      });
    }
  }

  // A live record without a physical reference is valid for in-memory roots;
  // only a disk record missing from the live projection is a discrepancy.

  return discrepancies;
}

/**
 * Calculate inventory summary
 */
function calculateSummary(
  artifacts: ArtifactRecord[],
  _blockers: RunningJob[],
): InventorySummary {
  const byStage: Record<string, number> = {};
  const byKind: Record<string, number> = {};
  const byState: Record<string, number> = {};
  let totalBytes = 0;
  let deleteEligible = 0;
  let retainDueToShared = 0;
  let blockedByJobs = 0;
  let blockedByUnknown = 0;

  for (const artifact of artifacts) {
    byStage[artifact.stage] = (byStage[artifact.stage] || 0) + 1;
    byKind[artifact.kind] = (byKind[artifact.kind] || 0) + 1;
    byState[artifact.state] = (byState[artifact.state] || 0) + 1;

    if (artifact.bytes) {
      totalBytes += artifact.bytes;
    }

    if (artifact.deletePolicy === "delete-exclusive-downstream") {
      deleteEligible++;
    } else if (artifact.deletePolicy === "retain-shared-reference") {
      retainDueToShared++;
    } else if (artifact.deletePolicy === "blocker-running-job") {
      blockedByJobs++;
    } else if (artifact.deletePolicy === "blocker-missing-ownership") {
      blockedByUnknown++;
    }
  }

  return {
    totalArtifacts: artifacts.length,
    byStage,
    byKind,
    byState,
    totalBytes,
    deleteEligible,
    retainDueToShared,
    blockedByJobs,
    blockedByUnknown,
  };
}

/**
 * Main inventory service entry point
 *
 * Scans project root directory (_p/{projectId}/) using resolveProjectRootPath,
 * reads all persisted JSON files, decodes using backup decoder registry,
 * maps to ArtifactRecord via projector functions, calculates physical file
 * fingerprints, detects running jobs as blockers, and returns typed InventoryResult.
 *
 * @param dataRoot - Base application data directory
 * @param projectId - Project identifier
 * @param chapterId - Optional chapter filter
 * @returns Typed InventoryResult with artifacts, discrepancies, and blockers
 */
export type InventoryScanOptions = {
  /** Internal transaction call: the deletion service already owns this lock. */
  projectLockAlreadyHeld?: boolean;
};

async function scanProjectInventoryUnlocked(
  dataRoot: string,
  projectId: string,
  chapterId?: string,
  _mediaRoot?: string,
): Promise<InventoryResult> {
  try {
    // Step 1: Scan persisted stores, backups, media exports and special files.
    const scannedFiles = await scanProjectFiles(dataRoot, projectId);

    // Step 2: Read and decode each file
    const artifacts: ArtifactRecord[] = [];
    const diskArtifactsMap = new Map<string, ArtifactRecord>();

    for (const file of scannedFiles) {
      try {
        // Artifact metadata is an overlay index, not a workflow artifact.
        // Keep it out of the inventory itself and apply it to matching records
        // after the physical scan completes.
        if (file.relativePath === "artifacts.json") continue;
        if (file.special) {
          artifacts.push({
            id: buildArtifactId("media-library", "media-file", file.relativePath),
            projectId,
            chapterId,
            stage: "media-library",
            kind: "media-file",
            state: "blocked",
            name: path.basename(file.filePath),
            createdAt: Date.now(),
            updatedAt: Date.now(),
            physicalRefs: [{ type: "project-file", path: file.relativePath, special: file.special }],
            upstreamIds: [],
            downstreamIds: [],
            deletePolicy: "blocker-missing-ownership",
            blockerReason: `Special filesystem entry: ${file.special}`,
          });
          continue;
        }

        if (file.kind !== "json" && file.kind !== "backup") {
          const fingerprint = await calculateFileFingerprint(file.filePath);
          const stage: ArtifactStage = file.relativePath.includes("remotion") ? "remotion" : file.relativePath.includes("exports") ? "export" : file.relativePath.includes("workflow-images") ? "image" : "media-library";
          const mediaRefType: PhysicalRef["type"] = stage === "remotion" ? "remotion" : stage === "export" ? "exports" : "project-file";
          const inferredChapter = file.relativePath.match(/((?:chapter|episode)[-_][A-Za-z0-9-]+)/i)?.[1];
          artifacts.push({
            id: buildArtifactId("media-library", "media-file", file.relativePath),
            projectId,
            chapterId: inferredChapter,
            stage,
            kind: "media-file",
            state: inferredChapter ? "active" : "unknown",
            name: path.basename(file.filePath),
            createdAt: (await fsp.stat(file.filePath)).birthtimeMs || Date.now(),
            updatedAt: (await fsp.stat(file.filePath)).mtimeMs,
            bytes: fingerprint.bytes,
            physicalRefs: [{ type: mediaRefType, path: file.relativePath, bytes: fingerprint.bytes, hash256: fingerprint.hash256 }],
            upstreamIds: [],
            downstreamIds: [],
            deletePolicy: inferredChapter ? "delete-exclusive-downstream" : "blocker-missing-ownership",
            blockerReason: inferredChapter ? undefined : "Physical artifact has no unique chapter ownership",
          });
          continue;
        }

        const content = await fsp.readFile(file.filePath, "utf-8");
        const rawData = JSON.parse(content);

        const { artifacts: decodedArtifacts, decoderFormat } = decodeRawContent(
          projectId,
          rawData,
          file.relativePath,
          file.kind,
        );

        // Calculate physical fingerprints
        for (const artifact of decodedArtifacts) {
          const fingerprint = await calculateFileFingerprint(file.filePath);

          artifact.bytes = artifact.bytes || fingerprint.bytes;
          artifact.physicalRefs = [
            ...artifact.physicalRefs.filter((ref) => ref.path),
            {
              type: physicalRefType(file.kind, decoderFormat),
              path: file.relativePath,
              bytes: fingerprint.bytes,
              hash256: fingerprint.hash256,
            },
          ];

          const previous = diskArtifactsMap.get(artifact.id);
          diskArtifactsMap.set(
            artifact.id,
            previous ? mergeArtifactRecords(previous, artifact) : artifact,
          );
        }
      } catch (error) {
        console.error(`Failed to process ${file.relativePath}:`, error);

        // Create error artifact for failed files
        const errorArtifact: ArtifactRecord = {
          id: buildArtifactId("media-library", "media-file", file.relativePath),
          projectId,
          chapterId,
          stage: "media-library",
          kind: "media-file",
          state: "unknown",
          name: `Read error: ${path.basename(file.filePath)}`,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          physicalRefs: [
            {
              type: file.kind === "backup" ? "backup" : "project-file",
              path: file.relativePath,
            },
          ],
          upstreamIds: [],
          downstreamIds: [],
          deletePolicy: "blocker-missing-ownership",
          retainedReason: `Read failed: ${(error as Error).message}`,
        };

        artifacts.push(errorArtifact);
      }
    }

    artifacts.push(...diskArtifactsMap.values());

    // Step 3: Detect running jobs as blockers
    const blockers = await detectRunningJobs(dataRoot, projectId, chapterId);

    // Step 4: Compute discrepancies
    const liveArtifactsMap = new Map<string, ArtifactRecord>();
    // Simulate live state from stores - in production, would query Zustand stores
    // Compare the disk projection against the complete project projection
    // before applying the optional chapter filter.  Comparing a chapter-only
    // live view with a project-wide disk view would falsely report every
    // untouched chapter as a discrepancy and block a valid deletion.
    const liveArtifacts = projectLiveArtifacts(dataRoot, projectId);

    for (const artifact of liveArtifacts) {
      liveArtifactsMap.set(artifact.id, artifact);
    }

    const discrepancies = computeDiscrepancies(liveArtifactsMap, diskArtifactsMap);

    // Step 5: Apply blockers to artifacts before calculating summary.
    try {
      const metadataPath = path.join(resolveProjectRootPath(dataRoot, projectId), "artifacts.json");
      if (fs.existsSync(metadataPath)) {
        const metadata = JSON.parse(await fsp.readFile(metadataPath, "utf8")) as { overlays?: Record<string, ArtifactRecord["metadata"]> };
        if (metadata.overlays && typeof metadata.overlays === "object") {
          for (const artifact of artifacts) {
            const overlay = metadata.overlays[artifact.id] ?? metadata.overlays[legacyArtifactIdFor(artifact)];
            if (overlay) artifact.metadata = overlay;
          }
        }
      }
    } catch {
      // Malformed metadata is non-destructive; the artifact remains editable
      // after the user repairs the overlay file.
    }

    for (const blocker of blockers) {
      const matchingArtifacts = artifacts.filter(
        (a) =>
          a.projectId === blocker.projectId &&
          (!blocker.chapterId || a.chapterId === blocker.chapterId),
      );

      for (const artifact of matchingArtifacts) {
        artifact.blockerReason = `Blocked by active ${blocker.type} job: ${blocker.jobId}`;
        artifact.state = "blocked";
        artifact.deletePolicy = "blocker-running-job" as const;
      }
    }

    const filteredArtifacts = chapterId ? artifacts.filter((artifact) => artifact.chapterId === chapterId || artifact.chapterId === undefined && artifact.physicalRefs.some((ref) => ref.path.includes(chapterId))) : artifacts;
    const summary = calculateSummary(filteredArtifacts, blockers);

    return {
      success: true,
      data: {
        projectId,
        chapterId,
        artifacts: filteredArtifacts,
        discrepancies,
        blockers,
        summary,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: `Inventory scan failed: ${(error as Error).message}`,
    };
  }
}

/**
 * Serialize the complete inventory scan against the artifact transaction's
 * project mutex. The project lock is acquired FIRST, then the deterministic
 * file lock used for the on-disk marker. The internal post-delete scan opts out
 * because executeDeletion already holds the key for the whole transaction.
 */
export async function scanProjectInventory(
  dataRoot: string,
  projectId: string,
  chapterId?: string,
  mediaRoot?: string,
  options: InventoryScanOptions = {},
): Promise<InventoryResult> {
  if (options.projectLockAlreadyHeld) {
    return scanProjectInventoryUnlocked(dataRoot, projectId, chapterId, mediaRoot);
  }

  try {
    const projectRoot = resolveProjectRootPath(dataRoot, projectId);
    const projectLockPath = path.join(projectRoot, ".artifact-delete-project.lock");
    return await withProjectDeletionLock(
      `${dataRoot}:${projectId}`,
      () => withFileStorageMutationLocks(
        [projectLockPath],
        () => scanProjectInventoryUnlocked(dataRoot, projectId, chapterId, mediaRoot),
      ),
    );
  } catch (error) {
    return {
      success: false,
      error: `Inventory scan failed: ${(error as Error).message}`,
    };
  }
}

/**
 * Simulate live artifacts from Zustand stores
 * In production, would query actual store states
 */
function projectLiveArtifacts(
  dataRoot: string,
  projectId: string,
  chapterId?: string,
): ArtifactRecord[] {
  const artifacts: ArtifactRecord[] = [];
  try {
    const root = resolveProjectRootPath(dataRoot, projectId);
    const visit = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name.startsWith(".")) continue;
        const target = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          visit(target);
          continue;
        }
        if (!entry.isFile() || !/\.(?:json|bak)$/i.test(entry.name)) continue;
        if (path.relative(root, target) === "artifacts.json") continue;
        try {
          const relativePath = path.relative(root, target);
          const fileKind = BACKUP_SUFFIX_RE.test(entry.name)
            || relativePath.split(path.sep).some((segment) => BACKUP_ROOT_DIRS.has(segment))
            ? "backup"
            : "json";
          const decoded = decodeRawContent(projectId, JSON.parse(fs.readFileSync(target, "utf8")), relativePath, fileKind);
          artifacts.push(...decoded.artifacts.filter((artifact) => !chapterId || artifact.chapterId === chapterId));
        } catch {
          // Invalid persisted JSON is represented by the disk scan as unknown;
          // do not let one malformed store hide the rest of the live projection.
        }
      }
    };
    if (fs.existsSync(root)) visit(root);
  } catch (error) {
    console.error("Failed to load live stores:", error);
  }

  return artifacts;
}
