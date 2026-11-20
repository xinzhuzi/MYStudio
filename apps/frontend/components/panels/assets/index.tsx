// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
"use client";

/**
 * AssetsView - 资产面板主入口
 * 左侧导航树 + 右侧内容区;
 * 1120 详情独立页(§5.1/§10.4):右侧内容区二态——detail-view store 的
 * target 非空=详情页占满(左导航可见),空=列表态(四库+风格页)。列表态组件
 * 卸载(滚动回顶=§9 候裁3;搜索词/分类筛选经 StudioAssetLibrary 模块级
 * 会话缓存保活)。
 */

import { useState } from "react";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { useAssetDetailViewStore } from "@/stores/assets/asset-detail-view-store";
import { AssetSidebar, type AssetSection } from "./AssetSidebar";
import { DefaultStylesGrid } from "./DefaultStylesGrid";
import { CustomStylesGrid } from "./CustomStylesGrid";
import { StudioAssetDetailView } from "./StudioAssetDetailView";
import { StudioAssetLibrary } from "./StudioAssetLibrary";

export function AssetsView() {
  const [activeSection, setActiveSection] = useState<AssetSection>("style-default");
  const [mounted, setMounted] = useState<Set<AssetSection>>(() => new Set(["style-default"]));
  const detailTarget = useAssetDetailViewStore((state) => state.target);
  const closeDetail = useAssetDetailViewStore((state) => state.close);

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

        {/* 右侧内容区 - 懒挂载 + hidden 保活;1120 详情独立页:二态切下钻 */}
        <ResizablePanel defaultSize={85} minSize={60}>
          <div className="h-full overflow-hidden relative">
            {detailTarget ? (
              <StudioAssetDetailView asset={detailTarget} onBack={closeDetail} />
            ) : (
              <>
            {mounted.has("style-default") && <div className={activeSection === "style-default" ? "h-full" : "hidden"}><DefaultStylesGrid /></div>}
            {mounted.has("style-custom") && <div className={activeSection === "style-custom" ? "h-full" : "hidden"}><CustomStylesGrid /></div>}
            {mounted.has("asset-role") && <div className={activeSection === "asset-role" ? "h-full" : "hidden"}><StudioAssetLibrary type="role" /></div>}
            {mounted.has("asset-scene") && <div className={activeSection === "asset-scene" ? "h-full" : "hidden"}><StudioAssetLibrary type="scene" /></div>}
            {mounted.has("asset-tool") && <div className={activeSection === "asset-tool" ? "h-full" : "hidden"}><StudioAssetLibrary type="tool" /></div>}
            {mounted.has("asset-audio") && <div className={activeSection === "asset-audio" ? "h-full" : "hidden"}><StudioAssetLibrary type="audio" /></div>}
              </>
            )}
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}
