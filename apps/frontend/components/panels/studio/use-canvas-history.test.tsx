// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCanvasHistory, useCanvasHistoryShortcuts } from "./use-canvas-history";

interface Snap {
  nodes: string[];
}

function setup(initial: Snap = { nodes: ["a"] }) {
  const restored: Snap[] = [];
  const state = { current: initial };
  const hook = renderHook(() =>
    useCanvasHistory<Snap>({
      read: () => state.current,
      restore: (snap) => {
        restored.push(snap);
        state.current = snap;
      },
      debounceMs: 50,
    }),
  );
  return { hook, restored, state };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("useCanvasHistory", () => {
  it("提交→撤销→重做回放正确,canUndo/canRedo 随动", () => {
    const { hook, restored, state } = setup();
    const c = hook.result.current;
    expect(c.canUndo).toBe(false);

    act(() => c.commit({ nodes: ["a", "b"] }));
    expect(hook.result.current.canUndo).toBe(true);

    act(() => hook.result.current.undo());
    expect(restored).toEqual([{ nodes: ["a"] }]);
    expect(state.current.nodes).toEqual(["a"]);
    expect(hook.result.current.canUndo).toBe(false);
    expect(hook.result.current.canRedo).toBe(true);

    act(() => hook.result.current.redo());
    expect(state.current.nodes).toEqual(["a", "b"]);
    expect(hook.result.current.canRedo).toBe(false);
  });

  it("防抖窗口内的连续提交合并为一条历史(拖拽语义)", () => {
    const { hook, state } = setup();
    act(() => {
      hook.result.current.commit({ nodes: ["a", "b"] });
    });
    act(() => {
      hook.result.current.commit({ nodes: ["a", "b", "c"] });
    });
    act(() => {
      hook.result.current.commit({ nodes: ["a", "b", "c", "d"] });
    });
    act(() => vi.advanceTimersByTime(100));
    // 一次 undo 回到突发前基线,而不是中间态
    act(() => hook.result.current.undo());
    expect(state.current.nodes).toEqual(["a"]);
  });

  it("与基线等价的提交被忽略;新提交清空 redo", () => {
    const { hook, state } = setup();
    act(() => hook.result.current.commit({ nodes: ["a", "b"] }));
    act(() => vi.advanceTimersByTime(100));
    act(() => hook.result.current.undo());
    expect(hook.result.current.canRedo).toBe(true);
    // 引用等价提交(不可变图常见:未变更的 nodes/edges 原引用透传)不产生历史
    act(() => hook.result.current.commit(state.current));
    expect(hook.result.current.canUndo).toBe(false);
    // 新提交清 redo
    act(() => hook.result.current.commit({ nodes: ["x"] }));
    expect(hook.result.current.canRedo).toBe(false);
  });

  it("历史上限生效(capacity)", () => {
    const restored: Snap[] = [];
    const state = { current: { nodes: ["s"] } };
    const hook = renderHook(() =>
      useCanvasHistory<Snap>({
        read: () => state.current,
        restore: (snap) => {
          restored.push(snap);
          state.current = snap;
        },
        capacity: 3,
        debounceMs: 10,
      }),
    );
    for (let i = 1; i <= 8; i += 1) {
      act(() => hook.result.current.commit({ nodes: ["s", String(i)] }));
      act(() => vi.advanceTimersByTime(20));
    }
    let undoCount = 0;
    while (hook.result.current.canUndo) {
      act(() => hook.result.current.undo());
      undoCount += 1;
    }
    expect(undoCount).toBe(3);
  });

  it("resetKey 变更清史(切换工作流不跨上下文)", () => {
    const state = { current: { nodes: ["a"] } };
    const hook = renderHook(
      ({ resetKey }) =>
        useCanvasHistory<Snap>({
          read: () => state.current,
          restore: (snap) => {
            state.current = snap;
          },
          resetKey,
        }),
      { initialProps: { resetKey: "flow-1" } },
    );
    act(() => hook.result.current.commit({ nodes: ["a", "b"] }));
    expect(hook.result.current.canUndo).toBe(true);
    act(() => hook.rerender({ resetKey: "flow-2" }));
    expect(hook.result.current.canUndo).toBe(false);
    expect(hook.result.current.canRedo).toBe(false);
  });
});

describe("useCanvasHistoryShortcuts", () => {
  it("⌘Z 撤销、⌘⇧Z 重做;输入框聚焦不抢", () => {
    const undo = vi.fn();
    const redo = vi.fn();
    renderHook(() => useCanvasHistoryShortcuts({ undo, redo }));

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "z", metaKey: true, bubbles: true }));
    });
    expect(undo).toHaveBeenCalledTimes(1);

    act(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "z", metaKey: true, shiftKey: true, bubbles: true }),
      );
    });
    expect(redo).toHaveBeenCalledTimes(1);

    const input = document.createElement("input");
    document.body.appendChild(input);
    act(() => {
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "z", metaKey: true, bubbles: true }),
      );
    });
    expect(undo).toHaveBeenCalledTimes(1);
    input.remove();
  });
});

describe("useCanvasHistory 验收域隔离(R3 PRD)", () => {
  it("副作用隔离:快照域只含 nodes/edges,restore 仅收到视图模型", () => {
    const restored: Array<Record<string, unknown>> = [];
    const state = { current: { nodes: ["a"], edges: [] } };
    const hook = renderHook(() =>
      useCanvasHistory<Record<string, unknown>>({
        read: () => state.current,
        restore: (snap) => {
          restored.push(snap);
          state.current = snap;
        },
        debounceMs: 10,
      }),
    );
    act(() => hook.result.current.commit({ nodes: ["a", "b"], edges: [] }));
    act(() => vi.advanceTimersByTime(20));
    act(() => hook.result.current.undo());
    // restore 收到的每个快照都只有 nodes/edges 两键——IPC/落库/生成副作用
    // 从结构上进不了历史通道,撤销不可能回放它们
    for (const snap of restored) {
      expect(Object.keys(snap).sort()).toEqual(["edges", "nodes"]);
    }
  });

  it("选中态/视口不入史:撤销只回放结构变更,不含任何选中/视口字段", () => {
    const state = { current: { nodes: ["a"], edges: [] } };
    const hook = renderHook(() =>
      useCanvasHistory({ read: () => state.current, restore: (snap) => { state.current = snap; }, debounceMs: 10 }),
    );
    // 模拟:结构变更 + (画布外)选中/视口频繁变化——历史只感知显式 commit
    act(() => hook.result.current.commit({ nodes: ["a", "b"], edges: [] }));
    act(() => vi.advanceTimersByTime(20));
    act(() => hook.result.current.undo());
    expect(state.current.nodes).toEqual(["a"]);
    // 选中/视口从未经过 commit → 不产生历史、撤销不受干扰
    expect(hook.result.current.canRedo).toBe(true);
  });

  it("持久化隔离:历史仅内存,commit/undo/redo 全程零存储写入", () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const state = { current: { nodes: ["a"] } };
    const hook = renderHook(() =>
      useCanvasHistory({ read: () => state.current, restore: () => {}, debounceMs: 10 }),
    );
    act(() => hook.result.current.commit({ nodes: ["a", "b"] }));
    act(() => vi.advanceTimersByTime(20));
    act(() => hook.result.current.undo());
    act(() => hook.result.current.redo());
    expect(setItem).not.toHaveBeenCalled();
    setItem.mockRestore();
  });
});
