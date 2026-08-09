import fs from "node:fs";
import path from "node:path";
import {
  validateHyperFramesOverlayArtifact,
  validateVideoUseChapterArtifact,
  type HyperFramesOverlayArtifactV1,
  type VideoUseChapterArtifactV1,
  type VideoWorkflowValidationIssue,
} from "@rendering/contracts/video-workflow";

export interface VideoWorkflowArtifactPaths {
  revisionDir: string;
  videoUsePath: string;
  hyperFramesPath: string;
}

export interface VideoWorkflowChapterArtifacts {
  paths: VideoWorkflowArtifactPaths;
  videoUseArtifact?: VideoUseChapterArtifactV1;
  hyperFramesArtifact?: HyperFramesOverlayArtifactV1;
}

export interface VideoWorkflowLatestChapterArtifacts {
  revision: number;
  artifacts: VideoWorkflowChapterArtifacts;
}

export type VideoWorkflowArtifactReadResult =
  | { success: true; value: VideoWorkflowChapterArtifacts }
  | { success: false; issues: VideoWorkflowValidationIssue[] };

export interface VideoWorkflowReviewRequestV1 {
  projectId: string;
  chapterId: string;
  revision: number;
  reviewer: string;
  timestamp?: number;
}

export type VideoWorkflowReviewResult =
  | { success: true; artifact: VideoUseChapterArtifactV1; artifactPath: string }
  | { success: false; issues: VideoWorkflowValidationIssue[]; artifactPath?: string };

export function resolveVideoWorkflowArtifactPaths(
  workspaceRootForProject: (projectId: string) => string,
  projectId: string,
  chapterId: string,
  revision: number,
): VideoWorkflowArtifactPaths {
  const safeProjectId = safeSegment(projectId, "projectId");
  const safeChapterId = safeSegment(chapterId, "chapterId");
  if (!Number.isInteger(revision) || revision <= 0) throw new Error("revision 必须是正整数");
  const workspaceRoot = workspaceRootForProject(safeProjectId);
  if (!path.isAbsolute(workspaceRoot)) throw new Error("video workflow workspaceRoot 必须是绝对路径");
  const revisionDir = path.join(workspaceRoot, safeChapterId, `r${revision}`);
  return {
    revisionDir,
    videoUsePath: path.join(revisionDir, "video-use-artifact.json"),
    hyperFramesPath: path.join(revisionDir, "hyperframes-artifact.json"),
  };
}

export async function readVideoWorkflowChapterArtifacts(
  workspaceRootForProject: (projectId: string) => string,
  identity: { projectId: string; chapterId: string; revision: number },
): Promise<VideoWorkflowArtifactReadResult> {
  let paths: VideoWorkflowArtifactPaths;
  try {
    paths = resolveVideoWorkflowArtifactPaths(
      workspaceRootForProject,
      identity.projectId,
      identity.chapterId,
      identity.revision,
    );
  } catch (error) {
    return { success: false, issues: [{ path: "$", message: error instanceof Error ? error.message : String(error) }] };
  }

  const issues: VideoWorkflowValidationIssue[] = [];
  const videoUseArtifact = await readArtifact(
    paths.videoUsePath,
    validateVideoUseChapterArtifact,
    "$.videoUseArtifact",
    issues,
  );
  const hyperFramesArtifact = await readArtifact(
    paths.hyperFramesPath,
    validateHyperFramesOverlayArtifact,
    "$.hyperFramesArtifact",
    issues,
  );
  if (issues.length > 0) return { success: false, issues };
  return {
    success: true,
    value: {
      paths,
      ...(videoUseArtifact ? { videoUseArtifact } : {}),
      ...(hyperFramesArtifact ? { hyperFramesArtifact } : {}),
    },
  };
}

/**
 * Reads the newest revision directory for one known project/chapter.
 *
 * The scan is deliberately limited to the already-resolved chapter directory;
 * it never walks the project tree or treats an arbitrary file name as a
 * revision. A malformed newest artifact is returned as blocked evidence rather
 * than silently falling back to an older revision.
 */
export async function readLatestVideoWorkflowChapterArtifacts(
  workspaceRootForProject: (projectId: string) => string,
  identity: { projectId: string; chapterId: string },
): Promise<
  | { success: true; value?: VideoWorkflowLatestChapterArtifacts }
  | { success: false; issues: VideoWorkflowValidationIssue[] }
> {
  let chapterDir: string;
  try {
    const safeProjectId = safeSegment(identity.projectId, "projectId");
    const safeChapterId = safeSegment(identity.chapterId, "chapterId");
    const workspaceRoot = workspaceRootForProject(safeProjectId);
    if (!path.isAbsolute(workspaceRoot)) throw new Error("video workflow workspaceRoot 必须是绝对路径");
    chapterDir = path.join(workspaceRoot, safeChapterId);
  } catch (error) {
    return { success: false, issues: [{ path: "$", message: error instanceof Error ? error.message : String(error) }] };
  }

  let entries: string[];
  try {
    entries = await fs.promises.readdir(chapterDir);
  } catch (error) {
    if (isMissingFile(error)) return { success: true };
    return { success: false, issues: [{ path: "$.chapter", message: `无法读取 artifact 章节目录: ${error instanceof Error ? error.message : String(error)}` }] };
  }
  const revisions = entries
    .map((entry) => /^r([1-9]\d*)$/.exec(entry))
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match) => Number(match[1]))
    .filter((revision) => Number.isSafeInteger(revision) && revision > 0)
    .sort((left, right) => right - left);
  for (const revision of revisions) {
    const result = await readVideoWorkflowChapterArtifacts(
      workspaceRootForProject,
      { ...identity, revision },
    );
    if (!result.success) return result;
    if (result.value.videoUseArtifact || result.value.hyperFramesArtifact) {
      return { success: true, value: { revision, artifacts: result.value } };
    }
  }
  return { success: true };
}

/**
 * Records the explicit UI approval for a pending video-use preview.
 *
 * The worker's evidence hash describes the mechanical artifact before the
 * review sidecar is attached.  Keeping that hash stable lets the HyperFrames
 * and Remotion gates prove that the user approved exactly what was rendered.
 */
export async function acceptVideoUseArtifact(
  workspaceRootForProject: (projectId: string) => string,
  request: VideoWorkflowReviewRequestV1,
  now = Date.now(),
): Promise<VideoWorkflowReviewResult> {
  let paths: VideoWorkflowArtifactPaths;
  try {
    paths = resolveVideoWorkflowArtifactPaths(
      workspaceRootForProject,
      request.projectId,
      request.chapterId,
      request.revision,
    );
  } catch (error) {
    return { success: false, issues: [{ path: "$", message: error instanceof Error ? error.message : String(error) }] };
  }
  let raw: unknown | undefined;
  try {
    raw = await readJson(paths.videoUsePath);
  } catch (error) {
    return { success: false, artifactPath: paths.videoUsePath, issues: [{ path: "$.videoUseArtifact", message: `无法读取 artifact: ${error instanceof Error ? error.message : String(error)}` }] };
  }
  if (raw === undefined) return { success: false, artifactPath: paths.videoUsePath, issues: [{ path: "$.videoUseArtifact", message: "缺少待确认的 video-use artifact" }] };
  const parsed = validateVideoUseChapterArtifact(raw);
  if (!parsed.success) return { success: false, artifactPath: paths.videoUsePath, issues: parsed.issues };
  const artifact = parsed.value;
  if (artifact.projectId !== request.projectId || artifact.chapterId !== request.chapterId || artifact.revision !== request.revision) {
    return { success: false, artifactPath: paths.videoUsePath, issues: [{ path: "identity", message: "artifact 与确认请求的 project/chapter/revision 不一致" }] };
  }
  const reviewer = request.reviewer.trim();
  if (!reviewer) return { success: false, artifactPath: paths.videoUsePath, issues: [{ path: "reviewer", message: "确认人不能为空" }] };
  if (!Number.isFinite(now) || now <= 0) return { success: false, artifactPath: paths.videoUsePath, issues: [{ path: "timestamp", message: "确认时间戳无效" }] };
  if (artifact.status === "accepted" && artifact.stage === "ready" && artifact.review) {
    if (artifact.review.artifactSha256 !== artifact.evidence.artifactSha256) {
      return { success: false, artifactPath: paths.videoUsePath, issues: [{ path: "review.artifactSha256", message: "现有 review sidecar 与 artifact hash 不一致" }] };
    }
    return { success: true, artifact, artifactPath: paths.videoUsePath };
  }
  if (artifact.status !== "pending" || artifact.stage !== "awaiting-review") {
    return { success: false, artifactPath: paths.videoUsePath, issues: [{ path: "artifact", message: "只有 awaiting-review/pending artifact 可以确认" }] };
  }
  const reviewed: VideoUseChapterArtifactV1 = {
    ...artifact,
    stage: "ready",
    status: "accepted",
    review: {
      projectId: request.projectId,
      chapterId: request.chapterId,
      revision: request.revision,
      artifactSha256: artifact.evidence.artifactSha256,
      reviewer,
      decision: "accepted",
      timestamp: now,
    },
  };
  const validated = validateVideoUseChapterArtifact(reviewed);
  if (!validated.success) return { success: false, artifactPath: paths.videoUsePath, issues: validated.issues };
  try {
    writeVideoWorkflowJson(paths.videoUsePath, validated.value);
  } catch (error) {
    return { success: false, artifactPath: paths.videoUsePath, issues: [{ path: "$.videoUseArtifact", message: `写入确认结果失败: ${error instanceof Error ? error.message : String(error)}` }] };
  }
  return { success: true, artifact: validated.value, artifactPath: paths.videoUsePath };
}

export function writeVideoWorkflowJson(filePath: string, value: unknown): void {
  if (!path.isAbsolute(filePath)) throw new Error("artifact path 必须是绝对路径");
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(temporaryPath, filePath);
}

async function readArtifact<T>(
  filePath: string,
  validator: (value: unknown) => { success: true; value: T } | { success: false; issues: VideoWorkflowValidationIssue[] },
  pathPrefix: string,
  issues: VideoWorkflowValidationIssue[],
): Promise<T | undefined> {
  let raw: string;
  try {
    raw = await fs.promises.readFile(filePath, "utf8");
  } catch (error) {
    if (isMissingFile(error)) return undefined;
    issues.push({ path: pathPrefix, message: `无法读取 artifact: ${error instanceof Error ? error.message : String(error)}` });
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch (error) {
    issues.push({ path: pathPrefix, message: `artifact JSON 无效: ${error instanceof Error ? error.message : String(error)}` });
    return undefined;
  }
  const result = validator(parsed);
  if (!result.success) {
    issues.push(...result.issues.map((entry) => ({ ...entry, path: `${pathPrefix}${entry.path === "$" ? "" : entry.path.slice(1)}` })));
    return undefined;
  }
  return result.value;
}

async function readJson(filePath: string): Promise<unknown | undefined> {
  try {
    return JSON.parse(await fs.promises.readFile(filePath, "utf8")) as unknown;
  } catch (error) {
    if (isMissingFile(error)) return undefined;
    throw error;
  }
}

function isMissingFile(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function safeSegment(value: string, field: string): string {
  if (!/^[A-Za-z0-9._-]+$/.test(value) || value === "." || value === "..") {
    throw new Error(`${field} 不能包含路径分隔符或目录跳转`);
  }
  return value;
}
