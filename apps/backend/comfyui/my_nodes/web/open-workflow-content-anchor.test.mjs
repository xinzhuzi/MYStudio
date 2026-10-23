// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

/**
 * open-workflow 内容锚(甲案,1015)纯函数测试——与 open-workflow-decision.test.mjs
 * 同目录同款 node --test 直跑、双 runner 适配头(VT 全量拾取兼容,零业务依赖)。
 * 跑法:node --test apps/backend/comfyui/my_nodes/web/open-workflow-content-anchor.test.mjs
 *
 * 残余窗(LF20 站5 实测指纹):samePath=true+entry=null 的 named-active 短路面,
 * 画布停旧章不重载——空章态下节点戳恒旧章(ch003 空章态戳恒 chapter-002)。
 * 修法(甲案定案)=同路径短路前先比内容锚(章戳):宿主注入链每 MyStage 节点
 * 已写 properties.myOriginEpisodeId + myStage.originEpisodeId(storyboard-pipeline-
 * comfy.ts:404-410 实锚),锚不符即本次 graph 是新章 → 不短路,决策面给
 * "refresh-active-content"(外层 open-workflow.js 同款 loadGraphData 重注入当前签,
 * 注入图自带新章戳,盖戳无需引擎侧补动作);任一侧无戳(静态库流 qi21 等/缺戳
 * 旧图)=null → fail-open 维持旧短路零波及;kept-modified 用户态优先级不动。
 *
 * 命名空间导入(非具名):RED 阶段 extractContentAnchor 尚不存在,具名导入是
 * 链接错误会整文件连坐红;命名空间让每条用例的红绿只锚自己的主。
 */

const { test } = await import(process.env.VITEST ? "vitest" : "node:test");
import assert from "node:assert/strict";
import * as decision from "./open-workflow-decision.mjs";

// 封闭集(open-workflow-decision.test.mjs ⑤ R19 真锁同批审入的五值)
const KNOWN_DECISIONS = [
  "kept-modified",
  "named-active",
  "refresh-active",
  "proceed",
  "refresh-active-content",
];

// named-active 短路面的输入形态(samePath=true+entry=null,残余窗本体)
const NAMED_ACTIVE_FACE = {
  hasEntry: false,
  activeMatchesMainline: true,
  activeIsModified: false,
  samePath: true,
};

// ── A. extractContentAnchor 四态+首中 ────────────────────────────────

test("A1 锚提取·MyStage 命中:properties.myOriginEpisodeId 直读(storyboard-pipeline-comfy.ts:405 生产端)", () => {
  const graph = { nodes: [{ type: "MyStage", properties: { myOriginEpisodeId: "chapter-003" } }] };
  assert.strictEqual(decision.extractContentAnchor(graph), "chapter-003");
});

test("A2 锚提取·ManyingStage 兼容别名(与 cleanupLegacyUnsavedTabs open-workflow.js:217 同款双型)", () => {
  const graph = { nodes: [{ type: "ManyingStage", properties: { myOriginEpisodeId: "ep-2" } }] };
  assert.strictEqual(decision.extractContentAnchor(graph), "ep-2");
});

test("A3 锚提取·myStage.originEpisodeId 回退(载荷内戳,storyboard-pipeline-comfy.ts:410 生产端)", () => {
  const graph = { nodes: [{ type: "MyStage", properties: { myStage: { originEpisodeId: "chapter-002" } } }] };
  assert.strictEqual(decision.extractContentAnchor(graph), "chapter-002");
});

test("A4 锚提取·无戳/空图/非分镜图 → null fail-open(静态库流与缺戳旧图零波及)", () => {
  assert.strictEqual(decision.extractContentAnchor({ nodes: [] }), null);
  assert.strictEqual(decision.extractContentAnchor({ nodes: [{ type: "MyStage", properties: {} }] }), null);
  assert.strictEqual(
    decision.extractContentAnchor({ nodes: [{ type: "KSampler", properties: { seed: 1 } }] }),
    null,
  );
  // fail-open:graph 缺失/畸形不抛,恒 null
  assert.strictEqual(decision.extractContentAnchor(undefined), null);
  assert.strictEqual(decision.extractContentAnchor(null), null);
  assert.strictEqual(decision.extractContentAnchor({}), null);
});

test("A5 锚提取·首个非空字符串获胜:空白串跳过、直读优先于载荷戳", () => {
  // 空白串=非空检查不过,继续找
  const skipBlank = {
    nodes: [
      { type: "MyStage", properties: { myOriginEpisodeId: "   " } },
      { type: "MyStage", properties: { myOriginEpisodeId: "ep-9" } },
    ],
  };
  assert.strictEqual(decision.extractContentAnchor(skipBlank), "ep-9");
  // 同节点双源:直读戳优先于载荷戳(?? 语义)
  const directWins = {
    nodes: [{ type: "MyStage", properties: { myOriginEpisodeId: "ep-8", myStage: { originEpisodeId: "ep-1" } } }],
  };
  assert.strictEqual(decision.extractContentAnchor(directWins), "ep-8");
});

// ── B. 决策面锚分支 ─────────────────────────────────────────────────

test("B1 锚不符→不走短路(RED 主件):named-active 面两侧锚都非 null 且不等 → refresh-active-content(外层同款 loadGraphData 重注入当前签)", () => {
  const d = decision.resolveOpenWorkflowDecision({ ...NAMED_ACTIVE_FACE, contentAnchorMatch: false });
  // RED 基线=现行短路给 "named-active"(画布停旧章);GREEN 后应为重注入决策
  assert.strictEqual(d, "refresh-active-content");
});

test("B2 短路保留对照·锚相等:同名同路径且章戳一致 → named-active(重复 open 恒一签语义零动)", () => {
  const d = decision.resolveOpenWorkflowDecision({ ...NAMED_ACTIVE_FACE, contentAnchorMatch: true });
  assert.strictEqual(d, "named-active");
});

test("B3 短路保留对照·锚 null(任一侧无戳)与缺省参 → named-active 复归(fail-open 维持旧短路)", () => {
  assert.strictEqual(
    decision.resolveOpenWorkflowDecision({ ...NAMED_ACTIVE_FACE, contentAnchorMatch: null }),
    "named-active",
  );
  // 不传该参(既有调用方/既有测试形态)必须等价 null,零波及
  assert.strictEqual(decision.resolveOpenWorkflowDecision({ ...NAMED_ACTIVE_FACE }), "named-active");
});

test("B4 kept-modified 优先锁不破:锚不符也压不过用户未保存修改(Q1a 用户态恒第一)", () => {
  const d = decision.resolveOpenWorkflowDecision({
    ...NAMED_ACTIVE_FACE,
    activeIsModified: true,
    contentAnchorMatch: false,
  });
  assert.strictEqual(d, "kept-modified");
});

// ── C/D/E. 防叠号·封闭集·锚不外溢 ──────────────────────────────────

test("C1 防叠号语义:锚不符的新决策值不得携带开新签语义(09-12 叠号回归锁)", () => {
  const d = decision.resolveOpenWorkflowDecision({ ...NAMED_ACTIVE_FACE, contentAnchorMatch: false });
  assert.ok(!/open[-_]?new|new[-_]?tab/i.test(d), `决策不得含开新签类语义,实得:${d}`);
});

test("D1 封闭集 16×3 穷举:全布尔组合×锚三态,48 种输入无一溢出五值封闭集", () => {
  for (const hasEntry of [false, true]) {
    for (const activeMatchesMainline of [false, true]) {
      for (const activeIsModified of [false, true]) {
        for (const samePath of [false, true]) {
          for (const contentAnchorMatch of [false, true, null]) {
            const d = decision.resolveOpenWorkflowDecision({
              hasEntry, activeMatchesMainline, activeIsModified, samePath, contentAnchorMatch,
            });
            assert.ok(
              KNOWN_DECISIONS.includes(d),
              `决策溢出封闭集:「${d}」(hasEntry=${hasEntry} match=${activeMatchesMainline}`
              + ` modified=${activeIsModified} samePath=${samePath} anchor=${contentAnchorMatch})`,
            );
          }
        }
      }
    }
  }
});

test("E1 锚不外溢:contentAnchorMatch=false 只作用于 named-active 面,其余面零波及", () => {
  // entry 存在 → proceed 锁(交回外层装载路径)不受锚影响
  assert.strictEqual(
    decision.resolveOpenWorkflowDecision({
      hasEntry: true, activeMatchesMainline: true, activeIsModified: false, samePath: true,
      contentAnchorMatch: false,
    }),
    "proceed",
  );
  // 路径异(章翻转)面仍是 refresh-active,锚参不越权改判
  assert.strictEqual(
    decision.resolveOpenWorkflowDecision({
      hasEntry: false, activeMatchesMainline: true, activeIsModified: false, samePath: false,
      contentAnchorMatch: false,
    }),
    "refresh-active",
  );
  // 活跃签不匹配主线条 → proceed 兜底,锚参零影响
  assert.strictEqual(
    decision.resolveOpenWorkflowDecision({
      hasEntry: false, activeMatchesMainline: false, activeIsModified: false, samePath: true,
      contentAnchorMatch: false,
    }),
    "proceed",
  );
});
