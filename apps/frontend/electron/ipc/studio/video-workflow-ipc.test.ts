import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  VIDEO_WORKFLOW_PREPARE_CHANNEL,
  VIDEO_WORKFLOW_READ_CHAPTER_CHANNEL,
  VIDEO_WORKFLOW_REPAIR_CHANNEL,
  VIDEO_WORKFLOW_ROLLBACK_CHANNEL,
  VIDEO_WORKFLOW_UPDATE_CHANNEL,
  VIDEO_WORKFLOW_REVIEW_CHANNEL,
  VIDEO_WORKFLOW_STATUS_CHANNEL,
} from "@rendering/contracts/video-workflow-ipc";

const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>();
const artifactStore = vi.hoisted(() => ({
  readLatest: vi.fn(),
  readExact: vi.fn(),
}));

vi.mock("electron", () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => Promise<unknown>) => handlers.set(channel, handler)),
    removeHandler: vi.fn((channel: string) => handlers.delete(channel)),
  },
}));

vi.mock("@rendering/plugins/video-workflow/video-workflow-artifact-store", () => ({
  readLatestVideoWorkflowChapterArtifacts: artifactStore.readLatest,
  readVideoWorkflowChapterArtifacts: artifactStore.readExact,
}));

import { registerVideoWorkflowIpcHandlers } from "./video-workflow-ipc";

function createManager() {
  return {
    prepare: vi.fn(async (_pluginId: "video-use" | "hyperframes"): Promise<{ success: boolean; message?: string }> => ({ success: true })),
    update: vi.fn(async (_pluginId: "video-use" | "hyperframes"): Promise<{ success: boolean; message?: string }> => ({ success: true })),
    repair: vi.fn(async (_pluginId: "video-use" | "hyperframes"): Promise<{ success: boolean; message?: string }> => ({ success: true })),
    rollback: vi.fn(async (_pluginId: "video-use" | "hyperframes"): Promise<{ success: boolean; message?: string }> => ({ success: true })),
    prepareVideoUse: vi.fn(),
    prepareHyperFrames: vi.fn(),
    rollbackVideoUse: vi.fn(),
    rollbackHyperFrames: vi.fn(),
  };
}

describe("video workflow runtime IPC actions", () => {
  beforeEach(() => {
    handlers.clear();
    artifactStore.readLatest.mockReset();
    artifactStore.readExact.mockReset();
  });

  it("projects the video-use probe code into renderer-safe plugin status", async () => {
    const registration = registerVideoWorkflowIpcHandlers({
      getStorageBasePath: () => "/tmp/mystudio-ipc-test",
      appVersion: "0.0.1",
      remotionVersion: "4.0.0",
      probeRemotion: async () => ({ state: "ready", remotionVersion: "4.0.0" }),
      probeVideoUse: async () => ({ state: "blocked", code: "alignment-model-missing", message: "本地模型未准备", runtime: {} as never }),
      probeHyperFrames: async () => ({ state: "ready", message: "HyperFrames ok", runtime: {} as never }),
      now: () => 122,
    });

    const reply = await handlers.get(VIDEO_WORKFLOW_STATUS_CHANNEL)?.({});
    expect(reply).toMatchObject({
      checkedAt: 122,
      plugins: expect.arrayContaining([
        expect.objectContaining({ pluginId: "video-use", runtimeState: "blocked", runtimeCode: "alignment-model-missing" }),
      ]),
    });
    registration.dispose();
  });

  it("surfaces automatic app/runtime version checks as update-available", async () => {
    const registration = registerVideoWorkflowIpcHandlers({
      getStorageBasePath: () => "/tmp/mystudio-ipc-test",
      appVersion: "0.0.1",
      remotionVersion: "4.0.0",
      probeRemotion: async () => ({ state: "update-required", remotionVersion: "4.0.0", preparedForRemotionVersion: "3.0.0" }),
      probeVideoUse: async () => ({ state: "blocked", message: "video-use update", runtime: { state: "update-available" } as never }),
      probeHyperFrames: async () => ({ state: "blocked", message: "HyperFrames update", runtime: { state: "update-available" } as never }),
      now: () => 122,
    });

    const reply = await handlers.get(VIDEO_WORKFLOW_STATUS_CHANNEL)?.({});
    expect(reply).toMatchObject({
      plugins: [
        expect.objectContaining({ pluginId: "remotion", runtimeState: "update-available" }),
        expect.objectContaining({ pluginId: "video-use", runtimeState: "update-available" }),
        expect.objectContaining({ pluginId: "hyperframes", runtimeState: "update-available" }),
        expect.objectContaining({ pluginId: "seedance-prompt", runtimeState: "deferred" }),
      ],
    });
    registration.dispose();
  });

  it("runs the managed runtime action before rebuilding plugin status", async () => {
    const manager = createManager();
    const registration = registerVideoWorkflowIpcHandlers({
      getStorageBasePath: () => "/tmp/mystudio-ipc-test",
      appVersion: "0.0.1",
      remotionVersion: "4.0.0",
      probeRemotion: async () => ({ state: "ready", remotionVersion: "4.0.0" }),
      probeVideoUse: async () => ({ state: "ready", message: "video-use ok", runtime: {} as never }),
      probeHyperFrames: async () => ({ state: "ready", message: "HyperFrames ok", runtime: {} as never }),
      runtimeManager: manager,
      now: () => 123,
    });

    const handler = handlers.get(VIDEO_WORKFLOW_PREPARE_CHANNEL);
    expect(handler).toBeDefined();
    const reply = await handler?.({}, { pluginId: "video-use" });
    expect(manager.prepare).toHaveBeenCalledWith("video-use");
    expect(reply).toMatchObject({ success: true, checkedAt: 123 });
    registration.dispose();
  });

  it("prepares the managed Whisper model before the video-use profile", async () => {
    const manager = createManager();
    const prepareVideoUseModel = vi.fn(async () => ({ success: true }));
    const registration = registerVideoWorkflowIpcHandlers({
      getStorageBasePath: () => "/tmp/mystudio-ipc-test",
      appVersion: "0.0.1",
      remotionVersion: "4.0.0",
      probeRemotion: async () => ({ state: "ready", remotionVersion: "4.0.0" }),
      probeVideoUse: async () => ({ state: "ready", message: "video-use ok", runtime: {} as never }),
      probeHyperFrames: async () => ({ state: "ready", message: "HyperFrames ok", runtime: {} as never }),
      prepareVideoUseModel,
      runtimeManager: manager,
      now: () => 124,
    });

    const reply = await handlers.get(VIDEO_WORKFLOW_PREPARE_CHANNEL)?.({}, { pluginId: "video-use" });
    expect(prepareVideoUseModel).toHaveBeenCalledOnce();
    expect(manager.prepare).toHaveBeenCalledWith("video-use");
    expect(reply).toMatchObject({ success: true, checkedAt: 124 });
    registration.dispose();
  });

  it("blocks video-use profile preparation when managed Whisper preparation fails", async () => {
    const manager = createManager();
    const prepareVideoUseModel = vi.fn(async () => ({ success: false, error: "alignment-model-missing" }));
    const registration = registerVideoWorkflowIpcHandlers({
      getStorageBasePath: () => "/tmp/mystudio-ipc-test",
      appVersion: "0.0.1",
      remotionVersion: "4.0.0",
      probeRemotion: async () => ({ state: "ready", remotionVersion: "4.0.0" }),
      probeVideoUse: async () => ({ state: "ready", message: "video-use ok", runtime: {} as never }),
      probeHyperFrames: async () => ({ state: "ready", message: "HyperFrames ok", runtime: {} as never }),
      prepareVideoUseModel,
      runtimeManager: manager,
      now: () => 125,
    });

    const reply = await handlers.get(VIDEO_WORKFLOW_PREPARE_CHANNEL)?.({}, { pluginId: "video-use" });
    expect(reply).toMatchObject({ success: false, message: "alignment-model-missing", checkedAt: 125 });
    expect(manager.prepare).not.toHaveBeenCalled();
    registration.dispose();
  });

  it("uses repair and rollback on the same managed profile instead of probing-only actions", async () => {
    const manager = createManager();
    const registration = registerVideoWorkflowIpcHandlers({
      getStorageBasePath: () => "/tmp/mystudio-ipc-test",
      appVersion: "0.0.1",
      remotionVersion: "4.0.0",
      probeRemotion: async () => ({ state: "ready", remotionVersion: "4.0.0" }),
      probeVideoUse: async () => ({ state: "ready", message: "video-use ok", runtime: {} as never }),
      probeHyperFrames: async () => ({ state: "ready", message: "HyperFrames ok", runtime: {} as never }),
      runtimeManager: manager,
      now: () => 456,
    });

    await handlers.get(VIDEO_WORKFLOW_REPAIR_CHANNEL)?.({}, { pluginId: "hyperframes" });
    await handlers.get(VIDEO_WORKFLOW_ROLLBACK_CHANNEL)?.({}, { pluginId: "hyperframes" });
    expect(manager.repair).toHaveBeenCalledWith("hyperframes");
    expect(manager.rollback).toHaveBeenCalledWith("hyperframes");
    registration.dispose();
  });

  it("applies a user-requested update through the managed runtime and model gates", async () => {
    const manager = createManager();
    const prepareVideoUseModel = vi.fn(async () => ({ success: true }));
    const registration = registerVideoWorkflowIpcHandlers({
      getStorageBasePath: () => "/tmp/mystudio-ipc-test",
      appVersion: "0.0.1",
      remotionVersion: "4.0.0",
      probeRemotion: async () => ({ state: "ready", remotionVersion: "4.0.0" }),
      probeVideoUse: async () => ({ state: "ready", message: "video-use ok", runtime: {} as never }),
      probeHyperFrames: async () => ({ state: "ready", message: "HyperFrames ok", runtime: {} as never }),
      prepareVideoUseModel,
      runtimeManager: manager,
      now: () => 457,
    });

    const reply = await handlers.get(VIDEO_WORKFLOW_UPDATE_CHANNEL)?.({}, { pluginId: "video-use" });
    expect(prepareVideoUseModel).toHaveBeenCalledOnce();
    expect(manager.update).toHaveBeenCalledWith("video-use");
    expect(reply).toMatchObject({ success: true, checkedAt: 457 });
    registration.dispose();
  });

  it("returns a failed runtime action without claiming readiness", async () => {
    const manager = createManager();
    manager.prepare.mockResolvedValueOnce({ success: false, message: "Node 22 SHA-256 不匹配" });
    const registration = registerVideoWorkflowIpcHandlers({
      getStorageBasePath: () => "/tmp/mystudio-ipc-test",
      appVersion: "0.0.1",
      remotionVersion: "4.0.0",
      probeRemotion: async () => ({ state: "ready", remotionVersion: "4.0.0" }),
      probeVideoUse: async () => ({ state: "ready", message: "video-use ok", runtime: {} as never }),
      probeHyperFrames: async () => ({ state: "blocked", message: "HyperFrames blocked", runtime: {} as never }),
      runtimeManager: manager,
      now: () => 789,
    });

    const reply = await handlers.get(VIDEO_WORKFLOW_PREPARE_CHANNEL)?.({}, { pluginId: "hyperframes" });
    expect(reply).toMatchObject({ success: false, message: "Node 22 SHA-256 不匹配" });
    registration.dispose();
  });

  it("routes review confirmation through the main-process artifact boundary", async () => {
    const registration = registerVideoWorkflowIpcHandlers({
      getStorageBasePath: () => "/tmp/mystudio-ipc-test",
      appVersion: "0.0.1",
      remotionVersion: "4.0.0",
      probeRemotion: async () => ({ state: "ready", remotionVersion: "4.0.0" }),
      reviewVideoUse: vi.fn(async (request) => ({
        schemaVersion: 1 as const,
        success: true,
        projectId: request.projectId,
        chapterId: request.chapterId,
        revision: request.revision,
        status: "accepted" as const,
        artifactPath: "/tmp/video-use-artifact.json",
      })),
      now: () => 111,
    });

    const reply = await handlers.get(VIDEO_WORKFLOW_REVIEW_CHANNEL)?.({}, {
      projectId: "project-1",
      chapterId: "chapter-1",
      revision: 1,
      reviewer: "user@example.com",
    });
    expect(reply).toMatchObject({ success: true, status: "accepted", projectId: "project-1" });
    registration.dispose();
  });

  it("restores the latest reviewed revision only after HyperFrames is ready", async () => {
    artifactStore.readLatest.mockResolvedValue({
      success: true,
      value: {
        revision: 4,
        artifacts: {
          paths: {},
          videoUseArtifact: { status: "accepted", review: { decision: "accepted" }, evidence: { inputSha256: "a".repeat(64) } },
          hyperFramesArtifact: { status: "noop" },
        },
      },
    });
    const registration = registerVideoWorkflowIpcHandlers({
      getStorageBasePath: () => "/tmp/mystudio-ipc-test",
      appVersion: "0.0.1",
      remotionVersion: "4.0.0",
      probeRemotion: async () => ({ state: "ready", remotionVersion: "4.0.0" }),
    });

    const reply = await handlers.get(VIDEO_WORKFLOW_READ_CHAPTER_CHANNEL)?.({}, {
      schemaVersion: 1,
      projectId: "project-1",
      chapterId: "chapter-1",
    });
    expect(reply).toMatchObject({ revision: 4, videoUseState: "accepted", hyperFramesState: "noop", inputSha256: "a".repeat(64) });
    const [workspaceRootForProject] = artifactStore.readLatest.mock.calls[0];
    expect(workspaceRootForProject("project-1")).toBe("/tmp/mystudio-ipc-test/projects/_p/project-1/video-use");
    registration.dispose();
  });

  it("keeps a reviewed video-use revision pending until HyperFrames is persisted", async () => {
    artifactStore.readLatest.mockResolvedValue({
      success: true,
      value: {
        revision: 5,
        artifacts: {
          paths: {},
          videoUseArtifact: { status: "accepted", review: { decision: "accepted" }, evidence: { inputSha256: "b".repeat(64) } },
        },
      },
    });
    const registration = registerVideoWorkflowIpcHandlers({
      getStorageBasePath: () => "/tmp/mystudio-ipc-test",
      appVersion: "0.0.1",
      remotionVersion: "4.0.0",
      probeRemotion: async () => ({ state: "ready", remotionVersion: "4.0.0" }),
    });

    const reply = await handlers.get(VIDEO_WORKFLOW_READ_CHAPTER_CHANNEL)?.({}, {
      schemaVersion: 1,
      projectId: "project-1",
      chapterId: "chapter-1",
    });
    expect(reply).toMatchObject({ revision: 5, videoUseState: "pending", hyperFramesState: "idle" });
    registration.dispose();
  });

  it("surfaces malformed persisted artifacts as blocked instead of idle", async () => {
    artifactStore.readLatest.mockResolvedValue({ success: false, issues: [{ path: "$.videoUseArtifact", message: "artifact JSON 无效" }] });
    const registration = registerVideoWorkflowIpcHandlers({
      getStorageBasePath: () => "/tmp/mystudio-ipc-test",
      appVersion: "0.0.1",
      remotionVersion: "4.0.0",
      probeRemotion: async () => ({ state: "ready", remotionVersion: "4.0.0" }),
    });

    const reply = await handlers.get(VIDEO_WORKFLOW_READ_CHAPTER_CHANNEL)?.({}, {
      schemaVersion: 1,
      projectId: "project-1",
      chapterId: "chapter-1",
    });
    expect(reply).toMatchObject({ videoUseState: "blocked", hyperFramesState: "blocked", message: expect.stringContaining("artifact JSON 无效") });
    registration.dispose();
  });
});
