// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useWorkflowStageState } from "./useWorkflowStageState";

vi.mock("./previews/interaction-defer", () => ({
  interactionDeferBegin: vi.fn(),
  interactionDeferEnd: vi.fn(),
  suppressNextInteractionDeferArrival: vi.fn(),
  consumeInteractionDeferArrivalSuppression: vi.fn(() => false),
}));

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

const setWorkflowConfig = vi.fn();
// 手册已配置的 store 桩(阶段切换放行);拒绝分支用可变桩切换
let manualIds: { visualManualId?: string; directorManualId?: string } = {
  visualManualId: "m1",
  directorManualId: "d1",
};
vi.mock("@/stores/studio/studio-store", () => ({
  useStudioStore: {
    getState: () => ({
      workflowConfig: { ...manualIds, workflowStage: "novel" },
    }),
  },
}));

import { interactionDeferBegin, interactionDeferEnd } from "./previews/interaction-defer";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  manualIds = { visualManualId: "m1", directorManualId: "d1" };
});

function renderState(workflowStage = "novel") {
  return renderHook(
    (props: { workflowStage: string }) =>
      useWorkflowStageState({
        activeProjectId: "p1",
        workflowStage: props.workflowStage,
        setWorkflowConfig,
      }),
    { initialProps: { workflowStage } },
  );
}

describe("useWorkflowStageState 阶段进入门闸(效应驱动,含直写 store 路径)", () => {
  it("does not gate on first arrival (冷启/初次进工作台不延迟)", () => {
    renderState("novel");
    expect(interactionDeferBegin).not.toHaveBeenCalled();
    expect(interactionDeferEnd).not.toHaveBeenCalled();
  });

  it("closes the gate for 5s on non-canvas stage changes (workbench has images)", () => {
    const { rerender } = renderState("novel");
    act(() => {
      rerender({ workflowStage: "workbench" });
    });
    expect(interactionDeferBegin).toHaveBeenCalledTimes(1);
    expect(interactionDeferEnd).toHaveBeenCalledTimes(1);
    // 同值重渲不重复关闸
    act(() => {
      rerender({ workflowStage: "workbench" });
    });
    expect(interactionDeferBegin).toHaveBeenCalledTimes(1);
    // 切换到另一阶段后再回到 workbench 再关
    act(() => {
      rerender({ workflowStage: "assets" });
    });
    act(() => {
      rerender({ workflowStage: "workbench" });
    });
    expect(interactionDeferBegin).toHaveBeenCalledTimes(3);
    expect(interactionDeferEnd).toHaveBeenCalledTimes(3);
  });

  it("honors the one-shot suppression (测试桥程序化设阶段免闸)", async () => {
    const deferModule = await import("./previews/interaction-defer");
    const consume = deferModule.consumeInteractionDeferArrivalSuppression as ReturnType<typeof vi.fn>;
    const { rerender } = renderState("novel");
    // 桥先行标志(豁免生效):consume 返回 true → 不关闸
    consume.mockReturnValueOnce(true);
    act(() => {
      rerender({ workflowStage: "workbench" });
    });
    expect(interactionDeferBegin).not.toHaveBeenCalled();
    // 豁免一次性:切换到另一阶段后再回到 workbench 正常关闸
    act(() => {
      rerender({ workflowStage: "assets" });
    });
    act(() => {
      rerender({ workflowStage: "workbench" });
    });
    expect(interactionDeferBegin).toHaveBeenCalledTimes(2);
  });

  it("still switches stages via the callback (rejected switches stay put)", () => {
    const { result } = renderState();
    act(() => {
      result.current.handleStageChange("storyboard");
    });
    expect(setWorkflowConfig).toHaveBeenCalledWith({ workflowStage: "storyboard" });
    expect(result.current.activeWorkflowTab).toBe("storyboard");
    manualIds = { visualManualId: undefined, directorManualId: undefined };
    act(() => {
      result.current.handleStageChange("workbench");
    });
    expect(result.current.activeWorkflowTab).toBe("storyboard");
  });
});
