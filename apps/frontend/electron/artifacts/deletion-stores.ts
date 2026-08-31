/**
 * 删除事务持久层——JSON/备份收集与改写、章节剪除、残留扫描。
 * 08-31 file-size-reduction P1 拆出,函数体逐字保留。
 */
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import type { DeletionPlan, PostScanResult } from "@/types/artifacts";
import { scanProjectInventory } from "./artifact-inventory-service";
import { rewriteRegisteredBackup } from "./backup-decoder-registry";
import {
  type CapturedFile,
  type DeletionContext,
  BACKUP_SUFFIX_RE,
  EMPTY_SCAN,
  atomicWrite,
  captureFile,
  inferPhysicalRefType,
  isInside,
  resolveTarget,
} from "./deletion-shared";

export async function collectPersistedFiles(projectRoot: string): Promise<string[]> {
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

export function recordMatches(value: Record<string, unknown>, chapterId: string, rawIds: Set<string>): boolean {
  const id = typeof value.id === "string" ? value.id : undefined;
  return Boolean((id && rawIds.has(id)) || value.chapterId === chapterId || value.episodeId === chapterId);
}

export function pruneChapter(value: unknown, chapterId: string, rawIds: Set<string>, insideArray = false): { value: unknown; changed: boolean } {
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
    if (key === chapterId || rawIds.has(key)) {
      delete next[key];
      changed = true;
      continue;
    }
    const child = pruneChapter(item, chapterId, rawIds, false);
    changed ||= child.changed;
    next[key] = child.value;
  }
  return { value: next, changed };
}

export function reindexScriptState(value: unknown): unknown {
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
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (Array.isArray((next as any).episodeRawScripts)) {
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    (next as any).episodeRawScripts = (next as any).episodeRawScripts.map((raw, index) => {
      if (!raw || typeof raw !== "object") return raw;
      return { ...(raw as Record<string, unknown>), episodeIndex: index + 1 };
    });
  }
  return next;
}

export async function rewritePersistedFiles(
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
    const rootChapterId = parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>).chapterId
      : undefined;
    // A registered chapter-scoped store is already represented by a physical
    // deletion target.  Do not partially rewrite it and leave a top-level
    // chapterId behind; the unlink phase removes the whole file atomically.
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
        : rootChapterId === chapterId
          ? { value: parsed, changed: false }
          : pruneChapter(parsed, chapterId, rawIds);
    if (!changed.changed) continue;
    const normalized = reindexScriptState(changed.value);
    originals.push(await captureFile(file));
    await atomicWrite(file, JSON.stringify(normalized, null, 2));
  }
  return originals;
}

export function containsChapterRecord(value: unknown, chapterId: string, rawIds: ReadonlySet<string>): boolean {
  if (Array.isArray(value)) return value.some((item) => containsChapterRecord(item, chapterId, rawIds));
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  if (record.chapterId === chapterId || record.episodeId === chapterId || record.id === chapterId) return true;
  if (typeof record.id === "string" && rawIds.has(record.id)) return true;
  if (Object.keys(record).some((key) => key === chapterId || rawIds.has(key))) return true;
  return Object.values(record).some((child) => containsChapterRecord(child, chapterId, rawIds));
}

export async function postScan(context: DeletionContext, projectId: string, chapterId: string, projectRoot: string, rawIds: ReadonlySet<string>): Promise<PostScanResult> {
  const result: PostScanResult = { ...EMPTY_SCAN };
  const inventory = await scanProjectInventory(
    context.dataRoot,
    projectId,
    chapterId,
    undefined,
    { projectLockAlreadyHeld: true },
  );
  if (!inventory.success) {
    result.orphanRecords = 1;
    return result;
  }
  result.orphanRecords = inventory.data.discrepancies.length;
  for (const artifact of inventory.data.artifacts) {
    for (const ref of artifact.physicalRefs) {
      if (ref.special) {
        result.invalidPaths++;
      } else {
        try {
          const resolved = await resolveTarget(context, projectRoot, ref.path, projectId);
          if (!fs.existsSync(resolved)) result.invalidPaths++;
        } catch {
          result.invalidPaths++;
        }
      }
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
