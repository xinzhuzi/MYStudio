"use client";

// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

// 「任务」分区+球面徽章(09-12 orb-task-center R1/R2/R3):运行中任务清单+
// 最近终态折叠。可跳转条目(targetTab 在场)为 button,点击跳模块(R6,由
// 调用方注入跳转回调);无跳转目标为纯展示行。活跃条目超 8 条折叠为「+N 项」
// 尾注(批量生成不刷屏)。徽章 key=bumpTick,终态迁移闪动一次(motion key
// 重放,transform/opacity only,motion-reduce 全静);无任务不挂载(R1 零回归)。

import { motion, useReducedMotion } from "motion/react";
import { CheckCircle2, CircleDashed, Loader2, XCircle } from "lucide-react";
import { OrbSection, type OrbSectionProps } from "./OrbSection";
import type { OrbTaskView } from "./use-task-center";

const MAX_VISIBLE_ACTIVE = 8;

function TaskStatusIcon({ status }: { status: OrbTaskView["status"] }) {
  if (status === "success") {
    return <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-success" aria-hidden />;
  }
  if (status === "failed") {
    return <XCircle className="h-3.5 w-3.5 shrink-0 text-destructive" aria-hidden />;
  }
  if (status === "running") {
    return (
      <Loader2
        className="h-3.5 w-3.5 shrink-0 animate-spin text-info motion-reduce:animate-none"
        aria-hidden
      />
    );
  }
  return <CircleDashed className="h-3.5 w-3.5 shrink-0 text-warning" aria-hidden />;
}

function TaskRow({ task, onJump }: { task: OrbTaskView; onJump?: (tab: string) => void }) {
  const body = (
    <>
      <TaskStatusIcon status={task.status} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs text-foreground" title={task.label}>
          {task.label}
        </span>
        {task.status === "running" && typeof task.progress === "number" ? (
          <span className="mt-1 block h-1 w-full overflow-hidden rounded-full bg-muted">
            <span
              className="block h-full rounded-full bg-info transition-[width] duration-500 motion-reduce:transition-none"
              style={{ width: `${Math.round(task.progress * 100)}%` }}
            />
          </span>
        ) : null}
      </span>
    </>
  );

  if (task.targetTab && onJump) {
    return (
      <button
        type="button"
        data-orb-task-jump={task.id}
        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent motion-reduce:transition-none"
        onClick={() => onJump(task.targetTab!)}
      >
        {body}
      </button>
    );
  }
  return (
    <div
      data-orb-task-row={task.id}
      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left"
    >
      {body}
    </div>
  );
}

export function OrbTasksSection({
  active,
  recent,
  open,
  onToggle,
  onJump,
}: Pick<OrbSectionProps, "open" | "onToggle"> & {
  active: OrbTaskView[];
  recent: OrbTaskView[];
  onJump?: (tab: string) => void;
}) {
  if (active.length === 0 && recent.length === 0) return null;
  const visibleActive = active.slice(0, MAX_VISIBLE_ACTIVE);
  const overflow = active.length - visibleActive.length;
  return (
    <OrbSection section="tasks" title="任务" open={open} onToggle={onToggle}>
      {visibleActive.map((task) => (
        <TaskRow key={task.id} task={task} onJump={onJump} />
      ))}
      {overflow > 0 ? (
        <p className="px-2 py-1 text-[11px] text-muted-foreground">+{overflow} 项进行中</p>
      ) : null}
      {recent.length > 0 ? (
        <div className="mt-1 border-t border-border/60 pt-1" data-orb-task-recent>
          {recent.map((task) => (
            <TaskRow key={task.id} task={task} />
          ))}
        </div>
      ) : null}
    </OrbSection>
  );
}

/** 球面任务徽章(R1/R3):有活跃任务才挂载;终态迁移(bumpTick 变)以 motion key
 * 重放闪动一次,transform/opacity only,motion-reduce 不闪。count>99 显示 99+。 */
export function OrbTaskBadge({ count, bumpTick }: { count: number; bumpTick: number }) {
  const reduceMotion = useReducedMotion();
  if (count <= 0) return null;
  return (
    <span
      data-orb-task-badge
      aria-hidden
      className="absolute right-[3px] top-[3px] z-10 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold leading-none text-primary-foreground shadow-[0_1px_4px_rgba(0,0,0,0.4)]"
    >
      <motion.span
        key={bumpTick}
        initial={reduceMotion ? false : { scale: 1.45, opacity: 0.4 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: "spring", stiffness: 500, damping: 28 }}
        className="flex h-full w-full items-center justify-center"
      >
        {count > 99 ? "99+" : count}
      </motion.span>
    </span>
  );
}
