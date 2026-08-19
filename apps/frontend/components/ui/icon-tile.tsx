// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. COMMERCIAL_LICENSE.md.
"use client";

import { forwardRef } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "../../lib/utils";

export interface IconTileProps extends React.HTMLAttributes<HTMLDivElement> {
  icon: LucideIcon;
  size?: "sm" | "md";
  tone?: "primary" | "success" | "warning" | "destructive";
}

const TONE_CLASSES: Record<NonNullable<IconTileProps["tone"]>, string> = {
  primary: "border-primary/20 bg-primary/10 text-primary",
  success: "border-success/25 bg-success/10 text-success",
  warning: "border-warning/25 bg-warning/10 text-warning",
  destructive: "border-destructive/25 bg-destructive/[0.08] text-destructive/90",
};

/**
 * 着色图标瓦(design-spec.md 图标规范;母版=MusicTab 页头瓦 h-11 rounded-xl)。
 */
export const IconTile = forwardRef<HTMLDivElement, IconTileProps>(
  ({ icon: Icon, size = "md", tone = "primary", className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "flex shrink-0 items-center justify-center",
        size === "md" ? "h-11 w-11 rounded-xl" : "h-9 w-9 rounded-lg",
        TONE_CLASSES[tone],
        className,
      )}
      {...props}
    >
      <Icon className={size === "md" ? "h-5 w-5" : "h-4 w-4"} aria-hidden />
    </div>
  ),
);
IconTile.displayName = "IconTile";
