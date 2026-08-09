/**
 * Slice 7: Transactional Execution & Recovery
 *
 * Core responsibilities:
 * a) Project-scoped deletion mutex primitive (project-lock FIRST, then sorted per-file locks)
 * b) Rollback bundle writer (temp+fsync+parent-fsync+atomic-rename discipline)
 * c) Migration manifest for protected asset copies
 * d) Protected asset handling BEFORE source deletion
 * e) JSON/backup rewrite via temp+fsync+atomic-rename (NO legacy delete-image IPC)
 * f) Rehydrate stores under workflow freeze + run scans (orphan, invalid-path, residual-chapter)
 * g) Journal state machine: prepared -> commit-ready -> committed
 * h) Recovery logic (single-branch on journal state):
 *    - committed -> success, delete stale journal idempotently
 *    - commit-ready WITH bundle -> rollback from bundle
 *    - commit-ready WITHOUT bundle -> impossible/corrupt, block mutation
 *    - prepared WITH bundle -> rollback from bundle
 *
 * IMPORTANT: Import transforms from Slice 6:
 *   import { studioTransformDeleteNovelChapters, scriptTransformDeleteEpisodes } from '@/lib/stores/store-transforms';
 *
 * Use PURE functions to compute next-state snapshots BEFORE writing to disk.
 */
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import type {
  DeletionPlan,
  ExecuteResult,
  PostScanResult,
  RecoveryQueryResult,
  RecoveryState,
  TypedExecuteError,
  PhysicalRef,
} from "@/types/artifacts";
import {
  createProjectFileUrl,
  parseLocalMediaPath,
  parseProjectFileUrl,
  resolveLocalMediaPath,
  resolveProjectRootPath,
} from "../storage/storage-paths";
import { withFileStorageMutationLocks } from "../ipc/files/file-storage-ipc";
import { scanProjectInventory } from "./artifact-inventory-service";
import { rewriteRegisteredBackup } from "./backup-decoder-registry";
import { studioTransformDeleteNovelChapters, scriptTransformDeleteEpisodes } from "@/lib/stores/store-transforms";
import type { NovelChaptersSnapshot, ScriptDataSnapshot } from "@/lib/stores/store-transforms";
import type { Episode } from "@/types/script";

type Confirmation = {
  type: "chapter" | "artifacts";
  chapterTitle?: string;
  chapterId?: string;
  artifactCount?: number;
};

type DeletionContext = { dataRoot: string; mediaRoot?: string };

type CapturedFile = {
  file: string;
  data: string;
  mode: number;
  bytes: number;
  sha256: string;
};

type MigrationEntry = { from: string; to: string; sha256: string };
type PlannedTarget = { path: string; type: PhysicalRef["type"]; hash256?: string };

type Journal = {
  schemaVersion: 1;
  state: "prepared" | "commit-ready" | "committed";
  planId: string;
  bundlePath: string;
  bundleSha256: string;
  preFingerprint: string;
  postFingerprint?: string;
  migrationManifest: MigrationEntry[];
};

type RollbackBundle = { schemaVersion: 1; files: CapturedFile[]; migrations: MigrationEntry[] };

const BACKUP_SUFFIX_RE = /\.(?:bak(?:[-_][^.]*)?$|codex[-_][^.]*$|smoke[-_][^.]*$)/i;

const plans = new Map<string, DeletionPlan>();
const projectLocks = new Map<string, Promise<void>>();

const EMPTY_SCAN: PostScanResult = {
  orphanRecords: 0,
  invalidPaths: 0,
  residualChapterFiles: 0,
  backupResidue: 0,
  crossProjectLeak: 0,
  transactionResidue: 0,
};

function stableHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function fileHash(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

export function fingerprintPlan(
  plan: Pick<DeletionPlan, "projectId" | "chapterId" | "scope" | "deleteItems" | "migrateItems" | "retainItems" | "blockerItems">,
): string {
  return stableHash({
    projectId: plan.projectId,
    chapterId: plan.chapterId,
    scope: plan.scope,
    deleteItems: [...plan.deleteItems].sort((a, b) => a.artifactId.localeCompare(b.artifactId)),
    migrateItems: [...plan.migrateItems].sort((a, b) => a.artifactId.localeCompare(b.artifactId)),
    retainItems: [...plan.retainItems].sort((a, b) => a.artifactId.localeCompare(b.artifactId)),
    blockerItems: [...plan.blockerItems].sort((a, b) => a.artifactId.localeCompare(b.artifactId)),
  });
}

export function registerDeletionPlan(plan: DeletionPlan): DeletionPlan {
  plans.set(plan.planId, structuredClone(plan));
  return plan;
}

export function getDeletionPlan(planId: string): DeletionPlan | undefined {
  return plans.get(planId);
}

async function withProjectLock<T>(projectKey: string, action: () => Promise<T>): Promise<T> {
  const previous = projectLocks.get(projectKey) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => { release = resolve; });
  projectLocks.set(projectKey, current);
  await previous;
  try {
    return await action();
  } finally {
    release();
    if (projectLocks.get(projectKey) === current) projectLocks.delete(projectKey);
  }
}

function canonicalExistingPath(input: string): string {
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

function isInside(root: string, target: string): boolean {
  const canonicalRoot = canonicalExistingPath(root).toLowerCase();
  const canonicalTarget = canonicalExistingPath(target).toLowerCase();
  return canonicalTarget === canonicalRoot || canonicalTarget.startsWith(`${canonicalRoot}${path.sep}`);
}

async function resolveTarget(context: DeletionContext, projectRoot: string, rawPath: string, projectId: string): Promise<string> {
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

async function captureFile(file: string): Promise<CapturedFile> {
  const stat = await fsp.lstat(file);
  if (stat.isSymbolicLink()) throw new Error("symlink");
  if (!stat.isFile()) throw new Error("special");
  const data = await fsp.readFile(file);
  return { file, data: data.toString("base64"), mode: stat.mode, bytes: data.byteLength, sha256: fileHash(data) };
}

async function atomicWrite(file: string, data: string | Buffer): Promise<void> {
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

function capturedFingerprint(files: CapturedFile[]): string {
  return stableHash(files.map(({ file, bytes, sha256, mode }) => ({ file, bytes, sha256, mode })).sort((a, b) => a.file.localeCompare(b.file)));
}

async function currentProjectFingerprint(projectRoot: string): Promise<string> {
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

async function collectPersistedFiles(projectRoot: string): Promise<string[]> {
  const files: string[] = [];
  async function visit(dir: string): Promise<void> {
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const target = path.join(dir, entry.name);
      if (entry.isDirectory()) await visit(target);
      else if (/\.json$/i.test(entry.name) || BACKUP_SUFFIX_RE.test(entry.name)) files.push(target);
    }
  }
  if (fs.existsSync(projectRoot)) await visit(projectRoot);
  return files;
}

function recordMatches(value: Record<string, unknown>, chapterId: string, rawIds: Set<string>): boolean {
  const id = typeof value.id === "string" ? value.id : undefined;
  return Boolean((id && rawIds.has(id)) || value.chapterId === chapterId || value.episodeId === chapterId);
}

function pruneChapter(value: unknown, chapterId: string, rawIds: Set<string>, insideArray = false): { value: unknown; changed: boolean } {
  if (Array.isArray(value)) {
    let changed = false;
    const next: unknown[] = [];
    for (const item of value) {
      if (item && typeof item === "object" && !Array.isArray(item) && recordMatches(item as Record<string, unknown>, chapterId, rawIds)) {
        changed = true;
        continue;
      }
      const child = pruneChapter(item, chapterId, rawIds, true);
      changed ||= child.changed;
      next.push(child.value);
    }
    return { value: next, changed };
  }
  if (!value || typeof value !== "object") return { value, changed: false };
  const source = value as Record<string, unknown>;
  if (insideArray && recordMatches(source, chapterId, rawIds)) return { value: undefined, changed: true };
  let changed = false;
  const next: Record<string, unknown> = { ...source };
  for (const [key, item] of Object.entries(source)) {
    const child = pruneChapter(item, chapterId, rawIds, false);
    changed ||= child.changed;
    next[key] = child.value;
  }
  return { value: next, changed };
}

function reindexScriptState(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  const root = value as Record<string, unknown>;
  const scriptData = root.scriptData;
  if (!scriptData || typeof scriptData !== "object") return value;
  const data = scriptData as Record<string, unknown>;
  if (!Array.isArray(data.episodes)) return value;
  const episodes = data.episodes.map((episode, index) => {
    if (!episode || typeof episode !== "object") return episode;
    return { ...(episode as Record<string, unknown>), index: index + 1 };
  });
  const next = { ...root, scriptData: { ...data, episodes } };
  if (Array.isArray((next as any).episodeRawScripts)) {
    (next as any).episodeRawScripts = (next as any).episodeRawScripts.map((raw, index) => {
      if (!raw || typeof raw !== "object") return raw;
      return { ...(raw as Record<string, unknown>), episodeIndex: index + 1 };
    });
  }
  return next;
}

async function rewritePersistedFiles(
  projectRoot: string,
  chapterId: string,
  rawIds: Set<string>,
  backupImpacts: DeletionPlan["backupImpact"],
): Promise<CapturedFile[]> {
  const originals: CapturedFile[] = [];
  for (const file of await collectPersistedFiles(projectRoot)) {
    const text = await fsp.readFile(file, "utf8").catch(() => null);
    if (text === null) continue;
    let parsed: unknown;
    try { parsed = JSON.parse(text); } catch { continue; }
    const relativePath = path.relative(projectRoot, file).split(path.sep).join("/");
    const backupImpact = backupImpacts.find((impact) => impact.filePath === relativePath);
    if (backupImpact?.action === "block") throw new Error("backup format blocked");
    if (backupImpact?.action === "delete") continue;
    // Every backup suffix is fail-closed.  A .codex/.smoke backup without a
    // registered impact must never fall through to the generic chapter walker,
    // which could rewrite an unregistered historical format by accident.
    if (inferPhysicalRefType(relativePath) === "backup" && !backupImpact) continue;
    const changed = backupImpact?.action === "rewrite"
      ? rewriteRegisteredBackup(parsed, chapterId, rawIds)
      : path.basename(file) === "artifacts.json"
      ? (() => {
          const root = parsed as Record<string, unknown>;
          const overlays = root.overlays;
          if (!overlays || typeof overlays !== "object" || Array.isArray(overlays)) return { value: parsed, changed: false };
          const nextOverlays = Object.fromEntries(Object.entries(overlays as Record<string, unknown>).filter(([id]) => !rawIds.has(id) && !rawIds.has(id.split(":").pop() ?? id)));
          return { value: { ...root, overlays: nextOverlays }, changed: Object.keys(nextOverlays).length !== Object.keys(overlays as Record<string, unknown>).length };
        })()
        : pruneChapter(parsed, chapterId, rawIds);
    if (!changed.changed) continue;
    const normalized = reindexScriptState(changed.value);
    originals.push(await captureFile(file));
    await atomicWrite(file, JSON.stringify(normalized, null, 2));
  }
  return originals;
}

async function restoreFiles(files: CapturedFile[]): Promise<void> {
  for (const original of files) {
    const data = Buffer.from(original.data, "base64");
    if (fileHash(data) !== original.sha256 || data.byteLength !== original.bytes) throw new Error("bundle-corrupt");
    await atomicWrite(original.file, data);
    await fsp.chmod(original.file, original.mode).catch(() => undefined);
  }
}

async function availableBytes(root: string): Promise<number | null> {
  const statfs = (fsp as typeof fsp & { statfs?: (file: string) => Promise<{ bavail: bigint; bsize: bigint }> }).statfs;
  if (!statfs) return null;
  try {
    const stats = await statfs(root);
    return Number(stats.bavail * stats.bsize);
  } catch {
    return null;
  }
}

async function writeBundle(bundlePath: string, bundle: RollbackBundle): Promise<string> {
  const serialized = JSON.stringify(bundle);
  await atomicWrite(bundlePath, serialized);
  const bytes = await fsp.readFile(bundlePath);
  const sha256 = fileHash(bytes);
  if (bytes.toString("utf8") !== serialized) throw new Error("rollback-bundle-write-failed");
  return sha256;
}

async function readBundle(journal: Journal): Promise<RollbackBundle> {
  const bytes = await fsp.readFile(journal.bundlePath);
  if (fileHash(bytes) !== journal.bundleSha256) throw new Error("bundle-corrupt");
  const bundle = JSON.parse(bytes.toString("utf8")) as RollbackBundle;
  if (bundle.schemaVersion !== 1 || !Array.isArray(bundle.files) || !Array.isArray(bundle.migrations)) throw new Error("bundle-corrupt");
  return bundle;
}

function validateBundlePaths(projectRoot: string, bundle: RollbackBundle, mediaRoot?: string): void {
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

async function journalState(root: string): Promise<{ journalPath: string; journal?: Journal; error?: "corrupt" }> {
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

function containsChapterRecord(value: unknown, chapterId: string, rawIds: ReadonlySet<string>): boolean {
  if (Array.isArray(value)) return value.some((item) => containsChapterRecord(item, chapterId, rawIds));
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  if (record.chapterId === chapterId || record.episodeId === chapterId || record.id === chapterId) return true;
  if (typeof record.id === "string" && rawIds.has(record.id)) return true;
  return Object.values(record).some((child) => containsChapterRecord(child, chapterId, rawIds));
}

async function postScan(context: DeletionContext, projectId: string, chapterId: string, projectRoot: string, rawIds: ReadonlySet<string>): Promise<PostScanResult> {
  const result: PostScanResult = { ...EMPTY_SCAN };
  const inventory = await scanProjectInventory(context.dataRoot, projectId, chapterId);
  if (!inventory.success) {
    result.orphanRecords = 1;
    return result;
  }
  result.orphanRecords = inventory.data.discrepancies.length;
  for (const artifact of inventory.data.artifacts) {
    for (const ref of artifact.physicalRefs) {
      if (ref.special || (ref.type !== "local-media" && !fs.existsSync(path.resolve(projectRoot, ref.path)))) result.invalidPaths++;
      if (ref.type === "backup" && ref.path.includes(chapterId)) result.backupResidue++;
      if (path.isAbsolute(ref.path) && !isInside(projectRoot, ref.path) && (!context.mediaRoot || !isInside(context.mediaRoot, ref.path))) result.crossProjectLeak++;
    }
  }
  const files = await collectPersistedFiles(projectRoot);
  for (const file of files) {
    const baseName = path.basename(file);
    if (baseName === ".artifact-delete-journal.json" || /^\.artifact-delete-.*\.bundle\.json$/i.test(baseName)) continue;
    if (file.includes(chapterId)) result.residualChapterFiles++;
    const text = await fsp.readFile(file, "utf8").catch(() => null);
    if (text !== null) {
      try {
        if (containsChapterRecord(JSON.parse(text), chapterId, rawIds)) {
          result.residualChapterFiles++;
        }
      } catch {
        // Invalid JSON is already represented as an inventory discrepancy.
      }
    }
  }
  // The journal is intentionally present while this pre-commit scan runs;
  // transaction residue is checked again after the committed journal/bundle
  // are removed below.
  return result;
}

function mapError(message: string): TypedExecuteError {
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

function inferPhysicalRefType(physicalPath: string): PhysicalRef["type"] {
  if (BACKUP_SUFFIX_RE.test(path.basename(physicalPath))) return "backup";
  if (/\.json$/i.test(physicalPath)) return "project-file";
  return "local-media";
}

function getPlanItemTargets(item: DeletionPlan["deleteItems"][number]): PlannedTarget[] {
  if (item.physicalRefs && item.physicalRefs.length > 0) {
    return item.physicalRefs.map((ref) => ({ path: ref.path, type: ref.type, hash256: ref.hash256 }));
  }
  return item.physicalPath
    ? [{ path: item.physicalPath, type: inferPhysicalRefType(item.physicalPath), hash256: item.physicalHash256 }]
    : [];
}

export async function executeDeletion(
  context: DeletionContext,
  input: { planId: string; fingerprint: string; confirmation: Confirmation },
): Promise<ExecuteResult> {
  const plan = plans.get(input.planId);
  if (!plan || input.fingerprint !== plan.fingerprint) return { success: false, error: "fingerprint-drift", journalState: "none" };
  if (!plan.executionAllowed || plan.blockerItems.length > 0) return { success: false, error: "post-scan-orphans", journalState: "none" };
  const confirmationMatches = plan.scope === "chapter"
    ? input.confirmation.type === "chapter" && (
        plan.confirmationRequired.type === "chapter-id"
          ? input.confirmation.chapterId === plan.confirmationRequired.value
          : plan.confirmationRequired.type === "chapter-title"
            ? input.confirmation.chapterTitle === plan.confirmationRequired.value
            : false
      )
    : input.confirmation.type === "artifacts"
      && input.confirmation.artifactCount === plan.deleteItems.length + plan.migrateItems.length;
  if (!confirmationMatches) {
    return { success: false, error: "confirmation-mismatch", journalState: "none" };
  }

  return withProjectLock(`${context.dataRoot}:${plan.projectId}`, async () => {
    const projectRoot = resolveProjectRootPath(context.dataRoot, plan.projectId);
    const journalPath = path.join(projectRoot, ".artifact-delete-journal.json");
    const bundlePath = path.join(projectRoot, `.artifact-delete-${plan.planId}.bundle.json`);
    let plannedTargets: Array<PlannedTarget & { resolved: string }>;
    try {
      plannedTargets = (await Promise.all(
        [...plan.deleteItems, ...plan.migrateItems].flatMap((item) =>
          getPlanItemTargets(item).map(async (target) => ({
            ...target,
            resolved: await resolveTarget(context, projectRoot, target.path, plan.projectId),
          })),
        ),
      ));
    } catch (error) {
      return {
        success: false,
        error: mapError(error instanceof Error ? error.message : String(error)),
        journalState: "none",
      };
    }
    // Lock every path that can be changed, including media/protected-asset
    // files.  Locking only persisted JSON allows a concurrent media writer to
    // race the transaction and invalidate the reviewed fingerprint.
    const lockFiles = [
      ...(await collectPersistedFiles(projectRoot)),
      ...plannedTargets.map((target) => target.resolved),
      journalPath,
      bundlePath,
      path.join(projectRoot, ".artifact-delete-project.lock"),
    ];
    return withFileStorageMutationLocks(lockFiles, async () => {
    const existingJournal = await journalState(projectRoot);
    if (existingJournal.error) {
      return { success: false, error: "journal-transition-failed", journalState: "none" };
    }
    if (existingJournal.journal) {
      const journalStateForResult = existingJournal.journal.state === "commit-ready" ? "commit-ready" : "prepared";
      return { success: false, error: "project-lock-hold", journalState: journalStateForResult };
    }
    // Projected IDs may be namespaced as `${projectId}-${chapterId}`. Keep
    // both the stable chapter identity and the projected suffix so persisted
    // records and registered backups are pruned consistently.
    const rawIds = new Set<string>([plan.chapterId]);
    for (const item of plan.deleteItems) {
      const suffix = item.artifactId.split(":").pop() ?? item.artifactId;
      rawIds.add(suffix);
      if (suffix.startsWith(`${plan.projectId}-`)) rawIds.add(suffix.slice(plan.projectId.length + 1));
    }
    const targets = new Set<string>(plannedTargets.map((target) => target.resolved));
    const targetTypes = new Map(plannedTargets.map((target) => [target.resolved, target.type]));
    const migrations: MigrationEntry[] = [];
    const bundle: RollbackBundle = { schemaVersion: 1, files: [], migrations };
    let journal: Journal | undefined;
    try {
      for (const item of [...plan.deleteItems, ...plan.migrateItems]) {
        for (const planned of getPlanItemTargets(item)) {
          if (!planned.hash256) continue;
          const target = await resolveTarget(context, projectRoot, planned.path, plan.projectId);
          const data = await fsp.readFile(target).catch(() => null);
          if (!data || fileHash(data) !== planned.hash256) throw new Error("fingerprint-drift");
        }
      }
      for (const item of plan.migrateItems) {
        for (const planned of getPlanItemTargets(item)) {
          const source = await resolveTarget(context, projectRoot, planned.path, plan.projectId);
          if (!/\.(?:png|jpe?g|webp|gif|mp4|webm|mov|wav|mp3|m4a)$/i.test(source)) continue;
          const sourceData = await fsp.readFile(source);
          const destination = path.join(projectRoot, "workflow-images", "assets", "protected", `${fileHash(sourceData).slice(0, 16)}-${path.basename(source)}`);
          if (!isInside(projectRoot, destination)) throw new Error("cross-root");
          if (!bundle.files.some((file) => file.file === source)) bundle.files.push(await captureFile(source));
          if (fs.existsSync(destination)) bundle.files.push(await captureFile(destination));
          await fsp.mkdir(path.dirname(destination), { recursive: true });
          await fsp.copyFile(source, destination);
          const copied = await fsp.readFile(destination);
          const sha256 = fileHash(copied);
          if (sha256 !== fileHash(sourceData)) throw new Error("protected-asset-copy-failed");
          migrations.push({ from: source, to: destination, sha256 });
          targets.add(source);
          targetTypes.set(source, planned.type);
        }
      }
      for (const file of await collectPersistedFiles(projectRoot)) {
        if (!bundle.files.some((captured) => captured.file === file)) bundle.files.push(await captureFile(file));
      }
      for (const target of targets) if (!bundle.files.some((captured) => captured.file === target)) bundle.files.push(await captureFile(target));
      const bundleBytes = Buffer.byteLength(JSON.stringify({ schemaVersion: 1, files: bundle.files, migrations }));
      const free = await availableBytes(projectRoot);
      if (free !== null && free < (bundleBytes + Math.max(1, plan.byteTotals.migrateBytes)) * 2) return { success: false, error: "insufficient-free-space", journalState: "none" };
      const preFingerprint = capturedFingerprint(bundle.files);
      const bundleSha256 = await writeBundle(bundlePath, { ...bundle, migrations });
      journal = { schemaVersion: 1, state: "prepared", planId: plan.planId, bundlePath, bundleSha256, preFingerprint, migrationManifest: migrations };
      await atomicWrite(journalPath, JSON.stringify(journal));

      const rewritten = await rewritePersistedFiles(projectRoot, plan.chapterId, rawIds, plan.backupImpact);
      const rewrittenPaths = new Set(rewritten.map((file) => file.file));
      bundle.files.push(...rewritten.filter((file) => !bundle.files.some((existing) => existing.file === file.file)));
      bundle.migrations = migrations;
      journal.bundleSha256 = await writeBundle(bundlePath, bundle);
      await atomicWrite(journalPath, JSON.stringify(journal));

      // Rehydrate persisted store snapshots while the journal is still
      // prepared.  Any failure remains rollback-able from the bundle; no
      // business write is allowed after the commit-ready transition.
      try {
        for (const chapterFile of await collectPersistedFiles(projectRoot)) {
          const text = await fsp.readFile(chapterFile, "utf8").catch(() => null);
          if (text === null) continue;
          let parsed: unknown;
          try { parsed = JSON.parse(text); } catch { continue; }
          if (Array.isArray((parsed as NovelChaptersSnapshot)?.novelChapters)) {
            const snapshot: NovelChaptersSnapshot = {
              novelChapters: (parsed as NovelChaptersSnapshot).novelChapters.map(
                (ch) => ({ ...ch, id: ch.id || String(ch.index) })
              ),
            };
            const nextSnapshot = studioTransformDeleteNovelChapters(snapshot, rawIds);
            if (JSON.stringify(nextSnapshot) !== JSON.stringify(snapshot)) {
              await atomicWrite(chapterFile, JSON.stringify(nextSnapshot, null, 2));
            }
          }
        }
        for (const scriptFile of await collectPersistedFiles(projectRoot)) {
          const text = await fsp.readFile(scriptFile, "utf8").catch(() => null);
          if (text === null) continue;
          let parsed: unknown;
          try { parsed = JSON.parse(text); } catch { continue; }
          const root = parsed as Record<string, unknown>;
          const projects = root.projects as Record<string, unknown> | undefined;
          if (projects && typeof projects[plan.projectId] === "object") {
            const snapshot: ScriptDataSnapshot = {
              projects: { [plan.projectId]: projects[plan.projectId] as never },
            };
            const episodeIndices = [...new Set(
              (snapshot.projects[plan.projectId]?.scriptData?.episodes || [])
                .filter(e => rawIds.has(String(e.index)) || rawIds.has(String(e.id)))
                .map(e => e.index)
            )];
            if (episodeIndices.length > 0) {
              const nextSnapshot = scriptTransformDeleteEpisodes(snapshot, plan.projectId, episodeIndices);
              const nextRoot = { ...root, projects: { ...projects, [plan.projectId]: nextSnapshot.projects[plan.projectId] } };
              if (JSON.stringify(nextRoot) !== JSON.stringify(parsed)) {
                await atomicWrite(scriptFile, JSON.stringify(nextRoot, null, 2));
              }
            }
          }
        }
      } catch {
        throw new Error("store-rehydration-failed");
      }

      // Permanent deletion occurs only after the verified rollback bundle and
      // all structured rewrites are in place.  Do not use Electron's
      // shell.trashItem here: the product contract explicitly requires
      // irreversible deletion (with rollback available only until commit).
      for (const target of targets) {
        if (!fs.existsSync(target)) throw new Error("physical-delete-failed");
        if (targetTypes.get(target) === "project-file" && /\.json$/i.test(target) && rewrittenPaths.has(target)) continue;
        const backupImpact = plan.backupImpact.find((impact) => impact.filePath === target || path.resolve(projectRoot, impact.filePath) === target);
        if (backupImpact?.action === "rewrite") continue;
        await fsp.unlink(target);
        const parent = await fsp.open(path.dirname(target), "r").catch(() => null);
        await parent?.sync().catch(() => undefined);
        await parent?.close().catch(() => undefined);
      }
      const scan = await postScan(context, plan.projectId, plan.chapterId, projectRoot, rawIds);
      if (Object.values(scan).some((count) => count > 0)) throw new Error("post-scan");
      // Record the actual post-state, not the pre-state rollback bundle
      // fingerprint.  This is the value recovery/reporting consumers use to
      // distinguish a committed chapter removal from its rollback image.
      journal.postFingerprint = await currentProjectFingerprint(projectRoot);
      journal.state = "commit-ready";
      await atomicWrite(journalPath, JSON.stringify(journal));
      journal.state = "committed";
      await atomicWrite(journalPath, JSON.stringify(journal));

      await fsp.unlink(bundlePath).catch(() => undefined);
      await fsp.unlink(journalPath).catch(() => undefined);
      scan.transactionResidue = (fs.existsSync(bundlePath) || fs.existsSync(journalPath)) ? 1 : 0;
      return {
        success: true,
        journalState: "committed",
        data: {
          planId: plan.planId,
          chaptersAffected: [plan.chapterId],
          artifactsDeleted: plan.deleteItems.length,
          artifactsMigrated: migrations.length,
          bytesFreed: plan.byteTotals.deleteBytes,
          backupsModified: plan.backupImpact.map((impact) => impact.filePath),
          postScan: scan,
          completedAt: Date.now(),
        },
      };
    } catch (error) {
      try {
        const saved = journal ? await readBundle(journal) : bundle;
        validateBundlePaths(projectRoot, saved, context.mediaRoot);
        await restoreFiles(saved.files);
        for (const migration of saved.migrations) {
          if (!saved.files.some((file) => file.file === migration.to)) await fsp.unlink(migration.to).catch(() => undefined);
        }
        if (journal) await atomicWrite(journalPath, JSON.stringify({ ...journal, state: "prepared" } satisfies Journal));
      } catch {
        return { success: false, error: "rollback-restore-failed", journalState: "prepared" };
      }
      return { success: false, error: mapError(error instanceof Error ? error.message : String(error)), journalState: "prepared" };
    }
    });
  });
}

export async function queryRecovery(dataRoot: string, projectId: string): Promise<RecoveryQueryResult> {
  try {
    const root = resolveProjectRootPath(dataRoot, projectId);
    const { journal, journalPath, error } = await journalState(root);
    if (error) return { success: false, error: "journal-corrupt" };
    if (!journal) return { success: true, data: { journalState: "none", bundleExists: false, bundleValid: false, canAutoRecover: true, requiredAction: "none" } };
    const bundleExists = fs.existsSync(journal.bundlePath);
    if (journal.state === "committed") {
      if (bundleExists) await fsp.unlink(journal.bundlePath);
      await fsp.unlink(journalPath).catch(() => undefined);
      return { success: true, data: { journalState: "none", bundleExists: false, bundleValid: true, canAutoRecover: true, requiredAction: "none" } };
    }
    if (!bundleExists) return { success: false, error: "missing-bundle-at-commit-ready" };
    const bundle = await readBundle(journal);
    validateBundlePaths(root, bundle);
    await restoreFiles(bundle.files);
    for (const migration of bundle.migrations) {
      if (!bundle.files.some((file) => file.file === migration.to)) await fsp.unlink(migration.to).catch(() => undefined);
    }
    await fsp.unlink(journal.bundlePath).catch(() => undefined);
    await fsp.unlink(journalPath).catch(() => undefined);
    const state: RecoveryState = { journalState: "none", bundleExists: false, bundleValid: true, preFingerprint: journal.preFingerprint, postFingerprint: journal.postFingerprint, canAutoRecover: true, requiredAction: "none" };
    return { success: true, data: state };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message === "bundle-corrupt" ? "bundle-corrupt" : message };
  }
}
