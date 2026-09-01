// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const generateImageMock = vi.hoisted(() => vi.fn());
const saveToMediaLibraryMock = vi.hoisted(() => vi.fn(() => "media-1"));
const toastErrorMock = vi.hoisted(() => vi.fn());
const toastSuccessMock = vi.hoisted(() => vi.fn());
const eventBusEmitMock = vi.hoisted(() => vi.fn());
const runGenerationMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/ai/ai-manager", () => ({ aiManager: { generateImage: generateImageMock } }));
vi.mock("@/lib/ai/generation-media", () => ({ saveToMediaLibrary: saveToMediaLibraryMock }));
vi.mock("@/lib/ai/image-auto-denoise", () => ({ maybeAutoDenoiseUrl: vi.fn(async (url: string) => url) }));
vi.mock("@/lib/media/image-storage", () => ({
  saveImageToLocal: vi.fn(async () => "local-image://ai-image/x.png"),
  readImageAsBase64: vi.fn(async () => null),
}));
vi.mock("@/lib/bridge/project-files", () => ({ getProjectFilesBridge: vi.fn(() => null) }));
vi.mock("@/lib/studio/image-workflow-references", () => ({
  prepareImageWorkflowReferenceImages: vi.fn(async (values: string[]) => values),
}));
vi.mock("sonner", () => ({
  toast: { error: toastErrorMock, success: toastSuccessMock, info: vi.fn(), warning: vi.fn() },
}));
vi.mock("@/lib/events/event-bus", () => ({
  eventBus: { emit: eventBusEmitMock, on: vi.fn(), once: vi.fn(), off: vi.fn() },
}));
vi.mock("@/lib/assist/image-studio/run-node-generation", () => ({
  runImageStudioNodeGeneration: runGenerationMock,
}));

import { useImageStudioGeneration } from "./use-image-studio-generation";
import { useImageStudioStore } from "@/stores/assist/image-studio-store";
import { useFreedomStore } from "@/stores/assist/freedom-store";

const initialStudioState = useImageStudioStore.getState();
const initialFreedomState = useFreedomStore.getState();

function makeAbortShapedError(message: string): Error {
  const error = new Error(message);
  error.name = "AbortError";
  return error;
}

beforeEach(() => {
  useImageStudioStore.setState(initialStudioState, true);
  useFreedomStore.setState(initialFreedomState, true);
  useImageStudioStore.getState().ensureDefaultWorkflow();
  runGenerationMock.mockReset();
  toastErrorMock.mockClear();
  toastSuccessMock.mockClear();
  eventBusEmitMock.mockClear();
});

afterEach(() => {
  cleanup();
  useImageStudioStore.setState(initialStudioState, true);
  useFreedomStore.setState(initialFreedomState, true);
  localStorage.clear();
});

describe("useImageStudioGeneration 中止语义(实弹根修回归)", () => {
  it("引擎超时类 AbortError(signal 未 abort)→节点 failed 并 toast,不再静默回 idle", async () => {
    runGenerationMock.mockRejectedValue(makeAbortShapedError("轮询超时"));
    const group = useImageStudioStore.getState().addGenerationGroup({ prompt: "山门" });

    const { result } = renderHook(() => useImageStudioGeneration());
    await act(async () => {
      await result.current.generateNode(group.generatedNodeId);
    });

    await waitFor(() => {
      const state = useImageStudioStore.getState();
      const workflow = state.workflows.find((w) => w.id === state.activeWorkflowId);
      const node = workflow?.nodes.find((n) => n.id === group.generatedNodeId);
      expect(node).toMatchObject({ status: "failed", errorReason: "轮询超时" });
    });
    expect(toastErrorMock).toHaveBeenCalledWith(expect.stringContaining("轮询超时"));
  });

  it("用户主动停止(真 abort)→回 idle 且不报错", async () => {
    runGenerationMock.mockImplementation(
      (_graph: unknown, _id: string, input: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          input.signal?.addEventListener("abort", () => {
            const error = new Error("aborted");
            error.name = "AbortError";
            reject(error);
          });
        }),
    );
    const group = useImageStudioStore.getState().addGenerationGroup({ prompt: "山门" });

    const { result } = renderHook(() => useImageStudioGeneration());
    await act(async () => {
      const generating = result.current.generateNode(group.generatedNodeId);
      // 等待 generating 置位后走真实停止路径(hook 内部 controller.abort)
      await new Promise((resolve) => setTimeout(resolve, 20));
      result.current.stopNode(group.generatedNodeId);
      await generating;
    });

    const state = useImageStudioStore.getState();
    const workflow = state.workflows.find((w) => w.id === state.activeWorkflowId);
    const node = workflow?.nodes.find((n) => n.id === group.generatedNodeId);
    expect(node).toMatchObject({ status: "idle" });
    expect(toastErrorMock).not.toHaveBeenCalled();
  }, 10000);

  it("成功路径:ready + 历史条目 + image:generated 事件契约", async () => {
    runGenerationMock.mockResolvedValue({
      imageUrl: "local-image://ai-image/ok.png",
      mediaId: "m-live",
      persisted: true,
      prompt: "山门",
      model: "gpt-image-2",
    });
    const group = useImageStudioStore.getState().addGenerationGroup({ prompt: "山门" });

    const { result } = renderHook(() => useImageStudioGeneration());
    await act(async () => {
      await result.current.generateNode(group.generatedNodeId);
    });

    const state = useImageStudioStore.getState();
    const workflow = state.workflows.find((w) => w.id === state.activeWorkflowId);
    const node = workflow?.nodes.find((n) => n.id === group.generatedNodeId);
    expect(node).toMatchObject({ status: "ready", resultUrl: "local-image://ai-image/ok.png" });
    const history = useFreedomStore.getState().imageHistory[0];
    expect(history).toMatchObject({ resultUrl: "local-image://ai-image/ok.png", mediaId: "m-live" });
    expect(eventBusEmitMock).toHaveBeenCalledWith("image:generated", {
      url: "local-image://ai-image/ok.png",
      prompt: "山门",
      model: "gpt-image-2",
    });
    expect(toastSuccessMock).toHaveBeenCalled();
  });
});
