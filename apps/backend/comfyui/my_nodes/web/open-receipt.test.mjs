// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

/**
 * open-receipt 收据通道纯函数测试(LF21:opener mode 收据通道,1015)。
 * 跑法①:node --test apps/backend/comfyui/my_nodes/web/open-receipt.test.mjs
 *
 * 双 runner 适配(同 open-workflow-decision.test.mjs 头注口径):VT 全量
 * (apps/ 根)默认 glob 会拾取任意层级 *.test.mjs,而 node:test 用例不被
 * vitest 认领 →「No test suite found」套件红;按 runner 取注册 API——
 * VT 下(process.env.VITEST)用 vitest 的 test,node --test 下用 node:test,
 * 下方断言零改,两门禁同锁同一断言面。
 *
 * 缝(TDD 预约,LF21 设计「收据 payload 纯函数」):
 * - buildOpenReceipt:收据 payload 纯函数(now 注入,零时钟依赖);
 * - emitOpenReceipt:fire-and-forget 发射器(fetchImpl 注入,零真网;
 *   全容错,任何故障绝不咬打开主路)。
 */

const { test } = await import(process.env.VITEST ? "vitest" : "node:test");
import assert from "node:assert/strict";
import { OPEN_RECEIPT_PATH, buildOpenReceipt, emitOpenReceipt } from "./open-receipt.mjs";

const FIXED_NOW = new Date("2026-10-15T08:09:10.000Z");

test("① buildOpenReceipt:注入时钟→精确字面 payload {ts,name,mode,ok}", () => {
  const receipt = buildOpenReceipt({
    name: "0_分镜/分镜工作流.json",
    mode: "kept-modified",
    ok: true,
    now: FIXED_NOW,
  });
  assert.deepStrictEqual(receipt, {
    ts: "2026-10-15T08:09:10.000Z",
    name: "0_分镜/分镜工作流.json",
    mode: "kept-modified",
    ok: true,
  });
});

test("② buildOpenReceipt:缺字段/非串→null(不是 \"undefined\" 字符串混进 JSONL)", () => {
  const receipt = buildOpenReceipt({ mode: undefined, now: FIXED_NOW });
  assert.strictEqual(receipt.ts, "2026-10-15T08:09:10.000Z");
  assert.strictEqual(receipt.name, null);
  assert.strictEqual(receipt.mode, null);
  assert.strictEqual(receipt.ok, null);
});

test("③ buildOpenReceipt:ok 真值归一为布尔(1→true,0→false)", () => {
  assert.strictEqual(buildOpenReceipt({ mode: "m", ok: 1, now: FIXED_NOW }).ok, true);
  assert.strictEqual(buildOpenReceipt({ mode: "m", ok: 0, now: FIXED_NOW }).ok, false);
});

test("④ 七分支 mode 串全量直通(opener 协议 v3 全 mode 清单锚:open-workflow.js 七 return)", () => {
  const modes = [
    "no-app",
    "named-temp",
    "kept-modified",
    "named-active",
    "named-active-refreshed",
    "named-temp-refreshed",
    "library-bound",
  ];
  for (const mode of modes) {
    assert.strictEqual(buildOpenReceipt({ mode, now: FIXED_NOW }).mode, mode);
  }
});

test("⑤ emitOpenReceipt:POST 同源路由+JSON body;fetch 拒约被吞(返回 true,零抛出)", () => {
  const calls = [];
  const fetchImpl = (path, init) => {
    calls.push({ path, init });
    return Promise.reject(new Error("网络死透"));
  };
  const dispatched = emitOpenReceipt(
    { name: "n.json", mode: "library-bound", ok: true, now: FIXED_NOW },
    { fetchImpl },
  );
  assert.strictEqual(dispatched, true);
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].path, OPEN_RECEIPT_PATH);
  assert.strictEqual(calls[0].path, "/my_bridge/open_receipt");
  assert.strictEqual(calls[0].init.method, "POST");
  const body = JSON.parse(calls[0].init.body);
  assert.strictEqual(body.mode, "library-bound");
  assert.strictEqual(body.name, "n.json");
  assert.strictEqual(body.ok, true);
  assert.strictEqual(body.ts, "2026-10-15T08:09:10.000Z");
});

test("⑥ emitOpenReceipt:无传输面(fetchImpl=null)→false 且零抛(fire-and-forget 永不咬打开主路)", () => {
  assert.strictEqual(emitOpenReceipt({ mode: "named-temp" }, { fetchImpl: null }), false);
});

test("⑦ emitOpenReceipt:入参垃圾(null)→照发不炸(收据通道全容错)", () => {
  const seen = [];
  const dispatched = emitOpenReceipt(null, {
    fetchImpl: (path, init) => {
      seen.push({ path, init });
      return Promise.resolve({ ok: true });
    },
  });
  assert.strictEqual(dispatched, true);
  assert.strictEqual(JSON.parse(seen[0].init.body).mode, null);
});
