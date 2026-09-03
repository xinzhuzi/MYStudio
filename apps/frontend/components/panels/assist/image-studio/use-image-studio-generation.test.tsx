// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const generateImageMock = vi.hoisted(() => vi.fn());
const saveToMediaLibraryMock = vi.hoisted(() => vi.fn(() => "media-1"));
const toastErrorMock = vi.hoisted(() => vi.fn());
const toastInfoMock = vi.hoisted(() => vi.fn());
const toastSuccessMock = vi.hoisted(() => vi.fn());
const toastWarningMock = vi.hoisted(() => vi.fn());
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
  toast: { error: toastErrorMock, success: toastSuccessMock, info: toastInfoMock, warning: toastWarningMock },
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
  toastInfoMock.mockClear();
  toastWarningMock.mockClear();
  eventBusEmitMock.mockClear();
});

afterEach(() => {
  cleanup();
  useImageStudioStore.setState(initialStudioState, true);
  useFreedomStore.setState(initialFreedomState, true);
  localStorage.clear();
});

describe("useImageStudioGeneration 中止语义(实弹根修回归)", () => {
  it("引擎超时类 AbortError(signal 未 abort)→节点 failed 并广播失败弹窗事件,不再静默回 idle", async () => {
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
    // 09-03 失败提示弹窗化:不再 toast,改广播弹窗事件(surface=图片工作室)
    expect(eventBusEmitMock).toHaveBeenCalledWith("image:generation-failed", {
      surface: "image-studio",
      reason: "轮询超时",
    });
  });

  it("批量 count=2:逐张扇出+进度报数+聚合图片组", async () => {
    const group = useImageStudioStore.getState().addGenerationGroup({ prompt: "山门" });
    useImageStudioStore.setState({
      nodeExtras: { [group.generatedNodeId]: { count: 2 } },
    });
    runGenerationMock.mockImplementation(async (_graph: unknown, _id: string) => ({
      prompt: "山门",
      model: "krea2-turbo",
      imageUrl: "local-image://ai-image/b.png",
      mediaId: "m1",
      persisted: true,
    }));

    const { result } = renderHook(() => useImageStudioGeneration());
    await act(async () => {
      await result.current.generateNode(group.generatedNodeId);
    });

    expect(runGenerationMock).toHaveBeenCalledTimes(2);
    expect(toastInfoMock).toHaveBeenCalledWith(expect.stringContaining("第 1 张"));
    expect(toastInfoMock).toHaveBeenCalledWith(expect.stringContaining("第 2 张"));
    const workflow = useImageStudioStore.getState().workflows.find(
      (w) => w.id === useImageStudioStore.getState().activeWorkflowId,
    );
    const node = workflow?.nodes.find((n) => n.id === group.generatedNodeId);
    const generated = node && node.type === "generated" ? node : null;
    expect(generated?.imageBatch?.images).toHaveLength(2);
    expect(generated?.status).toBe("ready");
  });

  it("批量 count=3 部分失败:第 3 张失败保留前 2 张;count 不泄进引擎参数", async () => {
    const group = useImageStudioStore.getState().addGenerationGroup({ prompt: "山门" });
    useImageStudioStore.setState({
      nodeExtras: { [group.generatedNodeId]: { count: 3, stylization: 250 } },
    });
    runGenerationMock
      .mockResolvedValueOnce({ prompt: "山门", model: "krea2-turbo", imageUrl: "local-image://ai-image/1.png", mediaId: "m1", persisted: true })
      .mockResolvedValueOnce({ prompt: "山门", model: "krea2-turbo", imageUrl: "local-image://ai-image/2.png", mediaId: "m2", persisted: true })
      .mockRejectedValueOnce(new Error("供应商 524"));

    const { result } = renderHook(() => useImageStudioGeneration());
    await act(async () => {
      await result.current.generateNode(group.generatedNodeId);
    });

    expect(runGenerationMock).toHaveBeenCalledTimes(3);
    // count 已剥离,其余引擎参数原样透传
    const firstCallInput = runGenerationMock.mock.calls[0][2] as { extraParams?: Record<string, unknown> };
    expect(firstCallInput.extraParams).toEqual({ stylization: 250 });
    // 部分失败语义:警告保留前 2 张,不进 failed
    expect(toastWarningMock).toHaveBeenCalledWith(expect.stringContaining("已保留前 2 张"));
    expect(toastErrorMock).not.toHaveBeenCalled();
    const workflow = useImageStudioStore.getState().workflows.find(
      (w) => w.id === useImageStudioStore.getState().activeWorkflowId,
    );
    const node = workflow?.nodes.find((n) => n.id === group.generatedNodeId);
    const generated = node && node.type === "generated" ? node : null;
    expect(generated?.imageBatch?.images).toEqual([
      "local-image://ai-image/1.png",
      "local-image://ai-image/2.png",
    ]);
    expect(generated?.status).toBe("ready");
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
    // 09-03 增丰:记录带复原所需输入快照(无参考=空数组;批量>1 时另有 batchUrls)
    expect(history.params).toMatchObject({
      source: "image-studio-canvas",
      count: 1,
      references: [],
    });
    expect(eventBusEmitMock).toHaveBeenCalledWith("image:generated", {
      url: "local-image://ai-image/ok.png",
      prompt: "山门",
      model: "gpt-image-2",
    });
    expect(toastSuccessMock).toHaveBeenCalled();
  });
});
