// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
"use client";

/**
 * Settings Panel - Unified API Manager v2
 * Provider-based API configuration with multi-key support
 * Based on AionUi's ModelModalContent pattern
 */

import { useState, lazy, Suspense } from "react";

const LocalTtsPanelLazy = lazy(() => import("@/components/panels/tts/LocalTtsPanel").then((m) => ({ default: m.LocalTtsPanel })));
import { useAPIConfigStore } from "@/stores/api-config-store";
import { useAppSettingsStore } from "@/stores/app-settings-store";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { SidebarToggleButton } from "@/components/ChromeControls";
import { AppearanceSettingsTab } from "./settings/AppearanceSettingsTab";
import { SupportSettingsTab } from "./settings/SupportSettingsTab";
import { ImageSizeSettingsTab } from "./settings/ImageSizeSettingsTab";
import { AdvancedSettingsTab } from "./settings/AdvancedSettingsTab";
import { ImageHostSettingsContainer } from "./settings/ImageHostSettingsContainer";
import { DevelopmentSettingsContainer } from "./settings/DevelopmentSettingsContainer";
import { PythonSettingsTab } from "./settings/PythonSettingsTab";
import { StorageSettingsTab } from "./settings/StorageSettingsTab";
import { ApiSettingsContainer, ApiSettingsMigration } from "./settings/ApiSettingsContainer";
import {
  DEFAULT_SETTINGS_TAB,
  SettingsTabsBar,
  type SettingsTabId,
} from "./settings/SettingsTabsBar";

export {
  buildProviderAdapterTemplate,
  filterModelsByFuzzyQuery,
  getProviderDisplayName,
  getPythonExecutableDisplayPath,
  inferProviderAdapterModelType,
} from "./settings/settings-model-utils";
export { API_MANAGER_SECTIONS } from "./settings/ApiSettingsTab";
export { DEFAULT_SETTINGS_TAB, SETTINGS_TABS } from "./settings/SettingsTabsBar";

export const API_SERVICE_SUMMARY_FIELDS = ["Base URL", "接口协议", "API Key"] as const;

interface SettingsPanelProps {
  sidebarCollapsed?: boolean;
  onToggleSidebar?: () => void;
  showHomeChrome?: boolean;
}

export function SettingsPanel({
  sidebarCollapsed = false,
  onToggleSidebar,
  showHomeChrome = false,
}: SettingsPanelProps) {
  const {
    advancedOptions,
    setAdvancedOption,
    resetAdvancedOptions,
    isImageHostConfigured,
  } = useAPIConfigStore();
  const {
    imageGenerationSettings,
    setImageGenerationSettings,
  } = useAppSettingsStore();

  const [activeTab, setActiveTab] = useState<SettingsTabId>(DEFAULT_SETTINGS_TAB);
  return (
    <div className="settings-workspace flex flex-col h-full bg-background overflow-hidden">
      <ApiSettingsMigration />
      {showHomeChrome ? (
        <div className="dashboard-topbar h-14 border-b border-border bg-panel pr-8 pl-20 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-4">
            {onToggleSidebar && (
              <SidebarToggleButton
                sidebarCollapsed={sidebarCollapsed}
                onToggleSidebar={onToggleSidebar}
              />
            )}
            <div className="dashboard-topbar-title">
              <span className="text-sm font-semibold text-foreground">漫影工作室</span>
              <span className="text-xs text-muted-foreground">影像制片工作台</span>
            </div>
          </div>
        </div>
      ) : null}
      <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as SettingsTabId)} className="flex-1 flex flex-col overflow-hidden">
        <SettingsTabsBar isImageHostConfigured={isImageHostConfigured()} />

        <TabsContent value="appearance" className="flex-1 overflow-hidden mt-0">
          <AppearanceSettingsTab />
        </TabsContent>

        {/* API Management Tab */}
        <TabsContent value="api" className="flex-1 overflow-hidden mt-0">
          <ApiSettingsContainer />
        </TabsContent>

        {/* Image Size Settings Tab */}
        <TabsContent value="imageSize" className="flex-1 overflow-hidden mt-0">
          <ImageSizeSettingsTab
            settings={imageGenerationSettings}
            onChange={setImageGenerationSettings}
          />
        </TabsContent>

        {/* Python Config Tab */}
        <TabsContent value="python" className="flex-1 overflow-hidden mt-0">
          <PythonSettingsTab />
        </TabsContent>

        {/* TTS Config Tab */}
        <TabsContent value="tts" className="flex-1 overflow-hidden mt-0">
          <Suspense fallback={<div className="flex h-40 items-center justify-center text-muted-foreground text-sm">加载中...</div>}>
            <LocalTtsPanelLazy />
          </Suspense>
        </TabsContent>

        {/* Advanced Options Tab */}
        <TabsContent value="advanced" className="flex-1 overflow-hidden mt-0">
          <AdvancedSettingsTab
            options={advancedOptions}
            onChange={setAdvancedOption}
            onReset={resetAdvancedOptions}
          />
        </TabsContent>

        {/* Image Host Config Tab */}
        <TabsContent value="imagehost" className="flex-1 overflow-hidden mt-0">
          <ImageHostSettingsContainer />
        </TabsContent>

        {/* Storage Tab */}
        <TabsContent value="storage" className="flex-1 overflow-hidden mt-0">
          <StorageSettingsTab />
        </TabsContent>

        <TabsContent value="development" className="flex-1 overflow-hidden mt-0">
          <DevelopmentSettingsContainer />
        </TabsContent>

        <TabsContent value="support" className="flex-1 overflow-hidden mt-0">
          <SupportSettingsTab />
        </TabsContent>
      </Tabs>

    </div>
  );
}
