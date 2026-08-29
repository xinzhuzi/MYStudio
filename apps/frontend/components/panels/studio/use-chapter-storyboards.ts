import { useMemo } from "react";
import { useStudioStore } from "@/stores/studio/studio-store";
import { resolveProductionEpisodeId } from "./workflow-helpers";

/**
 * 本章分镜唯一口径(08-30 收敛:此前 useStudioViewModel 与 ImageWorkflowCanvas
 * 各写一份同公式,第三处复制已在路上)。生产章=最近一次剧本草稿所属章
 * (resolveProductionEpisodeId),与分镜面板/导演规划同源;新消费方一律用本
 * hook,禁止再手写 filter,防跨章泄漏复发(切换器多章分镜事故的根)。
 */
export function useChapterStoryboards() {
  const storyboards = useStudioStore((state) => state.storyboards);
  const agentWorkData = useStudioStore((state) => state.agentWorkData);
  const novelChapters = useStudioStore((state) => state.novelChapters);
  const scriptPlans = useStudioStore((state) => state.scriptPlans);
  return useMemo(
    () => {
      const productionEpisodeId = resolveProductionEpisodeId({ agentWorkData, novelChapters, scriptPlans });
      return storyboards.filter((item) => item.episodeId === productionEpisodeId);
    },
    [storyboards, agentWorkData, novelChapters, scriptPlans],
  );
}
