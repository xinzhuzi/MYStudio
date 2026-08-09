import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  acceptVideoUseArtifact,
  readLatestVideoWorkflowChapterArtifacts,
  readVideoWorkflowChapterArtifacts,
  resolveVideoWorkflowArtifactPaths,
  writeVideoWorkflowJson,
} from "./video-workflow-artifact-store";

const hash = "a".repeat(64);

function validVideoUseArtifact() {
  return {
    schemaVersion: 1,
    projectId: "project-1",
    chapterId: "chapter-1",
    revision: 1,
    mode: "editable-edl",
    stage: "ready",
    status: "accepted",
    timeUnit: "seconds",
    timelineTimeUnit: "microseconds",
    sourceSha256: hash,
    audioSha256: hash,
    textSha256: hash,
    alignment: [{ cueId: "cue-1", shotId: "shot-1", text: "你好", startUs: 0, durationUs: 1_000_000, confidence: 1, words: [{ id: "word-1", text: "你好", startUs: 0, durationUs: 1_000_000, confidence: 1 }] }],
    edl: [{ shotId: "shot-1", sourcePath: "/tmp/shot.mp4", sourceInS: 0, sourceOutS: 1, timelineStartS: 0, durationS: 1 }],
    subtitles: [{ cueId: "cue-1", shotId: "shot-1", text: "你好", startUs: 0, durationUs: 1_000_000, source: "alignment" }],
    grade: { filter: "eq", parameters: {} },
    overlaySlots: [],
    preview: { path: "/tmp/preview.mp4", sha256: hash, subtitlesBurnedIn: true, durationS: 1 },
    selfEval: { passed: true, score: 1, notes: [], evaluatedAt: 1 },
    evidence: { inputSha256: hash, artifactSha256: hash, toolVersion: "video-use@test", acceptedAt: 1 },
    review: { projectId: "project-1", chapterId: "chapter-1", revision: 1, artifactSha256: hash, reviewer: "user@example.com", decision: "accepted", timestamp: 2 },
  };
}

function validHyperFramesArtifact() {
  return {
    schemaVersion: 1,
    projectId: "project-1",
    chapterId: "chapter-1",
    revision: 1,
    status: "noop",
    sourceArtifactSha256: hash,
    inputSha256: hash,
    alphaFormat: "prores-4444-mov",
    windows: [],
    toolVersion: "hyperframes@test",
    generatedAt: 1,
  };
}

describe("video workflow artifact store", () => {
  it("resolves one revision directory and reads validated artifacts", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "mystudio-video-artifacts-"));
    const paths = resolveVideoWorkflowArtifactPaths((projectId) => path.join(root, projectId, "video-workflow"), "project-1", "chapter-1", 1);
    writeVideoWorkflowJson(paths.videoUsePath, validVideoUseArtifact());
    writeVideoWorkflowJson(paths.hyperFramesPath, validHyperFramesArtifact());
    const result = await readVideoWorkflowChapterArtifacts((projectId) => path.join(root, projectId, "video-workflow"), { projectId: "project-1", chapterId: "chapter-1", revision: 1 });
    expect(result).toMatchObject({ success: true, value: { videoUseArtifact: { status: "accepted" }, hyperFramesArtifact: { status: "noop" } } });
  });

  it("treats missing artifacts as absent so the chapter gate can block explicitly", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "mystudio-video-artifacts-"));
    const result = await readVideoWorkflowChapterArtifacts((projectId) => path.join(root, projectId, "video-workflow"), { projectId: "project-1", chapterId: "chapter-1", revision: 1 });
    expect(result).toMatchObject({ success: true, value: { paths: expect.any(Object) } });
    if (result.success) {
      expect(result.value.videoUseArtifact).toBeUndefined();
      expect(result.value.hyperFramesArtifact).toBeUndefined();
    }
  });

  it("finds the newest valid revision only inside the known chapter directory", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "mystudio-video-latest-"));
    const workspace = (projectId: string) => path.join(root, projectId, "video-workflow");
    const older = resolveVideoWorkflowArtifactPaths(workspace, "project-1", "chapter-1", 1);
    const newest = resolveVideoWorkflowArtifactPaths(workspace, "project-1", "chapter-1", 3);
    writeVideoWorkflowJson(older.videoUsePath, { ...validVideoUseArtifact(), revision: 1 });
    writeVideoWorkflowJson(newest.videoUsePath, { ...validVideoUseArtifact(), revision: 3 });

    const result = await readLatestVideoWorkflowChapterArtifacts(workspace, { projectId: "project-1", chapterId: "chapter-1" });
    expect(result).toMatchObject({ success: true, value: { revision: 3, artifacts: { videoUseArtifact: { revision: 3 } } } });
  });

  it("rejects path traversal before touching the filesystem", () => {
    expect(() => resolveVideoWorkflowArtifactPaths(() => "/tmp/video-workflow", "../project", "chapter-1", 1)).toThrow("projectId");
  });

  it("promotes only a pending preview after explicit user confirmation", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "mystudio-video-review-"));
    const paths = resolveVideoWorkflowArtifactPaths((projectId) => path.join(root, projectId, "video-workflow"), "project-1", "chapter-1", 1);
    const pending = validVideoUseArtifact();
    pending.stage = "awaiting-review";
    pending.status = "pending";
    (pending as unknown as { review?: unknown }).review = undefined;
    writeVideoWorkflowJson(paths.videoUsePath, pending);

    const result = await acceptVideoUseArtifact((projectId) => path.join(root, projectId, "video-workflow"), {
      projectId: "project-1",
      chapterId: "chapter-1",
      revision: 1,
      reviewer: "user@example.com",
    }, 10);

    expect(result).toMatchObject({ success: true, artifact: { status: "accepted", stage: "ready", review: { reviewer: "user@example.com" } } });
    const stored = JSON.parse(await fs.readFile(paths.videoUsePath, "utf8")) as { review?: { artifactSha256?: string }; evidence?: { artifactSha256?: string } };
    expect(stored.review?.artifactSha256).toBe(stored.evidence?.artifactSha256);
  });
});
