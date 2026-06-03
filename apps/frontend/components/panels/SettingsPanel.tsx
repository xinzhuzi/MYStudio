// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
"use client";

/**
 * Settings Panel - Unified API Manager v2
 * Provider-based API configuration with multi-key support
 * Based on AionUi's ModelModalContent pattern
 */

import { useState, useMemo, useEffect, useCallback, lazy, Suspense } from "react";
import type { CSSProperties } from "react";

const LocalTtsPanelLazy = lazy(() => import("@/components/panels/tts/LocalTtsPanel").then((m) => ({ default: m.LocalTtsPanel })));
import wechatPayImg from "@/assets/donate/wechat-pay.jpg";
import alipayPayImg from "@/assets/donate/alipay-pay.jpg";
import wechatFriendImg from "@/assets/donate/wechat-friend.jpg";
import {
  API_AGENT_DEPLOYMENT_GROUPS,
  getAgentDeploymentModelType,
  isVisibleImageHostProvider,
  useAPIConfigStore,
  type IProvider,
  type ImageHostProvider,
  type AgentDeploymentConfig,
  type AgentDeploymentKey,
  type AgentUseMode,
  type ProviderAdapterModelType,
} from "@/stores/api-config-store";
import { useStudioConfigStore } from "@/stores/studio-config-store";
import { useAppSettingsStore } from "@/stores/app-settings-store";
import { COLOR_PRESETS, useThemeStore } from "@/stores/theme-store";
import { useProjectStore } from "@/stores/project-store";
import { useCharacterLibraryStore } from "@/stores/character-library-store";
import { useSceneStore } from "@/stores/scene-store";
import { useMediaStore } from "@/stores/media-store";
import { classifyModelByName, getApiKeyCount, parseApiKeys } from "@/lib/api-key-manager";
import { resolveThinkingEnabled } from "@/lib/ai/thinking-mode";
import { prepareModelTestRequest, type ModelTestResult, type ModelTestType } from "@/lib/api-manager/model-test";
import { AddProviderDialog, EditProviderDialog, FeatureBindingPanel } from "@/components/api-manager";
import { AddImageHostDialog } from "@/components/image-host-manager/AddImageHostDialog";
import { EditImageHostDialog } from "@/components/image-host-manager/EditImageHostDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Settings,
  Key,
  Plus,
  Pencil,
  Trash2,
  Shield,
  Check,
  Loader2,
  Zap,
  Info,
  RotateCcw,
  Link2,
  Play,
  ShieldAlert,
  Layers,
  Folder,
  HardDrive,
  Download,
  RefreshCw,
  Upload,
  ExternalLink,
  Palette,
  Terminal,
  Mic2,
  Workflow,
  Coffee,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { uploadToImageHost } from "@/lib/image-host";
import { getTtsRuntimeConfig, getTtsRuntimeStatus, setTtsRuntimeConfig, setupTtsRuntime } from "@/lib/tts/client";
import { UpdateDialog } from "@/components/UpdateDialog";
import type { TtsRuntimeConfig, TtsRuntimeStatus } from "@/types/tts";
import type { AvailableUpdateInfo } from "@/types/update";
import packageJson from "../../../package.json";

export const SETTINGS_TABS = [
  { value: "appearance", label: "外观" },
  { value: "api", label: "API 管理" },
  { value: "python", label: "Python 配置" },
  { value: "tts", label: "TTS 配置" },
  { value: "advanced", label: "高级选项" },
  { value: "imagehost", label: "图床配置" },
  { value: "storage", label: "存储" },
  { value: "development", label: "开发" },
  { value: "support", label: "请作者喝杯咖啡" },
] as const;

export const DEFAULT_SETTINGS_TAB = "appearance";

export const API_MANAGER_SECTIONS = [
  { value: "service", label: "模型服务", desc: "供应商、API Key、Base URL、模型列表与测试" },
  { value: "mapping", label: "模型映射", desc: "按文本、图片、视频、TTS、视觉能力绑定模型" },
  { value: "agents", label: "Agent 配置", desc: "工作流逻辑任务到模型的部署关系" },
] as const;

export const API_SERVICE_SUMMARY_FIELDS = ["Base URL", "接口协议", "API Key"] as const;
const LEGACY_STORAGE_PREFIX = ["mo", "yin"].join("");
const LEGACY_INDEXED_DB_NAME = `${LEGACY_STORAGE_PREFIX}-creator-db`;

type SettingsTabId = typeof SETTINGS_TABS[number]["value"];
type APIManagerSectionId = typeof API_MANAGER_SECTIONS[number]["value"];
type PresetCardStyle = CSSProperties & { "--preset-color": string };

export function getPythonExecutableDisplayPath(config?: Pick<TtsRuntimeConfig, "pythonRuntimeDir" | "installedItems"> | null) {
  if (!config?.pythonRuntimeDir) return "配置完成后显示实际 Python 路径";
  const expectedPath = config.pythonRuntimeDir.includes("\\")
    ? `${config.pythonRuntimeDir}\\python.exe`
    : `${config.pythonRuntimeDir}/bin/python3`;
  const runtimeItem = config.installedItems?.find((item) => (
    item.label === "Python 运行环境"
    && item.detail === expectedPath
  ));
  if (runtimeItem?.detail) return runtimeItem.detail;
  return expectedPath;
}

function renderSettingsTabIcon(value: SettingsTabId) {
  switch (value) {
    case "appearance":
      return <Palette className="h-4 w-4 mr-2" />;
    case "api":
      return <Key className="h-4 w-4 mr-2" />;
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

function renderAPISectionIcon(value: APIManagerSectionId) {
  switch (value) {
    case "service":
      return <Key className="h-4 w-4" />;
    case "mapping":
      return <Link2 className="h-4 w-4" />;
    case "agents":
      return <Workflow className="h-4 w-4" />;
  }
}

function getPresetUsageTone(presetId: string): string {
  switch (presetId) {
    case "eyeCare":
      return "长写作";
    case "warmPaper":
      return "剧本文档";
    case "sageInk":
      return "素材归档";
    case "neutral":
      return "白天剪辑";
    case "blueprint":
      return "流程配置";
    case "mist":
      return "参数表格";
    case "porcelain":
      return "展示概览";
    case "lavender":
      return "创意资产";
    case "cinema":
      return "暗场制片";
    case "graphite":
      return "多轨剪辑";
    case "midnight":
      return "夜间预览";
    case "ink":
      return "沉浸分镜";
    case "ember":
      return "氛围概念";
    default:
      return "工作台";
  }
}

type AdapterModelType = ProviderAdapterModelType;

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

export function inferProviderAdapterModelType(modelName: string): AdapterModelType {
  const lowerName = modelName.toLowerCase();
  if (/tts|voice|speech|audio|kokoro|chatterbox|luxtts|tada/.test(lowerName)) return "tts";

  const capabilities = classifyModelByName(modelName);
  if (capabilities.includes("video_generation")) return "video";
  if (capabilities.includes("image_generation")) return "image";
  if (capabilities.includes("vision") || /vision|vl|omni/.test(lowerName)) return "vision";
  return "text";
}

function inferProviderAdapterCapabilities(modelName: string): string[] {
  const modelType = inferProviderAdapterModelType(modelName);
  if (modelType === "tts") return ["tts"];
  if (modelType === "vision") return ["text", "vision"];
  return uniqueStrings(classifyModelByName(modelName));
}

function getToonflowModelShape(modelName: string) {
  const modelType = inferProviderAdapterModelType(modelName);
  const base = {
    name: modelName,
    modelName,
    type: modelType,
    capabilities: inferProviderAdapterCapabilities(modelName),
  };

  if (modelType === "image") {
    return {
      ...base,
      mode: ["text", "singleImage", "multiReference"],
    };
  }
  if (modelType === "video") {
    return {
      ...base,
      mode: ["text", "singleImage"],
      audio: "optional",
      durationResolutionMap: [
        { duration: [5], resolution: ["720p", "1080p"] },
      ],
    };
  }
  if (modelType === "tts") {
    return {
      ...base,
      voices: [{ title: "Default", voice: "default" }],
    };
  }
  return {
    ...base,
    type: modelType === "vision" ? "vision" : "text",
    think: false,
  };
}

export function getProviderDisplayName(provider: Pick<IProvider, "platform" | "name">): string {
  if (provider.platform === "memefast" && /meme\s*fast|memefast|漫影API/i.test(provider.name)) {
    return "OpenAI 兼容服务";
  }
  return provider.name;
}

const MODEL_TYPE_LABELS: Record<AdapterModelType, string> = {
  text: "文本",
  image: "图片",
  video: "视频",
  tts: "TTS",
  vision: "视觉",
};

function formatModelCapabilities(modelName: string): string {
  const labels: Record<string, string> = {
    text: "文本",
    vision: "视觉",
    function_calling: "工具",
    image_generation: "图片",
    video_generation: "视频",
    web_search: "搜索",
    reasoning: "推理",
    embedding: "向量",
    tts: "TTS",
  };
  return inferProviderAdapterCapabilities(modelName)
    .map((capability) => labels[capability] || capability)
    .join(" / ");
}

export function buildProviderAdapterTemplate(provider: IProvider): string {
  const providerName = getProviderDisplayName(provider);
  const models = provider.model.map(getToonflowModelShape);
  const vendorConfig = {
    vendor: {
      id: provider.platform,
      version: "1.0",
      name: providerName,
      author: "漫影工作室",
      description: "OpenAI-compatible 供应商配置，可按实际接口补充模型和请求方法。",
      inputs: [
        {
          key: "apiKey",
          label: "API Key",
          type: "password",
          required: true,
        },
        {
          key: "baseUrl",
          label: "Base URL",
          type: "url",
          required: true,
          placeholder: "https://api.example.com/v1",
        },
      ],
      inputValues: {
        apiKey: "",
        baseUrl: provider.baseUrl,
      },
    },
    models,
  };

  return `/**
 * ${providerName} 供应商适配配置
 * 该代码作为本地配置资产保存；漫影工作室只解析 mystudio-vendor-json，不执行 TS。
 */
type ModelType = "text" | "image" | "video" | "tts" | "vision";
interface AdapterModel {
  name: string;
  modelName: string;
  type: ModelType;
  capabilities?: string[];
}
interface VendorConfig {
  id: string;
  version: string;
  name: string;
  author: string;
  description?: string;
  inputs: Array<{ key: string; label: string; type: "text" | "password" | "url"; required: boolean; placeholder?: string }>;
  inputValues: Record<string, string>;
  models: AdapterModel[];
}

const vendor: VendorConfig = ${JSON.stringify({ ...vendorConfig.vendor, models }, null, 2)};

const textRequest = () => {
  throw new Error("V1 仅保存配置，不在 renderer 执行供应商代码");
};
const imageRequest = textRequest;
const videoRequest = textRequest;
const ttsRequest = textRequest;

exports.vendor = vendor;
exports.textRequest = textRequest;
exports.imageRequest = imageRequest;
exports.videoRequest = videoRequest;
exports.ttsRequest = ttsRequest;

/* mystudio-vendor-json
${JSON.stringify(vendorConfig, null, 2)}
*/`;
}

interface SettingsPanelProps {
  sidebarCollapsed?: boolean;
  onToggleSidebar?: () => void;
}

export function SettingsPanel({
  sidebarCollapsed = false,
  onToggleSidebar,
}: SettingsPanelProps) {
  const {
    providers,
    agentUseMode,
    agentDeployments,
    concurrency,
    advancedOptions,
    imageHostProviders,
    addProvider,
    updateProvider,
    removeProvider,
    addImageHostProvider,
    updateImageHostProvider,
    removeImageHostProvider,
    setConcurrency,
    setAdvancedOption,
    resetAdvancedOptions,
    isImageHostConfigured,
    syncProviderModels,
    setAgentUseMode,
    setAgentDeployment,
    migrateStudioBindings,
    upsertProviderAdapterCode,
    getModelThinkingOverride,
    setModelThinkingOverride,
  } = useAPIConfigStore();
  // 订阅覆盖表，保证开关切换后行内即时重渲染
  const modelThinkingOverrides = useAPIConfigStore((state) => state.modelThinkingOverrides);
  const studioConfigBindings = useStudioConfigStore((state) => state.bindings);
  const {
    resourceSharing,
    storagePaths,
    cacheSettings,
    updateSettings,
    developmentSettings,
    setResourceSharing,
    setStoragePaths,
    setCacheSettings,
    setUpdateSettings,
    setDevelopmentSettings,
  } = useAppSettingsStore();
  const { theme, colorPreset, setColorPreset } = useThemeStore();
  const { activeProjectId } = useProjectStore();
  const { assignProjectToUnscoped: assignCharactersToProject } = useCharacterLibraryStore();
  const { assignProjectToUnscoped: assignScenesToProject } = useSceneStore();
  const { assignProjectToUnscoped: assignMediaToProject } = useMediaStore();

  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingProvider, setEditingProvider] = useState<IProvider | null>(null);
  const [testingProvider, setTestingProvider] = useState<string | null>(null);
  const [activeApiSection, setActiveApiSection] = useState<APIManagerSectionId>("service");
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null);
  const [modelTestMessages, setModelTestMessages] = useState<Record<string, string>>({});
  const [syncingProvider, setSyncingProvider] = useState<string | null>(null);
  const [imageHostAddOpen, setImageHostAddOpen] = useState(false);
  const [imageHostEditOpen, setImageHostEditOpen] = useState(false);
  const [editingImageHost, setEditingImageHost] = useState<ImageHostProvider | null>(null);
  const [testingImageHostId, setTestingImageHostId] = useState<string | null>(null);
  const [cacheSize, setCacheSize] = useState(0);
  const [isCacheLoading, setIsCacheLoading] = useState(false);
  const [isClearingCache, setIsClearingCache] = useState(false);
  const [isCheckingForUpdates, setIsCheckingForUpdates] = useState(false);
  const [isOpeningDevTools, setIsOpeningDevTools] = useState(false);
  const [ttsRuntimeConfig, setTtsRuntimeConfigState] = useState<TtsRuntimeConfig | null>(null);
  const [ttsRuntimeStatus, setTtsRuntimeStatus] = useState<TtsRuntimeStatus | null>(null);
  const [pythonRuntimeUrlDraft, setPythonRuntimeUrlDraft] = useState("");
  const [isSavingTtsRuntimeConfig, setIsSavingTtsRuntimeConfig] = useState(false);
  const [isSettingUpPythonRuntime, setIsSettingUpPythonRuntime] = useState(false);
  const [updateDialogOpen, setUpdateDialogOpen] = useState(false);
  const [availableUpdate, setAvailableUpdate] = useState<AvailableUpdateInfo | null>(null);
  const [appVersion, setAppVersion] = useState(packageJson.version);
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
  const activeColorPreset = COLOR_PRESETS.find((preset) => preset.id === colorPreset);
  const selectedProvider = useMemo(
    () => visibleProviders.find((provider) => provider.id === selectedProviderId) || visibleProviders[0] || null,
    [visibleProviders, selectedProviderId],
  );
  useEffect(() => {
    if (!selectedProviderId && visibleProviders[0]) {
      setSelectedProviderId(visibleProviders[0].id);
      return;
    }
    if (selectedProviderId && !visibleProviders.some((provider) => provider.id === selectedProviderId)) {
      setSelectedProviderId(visibleProviders[0]?.id ?? null);
    }
  }, [visibleProviders, selectedProviderId]);

  useEffect(() => {
    if (studioConfigBindings.length > 0) {
      migrateStudioBindings(studioConfigBindings);
    }
  }, [migrateStudioBindings, studioConfigBindings]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const version = await window.appUpdater?.getCurrentVersion?.();
        if (!cancelled && version) {
          setAppVersion(version);
        }
      } catch (error) {
        console.warn("[SettingsPanel] Failed to load app version:", error);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // Open edit dialog
  const handleEdit = (provider: IProvider) => {
    setEditingProvider(provider);
    setEditDialogOpen(true);
  };

  const handleDeleteProvider = (provider: IProvider) => {
    const confirmed = window.confirm(`删除供应商「${getProviderDisplayName(provider)}」？相关模型映射和 Agent 绑定也会清理。`);
    if (!confirmed) return;

    removeProvider(provider.id);
    setSelectedProviderId((current) => (current === provider.id ? null : current));
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
    // 思考模式：用户显式配置优先，否则按模型名自动判断
    const thinkingEnabled = resolveThinkingEnabled(model, getModelThinkingOverride(model));
    const prepared = prepareModelTestRequest({ provider, model, type, thinkingEnabled });

    setTestingProvider(provider.id);
    setModelTestMessages((prev) => ({ ...prev, [testKey]: "" }));

    if (!prepared.success) {
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
  const apiModelOptions = useMemo(
    () => visibleProviders.flatMap((provider) => provider.model.map((model) => ({
      providerId: provider.id,
      model,
      type: inferProviderAdapterModelType(model),
      value: `${provider.id}:${model}`,
      label: `${getProviderDisplayName(provider)} / ${model}`,
    }))),
    [visibleProviders],
  );

  const isAgentModelTypeCompatible = (requiredType: AdapterModelType, modelType: AdapterModelType) => (
    requiredType === modelType || (requiredType === "text" && modelType === "vision")
  );

  const getAgentModelOptions = (key: AgentDeploymentKey) => {
    const requiredType = getAgentDeploymentModelType(key);
    return apiModelOptions.filter((option) => isAgentModelTypeCompatible(requiredType, option.type));
  };

  const getAgentModelValue = (deployment: { vendorId?: string; modelId?: string }) => {
    if (!deployment.modelId) return "";
    if (deployment.vendorId) return `${deployment.vendorId}:${deployment.modelId}`;
    return deployment.modelId;
  };

  const handleAgentModelChange = (key: AgentDeploymentKey, value: string) => {
    const splitAt = value.indexOf(":");
    setAgentDeployment({
      key,
      vendorId: splitAt > 0 ? value.slice(0, splitAt) : undefined,
      modelId: splitAt > 0 ? value.slice(splitAt + 1) : value || undefined,
    });
  };

  const handleAutoAssignAgents = () => {
    let assignedCount = 0;
    let skippedCount = 0;

    for (const deployment of agentDeployments) {
      if (deployment.disabled) continue;
      const requiredType = getAgentDeploymentModelType(deployment.key);
      const options = getAgentModelOptions(deployment.key);
      const currentValue = getAgentModelValue(deployment);
      const currentOption = apiModelOptions.find((option) => option.value === currentValue);

      if (currentOption && isAgentModelTypeCompatible(requiredType, currentOption.type)) {
        continue;
      }

      const nextOption = options[0];
      if (!nextOption) {
        skippedCount += 1;
        continue;
      }

      setAgentDeployment({
        key: deployment.key,
        vendorId: nextOption.providerId,
        modelId: nextOption.model,
      });
      assignedCount += 1;
    }

    if (assignedCount > 0) {
      toast.success(`已自动分配 ${assignedCount} 个 Agent`);
      return;
    }
    if (skippedCount > 0) {
      toast.warning("没有找到可用于部分 Agent 的匹配模型");
      return;
    }
    toast.info("当前 Agent 绑定已经匹配模型能力");
  };

  const agentDeploymentByKey = useMemo(
    () => new Map(agentDeployments.map((deployment) => [deployment.key, deployment])),
    [agentDeployments],
  );

  const groupedAgentKeySet = useMemo(
    () => new Set(API_AGENT_DEPLOYMENT_GROUPS.flatMap((group) => group.keys)),
    [],
  );

  const extraAgentDeployments = useMemo(
    () => agentDeployments.filter((deployment) => !groupedAgentKeySet.has(deployment.key)),
    [agentDeployments, groupedAgentKeySet],
  );

  const [activeTab, setActiveTab] = useState<SettingsTabId>(DEFAULT_SETTINGS_TAB);
  const hasStorageManager = typeof window !== "undefined" && !!window.storageManager;
  const hasAppUpdater = typeof window !== "undefined" && !!window.appUpdater;
  const hasElectronDevTools = typeof window !== "undefined" && !!window.electronAPI?.openDevTools;
  const hasTtsRuntime = typeof window !== "undefined" && !!window.ttsRuntime;
  const pythonSetupStage = ttsRuntimeStatus?.setupStage ?? "idle";
  const pythonSetupActive = ["checking", "downloading-python", "extracting-python", "installing-deps"].includes(pythonSetupStage);
  const pythonInstalledItems = ttsRuntimeConfig?.installedItems ?? [];
  const pythonExecutablePath = getPythonExecutableDisplayPath(ttsRuntimeConfig);

  const formatBytes = useCallback((bytes: number) => {
    if (!bytes) return "0 B";
    const units = ["B", "KB", "MB", "GB", "TB"];
    const index = Math.min(
      units.length - 1,
      Math.floor(Math.log(bytes) / Math.log(1024))
    );
    const value = bytes / Math.pow(1024, index);
    return `${value.toFixed(value >= 100 ? 0 : value >= 10 ? 1 : 2)} ${units[index]}`;
  }, []);

  const refreshCacheSize = useCallback(async () => {
    if (!window.storageManager) return;
    setIsCacheLoading(true);
    try {
      const result = await window.storageManager.getCacheSize();
      setCacheSize(result.total || 0);
    } catch (error) {
      console.error("Failed to get cache size:", error);
    } finally {
      setIsCacheLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!hasStorageManager) return;
    window.storageManager
      ?.getPaths()
      .then((paths) => {
        if (paths.basePath) {
          setStoragePaths({ basePath: paths.basePath });
        }
      })
      .catch(() => {});
    refreshCacheSize();
  }, [hasStorageManager, refreshCacheSize, setStoragePaths]);

  useEffect(() => {
    if (!hasStorageManager || !window.storageManager) return;
    window.storageManager.updateConfig({
      autoCleanEnabled: cacheSettings.autoCleanEnabled,
      autoCleanDays: cacheSettings.autoCleanDays,
    });
  }, [cacheSettings.autoCleanEnabled, cacheSettings.autoCleanDays, hasStorageManager]);

  useEffect(() => {
    if (typeof window === "undefined" || !window.ttsRuntime) return;
    Promise.all([getTtsRuntimeConfig(), getTtsRuntimeStatus()])
      .then(([config, status]) => {
        setTtsRuntimeConfigState(config);
        setTtsRuntimeStatus(status);
        setPythonRuntimeUrlDraft(config.pythonRuntimeUrl || "");
      })
      .catch(() => {});
  }, []);

  const handleSaveTtsRuntimeConfig = async (pythonRuntimeUrl = pythonRuntimeUrlDraft) => {
    setIsSavingTtsRuntimeConfig(true);
    try {
      const result = await setTtsRuntimeConfig({ pythonRuntimeUrl });
      if (!result.success) {
        toast.error(result.error || "Python 运行环境配置保存失败");
        return;
      }
      const config = await getTtsRuntimeConfig();
      setTtsRuntimeConfigState(config);
      setPythonRuntimeUrlDraft(config.pythonRuntimeUrl || "");
      toast.success("Python 运行环境配置已保存");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Python 运行环境配置保存失败");
    } finally {
      setIsSavingTtsRuntimeConfig(false);
    }
  };

  const handleResetTtsRuntimeUrl = () => {
    setPythonRuntimeUrlDraft("");
    void handleSaveTtsRuntimeConfig("");
  };

  const refreshTtsRuntimeConfig = async () => {
    const config = await getTtsRuntimeConfig();
    setTtsRuntimeConfigState(config);
    setPythonRuntimeUrlDraft(config.pythonRuntimeUrl || "");
    return config;
  };

  const handleSetupPythonRuntime = async () => {
    setIsSettingUpPythonRuntime(true);
    let setupPoll: number | undefined;
    try {
      setupPoll = window.setInterval(() => {
        void getTtsRuntimeStatus()
          .then(setTtsRuntimeStatus)
          .catch(() => {});
      }, 500);
      const result = await setupTtsRuntime();
      if (result.status) {
        setTtsRuntimeStatus(result.status);
      }
      await refreshTtsRuntimeConfig();
      if (result.success) {
        toast.success("Python 运行环境配置完成");
      } else {
        toast.error(result.error || "Python 运行环境配置失败");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Python 运行环境配置失败");
    } finally {
      if (setupPoll) window.clearInterval(setupPoll);
      setIsSettingUpPythonRuntime(false);
    }
  };

  const handleToggleShareCharacters = async (checked: boolean) => {
    setResourceSharing({ shareCharacters: checked });
    if (!checked && activeProjectId) {
      assignCharactersToProject(activeProjectId);
    }
    // Rehydrate to load/unload other projects' data
    try { await useCharacterLibraryStore.persist.rehydrate(); } catch {}
  };

  const handleToggleShareScenes = async (checked: boolean) => {
    setResourceSharing({ shareScenes: checked });
    if (!checked && activeProjectId) {
      assignScenesToProject(activeProjectId);
    }
    try { await useSceneStore.persist.rehydrate(); } catch {}
  };

  const handleToggleShareMedia = async (checked: boolean) => {
    setResourceSharing({ shareMedia: checked });
    if (!checked && activeProjectId) {
      assignMediaToProject(activeProjectId);
    }
    try { await useMediaStore.persist.rehydrate(); } catch {}
  };

  // Unified storage handlers
  const handleSelectStoragePath = async () => {
    if (!window.storageManager) {
      toast.error("请在桌面应用中使用此功能");
      return;
    }
    const dir = await window.storageManager.selectDirectory();
    if (!dir) return;
    const result = await window.storageManager.moveData(dir);
    if (result.success) {
      setStoragePaths({ basePath: result.path || dir });
      
      // 清除 localStorage 中的缓存，确保从新路径加载数据
      const keysToRemove = Object.keys(localStorage).filter(key => 
        key.startsWith('mystudio-') || key.startsWith(LEGACY_STORAGE_PREFIX + '-') || key.includes('store')
      );
      keysToRemove.forEach(key => localStorage.removeItem(key));
      
      // 清除 IndexedDB 缓存
      try {
        const dbRequest = indexedDB.open(LEGACY_INDEXED_DB_NAME, 1);
        dbRequest.onsuccess = () => {
          const db = dbRequest.result;
          if (db.objectStoreNames.contains('zustand-storage')) {
            const tx = db.transaction('zustand-storage', 'readwrite');
            tx.objectStore('zustand-storage').clear();
          }
        };
      } catch (e) {
        console.warn('Failed to clear IndexedDB:', e);
      }
      
      toast.success("存储位置已更新，正在刷新...");
      setTimeout(() => window.location.reload(), 500);
    } else {
      toast.error(`移动失败: ${result.error || "未知错误"}`);
    }
  };

  const handleExportData = async () => {
    if (!window.storageManager) return;
    const dir = await window.storageManager.selectDirectory();
    if (!dir) return;
    const result = await window.storageManager.exportData(dir);
    if (result.success) {
      toast.success("数据已导出");
    } else {
      toast.error(`导出失败: ${result.error || "未知错误"}`);
    }
  };

  const handleImportData = async () => {
    if (!window.storageManager) return;
    const dir = await window.storageManager.selectDirectory();
    if (!dir) return;
    if (!confirm("导入将覆盖当前数据，是否继续？")) return;
    const result = await window.storageManager.importData(dir);
    if (result.success) {
      // 清除 localStorage 中的缓存，防止旧数据覆盖导入的数据
      const keysToRemove = Object.keys(localStorage).filter(key => 
        key.startsWith('mystudio-') || key.startsWith(LEGACY_STORAGE_PREFIX + '-') || key.includes('store')
      );
      keysToRemove.forEach(key => localStorage.removeItem(key));
      
      // 清除 IndexedDB 缓存
      try {
        const dbRequest = indexedDB.open(LEGACY_INDEXED_DB_NAME, 1);
        dbRequest.onsuccess = () => {
          const db = dbRequest.result;
          if (db.objectStoreNames.contains('zustand-storage')) {
            const tx = db.transaction('zustand-storage', 'readwrite');
            tx.objectStore('zustand-storage').clear();
          }
        };
      } catch (e) {
        console.warn('Failed to clear IndexedDB:', e);
      }
      
      toast.success("数据已导入，正在刷新...");
      // 延迟刷新页面以确保缓存清理完成
      setTimeout(() => window.location.reload(), 500);
    } else {
      toast.error(`导入失败: ${result.error || "未知错误"}`);
    }
  };

  const handleLinkData = async () => {
    if (!window.storageManager) {
      toast.error("请在桌面应用中使用此功能");
      return;
    }
    const dir = await window.storageManager.selectDirectory();
    if (!dir) return;
    
    // Validate the directory first
    const validation = await window.storageManager.validateDataDir(dir);
    if (!validation.valid) {
      toast.error(validation.error || "无效的数据目录");
      return;
    }
    
    // Confirm with user
    const confirmMsg = `检测到 ${validation.projectCount || 0} 个项目文件，${validation.mediaCount || 0} 个素材文件。\n\n是否指向此目录？操作后建议重启应用。`;
    if (!confirm(confirmMsg)) return;
    
    const result = await window.storageManager.linkData(dir);
    if (result.success) {
      setStoragePaths({ basePath: result.path || dir });
      
      // 清除 localStorage 中的缓存，确保从新路径加载数据
      const keysToRemove = Object.keys(localStorage).filter(key => 
        key.startsWith('mystudio-') || key.startsWith(LEGACY_STORAGE_PREFIX + '-') || key.includes('store')
      );
      keysToRemove.forEach(key => localStorage.removeItem(key));
      
      // 清除 IndexedDB 缓存
      try {
        const dbRequest = indexedDB.open(LEGACY_INDEXED_DB_NAME, 1);
        dbRequest.onsuccess = () => {
          const db = dbRequest.result;
          if (db.objectStoreNames.contains('zustand-storage')) {
            const tx = db.transaction('zustand-storage', 'readwrite');
            tx.objectStore('zustand-storage').clear();
          }
        };
      } catch (e) {
        console.warn('Failed to clear IndexedDB:', e);
      }
      
      toast.success("已指向数据目录，正在刷新...");
      setTimeout(() => window.location.reload(), 500);
    } else {
      toast.error(`操作失败: ${result.error || "未知错误"}`);
    }
  };

  const handleClearCache = async () => {
    if (!window.storageManager) return;
    setIsClearingCache(true);
    try {
      const result = await window.storageManager.clearCache();
      if (result.success) {
        toast.success("缓存已清理");
        refreshCacheSize();
      } else {
        toast.error(`清理失败: ${result.error || "未知错误"}`);
      }
    } finally {
      setIsClearingCache(false);
    }
  };

  const handleCheckForUpdates = async () => {
    if (!window.appUpdater) {
      toast.error("请在桌面应用中使用此功能");
      return;
    }

    setIsCheckingForUpdates(true);
    try {
      const result = await window.appUpdater.checkForUpdates();
      if (!result.success) {
        toast.error(`检查更新失败: ${result.error || "未知错误"}`);
        return;
      }

      if (result.hasUpdate && result.update) {
        setAvailableUpdate(result.update);
        setUpdateDialogOpen(true);
        return;
      }

      setAvailableUpdate(null);
      toast.success(`当前已是最新版本 v${result.currentVersion}`);
    } catch (error) {
      console.error("[SettingsPanel] Failed to check updates:", error);
      toast.error("检查更新失败，请稍后重试");
    } finally {
      setIsCheckingForUpdates(false);
    }
  };

  const handleClearIgnoredVersion = () => {
    setUpdateSettings({ ignoredVersion: "" });
    toast.success("已恢复更新提醒");
  };

  const handleOpenDevTools = async () => {
    if (!window.electronAPI?.openDevTools) {
      toast.error("请在桌面应用中使用此功能");
      return;
    }

    setIsOpeningDevTools(true);
    try {
      const result = await window.electronAPI.openDevTools();
      if (result.success) {
        toast.success("控制台已打开");
      } else {
        toast.error(result.error || "打开控制台失败");
      }
    } catch (error) {
      console.error("[SettingsPanel] Failed to open DevTools:", error);
      toast.error("打开控制台失败");
    } finally {
      setIsOpeningDevTools(false);
    }
  };

  return (
    <div className="settings-workspace flex flex-col h-full bg-background overflow-hidden">
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
          <ScrollArea className="h-full">
            <div className="appearance-panel p-8 w-full space-y-7">
              <div className="appearance-hero">
                <div className="appearance-hero-copy">
                  <div className="appearance-kicker">
                    <span />
                    <span>Studio Look</span>
                  </div>
                  <h3 className="appearance-title">外观皮肤</h3>
                  <p className="appearance-subtitle">
                    用电影调色台的方式选择工作台质感；每套皮肤只保留一个标准主色，背景、面板和文字层级自动跟随。
                  </p>
                </div>
                <div className="appearance-current-card">
                  <span className="appearance-current-label">当前皮肤</span>
                  <strong>{activeColorPreset?.name}</strong>
                  <p>{theme === "dark" ? "暗场工作台" : "护眼浅场"} · {activeColorPreset?.description}</p>
                  <i
                    className="appearance-current-swatch"
                    style={{ backgroundColor: activeColorPreset?.color }}
                  />
                </div>
              </div>

              <div className="appearance-preset-grid">
                {COLOR_PRESETS.map((preset) => {
                  const isActive = colorPreset === preset.id;
                  const presetStyle = { "--preset-color": preset.color } as PresetCardStyle;
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => setColorPreset(preset.id)}
                      className={cn(
                        "settings-preset-card appearance-preset-card group text-left rounded-xl border bg-card transition-all",
                        isActive && "is-active"
                      )}
                      data-mode={preset.mode}
                      style={presetStyle}
                    >
                      <div className="appearance-preset-preview" aria-hidden="true">
                        <div className="appearance-preview-topline">
                          <span />
                          <span />
                        </div>
                        <div className="appearance-preview-stage">
                          <i />
                          <i />
                          <i />
                        </div>
                        <div className="appearance-preview-timeline">
                          <span />
                          <span />
                        </div>
                      </div>

                      <div className="appearance-preset-body">
                        <div className="appearance-preset-title-row">
                          <div>
                            <span className="appearance-preset-name">{preset.name}</span>
                            <span className="appearance-preset-tone">{getPresetUsageTone(preset.id)}</span>
                          </div>
                          {isActive && <Check className="h-4 w-4 shrink-0" />}
                        </div>
                        <p>{preset.description}</p>
                        <div className="appearance-preset-footer">
                          <span className="appearance-mode-pill">
                            {preset.mode === "dark" ? "暗色" : "浅色"}
                          </span>
                          <span
                            className="appearance-single-swatch"
                            style={{ backgroundColor: preset.color }}
                            aria-label={`${preset.name} 标准主色`}
                          />
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>

              <div className="appearance-note">
                当前：{theme === "dark" ? "暗色" : "浅色"} ·{" "}
                {activeColorPreset?.name}
              </div>
            </div>
          </ScrollArea>
        </TabsContent>

        {/* API Management Tab */}
        <TabsContent value="api" className="flex-1 overflow-hidden mt-0">
          <ScrollArea className="h-full">
            <div className="p-8 w-full space-y-8">
          {/* API Header: count + add button */}
          <div className="flex items-center justify-between">
            <div />
            <div className="flex items-center gap-3">
              <span className="text-xs text-muted-foreground font-mono bg-muted border border-border px-2 py-1 rounded">
                已配置: {configuredCount}/{visibleProviders.length}
              </span>
              <Button onClick={() => setAddDialogOpen(true)} size="sm">
                <Plus className="h-4 w-4 mr-1" />
                添加供应商
              </Button>
            </div>
          </div>
          {/* Security Notice */}
          <div className="flex items-start gap-3 p-4 bg-muted/50 border border-border rounded-lg">
            <Shield className="h-5 w-5 text-primary mt-0.5 shrink-0" />
            <div>
              <h3 className="font-medium text-foreground text-sm">安全说明</h3>
              <p className="text-xs text-muted-foreground mt-1">
                所有 API Key 仅存储在您的浏览器本地存储中，不会上传到任何服务器。支持多 Key 轮换，失败时自动切换。
              </p>
            </div>
          </div>

          <div className="grid grid-cols-[220px_minmax(0,1fr)] gap-6 items-start">
            <aside className="space-y-3">
              <div className="rounded-xl border border-border bg-card p-2">
                {API_MANAGER_SECTIONS.map((section) => (
                  <button
                    key={section.value}
                    type="button"
                    onClick={() => setActiveApiSection(section.value)}
                    className={cn(
                      "w-full rounded-lg px-3 py-3 text-left transition-colors",
                      activeApiSection === section.value
                        ? "bg-primary/10 text-primary"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground"
                    )}
                  >
                    <span className="flex items-center gap-2 text-sm font-medium">
                      {renderAPISectionIcon(section.value)}
                      {section.label}
                    </span>
                    <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                      {section.desc}
                    </span>
                  </button>
                ))}
              </div>

              {visibleProviders.length > 0 && (
                <div className="rounded-xl border border-border bg-card p-2">
                  <div className="px-2 pb-2 text-xs font-medium text-muted-foreground">供应商</div>
                  <div className="space-y-1">
                    {visibleProviders.map((provider) => (
                      <div
                        key={provider.id}
                        className={cn(
                          "group flex w-full items-center gap-2 rounded-md px-2 py-2 text-sm transition-colors",
                          selectedProvider?.id === provider.id
                            ? "bg-muted text-foreground"
                            : "text-muted-foreground hover:bg-muted/70 hover:text-foreground"
                        )}
                      >
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedProviderId(provider.id);
                            setActiveApiSection("service");
                          }}
                          className="min-w-0 flex-1 text-left"
                        >
                          <span className="block truncate">{getProviderDisplayName(provider)}</span>
                          <span className="text-xs text-muted-foreground">{provider.model.length} 个模型</span>
                        </button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 shrink-0 text-muted-foreground opacity-70 hover:text-destructive md:opacity-0 md:group-hover:opacity-100"
                          title="删除供应商"
                          onClick={(event) => {
                            event.stopPropagation();
                            handleDeleteProvider(provider);
                          }}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </aside>

            <div className="min-w-0 space-y-6">
              {activeApiSection === "mapping" && <FeatureBindingPanel />}

              {activeApiSection === "agents" && (
                <div className="space-y-4">
                  <div className="flex items-start justify-between gap-4 rounded-xl border border-border bg-card p-5">
                    <div>
                      <h3 className="font-bold text-foreground flex items-center gap-2">
                        <Workflow className="h-4 w-4" />
                        Agent 配置
                      </h3>
                      <p className="mt-1 text-sm text-muted-foreground">
                        「自动分配」一键为每个 Agent 绑定能力匹配的可用模型。简单模式：文本类任务统一复用「通用AI」模型，无需逐个配置；高级模式：每个 Agent 各自绑定独立模型，便于按任务精细调优（图像 / 视频 / 语音类始终按各自绑定）。
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleAutoAssignAgents}
                        disabled={apiModelOptions.length === 0}
                      >
                        <Zap className="h-4 w-4 mr-1" />
                        自动分配
                      </Button>
                      <select
                        className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                        value={agentUseMode}
                        onChange={(event) => setAgentUseMode(event.target.value as AgentUseMode)}
                      >
                        <option value="simple">简单模式</option>
                        <option value="advanced">高级模式</option>
                      </select>
                    </div>
                  </div>

                  <div className="space-y-4">
                    {[...API_AGENT_DEPLOYMENT_GROUPS, ...(extraAgentDeployments.length > 0
                      ? [{
                          id: "extra",
                          label: "其他",
                          desc: "历史配置或插件扩展留下的自定义 Agent",
                          keys: extraAgentDeployments.map((deployment) => deployment.key),
                        }]
                      : [])].map((group) => {
                      const deployments = group.keys
                        .map((key) => agentDeploymentByKey.get(key))
                        .filter((deployment): deployment is AgentDeploymentConfig => Boolean(deployment));
                      if (deployments.length === 0) return null;

                      return (
                        <div key={group.id} className="overflow-hidden rounded-xl border border-border bg-card">
                          <div className="border-b border-border px-4 py-3">
                            <div className="text-sm font-semibold text-foreground">{group.label}</div>
                            <div className="mt-1 text-xs text-muted-foreground">{group.desc}</div>
                          </div>
                          <div className="divide-y divide-border">
                            {deployments.map((deployment) => {
                              const requiredType = getAgentDeploymentModelType(deployment.key);
                              const options = getAgentModelOptions(deployment.key);
                              const currentValue = getAgentModelValue(deployment);
                              const currentOption = apiModelOptions.find((option) => option.value === currentValue);
                              const currentMatches = currentOption
                                ? isAgentModelTypeCompatible(requiredType, currentOption.type)
                                : !currentValue;

                              return (
                                <div
                                  key={deployment.key}
                                  className="grid gap-3 px-4 py-3 lg:grid-cols-[minmax(180px,240px)_minmax(0,1fr)_96px] lg:items-center"
                                >
                                  <div className="min-w-0">
                                    <div className="flex flex-wrap items-center gap-2">
                                      <div className="text-sm font-medium text-foreground">{deployment.name}</div>
                                      <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                                        {MODEL_TYPE_LABELS[requiredType]}
                                      </span>
                                    </div>
                                    <div className="mt-1 text-xs text-muted-foreground">{deployment.desc}</div>
                                  </div>
                                  <div className="min-w-0">
                                    <select
                                      className="h-9 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm"
                                      value={currentValue}
                                      onChange={(event) => handleAgentModelChange(deployment.key, event.target.value)}
                                      disabled={deployment.disabled}
                                    >
                                      <option value="">未绑定（需要 {MODEL_TYPE_LABELS[requiredType]} 模型）</option>
                                      {!currentMatches && currentValue && (
                                        <option value={currentValue}>
                                          当前绑定类型不匹配：{currentValue}
                                        </option>
                                      )}
                                      {options.map((option) => (
                                        <option key={`${deployment.key}:${option.value}`} value={option.value}>
                                          {option.label}（{MODEL_TYPE_LABELS[option.type]}）
                                        </option>
                                      ))}
                                    </select>
                                    {options.length === 0 && (
                                      <div className="mt-1 text-xs text-muted-foreground">
                                        没有可用的 {MODEL_TYPE_LABELS[requiredType]} 模型
                                      </div>
                                    )}
                                  </div>
                                  <Button
                                    variant={deployment.disabled ? "secondary" : "outline"}
                                    size="sm"
                                    onClick={() => setAgentDeployment({ key: deployment.key, disabled: !deployment.disabled })}
                                  >
                                    {deployment.disabled ? "已停用" : "启用中"}
                                  </Button>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {activeApiSection === "service" && (
                <>
                  {selectedProvider && (
                    <div className="space-y-4">
                      <div className="rounded-xl border border-border bg-card overflow-hidden">
                        <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
                          <div>
                            <h3 className="font-bold text-foreground flex items-center gap-2">
                              <Key className="h-4 w-4" />
                              供应商配置
                            </h3>
                            <p className="mt-1 text-sm text-muted-foreground">
                              {getProviderDisplayName(selectedProvider)}
                            </p>
                          </div>
                          <div className="flex flex-wrap items-center justify-end gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleSyncProviderModels(selectedProvider)}
                              disabled={syncingProvider === selectedProvider.id}
                            >
                              {syncingProvider === selectedProvider.id ? (
                                <Loader2 className="h-4 w-4 animate-spin mr-1" />
                              ) : (
                                <RefreshCw className="h-4 w-4 mr-1" />
                              )}
                              同步模型
                            </Button>
                            <Button variant="outline" size="sm" onClick={() => handleEdit(selectedProvider)}>
                              <Pencil className="h-4 w-4 mr-1" />
                              编辑输入项
                            </Button>
                          </div>
                        </div>

                        <div className="grid gap-3 px-5 py-4 sm:grid-cols-3">
                          <div className="rounded-lg border border-border bg-muted/20 p-3">
                            <div className="text-xs text-muted-foreground">Base URL</div>
                            <div className="mt-1 truncate font-mono text-xs text-foreground">
                              {selectedProvider.baseUrl || "未设置"}
                            </div>
                          </div>
                          <div className="rounded-lg border border-border bg-muted/20 p-3">
                            <div className="text-xs text-muted-foreground">接口协议</div>
                            <div className="mt-1 text-xs text-foreground">
                              {selectedProvider.apiProtocol === "anthropic-compatible"
                                ? "Anthropic 兼容"
                                : selectedProvider.apiProtocol === "openai-compatible"
                                  ? "OpenAI 兼容"
                                  : selectedProvider.apiProtocol === "gemini-compatible"
                                    ? "Gemini 兼容"
                                    : "待测试"}
                            </div>
                          </div>
                          <div className="rounded-lg border border-border bg-muted/20 p-3">
                            <div className="text-xs text-muted-foreground">API Key</div>
                            <div className="mt-1 text-xs text-foreground">
                              {parseApiKeys(selectedProvider.apiKey).length > 0
                                ? `${parseApiKeys(selectedProvider.apiKey).length} 个`
                                : "未配置"}
                            </div>
                          </div>
                        </div>

                        <div className="border-t border-border px-5 py-4">
                          <div className="mb-3 flex items-center justify-between gap-3">
                            <div>
                              <h4 className="text-sm font-medium text-foreground">模型列表</h4>
                              <p className="mt-1 text-xs text-muted-foreground">
                                配置保存后会保留在本地项目设置中，可手动同步或测试模型。
                              </p>
                            </div>
                            <span className="rounded bg-muted px-2 py-1 text-xs text-muted-foreground">
                              {selectedProvider.model.length} 个模型
                            </span>
                          </div>

                          {selectedProvider.model.length === 0 ? (
                            <div className="rounded-lg border border-dashed border-border bg-muted/20 px-4 py-8 text-center text-sm text-muted-foreground">
                              暂无模型，请编辑供应商并填写模型，或尝试同步供应商模型。
                            </div>
                          ) : (
                            <div className="overflow-hidden rounded-lg border border-border">
                              <div className="hidden gap-3 border-b border-border bg-muted/40 px-3 py-2 text-xs font-medium text-muted-foreground md:grid md:grid-cols-[minmax(0,1fr)_88px_minmax(120px,160px)_64px_88px]">
                                <span>模型名</span>
                                <span>类型</span>
                                <span>能力</span>
                                <span>思考</span>
                                <span className="text-right">操作</span>
                              </div>
                              <div className="divide-y divide-border">
                                {selectedProvider.model.map((model) => {
                                  const modelType = inferProviderAdapterModelType(model);
                                  const modelKey = getModelTestKey(selectedProvider.id, model);
                                  const supportsThinkingModel = modelType === "text" || modelType === "vision";
                                  const thinkingOn = resolveThinkingEnabled(model, modelThinkingOverrides[model]);
                                  return (
                                    <div
                                      key={modelKey}
                                      className="grid grid-cols-1 gap-2 px-3 py-3 text-sm md:grid-cols-[minmax(0,1fr)_88px_minmax(120px,160px)_64px_88px] md:items-center md:gap-3 md:py-2"
                                    >
                                      <span className="truncate font-mono text-xs text-foreground">{model}</span>
                                      <span className="w-fit rounded bg-primary/10 px-2 py-0.5 text-xs text-primary">
                                        {MODEL_TYPE_LABELS[modelType]}
                                      </span>
                                      <span className="truncate text-xs text-muted-foreground">
                                        {formatModelCapabilities(model)}
                                      </span>
                                      {supportsThinkingModel ? (
                                        <Switch
                                          checked={thinkingOn}
                                          onCheckedChange={(checked) => setModelThinkingOverride(model, checked)}
                                          aria-label={`${model} 思考模式`}
                                          title="开启后，调用该模型时自动启用最高深度思考"
                                          className="w-fit"
                                        />
                                      ) : (
                                        <span className="text-xs text-muted-foreground">—</span>
                                      )}
                                      <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => handleTestModel(selectedProvider, model)}
                                        disabled={testingProvider === selectedProvider.id}
                                        className="w-fit md:justify-self-end"
                                      >
                                        {testingProvider === selectedProvider.id ? (
                                          <Loader2 className="h-4 w-4 animate-spin" />
                                        ) : (
                                          "测试"
                                        )}
                                      </Button>
                                      {modelTestMessages[modelKey] && (
                                        <div className="rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground md:col-span-5">
                                          {modelTestMessages[modelKey]}
                                        </div>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )}

                  {!selectedProvider && (
                    <div className="rounded-xl border border-dashed border-border bg-card px-6 py-10 text-center text-sm text-muted-foreground">
                      暂无供应商，请先添加 API 供应商。
                    </div>
                  )}

                  <div className="p-5 border border-border rounded-xl bg-card space-y-4">
                    <h3 className="font-bold text-foreground flex items-center gap-2">
                      <Settings className="h-4 w-4" />
                      运行参数
                    </h3>
                    <div className="flex flex-wrap items-center gap-3">
                      <Label className="text-xs text-muted-foreground">并发生成数</Label>
                      <Input
                        type="number"
                        min={1}
                        value={concurrency}
                        onChange={(e) => {
                          const val = parseInt(e.target.value);
                          if (val >= 1) setConcurrency(val);
                        }}
                        className="w-24"
                      />
                      <span className="text-xs text-muted-foreground">
                        同时生成的任务数量，多 Key 时会按顺序轮换。
                      </span>
                    </div>
                  </div>

                </>
              )}
            </div>
          </div>

            </div>
          </ScrollArea>
        </TabsContent>

        {/* Python Config Tab */}
        <TabsContent value="python" className="flex-1 overflow-hidden mt-0">
          <ScrollArea className="h-full">
            <div className="p-8 w-full space-y-6">
              <div className="rounded-xl border border-border bg-card p-5">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <h3 className="text-lg font-semibold text-foreground flex items-center gap-2">
                      <Terminal className="h-5 w-5 text-primary" />
                      Python 运行环境
                    </h3>
                    <p className="mt-1 text-sm text-muted-foreground">
                      不随应用启动自动配置；点击开始配置后，才会下载 Python 并安装 TTS 依赖到项目存储路径。
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      onClick={() => void handleSetupPythonRuntime()}
                      disabled={!hasTtsRuntime || isSettingUpPythonRuntime || pythonSetupActive}
                    >
                      {(isSettingUpPythonRuntime || pythonSetupActive) ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <Download className="mr-2 h-4 w-4" />
                      )}
                      开始配置
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleResetTtsRuntimeUrl}
                      disabled={isSavingTtsRuntimeConfig || !hasTtsRuntime}
                    >
                      <RotateCcw className="mr-2 h-4 w-4" />
                      恢复默认下载源
                    </Button>
                  </div>
                </div>

                {(ttsRuntimeStatus?.setupMessage || isSettingUpPythonRuntime) && (
                  <div className="mt-5 rounded-lg border border-primary/20 bg-primary/5 p-4">
                    <div className="flex items-center justify-between gap-4 text-sm">
                      <span className="font-medium text-foreground">
                        {ttsRuntimeStatus?.setupMessage || "正在配置 Python 运行环境"}
                      </span>
                      {typeof ttsRuntimeStatus?.setupProgress === "number" && (
                        <span className="font-mono text-xs text-muted-foreground">
                          {ttsRuntimeStatus.setupProgress}%
                        </span>
                      )}
                    </div>
                    {typeof ttsRuntimeStatus?.setupProgress === "number" ? (
                      <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-primary transition-all"
                          style={{ width: `${Math.max(0, Math.min(100, ttsRuntimeStatus.setupProgress))}%` }}
                        />
                      </div>
                    ) : (
                      <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
                        <div className="h-full w-1/3 animate-pulse rounded-full bg-primary/70" />
                      </div>
                    )}
                  </div>
                )}

                <div className="mt-5 grid gap-4">
                  <div className="space-y-2">
                    <Label className="text-xs text-muted-foreground">安装路径</Label>
                    <Input
                      value={ttsRuntimeConfig?.pythonRuntimeDir || "启动时读取项目存储路径"}
                      readOnly
                      className="font-mono text-xs"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs text-muted-foreground">Python 下载源</Label>
                    <div className="flex gap-2">
                      <Input
                        value={pythonRuntimeUrlDraft}
                        onChange={(event) => setPythonRuntimeUrlDraft(event.target.value)}
                        placeholder={ttsRuntimeConfig?.defaultPythonRuntimeUrl || "默认 python-build-standalone 下载源"}
                        className="font-mono text-xs"
                        disabled={!hasTtsRuntime}
                      />
                      <Button
                        onClick={() => void handleSaveTtsRuntimeConfig()}
                        disabled={isSavingTtsRuntimeConfig || !hasTtsRuntime}
                      >
                        {isSavingTtsRuntimeConfig ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}
                        保存
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      留空使用默认源；需要内网或国内镜像时，填写完整的 Python runtime 压缩包 URL。
                    </p>
                  </div>
                  {ttsRuntimeConfig?.defaultPythonRuntimeUrl && (
                    <div className="rounded-md border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
                      默认源：<span className="break-all font-mono text-foreground">{ttsRuntimeConfig.defaultPythonRuntimeUrl}</span>
                    </div>
                  )}
                </div>
              </div>

              <div className="rounded-xl border border-border bg-card p-5">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <h3 className="text-lg font-semibold text-foreground">安装明细</h3>
                    <p className="mt-1 text-sm text-muted-foreground">
                      这里展示 Python 配置过程已经安装、跳过或失败的项目。
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void refreshTtsRuntimeConfig()}
                    disabled={!hasTtsRuntime}
                  >
                    <RefreshCw className="mr-2 h-4 w-4" />
                    刷新
                  </Button>
                </div>
                <div className="mt-5 overflow-hidden rounded-lg border border-border">
                  <div className="grid gap-2 border-b border-border bg-muted/30 px-4 py-3 text-sm md:grid-cols-[160px_96px_minmax(0,1fr)] md:items-center">
                    <span className="font-medium text-foreground">Python 使用路径</span>
                    <span className="w-fit rounded px-2 py-0.5 text-xs bg-primary/10 text-primary">当前</span>
                    <span className="break-all font-mono text-xs text-foreground">{pythonExecutablePath}</span>
                  </div>
                  {pythonInstalledItems.length > 0 ? (
                    <div className="divide-y divide-border">
                      {pythonInstalledItems.map((item) => (
                        <div key={item.label} className="grid gap-2 px-4 py-3 text-sm md:grid-cols-[160px_96px_minmax(0,1fr)] md:items-center">
                          <span className="font-medium text-foreground">{item.label}</span>
                          <span className={cn(
                            "w-fit rounded px-2 py-0.5 text-xs",
                            item.status === "installed" && "bg-emerald-500/10 text-emerald-600",
                            item.status === "skipped" && "bg-blue-500/10 text-blue-600",
                            item.status === "failed" && "bg-destructive/10 text-destructive",
                            item.status === "pending" && "bg-muted text-muted-foreground",
                          )}>
                            {item.status === "installed" ? "已安装" : item.status === "skipped" ? "已存在" : item.status === "failed" ? "失败" : "等待中"}
                          </span>
                          <span className="break-all font-mono text-xs text-muted-foreground">{item.detail}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                      暂无安装记录。点击开始配置后会显示 Python 运行环境和 TTS 依赖明细。
                    </div>
                  )}
                </div>
              </div>
            </div>
          </ScrollArea>
        </TabsContent>

        {/* TTS Config Tab */}
        <TabsContent value="tts" className="flex-1 overflow-hidden mt-0">
          <Suspense fallback={<div className="flex h-40 items-center justify-center text-muted-foreground text-sm">加载中...</div>}>
            <LocalTtsPanelLazy />
          </Suspense>
        </TabsContent>

        {/* Advanced Options Tab */}
        <TabsContent value="advanced" className="flex-1 overflow-hidden mt-0">
          <ScrollArea className="h-full">
            <div className="p-8 w-full space-y-8">
              {/* Header */}
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="text-lg font-bold text-foreground flex items-center gap-2">
                    <Layers className="h-5 w-5" />
                    高级生成选项
                  </h3>
                  <p className="text-sm text-muted-foreground mt-1">
                    这些选项影响 AI 导演板块的视频生成行为
                  </p>
                </div>
                <Button 
                  variant="outline" 
                  size="sm"
                  onClick={() => {
                    resetAdvancedOptions();
                    toast.success("已恢复默认设置");
                  }}
                >
                  <RotateCcw className="h-4 w-4 mr-1" />
                  恢复默认
                </Button>
              </div>

              {/* Options List */}
              <div className="space-y-4">
                {/* Visual Continuity */}
                <div className="p-4 border border-border rounded-xl bg-card">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-3">
                      <div className="p-2 rounded-lg bg-primary/10 text-primary mt-0.5">
                        <Link2 className="h-5 w-5" />
                      </div>
                      <div>
                        <h4 className="font-medium text-foreground">视觉连续性</h4>
                        <p className="text-sm text-muted-foreground mt-1">
                          自动将上一分镜的尾帧传递给下一分镜作为参考图，保持视觉风格和角色外观的一致性
                        </p>
                        <p className="text-xs text-muted-foreground/70 mt-1">
                          默认开启 · 适合连续叙事和长视频创作
                        </p>
                      </div>
                    </div>
                    <Switch
                      checked={advancedOptions.enableVisualContinuity}
                      onCheckedChange={(checked) => setAdvancedOption('enableVisualContinuity', checked)}
                    />
                  </div>
                </div>

                {/* Resume Generation */}
                <div className="p-4 border border-border rounded-xl bg-card">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-3">
                      <div className="p-2 rounded-lg bg-primary/10 text-primary mt-0.5">
                        <Play className="h-5 w-5" />
                      </div>
                      <div>
                        <h4 className="font-medium text-foreground">断点续传</h4>
                        <p className="text-sm text-muted-foreground mt-1">
                          批量生成中断后可从上次位置继续，不需要重新开始
                        </p>
                        <p className="text-xs text-muted-foreground/70 mt-1">
                          默认开启 · 防止网络中断或 API 超时导致进度丢失
                        </p>
                      </div>
                    </div>
                    <Switch
                      checked={advancedOptions.enableResumeGeneration}
                      onCheckedChange={(checked) => setAdvancedOption('enableResumeGeneration', checked)}
                    />
                  </div>
                </div>

                {/* Content Moderation */}
                <div className="p-4 border border-border rounded-xl bg-card">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-3">
                      <div className="p-2 rounded-lg bg-primary/10 text-primary mt-0.5">
                        <ShieldAlert className="h-5 w-5" />
                      </div>
                      <div>
                        <h4 className="font-medium text-foreground">内容审核容错</h4>
                        <p className="text-sm text-muted-foreground mt-1">
                          遇到敏感内容时自动跳过该分镜，继续生成其他分镜
                        </p>
                        <p className="text-xs text-muted-foreground/70 mt-1">
                          默认开启 · 避免单个分镜失败导致整个流程中断
                        </p>
                      </div>
                    </div>
                    <Switch
                      checked={advancedOptions.enableContentModeration}
                      onCheckedChange={(checked) => setAdvancedOption('enableContentModeration', checked)}
                    />
                  </div>
                </div>

                {/* Auto Model Switch */}
                <div className="p-4 border border-border rounded-xl bg-card">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-3">
                      <div className="p-2 rounded-lg bg-muted text-muted-foreground mt-0.5">
                        <Zap className="h-5 w-5" />
                      </div>
                      <div>
                        <h4 className="font-medium text-foreground">多模型自动切换</h4>
                        <p className="text-sm text-muted-foreground mt-1">
                          首分镜使用文生视频 (t2v)，后续分镜使用图生视频 (i2v)
                        </p>
                        <p className="text-xs text-muted-foreground/70 mt-1">
                          默认关闭 · 需要配置多个模型才能使用
                        </p>
                      </div>
                    </div>
                    <Switch
                      checked={advancedOptions.enableAutoModelSwitch}
                      onCheckedChange={(checked) => setAdvancedOption('enableAutoModelSwitch', checked)}
                    />
                  </div>
                </div>
              </div>

              {/* Info Notice */}
              <div className="flex items-start gap-3 p-4 bg-muted/50 border border-border rounded-lg">
                <Info className="h-5 w-5 text-muted-foreground mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm text-muted-foreground">
                    这些选项会影响 AI 导演板块的视频生成行为。如果你不确定某个选项的作用，建议保持默认设置。
                  </p>
                </div>
              </div>

            </div>
          </ScrollArea>
        </TabsContent>

        {/* Image Host Config Tab */}
        <TabsContent value="imagehost" className="flex-1 overflow-hidden mt-0">
          <ScrollArea className="h-full">
            <div className="p-8 w-full space-y-8">
              {/* Header */}
              <div>
                <h3 className="text-lg font-bold text-foreground flex items-center gap-2">
                  <Upload className="h-5 w-5" />
                  图床配置
                </h3>
                <p className="text-sm text-muted-foreground mt-1">
                  图床用于存储视频生成过程中的临时图片（如尾帧提取、帧传递等）
                </p>
              </div>

              {/* Image Host Providers */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-medium">图床服务商</Label>
                  <Button size="sm" variant="outline" onClick={() => setImageHostAddOpen(true)}>
                    <Plus className="h-4 w-4 mr-1" />
                    添加
                  </Button>
                </div>

                {visibleImageHostProviders.length === 0 ? (
                  <div className="text-sm text-muted-foreground">暂无图床配置</div>
                ) : (
                  <div className="space-y-3">
                    {visibleImageHostProviders.map((provider) => {
                      const keyCount = getApiKeyCount(provider.apiKey);
                      const endpoint = provider.uploadPath || provider.baseUrl;
                      const configured = provider.enabled && !!endpoint && (provider.apiKeyOptional || keyCount > 0);
                      return (
                        <div key={provider.id} className="p-4 border border-border rounded-xl bg-card space-y-3">
                          <div className="flex items-start justify-between gap-3">
                            <div className="space-y-1">
                              <div className="flex items-center gap-2">
                                <span className="font-medium text-foreground">{provider.name}</span>
                                {configured ? (
                                  <span className="text-xs px-2 py-0.5 bg-green-500/10 text-green-500 rounded">
                                    已配置
                                  </span>
                                ) : (
                                  <span className="text-xs px-2 py-0.5 bg-muted text-muted-foreground rounded">
                                    未配置
                                  </span>
                                )}
                              </div>
                              <p className="text-xs text-muted-foreground">
                                {provider.platform} · {endpoint || '未设置地址'}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {provider.apiKeyOptional && keyCount === 0
                                  ? "游客上传（无需 Key）"
                                  : `${keyCount} 个 Key`}
                              </p>
                            </div>
                            <div className="flex items-center gap-2">
                              <Switch
                                checked={provider.enabled}
                                onCheckedChange={(checked) =>
                                  updateImageHostProvider({ ...provider, enabled: checked })
                                }
                              />
                            </div>
                          </div>

                          <div className="flex flex-wrap gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={!provider.enabled || testingImageHostId === provider.id}
                              onClick={() => handleTestImageHost(provider)}
                            >
                              {testingImageHostId === provider.id ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                "测试连接"
                              )}
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => handleEditImageHost(provider)}>
                              编辑
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => handleDeleteImageHost(provider.id)}>
                              删除
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Info Notice */}
              <div className="flex items-start gap-3 p-4 bg-muted/50 border border-border rounded-lg">
                <Info className="h-5 w-5 text-muted-foreground mt-0.5 shrink-0" />
                <div className="space-y-2">
                  <p className="text-sm text-muted-foreground">
                    图床用于存储视频生成过程中的临时图片，主要用于「视觉连续性」功能。
                    如果不配置图床，跨分镜的帧传递功能将受限。
                    启用多个图床会按顺序轮流使用，失败自动切换。
                  </p>
                  <p className="text-sm">
                    默认已启用 SCDN 图床，不需要填写KEY；
                    ImgBB 默认保持关闭，如需使用请手动开启并自行测试可用性。
                  </p>
                </div>
              </div>

            </div>
          </ScrollArea>
        </TabsContent>

        {/* Storage Tab */}
        <TabsContent value="storage" className="flex-1 overflow-hidden mt-0">
          <ScrollArea className="h-full">
            <div className="p-8 w-full space-y-8">
              {/* Header */}
              <div>
                <h3 className="text-lg font-bold text-foreground flex items-center gap-2">
                  <HardDrive className="h-5 w-5" />
                  存储设置
                </h3>
                <p className="text-sm text-muted-foreground mt-1">
                  设置资源共享策略、存储位置与缓存管理
                </p>
              </div>

              {!hasStorageManager && (
                <div className="flex items-start gap-3 p-4 bg-muted/50 border border-border rounded-lg">
                  <Info className="h-5 w-5 text-muted-foreground mt-0.5 shrink-0" />
                  <div>
                    <p className="text-sm text-muted-foreground">
                      存储设置仅在桌面版中可用。
                    </p>
                  </div>
                </div>
              )}

              {/* Resource Sharing */}
              <div className="p-6 border border-border rounded-xl bg-card space-y-4">
                <h4 className="font-medium text-foreground flex items-center gap-2">
                  <Folder className="h-4 w-4" />
                  资源共享
                </h4>

                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">角色库跨项目共享</p>
                    <p className="text-xs text-muted-foreground">关闭后，仅当前项目可见</p>
                  </div>
                  <Switch
                    checked={resourceSharing.shareCharacters}
                    onCheckedChange={handleToggleShareCharacters}
                    disabled={!hasStorageManager}
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">场景库跨项目共享</p>
                    <p className="text-xs text-muted-foreground">关闭后，仅当前项目可见</p>
                  </div>
                  <Switch
                    checked={resourceSharing.shareScenes}
                    onCheckedChange={handleToggleShareScenes}
                    disabled={!hasStorageManager}
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">素材库跨项目共享</p>
                    <p className="text-xs text-muted-foreground">关闭后，仅当前项目可见</p>
                  </div>
                  <Switch
                    checked={resourceSharing.shareMedia}
                    onCheckedChange={handleToggleShareMedia}
                    disabled={!hasStorageManager}
                  />
                </div>
              </div>

              {/* Storage Path - Single unified location */}
              <div className="p-6 border border-border rounded-xl bg-card space-y-5">
                <h4 className="font-medium text-foreground flex items-center gap-2">
                  <HardDrive className="h-4 w-4" />
                  存储位置
                </h4>

                <div className="space-y-3">
                  <Label className="text-xs text-muted-foreground">数据存储位置（包含项目和素材）</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      value={storagePaths.basePath || '默认位置'}
                      placeholder="默认位置"
                      readOnly
                      className="font-mono text-xs"
                    />
                    <Button size="sm" onClick={handleSelectStoragePath} disabled={!hasStorageManager}>
                      选择
                    </Button>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={handleExportData} disabled={!hasStorageManager}>
                      <Download className="h-3.5 w-3.5 mr-1" />
                      导出
                    </Button>
                    <Button variant="outline" size="sm" onClick={handleImportData} disabled={!hasStorageManager}>
                      导入
                    </Button>
                  </div>
                </div>

                <p className="text-xs text-muted-foreground">
                  ⚠️ 更改位置会移动现有数据到新目录（自动创建 projects/ 和 media/ 子目录）
                </p>
              </div>

              {/* Data Recovery - Link to existing data */}
              <div className="p-6 border border-border rounded-xl bg-card space-y-4">
                <h4 className="font-medium text-foreground flex items-center gap-2">
                  <RefreshCw className="h-4 w-4" />
                  数据恢复
                </h4>
                <p className="text-sm text-muted-foreground">
                  换设备或重装系统后，指向已有数据目录即可恢复所有配置和项目
                </p>

                <div className="space-y-3">
                  <Button 
                    variant="outline" 
                    size="sm" 
                    onClick={handleLinkData} 
                    disabled={!hasStorageManager}
                    className="w-full"
                  >
                    <Folder className="h-3.5 w-3.5 mr-1" />
                    指向已有数据目录
                  </Button>
                  <p className="text-xs text-muted-foreground">
                    💡 选择包含 projects/ 和 media/ 子目录的数据目录，操作后重启应用。
                  </p>
                </div>
              </div>

              {/* Cache Management */}
              <div className="p-6 border border-border rounded-xl bg-card space-y-4">
                <h4 className="font-medium text-foreground flex items-center gap-2">
                  <HardDrive className="h-4 w-4" />
                  缓存管理
                </h4>

                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">缓存大小</p>
                    <p className="text-xs text-muted-foreground">
                      {isCacheLoading ? "计算中..." : formatBytes(cacheSize)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={refreshCacheSize}
                      disabled={!hasStorageManager || isCacheLoading}
                    >
                      <RefreshCw className={`h-4 w-4 ${isCacheLoading ? "animate-spin" : ""}`} />
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleClearCache}
                      disabled={!hasStorageManager || isClearingCache}
                    >
                      {isClearingCache ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        "清理"
                      )}
                    </Button>
                  </div>
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">自动清理</p>
                    <p className="text-xs text-muted-foreground">默认关闭</p>
                  </div>
                  <Switch
                    checked={cacheSettings.autoCleanEnabled}
                    onCheckedChange={(checked) => setCacheSettings({ autoCleanEnabled: checked })}
                    disabled={!hasStorageManager}
                  />
                </div>

                <div className="flex items-center gap-2">
                  <Label className="text-xs text-muted-foreground">清理</Label>
                  <Input
                    type="number"
                    min={1}
                    value={cacheSettings.autoCleanDays}
                    onChange={(e) =>
                      setCacheSettings({ autoCleanDays: Math.max(1, parseInt(e.target.value) || 1) })
                    }
                    className="w-20"
                    disabled={!cacheSettings.autoCleanEnabled}
                  />
                  <span className="text-xs text-muted-foreground">天前的缓存文件</span>
                </div>
              </div>

              <div className="p-6 border border-border rounded-xl bg-card space-y-5">
                <h4 className="font-medium text-foreground flex items-center gap-2">
                  <Download className="h-4 w-4" />
                  应用更新
                </h4>

                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-sm font-medium">当前版本</p>
                    <p className="text-xs text-muted-foreground font-mono mt-1">v{appVersion}</p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleCheckForUpdates}
                    disabled={!hasAppUpdater || isCheckingForUpdates}
                  >
                    {isCheckingForUpdates ? (
                      <Loader2 className="h-4 w-4 animate-spin mr-1" />
                    ) : (
                      <RefreshCw className="h-4 w-4 mr-1" />
                    )}
                    检查更新
                  </Button>
                </div>

                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-sm font-medium">启动时自动检查更新</p>
                    <p className="text-xs text-muted-foreground">
                      开启后，桌面版启动时会自动检查远程版本清单并提示新版本
                    </p>
                  </div>
                  <Switch
                    checked={updateSettings.autoCheckEnabled}
                    onCheckedChange={(checked) => setUpdateSettings({ autoCheckEnabled: checked })}
                    disabled={!hasAppUpdater}
                  />
                </div>

                {updateSettings.ignoredVersion && (
                  <div className="flex items-center justify-between gap-4 rounded-lg border border-border bg-muted/30 px-3 py-2">
                    <div>
                      <p className="text-sm font-medium">已忽略版本</p>
                      <p className="text-xs text-muted-foreground font-mono mt-1">
                        v{updateSettings.ignoredVersion}
                      </p>
                    </div>
                    <Button variant="ghost" size="sm" onClick={handleClearIgnoredVersion}>
                      恢复提醒
                    </Button>
                  </div>
                )}

                {!hasAppUpdater && (
                  <p className="text-xs text-muted-foreground">
                    此功能仅在桌面打包版中可用。
                  </p>
                )}
              </div>

            </div>
          </ScrollArea>
        </TabsContent>

        <TabsContent value="development" className="flex-1 overflow-hidden mt-0">
          <ScrollArea className="h-full">
            <div className="p-8 w-full space-y-6">
              <div>
                <h3 className="text-lg font-semibold text-foreground">开发模式</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  用于排查页面、网络、接口和渲染日志。普通制作流程无需开启。
                </p>
              </div>

              <div className="p-6 border border-border rounded-xl bg-card space-y-5">
                <h4 className="font-medium text-foreground flex items-center gap-2">
                  <Terminal className="h-4 w-4" />
                  控制台
                </h4>

                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-sm font-medium">显示开发工具入口</p>
                    <p className="text-xs text-muted-foreground">
                      开启后显示「打开控制台」按钮，用于当前窗口的 Chromium DevTools。
                    </p>
                  </div>
                  <Switch
                    checked={developmentSettings.showDevToolsControls}
                    onCheckedChange={(checked) =>
                      setDevelopmentSettings({ showDevToolsControls: checked })
                    }
                  />
                </div>

                {developmentSettings.showDevToolsControls && (
                  <div className="flex items-center justify-between gap-4 rounded-lg border border-border bg-muted/30 px-3 py-3">
                    <div>
                      <p className="text-sm font-medium">打开控制台</p>
                      <p className="text-xs text-muted-foreground">
                        会打开当前桌面窗口对应的 DevTools 调试面板。
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleOpenDevTools}
                      disabled={!hasElectronDevTools || isOpeningDevTools}
                    >
                      {isOpeningDevTools ? (
                        <Loader2 className="h-4 w-4 animate-spin mr-1" />
                      ) : (
                        <Terminal className="h-4 w-4 mr-1" />
                      )}
                      打开控制台
                    </Button>
                  </div>
                )}

                {!hasElectronDevTools && (
                  <p className="text-xs text-muted-foreground">
                    控制台入口仅在桌面应用窗口中可用。
                  </p>
                )}
              </div>
            </div>
          </ScrollArea>
        </TabsContent>

        <TabsContent value="support" className="flex-1 overflow-hidden mt-0">
          <ScrollArea className="h-full">
            <div className="p-8 w-full space-y-8">
              <div className="text-center space-y-2">
                <h3 className="text-2xl font-bold text-foreground flex items-center justify-center gap-2">
                  <Coffee className="h-6 w-6 text-amber-500" />
                  请作者喝杯咖啡
                </h3>
                <p className="text-sm text-muted-foreground">
                  漫影工作室是免费开源项目，如果它对你有帮助，欢迎扫码请作者喝杯咖啡 ☕，你的支持是持续更新的动力。
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                <div className="rounded-xl border border-border bg-card p-5 text-center space-y-3">
                  <p className="text-sm font-medium text-foreground">微信支付</p>
                  <div className="bg-white rounded-lg p-3 inline-block">
                    <img src={wechatPayImg} alt="微信收款码" className="w-full max-w-[240px] h-auto rounded" />
                  </div>
                </div>
                <div className="rounded-xl border border-border bg-card p-5 text-center space-y-3">
                  <p className="text-sm font-medium text-foreground">支付宝</p>
                  <div className="bg-white rounded-lg p-3 inline-block">
                    <img src={alipayPayImg} alt="支付宝收款码" className="w-full max-w-[240px] h-auto rounded" />
                  </div>
                </div>
              </div>

              <div className="rounded-xl border border-border bg-card p-5 text-center space-y-3">
                <p className="text-sm font-medium text-foreground">联系作者</p>
                <p className="text-xs text-muted-foreground">竹海晨金 · 提需求、交流合作、反馈 Bug</p>
                <div className="bg-white rounded-lg p-3 inline-block">
                  <img src={wechatFriendImg} alt="作者微信" className="w-full max-w-[240px] h-auto rounded" />
                </div>
              </div>
            </div>
          </ScrollArea>
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
      <UpdateDialog
        open={updateDialogOpen}
        onOpenChange={setUpdateDialogOpen}
        updateInfo={availableUpdate}
        onIgnoreVersion={(version) => {
          setUpdateSettings({ ignoredVersion: version });
          setAvailableUpdate(null);
        }}
      />
    </div>
  );
}
