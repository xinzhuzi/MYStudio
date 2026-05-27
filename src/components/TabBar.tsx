// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
import { mainNavItems, bottomNavItems, useMediaPanelStore } from "@/stores/media-panel-store";
import { cn } from "@/lib/utils";
import { SidebarToggleButton } from "@/components/ChromeControls";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { LayoutDashboard, Settings, HelpCircle } from "lucide-react";

interface TabBarProps {
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
}

export function TabBar({ sidebarCollapsed, onToggleSidebar }: TabBarProps) {
  const { activeTab, inProject, setActiveTab } = useMediaPanelStore();

  if (sidebarCollapsed) {
    return null;
  }

  const sidebarClassName = cn(
    "studio-sidebar flex flex-col bg-panel border-r border-border",
    inProject ? "studio-sidebar-project" : "studio-sidebar-dashboard",
    "studio-sidebar-expanded w-14"
  );

  const sidebarToggle = (
    <div className="studio-sidebar-toggle">
      <TooltipProvider delayDuration={300}>
        <Tooltip>
          <TooltipTrigger asChild>
            <SidebarToggleButton
              sidebarCollapsed={sidebarCollapsed}
              onToggleSidebar={onToggleSidebar}
            />
          </TooltipTrigger>
          <TooltipContent side="right">
            {sidebarCollapsed ? "显示侧栏" : "隐藏侧栏"}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  );

  // Dashboard mode
  if (!inProject) {
    return (
      <div className={cn(sidebarClassName, "py-0")}>
        {sidebarToggle}
        {/* Dashboard nav */}
        <nav className="flex-1 py-1">
          <TooltipProvider delayDuration={300}>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => setActiveTab("dashboard")}
                  className={cn(
                    "studio-nav-button w-full flex flex-col items-center py-2.5 transition-colors",
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
        {/* Bottom: Help + Settings */}
        <div className="studio-sidebar-bottom mt-auto py-1">
          <TooltipProvider delayDuration={300}>
            <Tooltip>
              <TooltipTrigger asChild>
                <a
                  href="https://github.com/zhengbingjin/MYStudio"
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
                  onClick={() => setActiveTab("settings")}
                  className={cn(
                    "studio-nav-button w-full flex flex-col items-center py-2 transition-colors",
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

  // Project mode - flat navigation
  return (
    <div className={sidebarClassName}>
      {sidebarToggle}
      {/* Main Navigation */}
      <nav className="flex-1 py-1">
        {mainNavItems.map((item) => {
          const isActive = activeTab === item.id;
          const Icon = item.icon;
          
          return (
            <TooltipProvider key={item.id} delayDuration={300}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => setActiveTab(item.id)}
                    className={cn(
                      "studio-nav-button w-full flex flex-col items-center py-2.5 transition-colors",
                      isActive
                        ? "is-active text-primary bg-primary/10"
                        : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                    )}
                  >
                    <Icon className="h-5 w-5 mb-0.5" />
                    <span className="text-[9px]">{item.label}</span>
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right">
                  {item.label}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          );
        })}
      </nav>

      {/* Bottom: Help + Settings */}
      <div className="studio-sidebar-bottom mt-auto py-1">
        <TooltipProvider delayDuration={300}>
          <Tooltip>
            <TooltipTrigger asChild>
              <a
                href="https://github.com/zhengbingjin/MYStudio"
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
                    onClick={() => setActiveTab(item.id)}
                    className={cn(
                      "studio-nav-button w-full flex flex-col items-center py-2 transition-colors",
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
