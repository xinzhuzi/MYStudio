#!/usr/bin/env node
/** 九型 PE 实拍·仪表化补拍(0924):九拍跑完后,取第 1 拍(人物)的服务端排队图
 * (nine-pe-driver-report.json cases[0].serverQueueBlob,与真前端排队逐字节同内容),
 * 以本监控 clientId 直排 POST /prompt——WS 旁路(execute/progress)定向到本进程,
 * 精确取:PE 改写节点(40:140)耗时 + KSampler progress max(=步数,应 6)+分段耗时。
 * 产出图不入九型图证目录(仪表件,engine output 自然落盘)。
 * 用法:node qi21_nine_pe_instrument_0924.mjs(引擎与 ws 事件均须在位)
 */
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";

const require = createRequire(import.meta.url);
const WebSocket = require(`${process.env.HOME}/Project/Github/MYStudio/apps/node_modules/.pnpm/node_modules/ws`);

const ENGINE = process.env.ENGINE_URL || "http://127.0.0.1:17002";
const REPORT = `${process.env.HOME}/Project/Github/MYStudio/apps/out/q21-final-0924/nine-pe-driver-report.json`;
const OUT = `${process.env.HOME}/Project/Github/MYStudio/apps/out/q21-final-0924/nine-pe-instrument.json`;
const CLIENT_ID = "nine-pe-wsmon-0924"; // 与已挂 wsmon 同 id:事件定向到 wsmon(其 jsonl 留档),本进程只排队+轮询
const TIMEOUT = Number(process.env.GEN_TIMEOUT_MS || 1_200_000);

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

const report = JSON.parse(readFileSync(REPORT, "utf8"));
const case1 = report.cases.find((c) => c.idx === 1);
if (!case1?.serverQueueBlob) { console.error("缺第 1 拍 serverQueueBlob"); process.exit(2); }
const prompt = JSON.parse(case1.serverQueueBlob);
log("仪表拍=复排第 1 拍(人物)服务端排队图;nodes=", Object.keys(prompt).length);

// ws 事件:不开新连接——SocketManager 每 sid 单槽(sockets[sid]=ws,后连替换先连),
// 已在场的 wsmon(clientId=nine-pe-wsmon-0924)持有该 sid 槽位,本拍事件定向到它,
// 其 jsonl(/tmp/qi21-ninepe-0924/ws-events.jsonl)留档;本脚本只排队+轮询+落仪表结录。

async function main() {
  const t0 = Date.now();
  const known = new Set(Object.keys(await (await fetch(`${ENGINE}/history`)).json()));
  const resp = await fetch(`${ENGINE}/prompt`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, client_id: CLIENT_ID }),
  });
  const j = await resp.json();
  if (!resp.ok || j.prompt_id === undefined) { console.error("排队失败:", resp.status, JSON.stringify(j).slice(0, 400)); process.exit(1); }
  log("queued pid=", j.prompt_id, "number=", j.number);

  // 等 history 完成
  let entry = null;
  while (Date.now() - t0 < TIMEOUT) {
    const h = await (await fetch(`${ENGINE}/history`)).json();
    const e = h[j.prompt_id];
    if (e && (e.status?.status_str === "success" || e.status?.status_str === "error")) { entry = e; break; }
    await sleep(3000);
  }
  if (!entry) { console.error("仪表拍超时"); process.exit(1); }
  const secs = ((Date.now() - t0) / 1000).toFixed(0);
  const imgs = [];
  for (const o of Object.values(entry.outputs || {})) if (o.images) imgs.push(...o.images);
  log("完成:", entry.status.status_str, secs + "s", "imgs:", imgs.map((i) => i.filename).join(","));
  writeFileSync(OUT, JSON.stringify({
    purpose: "仪表化补拍:WS 定向收 per-node 事件,精确取 PE 改写耗时+KSampler 步数(progress max)",
    base: "九拍第 1 拍(人物)服务端排队图原样复排(与真前端排队逐字节同内容)",
    clientId: CLIENT_ID, pid: j.prompt_id, status: entry.status.status_str, wallSecs: secs,
    images: imgs.map((i) => i.filename),
    note: "per-node 事件与 progress 见 /tmp/qi21-ninepe-0924/ws-events.jsonl(clientId=nine-pe-wsmon-0924 定向);此拍产物不入九型图证目录。",
  }, null, 2));
  log("saved", OUT);
  process.exit(entry.status.status_str === "success" ? 0 : 1);
}
main().catch((e) => { console.error(e.message); process.exit(1); });
