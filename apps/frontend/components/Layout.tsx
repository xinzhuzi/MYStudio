// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
import { lazy, Suspense, useLayoutEffect, useRef, useState } from "react";
import { TabBar } from "./TabBar";
import { Dashboard } from "./Dashboard";
import { ProjectHeader } from "./ProjectHeader";
// Split-panel-only chrome — only rendered inside a project (never on the
// Dashboard first screen). Lazy-loaded so the entry stays small; RightPanel in
// particular pulls in director/context-panel code that has no place on boot.
const PreviewPanel = lazy(() =>
  import("./PreviewPanel").then((m) => ({ default: m.PreviewPanel })),
);
const RightPanel = lazy(() =>
  import("./RightPanel").then((m) => ({ default: m.RightPanel })),
);
const SimpleTimeline = lazy(() =>
  import("./SimpleTimeline").then((m) => ({ default: m.SimpleTimeline })),
);
import { useMediaPanelStore } from "@/stores/navigation/media-panel-store";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";

// Panel imports — code-split so the first screen (Dashboard) doesn't pay for
// every panel. Each panel becomes its own chunk, loaded on first activation.
const MusicPanel = lazy(() =>
  import("@/components/panels/music").then((m) => ({ default: m.MusicPanel })),
);
const ScriptView = lazy(() =>
  import("@/components/panels/script").then((m) => ({ default: m.ScriptView })),
);
const DirectorView = lazy(() =>
  import("@/components/panels/director").then((m) => ({ default: m.DirectorView })),
);
const SClassView = lazy(() =>
  import("@/components/panels/sclass").then((m) => ({ default: m.SClassView })),
);
const CharactersView = lazy(() =>
  import("@/components/panels/characters").then((m) => ({ default: m.CharactersView })),
);
const ScenesView = lazy(() =>
  import("@/components/panels/scenes").then((m) => ({ default: m.ScenesView })),
);
const FreedomView = lazy(() =>
  import("@/components/panels/assist").then((m) => ({ default: m.FreedomView })),
);
const MediaView = lazy(() =>
  import("@/components/panels/media").then((m) => ({ default: m.MediaView })),
);
const ArtifactCenter = lazy(() =>
  import("@/components/panels/media/ArtifactCenter").then((m) => ({ default: m.ArtifactCenter })),
);
const SettingsPanel = lazy(() =>
  import("@/components/panels/SettingsPanel").then((m) => ({ default: m.SettingsPanel })),
);
const ExportView = lazy(() =>
  import("@/components/panels/export").then((m) => ({ default: m.ExportView })),
);
const OverviewPanel = lazy(() =>
  import("@/components/panels/overview").then((m) => ({ default: m.OverviewPanel })),
);
const AssetsView = lazy(() =>
  import("@/components/panels/assets").then((m) => ({ default: m.AssetsView })),
);
const StudioView = lazy(() =>
  import("@/components/panels/studio").then((m) => ({ default: m.StudioView })),
);
const SkillsView = lazy(() =>
  import("@/components/panels/skills").then((m) => ({ default: m.SkillsView })),
);
const SelfMediaPanel = lazy(() =>
  import("@/components/panels/self-media").then((m) => ({ default: m.SelfMediaPanel })),
);

// Minimal fallback shown while a lazy panel chunk loads. Local (Electron
// file://) loads are near-instant, so this only flashes on first navigation.
function PanelFallback() {
  return (
    <div className="h-full w-full flex items-center justify-center text-muted-foreground/60 text-sm">
      <span className="animate-pulse">加载中…</span>
    </div>
  );
}

export function Layout() {
  const {
    activeTab,
    inProject,
    settingsTabRequest,
    clearSettingsTabRequest,
  } = useMediaPanelStore();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);
  const previousInProjectRef = useRef(inProject);
  const toggleSidebar = () => setSidebarCollapsed((collapsed) => !collapsed);
  // 重型面板懒挂载：首次激活后保持挂载，用 hidden 切换
  const [mountedTabs, setMountedTabs] = useState<Set<string>>(new Set());

  useLayoutEffect(() => {
    if (activeTab === "assets" || activeTab === "skills") {
      setMountedTabs((prev) => {
        if (prev.has(activeTab)) return prev;
        const next = new Set(prev);
        next.add(activeTab);
        return next;
      });
    }
  }, [activeTab]);

  useLayoutEffect(() => {
    if (!previousInProjectRef.current && inProject) {
      setSidebarCollapsed(true);
    }
    previousInProjectRef.current = inProject;
  }, [inProject]);

  // Dashboard mode - show full-screen dashboard or settings
  if (!inProject) {
    return (
      <>
        <TabBar sidebarCollapsed={sidebarCollapsed} onToggleSidebar={toggleSidebar} />
        <div className="studio-shell h-full bg-background">
          <div className="studio-main h-full">
            <Suspense fallback={<PanelFallback />}>
              <div key={activeTab} className="cinematic-route h-full min-h-0">
                {activeTab === "settings" ? (
                  <SettingsPanel
                    sidebarCollapsed={sidebarCollapsed}
                    onToggleSidebar={toggleSidebar}
                    showHomeChrome
                    initialTab={settingsTabRequest ?? undefined}
                    onInitialTabConsumed={clearSettingsTabRequest}
                  />
                ) : (
                  <Dashboard
                    sidebarCollapsed={sidebarCollapsed}
                    onToggleSidebar={toggleSidebar}
                  />
                )}
              </div>
            </Suspense>
          </div>
        </div>
      </>
    );
  }

  // Full-screen views (no resizable panels)
  // 这些板块有自己的多栏布局，不需要全局的预览和属性面板
  const fullScreenTabs = ["export", "settings", "overview", "studio", "music", "script", "characters", "scenes", "freedom", "assets", "skills", "self-media", "media"];
  if (fullScreenTabs.includes(activeTab)) {
    return (
      <>
        <TabBar sidebarCollapsed={sidebarCollapsed} onToggleSidebar={toggleSidebar} />
        <div className="studio-shell h-full flex flex-col bg-background">
          <ProjectHeader
            sidebarCollapsed={sidebarCollapsed}
            onToggleSidebar={toggleSidebar}
          />
          <div className="flex flex-1 min-h-0">
            <div className="studio-main flex-1 min-w-0 flex flex-col overflow-hidden">
              <Suspense fallback={<PanelFallback />}>
              <div key={activeTab} className="cinematic-route flex-1 h-full min-h-0 overflow-hidden">
              {activeTab === "export" && <ExportView />}
              {activeTab === "settings" && (
                <SettingsPanel
                  sidebarCollapsed={sidebarCollapsed}
                  onToggleSidebar={toggleSidebar}
                  initialTab={settingsTabRequest ?? undefined}
                  onInitialTabConsumed={clearSettingsTabRequest}
                />
              )}
              {activeTab === "overview" && <OverviewPanel />}
              {activeTab === "music" && <MusicPanel />}
              {activeTab === "studio" && <StudioView />}
              {activeTab === "script" && <ScriptView />}
              {activeTab === "characters" && <CharactersView />}
              {activeTab === "scenes" && <ScenesView />}
              {activeTab === "freedom" && <FreedomView />}
              {activeTab === "self-media" && <SelfMediaPanel />}
              {activeTab === "media" && <ArtifactCenter />}
              {/* 重型面板：懒挂载 + hidden 保活 */}
              {mountedTabs.has("assets") && <div className={activeTab === "assets" ? "h-full" : "hidden"}><AssetsView /></div>}
              {mountedTabs.has("skills") && <div className={activeTab === "skills" ? "h-full" : "hidden"}><SkillsView sidebarCollapsed={sidebarCollapsed} onToggleSidebar={toggleSidebar} /></div>}
            </div>
              </Suspense>
          </div>
        </div>
      </div>
      </>
    );
  }

  // Only show timeline for director and media tabs
  const showTimeline = activeTab === "director" || activeTab === "sclass" || activeTab === "media";

  // Left panel content based on active tab
  const renderLeftPanel = () => {
    switch (activeTab) {
      case "script":
        return <ScriptView />;
      case "director":
        // 保持原有 AI 导演功能
        return <DirectorView />;
      case "sclass":
        return <SClassView />;
      case "characters":
        return <CharactersView />;
      case "scenes":
        return <ScenesView />;
      case "media":
        return <MediaView />;
      case "settings":
        return <SettingsPanel />;
      default:
        return <ScriptView />;
    }
  };

  // Right panel content based on active tab
  const renderRightPanel = () => {
    return <RightPanel />;
  };

  return (
    <>
    <TabBar sidebarCollapsed={sidebarCollapsed} onToggleSidebar={toggleSidebar} />
    <div className="studio-shell h-full flex flex-col bg-background">
        <ProjectHeader
          sidebarCollapsed={sidebarCollapsed}
          onToggleSidebar={toggleSidebar}
        />

      <Suspense fallback={<PanelFallback />}>
      <div className="flex flex-1 min-h-0">
        {/* Right content area */}
        <div className="studio-main flex-1 min-w-0 flex flex-col">
          {/* Main content with resizable panels */}
          <ResizablePanelGroup direction="vertical" className="flex-1 min-h-0 min-w-0">
        {/* Main content row */}
        <ResizablePanel defaultSize={85} minSize={50} className="min-h-0 min-w-0">
          <ResizablePanelGroup direction="horizontal" className="min-h-0 min-w-0">
            {/* Left Panel: Content based on active tab */}
            <ResizablePanel defaultSize={26} minSize={18} maxSize={40} className="min-w-0">
              <div className="cinematic-route studio-panel-frame h-full min-w-0 overflow-hidden bg-panel border-r border-border">
                <Suspense fallback={<PanelFallback />}>{renderLeftPanel()}</Suspense>
              </div>
            </ResizablePanel>

            <ResizableHandle />

            {/* Center: Preview */}
            <ResizablePanel defaultSize={54} minSize={28} className="min-w-0">
              <div className="cinematic-route studio-preview-frame h-full min-w-0 overflow-hidden">
                <PreviewPanel />
              </div>
            </ResizablePanel>

            <ResizableHandle />

            {/* Right: Properties */}
            <ResizablePanel defaultSize={20} minSize={15} maxSize={32} className="min-w-0">
              <div className="cinematic-route studio-panel-frame h-full min-w-0 overflow-hidden border-l border-border">
                {renderRightPanel()}
              </div>
            </ResizablePanel>
          </ResizablePanelGroup>
        </ResizablePanel>

          {/* Bottom: Timeline - only for director and media tabs */}
          {showTimeline && (
            <>
              <ResizableHandle />
              <ResizablePanel defaultSize={15} minSize={10} maxSize={40}>
                <div className="studio-timeline-frame h-full">
                  <SimpleTimeline />
                </div>
              </ResizablePanel>
            </>
          )}
          </ResizablePanelGroup>
        </div>
      </div>
      </Suspense>
    </div>
    </>
  );
}
