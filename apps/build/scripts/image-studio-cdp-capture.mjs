// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

/**
 * 捕获装机应用启动→死亡的全程 CDP 事件(console/异常/目标崩溃),定位
 * 图片工作室画布挂载窗口内的致命错误。用法:
 *   MYSTUDIO_REMOTE_DEBUG=1 open -a "漫影工作室" 后立即 node 本脚本
 */
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const WebSocket = require("/Users/zhengbingjin/Project/Github/MYStudio/apps/node_modules/.pnpm/node_modules/ws");

const CDP_HTTP = "http://127.0.0.1:9222";
const events = [];
let ws = null;
let messageId = 0;
const pending = new Map();

function send(method, params = {}) {
  const id = ++messageId;
  return new Promise((resolve, reject) => {
    pending.set(id, (message) => {
      if (message.error) reject(new Error(`${method}: ${message.error.message}`));
      else resolve(message.result);
    });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function main() {
  // 等端口出现(应用刚被 open)
  const deadline = Date.now() + 20000;
  let list;
  while (Date.now() < deadline) {
    try {
      list = await (await fetch(`${CDP_HTTP}/json`)).json();
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }
  if (!list) {
    console.log("NO-CDP: 端口从未出现");
    return;
  }
  const page = list.find((target) => target.type === "page");
  ws = new WebSocket(page.webSocketDebuggerUrl, { maxPayload: 512 * 1024 * 1024 });
  await new Promise((resolve) => (ws.once("open", resolve)));
  ws.on("message", (raw) => {
    const message = JSON.parse(raw.toString());
    if (message.id && pending.has(message.id)) {
      pending.get(message.id)(message);
      pending.delete(message.id);
      return;
    }
    if (message.method === "Runtime.consoleAPICalled") {
      const text = (message.params.args ?? [])
        .map((arg) => arg.value ?? arg.description ?? "")
        .join(" ").slice(0, 500);
      events.push(`[console.${message.params.type}] ${text}`);
    } else if (message.method === "Runtime.exceptionThrown") {
      const detail = message.params.exceptionDetails;
      events.push(`[exception] ${detail.text} ${detail.exception?.description ?? ""}`.slice(0, 1200));
    } else if (message.method === "Log.entryAdded") {
      events.push(`[log.${message.params.entry.level}] ${message.params.entry.text} ${message.params.entry.url ?? ""}`.slice(0, 400));
    } else if (message.method === "Inspector.targetCrashed") {
      events.push("[TARGET-CRASHED] 渲染进程崩溃");
    } else if (message.method?.startsWith("Network.")) {
      // 静默
    } else if (message.method) {
      events.push(`[cdp] ${message.method}`);
    }
  });
  ws.on("close", () => events.push("[ws-close] 与应用的连接断开(应用退出/端口关闭)"));
  await send("Runtime.enable");
  await send("Log.enable");
  await send("Page.enable");
  console.log("attached, capturing 25s ...");

  // 周期采样页面状态
  for (let tick = 0; tick < 25; tick += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    try {
      const state = await send("Runtime.evaluate", {
        expression: `JSON.stringify({
          ready: document.readyState,
          nav: Boolean(document.querySelector('.studio-nav-button')),
          flow: Boolean(document.querySelector('.react-flow')),
          studio: Boolean(document.querySelector('[data-image-studio-add-t2i]')),
          body: document.body.textContent.slice(0, 60),
        })`,
        returnByValue: true,
      });
      events.push(`[t+${tick + 1}s] ${state.result.value}`);
    } catch (error) {
      events.push(`[t+${tick + 1}s] evaluate failed: ${error.message.slice(0, 120)}`);
      break;
    }
  }
  console.log(events.join("\n"));
  try { ws.close(); } catch {}
}

main().catch((error) => {
  console.log(`capture-error: ${error.message}`);
  console.log(events.join("\n"));
});
