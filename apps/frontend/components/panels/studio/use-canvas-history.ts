import { useCallback, useEffect, useRef, useState } from "react";

/**
 * 画布撤销重做(08-31-canvas-undo-redo):
 * 会话级快照历史——只包调用方声明的画布视图模型(image-workflow 为
 * nodes+edges,生产流为节点位置),选中态/视口/副作用一律不入史。
 *
 * 快照防抖语义:连续变更(如拖拽)合并为一条历史——突发首帧把
 * 变更前基线压栈,窗口内的后续快照只前移基线不重复压栈。
 *
 * 选型说明:未用 zundo temporal——图状态位于持久化 studio workflow
 * store 内,包整个 store 会把指纹/目标绑定/分片持久化拖进撤销域;
 * 画布层快照可精确圈定边界,且免新增依赖(并行会话占用 lockfile 窗口)。
 */
export interface UseCanvasHistoryOptions<T> {
  /** 从快照回放(只改画布视图模型,严禁触发副作用) */
  restore: (snapshot: T) => void;
  /** 基线读取(挂载/resetKey 变更时初始化用) */
  read: () => T;
  /** 快照等价判定(默认引用相等;不可变数据结构下足够) */
  equals?: (a: T, b: T) => boolean;
  /** 历史上限,默认 50 */
  capacity?: number;
  /** 防抖窗口 ms,默认 200 */
  debounceMs?: number;
  /** 变更即清史(如切换工作流),默认不清 */
  resetKey?: string | number;
}

export interface CanvasHistoryController<T> {
  /** 提交一份新快照(防抖合并;与当前基线等价则忽略) */
  commit: (next: T) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

export function useCanvasHistory<T>(options: UseCanvasHistoryOptions<T>): CanvasHistoryController<T> {
  const { restore, read, equals, capacity = 50, debounceMs = 200, resetKey } = options;
  const pastRef = useRef<T[]>([]);
  const futureRef = useRef<T[]>([]);
  const baselineRef = useRef<T>(read());
  const timerRef = useRef<number | null>(null);
  const restoreRef = useRef(restore);
  const equalsRef = useRef(equals);
  const [, bumpVersion] = useState(0);
  const rerender = useCallback(() => bumpVersion((version) => version + 1), []);

  restoreRef.current = restore;
  equalsRef.current = equals;

  const same = useCallback(
    (a: T, b: T) => (equalsRef.current ? equalsRef.current(a, b) : a === b),
    [],
  );

  const clearTimer = useCallback(() => {
    if (timerRef.current === null) return;
    window.clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  // resetKey 变更即清史(切换画布/工作流,历史不跨上下文)
  const resetKeyRef = useRef(resetKey);
  useEffect(() => {
    if (resetKeyRef.current === resetKey) return;
    resetKeyRef.current = resetKey;
    clearTimer();
    pastRef.current = [];
    futureRef.current = [];
    baselineRef.current = read();
    rerender();
  }, [clearTimer, read, resetKey, rerender]);

  useEffect(() => clearTimer, [clearTimer]);

  const commit = useCallback(
    (next: T) => {
      if (same(baselineRef.current, next)) return;
      if (timerRef.current === null) {
        // 突发首帧:变更前基线压栈,清 redo
        pastRef.current = [...pastRef.current.slice(-(capacity - 1)), baselineRef.current];
        futureRef.current = [];
        rerender();
      } else {
        window.clearTimeout(timerRef.current);
      }
      baselineRef.current = next;
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
      }, debounceMs);
    },
    [capacity, debounceMs, rerender, same],
  );

  const undo = useCallback(() => {
    if (pastRef.current.length === 0) return;
    clearTimer();
    futureRef.current = [...futureRef.current, baselineRef.current];
    baselineRef.current = pastRef.current[pastRef.current.length - 1];
    pastRef.current = pastRef.current.slice(0, -1);
    restoreRef.current(baselineRef.current);
    rerender();
  }, [clearTimer, rerender]);

  const redo = useCallback(() => {
    if (futureRef.current.length === 0) return;
    clearTimer();
    pastRef.current = [...pastRef.current, baselineRef.current];
    baselineRef.current = futureRef.current[futureRef.current.length - 1];
    futureRef.current = futureRef.current.slice(0, -1);
    restoreRef.current(baselineRef.current);
    rerender();
  }, [clearTimer, rerender]);

  return {
    commit,
    undo,
    redo,
    canUndo: pastRef.current.length > 0,
    canRedo: futureRef.current.length > 0,
  };
}

/** ⌘Z/⌘⇧Z(输入控件聚焦时不抢);两画布面共用同一入口 */
export function useCanvasHistoryShortcuts(options: {
  undo: () => void;
  redo: () => void;
}) {
  const { undo, redo } = options;
  const undoRef = useRef(undo);
  const redoRef = useRef(redo);
  undoRef.current = undo;
  redoRef.current = redo;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "z") return;
      const target = event.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      ) {
        return;
      }
      event.preventDefault();
      if (event.shiftKey) redoRef.current();
      else undoRef.current();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
