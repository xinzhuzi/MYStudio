"use client";

import { lazy, Suspense } from "react";
import { SidebarToggleButton } from "@/components/ChromeControls";
import { Loader2, Mic2 } from "lucide-react";

const LocalTtsPanel = lazy(() => import("@/components/panels/tts/LocalTtsPanel").then((m) => ({ default: m.LocalTtsPanel })));

interface TTSViewProps {
  sidebarCollapsed?: boolean;
  onToggleSidebar?: () => void;
}

export function TTSView({
  sidebarCollapsed = false,
  onToggleSidebar,
}: TTSViewProps) {
  return (
    <div className="tts-workspace flex h-full flex-col overflow-hidden">
      <div className="tts-topbar h-16 shrink-0 border-b border-border px-6 flex items-center justify-between">
        <div className="flex items-center gap-4">
          {onToggleSidebar && (
            <SidebarToggleButton
              sidebarCollapsed={sidebarCollapsed}
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
        <Suspense fallback={<div className="flex h-full items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>}>
          <LocalTtsPanel />
        </Suspense>
      </div>
    </div>
  );
}
