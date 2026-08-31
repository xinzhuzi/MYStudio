import fs from "node:fs";
import fsp from "node:fs/promises";
import { resolveDataFilePath } from "../storage/storage-paths";
import type { ArtifactRecord, Discrepancy, InventorySummary, RemotionManifest, RunningJob } from "@/types/artifacts";
import type { RemotionRenderJobV1 } from "@/types/remotion-workspace";
import { isRemotionTerminalStatus } from "./inventory-shared";

/**
 * 清单扫描运行态——进行中作业探测/TTS sidecar 状态/差异计算/汇总。file-size-reduction P1 拆出,体逐字保留。
 */
/**
 * Detect running jobs from multiple sources
 */
export async function detectRunningJobs(
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
export async function checkTtsSidecarStatus(
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
export function computeDiscrepancies(
  liveArtifacts: Map<string, ArtifactRecord>,
  diskArtifacts: Map<string, ArtifactRecord>,
): Discrepancy[] {
  const discrepancies: Discrepancy[] = [];

  // Check for disk artifacts not in live state
  for (const [diskId, diskArtifact] of diskArtifacts) {
    if (liveArtifacts.has(diskId)) continue;
    // 仅备份产物（physicalRefs 全为 type:"backup"）是历史快照，结构化
    // 状态从不索引它们——这是设计而非漂移。若计入 missing-index，每个
    // .bak/.codex 残留都会变成删除计划的硬阻塞（applyInventoryDiscrepancy
    // -Blockers 把差异全数转为 blockerItems），用户将永远无法从应用内
    // 删除任何东西。备份的删除语义由 analyzeBackupImpact 单独负责。
    const backupOnly = diskArtifact.physicalRefs.length > 0
      && diskArtifact.physicalRefs.every((ref) => ref.type === "backup");
    if (backupOnly) continue;
    discrepancies.push({
      type: "missing-index",
      description: `Artifact on disk not found in live state: ${diskArtifact.name}`,
      affectedArtifacts: [diskId],
    });
  }

  // A live record without a physical reference is valid for in-memory roots;
  // only a disk record missing from the live projection is a discrepancy.

  return discrepancies;
}

/**
 * Calculate inventory summary
 */
export function calculateSummary(
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

