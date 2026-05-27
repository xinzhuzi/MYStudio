"use client";

import { SidebarToggleButton } from "@/components/ChromeControls";
import { LocalTtsPanel } from "@/components/panels/tts/LocalTtsPanel";
import { Mic2 } from "lucide-react";

interface TTSViewProps {
  sidebarCollapsed?: boolean;
  onToggleSidebar?: () => void;
}

export function TTSView({
  sidebarCollapsed = false,
  onToggleSidebar,
}: TTSViewProps) {
  return (
    <div className="tts-workspace flex h-full flex-col overflow-hidden bg-background">
      <div className="h-16 shrink-0 border-b border-border bg-panel px-6 flex items-center justify-between">
        <div className="flex items-center gap-4">
          {sidebarCollapsed && onToggleSidebar && (
            <SidebarToggleButton
              sidebarCollapsed
              onToggleSidebar={onToggleSidebar}
            />
          )}
          <h2 className="text-lg font-bold text-foreground flex items-center gap-3">
            <Mic2 className="h-5 w-5 text-primary" />
            TTS 口播
          </h2>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        <LocalTtsPanel />
      </div>
    </div>
  );
}
