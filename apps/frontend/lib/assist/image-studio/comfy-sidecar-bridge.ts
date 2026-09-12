// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

// ComfyUI 生态迁移(09-08)集成适配器:渲染层直连本地生图 sidecar 的
// /comfy/* 路由(流 A 后端),把 B 流 ComfyEngineClient 与 D 流
// ComfyWorkflowLibraryTransport 的契约形状翻译过去——零 preload 改动,
// fetch 全部走 127.0.0.1:17595 + 固定本地令牌(照 run-uncloth.ts 直连先例)。
//
// 纯映射函数(mapEngineStatus/mapJob 等)全部导出,适配器测试直接覆盖
// 字段对照;HTTP 行为(错误大白话/两步删除/keep-both 重试)用 fetch mock 测。

import type {
  ComfyCatalogEntry,
  ComfyDoctorReport,
  ComfyEngineAckReply,
  ComfyEngineClient,
  ComfyEngineJob,
  ComfyEngineJobKind,
  ComfyEngineJobReport,
  ComfyEngineJobStage,
  ComfyEngineLifecycleState,
  ComfyEnginePathsStatus,
  ComfyEngineStartJobReply,
  ComfyEngineStatus,
  ComfyEngineUpdateCheckReply,
  ComfyPathsUpdate,
  ComfyPathsValidation,
  ComfyPluginInfo,
  ComfyPluginState,
  ComfyPluginUsageReply,
  ComfySnapshotEntry,
  ComfyBridgeWritebacksReply,
  ComfyManyingSyncReply,
} from "@/components/panels/settings/comfy-engine/comfy-engine-contract";
import type {
  ComfyWorkflowDeleteScan,
  ComfyWorkflowImportConflictMode,
  ComfyWorkflowImportFile,
  ComfyWorkflowImportFileResult,
  ComfyWorkflowLibraryFolder,
  ComfyWorkflowLibraryTransport,
  ComfyWorkflowLibraryTree,
} from "@/lib/assist/image-studio/comfy-workflow-library";

const COMFY_SIDECAR_BASE_URL = "http://127.0.0.1:17595";
const COMFY_SIDECAR_TOKEN = "manying-local-image";
const DEFAULT_TIMEOUT_MS = 15_000;
/** 引擎冷启动 job(torch 加载最长 2 分钟,HEALTH_TIMEOUT_S=120)的轮询上限。 */
const START_JOB_TIMEOUT_MS = 150_000;
const START_JOB_POLL_INTERVAL_MS = 1_000;
/** keep-both 冲突改名的重试轮数上限(名 2、名 3 …,超过视为异常)。 */
const IMPORT_RENAME_MAX_ROUNDS = 20;
/** 空文件夹占位文件(sidecar 工作流库无文件夹概念,用 .keep.json 标记目录)。 */
const FOLDER_MARKER_FILENAME = ".keep.json";

// ---------------------------------------------------------------------------
// 环境判定与共享 fetch helper
// ---------------------------------------------------------------------------

/**
 * Electron 渲染层判定:preload 桥之外的自包含判法(既有代码用 window.imageStorage
 * 等桥存在性,这里取 navigator.userAgent,避免耦合特定桥)。jsdom/网页模式为
 * false——契约入口据此保持 undefined,测试继续走注入 mock。
 */
export function isElectronRenderer(): boolean {
  return typeof navigator !== "undefined" && navigator.userAgent.includes("Electron");
}

interface ComfySidecarRequestOptions {
  body?: unknown;
  query?: Record<string, string>;
  timeoutMs?: number;
}

/**
 * sidecar 探活门禁(09-08 打包 smoke 修复):挂载期/启动提醒的 comfy 探测若在
 * sidecar 未运行时盲发 fetch,Chromium 会在渲染层记 network 级错误日志(ERR_
 * CONNECTION_REFUSED),装机 smoke 判红——既有设置行探测全走 preload 桥(IPC)
 * 从不产生此问题,comfy 直连 HTTP 是异类。故先经 window.imageGenRuntime
 * (IPC,主进程视角)确认 sidecar 在跑才发真请求;没跑直接抛大白话指引,
 * 零网络尝试。TTL 缓存避免每次调用都打 IPC。
 */
type ComfySidecarLivenessProbe = () => Promise<boolean>;
let livenessProbeOverride: ComfySidecarLivenessProbe | null = null;
let livenessCache: { at: number; up: boolean } | null = null;
const LIVENESS_TTL_MS = 3_000;

/** 测试注入位(jsdom 无 imageGenRuntime 桥,单测直控门禁语义)。 */
export function setComfySidecarLivenessProbeForTests(probe: ComfySidecarLivenessProbe | null): void {
  livenessProbeOverride = probe;
  livenessCache = null;
}

async function sidecarLikelyUp(): Promise<boolean> {
  if (livenessProbeOverride) {
    try {
      return await livenessProbeOverride();
    } catch {
      return false;
    }
  }
  if (livenessCache && Date.now() - livenessCache.at < LIVENESS_TTL_MS) return livenessCache.up;
  let up = false;
  try {
    const bridge = (window as { imageGenRuntime?: { status?: () => Promise<{ running?: boolean }> } })
      .imageGenRuntime;
    if (bridge?.status) up = Boolean((await bridge.status())?.running);
  } catch {
    up = false;
  }
  livenessCache = { at: Date.now(), up };
  return up;
}

/** sidecar 统一 JSON 请求:探活门禁 + Bearer 令牌 + 超时 + 错误翻译成大白话。 */
async function comfySidecarRequest<T>(
  method: "GET" | "POST" | "DELETE",
  path: string,
  options: ComfySidecarRequestOptions = {},
): Promise<T> {
  if (!(await sidecarLikelyUp())) {
    // sidecar 未运行:不发 fetch(避免渲染层网络错误日志),直接大白话指路。
    throw new Error("本地生图服务未运行,请先在 设置→本地配置 完成「准备运行时」");
  }
  const url = new URL(`${COMFY_SIDECAR_BASE_URL}${path}`);
  for (const [key, value] of Object.entries(options.query ?? {})) {
    url.searchParams.set(key, value);
  }
  let response: Response;
  try {
    response = await fetch(url.toString(), {
      method,
      headers: {
        ...(options.body !== undefined ? { "Content-Type": "application/json" } : {}),
        Authorization: `Bearer ${COMFY_SIDECAR_TOKEN}`,
      },
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
      signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
  } catch (error) {
    if (error instanceof DOMException && (error.name === "TimeoutError" || error.name === "AbortError")) {
      throw new Error("本地生图服务响应超时,请稍后重试");
    }
    throw new Error("无法连接本地生图服务,请先在 设置→本地配置 完成「准备运行时」后重试");
  }
  const json = (await response.json().catch(() => null)) as
    | (T & { error?: { message?: string } })
    | null;
  if (!response.ok) {
    throw new Error(json?.error?.message || `请求失败(HTTP ${response.status})`);
  }
  if (!json) {
    throw new Error("本地生图服务应答格式异常");
  }
  return json;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// sidecar 原始形状(A 流:engine_manager.jobs / status / plugin_manager)
// ---------------------------------------------------------------------------

interface SidecarJobReply {
  id?: string;
  kind?: string;
  status?: string; // running | complete | error
  progress?: number;
  step?: string;
  message?: string | null;
  error?: string | null;
  result?: Record<string, unknown> | null;
}

interface SidecarEngineStatusReply {
  installed?: boolean;
  version?: string | null;
  latest?: string | null;
  state?: string; // not_installed | installing | updating | resetting | running | stopped
  torch?: string | null; // 引擎 venv 的 PyTorch 版本(装时入账)
  launchArgs?: string | null; // 09-10 Desktop 化:命令行整串(后端旧 dict 已读侧迁移)
  envVars?: Record<string, string> | null;
  portConflictPolicy?: "auto-shift" | "fail" | null;
  running?: boolean;
  port?: number | null;
  modelsDir?: string | null;
  defaultModelsDir?: string | null;
  pluginCount?: number;
  updateAvailable?: boolean;
  aheadBy?: number | null;
  lastCheckAt?: number | null;
  nodeCount?: number | null;
  needsSetup?: boolean;
  message?: string | null;
  installDir?: string | null;
}

interface SidecarPluginRow {
  id?: string;
  name?: string | null;
  desc?: string | null;
  license?: string | null;
  state?: string;
  version?: string | null;
  deps?: Record<string, string>;
  nodeCount?: number | null;
  dirExists?: boolean;
}

interface SidecarCatalogReply {
  curated?: Array<Record<string, unknown>>;
  registry?: Array<Record<string, unknown>>;
}

interface SidecarDoctorReply {
  missing?: Array<{ plugin?: string; message?: string }>;
  drifted?: Array<{ plugin?: string; package?: string; recorded?: string; actual?: string; message?: string }>;
  orphan?: Array<{ plugin?: string; message?: string }>;
}

// ---------------------------------------------------------------------------
// 纯映射:引擎状态(A status → B ComfyEngineStatus)
// ---------------------------------------------------------------------------

/**
 * 状态机映射:A 的后端生命周期(not_installed/installing/updating/resetting/
 * running/stopped)→ B 的渲染层生命周期。B 的「更新中」由 activeJob 胶囊表达,
 * lifecycle 只区分装没装;needsSetup(源码目录残留=装了一半)仅在未安装时有意义。
 */
export function mapEngineStatus(raw: SidecarEngineStatusReply): ComfyEngineStatus {
  const installed = raw.installed === true;
  let state: ComfyEngineLifecycleState;
  switch (raw.state) {
    case "installing":
      state = "installing";
      break;
    case "not_installed":
      state = raw.needsSetup === true ? "needs-setup" : "not-installed";
      break;
    case "updating":
    case "resetting":
    case "running":
    case "stopped":
      state = "ready";
      break;
    default:
      state = "error";
  }
  return {
    installed,
    version: raw.version ?? null,
    latest: raw.latest ?? null,
    state,
    port: raw.port ?? null,
    modelsDir: raw.modelsDir ?? null,
    defaultModelsDir: raw.defaultModelsDir ?? null,
    serviceRunning: raw.running === true,
    pluginCount: typeof raw.pluginCount === "number" ? raw.pluginCount : 0,
    updateAvailable: raw.updateAvailable === true,
    aheadBy: typeof raw.aheadBy === "number" ? raw.aheadBy : null,
    lastCheckAt: typeof raw.lastCheckAt === "number" ? raw.lastCheckAt : null,
    message: raw.message ?? null,
    installDir: raw.installDir ?? null,
    torch: raw.torch ?? null,
    launchArgs: typeof raw.launchArgs === "string" ? raw.launchArgs : null,
    envVars:
      raw.envVars && typeof raw.envVars === "object" && !Array.isArray(raw.envVars)
        ? (Object.fromEntries(
            Object.entries(raw.envVars as Record<string, unknown>).map(([key, value]) => [key, String(value)]),
          ) as Record<string, string>)
        : null,
    portConflictPolicy: raw.portConflictPolicy === "fail" ? "fail" : raw.portConflictPolicy === "auto-shift" ? "auto-shift" : null,
  };
}

// ---------------------------------------------------------------------------
// 纯映射:任务(A jobs → B ComfyEngineJob)
// ---------------------------------------------------------------------------

/** A 的 job kind → B 的任务枚举(engine-start 由 startEngine 内部轮询,不外露)。 */
const JOB_KIND_MAP: Record<string, ComfyEngineJobKind> = {
  "engine-install": "install",
  "engine-update": "update",
  "engine-reset": "reset",
  "plugin-install": "plugin-install",
  "plugin-update": "plugin-update",
  "plugin-uninstall": "plugin-remove",
  // B 契约没有 start 任务枚举;此映射仅为兜底(公共 getJob 不会收到 start job)。
  "engine-start": "install",
};

/** A 的 step → B 的阶段枚举(对不上的一律 null,B 容忍 null)。 */
const JOB_STAGE_MAP: Record<string, ComfyEngineJobStage> = {
  "git-clone": "download",
  venv: "dependencies",
  "pip-torch": "dependencies",
  "pip-requirements": "dependencies",
  "pip-core": "dependencies",
  "pip-plugins": "dependencies",
  pip: "dependencies",
  requirements: "dependencies",
  layout: "finalize",
  snapshot: "snapshot",
  fetch: "pull",
  checkout: "pull",
  pull: "pull",
  restart: "restart",
  verify: "verify",
  acquire: "clone",
  clone: "clone",
  recheck: "recheck",
  "wipe-venv": "clean",
  clean: "clean",
  rebuild: "rebuild",
};

function mapJobReport(job: SidecarJobReply): ComfyEngineJobReport | null {
  const result = job.result;
  if (!result || typeof result !== "object") return null;
  if (job.kind === "engine-update") {
    const nodeCountAfter = toNumber(result.nodeCount) ?? 0;
    const nodeDelta = toNumber(result.nodeDelta) ?? 0;
    const issues = Array.isArray(result.pluginIssues)
      ? result.pluginIssues.map((item) => String((item as { plugin?: unknown })?.plugin ?? "")).filter(Boolean)
      : [];
    const pluginTotal = toNumber(result.pluginCount) ?? issues.length;
    return {
      kind: "update",
      previousVersion: String(result.oldVersion ?? ""),
      newVersion: String(result.newVersion ?? ""),
      nodeCountBefore: Math.max(0, nodeCountAfter - nodeDelta),
      nodeCountAfter,
      incompatiblePlugins: issues,
      compatiblePlugins: Math.max(0, pluginTotal - issues.length),
    };
  }
  if (job.kind === "plugin-install") {
    return {
      kind: "plugin-install",
      pluginId: String(result.plugin ?? ""),
      addedNodeCount: toNumber(result.addedNodes) ?? 0,
    };
  }
  return { kind: "generic", message: String(result.message ?? "操作完成") };
}

export function mapJob(raw: SidecarJobReply): ComfyEngineJob {
  const failed = raw.status === "error";
  return {
    jobId: String(raw.id ?? ""),
    kind: JOB_KIND_MAP[raw.kind ?? ""] ?? "install",
    state: raw.status === "complete" ? "succeeded" : failed ? "failed" : "running",
    progress: typeof raw.progress === "number" ? raw.progress : null,
    stage: JOB_STAGE_MAP[raw.step ?? ""] ?? null,
    message: failed ? (raw.error ?? raw.message ?? null) : (raw.message ?? null),
    report: raw.status === "complete" ? mapJobReport(raw) : null,
  };
}

function toNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

// ---------------------------------------------------------------------------
// 纯映射:插件/目录/体检(plugin_manager 返回形状 → B 契约)
// ---------------------------------------------------------------------------

export function mapPluginRow(raw: SidecarPluginRow): ComfyPluginInfo {
  const deps = raw.deps && typeof raw.deps === "object" ? Object.keys(raw.deps) : [];
  const state: ComfyPluginState = raw.dirExists === false ? "install-failed" : "installed";
  return {
    id: String(raw.id ?? ""),
    name: raw.name || String(raw.id ?? ""),
    description: raw.desc ?? "",
    license: raw.license || "未标明",
    state,
    version: raw.version ?? null,
    deps: [...deps].sort(),
    author: null,
    downloads: null,
    category: null,
    nodeCount: raw.nodeCount ?? null,
  };
}

function mapCatalogEntry(raw: Record<string, unknown>, source: "curated" | "registry"): ComfyCatalogEntry {
  const installed = raw.installed === true;
  return {
    id: String(raw.id ?? ""),
    name: String(raw.name ?? raw.id ?? ""),
    description: String(raw.desc ?? raw.desc_zh ?? ""),
    license: (raw.verified_license as string | undefined) || (raw.license as string | null) || "未标明",
    author: (raw.author as string | null) ?? null,
    downloads: (raw.downloads as number | null) ?? null,
    category: (raw.category as string | null) ?? null,
    installedState: installed ? "installed" : null,
    ref: String(raw.id ?? ""),
    source,
  };
}

export function mapCatalogReply(raw: SidecarCatalogReply): ComfyCatalogEntry[] {
  // 09-09 初始加载落地:同一包在策展与 Registry 都会出现(如 rgthree),
  // 按目录条目 id 去重,策展优先(license 已人工核验,信息更可信)。
  const seen = new Set<string>();
  const entries: ComfyCatalogEntry[] = [];
  for (const entry of [
    ...(raw.curated ?? []).map((item) => mapCatalogEntry(item, "curated")),
    ...(raw.registry ?? []).map((item) => mapCatalogEntry(item, "registry")),
  ]) {
    if (seen.has(entry.id)) continue;
    seen.add(entry.id);
    entries.push(entry);
  }
  return entries;
}

export function mapDoctorReport(raw: SidecarDoctorReply): ComfyDoctorReport {
  return {
    missing: (raw.missing ?? []).map((item) => `${item.plugin ?? "未知插件"}:${item.message ?? "缺失"}`),
    drifted: (raw.drifted ?? []).map(
      (item) => `${item.plugin ?? "?"} 的 ${item.package ?? "?"} 账本 ${item.recorded ?? "?"} → 实际 ${item.actual ?? "?"}`,
    ),
    orphan: (raw.orphan ?? []).map((item) => `${item.plugin ?? "未知目录"}:${item.message ?? "孤儿目录"}`),
  };
}

// ---------------------------------------------------------------------------
// 引擎 client(HTTP 实现,逐方法对接 A 路由)
// ---------------------------------------------------------------------------

/** 等待 sidecar job 到终态(start/uninstall 这类 ack 语义的方法用)。 */
async function pollJobUntilTerminal(
  jobId: string,
  timeoutMs: number,
  intervalMs: number,
): Promise<SidecarJobReply> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const job = await comfySidecarRequest<SidecarJobReply>(
      "GET",
      `/comfy/jobs/${encodeURIComponent(jobId)}`,
      { timeoutMs: 10_000 },
    );
    if (job.status !== "running") return job;
    if (Date.now() >= deadline) {
      throw new Error("等待任务完成超时,请稍后到 设置→本地配置 查看状态");
    }
    await sleep(intervalMs);
  }
}

/** job 终态 → ack 语义(成功 accepted / 失败带大白话)。 */
function settleAckJob(job: SidecarJobReply, fallbackMessage: string): ComfyEngineAckReply {
  if (job.status === "complete") return { accepted: true };
  return { accepted: false, message: job.error ?? job.message ?? fallbackMessage };
}

export function createHttpComfyEngineClient(): ComfyEngineClient {
  return {
    async getEngineStatus() {
      return mapEngineStatus(
        await comfySidecarRequest<SidecarEngineStatusReply>("GET", "/comfy/engine/status"),
      );
    },
    async installEngine(): Promise<ComfyEngineStartJobReply> {
      return comfySidecarRequest<ComfyEngineStartJobReply>("POST", "/comfy/engine/install");
    },
    async startEngine(): Promise<ComfyEngineAckReply> {
      const { jobId } = await comfySidecarRequest<ComfyEngineStartJobReply>("POST", "/comfy/engine/start");
      try {
        // 冷启动走 job(health 轮询最长 2 分钟):ack 语义等待终态,期间 UI 保持启动中。
        const job = await pollJobUntilTerminal(jobId, START_JOB_TIMEOUT_MS, START_JOB_POLL_INTERVAL_MS);
        return settleAckJob(job, "服务启动失败");
      } catch (error) {
        return { accepted: false, message: error instanceof Error ? error.message : "服务启动失败" };
      }
    },
    async stopEngine(): Promise<ComfyEngineAckReply> {
      const raw = await comfySidecarRequest<{ running?: boolean; stopped?: boolean }>(
        "POST",
        "/comfy/engine/stop",
      );
      if (raw.running) {
        return { accepted: false, message: "停止指令已下发,但引擎进程仍在运行(可能被外部接管)" };
      }
      return { accepted: true };
    },
    async checkUpdate(): Promise<ComfyEngineUpdateCheckReply> {
      const raw = await comfySidecarRequest<{
        current?: string | null;
        latest?: string | null;
        updateAvailable?: boolean;
        checkedAt?: number;
        error?: string | null;
      }>("POST", "/comfy/engine/update-check", { timeoutMs: 30_000 });
      if (raw.error) throw new Error(raw.error);
      return {
        current: raw.current ?? null,
        latest: raw.latest ?? null,
        updateAvailable: raw.updateAvailable === true,
        checkedAt: raw.checkedAt ?? Date.now(),
      };
    },
    async updateEngine(): Promise<ComfyEngineStartJobReply> {
      return comfySidecarRequest<ComfyEngineStartJobReply>("POST", "/comfy/engine/update");
    },
    async rollbackUpdate(snapshotId?: string): Promise<ComfyEngineAckReply> {
      try {
        const raw = await comfySidecarRequest<{ rolledBackTo?: string }>("POST", "/comfy/engine/rollback", {
          ...(snapshotId ? { body: { snapshotId } } : {}),
        });
        return { accepted: true, message: raw.rolledBackTo ? `已回滚到快照 ${raw.rolledBackTo}` : "已回滚" };
      } catch (error) {
        return { accepted: false, message: error instanceof Error ? error.message : "回滚失败" };
      }
    },
    async resetEngine(): Promise<ComfyEngineStartJobReply> {
      return comfySidecarRequest<ComfyEngineStartJobReply>("POST", "/comfy/engine/reset");
    },
    async getJob(jobId: string): Promise<ComfyEngineJob> {
      return mapJob(
        await comfySidecarRequest<SidecarJobReply>("GET", `/comfy/jobs/${encodeURIComponent(jobId)}`),
      );
    },
    async setModelsDir(path: string): Promise<ComfyEngineAckReply> {
      // 失败(非法路径/引擎未装)由 sidecar 抛 EngineOpError → 这里转异常给 hook toast。
      await comfySidecarRequest("POST", "/comfy/engine/config", { body: { modelsDir: path } });
      return { accepted: true };
    },
    async getPaths(): Promise<ComfyEnginePathsStatus> {
      return comfySidecarRequest<ComfyEnginePathsStatus>("GET", "/comfy/paths");
    },
    async validatePaths(update: ComfyPathsUpdate): Promise<ComfyPathsValidation> {
      const raw = await comfySidecarRequest<Record<string, unknown>>("POST", "/comfy/paths/validate", { body: update });
      return {
        ok: raw.ok === true,
        errors: (raw.errors ?? {}) as ComfyPathsValidation["errors"],
        warnings: (raw.warnings ?? {}) as ComfyPathsValidation["warnings"],
      };
    },
    async setPaths(update: ComfyPathsUpdate): Promise<ComfyEnginePathsStatus> {
      // 已安装时 sidecar 抛「请走迁移」,由组件捕获并转确认弹窗
      return comfySidecarRequest<ComfyEnginePathsStatus>("POST", "/comfy/paths/set", { body: update });
    },
    async migratePaths(update: ComfyPathsUpdate & { startAfter?: boolean }): Promise<ComfyEngineStartJobReply> {
      const raw = await comfySidecarRequest<{ jobId?: string }>("POST", "/comfy/paths/migrate", { body: update });
      return { jobId: String(raw.jobId ?? "") };
    },
    async cleanOrphans(): Promise<{ removed: string[]; message?: string }> {
      const raw = await comfySidecarRequest<{ removed?: string[]; message?: string }>("POST", "/comfy/plugins/clean-orphans");
      return { removed: Array.isArray(raw.removed) ? raw.removed : [], message: raw.message };
    },

    async listSnapshots(): Promise<ComfySnapshotEntry[]> {
      const raw = await comfySidecarRequest<unknown[]>("GET", "/comfy/engine/snapshots");
      return (Array.isArray(raw) ? raw : []).map((item) => {
        const row = (item ?? {}) as Record<string, unknown>;
        return {
          id: String(row.id ?? ""),
          createdAt: Number(row.createdAt ?? 0),
          reason: String(row.reason ?? ""),
          version: row.version == null ? null : String(row.version),
          full: row.full === true,
        };
      });
    },

    async listModels(): Promise<{ modelsDir: string; groups: Array<{ category: string; files: Array<{ name: string; sizeBytes: number }> }>; totalBytes: number } | null> {
      try {
        return await comfySidecarRequest("GET", "/comfy/engine/models");
      } catch {
        return null; // 侧车缺席/失败不阻塞模型页(空态占位)
      }
    },

    async setLaunchConfig(config: { argsString?: string; envVars?: Record<string, string>; portConflictPolicy?: "auto-shift" | "fail" }): Promise<ComfyEngineAckReply> {
      // 引擎运行中此保存会触发同步重启(stop 15s+健康等待 120s),超时须盖过重启窗口(深审 W1)
      return comfySidecarRequest<ComfyEngineAckReply>("POST", "/comfy/engine/config", {
        body: config,
        timeoutMs: 180_000,
      });
    },
    async getBridgeWritebacks(cursor: number): Promise<ComfyBridgeWritebacksReply | null> {
      try {
        return await comfySidecarRequest<ComfyBridgeWritebacksReply>("GET", "/comfy/bridge/writebacks", {
          query: { cursor: String(cursor), include_image: "1" },
        });
      } catch {
        return null; // 轮询面:失败静默(sidecar 未起=无回写,不算错误)
      }
    },
    async ackBridgeWritebacks(upTo: number): Promise<number | null> {
      try {
        const raw = await comfySidecarRequest<{ deleted?: number }>("POST", "/comfy/bridge/writebacks/ack", {
          body: { upTo },
        });
        return raw.deleted ?? 0;
      } catch {
        return null; // ack 失败不致命:下次轮询重消费(落账幂等由 checkpointRef 保证)
      }
    },
    async pushBridgeStoryboards(
      shots: Array<{ id: string; label: string; episodeId?: string; videoReady?: boolean; imageReady?: boolean }>,
      currentEpisodeId?: string,
    ): Promise<boolean> {
      try {
        await comfySidecarRequest<{ updatedAt?: number }>("POST", "/comfy/bridge/storyboards", {
          body: { shots, ...(currentEpisodeId ? { currentEpisodeId } : {}) },
        });
        return true;
      } catch {
        return false; // 推送面:失败静默(下一 tick 重推)
      }
    },
    async getBridgeActions(cursor: number): Promise<{ cursor: number; items: Array<{ id: number; kind: string }> } | null> {
      try {
        return await comfySidecarRequest<{ cursor: number; items: Array<{ id: number; kind: string }> }>(
          "GET", `/comfy/bridge/actions?cursor=${cursor}`,
        );
      } catch {
        return null; // 通道缺席(旧 sidecar)=静默,动作按钮不可用
      }
    },
    async ackBridgeActions(upTo: number): Promise<number | null> {
      try {
        const raw = await comfySidecarRequest<{ deleted?: number }>("POST", "/comfy/bridge/actions/ack", {
          body: { upTo },
        });
        return raw.deleted ?? 0;
      } catch {
        return null;
      }
    },
    async uploadBridgeReference(name: string, imageB64: string): Promise<{ accepted: boolean; name?: string } | null> {
      try {
        const raw = await comfySidecarRequest<{ accepted?: boolean; name?: string }>("POST", "/comfy/bridge/reference", {
          body: { name, imageB64 },
          timeoutMs: 60_000,
        });
        return { accepted: raw.accepted === true, name: raw.name };
      } catch {
        return null;
      }
    },
    async syncManyingNodes(): Promise<ComfyManyingSyncReply | null> {
      try {
        return await comfySidecarRequest<ComfyManyingSyncReply>("POST", "/comfy/manying/sync");
      } catch (error) {
        return { copied: 0, restartRequired: false, ...(error instanceof Error ? {} : {}) };
      }
    },

    async listPlugins(): Promise<ComfyPluginInfo[]> {
      const raw = await comfySidecarRequest<{ plugins?: SidecarPluginRow[] }>("GET", "/comfy/plugins");
      return (raw.plugins ?? []).map(mapPluginRow);
    },
    async searchCatalog(query: string): Promise<ComfyCatalogEntry[]> {
      const raw = await comfySidecarRequest<SidecarCatalogReply>("GET", "/comfy/catalog/search", {
        query: { q: query },
      });
      return mapCatalogReply(raw);
    },
    async installPlugin(source, ref): Promise<ComfyEngineStartJobReply> {
      return comfySidecarRequest<ComfyEngineStartJobReply>("POST", "/comfy/plugins/install", {
        body: { source, ref },
      });
    },
    async updatePlugin(id: string): Promise<ComfyEngineStartJobReply> {
      return comfySidecarRequest<ComfyEngineStartJobReply>(
        "POST",
        `/comfy/plugins/${encodeURIComponent(id)}/update`,
      );
    },
    async uninstallPlugin(id: string): Promise<ComfyEngineAckReply> {
      // 引用扫描(getPluginUsage)已由 UI 前置完成,这里带 confirm 直接执行;
      // 卸载是 job(删目录+依赖计数+重启验证),轮询到终态再回 ack。
      try {
        const { jobId } = await comfySidecarRequest<ComfyEngineStartJobReply>(
          "DELETE",
          `/comfy/plugins/${encodeURIComponent(id)}`,
          { query: { confirm: "true" } },
        );
        const job = await pollJobUntilTerminal(jobId, START_JOB_TIMEOUT_MS, START_JOB_POLL_INTERVAL_MS);
        return settleAckJob(job, "插件卸载失败");
      } catch (error) {
        return { accepted: false, message: error instanceof Error ? error.message : "插件卸载失败" };
      }
    },
    async getPluginUsage(id: string): Promise<ComfyPluginUsageReply> {
      const raw = await comfySidecarRequest<{
        referencedBy?: Array<{ workflow?: string; usedTypes?: string[] }>;
      }>("GET", `/comfy/plugins/${encodeURIComponent(id)}/references`);
      return {
        workflows: (raw.referencedBy ?? []).map((item) => ({
          id: String(item.workflow ?? ""),
          name: workflowDisplayName(String(item.workflow ?? "")),
        })),
      };
    },
    async doctor(): Promise<ComfyDoctorReport> {
      return mapDoctorReport(await comfySidecarRequest<SidecarDoctorReply>("GET", "/comfy/plugins/doctor"));
    },
  };
}

// ---------------------------------------------------------------------------
// 工作流库 transport(HTTP 实现,对接 A 的 /comfy/workflows*)
// ---------------------------------------------------------------------------

interface SidecarWorkflowEntry {
  id?: string;
  name?: string;
  nodeCount?: number;
  missingNodes?: string[] | null;
  missingPlugins?: string[] | null;
  invalidJson?: boolean;
  sizeBytes?: number;
}

function workflowDisplayName(id: string): string {
  const last = id.split("/").pop() ?? id;
  return last.replace(/\.json$/i, "");
}

function parentDirOf(id: string): string | null {
  const index = id.lastIndexOf("/");
  return index > 0 ? id.slice(0, index) : null;
}

function isFolderMarker(id: string): boolean {
  return id === FOLDER_MARKER_FILENAME || id.endsWith(`/${FOLDER_MARKER_FILENAME}`);
}

/** A 的扁平路径列表 → D 的树(文件夹从路径段推导;.keep.json 占位只留文件夹)。 */
export function mapWorkflowTree(entries: SidecarWorkflowEntry[]): ComfyWorkflowLibraryTree {
  const folders = new Map<string, ComfyWorkflowLibraryFolder>();
  const ensureFolder = (dirPath: string) => {
    const segments = dirPath.split("/");
    for (let depth = 1; depth <= segments.length; depth += 1) {
      const id = segments.slice(0, depth).join("/");
      if (!folders.has(id)) {
        folders.set(id, {
          id,
          name: segments[depth - 1] ?? id,
          parentId: depth > 1 ? segments.slice(0, depth - 1).join("/") : null,
        });
      }
    }
  };
  const workflows: ComfyWorkflowLibraryTree["workflows"] = [];
  for (const entry of entries) {
    const id = String(entry.id ?? "");
    if (!id) continue;
    const folderId = parentDirOf(id);
    if (folderId) ensureFolder(folderId);
    if (isFolderMarker(id)) continue; // 文件夹占位:只为让空目录在树里可见
    workflows.push({
      id,
      name: entry.name || workflowDisplayName(id),
      folderId,
      nodeCount: entry.nodeCount ?? 0,
      // 引擎未跑时 A 给 null(未知),不误报缺失 → 空数组。
      missingClassTypes: entry.missingNodes ?? [],
      updatedAt: 0,
    });
  }
  return { folders: [...folders.values()], workflows };
}

async function fetchRawWorkflowEntries(): Promise<SidecarWorkflowEntry[]> {
  const raw = await comfySidecarRequest<{ workflows?: SidecarWorkflowEntry[] }>("GET", "/comfy/workflows");
  return raw.workflows ?? [];
}

function validateFolderName(name: string): void {
  const trimmed = name.trim();
  if (!trimmed || trimmed.includes("/") || trimmed.includes("\\") || trimmed.includes("..")) {
    throw new Error("文件夹名不能为空,也不能包含路径分隔符");
  }
}

/** 把 D 的导入三模式翻译到 A 的 {files, overwrite}:skip=false / overwrite=true /
 * keep-both=先 false,冲突者改名「名 2」重试(与 mock 语义一致)。 */
async function importWithMode(
  files: ComfyWorkflowImportFile[],
  mode: ComfyWorkflowImportConflictMode,
): Promise<ComfyWorkflowImportFileResult[]> {
  // 逐文件预检 JSON(A 的导入对坏 JSON 整批拒绝;坏文件单独标失败,好文件照走)。
  const sentToOriginal = new Map<string, string>();
  const pending: Array<{ original: string; sentName: string; content: string; renamedTo?: string }> = [];
  const results: ComfyWorkflowImportFileResult[] = [];
  for (const file of files) {
    try {
      JSON.parse(file.content);
    } catch {
      results.push({ name: file.name, status: "failed", error: "文件不是有效 JSON" });
      continue;
    }
    const sentName = /\.json$/i.test(file.name) ? file.name : `${file.name}.json`;
    sentToOriginal.set(sentName, file.name);
    pending.push({ original: file.name, sentName, content: file.content });
  }

  const overwrite = mode === "overwrite";
  /** keep-both 的逐文件改名计数(每个冲突文件独立地从「名 2」试起)。 */
  const retryCounters = new Map<string, number>();
  // A 端单请求只处理前 50 个文件(超出静默截断):分批发送——09-10 实弹
  // 78 流迁移只入库 50、余 27 被误标失败,即此坑
  const IMPORT_BATCH_MAX = 50;
  while (pending.length > 0) {
    const batch = pending.splice(0, IMPORT_BATCH_MAX);
    const reply = await comfySidecarRequest<{ imported?: string[]; skipped?: string[] }>(
      "POST",
      "/comfy/workflows/import",
      { body: { files: batch.map((item) => ({ name: item.sentName, content: item.content })), overwrite } },
    );
    const importedSet = new Set(reply.imported ?? []);
    const skippedSet = new Set(reply.skipped ?? []);
    const next: typeof pending = [];
    for (const item of batch) {
      if (importedSet.has(item.sentName)) {
        const name = sentToOriginal.get(item.sentName) ?? item.original;
        if (item.renamedTo) {
          results.push({ name, status: "renamed", id: item.sentName, renamedTo: item.renamedTo });
        } else {
          results.push({ name, status: "imported", id: item.sentName });
        }
        continue;
      }
      const retryCount = (retryCounters.get(item.original) ?? 0) + 1;
      if (mode === "keep-both" && skippedSet.has(item.sentName) && retryCount <= IMPORT_RENAME_MAX_ROUNDS) {
        // keep-both:同名冲突 → 该文件独立改「名 2」「名 3」…重试。
        retryCounters.set(item.original, retryCount);
        const base = item.sentName.replace(/\.json$/i, "");
        const renamed = `${base} ${retryCount + 1}.json`;
        sentToOriginal.set(renamed, item.original);
        next.push({
          original: item.original,
          sentName: renamed,
          content: item.content,
          renamedTo: renamed.replace(/\.json$/i, ""),
        });
        continue;
      }
      if (skippedSet.has(item.sentName)) {
        results.push({ name: item.original, status: "skipped", reason: "conflict" });
        continue;
      }
      // 既没 imported 也没 skipped:应答异常,按失败兜底。
      results.push({ name: item.original, status: "failed", error: "导入应答异常" });
    }
    pending.unshift(...next); // keep-both 改名重试回队首
  }
  return results;
}

export function createHttpComfyWorkflowLibraryTransport(): ComfyWorkflowLibraryTransport {
  return {
    async list(): Promise<ComfyWorkflowLibraryTree> {
      return mapWorkflowTree(await fetchRawWorkflowEntries());
    },
    async content(id: string): Promise<string> {
      const raw = await comfySidecarRequest<{ content?: string }>(
        "GET",
        `/comfy/workflows/${encodeURIComponent(id)}/content`,
      );
      return raw.content ?? "";
    },
    importFiles: (files, mode) => importWithMode(files, mode),
    async renameWorkflow(id, name) {
      try {
        await comfySidecarRequest("POST", `/comfy/workflows/${encodeURIComponent(id)}/rename`, {
          body: { name },
        });
        return { ok: true };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : "重命名失败" };
      }
    },
    async moveWorkflow(id, folderId) {
      try {
        await comfySidecarRequest("POST", `/comfy/workflows/${encodeURIComponent(id)}/move`, {
          body: { to: folderId ?? "" },
        });
        return { ok: true };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : "移动失败" };
      }
    },
    /** 删除第一步:引用扫描(A 的 delete 不带 confirm 即只扫描,含备份前的插件引用清单)。 */
    async scanDeleteReferences(id): Promise<ComfyWorkflowDeleteScan> {
      const raw = await comfySidecarRequest<{ pluginsUsed?: string[]; nodeTypes?: string[] }>(
        "POST",
        `/comfy/workflows/${encodeURIComponent(id)}/delete`,
        { body: {} },
      );
      return {
        references: (raw.pluginsUsed ?? []).map((plugin) => ({ kind: "plugin", name: plugin })),
      };
    },
    /** 删除第二步:二次确认后执行(sidecar 做快照备份)。 */
    async deleteWorkflow(id) {
      try {
        const raw = await comfySidecarRequest<{ deleted?: boolean }>(
          "POST",
          `/comfy/workflows/${encodeURIComponent(id)}/delete`,
          { body: { confirm: true } },
        );
        if (raw.deleted !== true) return { ok: false, error: "删除未执行" };
        return { ok: true };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : "删除失败" };
      }
    },
    /** 空文件夹持久化:A 的库没有文件夹实体,导入 .keep.json 占位让目录可见。 */
    async createFolder(name, parentId): Promise<ComfyWorkflowLibraryFolder> {
      validateFolderName(name);
      const trimmed = name.trim();
      const dir = parentId ? `${parentId}/${trimmed}` : trimmed;
      await comfySidecarRequest("POST", "/comfy/workflows/import", {
        body: { files: [{ name: `${dir}/${FOLDER_MARKER_FILENAME}`, content: "{}" }], overwrite: true },
      });
      return { id: dir, name: trimmed, parentId };
    },
    async renameFolder(id, name) {
      validateFolderName(name);
      const trimmed = name.trim();
      const entries = await fetchRawWorkflowEntries();
      const prefix = `${id}/`;
      for (const entry of entries) {
        const entryId = String(entry.id ?? "");
        if (!entryId.startsWith(prefix)) continue;
        const rest = entryId.slice(prefix.length);
        const newDir = rest.includes("/") ? `${trimmed}/${rest.slice(0, rest.lastIndexOf("/"))}` : trimmed;
        try {
          await comfySidecarRequest("POST", `/comfy/workflows/${encodeURIComponent(entryId)}/move`, {
            body: { to: newDir },
          });
        } catch (error) {
          return { ok: false, error: error instanceof Error ? error.message : "文件夹重命名失败" };
        }
      }
      return { ok: true };
    },
    async deleteFolder(id) {
      const entries = await fetchRawWorkflowEntries();
      const prefix = `${id}/`;
      for (const entry of entries) {
        const entryId = String(entry.id ?? "");
        if (!entryId.startsWith(prefix)) continue;
        try {
          await comfySidecarRequest("POST", `/comfy/workflows/${encodeURIComponent(entryId)}/delete`, {
            body: { confirm: true },
          });
        } catch (error) {
          return { ok: false, error: error instanceof Error ? error.message : "文件夹删除失败" };
        }
      }
      return { ok: true };
    },
    /** object_info 摘要(引擎未跑时 sidecar 给 null → 空数组,与 mock 行为一致)。 */
    async listAvailableClassTypes(): Promise<string[]> {
      const raw = await comfySidecarRequest<{ classTypes?: string[] | null }>(
        "GET",
        "/comfy/engine/object-info",
      );
      return raw.classTypes ?? [];
    },
  };
}
