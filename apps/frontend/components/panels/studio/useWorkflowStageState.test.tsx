// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useWorkflowStageState } from "./useWorkflowStageState";

vi.mock("./previews/interaction-defer", () => ({
  interactionDeferBegin: vi.fn(),
  interactionDeferEnd: vi.fn(),
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
  return renderHook(() =>
    useWorkflowStageState({
      activeProjectId: "p1",
      workflowStage,
      setWorkflowConfig,
    }),
  );
}

describe("useWorkflowStageState 阶段进入门闸", () => {
  it("closes the defer gate (begin+end → 5s 防抖) on every successful stage switch", () => {
    const { result } = renderState();
    act(() => {
      result.current.handleStageChange("storyboard");
    });
    expect(setWorkflowConfig).toHaveBeenCalledWith({ workflowStage: "storyboard" });
    expect(result.current.activeWorkflowTab).toBe("storyboard");
    expect(interactionDeferBegin).toHaveBeenCalledTimes(1);
    expect(interactionDeferEnd).toHaveBeenCalledTimes(1);

    act(() => {
      result.current.handleStageChange("workbench");
    });
    expect(interactionDeferBegin).toHaveBeenCalledTimes(2);
    expect(interactionDeferEnd).toHaveBeenCalledTimes(2);
  });

  it("does not gate when the switch is rejected (manuals 未配置)", () => {
    manualIds = { visualManualId: undefined, directorManualId: undefined };
    const { result } = renderState();
    act(() => {
      result.current.handleStageChange("storyboard");
    });
    expect(result.current.activeWorkflowTab).toBe("novel");
    expect(interactionDeferBegin).not.toHaveBeenCalled();
    expect(interactionDeferEnd).not.toHaveBeenCalled();
  });
});
