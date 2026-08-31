/**
 * 删除事务回滚束机器——束捕获/写读/校验、日志状态机、项目指纹、恢复落盘。
 * 08-31 file-size-reduction P1 拆出,函数体逐字保留。
 */
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import {
  type CapturedFile,
  type Journal,
  type RollbackBundle,
  atomicWrite,
  captureFile,
  fileHash,
  isInside,
  stableHash,
  unlinkDurably,
} from "./deletion-shared";

export function capturedFingerprint(files: CapturedFile[]): string {
  return stableHash(files.map(({ file, bytes, sha256, mode }) => ({ file, bytes, sha256, mode })).sort((a, b) => a.file.localeCompare(b.file)));
}

export async function currentProjectFingerprint(projectRoot: string): Promise<string> {
  const entries: Array<{ path: string; bytes: number; sha256: string }> = [];
  async function visit(directory: string): Promise<void> {
    for (const entry of await fsp.readdir(directory, { withFileTypes: true })) {
      if (entry.name === ".artifact-delete-journal.json" || /^\.artifact-delete-.*\.bundle\.json$/i.test(entry.name)) continue;
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(target);
        continue;
      }
      const stat = await fsp.lstat(target);
      if (stat.isSymbolicLink() || !stat.isFile()) throw new Error("special");
      const data = await fsp.readFile(target);
      entries.push({
        path: path.relative(projectRoot, target).split(path.sep).join("/"),
        bytes: data.byteLength,
        sha256: fileHash(data),
      });
    }
  }
  if (fs.existsSync(projectRoot)) await visit(projectRoot);
  return stableHash(entries.sort((left, right) => left.path.localeCompare(right.path)));
}

export async function restoreFiles(files: CapturedFile[]): Promise<void> {
  for (const original of files) {
    const data = Buffer.from(original.data, "base64");
    if (fileHash(data) !== original.sha256 || data.byteLength !== original.bytes) throw new Error("bundle-corrupt");
    await atomicWrite(original.file, data);
    await fsp.chmod(original.file, original.mode).catch(() => undefined);
  }
}

export async function verifyCapturedFingerprint(files: CapturedFile[], expected: string): Promise<boolean> {
  try {
    const current = await Promise.all(files.map((file) => captureFile(file.file)));
    return capturedFingerprint(current) === expected;
  } catch {
    return false;
  }
}

export async function removeCreatedMigrationCopies(
  projectRoot: string,
  bundle: RollbackBundle,
): Promise<void> {
  const protectedRoot = path.join(projectRoot, "workflow-images", "assets", "protected");
  for (const migration of bundle.migrations) {
    const destinationWasCaptured = bundle.files.some((file) => file.file === migration.to);
    if (destinationWasCaptured) continue;
    if (!isInside(protectedRoot, migration.to)) throw new Error("bundle-corrupt");
    await unlinkDurably(migration.to);
  }
}

export async function writeBundle(bundlePath: string, bundle: RollbackBundle): Promise<string> {
  const serialized = JSON.stringify(bundle);
  await atomicWrite(bundlePath, serialized);
  const bytes = await fsp.readFile(bundlePath);
  const sha256 = fileHash(bytes);
  if (bytes.toString("utf8") !== serialized) throw new Error("rollback-bundle-write-failed");
  return sha256;
}

export async function readBundle(journal: Journal): Promise<RollbackBundle> {
  const bytes = await fsp.readFile(journal.bundlePath);
  if (fileHash(bytes) !== journal.bundleSha256) throw new Error("bundle-corrupt");
  const bundle = JSON.parse(bytes.toString("utf8")) as RollbackBundle;
  if (bundle.schemaVersion !== 1 || !Array.isArray(bundle.files) || !Array.isArray(bundle.migrations)) throw new Error("bundle-corrupt");
  return bundle;
}

export function validateBundlePaths(projectRoot: string, bundle: RollbackBundle, mediaRoot?: string): void {
  for (const file of bundle.files) {
    if (!isInside(projectRoot, file.file) && (!mediaRoot || !isInside(mediaRoot, file.file))) throw new Error("bundle-corrupt");
  }
  for (const migration of bundle.migrations) {
    if ((!isInside(projectRoot, migration.from) && (!mediaRoot || !isInside(mediaRoot, migration.from)))
      || !isInside(projectRoot, migration.to)) {
      throw new Error("bundle-corrupt");
    }
  }
}

export async function journalState(root: string): Promise<{ journalPath: string; journal?: Journal; error?: "corrupt" }> {
  const journalPath = path.join(root, ".artifact-delete-journal.json");
  try {
    const parsed = JSON.parse(await fsp.readFile(journalPath, "utf8")) as Partial<Journal>;
    if (parsed.schemaVersion !== 1
      || (parsed.state !== "prepared" && parsed.state !== "commit-ready" && parsed.state !== "committed")
      || typeof parsed.planId !== "string"
      || typeof parsed.bundlePath !== "string"
      || typeof parsed.bundleSha256 !== "string"
      || typeof parsed.preFingerprint !== "string"
      || !Array.isArray(parsed.migrationManifest)) {
      return { journalPath, error: "corrupt" };
    }
    return { journalPath, journal: parsed as Journal };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { journalPath };
    return { journalPath, error: "corrupt" };
  }
}
