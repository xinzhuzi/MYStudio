// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. COMMERCIAL_LICENSE.md.
"use client";

import { forwardRef } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "../../lib/utils";
import { IconTile } from "./icon-tile";

export interface PanelHeaderProps
  extends Omit<React.HTMLAttributes<HTMLElement>, "title"> {
  icon?: LucideIcon;
  /** 图标瓦色调,默认 primary */
  tone?: "primary" | "success" | "warning" | "destructive";
  /** 标题上方小号大写字距行(如引擎名) */
  overline?: string;
  title: React.ReactNode;
  /** 右侧状态位,通常放 StatusPill */
  badge?: React.ReactNode;
}

/**
 * 面板页头(design-spec.md 排版档位之 页标题+overline;母版=MusicTab header)。
 * 结构:图标瓦 + (overline → 大标题) + 右侧徽位,窄屏自动换行。
 */
export const PanelHeader = forwardRef<HTMLElement, PanelHeaderProps>(
  ({ icon, tone, overline, title, badge, className, ...props }, ref) => (
    <header
      ref={ref}
      className={cn("flex flex-wrap items-start justify-between gap-4", className)}
      {...props}
    >
      <div className="flex min-w-0 items-start gap-3.5">
        {icon ? <IconTile icon={icon} tone={tone} /> : null}
        <div className="min-w-0 space-y-1.5">
          {overline ? (
            <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
              {overline}
            </p>
          ) : null}
          <h1 className="truncate text-2xl font-semibold tracking-tight text-foreground">
            {title}
          </h1>
        </div>
      </div>
      {badge}
    </header>
  ),
);
PanelHeader.displayName = "PanelHeader";
