// ComfyUI 引擎契约类型层:来源 apps/frontend/components/panels/settings/comfy-engine/comfy-engine-contract.ts(第 15-441 行)。
// 归位日期:1123。
// 纯叶子:零 import。

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
  /** 启动参数命令行串(Desktop 式唯一真源;旧三档对象由后端读侧迁移成串)。 */
  launchArgs: string | null;
  /** 环境变量表(spawn 注入;本机明文存储,UI 侧遮蔽展示)。 */
  envVars: Record<string, string> | null;
  /** 端口冲突策略:串写死的端口被占时顺延(fail)或报错;非命令行参数。 */
  portConflictPolicy: "auto-shift" | "fail" | null;
  /** 允许局域网访问(1029 二次收口):--listen 0.0.0.0 的显式授权开关;缺省关。 */
  allowLanListen: boolean | null;
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
  /** GitHub 星标(09-10 裁定:替代下载量;后台缓存补,null 前端整行不显示)。 */
  stars?: number | null;
  /** 最新版本(GitHub release tag/短 sha),纯展示不参与判定;可更新判据=盘上
   * HEAD 与远端默认分支 HEAD 漂移(10-19 帧插值案根修:release tag 常非语义
   * 或停更,旧「≠当前版本」比对造成已更新仍恒「可更新」假灯)。 */
  latestVersion?: string | null;
  /** 台账安装来源(pip=venv 直装,不可经目录再装;其余为目录四源)。 */
  source?: "curated" | "registry" | "git" | "local" | "pip";
  /** 仓库地址(目录孪生去重按仓库比对;台账无记录时 null)。 */
  repo?: string | null;
  /** 目录里没有 .git(Registry zip/裸目录/自研同步形态;10-19 M4 §八 Q4:
   *  后端盘探产出,前端据此置灰更新钮——点了只会撞后端 400「没有 git 历史
   *  可拉取」)。null/undefined=有 git 或旧 sidecar 未传,不置灰。 */
  gitless?: boolean | null;
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
  /** 仓库地址(策展/Registry 条目携带;与已装行仓库同源=同一插件的目录孪生)。 */
  repo?: string | null;
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

/** 存储位置现状(engine/venv/workflows 可改;input/output 走 setIODirs,可迁出源码目录)。 */
export interface ComfyEnginePathsStatus {
  installed: boolean;
  running: boolean;
  paths: {
    engineDir: string;
    venvDir: string;
    modelsDir: string;
    workflowsDir: string;
    /** 引擎输入目录(参考图上传处);manifest 键可迁出源码目录。 */
    inputDir: string;
    /** 引擎输出目录(生成结果落盘处);manifest 键可迁出源码目录。 */
    outputDir: string;
  };
  defaults: {
    engineDir: string;
    venvDir: string;
    modelsDir: string;
    workflowsDir: string;
    inputDir: string;
    outputDir: string;
  };
  customized: {
    engineDir: boolean;
    venvDir: boolean;
    modelsDir: boolean;
    workflowsDir: boolean;
    inputDir: boolean;
    outputDir: boolean;
  };
}

/** 路径校验结果(errors 按目录键;warnings 如磁盘余量提示)。 */
export interface ComfyPathsValidation {
  ok: boolean;
  errors: Partial<Record<
    "engineDir" | "venvDir" | "workflowsDir" | "modelsDir" | "inputDir" | "outputDir",
    string
  >>;
  warnings: { disk?: string };
}

/** 可改目录(未传的键不动;modelsDir 走 setModelsDir 既有面,不在此列;
 * inputDir/outputDir 走 setIODirs,仅校验面共用此类型)。 */
export type ComfyPathsUpdate = Partial<{
  engineDir: string;
  venvDir: string;
  workflowsDir: string;
  inputDir: string;
  outputDir: string;
}>;

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
  /** 输入/输出目录更改(09-11):引擎须停;已装=搬移现有内容+落账,重启引擎后生效。 */
  setIODirs(update: { inputDir?: string; outputDir?: string }): Promise<ComfyEnginePathsStatus>;
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
  /** 修改启动配置(命令行串/环境变量表/端口冲突策略/局域网开关;语法错由后端拒存,重启引擎生效)。 */
  setLaunchConfig(config: {
    argsString?: string;
    envVars?: Record<string, string>;
    portConflictPolicy?: "auto-shift" | "fail";
    allowLanListen?: boolean;
  }): Promise<ComfyEngineAckReply>;
  /** bridge 回写收件箱(09-09 swap 阶段1):my_generated 落 sidecar 的成图项。 */
  getBridgeWritebacks(cursor: number): Promise<ComfyBridgeWritebacksReply | null>;
  /** 仅确认已落账的精确 ids；缺 ids 或旧 sidecar 不执行累积删除。 */
  ackBridgeWritebacks(upTo: number, ids?: number[]): Promise<number | null>;
  /** 自研节点包手动同步(装/更新链自动;引擎运行中返回 restartRequired)。 */
  syncMyNodes(): Promise<ComfyMySyncReply | null>;
  /** 模型库清单(GET /comfy/engine/models;侧车缺席返回 null)。 */
  listModels(): Promise<ComfyModelsReply | null>;

  /** 参考图上传闭环(阶段2 批2):同名覆写进引擎 input 目录(迁移占位名可跑)。 */
  uploadBridgeReference(name: string, imageB64: string): Promise<{ accepted: boolean; name?: string } | null>;
  /** 业务侧栏数据面(阶段2 批3):推分镜快照供引擎前端 sidebar 扩展拉取。
   *  09-11 续:每镜带视频/画面就绪标记,另推当前章节 id(侧栏按章过滤)。
   *  09-12 B2 续:queue=渲染队列实时快照(宿主从 window.remotionQueue 投影,
   *  画布 stage-node 轮询同端点活更队列徽章,不经保鲜链重写库文件)。 */
  pushBridgeStoryboards(
    shots: Array<{ id: string; label: string; episodeId?: string; videoReady?: boolean; imageReady?: boolean; humanApproved?: boolean }>,
    currentEpisodeId?: string,
    queue?: Array<{ index: number; status: string; progress: number }>,
    originProjectId?: string,
  ): Promise<boolean>;
  /** 制作动作通道(09-11):宿主轮询引擎侧栏提交的批量动作,执行后 ack。
   *  09-12 B1 续:note=付费生成的补充要求(老画布 userInstruction 语义)。 */
  getBridgeActions(cursor: number): Promise<ComfyBridgeActionsReply | null>;
  ackBridgeActions(upTo: number, queueId?: string, ids?: number[]): Promise<number | null>;
}

/** Optional wire fields let consumers reject legacy replies without guessing ownership. */
export interface ComfyBridgeActionsReply {
  cursor: number;
  queueId?: string;
  items: Array<{ id: number; kind: string; note?: string; originProjectId?: string; originEpisodeId?: string }>;
}

/** bridge 回写收件项(引擎 my_generated → sidecar;渲染层消费)。 */
export interface ComfyBridgeWritebackItem {
  id: number;
  kind?: "image" | "video";
  client?: string;
  shotTarget?: string;
  prompt?: string;
  meta?: Record<string, unknown>;
  ts?: number;
  /** 轮询 include_image=1 时携带(PNG base64);瘦轮询省略。 */
  imageB64?: string;
  /** 视频回写轮询时携带(MP4 base64);瘦轮询省略。 */
  videoB64?: string;
}

export interface ComfyBridgeWritebacksReply {
  cursor: number;
  items: ComfyBridgeWritebackItem[];
}

export interface ComfyMySyncReply {
  copied: number;
  source?: string;
  target?: string;
  /** 引擎运行中同步=文件已拷但需重启才加载新节点。 */
  restartRequired?: boolean;
}

/** 模型库清单(09-10 用户裁定:模型页展示 comfyui/models 真实内容)。 */
export interface ComfyModelsEntry {
  /** 类别内相对路径(含子目录,如 Krea2-NSFW/Krea 2 pussy.safetensors)。 */
  name: string;
  sizeBytes: number;
}

export interface ComfyModelsGroup {
  /** 一级子目录名(diffusion_models/text_encoders/vae/loras/…)。 */
  category: string;
  files: ComfyModelsEntry[];
}

export interface ComfyModelsReply {
  modelsDir: string;
  groups: ComfyModelsGroup[];
  totalBytes: number;
}

/** 快照条目(引擎卡快照区展示)。 */
export interface ComfySnapshotEntry {
  id: string;
  createdAt: number;
  reason: string;
  version: string | null;
  full: boolean;
}
