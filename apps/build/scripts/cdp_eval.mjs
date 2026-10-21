#!/usr/bin/env node
/** 通用 CDP eval(9223 App 在驾):node cdp_eval.mjs '<表达式>' → JSON 结果 */
const CDP_HTTP = "http://127.0.0.1:9223";

async function pageWsUrl() {
  const list = await (await fetch(`${CDP_HTTP}/json/list`)).json();
  const page = list.find((t) => t.type === "page");
  if (!page) throw new Error("CDP 无 page target");
  return page.webSocketDebuggerUrl;
}

async function main() {
  const expr = process.argv[2];
  if (!expr) throw new Error("用法: cdp_eval.mjs '<表达式>'");
  const ws = new WebSocket(await pageWsUrl());
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  const result = await new Promise((res, rej) => {
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id === 1) res(msg);
    };
    ws.onerror = rej;
    ws.send(JSON.stringify({
      id: 1, method: "Runtime.evaluate",
      params: { expression: expr, awaitPromise: true, returnByValue: true },
    }));
  });
  ws.close();
  console.log(JSON.stringify(result.result ?? result.error ?? result));
}

main().catch((e) => { console.error("FATAL:", e.message); process.exit(1); });
