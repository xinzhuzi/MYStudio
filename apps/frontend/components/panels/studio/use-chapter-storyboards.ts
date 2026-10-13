import { useMemo } from "react";
import { useStudioStore } from "@/stores/studio/studio-store";
import { tryResolveProductionEpisodeId } from "./workflow-helpers";

/**
 * 本章分镜唯一口径(08-30 收敛:此前 useStudioViewModel 与 ImageWorkflowCanvas
 * 各写一份同公式,第三处复制已在路上)。生产章=最近一次剧本草稿所属章
 * (resolveProductionEpisodeId,updatedAt 最新,D7 单源;无草稿回落当前章
 * activeChapterId——D6,不再猜第 1 章),与分镜面板/导演规划同源;新消费方一律用本
 * hook,禁止再手写 filter,防跨章泄漏复发(切换器多章分镜事故的根)。
 */
export function useChapterStoryboards() {
  const storyboards = useStudioStore((state) => state.storyboards);
  const agentWorkData = useStudioStore((state) => state.agentWorkData);
  const novelChapters = useStudioStore((state) => state.novelChapters);
  const scriptPlans = useStudioStore((state) => state.scriptPlans);
  const activeChapterId = useStudioStore((state) => state.activeChapterId);
  return useMemo(
    () => {
      // D6:渲染面用安全变体——不可定位(空项目)沿用 episode-1 哨兵,过滤恒空。
      const productionEpisodeId = tryResolveProductionEpisodeId({ agentWorkData, novelChapters, scriptPlans, activeChapterId }) ?? "episode-1";
      return storyboards.filter((item) => item.episodeId === productionEpisodeId);
    },
    [storyboards, agentWorkData, novelChapters, scriptPlans, activeChapterId],
  );
}
