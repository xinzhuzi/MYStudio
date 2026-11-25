import { BrowserWindow, ipcMain } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import {
  getSelfMediaCapabilities,
  isSelfMediaLocalTransportPlatform,
  isSelfMediaPublishable,
} from "../../../lib/self-media/capabilities";
import { containsSelfMediaCredentialLikeKey, validateSelfMediaDraft } from "../../../lib/self-media/contracts";
import { DEFAULT_DAILY_LIMIT_PER_ACCOUNT, localDayKey, summarizeDailyPublishes } from "../../../lib/self-media/batch-policy";
import {
  decodeSelfMediaTaskRecord,
  decodeSelfMediaProgressEvent,
  isSelfMediaTaskRecord,
  SELF_MEDIA_IPC,
} from "../../../lib/self-media/ipc-contract";
import type {
  SelfMediaAccountListReply,
  SelfMediaConfigureProviderReply,
  SelfMediaCreateTaskReply,
  SelfMediaCreateTaskRequest,
  SelfMediaDailyPublishStatsReply,
  SelfMediaIpcReply,
  SelfMediaListAccountsRequest,
  SelfMediaListTasksRequest,
  SelfMediaLoginReply,
  SelfMediaProviderListReply,
  SelfMediaStartLoginRequest,
  SelfMediaTaskListReply,
  SelfMediaTaskProgressEvent,
  SelfMediaTaskReply,
  SelfMediaTaskRequest,
} from "../../../lib/self-media/ipc-contract";
import type { DiagnosticsLogEntryInput } from "../../../types/diagnostics";
import type {
  SelfMediaAssetRef,
  SelfMediaDraft,
  SelfMediaPlatform,
  SelfMediaTask,
  SelfMediaTaskError,
  SelfMediaTaskStatus,
} from "../../../types/self-media";
import {
  createAitoearnLocalAdapter,
  createSelfMediaProviderRegistry,
  SelfMediaProviderError,
  type AitoearnLocalPlatformBridge,
  type SelfMediaProviderAdapter,
  type SelfMediaProviderRegistry,
  type SelfMediaResolvedAsset,
} from "../../aitoearn/provider-registry";
import { applySelfMediaTaskResult, SelfMediaTaskRuntime } from "../../aitoearn/task-runtime";
import { createBatchGate } from "./batch-gate";

type SelfMediaIpcContext = {
  registry?: SelfMediaProviderRegistry;
  localBridge?: AitoearnLocalPlatformBridge;
  resolveAsset?: (projectId: string, asset: SelfMediaAssetRef) => Promise<SelfMediaResolvedAsset>;
  taskStorePath?: string;
  /** L6: 批次任务开始发布的诊断日志写手(main.ts 注入;测试不传就不写) */
  writeDiagnostic?: (entry: DiagnosticsLogEntryInput) => void;
};

type ScheduledTaskContext = {
  taskId: string;
  draft: SelfMediaDraft;
};

type ScheduledDraftResult =
  | { success: true; value: SelfMediaDraft }
  | { success: false; message: string };

// 损坏的任务日志必须拒写(含 dispose 强制写),否则下一次持久化会以空任务集
// 覆盖原文件,定时任务静默丢失。与 local-account-vault 的损坏拒写同口径。
const TASK_JOURNAL_CORRUPTED = {
  code: "task-journal-corrupted",
  message: "自媒体任务日志已损坏或无法读取，已停止写入以防覆盖定时任务——请先备份或删除该文件后重启应用",
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object");
}

// isTrustedSenderFrame 已抽取到 ../trusted-sender.ts,消除 product-ipc/self-media-ipc 重复。
import { isTrustedSenderFrame } from "../trusted-sender";

function decodeTaskRecord(value: unknown): SelfMediaTask | null {
  try {
    return decodeSelfMediaTaskRecord(value);
  } catch {
    return null;
  }
}

function sanitizeScheduledDraft(value: unknown, scheduledAtOverride?: string): ScheduledDraftResult {
  if (!isRecord(value) || containsSelfMediaCredentialLikeKey(value)) {
    return { success: false, message: "定时草稿包含不允许持久化的凭据字段" };
  }
  const scheduledAt = scheduledAtOverride ?? (typeof value.scheduledAt === "string" ? value.scheduledAt : undefined);
  if (!scheduledAt || !Number.isFinite(Date.parse(scheduledAt))) {
    return { success: false, message: "定时草稿缺少有效的发布时间" };
  }
  const validation = validateSelfMediaDraft({ ...value, scheduledAt: undefined });
  if (!validation.success) {
    return { success: false, message: validation.issues.map((issue) => `${issue.path || "草稿"}：${issue.message}`).join("；") };
  }
  const draft = validation.value;
  const platform = typeof draft.platformOptions.platform === "string" ? draft.platformOptions.platform : undefined;
  const capability = platform ? getSelfMediaCapabilities("aitoearn-local", platform as SelfMediaPlatform) : undefined;
  if (!platform || !isSelfMediaLocalTransportPlatform("aitoearn-local", platform as SelfMediaPlatform) || !isSelfMediaPublishable("aitoearn-local", platform as SelfMediaPlatform, draft.contentType)) {
    return { success: false, message: "定时草稿的平台发布能力尚未接入" };
  }
  const allowedOptionKeys = new Set(["platform", ...(capability?.optionKeys ?? [])]);
  const platformOptions = Object.fromEntries(
    Object.entries(draft.platformOptions).filter(([key, item]) => (
      allowedOptionKeys.has(key)
      && (typeof item === "string" || typeof item === "number" || typeof item === "boolean")
    )),
  );
  return {
    success: true,
    value: {
      id: draft.id,
      projectId: draft.projectId,
      contentType: draft.contentType,
      title: draft.title,
      description: draft.description,
      topics: [...draft.topics],
      cover: draft.cover ? { ...draft.cover } : undefined,
      assets: draft.assets.map((asset) => ({ ...asset })),
      accountIds: [...draft.accountIds],
      visibility: draft.visibility,
      platformOptions,
      scheduledAt,
      // L1(1125 归档后补检): 定时草稿白名单重建时保留产品关联,
      // 否则 journal 持久化/恢复往返会把 productId 从发布上下文里丢掉。
      productId: draft.productId,
      // L6: 批量发布批次字段同样要过 journal 往返,否则重启后批次身份丢失
      batchId: draft.batchId,
      batchRole: draft.batchRole,
      updatedAt: draft.updatedAt,
    },
  };
}

const disabled = <T>(code: string, message: string): SelfMediaIpcReply<T> => ({
  success: false,
  error: { code, message },
});

function validProjectId(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && !value.includes("/") && !value.includes("\\");
}

function isSelfMediaPlatform(value: unknown): value is SelfMediaPlatform {
  if (typeof value !== "string") return false;
  return Boolean(getSelfMediaCapabilities("aitoearn-local", value as SelfMediaPlatform));
}

function isProviderId(value: unknown): value is "aitoearn-local" {
  return value === "aitoearn-local";
}

function createId(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function createTask(projectId: string, providerId: SelfMediaTask["providerId"], accountId: string, draft: SelfMediaCreateTaskRequest["draft"], previousTaskId?: string): SelfMediaTask {
  const now = new Date().toISOString();
  const platform = typeof draft.platformOptions.platform === "string" ? draft.platformOptions.platform : undefined;
  return {
    id: createId("self-media-task"),
    attemptId: createId("self-media-attempt"),
    draftId: draft.id,
    previousTaskId,
    projectId,
    providerId,
    accountId,
    sourceAssetIds: draft.assets.map((asset) => asset.assetId),
    status: draft.scheduledAt ? "scheduled" : "draft",
    progress: 0,
    scheduledAt: draft.scheduledAt,
    // L1(1125 归档后补检): 透传草稿的产品关联,否则任务/历史无 productId,
    // 渲染层「按产品筛选」(index.tsx 两处)永远筛空。重试路径(previousTaskId
    // 分支)同样经由本函数构造任务,一并覆盖。
    productId: draft.productId,
    // L6: 批次身份与可靠的平台来源(建单时从草稿平台选项抄过来;旧草稿缺省)
    batchId: draft.batchId,
    batchRole: draft.batchRole,
    platform: platform as SelfMediaPlatform | undefined,
    createdAt: now,
    updatedAt: now,
  };
}

function normalizeProviderError(providerId: SelfMediaTask["providerId"], error: unknown): SelfMediaTaskError {
  if (error instanceof SelfMediaProviderError) {
    return { code: error.code, message: error.message, providerId, retryable: error.retryable };
  }
  return {
    code: "provider-request-failed",
    message: error instanceof Error ? error.message : "provider 请求失败",
    providerId,
    retryable: true,
  };
}

function isTerminalTaskStatus(status: SelfMediaTaskStatus) {
  return status === "success" || status === "failure" || status === "partial" || status === "audit" || status === "canceled" || status === "expired-login";
}

 
export function registerSelfMediaIpcHandlers({ registry: suppliedRegistry, localBridge, resolveAsset, taskStorePath, writeDiagnostic }: SelfMediaIpcContext) {
  const registry = suppliedRegistry ?? createSelfMediaProviderRegistry({
    local: createAitoearnLocalAdapter(localBridge),
  });
  const tasks = new Map<string, SelfMediaTask>();
  const scheduledContexts = new Map<string, SelfMediaDraft>();
  const inFlightPublishes = new Set<Promise<unknown>>();
  const inFlightActions = new Set<Promise<unknown>>();
  let persistenceChain: Promise<void> = Promise.resolve();
  let disposed = false;
  let journalFailure: { code: string; message: string } | null = null;
  const loadPersistedTasks = async () => {
    if (!taskStorePath) return;
    let raw: string;
    try {
      raw = await fs.readFile(taskStorePath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      journalFailure = TASK_JOURNAL_CORRUPTED;
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      journalFailure = TASK_JOURNAL_CORRUPTED;
      return;
    }
    const persistedTasks = Array.isArray(parsed)
      ? parsed
      : isRecord(parsed) && Array.isArray(parsed.tasks)
        ? parsed.tasks
        : null;
    if (!persistedTasks) {
      journalFailure = TASK_JOURNAL_CORRUPTED;
      return;
    }
    for (const value of persistedTasks) {
      const task = decodeTaskRecord(value);
      if (task) tasks.set(task.id, task);
    }
    if (!isRecord(parsed) || !Array.isArray(parsed.scheduledContexts)) return;
    for (const value of parsed.scheduledContexts) {
      if (!isRecord(value) || typeof value.taskId !== "string" || !isRecord(value.draft)) continue;
      const task = tasks.get(value.taskId);
      if (!task || task.status !== "scheduled" || task.draftId !== value.draft.id || task.projectId !== value.draft.projectId) continue;
      const sanitized = sanitizeScheduledDraft(value.draft, task.scheduledAt);
      if (!sanitized.success) continue;
      scheduledContexts.set(task.id, sanitized.value);
    }
  };
  const tasksReady = loadPersistedTasks();
  const persistTasks = (force = false): Promise<void> => {
    if (!taskStorePath) return Promise.resolve();
    if (journalFailure) return Promise.resolve();
    const operation = persistenceChain.then(async () => {
      if (disposed && !force) return;
      await fs.mkdir(path.dirname(taskStorePath), { recursive: true });
      const scheduled = [...scheduledContexts.entries()]
        .map(([taskId, draft]): ScheduledTaskContext | null => {
          const task = decodeTaskRecord(tasks.get(taskId));
          if (!task) return null;
          const sanitized = sanitizeScheduledDraft(draft, task?.scheduledAt);
          return sanitized.success ? { taskId, draft: sanitized.value } : null;
        })
        .filter((context): context is ScheduledTaskContext => context !== null);
      const journalTasks = [...tasks.values()].flatMap((task) => {
        const normalized = decodeTaskRecord(task);
        return normalized ? [normalized] : [];
      });
      const journal = {
        schemaVersion: 1,
        tasks: journalTasks,
        scheduledContexts: scheduled,
      };
      const tempPath = `${taskStorePath}.tmp-${process.pid}-${crypto.randomUUID()}`;
      await fs.writeFile(tempPath, `${JSON.stringify(journal)}\n`, { encoding: "utf8", mode: 0o600 });
      await fs.rename(tempPath, taskStorePath);
    });
    persistenceChain = operation.then(() => undefined, () => undefined);
    return operation.then(() => undefined, () => undefined);
  };
  const channels = [
    SELF_MEDIA_IPC.listProviders,
    SELF_MEDIA_IPC.listAccounts,
    SELF_MEDIA_IPC.listTasks,
    SELF_MEDIA_IPC.dailyPublishStats,
    SELF_MEDIA_IPC.configureProvider,
    SELF_MEDIA_IPC.startLogin,
    SELF_MEDIA_IPC.createTask,
    SELF_MEDIA_IPC.pollTask,
    SELF_MEDIA_IPC.cancelTask,
  ];
  const removeHandlers = () => channels.forEach((channel) => ipcMain.removeHandler(channel));

  const rejectUntrustedSender = (event: Electron.IpcMainInvokeEvent): SelfMediaIpcReply<never> | null =>
    isTrustedSenderFrame(event) ? null : disabled("untrusted-sender", "拒绝来自非应用渲染帧的自媒体调用");

  const emitProgress = (progress: SelfMediaTaskProgressEvent) => {
    let normalized: SelfMediaTaskProgressEvent;
    try {
      normalized = decodeSelfMediaProgressEvent(progress);
    } catch {
      return;
    }
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.send(SELF_MEDIA_IPC.progress, normalized);
    }
  };

  const getAdapter = (providerId: SelfMediaTask["providerId"]): SelfMediaProviderAdapter | undefined => registry.get(providerId);

  const publishTask = async (
    adapter: SelfMediaProviderAdapter,
    draft: SelfMediaDraft,
    task: SelfMediaTask,
  ) => {
    if (disposed) throw new SelfMediaProviderError(task.providerId, "provider-disposed", "自媒体 provider 已结束");
    return adapter.publish({
      projectId: task.projectId,
      draft,
      task,
      resolveAsset: async (assetId) => {
        const asset = draft.assets.find((item) => item.assetId === assetId)
          ?? (draft.cover?.assetId === assetId ? draft.cover : undefined);
        if (!asset) throw new SelfMediaProviderError(task.providerId, "asset-not-selected", "资产不在当前草稿中");
        if (resolveAsset) return resolveAsset(task.projectId, asset);
        if (localBridge) throw new SelfMediaProviderError(task.providerId, "asset-resolver-unavailable", "主进程未提供受控资产解析器");
        if (asset.approvedUrl) return { assetId: asset.assetId, url: asset.approvedUrl, kind: asset.kind };
        throw new SelfMediaProviderError(task.providerId, "asset-unresolved", "资产缺少主进程可解析的 URL");
      },
      emitProgress: (progress) => {
        if (disposed) return;
        const current = tasks.get(task.id);
        if (!current || current.attemptId !== task.attemptId || isTerminalTaskStatus(current.status)) return;
        const next = applySelfMediaTaskResult(current, { status: "running", progress });
        tasks.set(next.id, next);
        void persistTasks();
        emitProgress({ projectId: next.projectId, taskId: next.id, status: next.status, progress: next.progress });
      },
    });
  };

  // L6: 批量发布闸门与级联。闸门只管带 batchId 的定时任务;级联置败经 runtime.abort
  // 落地(走 apply 的防篡改检查,逐条 persist+emit)。
  const gate = createBatchGate({
    tasks,
    abort: (task, code, message) => runtime.abort(task, code, message),
    writeDiagnostic,
  });

  const runtime = new SelfMediaTaskRuntime(
    tasks,
    registry,
    persistTasks,
    (task) => {
      emitProgress({
        projectId: task.projectId,
        taskId: task.id,
        status: task.status,
        progress: task.progress,
      });
      // L6 级联入口 1: 运行时状态回调里,首发验证进入坏终态即级联
      void gate.maybeCascade(task);
    },
    {
      gateScheduled: gate.gateScheduled,
      executeScheduled: async (task) => {
        const draft = scheduledContexts.get(task.id);
        const adapter = getAdapter(task.providerId);
        if (!draft) throw new SelfMediaProviderError(task.providerId, "schedule-context-missing", "定时任务缺少可恢复的发布上下文");
        if (!adapter) throw new SelfMediaProviderError(task.providerId, "invalid-provider", "provider 无效");
        // L6 诊断日志:批次任务真正开始发布,给 L11 留实际发送时刻证据
        const scheduledPlatform = typeof draft.platformOptions.platform === "string" ? draft.platformOptions.platform : undefined;
        gate.writeStartDiagnostic(task, scheduledPlatform as SelfMediaPlatform | undefined);
        try {
          const dueDraft = { ...draft, scheduledAt: undefined, updatedAt: new Date().toISOString() };
          return await publishTask(adapter, dueDraft, task);
        } finally {
          scheduledContexts.delete(task.id);
        }
      },
      mapError: (task, error) => normalizeProviderError(task.providerId, error),
    },
  );
  const runtimeReady = tasksReady.then(() => runtime.recover()).catch(() => {
    // A recoverable task failure is persisted by the runtime; startup must continue.
  });

  ipcMain.handle(SELF_MEDIA_IPC.listProviders, async (event): Promise<SelfMediaProviderListReply> => {
    const rejected = rejectUntrustedSender(event);
    if (rejected) return rejected;
    return { success: true, value: registry.list() };
  });

  ipcMain.handle(SELF_MEDIA_IPC.listTasks, async (event, request: SelfMediaListTasksRequest): Promise<SelfMediaTaskListReply> => {
    const rejected = rejectUntrustedSender(event);
    if (rejected) return rejected;
    await tasksReady;
    if (journalFailure) return disabled(journalFailure.code, journalFailure.message);
    if (!validProjectId(request?.projectId)) return disabled("invalid-project", "项目 ID 无效");
    const value = runtime.list(request.projectId).map(decodeTaskRecord);
    if (value.some((task) => task === null)) return disabled("invalid-task-response", "任务响应无效");
    return { success: true, value: value as SelfMediaTask[] };
  });

  ipcMain.handle(SELF_MEDIA_IPC.dailyPublishStats, async (event): Promise<SelfMediaDailyPublishStatsReply> => {
    // L6: 每日次数改由主进程按整本台账统计(账号库是全局的,listTasks 只返回单项目)
    const rejected = rejectUntrustedSender(event);
    if (rejected) return rejected;
    await tasksReady;
    if (journalFailure) return disabled(journalFailure.code, journalFailure.message);
    return { success: true, value: summarizeDailyPublishes([...tasks.values()], { dateKey: localDayKey(new Date()), limit: DEFAULT_DAILY_LIMIT_PER_ACCOUNT }) };
  });

  ipcMain.handle(SELF_MEDIA_IPC.listAccounts, async (event, request: SelfMediaListAccountsRequest): Promise<SelfMediaAccountListReply> => {
    const rejected = rejectUntrustedSender(event);
    if (rejected) return rejected;
    await tasksReady;
    if (!validProjectId(request?.projectId)) return disabled("invalid-project", "项目 ID 无效");
    const providerId = request.providerId ?? "aitoearn-local";
    if (!isProviderId(providerId)) return disabled("invalid-provider", "provider 无效");
    try {
      const adapter = getAdapter(providerId);
      if (!adapter) return disabled("invalid-provider", "provider 无效");
      return { success: true, value: await adapter.listAccounts(request.projectId) };
    } catch (error) {
      const normalized = normalizeProviderError(providerId, error);
      return disabled(normalized.code, normalized.message);
    }
  });

  ipcMain.handle(SELF_MEDIA_IPC.configureProvider, async (event, request): Promise<SelfMediaConfigureProviderReply> => {
    const rejected = rejectUntrustedSender(event);
    if (rejected) return rejected;
    if (request?.providerId !== "aitoearn-local") {
      return disabled("invalid-provider", "provider 无效");
    }
    return { success: true, value: { providerId: request.providerId, configured: true } };
  });

  ipcMain.handle(SELF_MEDIA_IPC.startLogin, async (event, request: SelfMediaStartLoginRequest): Promise<SelfMediaLoginReply> => {
    const rejected = rejectUntrustedSender(event);
    if (rejected) return rejected;
    await tasksReady;
    if (!validProjectId(request?.projectId) || request.providerId !== "aitoearn-local" || !isSelfMediaPlatform(request.platform)) {
      return disabled("invalid-login-request", "登录请求无效");
    }
    if (!isSelfMediaLocalTransportPlatform("aitoearn-local", request.platform)) {
      return disabled("platform-transport-unavailable", "当前平台暂未接入本地登录能力");
    }
    const adapter = getAdapter("aitoearn-local");
    if (!adapter) return disabled("invalid-provider", "provider 无效");
    try {
      return { success: true, value: await adapter.startLogin(request.projectId, request.platform) };
    } catch (error) {
      const normalized = normalizeProviderError("aitoearn-local", error);
      return disabled(normalized.code, normalized.message);
    }
  });

  ipcMain.handle(SELF_MEDIA_IPC.createTask, async (event, request: SelfMediaCreateTaskRequest): Promise<SelfMediaCreateTaskReply> => {
    const rejected = rejectUntrustedSender(event);
    if (rejected) return rejected;
    await tasksReady;
    if (journalFailure) return disabled(journalFailure.code, journalFailure.message);
    if (disposed) return disabled("provider-disposed", "自媒体 provider 已结束");
    if (!validProjectId(request?.projectId) || request.draft?.projectId !== request.projectId) {
      return disabled("invalid-task-request", "任务项目范围无效");
    }
    if (!isProviderId(request.providerId)) return disabled("invalid-provider", "provider 无效");
    const adapter = getAdapter(request.providerId);
    if (!adapter) return disabled("invalid-provider", "provider 无效");
    const validation = validateSelfMediaDraft(request.draft);
    if (!validation.success) return disabled("invalid-draft", validation.issues.map((issue) => `${issue.path || "草稿"}：${issue.message}`).join("；"));
    const draft = validation.value;
    const platform = typeof draft.platformOptions.platform === "string" ? draft.platformOptions.platform : undefined;
    if (platform && !isSelfMediaPublishable("aitoearn-local", platform as SelfMediaPlatform, draft.contentType)) {
      return disabled("platform-transport-unavailable", "当前平台暂未接入本地发布能力，未创建任务");
    }
    if (!adapter.summary.enabled) return disabled("provider-disabled", adapter.summary.reason ?? "发布 provider 尚未启用，未发起任何请求");
    const scheduledDraft = request.providerId === "aitoearn-local" && draft.scheduledAt
      ? sanitizeScheduledDraft(draft)
      : null;
    if (scheduledDraft && !scheduledDraft.success) return disabled("invalid-scheduled-context", scheduledDraft.message);

    const previousTask = request.previousTaskId ? tasks.get(request.previousTaskId) : undefined;
    if (request.previousTaskId && (!previousTask || previousTask.projectId !== request.projectId || previousTask.providerId !== request.providerId || previousTask.draftId !== draft.id || !["failure", "expired-login"].includes(previousTask.status))) {
      return disabled("invalid-previous-task", "重试来源任务不存在、项目/provider 不匹配，或任务尚未进入可重试状态");
    }

    const created: SelfMediaTask[] = [];
    const taskAccountIds = previousTask
      ? [previousTask.accountId]
      : draft.accountIds;
    if (previousTask && !draft.accountIds.includes(previousTask.accountId)) {
      return disabled("invalid-previous-task", "重试来源账号不在当前草稿中");
    }
    for (const accountId of taskAccountIds) {
      let task = createTask(request.projectId, request.providerId, accountId, draft, request.previousTaskId);
      tasks.set(task.id, task);
      if (request.providerId === "aitoearn-local" && draft.scheduledAt) {
        if (!scheduledDraft?.success) return disabled("invalid-scheduled-context", "定时任务缺少可恢复的发布上下文");
        scheduledContexts.set(task.id, scheduledDraft.value);
        await persistTasks();
        // L6 级联入口 5: 首发验证已是坏终态时,成员建单即置败(abort 内部 persist+emit)
        // 并把失败态任务带回回执;未被级联的成员才挂定时。
        task = await gate.cascadeNewMember(task);
        created.push(task);
        if (task.status === "scheduled") {
          runtime.schedule(task);
          emitProgress({ projectId: task.projectId, taskId: task.id, status: task.status, progress: task.progress });
        }
        continue;
      }
      const publication = publishTask(adapter, draft, task);
      inFlightPublishes.add(publication);
      try {
        const result = await publication;
        if (disposed) return disabled("provider-disposed", "自媒体 provider 已结束");
        const current = tasks.get(task.id);
        task = current && current.attemptId === task.attemptId && !isTerminalTaskStatus(current.status)
          ? applySelfMediaTaskResult(current, result)
          : current ?? task;
      } catch (error) {
        if (disposed) return disabled("provider-disposed", "自媒体 provider 已结束");
        const current = tasks.get(task.id);
        task = current && current.attemptId === task.attemptId && !isTerminalTaskStatus(current.status)
          ? applySelfMediaTaskResult(current, { status: "failure", error: normalizeProviderError(request.providerId, error) })
          : current ?? task;
      } finally {
        inFlightPublishes.delete(publication);
      }
      tasks.set(task.id, task);
      await persistTasks();
      created.push(task);
      emitProgress({ projectId: task.projectId, taskId: task.id, status: task.status, progress: task.progress });
      runtime.watch(task);
    }
    const value = created.map(decodeTaskRecord);
    if (value.some((task) => task === null)) return disabled("invalid-task-response", "任务响应无效");
    return { success: true, value: value as SelfMediaTask[] };
  });

  const runTaskAction = async (request: SelfMediaTaskRequest, action: "poll" | "cancel"): Promise<SelfMediaTaskReply> => {
    await tasksReady;
    if (journalFailure) return disabled(journalFailure.code, journalFailure.message);
    if (disposed) return disabled("provider-disposed", "自媒体 provider 已结束");
    if (!validProjectId(request?.projectId) || typeof request.taskId !== "string") return disabled("invalid-task-request", "任务请求无效");
    const task = tasks.get(request.taskId);
    if (!task || task.projectId !== request.projectId) return disabled("task-not-found", "任务不存在或不属于当前项目");
    const adapter = getAdapter(task.providerId);
    if (!adapter) return disabled("invalid-provider", "provider 无效");
    if (isTerminalTaskStatus(task.status)) return disabled("task-terminal", "任务已结束，不能再次执行该操作");
    if (action === "cancel" && task.status === "scheduled" && scheduledContexts.has(task.id)) {
      runtime.unschedule(task.id);
      scheduledContexts.delete(task.id);
      const canceled = applySelfMediaTaskResult(task, { status: "canceled" });
      tasks.set(canceled.id, canceled);
      await persistTasks();
      emitProgress({ projectId: canceled.projectId, taskId: canceled.id, status: canceled.status, progress: canceled.progress });
      // L6 级联入口 2: 定时态取消首发验证之后
      await gate.maybeCascade(canceled);
      return { success: true, value: canceled };
    }
    try {
      if (action === "poll") {
        const next = await runtime.poll(task);
        if (disposed) return disabled("provider-disposed", "自媒体 provider 已结束");
        if (!isSelfMediaTaskRecord(next)) return disabled("invalid-task-response", "任务响应无效");
        return { success: true, value: next };
      }
      const cancellation = adapter.cancel(task);
      inFlightActions.add(cancellation);
      try {
        const result = await cancellation;
        if (disposed) return disabled("provider-disposed", "自媒体 provider 已结束");
        const current = tasks.get(task.id);
        if (!current || current.attemptId !== task.attemptId || isTerminalTaskStatus(current.status)) {
          const value = decodeTaskRecord(current);
          return value ? { success: true, value } : disabled("invalid-task-response", "任务响应无效");
        }
        const next = applySelfMediaTaskResult(current, result);
        const value = decodeTaskRecord(next);
        if (!value) return disabled("invalid-task-response", "任务响应无效");
        tasks.set(next.id, next);
        await persistTasks();
        emitProgress({ projectId: next.projectId, taskId: next.id, status: next.status, progress: next.progress });
        // L6 级联入口 3: 运行态取消成功之后(取消结果带终态)
        await gate.maybeCascade(next);
        return { success: true, value };
      } finally {
        inFlightActions.delete(cancellation);
      }
    } catch (error) {
      if (action === "cancel") {
        const normalized = normalizeProviderError(task.providerId, error);
        return disabled(normalized.code, normalized.message);
      }
      if (disposed) return disabled("provider-disposed", "自媒体 provider 已结束");
      const failed = applySelfMediaTaskResult(task, { status: "failure", error: normalizeProviderError(task.providerId, error) });
      tasks.set(failed.id, failed);
      await persistTasks();
      emitProgress({ projectId: failed.projectId, taskId: failed.id, status: failed.status, progress: failed.progress });
      // L6 级联入口 4: 查询出错把首发验证置败之后
      await gate.maybeCascade(failed);
      return { success: true, value: failed };
    }
  };

  ipcMain.handle(SELF_MEDIA_IPC.pollTask, (event, request: SelfMediaTaskRequest) => {
    const rejected = rejectUntrustedSender(event);
    if (rejected) return rejected;
    return runTaskAction(request, "poll");
  });
  ipcMain.handle(SELF_MEDIA_IPC.cancelTask, (event, request: SelfMediaTaskRequest) => {
    const rejected = rejectUntrustedSender(event);
    if (rejected) return rejected;
    return runTaskAction(request, "cancel");
  });

  return {
    dispose: async () => {
      disposed = true;
      removeHandlers();
      await tasksReady;
      await runtimeReady;
      await Promise.allSettled([...inFlightPublishes]);
      await Promise.allSettled([...inFlightActions]);
      await runtime.dispose();
      await persistTasks(true);
      await persistenceChain;
      await registry.dispose();
    },
    emitProgress,
    tasks,
    runtime,
    runtimeReady,
    scheduledContexts,
  };
}

export type SelfMediaTaskResult = SelfMediaIpcReply<SelfMediaTask>;
