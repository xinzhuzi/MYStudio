// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. COMMERCIAL_LICENSE.md.
"use client";

import { forwardRef } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "../../lib/utils";

export type StatusPillState = "ready" | "checking" | "missing" | "unknown";

const DEFAULT_LABELS: Record<StatusPillState, string> = {
  ready: "就绪",
  checking: "检查中…",
  missing: "未就绪",
  unknown: "状态未知",
};

export interface StatusPillProps extends React.HTMLAttributes<HTMLSpanElement> {
  state: StatusPillState;
  /** 覆盖默认文案(如「引擎就绪」);不传用四态默认 */
  label?: string;
}

/**
 * 状态胶囊四态(design-spec.md 反馈四类之 status;母版=MusicTab ReadinessBadge)。
 * ready=success 着色+呼吸点(motion-safe);checking=spinner;missing=destructive;unknown=muted。
 */
export const StatusPill = forwardRef<HTMLSpanElement, StatusPillProps>(
  ({ state, label, className, ...props }, ref) => {
    const text = label ?? DEFAULT_LABELS[state];
    if (state === "ready") {
      return (
        <span
          ref={ref}
          className={cn(
            "inline-flex shrink-0 items-center gap-2 rounded-full border border-success/25 bg-success/10 px-3 py-1.5 text-xs font-medium text-success",
            className,
          )}
          {...props}
        >
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full rounded-full bg-success opacity-50 motion-safe:animate-ping" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-success" />
          </span>
          {text}
        </span>
      );
    }
    if (state === "missing") {
      return (
        <span
          ref={ref}
          className={cn(
            "inline-flex shrink-0 items-center gap-2 rounded-full border border-destructive/25 bg-destructive/[0.08] px-3 py-1.5 text-xs font-medium text-destructive/90",
            className,
          )}
          {...props}
        >
          <span className="h-2 w-2 rounded-full bg-destructive" aria-hidden />
          {text}
        </span>
      );
    }
    if (state === "checking") {
      return (
        <span
          ref={ref}
          className={cn(
            "inline-flex shrink-0 items-center gap-2 rounded-full border border-border bg-card/70 px-3 py-1.5 text-xs text-muted-foreground backdrop-blur-sm",
            className,
          )}
          {...props}
        >
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          {text}
        </span>
      );
    }
    return (
      <span
        ref={ref}
        className={cn(
          "inline-flex shrink-0 items-center gap-2 rounded-full border border-border bg-card/70 px-3 py-1.5 text-xs text-muted-foreground backdrop-blur-sm",
          className,
        )}
        {...props}
      >
        {text}
      </span>
    );
  },
);
StatusPill.displayName = "StatusPill";
