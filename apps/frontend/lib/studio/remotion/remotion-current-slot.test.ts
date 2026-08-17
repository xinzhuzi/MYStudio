// @vitest-environment node
import { createHash } from "node:crypto";
import { mkdtempSync, promises as fsPromises, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  hashRemotionCurrentSlot,
  prepareRemotionCurrentSlotPublication,
  readRemotionCurrentShotSlotsFromWorkspace,
  remotionCurrentSlotPaths,
  resolveRemotionCurrentSlotOutputPath,
} from "./remotion-current-slot";
import { createRemotionRenderJobId } from "./remotion-job-identity";
import { makeCurrentSlot, makePublication } from "./remotion-workspace-test-fixtures";

describe("Remotion current-slot publication", () => {
  it("hashes a complete current slot with canonical SHA-256", async () => {
    const first = makeCurrentSlot();
    const second = { ...first, evidence: { ...first.evidence } };
    await expect(hashRemotionCurrentSlot(first)).resolves.toMatch(/^[a-f0-9]{64}$/);
    expect(await hashRemotionCurrentSlot(second)).toBe(await hashRemotionCurrentSlot(first));
  });

  it("derives one target-specific current path set", () => {
    expect(
      remotionCurrentSlotPaths({
        kind: "shot",
        chapterId: "chapter-001",
        shotId: "shot-001",
        shotRevision: 1,
      }),
    ).toEqual({
      jobPath: "jobs/shot/chapter-001/shot-001/current.json",
      evidencePath: "evidence/shots/chapter-001/shot-001/current.json",
      outputPath: "outputs/shots/chapter-001/shot-001/current.mp4",
    });

    expect(
      remotionCurrentSlotPaths({
        kind: "chapter",
        chapterId: "chapter-001",
        editingProjectId: "editing-001",
        editingRevision: 1,
      }),
    ).toEqual({
      jobPath: "jobs/chapter/chapter-001/current.json",
      evidencePath: "evidence/chapters/chapter-001/current.json",
      outputPath: "outputs/chapters/chapter-001/current.mp4",
    });
  });

  it("resolves only the target-derived output inside the workspace", () => {
    const slot = makeCurrentSlot();
    expect(resolveRemotionCurrentSlotOutputPath("/tmp/project/remotion", slot)).toBe(
      "/tmp/project/remotion/outputs/shots/chapter-001/shot-001/current.mp4",
    );
    expect(() => resolveRemotionCurrentSlotOutputPath("relative", slot)).toThrow("workspaceRoot");
    expect(() => resolveRemotionCurrentSlotOutputPath(
      "/tmp/project/remotion",
      { ...slot, outputPath: "../../outside.mp4" },
    )).toThrow("outputPath");
    expect(() => resolveRemotionCurrentSlotOutputPath(
      "/tmp/project/remotion",
      {
        ...slot,
        target: { ...slot.target, chapterId: "../../outside" },
        outputPath: "outputs/shots/../../outside/shot-001/current.mp4",
      },
    )).toThrow("current slot 无效");
  });

  it("recovers verified persisted shot slots without depending on transient queue state", async () => {
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), "mystudio-remotion-current-slot-"));
    try {
      const current = makeCurrentSlot();
      const job = { ...current.job, jobId: await createRemotionRenderJobId(current.job) };
      const outputPath = path.join(workspaceRoot, current.outputPath);
      const bytes = Buffer.alloc(42_000, 7);
      await fsPromises.mkdir(path.dirname(outputPath), { recursive: true });
      await fsPromises.writeFile(outputPath, bytes);
      const outputStat = await fsPromises.stat(outputPath);
      const depthMapPath = path.posix.join(path.posix.dirname(current.outputPath), "current.depth.png");
      const depthBytes = Buffer.from("verified-depth-map", "utf8");
      await fsPromises.writeFile(path.join(workspaceRoot, depthMapPath), depthBytes);
      const evidence = {
        ...current.evidence,
        jobId: job.jobId,
        sizeBytes: outputStat.size,
        mtimeMs: Math.floor(outputStat.mtimeMs),
        sha256: createHash("sha256").update(bytes).digest("hex"),
        cinematic: {
          schemaVersion: 1 as const,
          preset: "cinematic-dolly-in",
          model: "depth-anything-v2-small" as const,
          inputSha256: "a".repeat(64),
          outputSha256: createHash("sha256").update(depthBytes).digest("hex"),
          depthMapPath,
          width: 1080,
          height: 1920,
        },
      };
      await fsPromises.mkdir(path.dirname(path.join(workspaceRoot, current.jobPath)), { recursive: true });
      await fsPromises.mkdir(path.dirname(path.join(workspaceRoot, current.evidencePath)), { recursive: true });
      await fsPromises.writeFile(path.join(workspaceRoot, current.jobPath), JSON.stringify(job));
      await fsPromises.writeFile(path.join(workspaceRoot, current.evidencePath), JSON.stringify(evidence));

      // A copied or malformed directory name must not create a second slot.
      const misleadingPath = path.join(workspaceRoot, "jobs", "shot", "chapter-001", "not-the-shot-id", "current.json");
      await fsPromises.mkdir(path.dirname(misleadingPath), { recursive: true });
      await fsPromises.writeFile(misleadingPath, JSON.stringify(job));

      await expect(readRemotionCurrentShotSlotsFromWorkspace(workspaceRoot, "project-a", "chapter-001"))
        .resolves.toEqual([expect.objectContaining({
          projectId: "project-a",
          target: current.target,
          job,
          evidence,
        })]);

      await fsPromises.writeFile(path.join(workspaceRoot, depthMapPath), "tampered-depth-map");
      await expect(readRemotionCurrentShotSlotsFromWorkspace(workspaceRoot, "project-a", "chapter-001"))
        .resolves.toEqual([]);
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("prepares a complete next slot without mutating the previous current", () => {
    const previous = makeCurrentSlot();
    const snapshot = structuredClone(previous);
    const result = prepareRemotionCurrentSlotPublication(makePublication(), previous);
    expect(result.success).toBe(true);
    expect(previous).toEqual(snapshot);
    if (!result.success) return;
    expect(result.value.previousCurrent).toEqual(previous);
    expect(result.value.nextCurrent.evidence.sha256).toBe(makePublication().stagedOutput.sha256);
  });

  it.each(["failed", "canceled"] as const)(
    "preserves the old current when the staged job is %s",
    (status) => {
      const previous = makeCurrentSlot();
      const snapshot = structuredClone(previous);
      const publication = makePublication();
      publication.job = { ...publication.job, status, progress: 0.5 };
      const result = prepareRemotionCurrentSlotPublication(publication, previous);
      expect(result.success).toBe(false);
      expect(previous).toEqual(snapshot);
    },
  );

  it("rejects replacement of a different project or target", () => {
    const previous = makeCurrentSlot();
    previous.projectId = "project-b";
    previous.job = { ...previous.job, projectId: "project-b" };
    previous.evidence = { ...previous.evidence, projectId: "project-b" };
    const result = prepareRemotionCurrentSlotPublication(makePublication(), previous);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.issues.some((issue) => issue.code === "remotion.current_slot.replacement_scope")).toBe(true);
    }
  });
});
