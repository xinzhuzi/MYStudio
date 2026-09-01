// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useAssistCanvasHistory } from "./use-assist-canvas-history";
import {
  selectActiveImageStudioWorkflow,
  useImageStudioStore,
} from "@/stores/assist/image-studio-store";

afterEach(() => {
  cleanup();
  useImageStudioStore.setState(useImageStudioStore.getState(), true);
});

function activeGraph() {
  return selectActiveImageStudioWorkflow(useImageStudioStore.getState());
}

describe("useAssistCanvasHistory(assist 面撤销重做)", () => {
  it("结构变更→撤销回退→重做恢复(实 store)", async () => {
    useImageStudioStore.getState().ensureDefaultWorkflow();
    const graph = activeGraph();
    const before = graph!.nodes.length;

    const { result, rerender } = renderHook(
      ({ workflow }) => useAssistCanvasHistory({ workflow }),
      { initialProps: { workflow: graph } },
    );
    // 基线
    act(() => result.current.commitSnapshot());

    // 结构变更:建生成组;画布会拿到新 workflow 引用并 commit(此处等价模拟)
    act(() => {
      useImageStudioStore.getState().addGenerationGroup({ prompt: "剑客" });
    });
    await waitFor(() => expect(activeGraph()!.nodes.length).toBe(before + 2));
    rerender({ workflow: activeGraph() });
    act(() => result.current.commitSnapshot());

    // 撤销:回基线
    act(() => result.current.history.undo());
    await waitFor(() => expect(activeGraph()!.nodes.length).toBe(before));

    // 重做:恢复
    act(() => result.current.history.redo());
    await waitFor(() => expect(activeGraph()!.nodes.length).toBe(before + 2));
  });

  it("resetKey 切画布清史", async () => {
    const store = useImageStudioStore.getState();
    store.ensureDefaultWorkflow();
    const graph = activeGraph();
    const { result, rerender } = renderHook(
      ({ workflow }) => useAssistCanvasHistory({ workflow }),
      { initialProps: { workflow: graph } },
    );
    act(() => result.current.commitSnapshot());
    act(() => {
      useImageStudioStore.getState().addPromptNode();
    });
    rerender({ workflow: activeGraph() });
    act(() => result.current.commitSnapshot());
    await waitFor(() => expect(result.current.history.canUndo).toBe(true));
    // 切到无 workflow(undefined id)
    rerender({ workflow: undefined });
    expect(result.current.history.canUndo).toBe(false);
  });
});
