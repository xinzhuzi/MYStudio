#!/usr/bin/env node
/** my_scope 探针(1018,jsdom 仿真零引擎约束):装载真 my_nodes/web/my_scope.js,
 *  断言作用域生命周期四律+模式热切换(吸收自 AlignLayout runtime.js 的方法重实现):
 *  ①listen 登记→dispose 拆监听(事件不再达);
 *  ②expose 新键→dispose 删;expose 占用旧键→dispose 还原旧值;
 *  ③timeout 登记→dispose 清(等待窗后零触发);
 *  ④清理逆序(a,b,c→c,b,a)+单条失败隔离(抛错不拖累后续)+幂等(二次 dispose 零重跑)
 *    +已死 scope 再 add=立即执行;
 *  ⑤模式热切换:switchMode 收旧建新(旧 scope 监听已拆/新 scope 已 setup)、
 *    同模式重调=零重建、setup 抛错=全收+态复位(下一轮可重来)。
 *  任何断言红=exit 1;全绿打印 MY_SCOPE_PROBE_OK。 */
import { JSDOM } from "jsdom";
import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, "../web/my_scope.js");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    runScripts: "outside-only",
    pretendToBeVisual: true,
    url: "http://localhost/",
});
const { window } = dom;
window.eval(String(await readFile(SRC, "utf8")));
const MyScope = window.MyScope;
if (!MyScope || typeof MyScope.create !== "function") {
    console.error("FAIL: MyScope 未挂载");
    process.exit(1);
}
const ok = (cond, label) => {
    if (!cond) { console.error("FAIL:", label); process.exit(1); }
    console.log("ok:", label);
};

// ① listen 登记/拆卸
{
    const scope = MyScope.create();
    let hits = 0;
    scope.listen(window, "probe-evt", () => hits++);
    window.dispatchEvent(new window.Event("probe-evt"));
    ok(hits === 1, "listen: 事件可达");
    scope.dispose();
    window.dispatchEvent(new window.Event("probe-evt"));
    ok(hits === 1, "listen: dispose 后事件不再达");
}

// ② expose 新键删/旧键还原
{
    window.__preexist__ = "旧值";
    const scope = MyScope.create();
    scope.expose("MY_PROBE_NEW", 42);
    scope.expose("__preexist__", "新值");
    ok(window.MY_PROBE_NEW === 42 && window.__preexist__ === "新值", "expose: 挂载生效");
    scope.dispose();
    ok(!("MY_PROBE_NEW" in window), "expose: dispose 删除新键");
    ok(window.__preexist__ === "旧值", "expose: dispose 还原旧值");
}

// ③ timeout 清理
{
    const scope = MyScope.create();
    let fired = 0;
    scope.timeout(() => fired++, 10);
    scope.dispose();
    await sleep(40);
    ok(fired === 0, "timeout: dispose 后零触发");
}

// ④ 逆序/失败隔离/幂等/死 scope 立即执行
{
    const scope = MyScope.create();
    const order = [];
    scope.add(() => order.push("a"));
    scope.add(() => { throw new Error("故意的清理失败"); });
    scope.add(() => order.push("c"));
    scope.dispose();
    ok(order.join(",") === "c,a", "清理逆序+失败隔离(c 先于 a,抛错件被吞)");
    let rerun = 0;
    scope.add(() => rerun++);           // 已死 scope=add 立即执行
    ok(rerun === 1, "已死 scope 再 add=立即执行");
    scope.dispose();                    // 幂等二次
    ok(rerun === 1, "dispose 幂等(零重复执行)");
}

// ⑤ 模式热切换
{
    const setups = { a: 0, b: 0 };
    const buildA = (scope) => {
        setups.a++;
        return [{ setup: async () => { scope.expose("MY_MODE_A", true); } }];
    };
    const buildB = (scope) => {
        setups.b++;
        return [{ setup: async () => { scope.expose("MY_MODE_B", true); } }];
    };
    const ctl = MyScope.createModeController(buildA, buildB);
    await ctl.switchMode(false);
    ok(setups.a === 1 && window.MY_MODE_A === true, "热切换: default 建+setup");
    await ctl.switchMode(true);
    ok(setups.b === 1 && !("MY_MODE_A" in window) && window.MY_MODE_B === true,
        "热切换: 旧 scope 全收(expose 还原)+新 scope setup");
    await ctl.switchMode(true);
    ok(setups.b === 1, "热切换: 同模式重调=零重建");
    // setup 抛错=全收+态复位,下一轮可重来
    let boom = 0;
    const ctl2 = MyScope.createModeController(
        (scope) => [{ setup: async () => scope.expose("MY_RETRY", 1) }],
        () => [{ setup: async () => { boom++; throw new Error("setup 失败"); } }]);
    let threw = false;
    try { await ctl2.switchMode(true); } catch { threw = true; }
    ok(threw && boom === 1, "热切换: setup 抛错向上抛");
    await ctl2.switchMode(false);
    ok(window.MY_RETRY === 1, "热切换: 抛错后态复位,下一轮可重来");
}

console.log("MY_SCOPE_PROBE_OK");
