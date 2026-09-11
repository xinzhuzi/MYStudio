"use client";

// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export interface OrbSectionProps {
  /** 分区名,进 data-orb-section(如 "stages" | "views" | "goto")。 */
  section: string;
  /** 标题行文案(如「切换阶段」「本地模型」「导航」)。 */
  title: string;
  /** 受控开合;开合态由调用方持有——不持久化,面板重开回默认(收起)。 */
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}

/** 悬浮球面板折叠分区原语(09-10 裁定:分区默认收起,点标题行展开)。
 * 语义契约:收起=内容**条件渲染不进 DOM**(不是 CSS 藏)——保证脚本与真人
 * 路径一致,杜绝「querySelector 点得到、真人看不到」的假绿;
 * 标题行收起态恒在 DOM(面板摘要/smoke 文本锚依赖)。
 * 展开容器 role="group"+aria-label=标题,供无障碍与测试定位。 */
export function OrbSection({
  section,
  title,
  open,
  onToggle,
  children,
}: OrbSectionProps) {
  return (
    <div data-orb-section={section} data-state={open ? "open" : "closed"}>
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-[11px] font-medium uppercase tracking-wide text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <span>{title}</span>
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 shrink-0 transition-transform",
            open && "rotate-180",
          )}
          aria-hidden
        />
      </button>
      {open ? (
        <div role="group" aria-label={title} className="pt-0.5">
          {children}
        </div>
      ) : null}
    </div>
  );
}
