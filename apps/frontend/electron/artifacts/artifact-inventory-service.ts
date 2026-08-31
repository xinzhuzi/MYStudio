import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import type { ArtifactRecord, ArtifactStage, InventoryResult, PhysicalRef } from "@/types/artifacts";
import { resolveProjectRootPath } from "../storage/storage-paths";
import { withProjectDeletionLock } from "../storage/project-mutex";
import { withFileStorageMutationLocks } from "../ipc/files/file-storage-ipc";
import { classifyProjectRootStage } from "@/lib/artifacts/project-layout";
import { buildArtifactId } from "@/lib/artifacts/artifact-projection";
import { decodeRawContent, scanProjectFiles } from "./inventory-decode";
import { calculateSummary, computeDiscrepancies, detectRunningJobs } from "./inventory-jobs";
import { BACKUP_ROOT_DIRS, BACKUP_SUFFIX_RE, calculateFileFingerprint, legacyArtifactIdFor, mergeArtifactRecords, physicalRefType } from "./inventory-shared";

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
          // stage 由布局契约表驱动(project-layout.ts 单一事实源);
          // 未匹配根维持 media-library 兜底(历史行为)
          const stage: ArtifactStage = classifyProjectRootStage(file.relativePath);
          const mediaRefType: PhysicalRef["type"] = stage === "remotion" ? "remotion" : stage === "export" ? "exports" : "project-file";
          // 章节归属两级推断：优先取规范的数字章号 token（chapter-001），
          // 它在 chapter-001-archive-20260816 / storyboard-flow-chapter-001-017
          // 这类“章号+后缀”目录里都必须截断，否则每镜/每个归档目录都会
          // 分裂成一个“第 1 章”桶，砸碎产物树的分类认知；没有数字章号时
          // 才按完整路径段兜底（chapter-fixture 这类字母 id）。
          const inferredChapter = file.relativePath.match(/\b(?:chapter|episode)[-_]\d+\b/i)?.[0]
            ?? file.relativePath.match(/(?:^|\/)((?:chapter|episode)[-_][^/.]+)/i)?.[1];
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


export { BACKUP_ROOT_DIRS, BACKUP_SUFFIX_RE, REMOTION_TERMINAL_STATUSES, asRecord, calculateFileFingerprint, collectChapterReferences, firstText, inferMixedArtifactKind, inferMixedArtifactName, isRemotionTerminalStatus, legacyArtifactIdFor, mergeArtifactRecords, physicalRefType } from "./inventory-shared";
export type { RemotionTerminalStatus } from "./inventory-shared";
export { decodeRawContent, scanProjectFiles } from "./inventory-decode";
export { calculateSummary, checkTtsSidecarStatus, computeDiscrepancies, detectRunningJobs } from "./inventory-jobs";
