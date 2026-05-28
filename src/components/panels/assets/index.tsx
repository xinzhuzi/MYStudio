// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
"use client";

/**
 * AssetsView - 资产面板主入口
 * 左侧导航树 + 右侧内容区
 */

import { useState } from "react";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { AssetSidebar, type AssetSection } from "./AssetSidebar";
import { DefaultStylesGrid } from "./DefaultStylesGrid";
import { CustomStylesGrid } from "./CustomStylesGrid";
import { StudioAssetLibrary } from "./StudioAssetLibrary";

export function AssetsView() {
  const [activeSection, setActiveSection] = useState<AssetSection>("style-default");
  const [mounted, setMounted] = useState<Set<AssetSection>>(() => new Set(["style-default"]));

  const handleSectionChange = (section: AssetSection) => {
    setActiveSection(section);
    setMounted((prev) => {
      if (prev.has(section)) return prev;
      const next = new Set(prev);
      next.add(section);
      return next;
    });
  };

  return (
    <div className="studio-workspace studio-workspace-assets h-full">
      <ResizablePanelGroup direction="horizontal" className="h-full">
        {/* 左侧导航 */}
        <ResizablePanel defaultSize={15} minSize={12} maxSize={25}>
          <AssetSidebar
            activeSection={activeSection}
            onSectionChange={handleSectionChange}
          />
        </ResizablePanel>

        <ResizableHandle withHandle />

        {/* 右侧内容区 - 懒挂载 + hidden 保活 */}
        <ResizablePanel defaultSize={85} minSize={60}>
          <div className="h-full overflow-hidden relative">
            {mounted.has("style-default") && <div className={activeSection === "style-default" ? "h-full" : "hidden"}><DefaultStylesGrid /></div>}
            {mounted.has("style-custom") && <div className={activeSection === "style-custom" ? "h-full" : "hidden"}><CustomStylesGrid /></div>}
            {mounted.has("asset-role") && <div className={activeSection === "asset-role" ? "h-full" : "hidden"}><StudioAssetLibrary type="role" /></div>}
            {mounted.has("asset-scene") && <div className={activeSection === "asset-scene" ? "h-full" : "hidden"}><StudioAssetLibrary type="scene" /></div>}
            {mounted.has("asset-tool") && <div className={activeSection === "asset-tool" ? "h-full" : "hidden"}><StudioAssetLibrary type="tool" /></div>}
            {mounted.has("asset-clip") && <div className={activeSection === "asset-clip" ? "h-full" : "hidden"}><StudioAssetLibrary type="clip" /></div>}
            {mounted.has("asset-audio") && <div className={activeSection === "asset-audio" ? "h-full" : "hidden"}><StudioAssetLibrary type="audio" /></div>}
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}
