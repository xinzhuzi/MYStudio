import { useEffect, useState } from "react";
import type {
  RemotionCurrentSlotV1,
  RemotionRenderJobV1,
} from "@/types/remotion-workspace";

export interface RemotionQueueScopeState {
  jobs: RemotionRenderJobV1[];
  currentShotSlots: RemotionCurrentSlotV1[];
  loading: boolean;
  error?: string;
}

const EMPTY_SCOPE: RemotionQueueScopeState = {
  jobs: [],
  currentShotSlots: [],
  loading: false,
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
      if (showLoading) setState({ jobs: [], currentShotSlots: [], loading: true });
      try {
        const scope = await queue.get({ projectId, chapterId });
        if (disposed || version !== requestVersion) return;
        setState({ jobs: scope.jobs, currentShotSlots: scope.currentShotSlots, loading: false });
      } catch (error) {
        if (disposed || version !== requestVersion) return;
        setState({
          jobs: [],
          currentShotSlots: [],
          loading: false,
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
