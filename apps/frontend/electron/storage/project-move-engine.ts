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

interface FileEntry {
  absolutePath: string;
  relativePath: string;
  size: number;
}

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
 * Walk a directory tree and collect regular-file entries.
 *
 * Symbolic links are skipped — never followed, copied, or verified: a symlink
 * inside the project could point outside the tree or form a cycle, and
 * following it would let a symlink bomb pull foreign files into the move.
 */
function collectFileEntries(rootDir: string, prefix: string, entries: FileEntry[]): FileEntry[] {
  for (const entry of fs.readdirSync(rootDir, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue; // symlink bomb guard
    const absolutePath = path.join(rootDir, entry.name);
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      collectFileEntries(absolutePath, relativePath, entries);
    } else if (entry.isFile()) {
      entries.push({ absolutePath, relativePath, size: fs.statSync(absolutePath).size });
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
async function copyTree(options: TreePhaseOptions): Promise<void> {
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
    fs.copyFileSync(entry.absolutePath, destinationPath);
    filesDone += 1;
    bytesDone += entry.size;
    options.onProgress?.({ phase: "copying", filesDone, filesTotal, bytesDone, bytesTotal });
    await yieldToEventLoop();
  }
}

/** Phase 2 — recursively compare both trees: file count and per-file size. */
async function verifyTree(options: TreePhaseOptions): Promise<{ filesTotal: number; bytesTotal: number }> {
  const sourceEntries = scanFileEntries(options.sourceDir);
  const targetEntries = scanFileEntries(options.targetDir);
  if (sourceEntries.length !== targetEntries.length) {
    throw new Error(
      `Project move verification failed: file count mismatch (source ${sourceEntries.length}, target ${targetEntries.length})`,
    );
  }
  const targetSizes = new Map<string, number>(targetEntries.map((entry) => [entry.relativePath, entry.size]));
  const filesTotal = sourceEntries.length;
  const bytesTotal = sourceEntries.reduce((total, entry) => total + entry.size, 0);
  let filesDone = 0;
  let bytesDone = 0;
  for (const entry of sourceEntries) {
    throwIfAborted(options.signal);
    const targetSize = targetSizes.get(entry.relativePath);
    if (targetSize === undefined) {
      throw new Error(`Project move verification failed: missing target file ${entry.relativePath}`);
    }
    if (targetSize !== entry.size) {
      throw new Error(
        `Project move verification failed: size mismatch for ${entry.relativePath} (source ${entry.size}, target ${targetSize})`,
      );
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
    await copyTree(treePhaseOptions);
    const totals = await verifyTree(treePhaseOptions);
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
