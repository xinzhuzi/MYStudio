import { useEffect, useMemo, useState } from "react";
import { AddProviderDialog, EditProviderDialog } from "@/components/api-manager";
import { useStudioConfigStore } from "@/stores/studio-config-store";
import { useAppSettingsStore } from "@/stores/app-settings-store";
import { useAPIConfigStore, type IProvider } from "@/stores/api-config-store";
import { classifyModelByName, parseApiKeys } from "@/lib/api-key-manager";
import { resolveThinkingEnabled } from "@/lib/ai/thinking-mode";
import {
  prepareModelTestRequest,
  type ModelTestResult,
  type ModelTestType,
} from "@/lib/api-manager/model-test";
import { createOperationId, logEvent } from "@/lib/diagnostics/logger";
import { toast } from "sonner";
import { ApiSettingsTab } from "./ApiSettingsTab";
import {
  buildProviderAdapterTemplate,
  getProviderDisplayName,
  inferProviderAdapterModelType,
} from "./settings-model-utils";

function inferModelTestType(model: string): ModelTestType {
  if (inferProviderAdapterModelType(model) === "tts") return "tts";
  const capabilities = classifyModelByName(model);
  if (capabilities.includes("video_generation")) return "video";
  if (capabilities.includes("image_generation")) return "image";
  if (capabilities.includes("vision") && !capabilities.includes("text")) return "vision";
  return "text";
}

function getModelTestKey(providerId: string, model: string) {
  return `${providerId}:${model || "__empty__"}`;
}

export function ApiSettingsContainer() {
  const {
    providers,
    addProvider,
    updateProvider,
    removeProvider,
    syncProviderModels,
    upsertProviderAdapterCode,
    getModelThinkingOverride,
  } = useAPIConfigStore();
  const imageGenerationSettings = useAppSettingsStore((state) => state.imageGenerationSettings);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingProvider, setEditingProvider] = useState<IProvider | null>(null);
  const [testingProvider, setTestingProvider] = useState<string | null>(null);
  const [modelTestMessages, setModelTestMessages] = useState<Record<string, string>>({});
  const [syncingProvider, setSyncingProvider] = useState<string | null>(null);

  const visibleProviders = useMemo(
    () => providers.filter((provider) => (
      provider.platform !== "memefast" || parseApiKeys(provider.apiKey).length > 0
    )),
    [providers],
  );
  const existingPlatforms = useMemo(
    () => visibleProviders.map((provider) => provider.platform),
    [visibleProviders],
  );
  const configuredCount = visibleProviders.filter(
    (provider) => parseApiKeys(provider.apiKey).length > 0,
  ).length;

  const runProviderModelTest = async (
    provider: IProvider,
    model: string,
    options: { showToast?: boolean } = {},
  ): Promise<ModelTestResult | null> => {
    const showToast = options.showToast ?? true;
    const type = inferModelTestType(model);
    const testKey = getModelTestKey(provider.id, model);
    const operationId = createOperationId("model-test");
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
    setModelTestMessages((previous) => ({ ...previous, [testKey]: "" }));

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
      setModelTestMessages((previous) => ({ ...previous, [testKey]: prepared.error }));
      if (showToast) toast.error(prepared.error);
      return null;
    }

    if (!window.electronAPI?.testModel) {
      setTestingProvider(null);
      if (prepared.dryRun) {
        setModelTestMessages((previous) => ({ ...previous, [testKey]: prepared.message }));
        if (showToast) toast.success(prepared.message);
        return { success: true, message: prepared.message };
      }
      const message = "模型测试接口仅在桌面应用中可用";
      setModelTestMessages((previous) => ({ ...previous, [testKey]: message }));
      if (showToast) toast.error(message);
      return { success: false, error: message };
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
      setModelTestMessages((previous) => ({
        ...previous,
        [testKey]: result.message || result.error || (result.success ? "测试通过" : "测试失败"),
      }));
      if (result.success) {
        if (result.protocol) updateProvider({ ...provider, apiProtocol: result.protocol });
        if (showToast) toast.success(result.message || "模型测试通过");
      } else if (showToast) {
        toast.error(result.error || "模型测试失败");
      }
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : "连接测试失败，请检查网络";
      setModelTestMessages((previous) => ({ ...previous, [testKey]: message }));
      if (showToast) toast.error(message);
      return { success: false, error: message };
    } finally {
      setTestingProvider(null);
    }
  };

  const syncModels = async (provider: IProvider, automatic = false) => {
    setSyncingProvider(provider.id);
    try {
      const result = await syncProviderModels(provider.id);
      if (result.success) {
        toast.success(`${automatic ? "已自动同步" : "已同步"} ${result.count} 个模型`);
      } else if (result.error) {
        toast.error(`模型同步失败: ${result.error}`);
      }
    } finally {
      setSyncingProvider(null);
    }
  };

  const testSavedProvider = (provider: IProvider, emptyModelMessage: string) => {
    if (
      parseApiKeys(provider.apiKey).length === 0
      && provider.platform !== "manying-local-tts"
      && provider.platform !== "tts-compatible"
    ) return;

    const firstModel = provider.model[0];
    if (!firstModel) {
      toast.message(emptyModelMessage);
      return;
    }
    void runProviderModelTest(provider, firstModel, { showToast: false }).then((testResult) => {
      if (!testResult?.success) {
        toast.error(testResult?.error || "模型自动测试失败");
        return;
      }
      toast.success(testResult.message || "模型自动测试通过");
      if (testResult.protocol === "openai-compatible") {
        void syncModels(provider, true);
      }
    });
  };

  return (
    <>
      <ApiSettingsTab
        providers={visibleProviders}
        configuredCount={configuredCount}
        syncingProviderId={syncingProvider}
        testingProviderId={testingProvider}
        modelTestMessages={modelTestMessages}
        onAdd={() => setAddDialogOpen(true)}
        onDelete={(provider) => {
          const confirmed = window.confirm(
            `删除供应商「${getProviderDisplayName(provider)}」？相关模型映射和 Agent 绑定也会清理。`,
          );
          if (!confirmed) return;
          removeProvider(provider.id);
          toast.success("已删除供应商");
        }}
        onEdit={(provider) => {
          setEditingProvider(provider);
          setEditDialogOpen(true);
        }}
        onSync={(provider) => { void syncModels(provider); }}
        onTest={(provider, model) => { void runProviderModelTest(provider, model); }}
      />
      <AddProviderDialog
        open={addDialogOpen}
        onOpenChange={setAddDialogOpen}
        onSubmit={(providerData) => {
          const provider = addProvider(providerData);
          upsertProviderAdapterCode(provider.id, buildProviderAdapterTemplate(provider));
          testSavedProvider(provider, "供应商已添加，请填写模型后再测试连接");
        }}
        existingPlatforms={existingPlatforms}
      />
      <EditProviderDialog
        open={editDialogOpen}
        onOpenChange={setEditDialogOpen}
        provider={editingProvider}
        onSave={(provider) => {
          updateProvider(provider);
          testSavedProvider(provider, "供应商已保存，请填写模型后再测试连接");
        }}
      />
    </>
  );
}

export function ApiSettingsMigration() {
  const bindings = useStudioConfigStore((state) => state.bindings);
  const migrateStudioBindings = useAPIConfigStore((state) => state.migrateStudioBindings);

  useEffect(() => {
    if (bindings.length > 0) migrateStudioBindings(bindings);
  }, [bindings, migrateStudioBindings]);

  return null;
}
