// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GenerationProgress } from "./generation-progress";

const mocks = vi.hoisted(() => ({
  cancel: vi.fn(),
  cancelAll: vi.fn(),
  initWorker: vi.fn(),
  worker: vi.fn(),
  callOrder: [] as string[],
}));

vi.mock("@/lib/ai/ai-manager", () => ({
  aiManager: {
    initWorker: mocks.initWorker,
    worker: mocks.worker,
  },
}));

vi.mock("@/stores/ai/api-config-store", () => ({
  useAPIConfigStore: (
    selector: (state: { apiKeys: Record<string, string> }) => unknown,
  ) => selector({ apiKeys: {} }),
}));

vi.mock("@/stores/director/director-store", () => ({
  useActiveDirectorProject: () => ({
    screenplay: {
      id: "screenplay-1",
      title: "道劫",
      scenes: [{ sceneId: 1 }],
    },
    screenplayStatus: "generating_images",
  }),
  useDirectorStore: () => ({
    sceneProgress: new Map([
      [
        1,
        {
          sceneId: 1,
          status: "generating",
          stage: "image",
          progress: 20,
        },
      ],
    ]),
    config: {},
    cancelAll: mocks.cancelAll,
    onSceneProgressUpdate: vi.fn(),
    onSceneImageCompleted: vi.fn(),
    onSceneCompleted: vi.fn(),
    onSceneFailed: vi.fn(),
    onAllImagesCompleted: vi.fn(),
    onAllCompleted: vi.fn(),
  }),
  useIsGenerating: () => true,
  useOverallProgress: () => 20,
}));

describe("GenerationProgress", () => {
  beforeEach(() => {
    mocks.callOrder.length = 0;
    mocks.cancel.mockReset();
    mocks.cancelAll.mockReset();
    mocks.initWorker.mockReset();
    mocks.worker.mockReset();
    mocks.cancel.mockImplementation(() => {
      mocks.callOrder.push("bridge.cancel");
    });
    mocks.cancelAll.mockImplementation(() => {
      mocks.callOrder.push("store.cancelAll");
    });
    mocks.initWorker.mockResolvedValue({ cancel: mocks.cancel });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("cancels the initialized worker bridge before updating the store", async () => {
    render(<GenerationProgress />);

    fireEvent.click(screen.getByRole("button", { name: "取消生成" }));

    await waitFor(() => {
      expect(mocks.cancelAll).toHaveBeenCalledTimes(1);
    });
    expect(mocks.initWorker).toHaveBeenCalledTimes(1);
    expect(mocks.worker).not.toHaveBeenCalled();
    expect(mocks.cancel).toHaveBeenCalledTimes(1);
    expect(mocks.callOrder).toEqual(["bridge.cancel", "store.cancelAll"]);
  });

  it("restores local cancellation state when worker initialization fails", async () => {
    const initializationError = new Error("Worker initialization failed");
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.initWorker.mockRejectedValueOnce(initializationError);

    render(<GenerationProgress />);

    fireEvent.click(screen.getByRole("button", { name: "取消生成" }));

    await waitFor(() => {
      expect(mocks.cancelAll).toHaveBeenCalledTimes(1);
    });
    expect(mocks.cancel).not.toHaveBeenCalled();
    expect(mocks.callOrder).toEqual(["store.cancelAll"]);
    expect(errorSpy).toHaveBeenCalledWith(
      "[GenerationProgress] Failed to cancel generation:",
      initializationError,
    );
  });
});
