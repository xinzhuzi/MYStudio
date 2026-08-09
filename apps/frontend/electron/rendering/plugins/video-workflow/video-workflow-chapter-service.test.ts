import { describe, expect, it, vi } from "vitest";
import { createVideoWorkflowChapterService } from "./video-workflow-chapter-service";

const hash = "a".repeat(64);

describe("video workflow chapter service", () => {
  it("keeps sidecar execution explicit and blocks when persisted artifacts are invalid", async () => {
    const runVideoUse = vi.fn(async () => ({ state: "blocked" as const, code: "runtime-not-ready", message: "runtime" }));
    const renderHyperFrames = vi.fn(async () => ({ state: "blocked" as const, code: "runtime-not-ready", message: "runtime" }));
    const service = createVideoWorkflowChapterService({
      workspaceRootForProject: () => "/tmp/video-workflow",
      runVideoUse,
      renderHyperFrames,
      readArtifacts: async () => ({ success: false as const, issues: [{ path: "$.videoUseArtifact", message: "无效" }] }),
    });
    const gate = await service.evaluateGate({ projectId: "p1", chapterId: "c1", revision: 1, inputSha256: hash });
    expect(gate).toMatchObject({ accepted: false, code: "video-use-artifact-invalid" });
    expect(runVideoUse).not.toHaveBeenCalled();
    expect(renderHyperFrames).not.toHaveBeenCalled();
  });
});
