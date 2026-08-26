import { useEffect, useState } from "react";
import type {
  RemotionCurrentSlotV1,
  RemotionRenderJobV1,
} from "@/types/remotion-workspace";

export interface RemotionQueueScopeState {
  jobs: RemotionRenderJobV1[];
  currentShotSlots: RemotionCurrentSlotV1[];
  loading: boolean;
  /** True only after the desktop queue scope has answered for this chapter. */
  loaded: boolean;
  /** 队列并发槽数(硬件感知,面板标签展示);旧 preload 缺省 1。 */
  concurrency: number;
  error?: string;
}

const EMPTY_SCOPE: RemotionQueueScopeState = {
  jobs: [],
  currentShotSlots: [],
  loading: false,
  loaded: false,
  concurrency: 1,
};

/**
 * Renderer-safe projection of the main-process queue for exactly one
 * project/chapter. Notifications only carry identity/status, so every event
 * is followed by a scoped get instead of mutating a guessed global store.
 */
export function useRemotionQueueScope(
  projectId: string | undefined,
  chapterId: string,
): RemotionQueueScopeState {
  const [state, setState] = useState<RemotionQueueScopeState>(EMPTY_SCOPE);

  useEffect(() => {
    let disposed = false;
    let requestVersion = 0;
    const queue = typeof window === "undefined" ? undefined : window.remotionQueue;
    if (!projectId || !queue?.get) {
      setState(EMPTY_SCOPE);
      return;
    }

    const load = async (showLoading = false) => {
      const version = ++requestVersion;
      if (showLoading) setState({ ...EMPTY_SCOPE, loading: true });
      try {
        const scope = await queue.get({ projectId, chapterId });
        if (disposed || version !== requestVersion) return;
        setState({
          jobs: scope.jobs,
          currentShotSlots: scope.currentShotSlots,
          loading: false,
          loaded: true,
          concurrency: scope.concurrency ?? 1,
        });
      } catch (error) {
        if (disposed || version !== requestVersion) return;
        setState({
          ...EMPTY_SCOPE,
          loaded: true,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    };

    void load(true);
    const unsubscribe = queue.onJob?.((notification) => {
      if (notification.projectId !== projectId || notification.chapterId !== chapterId) return;
      void load(false);
    });
    return () => {
      disposed = true;
      requestVersion += 1;
      unsubscribe?.();
    };
  }, [chapterId, projectId]);

  return state;
}
