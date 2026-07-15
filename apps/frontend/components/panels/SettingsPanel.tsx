// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
"use client";

/**
 * Settings Panel - Unified API Manager v2
 * Provider-based API configuration with multi-key support
 * Based on AionUi's ModelModalContent pattern
 */

import { useState, useMemo, useEffect, lazy, Suspense } from "react";

const LocalTtsPanelLazy = lazy(() => import("@/components/panels/tts/LocalTtsPanel").then((m) => ({ default: m.LocalTtsPanel })));
import {
  isVisibleImageHostProvider,
  useAPIConfigStore,
  type IProvider,
  type ImageHostProvider,
} from "@/stores/api-config-store";
import { useStudioConfigStore } from "@/stores/studio-config-store";
import { useAppSettingsStore } from "@/stores/app-settings-store";
import { classifyModelByName, parseApiKeys } from "@/lib/api-key-manager";
import { resolveThinkingEnabled } from "@/lib/ai/thinking-mode";
import { prepareModelTestRequest, type ModelTestResult, type ModelTestType } from "@/lib/api-manager/model-test";
import { createOperationId, logEvent } from "@/lib/diagnostics/logger";
import { AddProviderDialog, EditProviderDialog } from "@/components/api-manager";
import { AddImageHostDialog } from "@/components/image-host-manager/AddImageHostDialog";
import { EditImageHostDialog } from "@/components/image-host-manager/EditImageHostDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SidebarToggleButton } from "@/components/ChromeControls";
import {
  Settings,
  Key,
  Loader2,
  Layers,
  HardDrive,
  RefreshCw,
  Upload,
  ExternalLink,
  Palette,
  Terminal,
  Mic2,
  Coffee,
  Image as ImageIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { uploadToImageHost } from "@/lib/image-host";
import {
  buildProviderAdapterTemplate,
  getProviderDisplayName,
  inferProviderAdapterModelType,
} from "./settings/settings-model-utils";
import { AppearanceSettingsTab } from "./settings/AppearanceSettingsTab";
import { SupportSettingsTab } from "./settings/SupportSettingsTab";
import { ImageSizeSettingsTab } from "./settings/ImageSizeSettingsTab";
import { AdvancedSettingsTab } from "./settings/AdvancedSettingsTab";
import { ImageHostSettingsTab } from "./settings/ImageHostSettingsTab";
import { DevelopmentSettingsContainer } from "./settings/DevelopmentSettingsContainer";
import { PythonSettingsTab } from "./settings/PythonSettingsTab";
import { StorageSettingsTab } from "./settings/StorageSettingsTab";
import { ApiSettingsTab } from "./settings/ApiSettingsTab";

export {
  buildProviderAdapterTemplate,
  filterModelsByFuzzyQuery,
  getProviderDisplayName,
  getPythonExecutableDisplayPath,
  inferProviderAdapterModelType,
} from "./settings/settings-model-utils";
export { API_MANAGER_SECTIONS } from "./settings/ApiSettingsTab";

export const SETTINGS_TABS = [
  { value: "appearance", label: "外观" },
  { value: "api", label: "API 管理" },
  { value: "imageSize", label: "图片规格" },
  { value: "python", label: "Python 配置" },
  { value: "tts", label: "TTS 配置" },
  { value: "advanced", label: "高级选项" },
  { value: "imagehost", label: "图床配置" },
  { value: "storage", label: "存储" },
  { value: "development", label: "开发" },
  { value: "support", label: "请作者喝杯咖啡" },
] as const;

export const DEFAULT_SETTINGS_TAB = "appearance";

export const API_SERVICE_SUMMARY_FIELDS = ["Base URL", "接口协议", "API Key"] as const;
type SettingsTabId = typeof SETTINGS_TABS[number]["value"];

function renderSettingsTabIcon(value: SettingsTabId) {
  switch (value) {
    case "appearance":
      return <Palette className="h-4 w-4 mr-2" />;
    case "api":
      return <Key className="h-4 w-4 mr-2" />;
    case "imageSize":
      return <ImageIcon className="h-4 w-4 mr-2" />;
    case "python":
      return <Terminal className="h-4 w-4 mr-2" />;
    case "tts":
      return <Mic2 className="h-4 w-4 mr-2" />;
    case "advanced":
      return <Layers className="h-4 w-4 mr-2" />;
    case "imagehost":
      return <Upload className="h-4 w-4 mr-2" />;
    case "storage":
      return <HardDrive className="h-4 w-4 mr-2" />;
    case "development":
      return <Terminal className="h-4 w-4 mr-2" />;
    case "support":
      return <Coffee className="h-4 w-4 mr-2" />;
  }
}

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
    providers,
    advancedOptions,
    imageHostProviders,
    addProvider,
    updateProvider,
    removeProvider,
    addImageHostProvider,
    updateImageHostProvider,
    removeImageHostProvider,
    setAdvancedOption,
    resetAdvancedOptions,
    isImageHostConfigured,
    syncProviderModels,
    migrateStudioBindings,
    upsertProviderAdapterCode,
    getModelThinkingOverride,
  } = useAPIConfigStore();
  const studioConfigBindings = useStudioConfigStore((state) => state.bindings);
  const {
    imageGenerationSettings,
    setImageGenerationSettings,
  } = useAppSettingsStore();

  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingProvider, setEditingProvider] = useState<IProvider | null>(null);
  const [testingProvider, setTestingProvider] = useState<string | null>(null);
  const [modelTestMessages, setModelTestMessages] = useState<Record<string, string>>({});
  const [syncingProvider, setSyncingProvider] = useState<string | null>(null);
  const [imageHostAddOpen, setImageHostAddOpen] = useState(false);
  const [imageHostEditOpen, setImageHostEditOpen] = useState(false);
  const [editingImageHost, setEditingImageHost] = useState<ImageHostProvider | null>(null);
  const [testingImageHostId, setTestingImageHostId] = useState<string | null>(null);
  const visibleImageHostProviders = useMemo(
    () => imageHostProviders.filter(isVisibleImageHostProvider),
    [imageHostProviders],
  );
  const visibleProviders = useMemo(
    () => providers.filter((provider) => (
      provider.platform !== "memefast" || parseApiKeys(provider.apiKey).length > 0
    )),
    [providers],
  );

  useEffect(() => {
    if (studioConfigBindings.length > 0) {
      migrateStudioBindings(studioConfigBindings);
    }
  }, [migrateStudioBindings, studioConfigBindings]);

  // Open edit dialog
  const handleEdit = (provider: IProvider) => {
    setEditingProvider(provider);
    setEditDialogOpen(true);
  };

  const handleDeleteProvider = (provider: IProvider) => {
    const confirmed = window.confirm(`删除供应商「${getProviderDisplayName(provider)}」？相关模型映射和 Agent 绑定也会清理。`);
    if (!confirmed) return;

    removeProvider(provider.id);
    toast.success("已删除供应商");
  };

  const handleEditImageHost = (provider: ImageHostProvider) => {
    setEditingImageHost(provider);
    setImageHostEditOpen(true);
  };

  const handleDeleteImageHost = (id: string) => {
    removeImageHostProvider(id);
    toast.success("已删除图床");
  };

  const handleTestImageHost = async (provider: ImageHostProvider) => {
    setTestingImageHostId(provider.id);
    try {
      const testImage = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
      const result = await uploadToImageHost(testImage, {
        expiration: 60,
        providerId: provider.id,
      });
      if (result.success) {
        toast.success(`图床 ${provider.name} 连接测试成功`);
      } else {
        toast.error(`测试失败: ${result.error || '未知错误'}`);
      }
    } catch (error) {
      toast.error('连接测试失败，请检查网络');
    } finally {
      setTestingImageHostId(null);
    }
  };

  const inferModelTestType = (model: string): ModelTestType => {
    if (inferProviderAdapterModelType(model) === "tts") return "tts";
    const capabilities = classifyModelByName(model);
    if (capabilities.includes("video_generation")) return "video";
    if (capabilities.includes("image_generation")) return "image";
    if (capabilities.includes("vision") && !capabilities.includes("text")) return "vision";
    return "text";
  };

  const getModelTestKey = (providerId: string, model: string) => `${providerId}:${model || "__empty__"}`;

  const runProviderModelTest = async (
    provider: IProvider,
    model: string,
    options: { showToast?: boolean } = {},
  ): Promise<ModelTestResult | null> => {
    const showToast = options.showToast ?? true;
    const type = inferModelTestType(model);
    const testKey = getModelTestKey(provider.id, model);
    const operationId = createOperationId("model-test");
    // 思考模式：用户显式配置优先，否则按模型名自动判断
    const thinkingEnabled = resolveThinkingEnabled(model, getModelThinkingOverride(model));
    const imageTestSettings = {
      defaultAspectRatio: imageGenerationSettings.defaultAspectRatio,
      defaultResolution: imageGenerationSettings.defaultResolution,
    };
    const prepared = prepareModelTestRequest({
      provider,
      model,
      type,
      thinkingEnabled,
      imageGenerationSettings: imageTestSettings,
    });

    void logEvent({
      level: "info",
      category: "action",
      operationId,
      message: "API model test clicked",
      context: {
        providerId: provider.id,
        providerName: provider.name,
        platform: provider.platform,
        model,
        type,
      },
    });

    setTestingProvider(provider.id);
    setModelTestMessages((prev) => ({ ...prev, [testKey]: "" }));

    if (!prepared.success) {
      void logEvent({
        level: "warn",
        category: "action",
        operationId,
        message: "API model test preparation failed",
        context: {
          providerId: provider.id,
          providerName: provider.name,
          model,
          type,
          error: prepared.error,
        },
      });
      setTestingProvider(null);
      setModelTestMessages((prev) => ({ ...prev, [testKey]: prepared.error }));
      if (showToast) toast.error(prepared.error);
      return null;
    }

    if (!window.electronAPI?.testModel) {
      setTestingProvider(null);
      if (prepared.dryRun) {
        setModelTestMessages((prev) => ({ ...prev, [testKey]: prepared.message }));
        if (showToast) toast.success(prepared.message);
        return { success: true, message: prepared.message };
      } else {
        const message = "模型测试接口仅在桌面应用中可用";
        setModelTestMessages((prev) => ({ ...prev, [testKey]: message }));
        if (showToast) toast.error(message);
        return { success: false, error: message };
      }
    }

    try {
      const result = await window.electronAPI.testModel({
        operationId,
        provider: {
          id: provider.id,
          platform: provider.platform,
          name: provider.name,
          baseUrl: provider.baseUrl,
          apiKey: provider.apiKey,
          model: provider.model,
        },
        model,
        type,
        thinkingEnabled,
        imageGenerationSettings: imageTestSettings,
      });
      setModelTestMessages((prev) => ({
        ...prev,
        [testKey]: result.message || result.error || (result.success ? "测试通过" : "测试失败"),
      }));
      if (result.success) {
        if (result.protocol) {
          updateProvider({ ...provider, apiProtocol: result.protocol });
        }
        if (showToast) toast.success(result.message || "模型测试通过");
      } else {
        if (showToast) toast.error(result.error || "模型测试失败");
      }
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : "连接测试失败，请检查网络";
      setModelTestMessages((prev) => ({ ...prev, [testKey]: message }));
      if (showToast) toast.error(message);
      return { success: false, error: message };
    } finally {
      setTestingProvider(null);
    }
  };

  const handleTestModel = async (provider: IProvider, model: string) => {
    await runProviderModelTest(provider, model);
  };

  const handleSyncProviderModels = async (provider: IProvider) => {
    setSyncingProvider(provider.id);
    try {
      const result = await syncProviderModels(provider.id);
      if (result.success) {
        toast.success(`已同步 ${result.count} 个模型`);
      } else if (result.error) {
        toast.error(`模型同步失败: ${result.error}`);
      }
    } finally {
      setSyncingProvider(null);
    }
  };

  // Get existing platforms
  const existingPlatforms = useMemo(
    () => visibleProviders.map((p) => p.platform),
    [visibleProviders]
  );

  const configuredCount = visibleProviders.filter(
    (p) => parseApiKeys(p.apiKey).length > 0
  ).length;
  const [activeTab, setActiveTab] = useState<SettingsTabId>(DEFAULT_SETTINGS_TAB);
  return (
    <div className="settings-workspace flex flex-col h-full bg-background overflow-hidden">
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
        <div className="settings-tabs-bar border-b border-border px-6">
          <TabsList className="h-12 bg-transparent p-0 gap-4">
            {SETTINGS_TABS.map((tab) => (
              <TabsTrigger
                key={tab.value}
                value={tab.value}
                className="data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-4 h-12"
              >
                {renderSettingsTabIcon(tab.value)}
                {tab.label}
                {tab.value === "imagehost" && isImageHostConfigured() && (
                  <span className="ml-1 w-2 h-2 bg-green-500 rounded-full" />
                )}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        <TabsContent value="appearance" className="flex-1 overflow-hidden mt-0">
          <AppearanceSettingsTab />
        </TabsContent>

        {/* API Management Tab */}
        <TabsContent value="api" className="flex-1 overflow-hidden mt-0">
          <ApiSettingsTab
            providers={visibleProviders}
            configuredCount={configuredCount}
            syncingProviderId={syncingProvider}
            testingProviderId={testingProvider}
            modelTestMessages={modelTestMessages}
            onAdd={() => setAddDialogOpen(true)}
            onDelete={handleDeleteProvider}
            onEdit={handleEdit}
            onSync={handleSyncProviderModels}
            onTest={handleTestModel}
          />
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
          <ImageHostSettingsTab
            providers={visibleImageHostProviders}
            testingProviderId={testingImageHostId}
            onAdd={() => setImageHostAddOpen(true)}
            onUpdate={updateImageHostProvider}
            onTest={handleTestImageHost}
            onEdit={handleEditImageHost}
            onDelete={handleDeleteImageHost}
          />
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

      {/* Dialogs */}
      <AddProviderDialog
        open={addDialogOpen}
        onOpenChange={setAddDialogOpen}
        onSubmit={(providerData) => {
          const provider = addProvider(providerData);
          const defaultCode = buildProviderAdapterTemplate(provider);
          upsertProviderAdapterCode(provider.id, defaultCode);
          if (parseApiKeys(providerData.apiKey).length > 0 || provider.platform === "manying-local-tts" || provider.platform === "tts-compatible") {
            const firstModel = provider.model[0];
            if (!firstModel) {
              toast.message("供应商已添加，请填写模型后再测试连接");
              return;
            }
            runProviderModelTest(provider, firstModel, { showToast: false }).then((testResult) => {
              if (!testResult?.success) {
                toast.error(testResult?.error || "模型自动测试失败");
                return;
              }

              toast.success(testResult.message || "模型自动测试通过");
              if (testResult.protocol !== "openai-compatible") {
                return;
              }

              setSyncingProvider(provider.id);
              syncProviderModels(provider.id).then(result => {
                setSyncingProvider(null);
                if (result.success) {
                  toast.success(`已自动同步 ${result.count} 个模型`);
                } else if (result.error) {
                  toast.error(`模型同步失败: ${result.error}`);
                }
              });
            });
          }
        }}
        existingPlatforms={existingPlatforms}
      />

      <EditProviderDialog
        open={editDialogOpen}
        onOpenChange={setEditDialogOpen}
        provider={editingProvider}
        onSave={(provider) => {
          updateProvider(provider);
          if (parseApiKeys(provider.apiKey).length > 0 || provider.platform === "manying-local-tts" || provider.platform === "tts-compatible") {
            const firstModel = provider.model[0];
            if (!firstModel) {
              toast.message("供应商已保存，请填写模型后再测试连接");
              return;
            }
            runProviderModelTest(provider, firstModel, { showToast: false }).then((testResult) => {
              if (!testResult?.success) {
                toast.error(testResult?.error || "模型自动测试失败");
                return;
              }

              toast.success(testResult.message || "模型自动测试通过");
              if (testResult.protocol !== "openai-compatible") {
                return;
              }

              setSyncingProvider(provider.id);
              syncProviderModels(provider.id).then(result => {
                setSyncingProvider(null);
                if (result.success) {
                  toast.success(`已自动同步 ${result.count} 个模型`);
                } else if (result.error) {
                  toast.error(`模型同步失败: ${result.error}`);
                }
              });
            });
          }
        }}
      />

      <AddImageHostDialog
        open={imageHostAddOpen}
        onOpenChange={setImageHostAddOpen}
        onSubmit={addImageHostProvider}
      />

      <EditImageHostDialog
        open={imageHostEditOpen}
        onOpenChange={setImageHostEditOpen}
        provider={editingImageHost}
        onSave={updateImageHostProvider}
      />
    </div>
  );
}
