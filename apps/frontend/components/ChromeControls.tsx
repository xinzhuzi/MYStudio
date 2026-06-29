// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
import * as React from "react";
import { ArrowLeft, ArrowRight, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { cn } from "@/lib/utils";

interface SidebarToggleButtonProps {
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
  className?: string;
}

interface ChromeControlsProps {
  onBack?: () => void;
  onForward?: () => void;
  canGoBack?: boolean;
  canGoForward?: boolean;
  className?: string;
}

export const SidebarToggleButton = React.forwardRef<HTMLButtonElement, SidebarToggleButtonProps>(
  ({ sidebarCollapsed, onToggleSidebar, className }, ref) => {
    const SidebarIcon = sidebarCollapsed ? PanelLeftOpen : PanelLeftClose;

    return (
      <button
        ref={ref}
        type="button"
        className={cn("chrome-control-button", className)}
        onClick={onToggleSidebar}
        aria-label={sidebarCollapsed ? "显示侧栏" : "隐藏侧栏"}
        title={sidebarCollapsed ? "显示侧栏" : "隐藏侧栏"}
      >
        <SidebarIcon className="h-4 w-4" />
      </button>
    );
  },
);
SidebarToggleButton.displayName = "SidebarToggleButton";

export function ChromeControls({
  onBack,
  onForward,
  canGoBack = false,
  canGoForward = false,
  className,
}: ChromeControlsProps) {
  return (
    <div className={cn("chrome-controls", className)}>
      <button
        type="button"
        className="chrome-control-button"
        onClick={onBack}
        disabled={!canGoBack}
        aria-label="返回"
        title="返回"
      >
        <ArrowLeft className="h-5 w-5" />
      </button>
      <button
        type="button"
        className="chrome-control-button"
        onClick={onForward}
        disabled={!canGoForward}
        aria-label="前进"
        title="前进"
      >
        <ArrowRight className="h-5 w-5" />
      </button>
    </div>
  );
}
