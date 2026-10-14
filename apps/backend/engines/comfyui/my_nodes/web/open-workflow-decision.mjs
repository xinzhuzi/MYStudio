// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

/**
 * 漫影工作流单实例打开协议——判定与装载绑定纯函数(四审E组 L3,design §1.2 案A
 * + mustFix 复审 L3b)。
 *
 * 判定原为 open-workflow.js:84-90 的行内短路,抽出为纯函数供 node --test
 * 直跑(该文件为 ComfyUI web 扩展 JS,window.app 依赖,无 JS 测试挂架;
 * design §1.3)。RED 基线阶段本函数忠实复刻旧行为(named-active 短路),
 * GREEN 阶段随接线翻转为本版判定。resolveEntryBinding 同法(见其注)。
 *
 * 入参布尔语义(由调用方从 open-workflow.js 现场推导):
 * - hasEntry:            svc.getWorkflowByPath(libraryPath) 命中(:63-69 双探后)
 * - activeMatchesMainline: 活跃签命中主线条(mainlineTabMatcher :28-32;含
 *                          path===libraryPath 首支)
 * - activeIsModified:    活跃签经 changeTracker 自愈重评(:76-81)后的 isModified
 * - samePath:            active.path === libraryPath。案A 甄别入参:同路径=
 *                          内容锚即本库路径(维持旧短路);路径异=章翻转
 *                          (每章同名临时签,活跃签是上一章)→ 原签内容刷新。
 */

export function resolveOpenWorkflowDecision({ hasEntry, activeMatchesMainline, activeIsModified, samePath }) {
  // ① Q1a kept-modified(open-workflow.js:84-87,用户裁定保护面零动):
  //    主线条匹配 + 未保存修改 → 保留用户态,只确保激活不重载。
  //    优先级锁:即便落在 refresh-active/named-active 触发面也让位用户态。
  if (activeMatchesMainline && activeIsModified) return "kept-modified";
  // ② named-active 短路(案A 收紧):库里无条目 + 名匹配 + 路径同 → 内容锚
  //    即本库路径,维持旧短路不重开(09-12 防叠号语义保留)。
  if (!hasEntry && activeMatchesMainline && samePath) return "named-active";
  // ③ refresh-active(案A 新支,L3 章翻转死点修复):名匹配 + 库里无条目 +
  //    路径异 + 未修改 → 不再短路,由外层 loadGraphData 把本次 graph 装进
  //    当前活跃签(不开新签,防叠号语义保留),mode=named-active-refreshed。
  //    RED 基线此处曾忠实复刻旧行为返回 "named-active"(章翻转死点本体)。
  if (activeMatchesMainline && !hasEntry && !samePath && !activeIsModified) return "refresh-active";
  // ④ 其余 proceed:交回外层既有序列(closeStaleWorkflows :109 → entry 装载
  //    :110-128 → named-temp 兜底 :129-130;含 L3b 临时条目形态,见下)。
  return "proceed";
}

/**
 * entry 分支装载绑定:content(装进画布的图)+ mode(返回串)。
 * L3b(mustFix 复审 1014):章翻转主死亡形态不在决策面而在本装载面——
 * deployed 前端 store(engine venv comfyui_frontend_package settingStore-X9ZV_dAu.js
 * 实读)中 getUnconflictedPath 起始即原路径(`a=2,o=e`)、createNewWorkflow 把
 * 临时签注册进索引(`.value[e.path]=e`)、getWorkflowByPath 同图捞取
 * (`=e=>n.value[e]??null`)——故 ch1 首开走 named-temp 后,切 ch2 再开时
 * entry=ch1 临时签(hasEntry=true,决策面 proceed),而 $F.load 对临时签
 * `if(this.isTemporary||...)return this` 原地早退不读盘,content 若取
 * entry.activeState=上章旧图 → 画布恒上章且 mode 谎报 library-bound。
 * 临时条目无库文件背书,content 唯一真源=本次 graph(与 named-temp 兜底同源);
 * 库条目(isTemporary=false)维持 entry.activeState 语义零动(保鲜链 force
 * 重读语义所在)。
 * @param entryIsTemporary entry.isTemporary(临时签=伪库条目形态)
 * @param entryContent     entry.activeState(库条目已 force 重读后的内容)
 * @param graph            本次打开的宿主图(本章内容,唯一真源)
 */
export function resolveEntryBinding({ entryIsTemporary, entryContent, graph }) {
  // L3b GREEN:临时条目(伪库条目)→ content=本次 graph、mode=named-temp-refreshed
  // (装回既有签,不开新签);库条目 → content=entry.activeState||graph、
  // mode=library-bound,语义零动。RED 基线曾忠实复刻旧行为(content 恒取
  // entryContent||graph、mode 恒 library-bound)。
  if (entryIsTemporary) return { content: graph, mode: "named-temp-refreshed" };
  return { content: entryContent || graph, mode: "library-bound" };
}
