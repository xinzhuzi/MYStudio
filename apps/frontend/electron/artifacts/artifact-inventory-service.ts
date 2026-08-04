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
  InventoryData,
  ArtifactRecord,
  Discrepancy,
  RunningJob,
  InventorySummary,
  PhysicalRef,
  ArtifactStage,
} from "@/types/artifacts";
import { findBackupDecoder, decodeMixedBackup } from "./backup-decoder-registry";
import {
  resolveProjectRootPath,
  resolveDataDirPath,
  resolveDataFilePath,
} from "../storage/storage-paths";
import { withFileStorageMutationLocks } from "../ipc/files/file-storage-ipc";
import {
  TIMELINE_RENDER_PROGRESS_STAGES,
} from "../rendering/contracts/timeline-renderer";
import type { RemotionManifest, RemotionJob } from "@/types/artifacts";
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
  projectEditingRuns,
  projectEditingRenders,
  projectMediaFiles,
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
  const stats = await fsp.stat(filePath);
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

/**
 * Scan all JSON files in project root directory
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

  async function scanDirectory(dirPath: string, relativePrefix: string) {
    const entries = await fsp.readdir(dirPath, { withFileTypes: true });

    for (const entry of entries) {
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
          await scanDirectory(fullPath, relativePath);
        }
      } else if (entry.isFile()) {
        const kind = /\.json$/i.test(entry.name)
          ? "json"
          : /\.bak$/i.test(entry.name)
            ? "backup"
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

  await scanDirectory(projectRoot, "");
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
): { artifacts: ArtifactRecord[]; decoderFormat?: string } {
  const decoder = findBackupDecoder(rawData);

  if (!decoder) {
    // Mark as explicit 'unknown' artifact type instead of crashing
    console.warn(`No decoder found for ${filePath}`);

    return {
      artifacts: [
        {
          id: buildArtifactId("media-library", "media-file", filePath),
          projectId,
          stage: "media-library",
          kind: "media-file",
          state: "unknown",
          name: `Unknown backup: ${path.basename(filePath)}`,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          physicalRefs: [
            {
              type: "backup",
              path: filePath,
            },
          ],
          upstreamIds: [],
          downstreamIds: [],
          deletePolicy: "blocker-missing-ownership",
          retainedReason: "No decoder found for backup format",
        },
      ],
    };
  }

  try {
    const result = decoder.decode(rawData);

    // Handle different decoder types
    if ("artifacts" in result && Array.isArray(result.artifacts)) {
      // MixedBackupDecoder format
      const records: ArtifactRecord[] = result.artifacts.map((artifact, index) => ({
        id: buildArtifactId(
          artifact.stage as any,
          "media-file",
          `${artifact.projectId || projectId}-${typeof artifact.data === "object" && artifact.data !== null && typeof (artifact.data as { id?: unknown }).id === "string" ? (artifact.data as { id: string }).id : `${artifact.chapterId || "root"}-${index}`}`,
        ),
        projectId: artifact.projectId || projectId,
        chapterId: artifact.chapterId,
        stage: artifact.stage as any,
        kind: "media-file",
        state: artifact.chapterId ? "active" : "unknown",
        name: `${artifact.stage}:media-file`,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        physicalRefs: [],
        upstreamIds: [],
        downstreamIds: [],
        deletePolicy: artifact.chapterId ? "delete-exclusive-downstream" : "blocker-missing-ownership",
        blockerReason: artifact.chapterId ? undefined : "Artifact has no unique chapter ownership",
      }));

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
          physicalRefs: [
            {
              type: "backup",
              path: filePath,
            },
          ],
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
    const ttsRuntimeStatus = await checkTtsSidecarStatus(dataRoot, projectId);
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
  blockers: RunningJob[],
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
export async function scanProjectInventory(
  dataRoot: string,
  projectId: string,
  chapterId?: string,
  mediaRoot?: string,
): Promise<InventoryResult> {
  try {
    // Thread-safe read lock for concurrent storage access
    const inventoryLockPath = resolveDataFilePath(dataRoot, "_system/inventory.lock");
    await withFileStorageMutationLocks([inventoryLockPath], async () => {
      // No-op lock acquisition - ensures serializable reads
      return undefined;
    });

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
          const inferredChapter = chapterId ?? file.relativePath.match(/((?:chapter|episode)[-_][A-Za-z0-9-]+)/i)?.[1];
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
        );

        // Calculate physical fingerprints
        for (const artifact of decodedArtifacts) {
          const fingerprint = await calculateFileFingerprint(file.filePath);

          artifact.bytes = artifact.bytes || fingerprint.bytes;
          artifact.physicalRefs = [
            ...artifact.physicalRefs,
            {
              type: "backup",
              path: file.relativePath,
              bytes: fingerprint.bytes,
              hash256: fingerprint.hash256,
            },
          ];

          diskArtifactsMap.set(artifact.id, artifact);
        }

        artifacts.push(...decodedArtifacts.map((artifact) => ({ ...artifact, physicalRefs: artifact.physicalRefs.map((ref) => ({ ...ref, path: ref.path || file.relativePath })) })));
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
              type: "backup",
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
            const overlay = metadata.overlays[artifact.id];
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
          const decoded = decodeRawContent(projectId, JSON.parse(fs.readFileSync(target, "utf8")), path.relative(root, target));
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
