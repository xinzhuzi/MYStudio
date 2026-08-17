import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type {
  RemotionCurrentSlotPublicationV1,
  RemotionCurrentSlotV1,
  RemotionEvidenceV1,
  RemotionRenderJobV1,
  RemotionRenderJobTarget,
} from "@/types/remotion-workspace";
import { sha256CanonicalJson } from "./canonical-json";
import { remotionCurrentSlotPaths } from "./remotion-current-paths";
import {
  validateRemotionCurrentSlot,
  validateRemotionCurrentSlotPublication,
} from "./remotion-slot-validation";
import {
  sameRemotionTarget,
  type RemotionValidationResult,
} from "./remotion-validation-utils";
import {
  validateRemotionEvidenceIdentity,
  validateRemotionRenderJobIdentity,
} from "./remotion-render-validation";

export { remotionCurrentSlotPaths } from "./remotion-current-paths";

/**
 * Resolve a validated current slot output inside its project workspace.
 * The persisted slot path is relative by contract; callers must not pass it
 * through a generic source resolver that could accept arbitrary paths.
 */
export function resolveRemotionCurrentSlotOutputPath(
  workspaceRoot: string,
  slot: RemotionCurrentSlotV1,
): string {
  if (!path.isAbsolute(workspaceRoot)) {
    throw new Error("current slot workspaceRoot 必须是绝对路径");
  }
  const validated = validateRemotionCurrentSlot(slot);
  if (!validated.success) {
    throw new Error(`current slot 无效: ${validated.issues.map((issue) => issue.message).join("；")}`);
  }
  const expected = remotionCurrentSlotPaths(validated.value.target).outputPath;
  if (validated.value.outputPath !== expected) {
    throw new Error("current slot outputPath 与 target 不一致");
  }
  const resolvedRoot = path.resolve(workspaceRoot);
  const resolvedOutput = path.resolve(resolvedRoot, expected);
  const relative = path.relative(resolvedRoot, resolvedOutput);
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error("current slot outputPath 逃逸项目 Remotion workspace");
  }
  return resolvedOutput;
}

export interface PreparedRemotionCurrentSlotPublication {
  previousCurrent?: RemotionCurrentSlotV1;
  nextCurrent: RemotionCurrentSlotV1;
}

/**
 * Reads one persisted shot current slot without accepting caller-provided
 * paths.  The target determines every path; the persisted job/evidence and
 * output bytes must all agree before a capability URL may be issued.
 */
export async function readRemotionCurrentShotSlot(
  workspaceRoot: string,
  projectId: string,
  target: Extract<RemotionRenderJobTarget, { kind: "shot" }>,
): Promise<RemotionValidationResult<RemotionCurrentSlotV1>> {
  if (!path.isAbsolute(workspaceRoot)) {
    return {
      success: false,
      issues: [{
        code: "remotion.current_slot.workspace_root",
        path: "$.workspaceRoot",
        message: "current slot workspaceRoot 必须是绝对路径",
      }],
    };
  }
  const paths = remotionCurrentSlotPaths(target);
  try {
    const [job, evidence] = await Promise.all([
      readJson(path.join(workspaceRoot, paths.jobPath)),
      readJson(path.join(workspaceRoot, paths.evidencePath)),
    ]);
    const jobResult = await validateRemotionRenderJobIdentity(job);
    const evidenceResult = await validateRemotionEvidenceIdentity(evidence);
    if (!jobResult.success || !evidenceResult.success) {
      return {
        success: false,
        issues: [
          ...(jobResult.success ? [] : jobResult.issues),
          ...(evidenceResult.success ? [] : evidenceResult.issues),
        ],
      };
    }
    const outputPath = path.join(workspaceRoot, paths.outputPath);
    const stat = await fs.promises.stat(outputPath);
    if (!stat.isFile() || stat.size <= 0) {
      return {
        success: false,
        issues: [{
          code: "remotion.current_slot.output_file",
          path: "$.outputPath",
          message: "current shot MP4 不存在或为空",
        }],
      };
    }
    const sha256 = await hashFile(outputPath);
    const issues = [] as Array<{ code: string; path: string; message: string }>;
    if (jobResult.value.projectId !== projectId || evidenceResult.value.projectId !== projectId) {
      issues.push({ code: "remotion.current_slot.project", path: "$.projectId", message: "current slot 不属于当前项目" });
    }
    if (jobResult.value.target.kind !== "shot"
      || evidenceResult.value.target.kind !== "shot"
      || JSON.stringify(jobResult.value.target) !== JSON.stringify(target)
      || JSON.stringify(evidenceResult.value.target) !== JSON.stringify(target)) {
      issues.push({ code: "remotion.current_slot.target", path: "$.target", message: "current slot target 与当前 shot 不一致" });
    }
    if (jobResult.value.outputPath !== paths.outputPath || jobResult.value.evidencePath !== paths.evidencePath
      || evidenceResult.value.outputPath !== paths.outputPath) {
      issues.push({ code: "remotion.current_slot.paths", path: "$.outputPath", message: "current slot 持久化路径不符合 target" });
    }
    if (sha256 !== evidenceResult.value.sha256 || stat.size !== evidenceResult.value.sizeBytes
      || Math.floor(stat.mtimeMs) !== evidenceResult.value.mtimeMs) {
      issues.push({ code: "remotion.current_slot.file_identity", path: "$.evidence", message: "current shot 文件与 evidence SHA/size/mtime 不一致" });
    }
    const cinematic = evidenceResult.value.cinematic;
    if (cinematic) {
      const expectedDepthMapPath = path.posix.join(path.posix.dirname(paths.outputPath), "current.depth.png");
      if (cinematic.depthMapPath !== expectedDepthMapPath) {
        issues.push({
          code: "remotion.current_slot.depth_path",
          path: "$.evidence.cinematic.depthMapPath",
          message: "current depth map 路径与 shot target 不一致",
        });
      } else {
        const depthMapPath = path.join(workspaceRoot, cinematic.depthMapPath);
        try {
          const depthStat = await fs.promises.stat(depthMapPath);
          const depthSha256 = depthStat.isFile() && depthStat.size > 0
            ? await hashFile(depthMapPath)
            : undefined;
          if (depthSha256 !== cinematic.outputSha256) {
            issues.push({
              code: "remotion.current_slot.depth_identity",
              path: "$.evidence.cinematic.outputSha256",
              message: "current depth map 与 evidence SHA 不一致",
            });
          }
        } catch (error) {
          issues.push({
            code: "remotion.current_slot.depth_read",
            path: "$.evidence.cinematic.depthMapPath",
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }
    if (issues.length > 0) return { success: false, issues };
    const slot = buildRemotionCurrentSlot(
      projectId,
      target,
      jobResult.value,
      evidenceResult.value,
      Math.max(jobResult.value.completedAt ?? 0, evidenceResult.value.completedAt),
    );
    return validateCurrentSlot(slot);
  } catch (error) {
    return {
      success: false,
      issues: [{
        code: "remotion.current_slot.read",
        path: "$",
        message: error instanceof Error ? error.message : String(error),
      }],
    };
  }
}

/**
 * Queue state schedules new work. A completed current slot remains valid after
 * restart only when its target-derived job, evidence, and output agree again.
 */
export async function readRemotionCurrentShotSlotsFromWorkspace(
  workspaceRoot: string,
  projectId: string,
  chapterId: string,
): Promise<RemotionCurrentSlotV1[]> {
  if (!path.isAbsolute(workspaceRoot)) {
    throw new Error("current slot workspaceRoot 必须是绝对路径");
  }
  if (!isSafeSegment(projectId) || !isSafeSegment(chapterId)) {
    throw new Error("current slot projectId 或 chapterId 无效");
  }

  const currentJobsRoot = path.join(workspaceRoot, "jobs", "shot", chapterId);
  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(currentJobsRoot, { withFileTypes: true });
  } catch (error) {
    if (isMissingFile(error)) return [];
    throw error;
  }

  const slots = await Promise.all(entries.filter((entry) => entry.isDirectory()).map(async (entry) => {
    const currentJobPath = path.join(currentJobsRoot, entry.name, "current.json");
    try {
      const jobResult = await validateRemotionRenderJobIdentity(await readJson(currentJobPath));
      if (!jobResult.success) return undefined;
      const job = jobResult.value;
      if (job.status !== "succeeded"
        || job.projectId !== projectId
        || job.target.kind !== "shot"
        || job.target.chapterId !== chapterId
        || job.target.shotId !== entry.name) {
        return undefined;
      }
      const slotResult = await readRemotionCurrentShotSlot(workspaceRoot, projectId, job.target);
      if (!slotResult.success) return undefined;
      const slot = slotResult.value;
      if (slot.job.jobId !== job.jobId
        || slot.job.inputHash !== job.inputHash
        || slot.job.bundleContentHash !== job.bundleContentHash
        || slot.job.renderSettingsHash !== job.renderSettingsHash) {
        return undefined;
      }
      return slot;
    } catch {
      return undefined;
    }
  }));

  return slots
    .filter((slot): slot is RemotionCurrentSlotV1 => Boolean(slot))
    .sort((left, right) => {
      if (left.target.kind !== "shot" || right.target.kind !== "shot") return 0;
      return left.target.shotId.localeCompare(right.target.shotId);
    });
}

async function readJson(filePath: string): Promise<unknown> {
  return JSON.parse(await fs.promises.readFile(filePath, "utf8")) as unknown;
}

function isSafeSegment(value: string): boolean {
  return Boolean(value.trim()) && !/[\\/\0]/.test(value);
}

function isMissingFile(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

async function hashFile(filePath: string): Promise<string> {
  const hash = crypto.createHash("sha256");
  await new Promise<void>((resolve, reject) => {
    const stream = fs.createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.once("error", reject);
    stream.once("end", resolve);
  });
  return hash.digest("hex");
}

export function buildRemotionCurrentSlot(
  projectId: string,
  target: RemotionRenderJobTarget,
  job: RemotionRenderJobV1,
  evidence: RemotionEvidenceV1,
  publishedAt: number,
): RemotionCurrentSlotV1 {
  return {
    schemaVersion: 1,
    projectId,
    target,
    ...remotionCurrentSlotPaths(target),
    job,
    evidence,
    publishedAt,
  };
}

export function hashRemotionCurrentSlot(slot: RemotionCurrentSlotV1): Promise<string> {
  return sha256CanonicalJson(slot);
}

export function validateCurrentSlot(value: unknown): RemotionValidationResult<RemotionCurrentSlotV1> {
  return validateRemotionCurrentSlot(value);
}

export function prepareRemotionCurrentSlotPublication(
  publication: RemotionCurrentSlotPublicationV1,
  previousCurrent?: RemotionCurrentSlotV1,
): RemotionValidationResult<PreparedRemotionCurrentSlotPublication> {
  const publicationResult = validateRemotionCurrentSlotPublication(publication);
  if (!publicationResult.success) return publicationResult;
  if (previousCurrent) {
    const previousResult = validateRemotionCurrentSlot(previousCurrent);
    if (!previousResult.success) return previousResult;
    if (
      previousCurrent.projectId !== publication.projectId
      || !sameRemotionTarget(previousCurrent.target, publication.target)
    ) {
      return {
        success: false,
        issues: [{
          code: "remotion.current_slot.replacement_scope",
          path: "$.previousCurrent.target",
          message: "replacement 只能替换同一项目的同一 target current slot",
        }],
      };
    }
  }
  const nextCurrent: RemotionCurrentSlotV1 = {
    schemaVersion: 1,
    projectId: publication.projectId,
    target: publication.target,
    ...publication.currentPaths,
    job: publication.job,
    evidence: publication.evidence,
    publishedAt: publication.preparedAt,
  };
  const nextResult = validateRemotionCurrentSlot(nextCurrent);
  if (!nextResult.success) return nextResult;
  return {
    success: true,
    value: { previousCurrent, nextCurrent: nextResult.value },
  };
}
