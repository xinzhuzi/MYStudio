"use client";

import { type ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { getStorageManagerBridge } from "@/lib/bridge/storage-manager";
import { getStudioAssetsBridge } from "@/lib/bridge/studio-assets";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  TTS_MODEL_GROUPS,
  applyModelStatuses,
  groupTtsModelsByPurpose,
} from "@/lib/tts/model-catalog";
import {
  getAllPresetVoices,
  getDefaultModelSizeForEngine,
  resolvePresetVoiceSelection,
  supportsVoiceInstruction,
  validateVoiceProfileForGeneration,
} from "@/lib/tts/voice-profile-capabilities";
import {
  cancelModelDownload,
  deleteModel,
  downloadModel,
  getActiveTasks,
  getModelCacheDir,
  getModelStatus,
  getTtsRuntimeStatus,
  migrateTtsRuntimeStorage,
  scanTtsModelInventory,
  setTtsModelCacheDir,
  startTtsRuntime,
  stopTtsRuntime,
  subscribeModelProgress,
  unloadModel,
} from "@/lib/tts/client";
import type { TtsActiveTasksResponse, TtsEngine, TtsModelCacheInfo, TtsModelRow, TtsRuntimeStatus } from "@/types/tts";
import { useTtsStore } from "@/stores/tts/tts-store";
import { VoiceProfileSection } from "./VoiceProfileSection";
import { LocalTtsRuntimeCard } from "./LocalTtsRuntimeCard";
import { applyLocalTtsRuntimeStatus, canApplyLocalTtsUpdate } from "./local-tts-panel-lifecycle";
import {
  getLocalTtsModelState,
  type ModelProgressEvent,
} from "./local-tts-model-state";
import {
  ErrorBanner,
  LocalTtsModelDetailsDialog,
  ModelRow,
  NativeTtsSelect,
} from "./LocalTtsPanelPresentation";

const purposeGroups = groupTtsModelsByPurpose();

type LocalTtsPanelProps = {
  embedded?: boolean;
};

export function LocalTtsPanel({ embedded = false }: LocalTtsPanelProps) {
  const [runtimeStatus, setRuntimeStatus] = useState<TtsRuntimeStatus | null>(null);
  const [modelCacheInfo, setModelCacheInfo] = useState<TtsModelCacheInfo | null>(null);
  const [rows, setRows] = useState<TtsModelRow[]>(() => applyModelStatuses([]));
  const [activeTasks, setActiveTasks] = useState<TtsActiveTasksResponse>({ downloads: [], generations: [] });
  const [progressByModel, setProgressByModel] = useState<Record<string, ModelProgressEvent>>({});
  const [selectedModel, setSelectedModel] = useState<TtsModelRow | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [starting, setStarting] = useState(false);
  const [applyingModelCacheDir, setApplyingModelCacheDir] = useState(false);
  const [migratingStorage, setMigratingStorage] = useState(false);
  const [draftModelCacheDir, setDraftModelCacheDir] = useState("");
  const [modelCacheDirty, setModelCacheDirty] = useState(false);
  const modelCacheDirtyRef = useRef(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [newProfileName, setNewProfileName] = useState("旁白声线");
  // 隐藏引擎方向：用户只看到"音色"或"克隆"两个来源；
  // preset 模式下引擎由音色 ID 自动 derive，clone 模式才需要用户显式选引擎
  const [newProfileMode, setNewProfileMode] = useState<"preset" | "clone">("preset");
  const [newProfileEngine, setNewProfileEngine] = useState<TtsEngine>("qwen");
  const [newProfileLanguage, setNewProfileLanguage] = useState("zh");
  const [newProfileModelSize, setNewProfileModelSize] = useState("0.6B");
  const [newProfileReferencePath, setNewProfileReferencePath] = useState("");
  const [newProfileReferenceText, setNewProfileReferenceText] = useState("");
  // 统一音色 ID，格式 `${engine}:${voiceId}`；空串 = 未选
  const [newProfileVoiceId, setNewProfileVoiceId] = useState<string>("");
  const [newProfileInstruct, setNewProfileInstruct] = useState("");
  const [uploadingReference, setUploadingReference] = useState(false);
  const referenceInputRef = useRef<HTMLInputElement>(null);
  const subscriptions = useRef<Record<string, () => void>>({});
  const mountedRef = useRef(true);
  const voiceProfilesById = useTtsStore((state) => state.voiceProfiles);
  const createVoiceProfile = useTtsStore((state) => state.createVoiceProfile);
  const voiceProfiles = useMemo(() => Object.values(voiceProfilesById), [voiceProfilesById]);

  const groupedRows = useMemo(() => {
    const byName = new Map(rows.map((row) => [row.modelName, row]));
    return TTS_MODEL_GROUPS.map((group) => ({
      ...group,
      models: group.models.map((model) => byName.get(model.modelName)).filter(Boolean) as TtsModelRow[],
    }));
  }, [rows]);

  // 统一音色库：所有引擎的预设音色合并展示
  const unifiedPresetVoices = useMemo(
    () => getAllPresetVoices(newProfileLanguage),
    [newProfileLanguage],
  );

  // preset 模式：引擎从音色 ID 派生
  const presetSelection = useMemo(
    () => (newProfileMode === "preset" ? resolvePresetVoiceSelection(newProfileVoiceId, newProfileLanguage) : null),
    [newProfileMode, newProfileVoiceId, newProfileLanguage],
  );
  const newProfileType: "reference" | "preset" = newProfileMode === "preset" ? "preset" : "reference";

  const handleEngineChange = (engine: TtsEngine) => {
    setNewProfileEngine(engine);
    setNewProfileModelSize(getDefaultModelSizeForEngine(engine) || "default");
    if (!supportsVoiceInstruction(engine)) {
      setNewProfileInstruct("");
    }
  };

  const handleLanguageChange = (language: string) => {
    setNewProfileLanguage(language);
    // 切语言时清空已选音色（语言不再匹配）
    setNewProfileVoiceId("");
  };

  const handleModeChange = (mode: "preset" | "clone") => {
    setNewProfileMode(mode);
    setNewProfileVoiceId("");
    setNewProfileReferencePath("");
    setNewProfileReferenceText("");
  };

  const attachProgress = useCallback(async (modelName: string) => {
    if (subscriptions.current[modelName]) return;
    try {
      subscriptions.current[modelName] = await subscribeModelProgress(
        modelName,
        (event) => {
          if (!canApplyLocalTtsUpdate(mountedRef.current)) return;
          const next = event as ModelProgressEvent;
          setProgressByModel((prev) => ({ ...prev, [modelName]: next }));
          if (next.status === "error" && next.error) {
            setErrors((prev) => ({ ...prev, [modelName]: next.error || "下载失败" }));
          }
          if (next.status === "complete") {
            toast.success(`${modelName} 下载完成`);
          }
          if (next.status === "complete" || next.status === "error") {
            subscriptions.current[modelName]?.();
            delete subscriptions.current[modelName];
          }
        },
        () => {
          subscriptions.current[modelName]?.();
          delete subscriptions.current[modelName];
        },
      );
    } catch (error) {
      if (canApplyLocalTtsUpdate(mountedRef.current)) {
        setErrors((prev) => ({ ...prev, [modelName]: error instanceof Error ? error.message : "订阅下载进度失败" }));
      }
    }
  }, []);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const status = await getTtsRuntimeStatus();
      if (!canApplyLocalTtsUpdate(mountedRef.current)) return null;
      setRuntimeStatus(status);
      if (!modelCacheDirtyRef.current) {
        setDraftModelCacheDir(status.modelCacheDir || "");
      }
      if (!status.running) {
        // Backend is stopped: use the offline model inventory (managed Python
        // scanner, no HTTP server, no network) so users still see which models
        // are already downloaded. Fail-closed to an empty catalog on errors.
        const [inventory] = await Promise.all([scanTtsModelInventory().catch(() => [])]);
        if (!canApplyLocalTtsUpdate(mountedRef.current)) return status;
        setModelCacheInfo(null);
        setRows(applyModelStatuses(inventory));
        setActiveTasks({ downloads: [], generations: [] });
        setErrors((prev) => {
          const next = { ...prev };
          delete next.runtime;
          return next;
        });
        return status;
      }
      const [modelStatus, tasks, cacheInfo] = await Promise.all([
        getModelStatus(),
        getActiveTasks(),
        getModelCacheDir(),
      ]);
      if (!canApplyLocalTtsUpdate(mountedRef.current)) return status;
      setModelCacheInfo(cacheInfo);
      setRows(applyModelStatuses(modelStatus.models));
      setActiveTasks(tasks);
      tasks.downloads.forEach((task) => {
        if (task.model_name) void attachProgress(task.model_name);
      });
      setErrors((prev) => {
        const next = { ...prev };
        delete next.runtime;
        return next;
      });
      return status;
    } catch (error) {
      if (canApplyLocalTtsUpdate(mountedRef.current)) {
        setErrors((prev) => ({ ...prev, runtime: error instanceof Error ? error.message : "刷新本地 TTS 状态失败" }));
      }
      return null;
    } finally {
      if (canApplyLocalTtsUpdate(mountedRef.current)) setRefreshing(false);
    }
  }, [attachProgress]);

  useEffect(() => {
    mountedRef.current = true;
    let disposed = false;
    let timer: number | undefined;
    // 延迟检查，避免切换侧边栏时阻塞
    const delay = setTimeout(() => {
      void refresh().then((status) => {
        if (disposed) return;
        if (status?.running) {
          timer = window.setInterval(() => void refresh(), 5000);
        }
      });
    }, 500);
    return () => {
      disposed = true;
      mountedRef.current = false;
      clearTimeout(delay);
      if (timer) window.clearInterval(timer);
      Object.values(subscriptions.current).forEach((close) => close());
      subscriptions.current = {};
    };
  }, [refresh]);

  useEffect(() => () => {
    mountedRef.current = false;
  }, []);

  useEffect(() => {
    setSelectedModel((current) => {
      if (!current) return current;
      return rows.find((row) => row.modelName === current.modelName) ?? current;
    });
  }, [rows]);

  const handleStart = async () => {
    setStarting(true);
    let setupPoll: number | undefined;
    try {
      setupPoll = window.setInterval(() => {
        void getTtsRuntimeStatus()
          .then((status) => {
            applyLocalTtsRuntimeStatus(mountedRef.current, status, setRuntimeStatus);
          })
          .catch(() => {});
      }, 500);
      const result = await startTtsRuntime();
      if (!mountedRef.current) return;
      if (result.success) {
        toast.success("本地 TTS 后端已启动");
      } else {
        toast.error(result.error || "本地 TTS 后端启动失败");
      }
      if (mountedRef.current) await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "启动失败");
    } finally {
      if (setupPoll) window.clearInterval(setupPoll);
      if (mountedRef.current) setStarting(false);
    }
  };

  const handleManualRefresh = async () => {
    const status = await refresh();
    if (!status) {
      toast.error("本地 TTS 状态刷新失败");
      return;
    }
    toast.success(`已刷新：${status.running ? (status.managed === false ? "运行中（残留进程）" : "运行中") : "未运行"}`);
  };

  const handleStop = async () => {
    const result = await stopTtsRuntime();
    if (result.success) {
      toast.success("本地 TTS 后端已停止");
    } else {
      toast.error(result.error || "本地 TTS 后端停止失败");
    }
    await refresh();
  };

  const handleMigrateStorage = async () => {
    if (!window.confirm("将停止本地 TTS，并把旧目录及 Hugging Face 模型按校验结果移动到 TTS 文件夹。内容不一致时会取消迁移。是否继续？")) return;
    setMigratingStorage(true);
    try {
      const result = await migrateTtsRuntimeStorage();
      if (result.success) {
        toast.success("TTS 文件夹已迁移");
      } else {
        toast.error(result.error || "TTS 文件夹迁移失败");
      }
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "TTS 文件夹迁移失败");
    } finally {
      if (mountedRef.current) setMigratingStorage(false);
    }
  };

  const handleModelCacheInputChange = (value: string) => {
    setDraftModelCacheDir(value);
    setModelCacheDirty(true); modelCacheDirtyRef.current = true;
  };

  const handleApplyModelCacheDir = async (dirPath = draftModelCacheDir) => {
    if (runtimeStatus?.running) {
      toast.error("请先停止本地 TTS，再切换模型缓存路径");
      return;
    }
    const nextDir = dirPath.trim();
    if (!nextDir) {
      toast.error("请输入模型缓存路径");
      return;
    }
    setApplyingModelCacheDir(true);
    try {
      const result = await setTtsModelCacheDir(nextDir);
      if (!result.success) {
        toast.error(result.error || "模型缓存路径切换失败");
        await refresh();
        return;
      }
      setModelCacheDirty(false); modelCacheDirtyRef.current = false;
      setDraftModelCacheDir(result.status?.modelCacheDir || nextDir);
      toast.success("模型缓存路径已切换");
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "模型缓存路径切换失败");
    } finally {
      setApplyingModelCacheDir(false);
    }
  };

  const handleSelectModelCacheDir = async () => {
    const storageManager = getStorageManagerBridge();
    if (!storageManager?.selectDirectory) {
      toast.error("选择文件夹仅在桌面应用中可用");
      return;
    }
    const dir = await storageManager.selectDirectory();
    if (!dir) return;
    setDraftModelCacheDir(dir);
    setModelCacheDirty(true); modelCacheDirtyRef.current = true;
    await handleApplyModelCacheDir(dir);
  };

  const handleOpenModelCacheDir = async () => {
    const target = runtimeStatus?.modelCacheDir?.trim();
    if (!target || !window.electronAPI?.openPath) {
      toast.error("没有可打开的模型目录");
      return;
    }
    try {
      const result = await window.electronAPI.openPath(target);
      if (!result.success) toast.error(result.error || "打开模型目录失败");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "打开模型目录失败");
    }
  };

  const handleResetModelCacheDir = async () => {
    const defaultDir = runtimeStatus?.defaultModelCacheDir?.trim();
    if (!defaultDir) {
      toast.error("默认模型目录尚未读取");
      return;
    }
    setDraftModelCacheDir(defaultDir);
    setModelCacheDirty(true); modelCacheDirtyRef.current = true;
    await handleApplyModelCacheDir(defaultDir);
  };

  const handleDownload = async (row: TtsModelRow) => {
    try {
      await downloadModel(row.modelName);
      toast.info(`${row.displayName} 开始下载`);
      await attachProgress(row.modelName);
      await refresh();
    } catch (error) {
      setErrors((prev) => ({ ...prev, [row.modelName]: error instanceof Error ? error.message : "下载失败" }));
    }
  };

  const handleCancel = async (row: TtsModelRow) => {
    await cancelModelDownload(row.modelName);
    setProgressByModel((prev) => ({ ...prev, [row.modelName]: { model_name: row.modelName, current: 0, total: 0, progress: 0, status: "error", error: "已停止下载" } }));
    await refresh();
  };

  const handleDelete = async (row: TtsModelRow) => {
    if (!window.confirm(`删除模型缓存「${row.displayName}」？`)) return;
    try {
      await deleteModel(row.modelName);
      toast.success("模型缓存已删除");
      setSelectedModel(null);
      await refresh();
    } catch (error) {
      setErrors((prev) => ({ ...prev, [row.modelName]: error instanceof Error ? error.message : "删除失败" }));
    }
  };

  const handleUnload = async (row: TtsModelRow) => {
    await unloadModel(row.modelName);
    toast.success("模型已从内存卸载");
    await refresh();
  };

  const handleCreateProfile = () => {
    if (!newProfileName.trim()) {
      toast.error("请输入声线名称");
      return;
    }
    // preset 模式：从统一音色 ID 派生 engine / voiceId
    // clone 模式：用户显式选的 engine
    let resolvedEngine: TtsEngine;
    let resolvedPresetVoiceId: string | undefined;
    let resolvedModelSize: string | undefined;
    if (newProfileMode === "preset") {
      if (!presetSelection) {
        toast.error("请先从音色库选择预设音色");
        return;
      }
      resolvedEngine = presetSelection.engine;
      resolvedPresetVoiceId = presetSelection.voiceId;
      resolvedModelSize = newProfileModelSize === "default" || !newProfileModelSize
        ? presetSelection.modelSize
        : newProfileModelSize;
    } else {
      resolvedEngine = newProfileEngine;
      resolvedModelSize = newProfileModelSize === "default" ? undefined : newProfileModelSize;
    }
    const candidate = {
      id: "new-profile",
      name: newProfileName.trim(),
      type: newProfileType,
      language: newProfileLanguage,
      defaultEngine: resolvedEngine,
      defaultModelSize: resolvedModelSize,
      referenceAudioPath: newProfileReferencePath.trim() || undefined,
      referenceText: newProfileReferenceText.trim() || undefined,
      presetVoiceId: resolvedPresetVoiceId,
      instruct: newProfileInstruct.trim() || undefined,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const validationError = validateVoiceProfileForGeneration(candidate);
    if (validationError) {
      toast.error(validationError);
      return;
    }
    createVoiceProfile({
      name: newProfileName.trim(),
      type: newProfileType,
      language: newProfileLanguage,
      defaultEngine: resolvedEngine,
      defaultModelSize: resolvedModelSize,
      referenceAudioPath: newProfileReferencePath.trim() || undefined,
      referenceText: newProfileReferenceText.trim() || undefined,
      presetVoiceId: resolvedPresetVoiceId,
      instruct: newProfileInstruct.trim() || undefined,
    });
    setNewProfileName("旁白声线");
    setNewProfileReferencePath("");
    setNewProfileReferenceText("");
    setNewProfileInstruct("");
    setNewProfileVoiceId("");
    toast.success(newProfileMode === "preset" ? "声线 profile 已创建（基于预设音色）" : "克隆声线已创建");
  };

  const handleReferenceAudioUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const studioAssets = getStudioAssetsBridge();
    if (!studioAssets?.saveMaterial) {
      toast.error("参考音频上传仅在桌面应用中可用");
      return;
    }

    setUploadingReference(true);
    try {
      const material = await studioAssets.saveMaterial({
        name: `voice-reference-${Date.now()}-${file.name}`,
        bytes: await file.arrayBuffer(),
      });
      if (!material.success || !material.filePath) {
        throw new Error(material.error || "保存参考音频失败");
      }
      setNewProfileReferencePath(material.filePath);
      toast.success("参考音频已导入");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "参考音频导入失败");
    } finally {
      setUploadingReference(false);
    }
  };

  const selectedProgress = selectedModel ? progressByModel[selectedModel.modelName] : undefined;
  const selectedState = selectedModel ? getLocalTtsModelState(selectedModel, selectedProgress) : "missing";

  const content = (
    <div className={embedded ? "w-full space-y-6 p-5 sm:p-8 xl:p-10" : "mx-auto max-w-6xl space-y-6 p-8"}>
        <LocalTtsRuntimeCard
          runtimeStatus={runtimeStatus}
          modelCacheInfo={modelCacheInfo}
          draftModelCacheDir={draftModelCacheDir}
          starting={starting}
          refreshing={refreshing}
          applyingModelCacheDir={applyingModelCacheDir}
          modelCacheDirty={modelCacheDirty}
          migratingStorage={migratingStorage}
          onModelCacheDirChange={handleModelCacheInputChange}
          onApplyModelCacheDir={() => void handleApplyModelCacheDir()}
          onSelectModelCacheDir={() => void handleSelectModelCacheDir()}
          onOpenModelCacheDir={() => void handleOpenModelCacheDir()}
          onResetModelCacheDir={() => void handleResetModelCacheDir()}
          onMigrateStorage={() => void handleMigrateStorage()}
          onManualRefresh={() => void handleManualRefresh()}
          onStart={() => void handleStart()}
          onStop={() => void handleStop()}
        />

        {activeTasks.downloads.length > 0 && (
          <div className="rounded-2xl border border-primary/20 bg-primary/5 backdrop-blur-lg p-4 text-sm text-primary">
            {activeTasks.downloads.length} 个模型正在下载，离开此页后后端任务仍会继续，可回到本页恢复进度。
          </div>
        )}

        <ErrorBanner errors={errors} onClear={() => setErrors({})} />

        {groupedRows.map((group) => (
          <section key={group.id} className="tts-glass-card rounded-2xl border border-border bg-card/50 backdrop-blur-xl overflow-hidden">
            <div className="border-b border-border px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h4 className="text-sm font-semibold text-foreground">{purposeGroups[group.id].title}</h4>
                  <p className="mt-1 text-xs text-muted-foreground">{purposeGroups[group.id].description}</p>
                </div>
                <span className="text-xs text-muted-foreground">{group.models.length} 个模型</span>
              </div>
            </div>
            <div className="grid grid-cols-[minmax(220px,1.4fr)_120px_160px_120px_180px] gap-3 border-b border-white/[0.06] bg-white/[0.02] px-4 py-2 text-xs font-medium text-muted-foreground">
              <span>模型</span>
              <span>引擎</span>
              <span>语言</span>
              <span>大小</span>
              <span className="text-right">操作</span>
            </div>
            {group.models.map((row) => (
              <ModelRow
                key={row.modelName}
                row={row}
                progress={progressByModel[row.modelName]}
                canDownload={runtimeStatus?.running === true}
                onOpen={setSelectedModel}
                onDownload={handleDownload}
                onCancel={handleCancel}
              />
            ))}
          </section>
        ))}

        <VoiceProfileSection
          profiles={voiceProfiles} name={newProfileName} language={newProfileLanguage} mode={newProfileMode}
          engine={newProfileEngine} modelSize={newProfileModelSize} voiceId={newProfileVoiceId}
          referencePath={newProfileReferencePath} referenceText={newProfileReferenceText} instruct={newProfileInstruct}
          uploading={uploadingReference} voices={unifiedPresetVoices} presetSelection={presetSelection}
          supportsInstruction={newProfileMode === "preset" ? presetSelection?.engine === "qwen_custom_voice" : supportsVoiceInstruction(newProfileEngine)}
          referenceInputRef={referenceInputRef} Select={NativeTtsSelect} onName={setNewProfileName} onLanguage={handleLanguageChange}
          onMode={handleModeChange} onEngine={handleEngineChange} onModelSize={setNewProfileModelSize} onVoice={setNewProfileVoiceId}
          onReferencePath={setNewProfileReferencePath} onReferenceText={setNewProfileReferenceText} onInstruct={setNewProfileInstruct}
          onUpload={event => void handleReferenceAudioUpload(event)} onCreate={handleCreateProfile}
        />
    </div>
  );

  return (
    <>
      {embedded ? content : <ScrollArea className="h-full">{content}</ScrollArea>}
      <LocalTtsModelDetailsDialog
        selectedModel={selectedModel}
        selectedState={selectedState}
        selectedProgress={selectedProgress}
        runtimeRunning={runtimeStatus?.running === true}
        onOpenChange={(open) => !open && setSelectedModel(null)}
        onCancel={(row) => void handleCancel(row)}
        onDownload={(row) => void handleDownload(row)}
        onUnload={(row) => void handleUnload(row)}
        onDelete={(row) => void handleDelete(row)}
      />
    </>
  );
}
