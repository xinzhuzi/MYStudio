import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { useProjectStore } from "@/stores/project/project-store";
import { useStudioStore } from "@/stores/studio/studio-store";

export interface BgmOrigin {
  readonly projectId: string;
  readonly chapterId: string;
  isCurrent: () => boolean;
  assertCurrent: () => void;
}

/** Store subscriptions latch even a batched A → B → A before React renders. */
export function useBgmOrigin(projectId: string | undefined, chapterId: string) {
  const epoch = useRef(0);
  const operation = useRef(0);
  const mounted = useRef(false);
  const [version, setVersion] = useState(0);

  useLayoutEffect(() => {
    mounted.current = true;
    const invalidate = () => {
      epoch.current += 1;
      setVersion((current) => current + 1);
    };
    const unsubscribeProject = useProjectStore.subscribe((state, previous) => {
      if (state.activeProjectId !== previous.activeProjectId) invalidate();
    });
    const unsubscribeChapter = useStudioStore.subscribe((state, previous) => {
      if (state.activeChapterId !== previous.activeChapterId) invalidate();
    });
    return () => {
      mounted.current = false;
      epoch.current += 1;
      unsubscribeProject();
      unsubscribeChapter();
    };
  }, []);

  useLayoutEffect(() => {
    epoch.current += 1;
    setVersion((current) => current + 1);
  }, [projectId, chapterId]);

  const capture = useCallback((): BgmOrigin => {
    const capturedEpoch = epoch.current;
    const isCurrent = () => mounted.current && capturedEpoch === epoch.current && Boolean(projectId);
    return {
      projectId: projectId ?? "",
      chapterId,
      isCurrent,
      assertCurrent: () => {
        if (!isCurrent()) throw new Error("项目或章节已切换,本次 BGM 操作已停止回写");
      },
    };
  }, [chapterId, projectId]);

  const begin = useCallback((): BgmOrigin => {
    const origin = capture();
    const id = ++operation.current;
    const isCurrent = () => origin.isCurrent() && id === operation.current
      && useProjectStore.getState().activeProjectId === origin.projectId;
    return {
      ...origin,
      isCurrent,
      assertCurrent: () => {
        if (!isCurrent()) throw new Error("项目或章节已切换,本次 BGM 操作已停止回写");
      },
    };
  }, [capture]);

  return { capture, begin, version };
}
