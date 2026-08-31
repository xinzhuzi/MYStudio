/**
 * 删除事务共享底座——类型/常量/纯工具(路径安全、原子 IO、磁盘空间、错误映射、
 * 物理引用类型推断)。08-31 file-size-reduction P1 自 artifact-deletion-service
 * 按功能簇拆出,函数体逐字保留。
 */
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import type { DeletionPlan, PhysicalRef, PostScanResult, TypedExecuteError } from "@/types/artifacts";
import {
  parseLocalMediaPath,
  parseProjectFileUrl,
  resolveLocalMediaPath,
} from "../storage/storage-paths";

export type Confirmation = {
  type: "chapter" | "artifacts";
  chapterTitle?: string;
  chapterId?: string;
  artifactCount?: number;
};

export type DeletionContext = { dataRoot: string; mediaRoot?: string };

export type CapturedFile = {
  file: string;
  data: string;
  mode: number;
  bytes: number;
  sha256: string;
};

export type MigrationEntry = { from: string; to: string; sha256: string };
export type PlannedTarget = { path: string; type: PhysicalRef["type"]; hash256?: string };

export type Journal = {
  schemaVersion: 1;
  state: "prepared" | "commit-ready" | "committed";
  planId: string;
  bundlePath: string;
  bundleSha256: string;
  preFingerprint: string;
  postFingerprint?: string;
  migrationManifest: MigrationEntry[];
};

export type RollbackBundle = { schemaVersion: 1; files: CapturedFile[]; migrations: MigrationEntry[] };

export const BACKUP_SUFFIX_RE = /\.(?:bak(?:[-_][^.]*)?$|codex[-_][^.]*$|smoke[-_][^.]*$)/i;
export const BACKUP_ROOT_DIRS = new Set(["backups", "visual-continuity-backups"]);

export const EMPTY_SCAN: PostScanResult = {
  orphanRecords: 0,
  invalidPaths: 0,
  residualChapterFiles: 0,
  backupResidue: 0,
  crossProjectLeak: 0,
  transactionResidue: 0,
};

export function stableHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function fileHash(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

export function canonicalExistingPath(input: string): string {
  let current = path.resolve(input);
  const suffix: string[] = [];
  while (true) {
    try {
      return path.join(fs.realpathSync(current), ...suffix);
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return path.resolve(input);
      suffix.unshift(path.basename(current));
      current = parent;
    }
  }
}

export function isInside(root: string, target: string): boolean {
  const canonicalRoot = canonicalExistingPath(root);
  const canonicalTarget = canonicalExistingPath(target);
  return canonicalTarget === canonicalRoot || canonicalTarget.startsWith(`${canonicalRoot}${path.sep}`);
}

export async function resolveTarget(context: DeletionContext, projectRoot: string, rawPath: string, projectId: string): Promise<string> {
  if (rawPath.startsWith("project-file://")) {
    const parsed = parseProjectFileUrl(rawPath);
    if (!parsed || parsed.projectId !== projectId) throw new Error("cross-root");
    const resolved = path.resolve(projectRoot, parsed.relativePath);
    if (!isInside(projectRoot, resolved)) throw new Error("cross-root");
    return resolved;
  }
  if (rawPath.startsWith("local-image://") || rawPath.startsWith("local-video://")) {
    if (!context.mediaRoot || !parseLocalMediaPath(rawPath)) throw new Error("cross-root");
    const resolved = resolveLocalMediaPath(context.mediaRoot, rawPath);
    if (!isInside(context.mediaRoot, resolved)) throw new Error("cross-root");
    return resolved;
  }
  if (path.isAbsolute(rawPath)) {
    const allowed = isInside(projectRoot, rawPath) || (context.mediaRoot ? isInside(context.mediaRoot, rawPath) : false);
    if (!allowed) throw new Error("cross-root");
    return path.resolve(rawPath);
  }
  const resolved = path.resolve(projectRoot, rawPath);
  if (!isInside(projectRoot, resolved)) throw new Error("cross-root");
  return resolved;
}

export async function captureFile(file: string): Promise<CapturedFile> {
  const stat = await fsp.lstat(file);
  if (stat.isSymbolicLink()) throw new Error("symlink");
  if (!stat.isFile()) throw new Error("special");
  const data = await fsp.readFile(file);
  return { file, data: data.toString("base64"), mode: stat.mode, bytes: data.byteLength, sha256: fileHash(data) };
}

export async function atomicWrite(file: string, data: string | Buffer): Promise<void> {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  const handle = await fsp.open(temporary, "w", 0o600);
  try {
    if (Buffer.isBuffer(data)) await handle.writeFile(data);
    else await handle.writeFile(data, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await fsp.rename(temporary, file);
  const parent = await fsp.open(path.dirname(file), "r").catch(() => null);
  await parent?.sync().catch(() => undefined);
  await parent?.close().catch(() => undefined);
}

export async function availableBytes(root: string): Promise<number | null> {
  const statfs = (fsp as typeof fsp & { statfs?: (file: string) => Promise<{ bavail: bigint; bsize: bigint }> }).statfs;
  if (!statfs) return null;
  try {
    const stats = await statfs(root);
    return Number(stats.bavail * stats.bsize);
  } catch {
    return null;
  }
}

export async function hasRequiredFreeSpace(
  root: string,
  rollbackBundleBytes: number,
  protectedAssetCopyBytes: number,
  maxTempFileBytes: number,
): Promise<boolean> {
  const free = await availableBytes(root);
  if (free === null) return true;
  const required = (rollbackBundleBytes + protectedAssetCopyBytes + maxTempFileBytes) * 2;
  return free >= required;
}

export async function unlinkDurably(file: string): Promise<void> {
  try {
    await fsp.unlink(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  const parent = await fsp.open(path.dirname(file), "r").catch(() => null);
  await parent?.sync().catch(() => undefined);
  await parent?.close().catch(() => undefined);
}

export function isEnospc(error: unknown): boolean {
  return (error as NodeJS.ErrnoException)?.code === "ENOSPC"
    || (error instanceof Error && error.message.includes("ENOSPC"));
}

export function mapError(message: string): TypedExecuteError {
  const typed: readonly TypedExecuteError[] = [
    "fingerprint-drift",
    "scope-expanded-across-chapters",
    "confirmation-mismatch",
    "insufficient-free-space",
    "project-lock-hold",
    "per-file-lock-failure",
    "protected-asset-copy-failed",
    "json-rewrite-failed",
    "physical-delete-failed",
    "store-rehydration-failed",
    "post-scan-orphans",
    "post-scan-invalid-paths",
    "post-scan-residual-chapter",
    "backup-rewrite-failed",
    "rollback-bundle-write-failed",
    "rollback-restore-failed",
    "pre-fingerprint-mismatch",
    "post-fingerprint-mismatch",
    "journal-transition-failed",
    "bundle-corrupt",
    "missing-bundle-at-commit-ready",
    "enospace-at-restore",
  ];
  if (typed.includes(message as TypedExecuteError)) return message as TypedExecuteError;
  if (message === "fingerprint-drift") return "fingerprint-drift";
  if (message === "symlink") return "symlink-detected";
  if (message === "special") return "special-file-detected";
  if (message === "cross-root") return "cross-root-path";
  if (message === "backup" || message.includes("backup format") || message.includes("Backup rewrite") || message.includes("Backup untouched")) return "backup-rewrite-failed";
  if (message === "bundle-corrupt") return "bundle-corrupt";
  if (message === "rollback-bundle-write-failed") return "rollback-bundle-write-failed";
  if (message === "post-scan") return "post-scan-orphans";
  return "physical-delete-failed";
}

export function inferPhysicalRefType(physicalPath: string): PhysicalRef["type"] {
  const normalized = physicalPath.split(path.sep).join("/");
  if (BACKUP_SUFFIX_RE.test(path.basename(normalized))
    || normalized.split("/").some((segment) => BACKUP_ROOT_DIRS.has(segment))) {
    return "backup";
  }
  if (/\.json$/i.test(physicalPath)) return "project-file";
  return "local-media";
}

export function getPlanItemTargets(item: DeletionPlan["deleteItems"][number]): PlannedTarget[] {
  if (item.physicalRefs && item.physicalRefs.length > 0) {
    return item.physicalRefs.map((ref) => ({ path: ref.path, type: ref.type, hash256: ref.hash256 }));
  }
  return item.physicalPath
    ? [{ path: item.physicalPath, type: inferPhysicalRefType(item.physicalPath), hash256: item.physicalHash256 }]
    : [];
}
