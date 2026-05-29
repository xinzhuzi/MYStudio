// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
import { TabBar } from "./TabBar";
import { PreviewPanel } from "./PreviewPanel";
import { RightPanel } from "./RightPanel";
import { SimpleTimeline } from "./SimpleTimeline";
import { Dashboard } from "./Dashboard";
import { ProjectHeader } from "./ProjectHeader";
import { useMediaPanelStore } from "@/stores/media-panel-store";
import { useLayoutEffect, useRef, useState } from "react";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";

// Panel imports
import { ScriptView } from "@/components/panels/script";
import { DirectorView } from "@/components/panels/director";
import { SClassView } from "@/components/panels/sclass";
import { CharactersView } from "@/components/panels/characters";
import { ScenesView } from "@/components/panels/scenes";
import { FreedomView } from "@/components/panels/assist";
import { MediaView } from "@/components/panels/media";
import { SettingsPanel } from "@/components/panels/SettingsPanel";
import { ExportView } from "@/components/panels/export";
import { OverviewPanel } from "@/components/panels/overview";
import { AssetsView } from "@/components/panels/assets";
import { StudioView } from "@/components/panels/studio";
import { SkillsView } from "@/components/panels/skills";
import { TTSView } from "@/components/panels/tts";

export function Layout() {
  const { activeTab, inProject, setInProject } = useMediaPanelStore();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);
  const previousInProjectRef = useRef(inProject);
  const toggleSidebar = () => setSidebarCollapsed((collapsed) => !collapsed);
  // 重型面板懒挂载：首次激活后保持挂载，用 hidden 切换
  const [mountedTabs, setMountedTabs] = useState<Set<string>>(new Set());

  useLayoutEffect(() => {
    if (activeTab === "assets" || activeTab === "skills" || activeTab === "tts") {
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
      <div className="studio-shell h-full flex bg-background">
        <TabBar sidebarCollapsed={sidebarCollapsed} onToggleSidebar={toggleSidebar} />
        <div className="studio-main flex-1">
          {activeTab === "settings" ? (
            <SettingsPanel
              sidebarCollapsed={sidebarCollapsed}
              onToggleSidebar={toggleSidebar}
            />
          ) : (
            <Dashboard
              sidebarCollapsed={sidebarCollapsed}
              onToggleSidebar={toggleSidebar}
            />
          )}
        </div>
      </div>
    );
  }

  // Full-screen views (no resizable panels)
  // 这些板块有自己的多栏布局，不需要全局的预览和属性面板
  const fullScreenTabs = ["export", "settings", "overview", "studio", "script", "characters", "scenes", "freedom", "assets", "skills", "tts"];
  if (fullScreenTabs.includes(activeTab)) {
    return (
      <div className="studio-shell h-full flex flex-col bg-background">
        <ProjectHeader
          onBack={() => setInProject(false)}
          sidebarCollapsed={sidebarCollapsed}
          onToggleSidebar={toggleSidebar}
        />
        <div className="flex flex-1 min-h-0">
          <TabBar sidebarCollapsed={sidebarCollapsed} onToggleSidebar={toggleSidebar} />
          <div className="studio-main flex-1 min-w-0 flex flex-col overflow-hidden">
            <div key={activeTab} className="cinematic-route flex-1 h-full min-h-0 overflow-hidden">
              {activeTab === "export" && <ExportView />}
              {activeTab === "settings" && (
                <SettingsPanel
                  sidebarCollapsed={sidebarCollapsed}
                  onToggleSidebar={toggleSidebar}
                />
              )}
              {activeTab === "overview" && <OverviewPanel />}
              {activeTab === "studio" && <StudioView />}
              {activeTab === "script" && <ScriptView />}
              {activeTab === "characters" && <CharactersView />}
              {activeTab === "scenes" && <ScenesView />}
              {activeTab === "freedom" && <FreedomView />}
              {/* 重型面板：懒挂载 + hidden 保活 */}
              {mountedTabs.has("assets") && <div className={activeTab === "assets" ? "h-full" : "hidden"}><AssetsView /></div>}
              {mountedTabs.has("skills") && <div className={activeTab === "skills" ? "h-full" : "hidden"}><SkillsView sidebarCollapsed={sidebarCollapsed} onToggleSidebar={toggleSidebar} /></div>}
              {mountedTabs.has("tts") && <div className={activeTab === "tts" ? "h-full" : "hidden"}><TTSView sidebarCollapsed={sidebarCollapsed} onToggleSidebar={toggleSidebar} /></div>}
            </div>
          </div>
        </div>
      </div>
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
    <div className="studio-shell h-full flex flex-col bg-background">
        <ProjectHeader
          onBack={() => setInProject(false)}
          sidebarCollapsed={sidebarCollapsed}
          onToggleSidebar={toggleSidebar}
        />

      <div className="flex flex-1 min-h-0">
        {/* Left: TabBar - below the app chrome */}
        <TabBar sidebarCollapsed={sidebarCollapsed} onToggleSidebar={toggleSidebar} />

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
                {renderLeftPanel()}
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
    </div>
  );
}
