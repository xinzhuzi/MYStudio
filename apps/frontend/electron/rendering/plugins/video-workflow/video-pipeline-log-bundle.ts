// Video Pipeline Log Bundle — collects artifacts from all three pipeline stages
// (Remotion, video-use, HyperFrames) plus diagnostics logs into a single
// exportable JSON bundle with hash-chain provenance verification.
//
// This service mirrors the existing diagnostics exportBundle pattern but
// aggregates the video-production evidence system that is currently scattered
// across multiple directories under _p/{projectId}/.

import fs from "node:fs";
import path from "node:path";

export const LOG_BUNDLE_SCHEMA_VERSION = 1 as const;

export interface VideoPipelineLogBundleV1 {
  schemaVersion: typeof LOG_BUNDLE_SCHEMA_VERSION;
  projectId: string;
  chapterId: string;
  revision: number;
  exportedAt: number;
  stages: {
    remotion: {
      shots: Array<{
        shotId: string;
        job: unknown;
        evidence: unknown;
        depthArtifact?: unknown;
      }>;
      chapter: {
        job: unknown;
        evidence: unknown;
        renderPlan?: unknown;
        editingProject?: unknown;
        manifest?: unknown;
      } | null;
    };
    videoUse: {
      run?: unknown;
      artifact?: unknown;
      alignment?: unknown;
    } | null;
    hyperframes: {
      request?: unknown;
      artifact?: unknown;
    } | null;
    diagnostics: {
      entries: unknown[];
      fileCount: number;
    };
  };
  provenance: {
    videoUseArtifactSha256?: string;
    hyperframesSourceArtifactSha256?: string;
    chapterEvidenceInputHash?: string;
    verified: boolean;
    notes: string[];
  };
}

export interface LogBundleOptions {
  /** Project data root (main.ts getDataDir()): artifacts live under `<dataRoot>/_p/<projectId>/`. */
  dataRoot: string;
  projectId: string;
  chapterId: string;
  revision?: number;
  /** Diagnostics JSONL directory (`<userData>/logs/diagnostics`). */
  diagnosticsDir?: string;
  now?: () => number;
}

/**
 * Create a unified log bundle by collecting artifacts from all three stages.
 */
export function createVideoPipelineLogBundle(options: LogBundleOptions): VideoPipelineLogBundleV1 {
  const now = options.now ?? Date.now;
  const projectRoot = path.join(options.dataRoot, "_p", options.projectId);
  const remotionDir = path.join(projectRoot, "remotion");
  const videoUseDir = path.join(projectRoot, "video-use", options.chapterId);

  // Determine the latest revision if not specified
  const revision = options.revision ?? resolveLatestRevision(videoUseDir);
  const revisionDir = revision > 0 ? path.join(videoUseDir, `r${revision}`) : null;

  // --- Stage 1: Remotion ---
  const remotionShots = collectRemotionShots(remotionDir, options.chapterId);
  const remotionChapter = collectRemotionChapter(remotionDir, options.chapterId);

  // --- Stage 2: video-use ---
  const videoUse = revisionDir ? collectVideoUseArtifacts(revisionDir) : null;

  // --- Stage 3: HyperFrames ---
  const hyperframes = revisionDir ? collectHyperFramesArtifacts(revisionDir) : null;

  // --- Diagnostics ---
  const diagnostics = collectDiagnostics(options.diagnosticsDir, options.projectId, options.chapterId);
  // --- Provenance verification ---
  const provenance = verifyProvenance(remotionChapter, videoUse, hyperframes);

  return {
    schemaVersion: LOG_BUNDLE_SCHEMA_VERSION,
    projectId: options.projectId,
    chapterId: options.chapterId,
    revision,
    exportedAt: now(),
    stages: {
      remotion: {
        shots: remotionShots,
        chapter: remotionChapter,
      },
      videoUse,
      hyperframes,
      diagnostics,
    },
    provenance,
  };
}

/**
 * Write the bundle to a file and return the path.
 */
export function writeLogBundle(bundle: VideoPipelineLogBundleV1, outputPath: string): string {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const tempPath = `${outputPath}.${process.pid}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(bundle, null, 2), "utf8");
  fs.renameSync(tempPath, outputPath);
  return outputPath;
}

// ---------------------------------------------------------------------------
// Collectors
// ---------------------------------------------------------------------------

function readJsonFile(filePath: string): unknown | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function resolveLatestRevision(videoUseDir: string): number {
  try {
    const entries = fs.readdirSync(videoUseDir, { withFileTypes: true });
    const revisions = entries
      .filter((entry) => entry.isDirectory() && /^r\d+$/.test(entry.name))
      .map((entry) => parseInt(entry.name.slice(1), 10))
      .filter((n) => Number.isFinite(n) && n > 0);
    return revisions.length > 0 ? Math.max(...revisions) : 0;
  } catch {
    return 0;
  }
}

function collectRemotionShots(remotionDir: string, chapterId: string): Array<{ shotId: string; job: unknown; evidence: unknown; depthArtifact?: unknown }> {
  const shots: Array<{ shotId: string; job: unknown; evidence: unknown; depthArtifact?: unknown }> = [];
  const shotJobsDir = path.join(remotionDir, "jobs", "shot", chapterId);
  const shotEvidenceDir = path.join(remotionDir, "evidence", "shots", chapterId);

  let shotIds: string[] = [];
  try {
    shotIds = fs.readdirSync(shotJobsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return shots;
  }

  for (const shotId of shotIds) {
    const job = readJsonFile(path.join(shotJobsDir, shotId, "current.json"));
    const evidence = readJsonFile(path.join(shotEvidenceDir, shotId, "current.json"));
    const depthArtifact = readJsonFile(path.join(remotionDir, "depth", shotId, "depth-artifact.json"));
    shots.push({ shotId, job, evidence, depthArtifact: depthArtifact ?? undefined });
  }

  return shots;
}

function collectRemotionChapter(remotionDir: string, chapterId: string): VideoPipelineLogBundleV1["stages"]["remotion"]["chapter"] {
  const chapterJobDir = path.join(remotionDir, "jobs", "chapter", chapterId);
  const job = readJsonFile(path.join(chapterJobDir, "current.json"));
  if (!job) return null;

  const evidence = readJsonFile(path.join(remotionDir, "evidence", "chapters", chapterId, "current.json"));
  const renderPlan = readJsonFile(path.join(chapterJobDir, "current-render-plan.json"));
  const editingProject = readJsonFile(path.join(chapterJobDir, "current-editing-project.json"));
  const manifest = readJsonFile(path.join(remotionDir, "chapters", `${chapterId}.json`));

  return { job, evidence, renderPlan: renderPlan ?? undefined, editingProject: editingProject ?? undefined, manifest: manifest ?? undefined };
}

function collectVideoUseArtifacts(revisionDir: string): VideoPipelineLogBundleV1["stages"]["videoUse"] {
  return {
    run: readJsonFile(path.join(revisionDir, "video-use-run.json")) ?? undefined,
    artifact: readJsonFile(path.join(revisionDir, "video-use-artifact.json")) ?? undefined,
    alignment: readJsonFile(path.join(revisionDir, "alignment.json")) ?? undefined,
  };
}

function collectHyperFramesArtifacts(revisionDir: string): VideoPipelineLogBundleV1["stages"]["hyperframes"] {
  return {
    request: readJsonFile(path.join(revisionDir, "hyperframes-request.json")) ?? undefined,
    artifact: readJsonFile(path.join(revisionDir, "hyperframes-artifact.json")) ?? undefined,
  };
}

function collectDiagnostics(diagnosticsDir: string | undefined, projectId: string, chapterId: string): { entries: unknown[]; fileCount: number } {
  const entries: unknown[] = [];
  let fileCount = 0;

  if (!diagnosticsDir) return { entries, fileCount };
  try {
    const files = fs.readdirSync(diagnosticsDir).filter((f) => f.endsWith(".jsonl"));
    fileCount = files.length;

    for (const file of files) {
      const content = fs.readFileSync(path.join(diagnosticsDir, file), "utf8");
      for (const line of content.split("\n")) {
        if (!line.trim()) continue;
        try {
          const entry = JSON.parse(line);
          // Filter entries related to this project/chapter
          const ctx = typeof entry?.context === "object" ? entry.context : {};
          const matches = ctx?.projectId === projectId
            || ctx?.chapterId === chapterId
            || (typeof entry?.message === "string" && entry.message.includes(projectId));
          if (matches) entries.push(entry);
        } catch {
          // Skip malformed lines
        }
      }
    }
  } catch {
    // Diagnostics directory may not exist
  }

  return { entries, fileCount };
}

// ---------------------------------------------------------------------------
// Provenance verification
// ---------------------------------------------------------------------------

function verifyProvenance(
  chapter: VideoPipelineLogBundleV1["stages"]["remotion"]["chapter"],
  videoUse: VideoPipelineLogBundleV1["stages"]["videoUse"],
  hyperframes: VideoPipelineLogBundleV1["stages"]["hyperframes"],
): VideoPipelineLogBundleV1["provenance"] {
  const notes: string[] = [];

  const videoUseArtifact = videoUse?.artifact as Record<string, unknown> | undefined;
  const videoUseEvidence = videoUseArtifact?.evidence as Record<string, unknown> | undefined;
  const videoUseArtifactSha256 = videoUseEvidence?.artifactSha256 as string | undefined;

  const hyperframesArtifact = hyperframes?.artifact as Record<string, unknown> | undefined;
  const hyperframesSourceSha256 = hyperframesArtifact?.sourceArtifactSha256 as string | undefined;

  const chapterEvidence = chapter?.evidence as Record<string, unknown> | undefined;
  const chapterInputHash = chapterEvidence?.inputHash as string | undefined;

  let verified = true;

  // Check: HyperFrames sourceArtifactSha256 should match video-use artifactSha256
  if (videoUseArtifactSha256 && hyperframesSourceSha256) {
    if (videoUseArtifactSha256 === hyperframesSourceSha256) {
      notes.push("✓ HyperFrames sourceArtifactSha256 与 video-use artifactSha256 一致");
    } else {
      notes.push("✗ HyperFrames sourceArtifactSha256 与 video-use artifactSha256 不匹配");
      verified = false;
    }
  } else {
    notes.push("⚠ 缺少 video-use artifactSha256 或 HyperFrames sourceArtifactSha256，跳过交叉验证");
  }

  // Check: Chapter evidence inputHash should exist
  if (chapterInputHash) {
    notes.push(`✓ Chapter evidence inputHash 存在: ${chapterInputHash.slice(0, 16)}...`);
  } else if (chapter) {
    notes.push("⚠ Chapter evidence 缺少 inputHash");
  }

  return {
    videoUseArtifactSha256,
    hyperframesSourceArtifactSha256: hyperframesSourceSha256,
    chapterEvidenceInputHash: chapterInputHash,
    verified,
    notes,
  };
}
