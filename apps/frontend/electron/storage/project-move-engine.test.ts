import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  MoveCancelledError,
  createDefaultProjectMoveEngine,
  type ProjectMoveProgress,
} from "./project-move-engine";

interface FixtureFile {
  relativePath: string;
  content: string;
}

const FIXTURE_FILES: FixtureFile[] = [
  { relativePath: "script.json", content: '{"state":{"projects":{"p1":{"title":"demo project"}}}}' },
  { relativePath: "director.json", content: '{"screenplay":"chapter one opening scene"}' },
  { relativePath: "assets/cover.png", content: "png-bytes-for-cover" },
  { relativePath: "assets/nested/notes.txt", content: "nested production notes" },
];

function fixtureBytes(): number {
  return FIXTURE_FILES.reduce((total, file) => total + Buffer.byteLength(file.content), 0);
}

function createFixture(prefix: string): { root: string; sourceDir: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const sourceDir = path.join(root, "source");
  for (const file of FIXTURE_FILES) {
    const filePath = path.join(sourceDir, file.relativePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, file.content);
  }
  return { root, sourceDir };
}

function expectFilesMatch(dir: string): void {
  for (const file of FIXTURE_FILES) {
    expect(fs.readFileSync(path.join(dir, file.relativePath), "utf8")).toBe(file.content);
  }
}

function throwCrossDeviceRename(): void {
  // Plain non-Error object on purpose: keeps the engine honest about
  // duck-typed EXDEV detection (error code, not instanceof).
  throw { code: "EXDEV" };
}

describe("project move engine", () => {
  const engine = createDefaultProjectMoveEngine();

  it("renames within the same volume and emits no copying progress", async () => {
    const { root, sourceDir } = createFixture("mystudio-move-rename-");
    try {
      const targetDir = path.join(root, "fresh-parent", "moved-project");
      const events: ProjectMoveProgress[] = [];
      const mode = await engine.move({ sourceDir, targetDir, onProgress: (p) => events.push(p) });

      expect(mode).toBe("renamed");
      expect(fs.existsSync(sourceDir)).toBe(false);
      expect(events.filter((p) => p.phase === "copying")).toHaveLength(0);
      expectFilesMatch(targetDir);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("falls back to copy + verify + finalize across devices with monotonic progress", async () => {
    const { root, sourceDir } = createFixture("mystudio-move-exdev-");
    try {
      const targetDir = path.join(root, "target", "moved");
      const events: ProjectMoveProgress[] = [];
      const mode = await engine.move({
        sourceDir,
        targetDir,
        renameImpl: throwCrossDeviceRename,
        onProgress: (p) => events.push(p),
      });

      expect(mode).toBe("copied");
      expect(fs.existsSync(sourceDir)).toBe(false);
      expectFilesMatch(targetDir);

      expect([...new Set(events.map((p) => p.phase))]).toEqual(["copying", "verifying", "finalizing"]);

      for (const phase of ["copying", "verifying"] as const) {
        const phaseEvents = events.filter((p) => p.phase === phase);
        expect(phaseEvents).toHaveLength(FIXTURE_FILES.length);
        let lastFilesDone = -1;
        let lastBytesDone = -1;
        for (const event of phaseEvents) {
          expect(event.filesTotal).toBe(FIXTURE_FILES.length);
          expect(event.bytesTotal).toBe(fixtureBytes());
          expect(event.filesDone).toBeGreaterThanOrEqual(lastFilesDone);
          expect(event.bytesDone).toBeGreaterThanOrEqual(lastBytesDone);
          lastFilesDone = event.filesDone;
          lastBytesDone = event.bytesDone;
        }
        expect(lastFilesDone).toBe(FIXTURE_FILES.length);
      }

      const finalizing = events.filter((p) => p.phase === "finalizing");
      expect(finalizing).toHaveLength(1);
      expect(finalizing[0]).toEqual({
        phase: "finalizing",
        filesDone: FIXTURE_FILES.length,
        filesTotal: FIXTURE_FILES.length,
        bytesDone: fixtureBytes(),
        bytesTotal: fixtureBytes(),
      });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("cancels via abort signal, removes the partial target, and keeps the source intact", async () => {
    const { root, sourceDir } = createFixture("mystudio-move-cancel-");
    try {
      const targetDir = path.join(root, "target", "moved");
      const controller = new AbortController();
      const move = engine.move({
        sourceDir,
        targetDir,
        signal: controller.signal,
        renameImpl: throwCrossDeviceRename,
        onProgress: (p) => {
          if (p.phase === "copying" && p.filesDone >= 1) controller.abort();
        },
      });

      await expect(move).rejects.toBeInstanceOf(MoveCancelledError);
      expect(fs.existsSync(targetDir)).toBe(false);
      expectFilesMatch(sourceDir);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("honors an abort posted from a later macrotask while copying (move-cancel IPC stays serviceable)", async () => {
    // At runtime the abort comes from the project-folder-move-cancel IPC, which
    // can only run while the main-process event loop is free. A fully
    // synchronous copy loop would finish the whole move before the queued
    // abort callback ever runs — this test pins the per-file loop yield.
    const { root, sourceDir } = createFixture("mystudio-move-yield-");
    try {
      const targetDir = path.join(root, "target", "moved");
      const controller = new AbortController();
      const move = engine.move({
        sourceDir,
        targetDir,
        signal: controller.signal,
        renameImpl: throwCrossDeviceRename,
        onProgress: (p) => {
          if (p.phase === "copying" && p.filesDone >= 1) {
            setImmediate(() => controller.abort());
          }
        },
      });

      await expect(move).rejects.toBeInstanceOf(MoveCancelledError);
      expect(fs.existsSync(targetDir)).toBe(false);
      expectFilesMatch(sourceDir);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("cancels during the verify phase, removing the finished copy and keeping the source", async () => {
    const { root, sourceDir } = createFixture("mystudio-move-cancel-verify-");
    try {
      const targetDir = path.join(root, "target", "moved");
      const controller = new AbortController();
      const move = engine.move({
        sourceDir,
        targetDir,
        signal: controller.signal,
        renameImpl: throwCrossDeviceRename,
        onProgress: (p) => {
          if (p.phase === "verifying" && p.filesDone >= 1) controller.abort();
        },
      });

      await expect(move).rejects.toBeInstanceOf(MoveCancelledError);
      expect(fs.existsSync(targetDir)).toBe(false);
      expectFilesMatch(sourceDir);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("discards the target and rethrows when verification finds a size mismatch", async () => {
    const { root, sourceDir } = createFixture("mystudio-move-verify-");
    try {
      const targetDir = path.join(root, "target", "moved");
      const move = engine.move({
        sourceDir,
        targetDir,
        renameImpl: throwCrossDeviceRename,
        onProgress: (p) => {
          if (p.phase === "copying" && p.filesDone === p.filesTotal) {
            // Tamper after the copy loop finishes, before verification starts.
            fs.truncateSync(path.join(targetDir, "assets", "cover.png"), 1);
          }
        },
      });

      await expect(move).rejects.toThrow("Project move verification failed");
      expect(fs.existsSync(targetDir)).toBe(false);
      expectFilesMatch(sourceDir);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("creates missing target parent directories", async () => {
    const { root, sourceDir } = createFixture("mystudio-move-parents-");
    try {
      const targetDir = path.join(root, "deep", "nested", "parents", "moved");
      expect(fs.existsSync(path.join(root, "deep"))).toBe(false);

      const mode = await engine.move({ sourceDir, targetDir, renameImpl: throwCrossDeviceRename });

      expect(mode).toBe("copied");
      expectFilesMatch(targetDir);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("skips symbolic links instead of following them", async () => {
    const { root, sourceDir } = createFixture("mystudio-move-symlink-");
    try {
      fs.writeFileSync(path.join(root, "outside.txt"), "outside payload");
      const outsideDir = path.join(root, "outside-dir");
      fs.mkdirSync(outsideDir);
      fs.writeFileSync(path.join(outsideDir, "stray.txt"), "stray payload");
      fs.symlinkSync(path.join(root, "outside.txt"), path.join(sourceDir, "file-link.txt"));
      fs.symlinkSync(outsideDir, path.join(sourceDir, "dir-link"));

      const targetDir = path.join(root, "target", "moved");
      const mode = await engine.move({ sourceDir, targetDir, renameImpl: throwCrossDeviceRename });

      expect(mode).toBe("copied");
      expect(fs.existsSync(path.join(targetDir, "file-link.txt"))).toBe(false);
      expect(fs.existsSync(path.join(targetDir, "dir-link"))).toBe(false);
      expect(fs.existsSync(path.join(targetDir, "dir-link", "stray.txt"))).toBe(false);
      expectFilesMatch(targetDir);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
