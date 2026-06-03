"use client";

import { type ChangeEvent, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  CircleCheck,
  CircleX,
  Download,
  ExternalLink,
  FolderOpen,
  HardDrive,
  Loader2,
  Play,
  RefreshCw,
  Server,
  Square,
  Trash2,
  Unplug,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import {
  TTS_MODEL_GROUPS,
  applyModelStatuses,
  groupTtsModelsByPurpose,
} from "@/lib/tts/model-catalog";
import {
  getDefaultModelSizeForEngine,
  getDefaultPresetVoiceId,
  getPresetVoiceOptions,
  getVoiceProfileType,
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
  setTtsModelCacheDir,
  startTtsRuntime,
  stopTtsRuntime,
  subscribeModelProgress,
  unloadModel,
} from "@/lib/tts/client";
import type { TtsActiveTasksResponse, TtsEngine, TtsModelCacheInfo, TtsModelRow, TtsRuntimeStatus } from "@/types/tts";
import { useTtsStore } from "@/stores/tts-store";
import { cn } from "@/lib/utils";

interface ModelProgressEvent {
  model_name: string;
  current: number;
  total: number;
  progress: number;
  filename?: string;
  status: "idle" | "downloading" | "complete" | "error" | string;
  error?: string;
}

const purposeGroups = groupTtsModelsByPurpose();

function NativeTtsSelect({
  value,
  onValueChange,
  children,
  className,
}: {
  value: string;
  onValueChange: (value: string) => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <select
      value={value}
      onChange={(event: ChangeEvent<HTMLSelectElement>) => onValueChange(event.target.value)}
      className={cn(
        "h-9 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground outline-hidden focus:ring-1 focus:ring-ring",
        className,
      )}
    >
      {children}
    </select>
  );
}

function formatSizeMb(sizeMb?: number | null) {
  if (!sizeMb) return "未知";
  if (sizeMb >= 1024) return `${(sizeMb / 1024).toFixed(sizeMb >= 10 * 1024 ? 1 : 2)} GB`;
  return `${Math.round(sizeMb)} MB`;
}

function formatBytes(bytes?: number) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / Math.pow(1024, index)).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function getModelState(row: TtsModelRow, progress?: ModelProgressEvent) {
  if (row.loaded) return "loaded";
  if (row.downloading) return "downloading";
  if (row.downloaded) return "downloaded";
  if (progress?.status === "downloading") return "downloading";
  if (progress?.status === "complete") return "downloaded";
  if (progress?.status === "error") return "failed";
  return "missing";
}

function ModelStateIcon({ state }: { state: string }) {
  if (state === "downloading") return <Loader2 className="h-4 w-4 animate-spin text-blue-500" />;
  if (state === "loaded") return <Play className="h-4 w-4 text-emerald-500" />;
  if (state === "downloaded") return <CircleCheck className="h-4 w-4 text-emerald-500" />;
  if (state === "failed") return <CircleX className="h-4 w-4 text-destructive" />;
  return <Download className="h-4 w-4 text-muted-foreground" />;
}

function ModelStateLabel({ state }: { state: string }) {
  if (state === "loaded") return <span className="text-xs font-medium text-emerald-500">已加载</span>;
  if (state === "downloaded") return <span className="text-xs font-medium text-emerald-500">已下载</span>;
  if (state === "failed") return <span className="text-xs font-medium text-destructive">失败</span>;
  if (state === "downloading") return <span className="text-xs font-medium text-blue-500">下载中</span>;
  return <span className="text-xs text-muted-foreground">未下载</span>;
}

function PendingScanLabel() {
  return <span className="text-xs text-muted-foreground">启动后扫描</span>;
}

function RuntimeStatusLine({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex min-w-0 gap-2 leading-6">
      <span className="shrink-0 text-muted-foreground">{label}：</span>
      <span className="min-w-0 break-all text-muted-foreground">{value}</span>
    </div>
  );
}

const runtimeSetupMessages: Record<NonNullable<TtsRuntimeStatus["setupStage"]>, string> = {
  idle: "本地 TTS 后端未启动",
  checking: "正在检查 Python 运行环境",
  "downloading-python": "正在下载 Python 运行环境",
  "extracting-python": "正在配置 Python 仓库",
  "installing-deps": "正在安装 TTS 依赖",
  "starting-backend": "本地 TTS 后端启动中",
  ready: "本地 TTS 后端已就绪",
  failed: "本地 TTS 后端启动失败",
};

function RuntimeSetupProgress({ status, starting }: { status: TtsRuntimeStatus | null; starting: boolean }) {
  const setupStage = status?.setupStage ?? "idle";
  const active = starting || ["checking", "downloading-python", "extracting-python", "installing-deps", "starting-backend"].includes(setupStage);
  const failed = setupStage === "failed";
  if (!active && !failed) return null;

  const progress = typeof status?.setupProgress === "number" ? Math.max(0, Math.min(100, status.setupProgress)) : undefined;
  const message = status?.setupMessage || runtimeSetupMessages[setupStage];

  return (
    <div className={cn(
      "mt-4 rounded-xl border p-3",
      failed ? "border-red-400/20 bg-red-500/[0.06]" : "border-primary/20 bg-primary/[0.04]",
    )}>
      <div className="flex items-center justify-between gap-3 text-sm">
        <div className={cn("flex min-w-0 items-center gap-2 font-medium", failed ? "text-destructive" : "text-foreground")}>
          {failed ? <AlertCircle className="h-4 w-4 shrink-0" /> : <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" />}
          <span className="truncate">{message}</span>
        </div>
        {typeof progress === "number" && (
          <span className="shrink-0 text-xs text-muted-foreground">{Math.round(progress)}%</span>
        )}
      </div>
      <Progress value={progress ?? (active ? 35 : 0)} className={cn("mt-3 h-1.5", progress === undefined && active && "opacity-60")} />
      {status?.pythonRuntimeDir && (
        <div className="mt-2 break-all text-xs text-muted-foreground">
          Python 路径：{status.pythonRuntimeDir}
        </div>
      )}
    </div>
  );
}

function ModelRow({
  row,
  progress,
  canDownload,
  onOpen,
  onDownload,
  onCancel,
}: {
  row: TtsModelRow;
  progress?: ModelProgressEvent;
  canDownload: boolean;
  onOpen: (row: TtsModelRow) => void;
  onDownload: (row: TtsModelRow) => void;
  onCancel: (row: TtsModelRow) => void;
}) {
  const state = getModelState(row, progress);
  const progressValue = progress?.progress ?? (state === "downloaded" || state === "loaded" ? 100 : 0);

  return (
    <div className="grid grid-cols-[minmax(220px,1.4fr)_120px_160px_120px_180px] gap-3 items-center border-b border-white/[0.06] px-4 py-3 last:border-b-0 transition-colors hover:bg-white/[0.02]">
      <button type="button" onClick={() => onOpen(row)} className="min-w-0 text-left">
        <div className="flex items-center gap-2">
          <ModelStateIcon state={state} />
          <span className="truncate text-sm font-medium text-foreground">{row.displayName}</span>
        </div>
        <div className="mt-1 truncate text-xs text-muted-foreground">{row.description}</div>
      </button>
      <div className="text-xs text-muted-foreground">{row.engine}</div>
      <div className="truncate text-xs text-muted-foreground">{row.languages.join(" / ")}</div>
      <div className="text-xs text-muted-foreground">{formatSizeMb(row.sizeMb)}</div>
      <div className="flex items-center justify-end gap-2">
        {state === "downloading" ? (
          <Button size="sm" variant="outline" onClick={() => onCancel(row)}>
            <Square className="mr-1 h-3.5 w-3.5" />
            停止
          </Button>
        ) : !canDownload && (state === "missing" || state === "failed") ? (
          <PendingScanLabel />
        ) : state === "missing" || state === "failed" ? (
          <Button size="sm" variant={state === "failed" ? "outline" : "default"} onClick={() => onDownload(row)}>
            <Download className="mr-1 h-3.5 w-3.5" />
            {state === "failed" ? "重试" : "下载"}
          </Button>
        ) : (
          <ModelStateLabel state={state} />
        )}
        <Button size="sm" variant="ghost" onClick={() => onOpen(row)}>
          详情
        </Button>
      </div>
      {(state === "downloading" || state === "failed") && (
        <div className="col-span-5 pl-6 pr-2">
          <Progress value={progressValue} className="h-1.5" />
          <div className="mt-1 flex items-center justify-between gap-3 text-xs text-muted-foreground">
            <span className="truncate">{progress?.filename || (state === "failed" ? progress?.error || "下载失败" : "准备下载...")}</span>
            <span className="shrink-0">
              {state === "downloading"
                ? `${Math.round(progressValue)}% · ${formatBytes(progress?.current)} / ${formatBytes(progress?.total)}`
                : "失败"}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

export function LocalTtsPanel() {
  const [runtimeStatus, setRuntimeStatus] = useState<TtsRuntimeStatus | null>(null);
  const [modelCacheInfo, setModelCacheInfo] = useState<TtsModelCacheInfo | null>(null);
  const [rows, setRows] = useState<TtsModelRow[]>(() => applyModelStatuses([]));
  const [activeTasks, setActiveTasks] = useState<TtsActiveTasksResponse>({ downloads: [], generations: [] });
  const [progressByModel, setProgressByModel] = useState<Record<string, ModelProgressEvent>>({});
  const [selectedModel, setSelectedModel] = useState<TtsModelRow | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [starting, setStarting] = useState(false);
  const [applyingModelCacheDir, setApplyingModelCacheDir] = useState(false);
  const [draftModelCacheDir, setDraftModelCacheDir] = useState("");
  const [modelCacheDirty, setModelCacheDirty] = useState(false);
  const modelCacheDirtyRef = useRef(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [newProfileName, setNewProfileName] = useState("旁白声线");
  const [newProfileEngine, setNewProfileEngine] = useState<TtsEngine>("qwen");
  const [newProfileLanguage, setNewProfileLanguage] = useState("zh");
  const [newProfileModelSize, setNewProfileModelSize] = useState("0.6B");
  const [newProfileReferencePath, setNewProfileReferencePath] = useState("");
  const [newProfileReferenceText, setNewProfileReferenceText] = useState("");
  const [newProfilePresetVoiceId, setNewProfilePresetVoiceId] = useState("");
  const [newProfileInstruct, setNewProfileInstruct] = useState("");
  const [uploadingReference, setUploadingReference] = useState(false);
  const referenceInputRef = useRef<HTMLInputElement>(null);
  const subscriptions = useRef<Record<string, () => void>>({});
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

  const newProfileType = getVoiceProfileType(newProfileEngine);
  const presetVoiceOptions = useMemo(
    () => getPresetVoiceOptions(newProfileEngine, newProfileLanguage),
    [newProfileEngine, newProfileLanguage],
  );

  const handleEngineChange = (engine: TtsEngine) => {
    setNewProfileEngine(engine);
    setNewProfileModelSize(getDefaultModelSizeForEngine(engine) || "default");
    setNewProfilePresetVoiceId(getDefaultPresetVoiceId(engine, newProfileLanguage) || "");
    if (getVoiceProfileType(engine) === "preset") {
      setNewProfileReferencePath("");
      setNewProfileReferenceText("");
    }
    if (!supportsVoiceInstruction(engine)) {
      setNewProfileInstruct("");
    }
  };

  const handleLanguageChange = (language: string) => {
    setNewProfileLanguage(language);
    if (newProfileType === "preset") {
      setNewProfilePresetVoiceId(getDefaultPresetVoiceId(newProfileEngine, language) || "");
    }
  };

  const attachProgress = useCallback(async (modelName: string) => {
    if (subscriptions.current[modelName]) return;
    try {
      subscriptions.current[modelName] = await subscribeModelProgress(
        modelName,
        (event) => {
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
      setErrors((prev) => ({ ...prev, [modelName]: error instanceof Error ? error.message : "订阅下载进度失败" }));
    }
  }, []);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const status = await getTtsRuntimeStatus();
      setRuntimeStatus(status);
      if (!modelCacheDirtyRef.current) {
        setDraftModelCacheDir(status.modelCacheDir || "");
      }
      if (!status.running) {
        setModelCacheInfo(null);
        setRows(applyModelStatuses([]));
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
      setErrors((prev) => ({ ...prev, runtime: error instanceof Error ? error.message : "刷新本地 TTS 状态失败" }));
      return null;
    } finally {
      setRefreshing(false);
    }
  }, [attachProgress]);

  useEffect(() => {
    let timer: number | undefined;
    // 延迟检查，避免切换侧边栏时阻塞
    const delay = setTimeout(() => {
      void refresh().then((status) => {
        if (status?.running) {
          timer = window.setInterval(() => void refresh(), 5000);
        }
      });
    }, 500);
    return () => {
      clearTimeout(delay);
      if (timer) window.clearInterval(timer);
      Object.values(subscriptions.current).forEach((close) => close());
      subscriptions.current = {};
    };
  }, [refresh]);

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
          .then(setRuntimeStatus)
          .catch(() => {});
      }, 500);
      const result = await startTtsRuntime();
      if (result.success) {
        toast.success("本地 TTS 后端已启动");
      } else {
        toast.error(result.error || "本地 TTS 后端启动失败");
      }
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "启动失败");
    } finally {
      if (setupPoll) window.clearInterval(setupPoll);
      setStarting(false);
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

  const handleModelCacheInputChange = (value: string) => {
    setDraftModelCacheDir(value);
    setModelCacheDirty(true); modelCacheDirtyRef.current = true;
  };

  const handleApplyModelCacheDir = async (dirPath = draftModelCacheDir) => {
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
    if (!window.storageManager?.selectDirectory) {
      toast.error("选择文件夹仅在桌面应用中可用");
      return;
    }
    const dir = await window.storageManager.selectDirectory();
    if (!dir) return;
    setDraftModelCacheDir(dir);
    setModelCacheDirty(true); modelCacheDirtyRef.current = true;
    await handleApplyModelCacheDir(dir);
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
    const selectedModelSize = newProfileModelSize === "default" ? undefined : newProfileModelSize;
    const candidate = {
      id: "new-profile",
      name: newProfileName.trim(),
      type: newProfileType,
      language: newProfileLanguage,
      defaultEngine: newProfileEngine,
      defaultModelSize: selectedModelSize,
      referenceAudioPath: newProfileReferencePath.trim() || undefined,
      referenceText: newProfileReferenceText.trim() || undefined,
      presetVoiceId: newProfilePresetVoiceId || undefined,
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
      defaultEngine: newProfileEngine,
      defaultModelSize: selectedModelSize,
      referenceAudioPath: newProfileReferencePath.trim() || undefined,
      referenceText: newProfileReferenceText.trim() || undefined,
      presetVoiceId: newProfilePresetVoiceId || undefined,
      instruct: newProfileInstruct.trim() || undefined,
    });
    setNewProfileName("旁白声线");
    setNewProfileReferencePath("");
    setNewProfileReferenceText("");
    setNewProfileInstruct("");
    toast.success("声线 profile 已创建");
  };

  const handleReferenceAudioUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!window.studioAssets?.saveMaterial) {
      toast.error("参考音频上传仅在桌面应用中可用");
      return;
    }

    setUploadingReference(true);
    try {
      const material = await window.studioAssets.saveMaterial({
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
  const selectedState = selectedModel ? getModelState(selectedModel, selectedProgress) : "missing";
  const errorEntries = Object.entries(errors);
  const scanPaths = modelCacheInfo?.scan_paths?.filter(Boolean) ?? [];
  const runtimeSetupStage = runtimeStatus?.setupStage ?? "idle";
  const runtimeSetupActive = ["checking", "downloading-python", "extracting-python", "installing-deps", "starting-backend"].includes(runtimeSetupStage);

  return (
    <ScrollArea className="h-full">
      <div className="p-8 max-w-6xl mx-auto space-y-6">
        <div className="tts-glass-card rounded-2xl border border-border bg-card/50 backdrop-blur-xl p-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="min-w-0 flex-1">
              <h3 className="text-lg font-semibold text-foreground flex items-center gap-2">
                <Server className="h-5 w-5 text-primary" />
                本地 TTS
              </h3>
              <div className="mt-2 space-y-1 text-sm">
                <RuntimeStatusLine
                  label="状态"
                  value={runtimeStatus?.running
                    ? (runtimeStatus.managed === false ? "运行中（残留进程）" : "运行中")
                    : runtimeStatus?.installed
                      ? "已安装，未运行"
                      : "未安装"}
                />
                <RuntimeStatusLine label="后端" value={runtimeStatus?.baseUrl ?? "http://127.0.0.1:17593"} />
                <RuntimeStatusLine label="运行数据" value={runtimeStatus?.cacheDir || "tts-runtime"} />
                <RuntimeStatusLine label="Python" value={runtimeStatus?.pythonRuntimeDir || "启动时配置"} />
                <RuntimeStatusLine label="模型缓存" value={modelCacheInfo?.path || "启动后读取"} />
                <RuntimeStatusLine label="下载写入" value={modelCacheInfo?.download_path || "启动后读取"} />
                <RuntimeStatusLine label="扫描路径" value={scanPaths.length ? scanPaths.join("；") : "启动后读取"} />
              </div>
              <RuntimeSetupProgress status={runtimeStatus} starting={starting} />
              <div className="mt-4 grid grid-cols-1 gap-2 md:grid-cols-[1fr_auto_auto_auto_auto]">
                <Button type="button" variant="outline" onClick={() => void handleSelectModelCacheDir()} disabled={applyingModelCacheDir || runtimeStatus?.running}>
                  <FolderOpen className="mr-2 h-4 w-4" />
                  选择模型目录
                </Button>
              </div>
              {/* 展示扫描到的模型路径 */}
              <div className="mt-3 space-y-1">
                {draftModelCacheDir && (
                  <div className="text-xs text-muted-foreground">
                    当前路径：<span className="text-foreground">{draftModelCacheDir}</span>
                  </div>
                )}
                {runtimeStatus?.defaultModelCacheDir && runtimeStatus.defaultModelCacheDir !== draftModelCacheDir && (
                  <div className="text-xs text-muted-foreground">
                    项目路径：<span className="text-foreground">{runtimeStatus.defaultModelCacheDir}</span>
                  </div>
                )}
                {runtimeStatus?.systemModelCacheDir && runtimeStatus.systemModelCacheDir !== draftModelCacheDir && (
                  <div className="text-xs text-muted-foreground">
                    HF 路径：<span className="text-foreground">{runtimeStatus.systemModelCacheDir}</span>
                  </div>
                )}
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <Button variant="outline" onClick={() => void handleManualRefresh()} disabled={refreshing}>
                  <RefreshCw className={cn("mr-2 h-4 w-4", refreshing && "animate-spin")} />
                  刷新
                </Button>
                {runtimeStatus?.running ? (
                  <Button variant="outline" onClick={() => void handleStop()}>
                    <Unplug className="mr-2 h-4 w-4" />
                    停止
                  </Button>
                ) : (
                  <Button onClick={() => void handleStart()} disabled={starting || runtimeSetupActive || runtimeStatus?.installed === false}>
                    {starting || runtimeSetupActive ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
                    启动
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>

        {activeTasks.downloads.length > 0 && (
          <div className="rounded-2xl border border-primary/20 bg-primary/5 backdrop-blur-lg p-4 text-sm text-primary">
            {activeTasks.downloads.length} 个模型正在下载，离开此页后后端任务仍会继续，可回到本页恢复进度。
          </div>
        )}

        {errorEntries.length > 0 && (
          <div className="rounded-2xl border border-destructive/20 bg-destructive/5 backdrop-blur-lg p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-sm font-medium text-destructive">
                <AlertCircle className="h-4 w-4" />
                下载/运行错误
              </div>
              <Button size="sm" variant="ghost" onClick={() => setErrors({})}>清除</Button>
            </div>
            <div className="space-y-2">
              {errorEntries.map(([key, message]) => (
                <div key={key} className="rounded-md bg-background px-3 py-2 text-xs text-muted-foreground">
                  <span className="font-mono text-foreground">{key}</span>：{message}
                </div>
              ))}
            </div>
          </div>
        )}

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

        <section className="tts-glass-card rounded-2xl border border-border bg-card/50 backdrop-blur-xl p-5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h4 className="text-sm font-semibold text-foreground">声线库</h4>
              <p className="mt-1 text-xs text-muted-foreground">全局 VoiceProfile；分镜内再把旁白或角色绑定到具体 profile。</p>
            </div>
            <span className="text-xs text-muted-foreground">{voiceProfiles.length} 个 profile</span>
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_150px_160px_120px]">
            <div>
              <Label className="text-xs text-muted-foreground">名称</Label>
              <Input value={newProfileName} onChange={(event) => setNewProfileName(event.target.value)} className="mt-1" />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">语言</Label>
              <NativeTtsSelect value={newProfileLanguage} onValueChange={handleLanguageChange} className="mt-1">
                <option value="zh">中文</option>
                <option value="en">English</option>
                <option value="ja">日本語</option>
                <option value="ko">한국어</option>
                <option value="es">Español</option>
                <option value="fr">Français</option>
              </NativeTtsSelect>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">默认引擎</Label>
              <NativeTtsSelect value={newProfileEngine} onValueChange={(value) => handleEngineChange(value as TtsEngine)} className="mt-1">
                <option value="qwen">Qwen</option>
                <option value="qwen_custom_voice">Qwen CustomVoice</option>
                <option value="luxtts">LuxTTS</option>
                <option value="chatterbox">Chatterbox</option>
                <option value="chatterbox_turbo">Chatterbox Turbo</option>
                <option value="tada">TADA</option>
                <option value="kokoro">Kokoro</option>
              </NativeTtsSelect>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">模型</Label>
              <NativeTtsSelect value={newProfileModelSize} onValueChange={setNewProfileModelSize} className="mt-1">
                <option value="default">默认</option>
                <option value="0.6B">0.6B</option>
                <option value="1.7B">1.7B</option>
                <option value="1B">1B</option>
                <option value="3B">3B</option>
              </NativeTtsSelect>
            </div>
            {newProfileType === "preset" ? (
              <div className="md:col-span-4">
                <Label className="text-xs text-muted-foreground">预设音色</Label>
                <NativeTtsSelect value={newProfilePresetVoiceId} onValueChange={setNewProfilePresetVoiceId} className="mt-1">
                  <option value="" disabled>
                    选择预设音色
                  </option>
                  {presetVoiceOptions.map((voice) => (
                    <option key={voice.id} value={voice.id}>
                      {voice.name} · {voice.language} · {voice.gender}
                    </option>
                  ))}
                </NativeTtsSelect>
              </div>
            ) : (
              <>
                <div className="md:col-span-4">
                  <Label className="text-xs text-muted-foreground">参考音频路径</Label>
                  <div className="mt-1 flex gap-2">
                    <Input
                      value={newProfileReferencePath}
                      onChange={(event) => setNewProfileReferencePath(event.target.value)}
                      placeholder="/Users/.../voice.wav"
                    />
                    <input
                      ref={referenceInputRef}
                      type="file"
                      accept="audio/*,.wav,.mp3,.m4a,.flac,.ogg"
                      className="hidden"
                      onChange={(event) => void handleReferenceAudioUpload(event)}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => referenceInputRef.current?.click()}
                      disabled={uploadingReference}
                    >
                      {uploadingReference ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
                      上传
                    </Button>
                  </div>
                </div>
                <div className="md:col-span-4">
                  <Label className="text-xs text-muted-foreground">参考文本</Label>
                  <Textarea
                    value={newProfileReferenceText}
                    onChange={(event) => setNewProfileReferenceText(event.target.value)}
                    rows={3}
                    className="mt-1 resize-none"
                  />
                </div>
              </>
            )}
            {supportsVoiceInstruction(newProfileEngine) && (
              <div className="md:col-span-4">
                <Label className="text-xs text-muted-foreground">风格指令</Label>
                <Textarea
                  value={newProfileInstruct}
                  onChange={(event) => setNewProfileInstruct(event.target.value)}
                  rows={2}
                  className="mt-1 resize-none"
                  placeholder="例如：温柔、缓慢、像讲述悬疑旁白一样。"
                />
              </div>
            )}
          </div>
          <div className="mt-4 flex justify-end">
            <Button onClick={handleCreateProfile}>创建声线</Button>
          </div>
          {voiceProfiles.length > 0 && (
            <div className="mt-4 divide-y divide-white/[0.06] rounded-xl border border-white/[0.08] bg-white/[0.02]">
              {voiceProfiles.map((profile) => (
                <div key={profile.id} className="grid grid-cols-[1fr_120px_140px_120px] gap-3 px-3 py-2 text-sm">
                  <span className="truncate text-foreground">{profile.name}</span>
                  <span className="text-xs text-muted-foreground">{profile.type === "preset" ? "预设" : "参考"}</span>
                  <span className="text-xs text-muted-foreground">{profile.defaultEngine}</span>
                  <span className="truncate text-xs text-muted-foreground">{profile.presetVoiceId || profile.defaultModelSize || "-"}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      <Dialog open={!!selectedModel} onOpenChange={(open) => !open && setSelectedModel(null)}>
        <DialogContent className="tts-glass-dialog max-w-2xl border-white/[0.08] bg-background/80 backdrop-blur-2xl shadow-2xl shadow-black/[0.2]">
          {selectedModel && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <ModelStateIcon state={selectedState} />
                  {selectedModel.displayName}
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-3">
                    <div className="text-xs text-muted-foreground">HuggingFace Repo</div>
                    <div className="mt-1 flex items-center gap-2 truncate font-mono text-xs">
                      {selectedModel.hfRepoId}
                      <a href={`https://huggingface.co/${selectedModel.hfRepoId}`} target="_blank" rel="noreferrer">
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    </div>
                  </div>
                  <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-3">
                    <div className="text-xs text-muted-foreground">磁盘大小</div>
                    <div className="mt-1 flex items-center gap-2 text-sm">
                      <HardDrive className="h-4 w-4 text-muted-foreground" />
                      {formatSizeMb(selectedModel.sizeMb)}
                    </div>
                  </div>
                </div>
                <p className="text-sm text-muted-foreground">{selectedModel.description}</p>
                <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-3">
                  <div className="text-xs text-muted-foreground">模型位置</div>
                  <div className="mt-1 break-all font-mono text-xs text-foreground">
                    {selectedModel.modelRepoPath || selectedModel.modelCacheDir || (selectedState === "missing" ? "未下载，未找到本地路径" : "启动后扫描")}
                  </div>
                  {selectedModel.modelRepoPath && selectedModel.modelCacheDir && (
                    <div className="mt-2 break-all text-xs text-muted-foreground">缓存目录：{selectedModel.modelCacheDir}</div>
                  )}
                </div>
                <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 text-xs text-muted-foreground">
                  License 以 HuggingFace 模型页为准；MYStudio 仅管理本地缓存和运行入口。
                </div>
                {selectedProgress && (
                  <div>
                    <Progress value={selectedProgress.progress} className="h-2" />
                    <div className="mt-2 flex justify-between gap-3 text-xs text-muted-foreground">
                      <span className="truncate">{selectedProgress.filename || selectedProgress.status}</span>
                      <span>{Math.round(selectedProgress.progress)}%</span>
                    </div>
                  </div>
                )}
                <div className="flex flex-wrap justify-end gap-2">
                  {selectedState === "downloading" ? (
                    <Button variant="outline" onClick={() => void handleCancel(selectedModel)}>
                      <Square className="mr-2 h-4 w-4" />
                      取消
                    </Button>
                  ) : selectedState === "missing" || selectedState === "failed" ? (
                    runtimeStatus?.running ? (
                      <Button onClick={() => void handleDownload(selectedModel)}>
                        <Download className="mr-2 h-4 w-4" />
                        {selectedState === "failed" ? "重试下载" : "下载"}
                      </Button>
                    ) : (
                      <div className="flex h-9 items-center px-2">
                        <PendingScanLabel />
                      </div>
                    )
                  ) : (
                    <div className="flex h-9 items-center px-2">
                      <ModelStateLabel state={selectedState} />
                    </div>
                  )}
                  <Button variant="outline" onClick={() => void handleUnload(selectedModel)}>
                    <Unplug className="mr-2 h-4 w-4" />
                    卸载
                  </Button>
                  <Button variant="destructive" onClick={() => void handleDelete(selectedModel)}>
                    <Trash2 className="mr-2 h-4 w-4" />
                    删除
                  </Button>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </ScrollArea>
  );
}
