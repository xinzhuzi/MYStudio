/**
 * 章级流水线编排 hook(10-11 pipeline-human-node-automation 批5,design §2.6):
 * 编排执行体在 chapter-pipeline.ts(串批2→批3→批4+步间门+验收卡),本 hook 负责
 * 三件挂载侧的事:
 * 1. 触发=事件分析完成或手动(design §2.6):本章 eventTaskState running→success
 *    迁移即自动发车(首挂只记录不发射,同 orb 迁移 diff 口径);手动=start();
 * 2. 断点续跑(G9):挂载即 recomputeChapterPipelineAggregate——从落盘任务台账
 *    重算聚合卡+僵尸任务收口,不重发已 terminal 任务;
 * 3. 横幅实况 stale(批6):订阅剧本指纹输入切片+台账,剧本变更即时的 stale
 *    下游任务派生(章验收卡里的 staleCount 是发车时刻快照,横幅用实况)。
 */
import { useCallback, useEffect, useMemo, useRef } from "react";
import { useStudioStore } from "@/stores/studio/studio-store";
import {
  collectStaleDownstreamTasks,
  useChapterUpstreamStore,
  type StaleMediaTaskView,
} from "./chapter-pipeline-stale";
import {
  recomputeChapterPipelineAggregate,
  runChapterPipeline,
  useChapterPipelineStore,
  type ChapterAcceptanceCard,
  type ChapterPipelineRunView,
} from "./chapter-pipeline";

export function useChapterPipelineOrchestrator({
  chapterId,
  projectId,
  visualManualId,
}: {
  chapterId: string;
  /** 视图模型口径是 activeProject?.id(string|undefined),null/undefined 归一为 null。 */
  projectId: string | null | undefined;
  visualManualId: string | undefined;
}) {
  const run = useChapterPipelineStore((state) =>
    chapterId ? state.runsByChapter[chapterId] : undefined,
  );
  const clearRun = useChapterPipelineStore((state) => state.clearRun);

  const start = useCallback(() => {
    if (!chapterId) return;
    void runChapterPipeline({ chapterId, projectId: projectId ?? null, visualManualId });
  }, [chapterId, projectId, visualManualId]);

  const clear = useCallback(() => {
    if (chapterId) clearRun(chapterId);
  }, [chapterId, clearRun]);

  // ── 断点续跑:挂载即重算聚合(重启恢复;不重发) ──
  useEffect(() => {
    if (!chapterId) return;
    recomputeChapterPipelineAggregate(chapterId);
  }, [chapterId]);

  // ── 触发=事件分析完成(本章):running→success 迁移即发车 ──
  const novelChapters = useStudioStore((state) => state.novelChapters);
  const startRef = useRef(start);
  startRef.current = start;
  const prevEventStatesRef = useRef<Map<string, string>>(new Map());
  useEffect(() => {
    const prev = prevEventStatesRef.current;
    for (const chapter of novelChapters) {
      const previous = prev.get(chapter.id);
      const current = chapter.eventTaskState ?? "";
      // 首帧只记录不发射;迁移 running→success 且是本章才触发
      if (
        previous === "running" &&
        current === "success" &&
        chapter.id === chapterId
      ) {
        startRef.current();
      }
    }
    prevEventStatesRef.current = new Map(
      novelChapters.map((chapter) => [chapter.id, chapter.eventTaskState ?? ""]),
    );
  }, [novelChapters, chapterId]);

  // ── 批6 横幅实况:剧本指纹漂移 → 本章已终态下游任务 stale(黄标数据面) ──
  const agentWorkData = useStudioStore((state) => state.agentWorkData);
  const scriptPlans = useStudioStore((state) => state.scriptPlans);
  const mediaTasks = useStudioStore((state) => state.mediaTasks);
  const upstreamByChapter = useChapterUpstreamStore((state) => state.byChapter);
  const staleTasks = useMemo<StaleMediaTaskView[]>(
    () =>
      chapterId
        ? collectStaleDownstreamTasks({
            chapterId,
            mediaTasks,
            snapshot: { agentWorkData, novelChapters, scriptPlans },
            ledger: upstreamByChapter,
          })
        : [],
    [chapterId, mediaTasks, agentWorkData, novelChapters, scriptPlans, upstreamByChapter],
  );

  return {
    chapterId,
    run,
    card: run?.card as ChapterAcceptanceCard | undefined,
    running: run?.status === "running",
    start,
    clear,
    staleTasks,
  } satisfies {
    chapterId: string;
    run: ChapterPipelineRunView | undefined;
    card: ChapterAcceptanceCard | undefined;
    running: boolean;
    start: () => void;
    clear: () => void;
    staleTasks: StaleMediaTaskView[];
  };
}
