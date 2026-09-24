#!/usr/bin/env node
/**
 * R26.4 陪伴 ws 监听器(0924):被动收引擎广播的 per-node 执行事件(executing/
 * executed/execution_start/execution_success),落 JSONL。history 的
 * status.messages 不持久化 per-node 事件(只 start/cached/success 三种),懒执行
 * 零 [31] 的服务端实证须从 ws 广播现收。
 * 用法:node apps/build/scripts/qi21_r26_wsmon_0924.mjs <out.jsonl> <max_sec>
 */
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const WebSocket = require(`${process.env.HOME}/Project/Github/MYStudio/apps/node_modules/.pnpm/node_modules/ws`);

const OUT = process.argv[2];
const MAX_SEC = Number(process.argv[3] || 1200);
const ws = new WebSocket("ws://127.0.0.1:17002/ws?clientId=r26-wsmon-0924", { perMessageDeflate: false, maxPayload: 256 * 1024 * 1024 });
const { appendFileSync } = await import("node:fs");
const t0 = Date.now();
ws.on("open", () => console.log(new Date().toISOString(), "wsmon open"));
ws.on("message", (raw) => {
  const m = JSON.parse(raw.toString());
  if (["executing", "executed", "execution_start", "execution_success", "execution_error", "execution_interrupted", "progress", "execution_cached"].includes(m.type)) {
    if (m.type === "progress") return; // 每步多条,只留节点级
    appendFileSync(OUT, JSON.stringify({ ts: new Date().toISOString(), type: m.type, data: m.data }) + "\n");
    if (m.type !== "progress") console.log(new Date().toISOString().slice(11, 19), m.type, JSON.stringify(m.data || {}).slice(0, 120));
  }
});
ws.on("error", (e) => { console.error("ws error:", e.message); process.exit(1); });
setTimeout(() => { console.log("wsmon timeout exit"); process.exit(0); }, MAX_SEC * 1000);
