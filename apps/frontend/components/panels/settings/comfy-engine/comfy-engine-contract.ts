// ComfyUI 引擎托管一期——渲染层契约门面 + 展示层宿主(1123 三分归位)。
// 类型与接口的真源在 @/types/comfy-engine;运行时入口的真源在
// @/lib/comfyui/comfy/comfy-engine-client;本文件只留展示纯函数与
// 文案常量,旧导入路径经再导出保持可用。

export * from "@/types/comfy-engine";
export { getComfyEngineClient } from "@/lib/comfyui/comfy/comfy-engine-client";
import type {
  ComfyCatalogEntry,
  ComfyDoctorReport,
  ComfyEngineJob,
  ComfyEngineJobStage,
  ComfyEnginePillKind,
  ComfyEngineStatus,
  ComfyPluginInfo,
} from "@/types/comfy-engine";

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

/** 自研节点包运行目录名(引擎侧 sync_my_nodes 硬拷目标,gitless 是设计如此;
 *  含 09-14 改名前旧目录 manying-nodes)。 */
const MY_NODES_DIR_NAMES = new Set(["my-nodes", "manying-nodes"]);

/** gitless 插件更新钮置灰 tooltip(10-19 M4 §八 Q4 裁定双文案):
 *  自研同步链管理的 my-nodes「自研同步,不适用更新」;其余(Registry zip/
 *  裸目录散装件)「Registry/裸目录安装,请卸载后重装」。 */
export function gitlessUpdateTooltip(id: string): string {
  return MY_NODES_DIR_NAMES.has(id)
    ? "自研同步,不适用更新"
    : "Registry/裸目录安装,请卸载后重装";
}

/** 体检报告四档汇总(正常/缺失/漂移/孤儿)。 */
export function summarizeDoctorReport(report: ComfyDoctorReport): {
  healthy: boolean;
  summary: string;
} {
  const parts: string[] = [];
  if (report.missing.length > 0) parts.push(`${report.missing.length} 项缺了没装上`);
  if (report.drifted.length > 0) parts.push(`${report.drifted.length} 项版本不对`);
  if (report.orphan.length > 0) parts.push(`${report.orphan.length} 项多余没登记`);
  if (parts.length === 0) {
    return { healthy: true, summary: "引擎环境正常:该装的都在,版本都对,没有多余的东西。" };
  }
  return { healthy: false, summary: `检查发现问题:${parts.join("、")}。` };
}

/** 目录/插件搜索过滤(空格分词,大小写不敏感,命中名字或描述)。
 * 已装清单(ComfyPluginInfo)与目录条目共用同一口径(09-10 根修:
 * 此前已装行不过滤,搜索框对已装插件恒无效)。 */
export function filterComfyCatalogEntries<
  T extends Pick<ComfyCatalogEntry, "id" | "name" | "description" | "category">,
>(entries: T[], query: string, category: string | null): T[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return entries.filter((entry) => {
    if (category && entry.category !== category) return false;
    if (terms.length === 0) return true;
    const haystack = `${entry.name} ${entry.description} ${entry.id}`.toLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
}

// 09-09 用户裁定:对外展示/跳转用官方组织地址 Comfy-Org(comfyanonymous 已 301 归并);
// 后端 clone 源仍走 comfyanonymous(重定向等价,不影响 fetch/更新链)
export const COMFYUI_GITHUB_BASE = "https://github.com/Comfy-Org/ComfyUI";

/**
 * 版本串 → 该版本在 GitHub 上的源码页(09-09 用户裁定:版本后带地址可点击跳转)。
 * 口径:纯 tag(v0.34.6)→ tree/{tag};三横线格式(v0.34.6---87---g672ba9e,用户裁定)
 * 与旧 describe 单横线(v0.34.6-87-g…)、master@672ba9e 一律回落短 sha(提交页);
 * 无法解析返回 null(不渲染链接)。
 */
export function comfyVersionGithubUrl(version: string | null): string | null {
  if (!version) return null;
  const describe = version.match(/-{1,3}g([0-9a-f]{7,40})$/i);
  if (describe) return `${COMFYUI_GITHUB_BASE}/tree/${describe[1]}`;
  const atNotation = version.match(/@([0-9a-f]{7,40})$/i);
  if (atNotation) return `${COMFYUI_GITHUB_BASE}/tree/${atNotation[1]}`;
  if (/^v\d+\.\d+\.\d+$/.test(version)) return `${COMFYUI_GITHUB_BASE}/tree/${version}`;
  return null;
}

// ---------------------------------------------------------------------------
// 启动参数串纯函数(09-10 Desktop 化:串=唯一真源;下拉=快填器)
// ---------------------------------------------------------------------------

/** 大众端口(易撞;冷门端口铁律默认仍由托管分配兜底)。 */
const COMMON_PORTS = new Set([3000, 5000, 5173, 8000, 8080, 8188, 8888, 9000]);

export interface LaunchArgsTokenize {
  ok: boolean;
  error?: string;
  tokens: string[];
}

/** 前端镜像校验(与后端 shlex 前置规则一致的两类硬拒:引号不成对/空引号段;
 * 分词仅按 ASCII 空白——全角空格等会整词透传并在后端被拒,故在此不拆不报)。
 * 1122 追平 1111 后端修:Windows 原生反斜杠路径(--output-directory E:\IP\…)
 * 归一为正斜杠再分词,不再硬拒——旧红字把生产账本里的真实 Win 路径判成永久
 * 错(用户 1122 实弹:启动参数页行内红「暂不支持反斜杠转义」)。
 */
export function tokenizeArgsString(input: string): LaunchArgsTokenize {
  const text = (input ?? "").replace(/\\/g, "/");
  const tokens: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;
  let quotedEmpty = false;
  for (const char of text) {
    if (quote) {
      if (char === quote) {
        if (current === "") quotedEmpty = true;
        quote = null;
        continue;
      }
      current += char;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === " " || char === "\t" || char === "\r" || char === "\n") {
      if (current) tokens.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  if (quote) return { ok: false, error: "引号不成对,请补齐后保存", tokens: [] };
  if (quotedEmpty) return { ok: false, error: "存在空的引号段;请去掉成对的空引号", tokens: [] };
  if (current) tokens.push(current);
  return { ok: true, tokens };
}

export interface LaunchArgsWarning {
  level: "warn" | "danger";
  text: string;
}

/** 行内警告:大众端口/特权端口黄字;--listen 0.0.0.0 按开关分两态
 * (1029 二次收口:开关未开=保存即拒启动的红字;已开=暴露提醒红字)。 */
export function launchArgsWarnings(input: string, allowLan?: boolean): LaunchArgsWarning[] {
  const { ok, tokens } = tokenizeArgsString(input);
  if (!ok) return [];
  const lanWarning = allowLan
    ? { level: "danger" as const, text: "监听 0.0.0.0 会把引擎暴露给局域网所有设备,注意安全" }
    : { level: "danger" as const, text: "监听 0.0.0.0 需先打开下方「允许局域网访问」开关,否则引擎将拒绝启动" };
  const warnings: LaunchArgsWarning[] = [];
  tokens.forEach((token, index) => {
    const value = token.startsWith("--port=") ? token.slice("--port=".length) : null;
    if (token === "--port" || value) {
      const portText = value ?? tokens[index + 1] ?? "";
      const port = Number(portText);
      if (Number.isInteger(port) && port > 0) {
        if (port < 1024) {
          warnings.push({ level: "warn", text: `端口 ${port} 是特权端口(<1024),引擎大概率起不来` });
        } else if (COMMON_PORTS.has(port)) {
          warnings.push({ level: "warn", text: `端口 ${port} 是大众端口,容易被其他应用抢占` });
        }
      }
    }
    if (token === "--listen") {
      const listen = tokens[index + 1];
      if (listen === "0.0.0.0" || listen === "::") {
        warnings.push(lanWarning);
      }
    }
    if (token.startsWith("--listen=")) {
      const listen = token.slice("--listen=".length);
      if (listen === "0.0.0.0" || listen === "::") {
        warnings.push(lanWarning);
      }
    }
  });
  return warnings;
}
