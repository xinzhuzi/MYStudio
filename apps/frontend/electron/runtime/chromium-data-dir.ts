import fs from "node:fs";
import path from "node:path";

/**
 * Chromium session-data consolidation.
 *
 * Electron defaults sessionData to userData, which litters the app-support
 * root with Chromium-owned entries (Cache, Local Storage, IndexedDB, Cookies,
 * File System/OPFS, blob_storage, ...). ensureChromiumDataDir() moves those
 * entries into <userData>/Chromium once and returns the new root so main.ts
 * can call app.setPath('sessionData', ...) — both BEFORE the single-instance
 * lock and the app ready event (Electron requirement).
 *
 * The migration is a same-volume rename (atomic on APFS), runs before any
 * session exists, and rolls back to the legacy layout on failure — the app
 * must never fail to start because of this.
 */

export const CHROMIUM_DATA_DIR_NAME = "Chromium";
const MIGRATION_MARKER = ".mystudio-chromium-root";

/**
 * Top-level Chromium-owned names. NEVER add app-managed data here
 * (projects, media, TTS, python, DeepModel, logs, skills, assets, ...).
 */
export const CHROMIUM_OWNED_ENTRIES = [
  // Rebuildable caches
  "Cache",
  "Code Cache",
  "GPUCache",
  "DawnGraphiteCache",
  "DawnWebGPUCache",
  // Session/browser state directories
  "Local Storage",
  "IndexedDB",
  "WebStorage",
  "Session Storage",
  "Shared Dictionary",
  "SharedStorage",
  "shared_proto_db",
  "File System",
  "databases",
  "databases-off-the-record",
  "blob_storage",
  "Network",
  "Partitions",
  "VideoDecodeStats",
  // Top-level state files
  "Local State",
  "Preferences",
  "Network Persistent State",
  "TransportSecurity",
  "DIPS",
  "DIPS-wal",
] as const;

/** Chromium-owned names with journal-style suffixes (Cookies-journal, Trust Tokens-journal, ...). */
const CHROMIUM_OWNED_PATTERNS = [/^Cookies(?:-.+)?$/, /^Trust Tokens(?:-.+)?$/];

/** Stale runtime markers in the legacy root; Chromium recreates them inside the new root. */
const STALE_RUNTIME_MARKERS = ["DevToolsActivePort", "SingletonLock", "SingletonCookie", "SingletonSocket"] as const;

type ChromiumDataDirFileOps = {
  existsSync?: typeof fs.existsSync;
  readdirSync?: typeof fs.readdirSync;
  renameSync?: typeof fs.renameSync;
  mkdirSync?: typeof fs.mkdirSync;
  writeFileSync?: typeof fs.writeFileSync;
  rmSync?: typeof fs.rmSync;
};

type EnsureChromiumDataDirOptions = {
  userDataPath: string;
  fileOps?: ChromiumDataDirFileOps;
};

export function ensureChromiumDataDir({ userDataPath, fileOps }: EnsureChromiumDataDirOptions): string | null {
  const ops = {
    existsSync: fileOps?.existsSync ?? fs.existsSync,
    readdirSync: fileOps?.readdirSync ?? fs.readdirSync,
    renameSync: fileOps?.renameSync ?? fs.renameSync,
    mkdirSync: fileOps?.mkdirSync ?? fs.mkdirSync,
    writeFileSync: fileOps?.writeFileSync ?? fs.writeFileSync,
    rmSync: fileOps?.rmSync ?? fs.rmSync,
  };

  const target = path.join(userDataPath, CHROMIUM_DATA_DIR_NAME);
  const markerPath = path.join(target, MIGRATION_MARKER);
  if (ops.existsSync(markerPath)) return target;

  let topLevel: string[] = [];
  try {
    topLevel = ops.readdirSync(userDataPath);
  } catch {
    topLevel = [];
  }

  const ownedNames = topLevel.filter(
    (name) =>
      (CHROMIUM_OWNED_ENTRIES as readonly string[]).includes(name) ||
      CHROMIUM_OWNED_PATTERNS.some((pattern) => pattern.test(name)),
  );

  const moved: Array<{ from: string; to: string }> = [];
  try {
    ops.mkdirSync(target, { recursive: true });
    for (const name of ownedNames) {
      const from = path.join(userDataPath, name);
      const to = path.join(target, name);
      if (!ops.existsSync(from)) continue; // never existed / already moved
      if (ops.existsSync(to)) continue; // resume after a partial migration
      ops.renameSync(from, to);
      moved.push({ from, to });
    }
    for (const name of STALE_RUNTIME_MARKERS) {
      const stalePath = path.join(userDataPath, name);
      if (!ops.existsSync(stalePath)) continue;
      try {
        ops.rmSync(stalePath, { force: true, recursive: true });
      } catch {
        // Best-effort cleanup; Chromium recreates markers in the new root.
      }
    }
    ops.writeFileSync(markerPath, new Date().toISOString(), "utf-8");
    return target;
  } catch (error) {
    console.warn(
      "[chromium-data-dir] 迁移失败，回退旧布局（不设置 sessionData）:",
      error instanceof Error ? error.message : error,
    );
    for (const { from, to } of moved.reverse()) {
      try {
        if (ops.existsSync(to) && !ops.existsSync(from)) ops.renameSync(to, from);
      } catch {
        // Best-effort rollback.
      }
    }
    return null;
  }
}
