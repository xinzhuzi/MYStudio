// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

// 漫影模块内容策略(09-12 用户裁定:模块分离——本地模型模块不展示漫影
// 工作流模块的分镜产线内容)。本文件是「哪个模块看得到哪些漫影内容」的
// 唯一真源:纯函数、零 ComfyUI 依赖(app.js 不进、window 不强依赖),供
// manying.js 两处消费(漫影侧栏库过滤 / userdata 工作流树 fetch 过滤);
// 消费方禁止自带副本,scope 判断不得散落各处。
//
// 内容边界(09-14 晚二次裁定:引擎家 workflows 恒无漫影——静态自研流
// 已迁仓库真源(repo: id 只读合并),分镜产线动态流住引擎家用户区
// 「分镜/」根):分镜/**(0_工作流主线/1_总览/2_单镜图/3_单镜视频)=
// 分镜产线写入位 = 工作流模块内容;静态自研(K2图像/H3视频/音乐,
// repo: id)= 本地模型域直达。单向分离:仅 models 域隐藏分镜。
// 旧根「漫影/1_图片/分镜/」保留双前缀判据=防回流兜底(装机旧代码
// 窗口期再落旧位时,models 域与新根同剔;迁移脚本重跑即清)。
// 09-14 补充裁定:models 域侧栏再剔「参考_提示词工程」——那是提示词
// 工程资料位(manifest 假条目点不开),既非模型也非工作流;原生树不过滤。

/** 分镜产线写入位前缀(引擎家用户区相对路径;库 id 与 userdata 树条目共用判据) */
export const STORYBOARD_WORKFLOW_PREFIX = "分镜/";

/** 旧写入位前缀(09-14 改根前;双前缀判据=旧装机代码回写期防回流兜底) */
export const LEGACY_STORYBOARD_WORKFLOW_PREFIX = "漫影/1_图片/分镜/";

/** 参考资料域前缀(09-14:models 域侧栏剔除——资料位非工作流,manifest 条目不可开) */
export const REFERENCE_WORKFLOW_PREFIX = "漫影/4_参考_提示词工程/";

/** userdata v2 树中分镜文件夹本体(目录条目 path = 前缀去尾斜杠) */
export const STORYBOARD_WORKFLOW_DIR = "分镜";

/** userdata 工作流树在用户数据根下的目录名(v2 条目带此前缀,须先剥) */
const USERDATA_WORKFLOWS_DIR = "workflows";
const USERDATA_WORKFLOWS_PREFIX = `${USERDATA_WORKFLOWS_DIR}/`;

/** userdata 全路径(带 workflows/ 前缀)归一成漫影库相对路径 */
function toLibraryPath(raw) {
  if (typeof raw !== "string" || !raw) return "";
  return raw.startsWith(USERDATA_WORKFLOWS_PREFIX) ? raw.slice(USERDATA_WORKFLOWS_PREFIX.length) : raw;
}

/** 单条工作流路径是否分镜产线内容(用户区相对路径或 userdata 全路径均可;含旧根防回流) */
export function isStoryboardWorkflowPath(path) {
  const rel = toLibraryPath(path);
  return rel.startsWith(STORYBOARD_WORKFLOW_PREFIX) || rel.startsWith(LEGACY_STORYBOARD_WORKFLOW_PREFIX);
}

/** 漫影侧栏库条目按模块过滤:models 域剔除分镜条目与参考资料域;其他域原样直通(同引用,零改动) */
export function filterWorkflowsForScope(items, scope) {
  if (scope !== "models" || !Array.isArray(items)) return items;
  return items.filter((item) => {
    const path = String(item?.id ?? item?.path ?? item ?? "");
    return !isStoryboardWorkflowPath(path) && !toLibraryPath(path).startsWith(REFERENCE_WORKFLOW_PREFIX);
  });
}

/** 旧漫影库根前缀(09-14 改根前;现仅作原生树/侧栏防回流过滤判据) */
export const MY_WORKFLOW_PREFIX = "漫影/";

/** 引擎家用户区动态流根前缀(分镜产线 0_主线/1_总览/2_单镜图/3_单镜视频) */
export const APP_USER_WORKFLOW_PREFIX = "分镜/";

/** ComfyUI 原生工作流浏览器树过滤(09-15 用户终裁:只不展示「漫影」这个
 *  字样本身——漫影根文件夹名折叠,其子内容(1_图片/2_视频/分镜…)原样
 *  展示;其他一切条目照常。此前整根剔除=过度执行,「浏览」区被清空属翻车)。
 *  v1 纯字符串 / v2 对象条目(path 带 workflows/ 前缀)均改写为剥去漫影层。 */
export function filterUserDataWorkflowEntriesFlattenMy(entries) {
  if (!Array.isArray(entries)) return entries;
  const strip = (raw) => {
    const hadPrefix = raw.startsWith(USERDATA_WORKFLOWS_PREFIX);
    const rel = toLibraryPath(raw);
    const from = rel.startsWith(MY_WORKFLOW_PREFIX) ? MY_WORKFLOW_PREFIX
      : rel.startsWith(APP_USER_WORKFLOW_PREFIX) ? APP_USER_WORKFLOW_PREFIX : null;
    if (from === null) return null;
    const flattened = rel.slice(from.length);
    return hadPrefix ? USERDATA_WORKFLOWS_PREFIX + flattened : flattened;
  };
  const out = [];
  for (const entry of entries) {
    if (typeof entry === "string") {
      const s = strip(entry);
      out.push(s !== null ? s : entry);
      continue;
    }
    if (entry && typeof entry === "object" && typeof entry.path === "string") {
      if (entry.path === "漫影" || entry.path === USERDATA_WORKFLOWS_PREFIX + "漫影"
        || entry.path === "分镜" || entry.path === USERDATA_WORKFLOWS_PREFIX + "分镜") continue; // 根目录名不展示
      const s = strip(entry.path);
      out.push(s !== null ? { ...entry, path: s } : entry);
      continue;
    }
    out.push(entry);
  }
  return out;
}

/** userdata 工作流树条目过滤(v1 文件条目 / v2 含目录条目 / 纯字符串形态均可;
 * 判据单源=isStoryboardWorkflowPath(新根+旧根双前缀),另剔两代文件夹本体目录条目) */
export function filterUserDataWorkflowEntries(entries) {
  if (!Array.isArray(entries)) return entries;
  return entries.filter((entry) => {
    const rel = toLibraryPath(typeof entry === "string" ? entry : String(entry?.path ?? ""));
    return rel !== STORYBOARD_WORKFLOW_DIR
      && rel !== `${LEGACY_STORYBOARD_WORKFLOW_PREFIX.slice(0, -1)}`
      && !isStoryboardWorkflowPath(rel);
  });
}

/** fetch 过滤端点判定:仅工作流树的「列表」GET——v1 `[/api]/userdata?dir=workflows…`
 *  与 v2 `[/api]/v2/userdata?path=…`(根/workflows/子树)。ComfyUI 服务器路由同时
 *  挂根路径与 /api 前缀,前端实发带 /api(09-13 实弹网络日志核验),两种都收。
 *  单文件读取(`[/api]/userdata/workflows/xxx.json`,顶签恢复 loadPersistedWorkflow
 *  用)与写操作不命中,直通。相对与带 origin 的绝对 URL 均可。 */
export function isUserDataWorkflowListUrl(url) {
  if (typeof url !== "string" || !url) return false;
  const clean = url.replace(/^https?:\/\/[^/]+/i, "");
  const queryIndex = clean.indexOf("?");
  let path = queryIndex >= 0 ? clean.slice(0, queryIndex) : clean;
  const query = queryIndex >= 0 ? clean.slice(queryIndex + 1) : "";
  path = path.replace(/^\/api(?=\/|$)/, "");
  let params;
  try {
    params = new URLSearchParams(query);
  } catch {
    return false;
  }
  if (path === "/userdata") return params.get("dir") === USERDATA_WORKFLOWS_DIR;
  if (path === "/v2/userdata") {
    const listed = params.get("path") || "";
    return listed === "" || listed === USERDATA_WORKFLOWS_DIR || listed.startsWith(USERDATA_WORKFLOWS_PREFIX);
  }
  return false;
}
