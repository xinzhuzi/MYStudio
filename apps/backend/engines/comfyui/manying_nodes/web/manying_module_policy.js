// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

// 漫影模块内容策略(09-12 用户裁定:模块分离——本地模型模块不展示漫影
// 工作流模块的分镜产线内容)。本文件是「哪个模块看得到哪些漫影内容」的
// 唯一真源:纯函数、零 ComfyUI 依赖(app.js 不进、window 不强依赖),供
// manying.js 两处消费(漫影侧栏库过滤 / userdata 工作流树 fetch 过滤);
// 消费方禁止自带副本,scope 判断不得散落各处。
//
// 内容边界(09-10 库域分类终态树):漫影/1_图片/分镜/**(0_工作流主线/
// 1_总览/2_单镜图)= 分镜产线写入位 = 工作流模块内容;其余(K2图像/
// H3视频/音乐/参考)= 本地模型域内容。单向分离:仅 models 域隐藏分镜,
// workflow 域维持现状(K2 工作流在图片工作流阶段仍有消费)。

/** 分镜产线写入位前缀(漫影库相对路径;库 id 与 userdata 树条目共用判据) */
export const STORYBOARD_WORKFLOW_PREFIX = "漫影/1_图片/分镜/";

/** userdata v2 树中分镜文件夹本体(目录条目 path = 前缀去尾斜杠) */
export const STORYBOARD_WORKFLOW_DIR = "漫影/1_图片/分镜";

/** userdata 工作流树在用户数据根下的目录名(v2 条目带此前缀,须先剥) */
const USERDATA_WORKFLOWS_DIR = "workflows";
const USERDATA_WORKFLOWS_PREFIX = `${USERDATA_WORKFLOWS_DIR}/`;

/** userdata 全路径(带 workflows/ 前缀)归一成漫影库相对路径 */
function toLibraryPath(raw) {
  if (typeof raw !== "string" || !raw) return "";
  return raw.startsWith(USERDATA_WORKFLOWS_PREFIX) ? raw.slice(USERDATA_WORKFLOWS_PREFIX.length) : raw;
}

/** 单条工作流路径是否分镜产线内容(漫影库相对路径或 userdata 全路径均可) */
export function isStoryboardWorkflowPath(path) {
  return toLibraryPath(path).startsWith(STORYBOARD_WORKFLOW_PREFIX);
}

/** 漫影侧栏库条目按模块过滤:models 域剔除分镜条目;其他域原样直通(同引用,零改动) */
export function filterWorkflowsForScope(items, scope) {
  if (scope !== "models" || !Array.isArray(items)) return items;
  return items.filter((item) => !isStoryboardWorkflowPath(String(item?.id ?? item?.path ?? item ?? "")));
}

/** userdata 工作流树条目过滤(v1 文件条目 / v2 含目录条目 / 纯字符串形态均可) */
export function filterUserDataWorkflowEntries(entries) {
  if (!Array.isArray(entries)) return entries;
  return entries.filter((entry) => {
    const rel = toLibraryPath(typeof entry === "string" ? entry : String(entry?.path ?? ""));
    return rel !== STORYBOARD_WORKFLOW_DIR && !rel.startsWith(STORYBOARD_WORKFLOW_PREFIX);
  });
}

/** fetch 过滤端点判定:仅工作流树的「列表」GET——v1 `/userdata?dir=workflows…`
 *  与 v2 `/v2/userdata?path=…`(根/workflows/子树)。单文件读取
 *  (`/userdata/workflows/xxx.json`,顶签恢复 loadPersistedWorkflow 用)与
 *  写操作不命中,直通。相对与带 origin 的绝对 URL 均可。 */
export function isUserDataWorkflowListUrl(url) {
  if (typeof url !== "string" || !url) return false;
  const clean = url.replace(/^https?:\/\/[^/]+/i, "");
  const queryIndex = clean.indexOf("?");
  const path = queryIndex >= 0 ? clean.slice(0, queryIndex) : clean;
  const query = queryIndex >= 0 ? clean.slice(queryIndex + 1) : "";
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
