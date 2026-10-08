#!/usr/bin/env node
// canvas_deploy.mjs — 画布/节点改动的唯一交付命令(1007 判图役五连修定谳)。
// 把 node-graph 技能调用集 INVOCATION.md「唯一交付管线」固化成代码:自动判类型→cp 热覆盖→生效动作
// (引擎重启/画布重载/页面重载)→活机读数(**读渲染源**)→PASS/FAIL,exit code=verdict。
// 用法:
//   node canvas_deploy.mjs <文件路径...>            # 部署+生效+验证
//   node canvas_deploy.mjs <文件...> --verify-only  # 只验证不部署
//   node canvas_deploy.mjs <文件...> --no-restart   # .py 部署但不重启引擎(慎用)
//   node canvas_deploy.mjs --audit                  # 全量四副本对账机器门(workflows+my_nodes)
// 选项: --push-canvas 强制 CDP loadGraphData(json 类型默认推)
// 纪律:本脚本输出的 PASS/FAIL 即交付结论;agent 报「已生效」必须引用本脚本的活机读数。
import { spawn, execSync } from "node:child_process";
import { readFileSync, copyFileSync, statSync } from "node:fs";
import { basename, join, dirname, resolve } from "node:path";

const HOME = process.env.HOME;
const REPO = resolve(import.meta.dirname, "../../..");
const APP_RES = "/Applications/漫影工作室.app/Contents/Resources/backend/engines/comfyui";
const ENGINE_HOME = process.env.MYSTUDIO_ENGINE_HOME || `${HOME}/Project/IP/漫影工作室/comfyui/ComfyUI`;
const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const OPTS = new Set(process.argv.slice(2).filter((a) => a.startsWith("--")));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const FAILS = [];
const ok = (name, detail) => log(`PASS  ${name}${detail ? " — " + detail : ""}`);
const bad = (name, detail) => { FAILS.push(name); log(`FAIL  ${name}${detail ? " — " + detail : ""}`); };
const md5 = (p) => execSync(`md5 -q '${p}'`).toString().trim();
const sh = (cmd) => { try { return execSync(cmd, { timeout: 15000 }).toString(); } catch { return ""; } };

function classify(file) {
  const f = file.replace(REPO + "/", "");
  if (/_nodes\/nodes\/.*\.py$/.test(f)) return { type: "py", rel: f };
  if (/_nodes\/web\/.*\.js$/.test(f)) return { type: "js", rel: f };
  if (/_nodes\/subgraphs\/.*\.json$/.test(f)) return { type: "subgraph", rel: f };
  if (/^apps\/backend\/engines\/comfyui\/workflows\/.*\.json$/.test(f)) return { type: "workflow", rel: f };
  return null;
}

// ── --audit 全量四副本对账机器门(1007晚 复毒事故立门:三处对账靠散文+自觉必漏)──
// workflows: 装机=必须同在且同字节;用户区=存在必须同字节(缺席=NOTE 基线,零回灌设计内)
// my_nodes:  装机+引擎家=必须同在且同字节;tests/** 两路豁免(打包白名单设计内)
// exit code: 0=ALL PASS, 1=有 FAIL —— 报「同步完成/指纹一致」前必跑,人工逐文件对账不再作数
async function auditAll() {
  const { readdirSync } = await import("node:fs");
  const rels = [];
  const walk = (base, prefix = "") => {
    for (const e of readdirSync(base, { withFileTypes: true })) {
      const p = prefix ? prefix.replace(/\/+$/, "") + "/" + e.name : e.name;
      if (e.isDirectory()) walk(join(base, e.name), p);
      else if (/\.(py|js|json)$/.test(e.name) && e.name !== ".keep.json") rels.push(p);
    }
  };
  walk(join(REPO, "apps/backend/engines/comfyui/workflows"), "workflows/");
  walk(join(REPO, "apps/backend/engines/comfyui/my_nodes"), "my_nodes/");
  const USER_WF = join(ENGINE_HOME, "user/default/workflows");
  const ENG_MY = join(ENGINE_HOME, "custom_nodes/my-nodes");
  let fail = 0, pass = 0, notes = 0;
  for (const rel of rels.sort()) {
    const src = join(REPO, "apps/backend/engines/comfyui", rel);
    const isWf = rel.startsWith("workflows/");
    const isTest = rel.startsWith("my_nodes/tests/");
    if (isTest) continue; // tests 只住仓库+跑 pytest,打包白名单排除(electron-builder !tests/**),两路皆豁免
    const sMd5 = md5(src);
    const legs = [["装机", join(APP_RES, rel)]];
    if (isWf) legs.push(["用户区", join(USER_WF, rel.slice("workflows/".length))]);
    else legs.push(["引擎家", join(ENG_MY, rel.slice("my_nodes/".length))]);
    for (const [label, dst] of legs) {
      if (!statOk(dst)) { isWf && label === "用户区" ? (notes++, log(`NOTE ${rel} — 用户区无副本(零回灌基线,非漏)`)) : (fail++, bad(`audit ${label}缺件`, rel)); continue; }
      md5(dst) === sMd5 ? pass++ : (fail++, bad(`audit ${label}漂移`, rel));
    }
  }
  log(`═══ 审计结论: ${fail ? "FAIL(" + fail + ")" : "ALL PASS"} — 对齐 ${pass} 路,NOTE ${notes} 条 ${fail ? "" : "(三副本零漂移)"}`);
  process.exit(fail ? 1 : 0);
}
function statOk(p) { try { statSync(p); return true; } catch { return false; } }
const targetsFor = (type, rel) => {
  const tail = rel.split("engines/comfyui/")[1] || rel;
  const t = [[REPO + "/" + rel, "仓库"]];
  if (type === "py" || type === "subgraph" || type === "js") {
    t.push([`${APP_RES}/${tail}`, "装机Resources"]);
    t.push([`${ENGINE_HOME}/custom_nodes/my-nodes/${tail.split("my_nodes/")[1]}`, "引擎家custom_nodes"]);
  } else {
    t.push([`${APP_RES}/${tail}`, "装机Resources"]);
    t.push([`${ENGINE_HOME}/user/default/workflows/${tail.split("workflows/")[1]}`, "引擎缓存"]);
  }
  return t;
};

function enginePort() {
  // lsof COMMAND 列只显二进制名不显脚本路径,先 ps 拿 main.py pid 再 lsof -p 取监听口
  const pid = sh(`ps aux | grep '[C]omfyUI/main.py' | awk '{print $2}' | head -1`).trim();
  if (!pid) return null;
  const m = sh(`lsof -nP -a -iTCP -sTCP:LISTEN -p ${pid} 2>/dev/null`).match(/127\.0\.0\.1:(17\d{3})/);
  return m ? m[1] : null;
}
async function waitEngine(timeoutMs = 180000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const p = enginePort();
    if (p) {
      try { await (await fetch(`http://127.0.0.1:${p}/system_stats`, { signal: AbortSignal.timeout(3000) })).json(); return p; } catch {}
    }
    await new Promise((r) => setTimeout(r, 5000));
  }
  return null;
}
async function restartEngine() {
  const sid = sh(`ps aux | grep '[i]mage_gen.main' | awk '{print $2}' | head -1`).trim();
  if (!sid) { bad("引擎重启", "未找到 image_gen 侧车进程"); return null; }
  const sport = (sh(`lsof -nP -a -iTCP -sTCP:LISTEN -p ${sid} 2>/dev/null`).match(/127\.0\.0\.1:(17\d{3})/) || [])[1];
  const tok = sh(`ps eww ${sid} 2>/dev/null | tr ' ' '\\n' | grep '^MANYING_LOCAL_IMAGE_TOKEN=' | head -1 | cut -d= -f2`).trim();
  if (!sport || !tok) { bad("引擎重启", "侧车口/令牌未取得"); return null; }
  const old = enginePort();
  if (old) execSync(`kill ${sh(`lsof -nP -iTCP:${old} -sTCP:LISTEN -t`).trim()} 2>/dev/null || true`);
  const r = await (await fetch(`http://127.0.0.1:${sport}/comfy/engine/start`, {
    method: "POST", headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" }, body: "{}",
  })).json().catch(() => ({}));
  if (!r.jobId) { bad("引擎重启", "engine/start 无 jobId: " + JSON.stringify(r).slice(0, 80)); return null; }
  const p = await waitEngine();
  p ? ok("引擎重启", `port=${p}(jobId=${r.jobId})`) : bad("引擎重启", "健康等待超时");
  return p;
}
async function cdpWebview() {
  for (const port of [9225, 9226, 9227, 9228, 9223, 9224, 9229, 9230, 9231]) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(1500) })).json();
      const wv = list.find((t) => t.type === "webview" && t.webSocketDebuggerUrl);
      if (wv) return { port, url: wv.webSocketDebuggerUrl };
    } catch {}
  }
  return null;
}
function cdpEval(wsUrl, expression, timeoutMs = 20000) {
  return new Promise((res) => {
    const ws = new WebSocket(wsUrl);
    let id = 0; const pending = new Map();
    const timer = setTimeout(() => { try { ws.close(); } catch {} res({ __err: "cdp-timeout" }); }, timeoutMs);
    ws.addEventListener("message", (e) => { const m = JSON.parse(String(e.data)); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); } });
    ws.addEventListener("open", async () => {
      await send("Runtime.enable");
      const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
      clearTimeout(timer);
      res(r?.result?.value ?? { __err: r?.exceptionDetails?.exception?.description?.slice(0, 120) });
      try { ws.close(); } catch {}
    });
    ws.addEventListener("error", () => { clearTimeout(timer); res({ __err: "ws-error" }); });
    function send(method, params = {}) { return new Promise((res2) => { const mid = ++id; pending.set(mid, res2); ws.send(JSON.stringify({ id: mid, method, params })); }); }
  });
}

async function verifyJsonLive(file) {
  const cdp = await cdpWebview();
  if (!cdp) return { live: "no-cdp(无法活机对账)", note: "App 未带调试口——须 --args --remote-debugging-port=9225 重开" };
  const doc = JSON.parse(readFileSync(file, "utf8"));
  const sgName = "提示词类型优化";
  const wfRel = file.includes("/workflows/");
  const expr = `(async () => {
    const root = window.app.graph;
    if (!root) return { err: "no-root" };
    const sgs = (root.serialize()?.definitions?.subgraphs) || (window.app.subgraphs || []);
    const sg = sgs.find(s => String(s.name || "").includes("${sgName}"));
    if (!sg) return { err: "no-sg(画布未载此工作流)" };
    const inner = window.app.canvas.graph && window.app.canvas.graph !== root ? window.app.canvas.graph : null;
    const n14 = (inner || { _nodes: sg.nodes })._nodes ? (inner._nodes.find(n => String(n.id) === "4014") || null) : null;
    return {
      defOutputs: sg.outputs.map(o => o.name + ":" + o.pos[0] + "," + o.pos[1]),
      innerOutputs: inner && inner.outputs ? inner.outputs.map(o => o.name + ":" + o.pos[0] + "," + o.pos[1]) : null,
      n14: n14 ? [Math.round(n14.pos[0]), Math.round(n14.size[0])] : null,
      workflow: window.app.session?.activeWorkflow?.path || "(未知)"
    };
  })()`;
  const live = await cdpEval(cdp.url, expr);
  return { live, doc, wfRel };
}
function compareJson(doc, live) {
  if (live.err) return bad("JSON 活机读数", live.err + (live.note ?? ""));
  const sg = (doc.definitions.subgraphs || []).find((s) => String(s.name || "").includes("提示词类型优化"));
  const fileOut = sg.outputs.map((o) => o.name + ":" + o.pos[0] + "," + o.pos[1]).sort().join(" | ");
  const liveDef = (live.defOutputs || []).slice().sort().join(" | ");
  const liveInner = (live.innerOutputs || []).slice().sort().join(" | ");
  ok(`JSON 定义层活机`, liveDef);
  if (liveDef !== fileOut) bad("JSON 定义层=盘上文件", `live[${liveDef}] ≠ file[${fileOut}]`);
  else if (live.innerOutputs) {
    if (liveInner !== fileOut) bad("JSON 渲染源(内层实例)=盘上文件", `inner[${liveInner}] ≠ file[${fileOut}](实例缓存旧值,须就地赋值)`);
    else ok("JSON 渲染源(内层实例)=盘上文件", liveInner);
  } else log("NOTE  不在内层视图,渲染源未验(仅定义层)");
}

async function main() {
  if (OPTS.has("--audit")) return auditAll();
  if (!args.length) { console.error("用法: node canvas_deploy.mjs <文件...> [--verify-only] [--no-restart] | --audit"); process.exit(2); }
  const jobs = [];
  for (const a of args) {
    const abs = resolve(a);
    const c = classify(abs);
    if (!c) { bad("类型判定", `${a}: 无法归类(py/js/subgraphs json/workflows json 四类之外)`); continue; }
    jobs.push({ ...c, abs });
  }
  let engine = enginePort();
  for (const j of jobs) {
    log(`──── ${j.type} ${basename(j.rel)} ────`);
    const tgt = targetsFor(j.type, j.rel);
    if (!OPTS.has("--verify-only")) {
      let cpOk = true;
      for (const [dst, label] of tgt.slice(1)) {
        try { copyFileSync(j.abs, dst); } catch (e) { bad(`cp→${label}`, String(e).slice(0, 80)); cpOk = false; }
      }
      cpOk ? ok(`cp 热覆盖`, `${tgt.length - 1} 路(含${tgt[1][1]})`) : null;
    } else log("SKIP 部署(--verify-only)");
    if (j.type === "workflow" || j.type === "subgraph") {
      try {
        const { live, doc } = await verifyJsonLive(j.abs);
        compareJson(doc, live);
      } catch (e) { bad("JSON 活机对账", String(e).slice(0, 120)); }
    }
    if (j.type === "js") {
      const p = enginePort() || 17001;
      // 扩展 URL 规则:WEB_DIRECTORY(web/)内容平铺进 /extensions/<节点目录>/,URL 无 web/ 段——从注册表按文件名反查,不猜路径
      const reg = await fetch(`http://127.0.0.1:${p}/extensions`).then((r) => r.json()).catch(() => null);
      const url = Array.isArray(reg) ? reg.find((u) => u.endsWith("/" + basename(j.rel))) : null;
      const served = url ? await fetch(`http://127.0.0.1:${p}${url}`).then((r) => r.text()).catch(() => null) : null;
      served && served === readFileSync(j.abs, "utf8") ? ok("引擎吐出的 JS=仓库版", url) : bad("引擎吐出的 JS=仓库版", url ? "不一致(引擎未载新文件?)" : "扩展注册表无此文件(引擎未装载?)");
    }
    if (j.type === "py") {
      if (!OPTS.has("--verify-only") && !OPTS.has("--no-restart")) engine = (await restartEngine()) || engine;
      const classes = [...readFileSync(j.abs, "utf8").matchAll(/^class (\w+)/gm)].map((m) => m[1]);
      const p = engine || 17001;
      for (const cls of classes) {
        const r = await fetch(`http://127.0.0.1:${p}/object_info/${cls}`).then((r) => r.json()).catch(() => null);
        r && r[cls] ? ok(`object_info 注册`, cls) : bad(`object_info 注册`, cls + " 缺席(引擎未载新 .py?)");
      }
    }
  }
  if (engine === null) engine = enginePort();
  log(`═══ 结论: ${FAILS.length ? "FAIL(" + FAILS.length + ")" : "ALL PASS"} ${FAILS.join("; ")}`);
  process.exit(FAILS.length ? 1 : 0);
}
main();
