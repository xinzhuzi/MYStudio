import { describe, expect, it, vi } from "vitest";
import type { EditingProjectV1 } from "@/types/editing";
import type { RemotionChapterManifestV2 } from "@/types/remotion-workspace";
import type {
  HyperFramesOverlayArtifactV1,
  VideoUseChapterArtifactV1,
} from "@rendering/contracts/video-workflow";
import {
  createVideoWorkflowChapterService,
  type VideoWorkflowChapterServiceOptions,
} from "./video-workflow-chapter-service";

const hash = "a".repeat(64);

function editingProject(): EditingProjectV1 {
  return {
    schemaVersion: 1,
    id: "editing-1",
    projectId: "p1",
    episodeId: "c1",
    name: "chapter",
    revision: 1,
    sourceSnapshotHash: hash,
    createdBy: "auto",
    manuallyEdited: false,
    stale: false,
    renderSettings: { width: 1080, height: 1920, fps: 30, codec: "h264", subtitleMode: "burn-in", loudnessLufs: -14, truePeakDbtp: -1.5 },
    tracks: [{ id: "video", kind: "video", name: "video", order: 0, clipIds: ["old-1"], muted: false, locked: false }],
    clips: [{ id: "old-1", trackId: "video", name: "old", source: { kind: "storyboardVideo", path: "/tmp/old.mp4", evidence: { storyboardId: "shot-1" } }, startUs: 0, durationUs: 1_000_000, trimStartUs: 0, speed: 1, volume: 1, muted: false }],
    transitions: [],
    effects: [],
    proposals: [],
    createdAt: 1,
    updatedAt: 1,
  };
}

function acceptedArtifact(): VideoUseChapterArtifactV1 {
  return {
    schemaVersion: 1,
    projectId: "p1",
    chapterId: "c1",
    revision: 2,
    mode: "editable-edl",
    stage: "ready",
    status: "accepted",
    timeUnit: "seconds",
    timelineTimeUnit: "microseconds",
    sourceSha256: hash,
    audioSha256: hash,
    textSha256: hash,
    alignment: [],
    edl: [{ shotId: "shot-1", sourcePath: "/tmp/shot-1.mp4", sourceInS: 0, sourceOutS: 1, timelineStartS: 0, durationS: 1 }],
    subtitles: [],
    grade: { filter: "auto", parameters: {} },
    overlaySlots: [],
    preview: { path: "/tmp/preview.mp4", sha256: hash, subtitlesBurnedIn: true, durationS: 1 },
    selfEval: { passed: true, score: 1, notes: [], evaluatedAt: 2 },
    evidence: { inputSha256: hash, artifactSha256: "b".repeat(64), toolVersion: "video-use@test", acceptedAt: 2 },
    review: { projectId: "p1", chapterId: "c1", revision: 2, artifactSha256: "b".repeat(64), reviewer: "user", decision: "accepted", timestamp: 3 },
    subtitleAuthority: {
      mode: "clean-remotion",
      evidence: { mode: "clean-remotion", decision: "human", sourceFingerprint: "b".repeat(64), evidencePaths: ["test"], reviewedAt: 3 },
    },
  };
}

function noopOverlayArtifact(): HyperFramesOverlayArtifactV1 {
  return {
    schemaVersion: 1,
    projectId: "p1",
    chapterId: "c1",
    revision: 2,
    status: "noop",
    sourceArtifactSha256: "b".repeat(64),
    inputSha256: hash,
    alphaFormat: "prores-4444-mov",
    windows: [],
    toolVersion: "hyperframes@test",
    generatedAt: 3,
  };
}

const applyInput = { projectId: "p1", chapterId: "c1", revision: 2, inputSha256: hash, width: 1080, height: 1920, fps: 30, alphaFormat: "prores-4444-mov" as const };

function readableAcceptedArtifacts() {
  return {
    success: true as const,
    value: {
      paths: { revisionDir: "/tmp/video-workflow/c1/r2", videoUsePath: "/tmp/video-workflow/c1/r2/video-use-artifact.json", hyperFramesPath: "/tmp/video-workflow/c1/r2/hyperframes-artifact.json" },
      videoUseArtifact: acceptedArtifact(),
    },
  };
}

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

  it("persists the validated EditingProject projection only after the accepted artifact and overlay succeed", async () => {
    const persistEditingProject = vi.fn(async (_project: EditingProjectV1) => undefined);
    const manifest = {
      schemaVersion: 2,
      manifestFingerprint: hash,
      projectId: "p1",
      chapterId: "c1",
      revision: 1,
      sourceSnapshotHash: "c".repeat(64),
      requiredShotIds: ["shot-1"],
      sharedAudioBindings: [],
      shots: [],
      renderSettings: editingProject().renderSettings,
      createdAt: 1,
      updatedAt: 1,
    } as unknown as RemotionChapterManifestV2;
    const readChapterManifest = vi.fn(async () => manifest);
    const writeChapterManifest = vi.fn(async () => undefined);
    const renderHyperFrames = vi.fn(async () => ({ state: "ready" as const, artifact: noopOverlayArtifact(), artifactPath: "/tmp/video-workflow/c1/r2/hyperframes-artifact.json" }));
    const service = createVideoWorkflowChapterService({
      workspaceRootForProject: () => "/tmp/video-workflow",
      runVideoUse: vi.fn(),
      renderHyperFrames,
      readArtifacts: async () => readableAcceptedArtifacts(),
      getCurrentEditingProject: async () => editingProject(),
      persistEditingProject,
      readChapterManifest,
      writeChapterManifest,
      now: () => 10,
    });

    await expect(service.applyAcceptedArtifact(applyInput)).resolves.toMatchObject({ success: true });
    expect(renderHyperFrames).toHaveBeenCalledOnce();
    expect(writeChapterManifest).toHaveBeenCalledWith(expect.objectContaining({
      expectedRevision: 1,
      manifest: expect.objectContaining({ revision: 2, sourceSnapshotHash: hash, updatedAt: 10 }),
    }));
    expect(persistEditingProject).toHaveBeenCalledWith(expect.objectContaining({ id: "editing-1", revision: 2, updatedAt: 10 }));
    expect(persistEditingProject.mock.calls[0]?.[0].clips).toMatchObject([{ source: { path: "/tmp/shot-1.mp4" } }]);
  });

  it("passes caller-provided decorative windows to the real HyperFrames boundary", async () => {
    const renderHyperFrames = vi.fn(async (request: Parameters<NonNullable<VideoWorkflowChapterServiceOptions["renderHyperFrames"]>>[0]) => ({
      state: "ready" as const,
      artifact: {
        ...noopOverlayArtifact(),
        status: "accepted" as const,
        outputPath: "/tmp/video-workflow/c1/r2/hyperframes-overlay.mov",
        outputSha256: hash,
        windows: request.windows,
      },
    }));
    const service = createVideoWorkflowChapterService({
      workspaceRootForProject: () => "/tmp/video-workflow",
      runVideoUse: vi.fn(),
      renderHyperFrames,
      readArtifacts: async () => readableAcceptedArtifacts(),
      getCurrentEditingProject: async () => editingProject(),
      persistEditingProject: vi.fn(async () => undefined),
    });
    const decorative = {
      slotId: "effect-shot-1",
      cueId: "decorative-effect-1",
      startUs: 0,
      durationUs: 500_000,
      templateId: "highlight-box",
      parameters: { color: "#f4d06f" },
    } as const;

    await expect(service.applyAcceptedArtifact({ ...applyInput, hyperFramesWindows: [decorative] })).resolves.toMatchObject({ success: true });
    expect(renderHyperFrames).toHaveBeenCalledWith(expect.objectContaining({ windows: [decorative] }));
  });

  it("fails closed when the main-process EditingProject persistence boundary is absent", async () => {
    const renderHyperFrames = vi.fn(async () => ({ state: "ready" as const, artifact: noopOverlayArtifact() }));
    const service = createVideoWorkflowChapterService({
      workspaceRootForProject: () => "/tmp/video-workflow",
      runVideoUse: vi.fn(),
      renderHyperFrames,
      readArtifacts: async () => readableAcceptedArtifacts(),
    });

    await expect(service.applyAcceptedArtifact(applyInput)).resolves.toMatchObject({ success: false, code: "editing-project-unavailable" });
    expect(renderHyperFrames).not.toHaveBeenCalled();
  });

  it("does not report application success when the durable EditingProject revision write fails", async () => {
    const persistEditingProject = vi.fn(async () => { throw new Error("revision conflict"); });
    const service = createVideoWorkflowChapterService({
      workspaceRootForProject: () => "/tmp/video-workflow",
      runVideoUse: vi.fn(),
      renderHyperFrames: async () => ({ state: "ready" as const, artifact: noopOverlayArtifact() }),
      readArtifacts: async () => readableAcceptedArtifacts(),
      getCurrentEditingProject: async () => editingProject(),
      persistEditingProject,
    });

    await expect(service.applyAcceptedArtifact(applyInput)).resolves.toMatchObject({ success: false, code: "editing-project-persist-failed" });
    expect(persistEditingProject).toHaveBeenCalledOnce();
  });
});
