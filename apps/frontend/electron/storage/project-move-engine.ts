// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

/**
 * Project move engine — pure filesystem layer for relocating a project folder.
 * Contract frozen by .trellis/tasks/08-15-project-location-phase2/design.md §1.
 * Track M implements this scaffold in place; exported names must not change.
 *
 * Pure fs engine: no IPC / location-table / registry dependencies. `renameImpl`
 * is the only injection point (tests force the EXDEV copy path with it).
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export type ProjectMovePhase = "copying" | "verifying" | "finalizing";

export interface ProjectMoveProgress {
  phase: ProjectMovePhase;
  filesDone: number;
  filesTotal: number;
  bytesDone: number;
  bytesTotal: number;
}

export type ProjectMoveMode = "renamed" | "copied";

export class MoveCancelledError extends Error {
  readonly code = "MOVE_CANCELLED" as const;

  constructor() {
    super("Project move cancelled");
    this.name = "MoveCancelledError";
  }
}

export interface ProjectMoveOptions {
  sourceDir: string;
  targetDir: string;
  onProgress?: (progress: ProjectMoveProgress) => void;
  signal?: AbortSignal;
  /** Test injection: defaults to fs.renameSync; throwing an EXDEV error forces the copy path. */
  renameImpl?: (from: string, to: string) => void;
}

export interface ProjectMoveEngine {
  move(options: ProjectMoveOptions): Promise<ProjectMoveMode>;
}

interface RegularFileEntry {
  kind: "file";
  absolutePath: string;
  relativePath: string;
  size: number;
  mtimeMs: number;
  ctimeMs: number;
}

interface SymbolicLinkEntry {
  kind: "symlink";
  absolutePath: string;
  relativePath: string;
  size: 0;
  linkTarget: string;
}

type FileEntry = RegularFileEntry | SymbolicLinkEntry;

interface TreePhaseOptions {
  sourceDir: string;
  targetDir: string;
  signal: AbortSignal | undefined;
  onProgress: ((progress: ProjectMoveProgress) => void) | undefined;
}

/** EXDEV may arrive as a real fs error or a duck-typed object (test injection). */
function isCrossDeviceError(error: unknown): boolean {
  const code = (error as { code?: unknown } | null | undefined)?.code;
  if (typeof code === "string" && code.toUpperCase() === "EXDEV") return true;
  const message = (error as { message?: unknown } | null | undefined)?.message;
  return typeof message === "string" && message.toUpperCase().includes("EXDEV");
}

/**
 * Walk a directory tree and collect regular files plus symbolic links.
 *
 * Symbolic links are preserved as links but never followed. Keeping the raw
 * link text avoids pulling foreign files into the move while preventing a
 * cross-device copy from silently deleting project-owned link entries.
 */
function collectFileEntries(rootDir: string, prefix: string, entries: FileEntry[]): FileEntry[] {
  for (const entry of fs.readdirSync(rootDir, { withFileTypes: true })) {
    const absolutePath = path.join(rootDir, entry.name);
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink()) {
      entries.push({
        kind: "symlink",
        absolutePath,
        relativePath,
        size: 0,
        linkTarget: fs.readlinkSync(absolutePath),
      });
    } else if (entry.isDirectory()) {
      collectFileEntries(absolutePath, relativePath, entries);
    } else if (entry.isFile()) {
      const stat = fs.statSync(absolutePath);
      entries.push({
        kind: "file",
        absolutePath,
        relativePath,
        size: stat.size,
        mtimeMs: stat.mtimeMs,
        ctimeMs: stat.ctimeMs,
      });
    }
  }
  return entries;
}

function scanFileEntries(rootDir: string): FileEntry[] {
  return collectFileEntries(rootDir, "", []);
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new MoveCancelledError();
}

/**
 * Yield to the main-process event loop between files. The copy loop otherwise
 * runs fully synchronously inside the `project-folder-move` IPC handler, which
 * would block the loop for the whole 20GB-class move — and with it every other
 * IPC, including `project-folder-move-cancel`. Cancelling mid-move is only
 * possible because each file boundary pumps the loop once.
 */
function yieldToEventLoop(): Promise<void> {
  return new Promise<void>((resolve) => setImmediate(resolve));
}

/** Phase 1 — copy every scanned file, reporting cumulative progress per file. */
async function copyTree(options: TreePhaseOptions): Promise<FileEntry[]> {
  const entries = scanFileEntries(options.sourceDir);
  const filesTotal = entries.length;
  const bytesTotal = entries.reduce((total, entry) => total + entry.size, 0);
  // Claim the target up front so the failure path can always remove it, and so
  // an empty source tree still materializes the target directory.
  fs.mkdirSync(options.targetDir, { recursive: true });
  let filesDone = 0;
  let bytesDone = 0;
  for (const entry of entries) {
    throwIfAborted(options.signal);
    const destinationPath = path.join(options.targetDir, entry.relativePath);
    fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
    if (entry.kind === "symlink") {
      fs.symlinkSync(entry.linkTarget, destinationPath);
    } else {
      fs.copyFileSync(entry.absolutePath, destinationPath);
    }
    filesDone += 1;
    bytesDone += entry.size;
    options.onProgress?.({ phase: "copying", filesDone, filesTotal, bytesDone, bytesTotal });
    await yieldToEventLoop();
  }
  return entries;
}

async function hashFile(filePath: string, signal: AbortSignal | undefined): Promise<string> {
  const hash = crypto.createHash("sha256");
  for await (const chunk of fs.createReadStream(filePath)) {
    throwIfAborted(signal);
    hash.update(chunk as Buffer);
  }
  return hash.digest("hex");
}

/** Phase 2 — compare tree shape, stable source metadata, and regular-file bytes. */
async function verifyTree(
  options: TreePhaseOptions,
  expectedSourceEntries: FileEntry[],
): Promise<{ filesTotal: number; bytesTotal: number }> {
  const sourceEntries = scanFileEntries(options.sourceDir);
  const targetEntries = scanFileEntries(options.targetDir);
  if (sourceEntries.length !== expectedSourceEntries.length || targetEntries.length !== expectedSourceEntries.length) {
    throw new Error(
      `Project move verification failed: file count mismatch (expected ${expectedSourceEntries.length}, source ${sourceEntries.length}, target ${targetEntries.length})`,
    );
  }
  const sourceByPath = new Map<string, FileEntry>(
    sourceEntries.map((entry) => [entry.relativePath, entry]),
  );
  const targetByPath = new Map<string, FileEntry>(
    targetEntries.map((entry) => [entry.relativePath, entry]),
  );
  const filesTotal = expectedSourceEntries.length;
  const bytesTotal = expectedSourceEntries.reduce((total, entry) => total + entry.size, 0);
  let filesDone = 0;
  let bytesDone = 0;
  for (const entry of expectedSourceEntries) {
    throwIfAborted(options.signal);
    const sourceEntry = sourceByPath.get(entry.relativePath);
    const targetEntry = targetByPath.get(entry.relativePath);
    if (!sourceEntry || !targetEntry) {
      throw new Error(`Project move verification failed: missing source or target file ${entry.relativePath}`);
    }
    if (sourceEntry.kind !== entry.kind || targetEntry.kind !== entry.kind) {
      throw new Error(`Project move verification failed: entry type mismatch for ${entry.relativePath}`);
    }
    if (entry.kind === "symlink") {
      if (sourceEntry.kind !== "symlink" || targetEntry.kind !== "symlink"
        || sourceEntry.linkTarget !== entry.linkTarget || targetEntry.linkTarget !== entry.linkTarget) {
        throw new Error(`Project move verification failed: symlink mismatch for ${entry.relativePath}`);
      }
    } else {
      if (sourceEntry.kind !== "file" || targetEntry.kind !== "file"
        || sourceEntry.size !== entry.size || targetEntry.size !== entry.size
        || sourceEntry.mtimeMs !== entry.mtimeMs || sourceEntry.ctimeMs !== entry.ctimeMs) {
        throw new Error(`Project move verification failed: source changed or size mismatch for ${entry.relativePath}`);
      }
      const [sourceSha256, targetSha256] = await Promise.all([
        hashFile(sourceEntry.absolutePath, options.signal),
        hashFile(targetEntry.absolutePath, options.signal),
      ]);
      const sourceAfterHash = fs.statSync(sourceEntry.absolutePath);
      const targetAfterHash = fs.statSync(targetEntry.absolutePath);
      if (sourceAfterHash.size !== sourceEntry.size
        || sourceAfterHash.mtimeMs !== sourceEntry.mtimeMs
        || sourceAfterHash.ctimeMs !== sourceEntry.ctimeMs
        || targetAfterHash.size !== targetEntry.size
        || targetAfterHash.mtimeMs !== targetEntry.mtimeMs
        || targetAfterHash.ctimeMs !== targetEntry.ctimeMs) {
        throw new Error(`Project move verification failed: file changed while hashing ${entry.relativePath}`);
      }
      if (sourceSha256 !== targetSha256) {
        throw new Error(`Project move verification failed: content mismatch for ${entry.relativePath}`);
      }
    }
    filesDone += 1;
    bytesDone += entry.size;
    options.onProgress?.({ phase: "verifying", filesDone, filesTotal, bytesDone, bytesTotal });
    await yieldToEventLoop();
  }
  return { filesTotal, bytesTotal };
}

async function moveProject(options: ProjectMoveOptions): Promise<ProjectMoveMode> {
  const rename = options.renameImpl ?? ((from: string, to: string) => fs.renameSync(from, to));
  fs.mkdirSync(path.dirname(options.targetDir), { recursive: true });
  try {
    rename(options.sourceDir, options.targetDir);
    return "renamed";
  } catch (error) {
    if (!isCrossDeviceError(error)) throw error;
  }

  const treePhaseOptions: TreePhaseOptions = {
    sourceDir: options.sourceDir,
    targetDir: options.targetDir,
    signal: options.signal,
    onProgress: options.onProgress,
  };
  try {
    const expectedSourceEntries = await copyTree(treePhaseOptions);
    const totals = await verifyTree(treePhaseOptions, expectedSourceEntries);
    options.onProgress?.({
      phase: "finalizing",
      filesDone: totals.filesTotal,
      filesTotal: totals.filesTotal,
      bytesDone: totals.bytesTotal,
      bytesTotal: totals.bytesTotal,
    });
  } catch (error) {
    // Discard the half-built copy; the source must survive untouched.
    fs.rmSync(options.targetDir, { recursive: true, force: true });
    throw error;
  }

  fs.rmSync(options.sourceDir, { recursive: true, force: true });
  return "copied";
}

export function createDefaultProjectMoveEngine(): ProjectMoveEngine {
  return {
    async move(options: ProjectMoveOptions) {
      return moveProject(options);
    },
  };
}
