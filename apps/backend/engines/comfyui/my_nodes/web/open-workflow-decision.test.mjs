// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

/**
 * open-workflow-decision 纯函数测试(design 钉定跑法:node --test,零依赖;
 * 本文件零业务依赖,Node 内建 runner 直跑)。
 * 跑法①:node --test apps/backend/engines/comfyui/my_nodes/web/open-workflow-decision.test.mjs
 *
 * 双 runner 适配(1014 门禁关账):VT 全量(apps/ 根,frontend/config/vite.config.ts
 * 未设 include/exclude)按 vitest 默认测试 glob(任意层级下 test 收尾的 js/mjs 文件,
 * 本文件名命中)也会拾取本文件,而 node:test 注册的用例不被 vitest 认领 →
 * 「No test suite found」套件红(implement.md:16「backend js 不入 VT」假设被
 * 默认 glob 打脸)。按 runner 取注册 API:VT 下(process.env.VITEST)用 vitest
 * 的 test,node --test 下用 node:test——下方七断言零改,两门禁同锁同一断言面。
 *
 * 七用例(四审E组 L3 批2-A + mustFix 复审 L3b,design §1.3 / implement.md 批2-A):
 * ① kept-modified 优先锁  ② 章翻转死点→refresh-active  ③ entry 存在走 proceed 锁
 * ④ 无 svc 场景不进本判定  ⑤ 防叠号语义(决策面永不携带开新签语义)
 * ⑥ mustFix·临时条目伪库条目→content=本次 graph  ⑦ 库条目装载语义锁
 */

const { test } = await import(process.env.VITEST ? "vitest" : "node:test");
import assert from "node:assert/strict";
import { resolveOpenWorkflowDecision, resolveEntryBinding } from "./open-workflow-decision.mjs";

test("① kept-modified 优先锁:主线条匹配+未保存修改,即便库里无条目(named-active 触发面)也让位用户态", () => {
  const decision = resolveOpenWorkflowDecision({
    hasEntry: false, // 库里无条目:named-active(:90)的触发面
    activeMatchesMainline: true,
    activeIsModified: true, // changeTracker 自愈(:76-81)后仍 true = 真用户修改
    samePath: false,
  });
  // 锚 open-workflow.js:84-87——kept-modified 判定先于 :90 短路,Q1a 保护面零动
  assert.strictEqual(decision, "kept-modified");
});

test("② 章翻转死点(RED 主件→GREEN 案A 锁):同主线条名/path 异/库里无条目/未修改 → refresh-active(RED 基线 named-active 短路曾红)", () => {
  // 场景(design §1.1):ch1 画布开着(名匹配主线条,含带号临时复本)→ 切 ch2
  // 再点开 → entry=null(每章临时文件未入索引/字符串分支)→ 现行 :90 名匹配
  // 即断言「内容已是我们的」直接短路 → ch2 内容永不装载,画布恒 ch1。
  const decision = resolveOpenWorkflowDecision({
    hasEntry: false,
    activeMatchesMainline: true, // 名匹配成立(每章同名,带号复本也命中 matcher)
    activeIsModified: false, // 未修改:kept-modified 门(:84)不拦
    samePath: false, // active.path ≠ libraryPath(path 异;现行不参与判定)
  });
  // GREEN 阶段(design §1.2 案A)本场景应判 "refresh-active"(原签内容刷新);
  // 忠实复刻现行行为给 "named-active" → 本断言按「章翻转仍短路」此指定原因红。
  assert.strictEqual(decision, "refresh-active");
});

test("③ entry 存在走 proceed 锁:主线条即便名匹配也交回外层 entry 装载路径", () => {
  const decision = resolveOpenWorkflowDecision({
    hasEntry: true, // 双探(:63-69)命中库条目
    activeMatchesMainline: true,
    activeIsModified: false,
    samePath: true, // 即便完全同路径,有 entry 也不短路
  });
  // 锚 open-workflow.js:90 前置条件 !entry——entry 存在时不得进任何短路,
  // 必须走 :92 清场 + :93-110 entry.load(保鲜链 force 重读语义所在)+ library-bound
  assert.strictEqual(decision, "proceed");
});

test("④ 无 svc 场景不进本判定:旧前端在判定点之前即 named-temp 兜底,纯函数只承接 svc 存在后的输入", () => {
  // open-workflow.js:50-54:svc 缺失/能力不全时先行 loadGraphData(named-temp)
  // 返回,永远到不了 :84-90 的判定点——「无 svc」场景由外层 named-temp 承担,
  // 不在本函数判定域(故无「no-svc」决策值)。此处锁无短路兜底形状:
  // 活跃签不匹配主线条且库里无条目 → proceed(交回 :112 named-temp 兜底)。
  const decision = resolveOpenWorkflowDecision({
    hasEntry: false,
    activeMatchesMainline: false,
    activeIsModified: false,
    samePath: false,
  });
  assert.strictEqual(decision, "proceed");
});

test("⑤ 防叠号语义(真锁,10-15 R19 改造):决策面=封闭集,全 16 输入组合无一溢出——任一新决策值入面即锁红,须人工审「不开新签」语义后入集", () => {
  // design §1.2 案A 钉意图:refresh-active 的实现=app2.loadGraphData(…)
  // 装进当前活跃签(不开新签)——原 :90 短路「重复 open 恒一签」的防叠号意图
  // 保留。旧断言 `!/open[-_]?new|new[-_]?tab/i.test(decision)` 系恒真(复核账
  // L3「测试⑤恒真,有效 6 条」):判定源只可能返回 :28-39 的四个字面量,正则
  // 永不命中=永不断言失败,锁无齿。真锁改封闭集:决策值必须 ∈ KNOWN_DECISIONS
  // (逐值人工审过均无「开新签」语义:kept-modified 保留用户态/named-active
  // 同名短路不重开/refresh-active 装进当前签/proceed 交回外层 entry 装载或
  // named-temp 兜底);全 16 布尔输入组合穷举,未来任何路径返回集外值(如
  // open-new-tab 类)当场锁红。
  const KNOWN_DECISIONS = [
    "kept-modified",
    "named-active",
    "refresh-active",
    "proceed",
    // 1015 内容锚(甲案)按本锁既定人工通道审入:锚不符时同款 loadGraphData
    // 装当前签,不开新签零叠号(mode 串 named-active-content-refreshed 见
    // open-workflow.js 接线)。
    "refresh-active-content",
  ];
  for (const hasEntry of [false, true]) {
    for (const activeMatchesMainline of [false, true]) {
      for (const activeIsModified of [false, true]) {
        for (const samePath of [false, true]) {
          const decision = resolveOpenWorkflowDecision({
            hasEntry,
            activeMatchesMainline,
            activeIsModified,
            samePath,
          });
          assert.ok(
            KNOWN_DECISIONS.includes(decision),
            `决策溢出封闭集:「${decision}」(输入 hasEntry=${hasEntry}`
            + ` activeMatchesMainline=${activeMatchesMainline}`
            + ` activeIsModified=${activeIsModified} samePath=${samePath})。`
            + `防叠号锁:每个新决策值必须人工审「不开新签」语义后入集 `
            + `[${KNOWN_DECISIONS.join("/")}]`,
          );
        }
      }
    }
  }
});

test("⑥ mustFix·临时条目伪库条目(章翻转主死亡形态):entry.isTemporary → content=本次 graph,非上章 activeState,mode 不再谎报 library-bound", () => {
  // 场景(mustFix 复审 1014,deployed bundle settingStore-X9ZV_dAu.js 实读链):
  // ch1 首开走 named-temp → getUnconflictedPath 起始即原路径(`a=2,o=e`)且
  // createNewWorkflow 注册进索引(`.value[e.path]=e`)→ 临时签 path 恰=
  // libraryPath;切 ch2 再开 → getWorkflowByPath(`=e=>n.value[e]??null`)捞到
  // ch1 临时签(entry≠null)→ 决策面 proceed → $F.load 对临时签
  // `if(this.isTemporary||...)return this` 原地早退不读盘 → content 若取
  // entry.activeState=ch1 旧图 → 画布恒 ch1 且 mode 谎报 "library-bound"。
  // 修法(mustFix 选项②):临时条目无库文件背书,content 唯一真源=本次 graph。
  const ch1Stale = { nodes: [{ type: "MyStage", payload: "ch1" }] };
  const ch2Fresh = { nodes: [{ type: "MyStage", payload: "ch2" }] };
  const binding = resolveEntryBinding({
    entryIsTemporary: true,
    entryContent: ch1Stale,
    graph: ch2Fresh,
  });
  assert.strictEqual(binding.content, ch2Fresh); // RED 基线=ch1Stale → 按此原因红
  assert.strictEqual(binding.mode, "named-temp-refreshed"); // RED 基线="library-bound"
});

test("⑦ 库条目装载语义锁:isTemporary=false 维持 entry.activeState 与 library-bound(保鲜链 force 重读语义零动)", () => {
  const libContent = { nodes: [{ type: "MyStage", payload: "lib" }] };
  const hostGraph = { nodes: [] };
  const binding = resolveEntryBinding({
    entryIsTemporary: false,
    entryContent: libContent,
    graph: hostGraph,
  });
  assert.strictEqual(binding.content, libContent);
  assert.strictEqual(binding.mode, "library-bound");
  // activeState 缺席兜底形态(读失败后残留条目等)保持 ||graph 语义
  const fallback = resolveEntryBinding({
    entryIsTemporary: false,
    entryContent: undefined,
    graph: hostGraph,
  });
  assert.strictEqual(fallback.content, hostGraph);
});
