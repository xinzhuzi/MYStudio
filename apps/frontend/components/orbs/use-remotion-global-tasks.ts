// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

// Remotion 渲染队列的全局任务视图(09-12 orb-task-center):悬浮球不依赖任何
// chapter 视图挂载,直接订阅 window.remotionQueue.onJob(身份+status 通知)。
// 取舍(design 已裁):通知不带进度,一期=状态徽标,不做章节作用域 get 轮询;
// 挂载前已在跑的任务要等下一次状态迁移才可见(onJob 只推变更),已知限制。

import { useEffect, useState } from "react";
import type { OrbTaskStatus, OrbTaskView } from "./use-task-center";

const EMPTY: OrbTaskView[] = [];

/** 队列阶段状态 → 球任务状态;pre-queue 规划态(pending/blocked/ready/stale)不入列,
 * canceled=用户主动放弃,从活跃集移除且不进完成提醒。 */
function mapRemotionStatus(
  status: string,
): OrbTaskStatus | "ignore" | "remove" {
  switch (status) {
    case "queued":
      return "queued";
    case "running":
      return "running";
    case "succeeded":
      return "success";
    case "failed":
      return "failed";
    case "canceled":
      return "remove";
    default:
      return "ignore";
  }
}

interface RemotionJobNotificationLike {
  jobId: string;
  chapterId: string;
  status: string;
}

export function useRemotionGlobalTasks(): OrbTaskView[] {
  const [views, setViews] = useState<OrbTaskView[]>(EMPTY);

  useEffect(() => {
    const queue = (
      window as Window & {
        remotionQueue?: {
          onJob?: (
            listener: (notification: RemotionJobNotificationLike) => void,
          ) => () => void;
        };
      }
    ).remotionQueue;
    if (!queue || typeof queue.onJob !== "function") return;

    const jobs = new Map<string, OrbTaskView>();
    const unsubscribe = queue.onJob((notification) => {
      if (!notification?.jobId) return;
      const mapped = mapRemotionStatus(notification.status);
      if (mapped === "ignore") return;
      if (mapped === "remove") {
        jobs.delete(notification.jobId);
      } else {
        jobs.set(notification.jobId, {
          id: `remotion:${notification.jobId}`,
          source: "remotion",
          label: `成片渲染 · ${notification.chapterId || "章节"}`,
          status: mapped,
          targetTab: "studio",
        });
      }
      setViews(
        jobs.size === 0
          ? EMPTY
          : [...jobs.values()].sort((a, b) => a.id.localeCompare(b.id)),
      );
    });
    return unsubscribe;
  }, []);

  return views;
}
