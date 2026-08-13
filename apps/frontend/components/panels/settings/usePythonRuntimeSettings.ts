import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  getTtsRuntimeConfig,
  getTtsRuntimeStatus,
  setTtsRuntimeConfig,
  setupTtsRuntime,
  readPythonRequirements,
  deletePythonRuntime,
} from "@/lib/tts/client";
import { getTtsRuntimeBridge } from "@/lib/bridge/tts-runtime";
import type { TtsRuntimeConfig, TtsRuntimeStatus } from "@/types/tts";
import { getPythonExecutableDisplayPath } from "./settings-model-utils";

const ACTIVE_SETUP_STAGES = new Set([
  "checking",
  "downloading-python",
  "extracting-python",
  "installing-deps",
]);

export function usePythonRuntimeSettings() {
  const [config, setConfig] = useState<TtsRuntimeConfig | null>(null);
  const [status, setStatus] = useState<TtsRuntimeStatus | null>(null);
  const [pythonRuntimeUrlDraft, setPythonRuntimeUrlDraft] = useState("");
  const [requirements, setRequirements] = useState<{ content: string; path: string } | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isSettingUp, setIsSettingUp] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const setupPollRef = useRef<number | null>(null);
  const hasRuntime = Boolean(getTtsRuntimeBridge());

  const stopSetupPolling = useCallback(() => {
    if (setupPollRef.current === null) return;
    window.clearInterval(setupPollRef.current);
    setupPollRef.current = null;
  }, []);

  const refreshConfig = useCallback(async () => {
    const nextConfig = await getTtsRuntimeConfig();
    setConfig(nextConfig);
    setPythonRuntimeUrlDraft(nextConfig.pythonRuntimeUrl || "");
    return nextConfig;
  }, []);

  const refreshRequirements = useCallback(async () => {
    try {
      setRequirements(await readPythonRequirements());
    } catch {
      setRequirements(null);
    }
  }, []);

  useEffect(() => {
    if (!hasRuntime) return;
    let cancelled = false;

    Promise.all([getTtsRuntimeConfig(), getTtsRuntimeStatus()])
      .then(([nextConfig, nextStatus]) => {
        if (cancelled) return;
        setConfig(nextConfig);
        setStatus(nextStatus);
        setPythonRuntimeUrlDraft(nextConfig.pythonRuntimeUrl || "");
      })
      .catch(() => {});

    void refreshRequirements();

    return () => {
      cancelled = true;
      stopSetupPolling();
    };
  }, [hasRuntime, refreshRequirements, stopSetupPolling]);

  const saveConfig = useCallback(async (pythonRuntimeUrl = pythonRuntimeUrlDraft) => {
    setIsSaving(true);
    try {
      const result = await setTtsRuntimeConfig({ pythonRuntimeUrl });
      if (!result.success) {
        toast.error(result.error || "Python 运行环境配置保存失败");
        return;
      }
      await refreshConfig();
      toast.success("Python 运行环境配置已保存");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Python 运行环境配置保存失败");
    } finally {
      setIsSaving(false);
    }
  }, [pythonRuntimeUrlDraft, refreshConfig]);

  const resetRuntimeUrl = useCallback(() => {
    if (!config?.defaultPythonRuntimeUrl) return;
    setPythonRuntimeUrlDraft(config.defaultPythonRuntimeUrl);
    void saveConfig(config.defaultPythonRuntimeUrl);
// eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config, config?.defaultPythonRuntimeUrl, saveConfig]);

  const setupRuntime = useCallback(async () => {
    setIsSettingUp(true);
    stopSetupPolling();
    try {
      setupPollRef.current = window.setInterval(() => {
        void getTtsRuntimeStatus().then(setStatus).catch(() => {});
      }, 500);
      const result = await setupTtsRuntime();
      if (result.status) setStatus(result.status);
      await refreshConfig();
      if (result.success) {
        toast.success("Python 运行环境配置完成");
      } else {
        toast.error(result.error || "Python 运行环境配置失败");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Python 运行环境配置失败");
    } finally {
      stopSetupPolling();
      setIsSettingUp(false);
    }
  }, [refreshConfig, stopSetupPolling]);

  const deleteRuntime = useCallback(async () => {
    setIsDeleting(true);
    try {
      const result = await deletePythonRuntime();
      if (!result.success) {
        toast.error(result.error || "删除失败");
        return false;
      }
      await refreshConfig();
      await refreshRequirements();
      toast.success("已删除 Python 运行环境");
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "删除 Python 运行环境失败");
      return false;
    } finally {
      setIsDeleting(false);
    }
  }, [refreshConfig, refreshRequirements]);

  const setupStage = status?.setupStage ?? "idle";
  const isSetupActive = ACTIVE_SETUP_STAGES.has(setupStage);
  const installedItems = config?.installedItems ?? [];
  const pythonExecutablePath = useMemo(
    () => getPythonExecutableDisplayPath(config),
    [config],
  );

  return {
    config,
    status,
    pythonRuntimeUrlDraft,
    setPythonRuntimeUrlDraft,
    requirements,
    hasRuntime,
    isSaving,
    isSettingUp,
    isDeleting,
    isSetupActive,
    installedItems,
    pythonExecutablePath,
    refreshConfig,
    refreshRequirements,
    resetRuntimeUrl,
    saveConfig,
    setupRuntime,
    deleteRuntime,
  };
}
