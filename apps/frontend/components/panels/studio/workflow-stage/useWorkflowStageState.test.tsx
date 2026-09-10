// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useWorkflowStageState } from "./useWorkflowStageState";

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

describe("useWorkflowStageState 阶段切换(门闸已退役 09-03:画布性能优化后图片即时加载)", () => {
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
