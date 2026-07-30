import { describe, expect, it } from "vitest";
import {
  hashRemotionCurrentSlot,
  prepareRemotionCurrentSlotPublication,
  remotionCurrentSlotPaths,
  resolveRemotionCurrentSlotOutputPath,
} from "./remotion-current-slot";
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
