import type { ComfyBridgeWritebacksReply, ComfyManyingSyncReply } from "./comfy-engine-contract";
// ComfyUI 引擎 mock client——后端(流A)落地前的 UI 开发/测试数据源。
//
// 实现与真实 client 同一 ComfyEngineClient 接口(契约十一节),可整体注入
// useComfyEngineSettings;集成时把 window.comfyEngine 接到真实 preload 桥即可,
// UI 零改动。行为要点:
// - 引擎状态机走全链:未安装 → install job(下载/依赖/收尾)→ 需准备/就绪;
// - job 靠 getJob 轮询推进(每次调用推一步,测试确定性;真实端由后端事件驱动);
// - 更新链 job:快照→拉新版→依赖→重启→校验,成功出更新报告,可注入失败做回滚;
// - 卸载前 getPluginUsage 返回工作流引用;installPlugin 支持 curated/registry/git/local。

import type {
  ComfyCatalogEntry,
  ComfyDoctorReport,
  ComfyEngineClient,
  ComfyEngineJob,
  ComfyEngineJobKind,
  ComfyEngineJobStage,
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
} from "./comfy-engine-contract";

export interface MockComfyEngineOptions {
  /** 初始引擎状态;默认未安装。 */
  initialStatus?: Partial<ComfyEngineStatus>;
  /** 注入 install job 失败(装一半 → needs-setup,模拟中断)。 */
  failInstall?: boolean;
  /** 注入 update job 失败(验证一键回滚链)。 */
  failUpdate?: boolean;
  /** 更新检查时宣称的最新版。 */
  latestVersion?: string;
  /** 同 release 时 mock 的 master 领先提交数(null=禁用提交口径,只看 release)。 */
  masterAheadBy?: number | null;
  /** 卸载引用扫描返回的工作流(点名「X 个工作流在用它」)。 */
  pluginUsage?: Array<{ id: string; name: string }>;
}

/** 一次任务推进的步进(job 序列按 getJob 调用逐格前进)。 */
interface JobStep {
  stage: ComfyEngineJobStage;
  progress: number;
}

const INSTALL_STEPS: JobStep[] = [
  { stage: "download", progress: 15 },
  { stage: "download", progress: 55 },
  { stage: "dependencies", progress: 80 },
  { stage: "finalize", progress: 100 },
];

const UPDATE_STEPS: JobStep[] = [
  { stage: "snapshot", progress: 10 },
  { stage: "pull", progress: 45 },
  { stage: "dependencies", progress: 70 },
  { stage: "restart", progress: 85 },
  { stage: "verify", progress: 100 },
];

const RESET_STEPS: JobStep[] = [
  { stage: "clean", progress: 30 },
  { stage: "rebuild", progress: 75 },
  { stage: "verify", progress: 100 },
];

const PLUGIN_INSTALL_STEPS: JobStep[] = [
  { stage: "clone", progress: 40 },
  { stage: "dependencies", progress: 80 },
  { stage: "recheck", progress: 100 },
];

const DEFAULT_LATEST = "0.34.5";
const INITIAL_VERSION = "0.34.0";

function notInstalledStatus(): ComfyEngineStatus {
  return {
    installed: false,
    version: null,
    latest: null,
    state: "not-installed",
    port: null,
    modelsDir: null,
    defaultModelsDir: "~/Library/Application Support/MYStudio/userData/comfyui/models",
    serviceRunning: false,
    pluginCount: 0,
    updateAvailable: false,
    aheadBy: null,
    lastCheckAt: null,
    message: null,
    installDir: null,
    torch: null,
    launchArgs: null,
    envVars: null,
    portConflictPolicy: null,
  };
}

const MOCK_CATALOG: ComfyCatalogEntry[] = [
  {
    id: "rgthree",
    name: "RG三节点集",
    description: "常用效率工具:上下文打包、预览放大、电源开关。",
    license: "GPL-3.0",
    author: "rgthree",
    downloads: 1_234_567,
    category: "效率",
    installedState: null,
    ref: "rgthree",
    source: "curated",
  },
  {
    id: "layerstyle",
    name: "图层样式",
    description: "上百个图像处理节点:遮罩、调色、文字、边框。",
    license: "GPL-3.0",
    author: "chflame163",
    downloads: 987_654,
    category: "画质",
    installedState: null,
    ref: "layerstyle",
    source: "curated",
  },
  {
    id: "layer-node",
    name: "图层节点",
    description: "画布内图层合成与透明度管理。",
    license: "GPL-3.0",
    author: "xXAdriXx",
    downloads: 456_789,
    category: "效率",
    installedState: null,
    ref: "layer-node",
    source: "registry",
  },
  {
    id: "comfyui-krea",
    name: "Krea 官方节点",
    description: "Krea 系列模型配套节点(主力生图流依赖)。",
    license: "GPL-3.0",
    author: "krea-ai",
    downloads: 321_098,
    category: "生图",
    installedState: null,
    ref: "comfyui-krea",
    source: "registry",
  },
];

const INSTALLED_PLUGIN_NODES: Record<string, number> = {
  rgthree: 42,
  layerstyle: 128,
};

export function createMockComfyEngineClient(
  options: MockComfyEngineOptions = {},
): ComfyEngineClient {
  let status: ComfyEngineStatus = { ...notInstalledStatus(), ...options.initialStatus };
  let jobSeq = 0;
  const jobs = new Map<string, ComfyEngineJob>();
  /** 每个 job 的推进位置(getJob 每调一次前进一步)。 */
  const jobCursor = new Map<string, number>();
  /** 一次性失败注入:触发一次后自动清除,模拟「重试成功/断点续上」。 */
  let failInstallOnce = options.failInstall ?? false;
  let failUpdateOnce = options.failUpdate ?? false;
  const pluginStates = new Map<string, ComfyPluginState>();
  const pluginNodeCounts = new Map<string, number>(Object.entries(INSTALLED_PLUGIN_NODES));
  /** 存储位置覆写(0a mock):engineDir/venvDir/workflowsDir。 */
  let pathsOverride: Partial<Record<"engineDir" | "venvDir" | "workflowsDir", string>> | null = null;

  const stepsFor = (kind: ComfyEngineJobKind): JobStep[] => {
    switch (kind) {
      case "install":
        return INSTALL_STEPS;
      case "update":
        return UPDATE_STEPS;
      case "reset":
        return RESET_STEPS;
      case "plugin-install":
      case "plugin-update":
        return PLUGIN_INSTALL_STEPS;
      default:
        return PLUGIN_INSTALL_STEPS.slice(0, 2);
    }
  };

  const createJob = (kind: ComfyEngineJobKind): ComfyEngineStartJobReply => {
    jobSeq += 1;
    const jobId = `mock-job-${jobSeq}`;
    jobs.set(jobId, { jobId, kind, state: "running", progress: 0, stage: null, message: null, report: null });
    jobCursor.set(jobId, 0);
    return { jobId };
  };

  const finishInstall = (jobId: string) => {
    status = {
      ...status,
      installed: true,
      version: INITIAL_VERSION,
      state: "ready",
      port: 17599,
      modelsDir: status.modelsDir ?? status.defaultModelsDir,
      installDir: "~/Library/Application Support/MYStudio/userData/comfyui",
      // 就绪口径裁定:装完即就绪;服务未跑由副标「准备运行时」表达。
      serviceRunning: false,
    };
    const job = jobs.get(jobId);
    if (job) {
      jobs.set(jobId, {
        ...job,
        state: "succeeded",
        progress: 100,
        stage: "finalize",
        message: "安装完成",
        report: { kind: "generic", message: "ComfyUI 引擎安装完成" },
      });
    }
  };

  const client: ComfyEngineClient = {
    async listModels() {
      return {
        modelsDir: "/tmp/comfyui/models",
        groups: [
          {
            category: "diffusion_models",
            files: [
              { name: "krea2_turbo_bf16.safetensors", sizeBytes: 26283332608 },
              { name: "z_image_turbo_bf16.safetensors", sizeBytes: 1048576000 },
            ],
          },
          {
            category: "text_encoders",
            files: [{ name: "qwen3-vl-4b-heretic.safetensors", sizeBytes: 8875713408 }],
          },
        ],
        totalBytes: 26283332608 + 1048576000 + 8875713408,
      };
    },

    async getEngineStatus() {
      return { ...status };
    },

    async installEngine() {
      if (status.state === "installing") {
        throw new Error("已有安装任务在进行中");
      }
      status = { ...status, state: "installing", message: null };
      return createJob("install");
    },

    async startEngine() {
      if (!status.installed) {
        return { accepted: false, message: "引擎尚未安装" };
      }
      status = { ...status, serviceRunning: true };
      return { accepted: true };
    },

    async stopEngine() {
      status = { ...status, serviceRunning: false };
      return { accepted: true };
    },

    async checkUpdate(): Promise<ComfyEngineUpdateCheckReply> {
      const latest = options.latestVersion ?? DEFAULT_LATEST;
      const current = status.version;
      const releaseAhead = current !== null && current !== latest;
      // 09-09 提交口径:同 release 时按 master 领先数模拟可更新(mock 固定 87;null=禁用)
      const aheadBy = releaseAhead || current === null || options.masterAheadBy === null
        ? null
        : options.masterAheadBy ?? 87;
      const updateAvailable = releaseAhead || aheadBy != null;
      status = { ...status, latest, updateAvailable, aheadBy, lastCheckAt: Date.now() };
      return { current, latest, updateAvailable, checkedAt: Date.now() };
    },

    async updateEngine() {
      if (!status.installed) {
        throw new Error("引擎尚未安装,无法更新");
      }
      return createJob("update");
    },

    async rollbackUpdate() {
      status = { ...status, state: "ready", updateAvailable: false, aheadBy: null, message: null };
      return { accepted: true, message: "已回滚到更新前快照" };
    },

    async resetEngine() {
      return createJob("reset");
    },

    async getJob(jobId: string): Promise<ComfyEngineJob> {
      const job = jobs.get(jobId);
      if (!job) throw new Error(`任务不存在: ${jobId}`);
      if (job.state !== "running") return { ...job };

      const steps = stepsFor(job.kind);
      const cursor = Math.min((jobCursor.get(jobId) ?? 0) + 1, steps.length);
      jobCursor.set(jobId, cursor);
      const step = steps[cursor - 1]!;

      // 推进到末步时收尾(成功或注入的失败)。
      if (cursor >= steps.length) {
        if (job.kind === "install" && failInstallOnce) {
          failInstallOnce = false; // 一次性注入:重试即可续上
          status = {
            ...status,
            state: "needs-setup",
            message: "下载中断了,已装的部分保留;点「继续安装」会从断点续上。",
          };
          const failed: ComfyEngineJob = { ...job, state: "failed", stage: step.stage, progress: step.progress, message: "网络中断,引擎源码没下完整" };
          jobs.set(jobId, failed);
          return { ...failed };
        }
        if (job.kind === "update" && failUpdateOnce) {
          failUpdateOnce = false; // 一次性注入:回滚后重试可成功
          const failed: ComfyEngineJob = { ...job, state: "failed", stage: "verify", progress: 100, message: "新版校验没通过:节点清单应答异常" };
          jobs.set(jobId, failed);
          return { ...failed };
        }
        switch (job.kind) {
          case "install":
            finishInstall(jobId);
            break;
          case "update": {
            const previousVersion = status.version ?? INITIAL_VERSION;
            const newVersion = options.latestVersion ?? DEFAULT_LATEST;
            status = { ...status, version: newVersion, updateAvailable: false, aheadBy: null, state: "ready", message: null };
            const report = {
              kind: "update" as const,
              previousVersion,
              newVersion,
              nodeCountBefore: 2196,
              nodeCountAfter: 2210,
              incompatiblePlugins: ["图层样式"],
              compatiblePlugins: 1,
            };
            const job2 = jobs.get(jobId)!;
            jobs.set(jobId, { ...job2, state: "succeeded", progress: 100, stage: "verify", message: "更新完成", report });
            break;
          }
          case "reset": {
            status = { ...status, state: "ready", message: null };
            const job2 = jobs.get(jobId)!;
            jobs.set(jobId, { ...job2, state: "succeeded", progress: 100, stage: "verify", message: "重建完成", report: { kind: "generic", message: "运行环境已按账本重建" } });
            break;
          }
          case "plugin-install": {
            const pluginId = job.message ?? "";
            if (pluginId) {
              pluginStates.set(pluginId, "installed");
              pluginNodeCounts.set(pluginId, pluginNodeCounts.get(pluginId) ?? 7);
            }
            const job2 = jobs.get(jobId)!;
            jobs.set(jobId, {
              ...job2,
              state: "succeeded",
              progress: 100,
              stage: "recheck",
              message: "插件安装完成",
              report: { kind: "plugin-install", pluginId: pluginId || "unknown", addedNodeCount: pluginNodeCounts.get(pluginId) ?? 7 },
            });
            break;
          }
          case "plugin-update": {
            const pluginId = job.message ?? "";
            if (pluginId) pluginStates.set(pluginId, "installed");
            const job2 = jobs.get(jobId)!;
            jobs.set(jobId, { ...job2, state: "succeeded", progress: 100, stage: "recheck", message: "插件更新完成", report: { kind: "generic", message: "插件已更新" } });
            break;
          }
          default: {
            const job2 = jobs.get(jobId)!;
            jobs.set(jobId, { ...job2, state: "succeeded", progress: 100, stage: step.stage, message: "完成", report: { kind: "generic", message: "操作完成" } });
          }
        }
        return { ...jobs.get(jobId)! };
      }

      const advanced: ComfyEngineJob = { ...job, stage: step.stage, progress: step.progress };
      jobs.set(jobId, advanced);
      return { ...advanced };
    },

    async setModelsDir(path: string) {
      if (!path.trim()) return { accepted: false, message: "路径不能为空" };
      status = { ...status, modelsDir: path.trim() };
      return { accepted: true };
    },

    // ── 存储位置(mock 面,09-09 0a):路径现状从 status 推导,直改即时生效 ──
    async getPaths() {
      const overridden = pathsOverride;
      const home = "/Users/demo/Library/Application Support/漫影工作室/comfyui";
      return {
        installed: status.installed,
        running: status.serviceRunning,
        paths: {
          engineDir: overridden?.engineDir ?? `${home}/ComfyUI`,
          venvDir: overridden?.venvDir ?? `${home}/venv`,
          modelsDir: status.modelsDir ?? `${home}/models`,
          workflowsDir: overridden?.workflowsDir ?? `${home}/workflows`,
        },
        defaults: {
          engineDir: `${home}/ComfyUI`,
          venvDir: `${home}/venv`,
          modelsDir: `${home}/models`,
          workflowsDir: `${home}/workflows`,
        },
        customized: {
          engineDir: Boolean(overridden?.engineDir),
          venvDir: Boolean(overridden?.venvDir),
          modelsDir: Boolean(status.modelsDir),
          workflowsDir: Boolean(overridden?.workflowsDir),
        },
      } satisfies ComfyEnginePathsStatus;
    },
    async validatePaths(update: ComfyPathsUpdate) {
      const errors: ComfyPathsValidation["errors"] = {};
      for (const [key, value] of Object.entries(update)) {
        if (typeof value === "string" && !value.trim()) errors[key as keyof ComfyPathsValidation["errors"]] = "路径不能为空";
      }
      return { ok: Object.keys(errors).length === 0, errors, warnings: {} };
    },
    async setPaths(update: ComfyPathsUpdate) {
      if (status.installed) {
        throw new Error("引擎已安装:更改目录请用「迁移」(移动现有文件)");
      }
      pathsOverride = { ...(pathsOverride ?? {}), ...update } as typeof pathsOverride;
      return this.getPaths();
    },
    async migratePaths(update: ComfyPathsUpdate & { startAfter?: boolean }) {
      const jobId = `migrate-${Date.now()}`;
      jobs.set(jobId, {
        jobId, kind: "migrate", state: "running", progress: 5, stage: "migrate",
        message: "准备迁移 ComfyUI 目录", report: null,
      });
      const timer = setTimeout(() => {
        pathsOverride = { ...(pathsOverride ?? {}), ...update } as typeof pathsOverride;
        const job = jobs.get(jobId)!;
        jobs.set(jobId, { ...job, state: "succeeded", progress: 100, stage: "finalize", message: "迁移完成" });
      }, 300);
      void timer;
      return { jobId };
    },

    async listPlugins(): Promise<ComfyPluginInfo[]> {
      return MOCK_CATALOG.map((entry) => {
        const installed = pluginStates.get(entry.id) === "installed";
        return {
          id: entry.id,
          name: entry.name,
          description: entry.description,
          license: entry.license,
          state: (installed ? "installed" : "installable") as ComfyPluginState,
          version: installed ? "1.0.0" : null,
          deps: ["torch", "numpy"],
          author: entry.author,
          downloads: entry.downloads,
          category: entry.category,
          nodeCount: installed ? (pluginNodeCounts.get(entry.id) ?? null) : null,
        } satisfies ComfyPluginInfo;
      });
    },

    async searchCatalog(query: string) {
      const terms = query.trim().toLowerCase();
      return MOCK_CATALOG.filter((entry) => {
        if (!terms) return true;
        return `${entry.name} ${entry.description} ${entry.id}`.toLowerCase().includes(terms);
      }).map((entry) => ({ ...entry, installedState: pluginStates.get(entry.id) ?? null }));
    },

    async installPlugin(_source, ref) {
      const reply = createJob("plugin-install");
      // 把目标插件 id 藏进 job.message,推进时据此落状态。
      const job = jobs.get(reply.jobId)!;
      jobs.set(reply.jobId, { ...job, message: ref });
      return reply;
    },

    async updatePlugin(id: string) {
      const reply = createJob("plugin-update");
      const job = jobs.get(reply.jobId)!;
      jobs.set(reply.jobId, { ...job, message: id });
      return reply;
    },

    async uninstallPlugin(id: string) {
      pluginStates.delete(id);
      pluginNodeCounts.delete(id);
      return { accepted: true };
    },

    async getPluginUsage(id: string): Promise<ComfyPluginUsageReply> {
      // rgthree 有引用(点名警告路径),其余无引用。
      if (id === "rgthree") {
        return { workflows: options.pluginUsage ?? [{ id: "wf-1", name: "Krea2-NSFW专业流" }] };
      }
      return { workflows: [] };
    },

    async cleanOrphans(): Promise<{ removed: string[]; message?: string }> {
      return { removed: [] };
    },

    async listSnapshots(): Promise<ComfySnapshotEntry[]> {
      return [];
    },

    async setLaunchConfig(config: { argsString?: string; envVars?: Record<string, string>; portConflictPolicy?: "auto-shift" | "fail" }): Promise<{ accepted: boolean; message?: string }> {
      if (config.argsString != null) status = { ...status, launchArgs: config.argsString };
      if (config.envVars != null) status = { ...status, envVars: config.envVars };
      if (config.portConflictPolicy != null) status = { ...status, portConflictPolicy: config.portConflictPolicy };
      return { accepted: true };
    },
    async getBridgeWritebacks(): Promise<ComfyBridgeWritebacksReply | null> {
      return { cursor: 0, items: [] };
    },
    async ackBridgeWritebacks(): Promise<number | null> {
      return 0;
    },
    async getBridgeActions(cursor: number) {
      return { cursor, items: [] as Array<{ id: number; kind: string }> };
    },
    async ackBridgeActions() {
      return 0;
    },
    async pushBridgeStoryboards(): Promise<boolean> {
      return true;
    },
    async uploadBridgeReference(name: string): Promise<{ accepted: boolean; name?: string } | null> {
      return { accepted: true, name };
    },
    async syncManyingNodes(): Promise<ComfyManyingSyncReply | null> {
      return { copied: 0, restartRequired: false };
    },

  async doctor(): Promise<ComfyDoctorReport> {
      if (status.installed) {
        return { missing: [], drifted: ["numpy(被外部顶到 2.1.0)"], orphan: [] };
      }
      return { missing: [], drifted: [], orphan: [] };
    },
  };

  return client;
}
