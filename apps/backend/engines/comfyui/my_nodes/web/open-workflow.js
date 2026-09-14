// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

/**
 * 漫影工作流单实例打开协议 v3(open-workflow 模块,09-13 模块拆分)。
 * window.__myOpenWorkflow 锚=ComfyCanvasStudio 探测助手契约。
 */

const MY_STORE_BASE = "workflows/";

function cloneGraph(graph) {
  return JSON.parse(JSON.stringify(graph));
}

/** 静默关掉匹配的旧签(跳过活跃签,避免关掉活跃工作流后 activeWorkflow 悬挂)。
 * 09-12 实弹修正:历史带号残留「…chapter-001 (N).json」也一并匹配(防复用
 * 分支失效期堆积的草稿跨重载恢复后长存)。 */
async function closeStaleWorkflows(svc, match) {
  for (const wf of [...(svc.openWorkflows || [])]) {
    if (!match(wf)) continue;
    if (typeof svc.isActive === "function" && svc.isActive(wf)) continue;
    try { await svc.closeWorkflow(wf); } catch (error) { /* 已关/失败:下一轮兜底 */ }
  }
}

/** 主线签匹配器:精确库路径 + 带号复本(base (N).json)。 */
function mainlineTabMatcher(libraryPath) {
  const base = libraryPath.replace(/\.json$/, "");
  const re = new RegExp("^" + base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "( \\(\\d+\\))?\\.json$");
  return (wf) => wf.path === libraryPath || (wf.isTemporary && re.test(wf.path));
}

/**
 * 打开漫影工作流(单实例,v3=实例分支)。
 * 09-12 实弹定谳:字符串名分支的 id 配对(activeState.id vs 画布 serialize id)
 * 在「库条目会被重派 id、画布 id 不随 configure 走」的现实下结构性不可满足
 * →每次落 createNewTemporary 叠 "(N)"。改走**实例分支**:loadGraphData 第 4 参
 * 传工作流实例(store 条目),activateLoadedWorkflow 直接 openWorkflow+reset,
 * 零临时签零 id 匹配;单实例由 store openWorkflow 的路径注册天然保证。
 * @param name 库内相对路径(含子目录与 .json)——兜底路径的命名与清扫锚点。
 * @param graph 库里还没有该文件时的兜底图内容(宿主生成器产物)。
 */
async function openWorkflowSingleInstance({ name, graph }) {
  const app2 = window.app;
  const libraryPath = MY_STORE_BASE + name;
  const svc = app2?.extensionManager?.workflow;
  if (!app2 || typeof app2.loadGraphData !== "function") return { ok: false, mode: "no-app" };
  // 旧前端无扩展面:带名临时兜底(零 Unsaved Workflow 底线仍成立)
  if (!svc || typeof svc.loadWorkflows !== "function" || typeof svc.getWorkflowByPath !== "function"
    || typeof svc.openWorkflow !== "function") {
    await app2.loadGraphData(cloneGraph(graph), true, true, name);
    return { ok: true, mode: "named-temp" };
  }
  // Q3a 顺带清场:自动打开的历史 Unsaved 产物(可从应用数据再生)静默关
  await cleanupLegacyUnsavedTabs();
  // 索引每页一次(重复 loadWorkflows 会重载条目重派 id,实例引用也会换——
  // 拿稳条目实例是实例分支的前提)
  if (!window.__myWfIndexed) {
    try { await svc.loadWorkflows(); } catch (error) { /* 索引失败→走兜底 */ }
    window.__myWfIndexed = true;
  }
  let entry = null;
  try { entry = svc.getWorkflowByPath(libraryPath) || null; } catch (error) { entry = null; }
  if (!entry) {
    // 保鲜链新写入的文件可能未入索引:重索引一次再找(仅条目缺失时)
    try { await svc.loadWorkflows(); } catch (error) { /* 二次失败→走兜底 */ }
    try { entry = svc.getWorkflowByPath(libraryPath) || null; } catch (error) { entry = null; }
  }
  const matcher = mainlineTabMatcher(libraryPath);
  const active = svc.activeWorkflow;
  // 陈旧修改标志自愈(09-12 同页切内容实测):上游装载序列在 loadGraphData 后
  // reset() 不重评 isModified,程序化装载恒带假 true → Q1a「保用户修改」会把
  // 主线刷新(切章/保鲜链重写后再点)全部误吞。图态确等时重评翻回 false;
  // 真用户修改(态不等)重评后仍 true,保用户态语义不受影响。自愈失败按原样走。
  try {
    const tracker = active && active.changeTracker;
    if (active && active.isModified && tracker && typeof tracker.updateModified === "function") {
      tracker.updateModified();
    }
  } catch (error) { /* 宁保勿丢 */ }
  // Q1a 刷新策略(用户裁定):我们的主线签已开且有未保存修改→保留用户状态,
  // 只确保激活,不重载(主线条目与同名临时签都算"我们的主线")
  if (active && (active.path === libraryPath || matcher(active)) && active.isModified) {
    try { await svc.openWorkflow(active); } catch (error) { /* 已活跃:幂等 */ }
    return { ok: true, mode: "kept-modified" };
  }
  // 库里没有该文件但同名临时签已活跃 → 内容已是我们的,不重开
  // (字符串分支对活跃同名签仍可能叠号,直接短路)
  if (!entry && active && matcher(active)) return { ok: true, mode: "named-active" };
  // 清带号残留与同名旧临时签(非活跃;活跃的由上面短路或下一轮收敛)
  await closeStaleWorkflows(svc, matcher);
  if (entry) {
    try {
      // 已载且未修改:load() 缓存命中不读盘(上游语义 Directly returns if already
      // loaded)——保鲜链同页重写库文件后(切章/后台生成落地),不 force 重读
      // activeState 永远停在旧内容,主线卡刷新拿不到新章。有未保存修改(草稿)
      // 不 force,保留用户态(Q1a 同理)。
      await entry.load(entry.isLoaded && !entry.isModified ? { force: true } : undefined);
    } catch (error) {
      entry = null; // 文件读失败(刚被删等)→按兜底图走
    }
    if (entry) {
      const content = entry.activeState || graph;
      await svc.openWorkflow(entry); // 未开→注册+激活;已开→激活;活跃→早退(路径注册=单实例)
      await app2.loadGraphData(cloneGraph(content), true, true, entry); // 实例分支:零临时签
      try { entry.changeTracker?.updateModified(); } catch (error) { /* 装载后重评:消程序化装载的假「未保存」点 */ }
      await cleanupLegacyUnsavedTabs(); // 主线接管活跃位后,再清一轮旧 Unsaved
      return { ok: true, mode: "library-bound" };
    }
  }
  await app2.loadGraphData(cloneGraph(graph), true, true, name);
  return { ok: true, mode: "named-temp" };
}
window.__myOpenWorkflow = openWorkflowSingleInstance;
// 旧锚别名:装机旧 asar/旧探针脚本仍探测 __manyingOpenWorkflow(改名过渡期双导出)
window.__manyingOpenWorkflow = window.__myOpenWorkflow;

/**
 * 旧 "Unsaved Workflow(N)" 签清场(Q3a 用户裁定):只关「图内含漫影环节节点」
 * 的(自动打开历史产物,可从应用数据再生);用户手搭(无漫影节点)一律不动。
 * 幂等:每次协议打开都会再扫一遍;活跃签跳过(由打开流程接管后再清)。
 */
async function cleanupLegacyUnsavedTabs() {
  const svc = window.app?.extensionManager?.workflow;
  if (!svc || !Array.isArray(svc.openWorkflows)) return;
  for (const wf of [...svc.openWorkflows]) {
    const file = String(wf.path || "").split("/").pop() || "";
    // 09-12 标题改「分镜工作流」:旧命名形态(· 章 / (N 章))的标签一并清——
    // 库文件已由保鲜链删除,残留标签=孤儿临时签;09-14 `_my` 后缀裁定:
    // 无后缀与 _my 两种旧现名同样按旧名清,`MY-` 新名不命中(^锚定)
    const legacy =
      /^Unsaved Workflow( \(\d+\))?\.json$/.test(file) ||
      /^分镜工作流(_my)?( · .+| \(\d+ 章\))?\.json$/.test(file);
    if (!legacy) continue;
    const nodes = wf.activeState?.nodes;
    // 关闭判据两形态:①装过我们的图(含 MyStage)→孤儿主线签;
    // ②纯空白(零节点,引擎冷启自带的初始签)→关之无损,用户真在空白签
    // 上搭过的图(有节点但无 MyStage)不动。
    const isOurStage = (n) => n && (n.type === "MyStage" || n.type === "ManyingStage");
    if (!Array.isArray(nodes) || !(nodes.length === 0 || nodes.some(isOurStage))) continue;
    if (typeof svc.isActive === "function" && svc.isActive(wf)) continue;
    try { await svc.closeWorkflow(wf); } catch (error) { /* 下一轮兜底 */ }
  }
}

export { MY_STORE_BASE, cloneGraph, closeStaleWorkflows, mainlineTabMatcher, openWorkflowSingleInstance, cleanupLegacyUnsavedTabs };
