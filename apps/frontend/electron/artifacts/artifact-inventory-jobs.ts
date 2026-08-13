// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-larger. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

import fs from "node:fs";
import fsp from "node:fs/promises";
import type {
  RemotionManifest,
  RunningJob,
} from "@/types/artifacts";
import type { RemotionRenderJobV1 } from "@/types/remotion-workspace";
import { resolveDataFilePath } from "../storage/storage-paths";

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
