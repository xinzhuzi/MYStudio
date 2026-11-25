import { useCallback, useEffect, useRef, useState } from "react";
import { useProjectStore } from "@/stores/project/project-store";
import { useSelfMediaStore } from "@/stores/self-media/self-media-store";
import type { SelfMediaTask, SelfMediaTaskStatus } from "@/types/self-media";
import { getSelfMediaBridge } from "./view-helpers";

const TERMINAL_STATUSES: readonly SelfMediaTaskStatus[] = ["success", "failure", "partial", "audit", "canceled", "expired-login"];

/** 终态事件之后防抖重取任务列表的间隔(毫秒) */
const LEDGER_REFETCH_DEBOUNCE_MS = 500;

/**
 * L6(1125 二轮收尾): 把面板里三段互不相干的任务台账订阅收拢成一个 hook。
 *
 * - 进面板时拉任务列表并报日志损坏告警;
 * - 订阅进度事件:事件处理器只用事件里的状态和进度更新任务,保留现有的
 *   updatedAt(不再用渲染进程时钟盖写——盖了的话,重取回来的那条永远比渲染层
 *   现有的「旧」,合并规则会把它挡在外面,失败原因与结果链接就拿不回来);
 * - 任务进入终态后防抖 500ms 重取任务列表;重取结果不整体覆盖,逐条按
 *   updatedAt 比较,取来的不旧于现有的才写入;历史里的结束时间以合并后的为准。
 *
 * 返回日志损坏告警文案(无告警时为 null)。
 */
export function useSelfMediaLedger(activeProjectId: string | null): string | null {
  const upsertTask = useSelfMediaStore((state) => state.upsertTask);
  const [journalWarning, setJournalWarning] = useState<string | null>(null);
  const refetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** 逐条按 updatedAt 合并,取来的不旧于现有的才写入(更新的时间戳=更新的台账行) */
  const mergeFetchedTasks = useCallback((projectId: string, fetched: readonly SelfMediaTask[]) => {
    const store = useSelfMediaStore.getState();
    if (store.activeProjectId !== projectId || useProjectStore.getState().activeProjectId !== projectId) return;
    for (const task of fetched) {
      const existing = store.tasks.find((item) => item.id === task.id);
      if (existing && existing.updatedAt > task.updatedAt) continue;
      try {
        upsertTask(task);
      } catch {
        // 项目在拉取期间被切换:这批结果作废,放弃本次合并
        return;
      }
    }
  }, [upsertTask]);

  const refresh = useCallback(async (projectId: string | null) => {
    const bridge = getSelfMediaBridge();
    if (!bridge || !projectId) return;
    const reply = await bridge.listTasks({ projectId }).catch(() => undefined);
    if (!reply) return;
    if (useProjectStore.getState().activeProjectId === projectId) {
      setJournalWarning(reply.success ? null : reply.error.message);
    }
    if (!reply.success) return;
    mergeFetchedTasks(projectId, reply.value);
  }, [mergeFetchedTasks]);

  useEffect(() => {
    if (!activeProjectId) return;
    void refresh(activeProjectId).catch(() => undefined);
  }, [activeProjectId, refresh]);

  useEffect(() => {
    const bridge = getSelfMediaBridge();
    if (!bridge) return;
    return bridge.onProgress((event) => {
      const store = useSelfMediaStore.getState();
      const current = store.tasks.find((task) => task.id === event.taskId);
      if (!current || current.projectId !== event.projectId) return;
      // 只用事件里的状态和进度更新任务,保留现有的 updatedAt(不盖写)
      const next: SelfMediaTask = { ...current, status: event.status, progress: event.progress };
      try {
        upsertTask(next);
      } catch {
        return;
      }
      if (!TERMINAL_STATUSES.includes(event.status)) return;
      // 终态之后防抖重取,带回 error 详情与结果链接(以主进程台账为准)
      if (refetchTimer.current) clearTimeout(refetchTimer.current);
      const projectId = event.projectId;
      refetchTimer.current = setTimeout(() => {
        refetchTimer.current = null;
        void refresh(projectId).catch(() => undefined);
      }, LEDGER_REFETCH_DEBOUNCE_MS);
    });
  }, [refresh, upsertTask]);

  useEffect(() => () => {
    if (refetchTimer.current) clearTimeout(refetchTimer.current);
  }, []);

  return journalWarning;
}
