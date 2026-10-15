// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

/**
 * opener mode 收据通道·客户端发射器(LF21,1015)。
 *
 * 为什么:opener(open-workflow.js 单实例协议 v3)的 mode 结果只在
 * webview guest 内被消费(ComfyCanvasStudio.buildOverviewOpenScript 内联
 * 源 await opener(payload) 后只认 kept-modified),宿主/main 进程全程
 * 拿不到 mode。收据=把 {ts,name,mode,ok} fire-and-forget POST 给引擎侧
 * 同源路由 POST /my_bridge/open_receipt(open_receipt_server.py),由其
 * 双落盘(<comfy-home>/logs/open-receipts-YYYYMMDD.log JSONL + engine.log
 * stdout 行),过 webview 重载/引擎重启全存活。
 *
 * 工程约束(同桥面先例 bridge-action.js 的同源 fetch 范式):
 * - 零依赖纯函数,注入 fetchImpl 可测(node --test / VT 双 runner);
 * - fire-and-forget:同步返回是否已派发,响应与异常全吞,绝不 await
 *   拒约、绝不弹窗(与 postAction 弹窗纪律相反),任何故障不咬打开主路;
 * - 引擎无此路由(旧引擎/挂载失败)时 fetch 404 → 静默,打开语义零影响。
 */

/** 引擎侧收据路由(与 open_receipt_server.py 路由常量互为镜像)。 */
export const OPEN_RECEIPT_PATH = "/my_bridge/open_receipt";

/**
 * 收据 payload 纯函数。
 * @param input {name?, mode?, ok?, now?} now 仅供测试注入时钟(省缺 new Date())。
 * @returns {{ts: string, name: string|null, mode: string|null, ok: boolean|null}}
 *   缺字段归 null(不是 "undefined" 字符串混进 JSONL);ok 归一布尔。
 */
export function buildOpenReceipt({ name, mode, ok, now } = {}) {
  const ts = (now instanceof Date ? now : new Date()).toISOString();
  return {
    ts,
    name: typeof name === "string" ? name : name == null ? null : String(name),
    mode: typeof mode === "string" ? mode : mode == null ? null : String(mode),
    ok: typeof ok === "boolean" ? ok : ok == null ? null : Boolean(ok),
  };
}

/**
 * 发射收据(fire-and-forget):POST JSON 到同源收据路由。
 * @returns {boolean} 是否已派发(传输面缺失/构造异常=false);派发结果
 *   (含网络失败/404)一律静默——收据失败绝不影响打开语义。
 */
export function emitOpenReceipt(input, { fetchImpl } = {}) {
  try {
    const doFetch = fetchImpl !== undefined ? fetchImpl : globalThis.fetch;
    if (typeof doFetch !== "function") return false;
    const receipt = buildOpenReceipt(input ?? {});
    Promise.resolve(
      doFetch(OPEN_RECEIPT_PATH, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(receipt),
        keepalive: true, // webview 卸载/重载窗口期也尽力送达
      }),
    ).catch(() => {}); // 拒约全吞:收据通道永不向调用方回抛
    return true;
  } catch (error) {
    return false; // 构造/派发任何异常不咬打开主路
  }
}
