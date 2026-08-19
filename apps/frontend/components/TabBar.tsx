// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
import { mainNavItems, bottomNavItems, useMediaPanelStore } from "@/stores/navigation/media-panel-store";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { LayoutDashboard, Home, Settings, HelpCircle } from "lucide-react";

export const HELP_REPOSITORY_URL = "https://github.com/xinzhuzi/MYStudio";

interface TabBarProps {
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
}

 
export function TabBar({ sidebarCollapsed}: TabBarProps) {
  const { activeTab, inProject, setActiveTab, setInProject } = useMediaPanelStore();

  const sidebarClassName = cn(
    "studio-sidebar flex flex-col bg-panel/90 backdrop-blur-xl border-r border-border/50",
    inProject ? "studio-sidebar-project" : "studio-sidebar-dashboard",
    "studio-sidebar-drawer w-14",
    !sidebarCollapsed && "studio-sidebar-open"
  );

  const sidebarSpacer = (
    <div style={{ paddingTop: '48px' }} />
  );

  // Dashboard mode
  if (!inProject) {
    return (
      <div className={sidebarClassName}>
        {sidebarSpacer}
        <nav className="flex-1 py-1">
          <TooltipProvider delayDuration={300}>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => { setActiveTab("dashboard"); }}
                  className={cn(
                    "studio-nav-button w-full flex flex-col items-center py-2.5 transition-colors rounded-md",
                    activeTab === "dashboard"
                      ? "is-active text-primary bg-primary/10"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                  )}
                >
                  <LayoutDashboard className="h-5 w-5 mb-0.5" />
                  <span className="text-[9px]">项目</span>
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">项目仪表盘</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </nav>
        <div className="studio-sidebar-bottom mt-auto py-1">
          <TooltipProvider delayDuration={300}>
            <Tooltip>
              <TooltipTrigger asChild>
                <a
                  href={HELP_REPOSITORY_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="studio-nav-button w-full flex flex-col items-center py-2 text-muted-foreground hover:text-foreground transition-colors"
                >
                  <HelpCircle className="h-4 w-4" />
                  <span className="text-[8px]">帮助</span>
                </a>
              </TooltipTrigger>
              <TooltipContent side="right">使用帮助</TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <TooltipProvider delayDuration={300}>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => { setActiveTab("settings"); }}
                  className={cn(
                    "studio-nav-button w-full flex flex-col items-center py-2 transition-colors rounded-md",
                    activeTab === "settings" ? "is-active text-primary" : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <Settings className="h-4 w-4" />
                  <span className="text-[8px]">设置</span>
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">系统设置</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </div>
    );
  }

  // Project mode
  return (
    <div className={sidebarClassName}>
      {sidebarSpacer}
      <nav className="flex-1 py-1">
        {/* Home — exit the current project and return to the Dashboard
            (project list). setInProject(false) also clears episode scope and
            forces activeTab back to "dashboard". Separated from the
            in-project panel buttons by a divider. */}
        <TooltipProvider delayDuration={300}>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => setInProject(false)}
                className="studio-nav-button w-full flex flex-col items-center py-2.5 text-muted-foreground transition-colors hover:text-foreground hover:bg-muted/50 rounded-md"
              >
                <Home className="h-5 w-5 mb-0.5" />
                <span className="text-[9px]">主页</span>
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">返回项目列表</TooltipContent>
          </Tooltip>
        </TooltipProvider>
        <div className="mx-3 my-1 border-t border-border/40" role="separator" />
        {mainNavItems.map((item) => {
          const isActive = activeTab === item.id;
          const Icon = item.icon;

          return (
            <TooltipProvider key={item.id} delayDuration={300}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => { setActiveTab(item.id); }}
                    className={cn(
                      "studio-nav-button w-full flex flex-col items-center py-2.5 transition-colors rounded-md",
                      isActive
                        ? "is-active text-primary bg-primary/10"
                        : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                    )}
                  >
                    <Icon className="h-5 w-5 mb-0.5" />
                    <span className="text-[9px]">{item.label}</span>
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right">{item.label}</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          );
        })}
      </nav>

      <div className="studio-sidebar-bottom mt-auto py-1">
        <TooltipProvider delayDuration={300}>
          <Tooltip>
            <TooltipTrigger asChild>
              <a
                href={HELP_REPOSITORY_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="studio-nav-button w-full flex flex-col items-center py-2 text-muted-foreground hover:text-foreground transition-colors"
              >
                <HelpCircle className="h-4 w-4" />
                <span className="text-[8px]">帮助</span>
              </a>
            </TooltipTrigger>
            <TooltipContent side="right">使用帮助</TooltipContent>
          </Tooltip>
        </TooltipProvider>
        {bottomNavItems.map((item) => {
          const isActive = activeTab === item.id;
          const Icon = item.icon;

          return (
            <TooltipProvider key={item.id} delayDuration={300}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => { setActiveTab(item.id); }}
                    className={cn(
                      "studio-nav-button w-full flex flex-col items-center py-2 transition-colors rounded-md",
                      isActive ? "is-active text-primary" : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    <Icon className="h-4 w-4" />
                    <span className="text-[8px]">{item.label}</span>
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right">{item.label}</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          );
        })}
      </div>
    </div>
  );
}
