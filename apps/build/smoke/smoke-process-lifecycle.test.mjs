// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

/**
 * smoke-process-lifecycle 纯函数测试(10-15 audit4-residuals R20:八处盲杀改自起
 * PID 精收/三态守卫的可测核。runner 适配同 open-workflow-decision.test.mjs:10-15
 * 定谳:VT 全量默认 glob 会拾取 apps/ 下任意 *.test.mjs,node:test 用例 vitest 不
 * 认领 → 「No test suite found」套件红;按 runner 取注册 API,两门禁同锁同一断言面。
 * 跑法①:node --test apps/build/smoke/smoke-process-lifecycle.test.mjs
 *
 * 进程触碰(runner/isAlive/delay)全部依赖注入,零真实进程零真实等待。
 */

const { test } = await import(process.env.VITEST ? "vitest" : "node:test");
import assert from "node:assert/strict";
import {
  diffSelfStartedPids,
  parsePgrepPids,
  probeRunningInstances,
  resolvePrekillMode,
  terminatePidsPrecisely,
} from "./smoke-process-lifecycle.mjs";

test("parsePgrepPids:pgrep stdout→pid 数组;空/脏行/非正整数剔除", () => {
  assert.deepEqual(parsePgrepPids(""), []);
  assert.deepEqual(parsePgrepPids("  \n"), []);
  assert.deepEqual(parsePgrepPids("401\n402\n"), [401, 402]);
  assert.deepEqual(parsePgrepPids("401\n\nabc\n403"), [401, 403]);
  assert.deepEqual(parsePgrepPids("0\n-5\n404"), [404]);
});

test("diffSelfStartedPids:现存在−launch 前快照=自起差集(顺序保持,before 集合化)", () => {
  assert.deepEqual(diffSelfStartedPids([], [401, 402]), [401, 402]);
  assert.deepEqual(diffSelfStartedPids([401], [401, 402]), [402]);
  assert.deepEqual(diffSelfStartedPids([401, 402], [401, 402]), []);
  assert.deepEqual(diffSelfStartedPids([401, 401], [401, 401, 402]), [402]);
  assert.deepEqual(diffSelfStartedPids([401], []), []);
});

test("resolvePrekillMode 三态:默认=guard/SKIP=skip/FORCE=force;SKIP 优先于 FORCE(f5166c75 定序)", () => {
  assert.equal(resolvePrekillMode({}), "guard");
  assert.equal(resolvePrekillMode({ skipPrekill: false, prekillForce: false }), "guard");
  assert.equal(resolvePrekillMode({ skipPrekill: true }), "skip");
  assert.equal(resolvePrekillMode({ prekillForce: true }), "force");
  assert.equal(resolvePrekillMode({ skipPrekill: true, prekillForce: true }), "skip");
});

test("probeRunningInstances:注入 runner,pgrep 命中解析为 pid 数组;零命中/无 stdout=空数组", () => {
  const calls = [];
  const pids = probeRunningInstances({
    pattern: "漫影工作室.app",
    run: (cmd, args) => {
      calls.push([cmd, args]);
      return { status: 0, stdout: "401\n" };
    },
  });
  assert.deepEqual(pids, [401]);
  assert.deepEqual(calls, [["pgrep", ["-f", "漫影工作室.app"]]]);
  assert.deepEqual(
    probeRunningInstances({ run: () => ({ status: 1, stdout: "" }) }),
    [],
  );
  assert.deepEqual(probeRunningInstances({ run: () => null }), []);
});

test("terminatePidsPrecisely:TERM 全员→宽限内存活者补 KILL;去重/滤 pid≤1", async () => {
  const killed = [];
  const alive = new Set([401, 402]); // 402 不退出等 KILL;401 首次等待后已退
  await terminatePidsPrecisely([401, 402, 402, 0, -3], {
    run: (cmd, args) => killed.push([cmd, args[0], args[1]]),
    isAlive: (pid) => alive.has(pid),
    delay: async () => {
      alive.delete(401);
    },
    graceMs: 300,
    logPrefix: "[t]",
  });
  assert.deepEqual(killed, [
    ["kill", "-TERM", "401"],
    ["kill", "-TERM", "402"],
    ["kill", "-KILL", "402"],
  ]);
});

test("terminatePidsPrecisely:全员即退则只有 TERM 零 KILL;空表零 kill 调用", async () => {
  const killed = [];
  await terminatePidsPrecisely([501], {
    run: (cmd, args) => killed.push([cmd, args[0], args[1]]),
    isAlive: () => false,
    delay: async () => {},
    graceMs: 300,
    logPrefix: "[t]",
  });
  assert.deepEqual(killed, [["kill", "-TERM", "501"]]);

  const none = [];
  await terminatePidsPrecisely([], {
    run: (cmd, args) => none.push([cmd, args]),
    isAlive: () => true,
    delay: async () => {},
    graceMs: 300,
  });
  assert.deepEqual(none, []);
});
