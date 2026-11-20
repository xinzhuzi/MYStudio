/**
 * 分镜素材自动绑定的挂载侧(批4):读章/项目/视觉手册上下文,把
 * storyboard-asset-binding 的编排接成 StudioView 桥动作可调的 hook
 * (1120 面板退役:引擎节点按钮 auto-bind-assets → sidebarActions;
 * 批5 章验收卡横幅同源消费 useStoryboardBindingStore)。
 */
import { useCallback } from "react";
import { useProjectStore } from "@/stores/project/project-store";
import { useStudioStore } from "@/stores/studio/studio-store";
import {
  retryStoryboardBindingShot,
  runStoryboardAssetBinding,
  useStoryboardBindingStore,
} from "./storyboard-asset-binding";

export function useStoryboardAssetBinding(chapterStoryboards: Array<{ id: string; episodeId: string }>) {
  const chapterId = chapterStoryboards.find((item) => item.episodeId)?.episodeId ?? "";
  const run = useStoryboardBindingStore((state) => (chapterId ? state.runsByChapter[chapterId] : undefined));
  const clearRun = useStoryboardBindingStore((state) => state.clearRun);
  const projectId = useProjectStore((state) => state.activeProjectId);
  const visualManualId = useStudioStore((state) => state.workflowConfig.visualManualId);

  const start = useCallback(() => {
    if (!chapterId) return;
    void runStoryboardAssetBinding({
      chapterId,
      projectId,
      visualManualId,
    });
  }, [chapterId, projectId, visualManualId]);

  const retryShot = useCallback(
    (storyboardId: string) => {
      if (!chapterId) return;
      void retryStoryboardBindingShot({
        chapterId,
        projectId,
        visualManualId,
        storyboardId,
      });
    },
    [chapterId, projectId, visualManualId],
  );

  const clear = useCallback(() => {
    if (chapterId) clearRun(chapterId);
  }, [chapterId, clearRun]);

  return {
    chapterId,
    run,
    running: run?.status === "running",
    start,
    retryShot,
    clear,
  };
}
