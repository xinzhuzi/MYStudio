// ComfyUI 引擎托管一期——渲染层契约(类型 + 纯函数)。
//
// 数据通道照父任务 design.md 十一节 sidecar API 面(GET /comfy/engine/status、
// POST /comfy/engine/install|update|reset 等);传输层优先 preload 暴露
// `window.comfyEngine`(照 depthRuntime/imageGenRuntime 先例),preload 未注入
// 时 Electron 渲染层回落 HTTP 直连 sidecar(comfy-sidecar-bridge,09-08 集成);
// jsdom/网页模式仍返回 undefined,用 mock-comfy-engine-client.ts 注入同一接口
// 开发/测试 UI。

import {
  createHttpComfyEngineClient,
  isElectronRenderer,
} from "@/lib/assist/image-studio/comfy-sidecar-bridge";

// ---------------------------------------------------------------------------
// 引擎状态机(裁定 4:未安装 → 下载中 x% → 需准备 → 已就绪/可更新)
// ---------------------------------------------------------------------------

/** 引擎生命周期状态(/comfy/engine/status 的 state 字段)。 */
export type ComfyEngineLifecycleState =
  | "not-installed" // 未安装:磁盘上没有引擎
  | "installing" // 下载中:install job 进行中(进度走 job)
  | "needs-setup" // 需准备:装了一半(安装中断/依赖未齐),可继续安装
  | "ready" // 已就绪:装完即就绪(服务未跑不算不就绪,见就绪口径裁定)
  | "error"; // 出错:安装/启动失败,大白话错误在 message

/** 引擎行胶囊分级(既有裁定:出错 > 可更新 > 需准备;其余按状态机)。 */
export type ComfyEnginePillKind =
  | "unsupported" // 非桌面环境(无桥)
  | "checking" // 探测中(还没拿到状态)
  | "not-installed" // 未安装
  | "downloading" // 下载中 x%
  | "needs-setup" // 需准备
  | "ready" // 已就绪(装完即就绪;服务未跑显示「准备运行时」副标)
  | "update" // 可更新(发现新版)
  | "updating" // 更新中(更新链进行)
  | "error"; // 出错

export const COMFY_ENGINE_PILL_LABELS: Record<ComfyEnginePillKind, string> = {
  unsupported: "不支持",
  checking: "检查中",
  "not-installed": "未安装",
  downloading: "下载中",
  "needs-setup": "需准备",
  ready: "已就绪",
  update: "可更新",
  updating: "更新中",
  error: "出错",
};

/** /comfy/engine/status 的渲染层形状(契约字段 + UI 必需的少量扩展)。 */
export interface ComfyEngineStatus {
  installed: boolean;
  /** 当前版本号;未安装为 null。 */
  version: string | null;
  /** 已知最新 release(检查过更新才有值)。 */
  latest: string | null;
  state: ComfyEngineLifecycleState;
  /** 实际端口(17xxx 防撞顺延后的结果,只读展示)。 */
  port: number | null;
  /** 当前模型目录(默认 userData/comfyui/models 或用户自定义)。 */
  modelsDir: string | null;
  /** 默认模型目录(恢复默认用)。 */
  defaultModelsDir: string | null;
  /** 服务是否正在跑(就绪口径:不影响胶囊,只影响副标「准备运行时」)。 */
  serviceRunning: boolean;
  pluginCount: number;
  updateAvailable: boolean;
  /** master 领先本地的提交数(09-09 提交口径;GitHub API 拿不到时 null)。 */
  aheadBy: number | null;
  /** 最近一次 GitHub 检查的时间(ms;查过才有值,含 sidecar 重启前的账本回放)。 */
  lastCheckAt: number | null;
  /** 大白话错误/说明(出错态必填)。 */
  message: string | null;
  /** 引擎安装目录(打开按钮用)。 */
  installDir: string | null;
  /** 引擎 venv 的 PyTorch 版本(安装时入账;高级区只读展示,照 Comfy Desktop 同款)。 */
  torch: string | null;
  /** 性能档(启动参数的大白话翻译;高级区编辑)。 */
  launchArgs: { vramPolicy: string; attentionMode: string; reserveVramGb: number | null } | null;
}

// ---------------------------------------------------------------------------
// 任务(job)模型——install/update/reset/插件装卸共用
// ---------------------------------------------------------------------------

export type ComfyEngineJobKind =
  | "install"
  | "update"
  | "reset"
  | "plugin-install"
  | "plugin-update"
  | "plugin-remove"
  | "migrate"; // 存储位置迁移(09-09 0a:引擎/工作流搬移+venv 重建)

/** 任务阶段 key → 大白话文案(禁英文术语裸奔)。 */
export type ComfyEngineJobStage =
  | "download" // install:下载引擎
  | "dependencies" // install/update/reset:处理依赖
  | "finalize" // install:收尾
  | "snapshot" // update:打更新前快照
  | "pull" // update:拉取新版
  | "restart" // update:重启服务
  | "verify" // update/reset:重校验
  | "clone" // plugin-install:克隆插件
  | "recheck" // plugin:重启差分验证
  | "clean" // reset:清空运行环境
  | "rebuild" // reset:按账本重建
  | "migrate"; // migrate:目录迁移全程(搬移/venv 重建共用)

export const COMFY_ENGINE_STAGE_LABELS: Record<ComfyEngineJobStage, string> = {
  download: "下载引擎源码",
  dependencies: "安装依赖",
  finalize: "收尾配置",
  snapshot: "打更新前快照",
  pull: "拉取新版",
  restart: "重启服务",
  verify: "重校验节点与插件",
  clone: "克隆插件代码",
  recheck: "重启并校验新增节点",
  clean: "清空运行环境",
  rebuild: "按账本重建",
  migrate: "迁移存储位置",
};

/** 更新链成功报告(design.md 四节:版本/节点数变化/插件状态,不兼容点名)。 */
export interface ComfyEngineUpdateReport {
  kind: "update";
  previousVersion: string;
  newVersion: string;
  nodeCountBefore: number;
  nodeCountAfter: number;
  /** 不兼容插件点名(逐个列出)。 */
  incompatiblePlugins: string[];
  /** 其余校验兼容的插件数。 */
  compatiblePlugins: number;
}

/** 插件安装成功报告(安装五步收尾:object_info 差分「新增 N 个节点」)。 */
export interface ComfyPluginInstallReport {
  kind: "plugin-install";
  pluginId: string;
  addedNodeCount: number;
}

export type ComfyEngineJobReport =
  | ComfyEngineUpdateReport
  | ComfyPluginInstallReport
  | { kind: "generic"; message: string };

export interface ComfyEngineJob {
  jobId: string;
  kind: ComfyEngineJobKind;
  state: "running" | "succeeded" | "failed";
  /** 0-100;null = 不确定进度(走脉冲条)。 */
  progress: number | null;
  stage: ComfyEngineJobStage | null;
  /** 大白话补充说明(失败时为错误原因)。 */
  message: string | null;
  report: ComfyEngineJobReport | null;
}

export interface ComfyEngineStartJobReply {
  jobId: string;
}

export interface ComfyEngineAckReply {
  accepted: boolean;
  message?: string;
}

export interface ComfyEngineUpdateCheckReply {
  current: string | null;
  latest: string | null;
  updateAvailable: boolean;
  /** 本次检查完成时间(ms)。 */
  checkedAt: number;
}

// ---------------------------------------------------------------------------
// 插件/目录/体检(契约 GET /comfy/plugins、/comfy/plugins/doctor、/comfy/catalog/search)
// ---------------------------------------------------------------------------

export type ComfyPluginState = "installed" | "installable" | "install-failed" | "updatable";

export interface ComfyPluginInfo {
  id: string;
  /** 中文名(策展清单标定);非策展插件回退原名。 */
  name: string;
  /** 一句话描述。 */
  description: string;
  /** license 徽章(GPL-3.0 等;策展条目以仓库 LICENSE 实查为准)。 */
  license: string;
  state: ComfyPluginState;
  version: string | null;
  /** 依赖清单(requirements.txt 摘要)。 */
  deps: string[];
  author: string | null;
  downloads: number | null;
  category: string | null;
  /** 已装时 object_info 里的节点数(胶囊「已装 N 节点」)。 */
  nodeCount: number | null;
}

export interface ComfyCatalogEntry {
  id: string;
  name: string;
  description: string;
  license: string;
  author: string | null;
  downloads: number | null;
  category: string | null;
  /** 已装插件回对应目录;未装为 null。 */
  installedState: ComfyPluginState | null;
  /** 安装引用(curated id / registry id / git URL / 本地路径)。 */
  ref: string;
  source: "curated" | "registry" | "git" | "local";
}

/** 卸载前的引用扫描结果(「X 个工作流在用它」点名用)。 */
export interface ComfyPluginUsageReply {
  workflows: Array<{ id: string; name: string }>;
}

export interface ComfyDoctorReport {
  /** 缺失:装失败过/账本里有但环境里没有。 */
  missing: string[];
  /** 漂移:版本被顶过,与账本记录不一致。 */
  drifted: string[];
  /** 孤儿:无插件引用的残留依赖。 */
  orphan: string[];
}

// ---------------------------------------------------------------------------
// typed client(集成者在 preload 暴露 window.comfyEngine 实现此接口)
// ---------------------------------------------------------------------------

/** 存储位置四目录现状(09-09 comfyui-frontend-swap 0a)。 */
export interface ComfyEnginePathsStatus {
  installed: boolean;
  running: boolean;
  paths: { engineDir: string; venvDir: string; modelsDir: string; workflowsDir: string };
  defaults: { engineDir: string; venvDir: string; modelsDir: string; workflowsDir: string };
  customized: { engineDir: boolean; venvDir: boolean; modelsDir: boolean; workflowsDir: boolean };
}

/** 路径校验结果(errors 按目录键;warnings 如磁盘余量提示)。 */
export interface ComfyPathsValidation {
  ok: boolean;
  errors: Partial<Record<"engineDir" | "venvDir" | "workflowsDir" | "modelsDir", string>>;
  warnings: { disk?: string };
}

/** 可改目录(未传的键不动;modelsDir 走 setModelsDir 既有面,不在此列)。 */
export type ComfyPathsUpdate = Partial<{ engineDir: string; venvDir: string; workflowsDir: string }>;

export interface ComfyEngineClient {
  getEngineStatus(): Promise<ComfyEngineStatus>;
  installEngine(): Promise<ComfyEngineStartJobReply>;
  startEngine(): Promise<ComfyEngineAckReply>;
  stopEngine(): Promise<ComfyEngineAckReply>;
  checkUpdate(): Promise<ComfyEngineUpdateCheckReply>;
  updateEngine(): Promise<ComfyEngineStartJobReply>;
  rollbackUpdate(snapshotId?: string): Promise<ComfyEngineAckReply>;
  resetEngine(): Promise<ComfyEngineStartJobReply>;
  getJob(jobId: string): Promise<ComfyEngineJob>;
  /** 模型目录自定义(指向现有模型库即免重下);契约补充面,见接线点说明。 */
  setModelsDir(path: string): Promise<ComfyEngineAckReply>;
  /** 存储位置(09-09 0a):现状/校验/未装直改/已装迁移 job。 */
  getPaths(): Promise<ComfyEnginePathsStatus>;
  validatePaths(update: ComfyPathsUpdate): Promise<ComfyPathsValidation>;
  setPaths(update: ComfyPathsUpdate): Promise<ComfyEnginePathsStatus>;
  migratePaths(update: ComfyPathsUpdate & { startAfter?: boolean }): Promise<ComfyEngineStartJobReply>;
  listPlugins(): Promise<ComfyPluginInfo[]>;
  searchCatalog(query: string): Promise<ComfyCatalogEntry[]>;
  installPlugin(
    source: "curated" | "registry" | "git" | "local",
    ref: string,
  ): Promise<ComfyEngineStartJobReply>;
  updatePlugin(id: string): Promise<ComfyEngineStartJobReply>;
  uninstallPlugin(id: string): Promise<ComfyEngineAckReply>;
  /** 卸载前引用扫描(用户工作流 class_type 精确匹配);契约补充面。 */
  getPluginUsage(id: string): Promise<ComfyPluginUsageReply>;
  doctor(): Promise<ComfyDoctorReport>;
  /** 清理孤儿(账本外的 custom_nodes 目录);返回大白话结果。 */
  cleanOrphans(): Promise<{ removed: string[]; message?: string }>;
  /** 快照列表(装插件/更新引擎前自动打;列表+一键回滚,design 映射表「快照页→搬并强化」)。 */
  listSnapshots(): Promise<ComfySnapshotEntry[]>;
  /** 修改性能档/加速方式(启动参数的大白话翻译落账,重启引擎生效)。 */
  setLaunchArgs(args: { vramPolicy?: "auto" | "gpu-only" | "reserve-vram"; reserveVramGb?: number | null; attentionMode?: "auto" | "pytorch-cross-attention" }): Promise<ComfyEngineAckReply>;
  /** bridge 回写收件箱(09-09 swap 阶段1):manying_generated 落 sidecar 的成图项。 */
  getBridgeWritebacks(cursor: number): Promise<ComfyBridgeWritebacksReply | null>;
  /** 消费确认:删除 ≤upTo 的收件项(落账成功后调用)。 */
  ackBridgeWritebacks(upTo: number): Promise<number | null>;
  /** 自研节点包手动同步(装/更新链自动;引擎运行中返回 restartRequired)。 */
  syncManyingNodes(): Promise<ComfyManyingSyncReply | null>;
}

/** bridge 回写收件项(引擎 manying_generated → sidecar;渲染层消费)。 */
export interface ComfyBridgeWritebackItem {
  id: number;
  client?: string;
  shotTarget?: string;
  prompt?: string;
  meta?: Record<string, unknown>;
  ts?: number;
  /** 轮询 include_image=1 时携带(PNG base64);瘦轮询省略。 */
  imageB64?: string;
}

export interface ComfyBridgeWritebacksReply {
  cursor: number;
  items: ComfyBridgeWritebackItem[];
}

export interface ComfyManyingSyncReply {
  copied: number;
  source?: string;
  target?: string;
  /** 引擎运行中同步=文件已拷但需重启才加载新节点。 */
  restartRequired?: boolean;
}

/** 快照条目(引擎卡快照区展示)。 */
export interface ComfySnapshotEntry {
  id: string;
  createdAt: number;
  reason: string;
  version: string | null;
  full: boolean;
}

/**
 * 渲染层桥入口:优先 preload 注入的 `window.comfyEngine`;preload 未注入时
 * Electron 渲染层回落 HTTP 直连 sidecar(09-08 集成,零 preload 改动);
 * SSR/网页/jsdom 测试环境返回 undefined(测试注入 mock)。
 */
export function getComfyEngineClient(): ComfyEngineClient | undefined {
  if (typeof window === "undefined") return undefined;
  const injected = (window as { comfyEngine?: ComfyEngineClient }).comfyEngine;
  if (injected) return injected;
  return isElectronRenderer() ? createHttpComfyEngineClient() : undefined;
}

// ---------------------------------------------------------------------------
// 展示层纯函数(状态机 → 胶囊/文案;独立可测)
// ---------------------------------------------------------------------------

export interface ComfyEnginePillInput {
  hasBridge: boolean;
  /** null = 还没探测到(检查中)。 */
  status: ComfyEngineStatus | null;
  /** 进行中的任务(引擎级 install/update/reset 改引擎行胶囊;插件任务不改)。 */
  activeJob: ComfyEngineJob | null;
}

/**
 * 引擎行胶囊推导。分级裁定:出错 > 可更新 > 需准备 > 其余按状态机;
 * 更新链/reset 进行中显示「更新中」;插件任务不污染引擎行胶囊。
 */
export function deriveComfyEnginePill(input: ComfyEnginePillInput): ComfyEnginePillKind {
  if (!input.hasBridge) return "unsupported";
  const job = input.activeJob;
  if (job && job.state === "running") {
    if (job.kind === "update" || job.kind === "reset") return "updating";
    if (job.kind === "install") return "downloading";
  }
  const status = input.status;
  if (!status) return "checking";
  if (status.state === "error") return "error";
  if (status.updateAvailable) return "update";
  switch (status.state) {
    case "installing":
      return "downloading";
    case "needs-setup":
      return "needs-setup";
    case "ready":
      return "ready";
    default:
      return "not-installed";
  }
}

/** 胶囊文案(下载中带 x%)。 */
export function formatComfyEnginePillLabel(
  pill: ComfyEnginePillKind,
  activeJob: ComfyEngineJob | null,
): string {
  const base = COMFY_ENGINE_PILL_LABELS[pill];
  if (pill === "downloading" && activeJob?.progress != null) {
    return `下载中 ${Math.max(0, Math.min(100, Math.round(activeJob.progress)))}%`;
  }
  return base;
}

/** 插件行胶囊文案:已装 N 节点 / 可安装 / 安装失败 / 可更新。 */
export function formatComfyPluginPillLabel(plugin: ComfyPluginInfo): string {
  switch (plugin.state) {
    case "installed":
      return plugin.nodeCount != null ? `已装 ${plugin.nodeCount} 节点` : "已安装";
    case "updatable":
      return "可更新";
    case "install-failed":
      return "安装失败";
    default:
      return "可安装";
  }
}

/** 体检报告四档汇总(正常/缺失/漂移/孤儿)。 */
export function summarizeDoctorReport(report: ComfyDoctorReport): {
  healthy: boolean;
  summary: string;
} {
  const parts: string[] = [];
  if (report.missing.length > 0) parts.push(`缺失 ${report.missing.length} 项`);
  if (report.drifted.length > 0) parts.push(`漂移 ${report.drifted.length} 项`);
  if (report.orphan.length > 0) parts.push(`孤儿 ${report.orphan.length} 项`);
  if (parts.length === 0) {
    return { healthy: true, summary: "依赖体检正常:无缺失、无漂移、无孤儿。" };
  }
  return { healthy: false, summary: `依赖体检发现问题:${parts.join(", ")}。` };
}

/** 目录/插件搜索过滤(空格分词,大小写不敏感,命中名字或描述)。 */
export function filterComfyCatalogEntries(
  entries: ComfyCatalogEntry[],
  query: string,
  category: string | null,
): ComfyCatalogEntry[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return entries.filter((entry) => {
    if (category && entry.category !== category) return false;
    if (terms.length === 0) return true;
    const haystack = `${entry.name} ${entry.description} ${entry.id}`.toLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
}

export const COMFYUI_GITHUB_BASE = "https://github.com/comfyanonymous/ComfyUI";

/**
 * 版本串 → 该版本在 GitHub 上的源码页(09-09 用户裁定:版本后带地址可点击跳转)。
 * 口径:纯 tag(v0.34.6)→ tree/{tag};describe(v0.34.6-87-g672ba9e)与
 * master@672ba9e 回落短 sha(提交页);无法解析返回 null(不渲染链接)。
 */
export function comfyVersionGithubUrl(version: string | null): string | null {
  if (!version) return null;
  const describe = version.match(/-g([0-9a-f]{7,40})$/i);
  if (describe) return `${COMFYUI_GITHUB_BASE}/tree/${describe[1]}`;
  const atNotation = version.match(/@([0-9a-f]{7,40})$/i);
  if (atNotation) return `${COMFYUI_GITHUB_BASE}/tree/${atNotation[1]}`;
  if (/^v\d+\.\d+\.\d+$/.test(version)) return `${COMFYUI_GITHUB_BASE}/tree/${version}`;
  return null;
}
