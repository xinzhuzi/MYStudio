// @vitest-environment jsdom

import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  VideoWorkflowActionReplyV1,
  VideoWorkflowStatusReplyV1,
} from "@rendering/contracts/video-workflow-ipc";
import type { VideoWorkflowPluginId, VideoWorkflowPluginStatusV1 } from "@rendering/contracts/video-workflow";
import { useVideoWorkflowPlugins } from "./useVideoWorkflowPlugins";

const checkedAt = 1_700_000_000_000;

function plugin(pluginId: VideoWorkflowPluginId, runtimeState: VideoWorkflowPluginStatusV1["runtimeState"] = "ready"): VideoWorkflowPluginStatusV1 {
  return {
    schemaVersion: 1,
    pluginId,
    displayName: pluginId,
    sourceUrl: `https://example.test/${pluginId}`,
    sourceCommit: "test-commit",
    license: "MIT",
    appVersion: "test",
    pluginVersion: "test",
    runtimeState,
    dependencies: {},
    checkedAt,
  };
}

function status(overrides: Partial<Record<VideoWorkflowPluginId, VideoWorkflowPluginStatusV1["runtimeState"]>> = {}): VideoWorkflowStatusReplyV1 {
  return {
    schemaVersion: 1,
    checkedAt,
    plugins: (["remotion", "video-use", "hyperframes", "seedance-prompt"] as const).map((pluginId) => plugin(pluginId, overrides[pluginId] ?? "ready")),
  };
}

function action(success: boolean, message?: string): VideoWorkflowActionReplyV1 {
  return { ...status(), schemaVersion: 1, success, ...(message ? { message } : {}) };
}

afterEach(() => {
  Reflect.deleteProperty(window, "videoWorkflowPlugins");
  vi.restoreAllMocks();
});

describe("useVideoWorkflowPlugins", () => {
  it("prepares video-use before Remotion and HyperFrames", async () => {
    const calls: string[] = [];
    const bridge = {
      status: vi.fn(async () => status()),
      prepare: vi.fn(async ({ pluginId }: { pluginId: VideoWorkflowPluginId }) => {
        calls.push(pluginId);
        return action(true);
      }),
      repair: vi.fn(async () => action(true)),
      rollback: vi.fn(async () => action(true)),
    };
    Object.defineProperty(window, "videoWorkflowPlugins", { value: bridge, configurable: true });

    const { result } = renderHook(() => useVideoWorkflowPlugins());
    await waitFor(() => expect(bridge.status).toHaveBeenCalledOnce());

    await act(async () => {
      await result.current.prepareCurrentWorkflow();
    });

    expect(calls).toEqual(["video-use", "remotion", "hyperframes"]);
  });

  it("stops the ordered preparation when video-use is blocked", async () => {
    const bridge = {
      status: vi.fn(async () => status({ "video-use": "blocked" })),
      prepare: vi.fn(async () => action(false, "本地模型未准备")),
      repair: vi.fn(async () => action(true)),
      rollback: vi.fn(async () => action(true)),
    };
    Object.defineProperty(window, "videoWorkflowPlugins", { value: bridge, configurable: true });

    const { result } = renderHook(() => useVideoWorkflowPlugins());
    await waitFor(() => expect(bridge.status).toHaveBeenCalledOnce());

    await act(async () => {
      await result.current.prepareCurrentWorkflow();
    });

    expect(bridge.prepare).toHaveBeenCalledOnce();
    expect(bridge.prepare).toHaveBeenCalledWith({ pluginId: "video-use" });
    expect(result.current.error).toBe("本地模型未准备");
  });

  it("reports unsupported review bridge instead of pretending acceptance", async () => {
    const bridge = {
      status: vi.fn(async () => status()),
      prepare: vi.fn(async () => action(true)),
      repair: vi.fn(async () => action(true)),
      rollback: vi.fn(async () => action(true)),
    };
    Object.defineProperty(window, "videoWorkflowPlugins", { value: bridge, configurable: true });

    const { result } = renderHook(() => useVideoWorkflowPlugins());
    await waitFor(() => expect(bridge.status).toHaveBeenCalledOnce());

    await act(async () => {
      await result.current.review({ projectId: "p", chapterId: "c", revision: 1, reviewer: "tester" });
    });

    expect(result.current.error).toBe("当前环境不支持 video-use 用户确认");
  });
});
