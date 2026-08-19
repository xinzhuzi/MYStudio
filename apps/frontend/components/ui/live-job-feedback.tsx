// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. COMMERCIAL_LICENSE.md.
"use client";

import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { cn } from "../../lib/utils";

export interface LiveJobFeedbackProps extends React.HTMLAttributes<HTMLDivElement> {
  /** 任务进行中=true 时均衡器动 + 计时走;false 渲染静态弱化(不隐藏) */
  active: boolean;
  /** 已进行文案前缀,默认「已进行」;传空串隐藏 */
  prefix?: string;
  /** 起始毫秒时间戳(默认组件挂载时刻);用于跨组件共享同一任务的起点 */
  startedAt?: number;
}

function formatElapsed(startedAt: number): string {
  const total = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/**
 * 长任务活反馈(design-spec.md 反馈四类之「进行中」;母版=MusicTab 生成台):
 * 五条交错相位均衡器 + 每秒已进行计时——分钟级任务没有进度回传时的诚实代理。
 * useReducedMotion 全守卫:减动效时退化为静态条。
 */
export function LiveJobFeedback({
  active,
  prefix = "已进行",
  startedAt,
  className,
  ...props
}: LiveJobFeedbackProps) {
  const reduced = useReducedMotion();
  const origin = startedAt ?? Date.now();
  const [elapsed, setElapsed] = useState(() => formatElapsed(origin));

  useEffect(() => {
    if (!active) return;
    setElapsed(formatElapsed(origin));
    const timer = window.setInterval(() => setElapsed(formatElapsed(origin)), 1000);
    return () => window.clearInterval(timer);
  }, [active, origin]);

  return (
    <div className={cn("flex items-center gap-3", className)} {...props}>
      <div className="flex h-6 items-end gap-[3px]" aria-hidden>
        {[0, 1, 2, 3, 4].map((index) =>
          reduced || !active ? (
            <span key={index} className="w-[3px] rounded-full bg-primary/50" style={{ height: 6 + ((index * 5) % 14) }} />
          ) : (
            <motion.span
              key={index}
              className="w-[3px] rounded-full bg-primary/70"
              initial={{ height: 6 }}
              animate={{ height: [6, 20 - ((index * 3) % 9), 10, 18 - (index % 5) * 2, 6] }}
              transition={{ duration: 1.1 + index * 0.13, repeat: Infinity, ease: "easeInOut" }}
            />
          ),
        )}
      </div>
      {prefix !== "" && (
        <span className="font-mono text-xs text-muted-foreground">
          {prefix} {elapsed}
        </span>
      )}
    </div>
  );
}
