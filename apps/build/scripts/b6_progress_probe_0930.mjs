#!/usr/bin/env node
/** B6 并发运行高亮探针(0930,jsdom 仿真——本轮零引擎约束,引擎实弹延期):
 *  装载真 node-progress-highlight.js + 真 theme.js(/scripts/* 两导入重定向到
 *  jsdom 桩,余零改),事件→描边状态机全场景断言:单节点/并发/完成褪色/
 *  未知 node_id 容错/status 清零兜底/error+interrupt 清扫/数字-字符串 id 归一/
 *  setup 重入闩/内置 strokeStyles 键零碰撞/AGPL 头逐字节/零道劫词。 */
import { JSDOM } from "jsdom";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB = join(HERE, "../../backend/engines/comfyui/my_nodes/web");
const EXT = join(WEB, "node-progress-highlight.js");
const THEME_PATH = join(WEB, "theme.js");
const SIBLING = join(WEB, "daojie-subgraph-autofit.js");
// 引擎真前端包核出的内置 strokeStyles 键(settingStore 包构造器+setupStrokeStyles
// +GraphView 工具箱);本件键须与之零碰撞。
const BUILTIN_KEYS = ["error", "selected", "running", "dragOver", "executionError", "outputNode"];

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/" });
globalThis.window = dom.window;
globalThis.document = dom.window.document;

let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? " — " + extra : ""}`); }
};

const tmp = await mkdtemp(join(tmpdir(), "b6-progress-probe-"));
try {
  // ── 桩:/scripts/app.js + /scripts/api.js(api=真 EventTarget+CustomEvent,
  //    事件面同引擎 api 类 dispatchCustomEvent) ──────────────────────────
  const stubApp = join(tmp, "stub-app.mjs");
  const stubApi = join(tmp, "stub-api.mjs");
  await writeFile(stubApp, `export const app = {
  __registry: [],
  registerExtension(ext) { this.__registry.push(ext); },
  canvas: { __dirty: 0, setDirty() { this.__dirty++; } },
  graph: { _nodes: [] },
};
`);
  await writeFile(stubApi, `export const api = new window.EventTarget();
`);
  const appUrl = pathToFileURL(stubApp).href;
  const apiUrl = pathToFileURL(stubApi).href;

  // ── 重定向装载:仅替换 /scripts/* 两导入(与 ./theme.js 指向真件代理),余零改 ──
  const proxyTheme = join(tmp, "theme.proxy.mjs");
  const proxyExt = join(tmp, "ext.proxy.mjs");
  const themeSrc = await readFile(THEME_PATH, "utf8");
  // theme.js 除 /scripts/* 外还有相对导入(./bridge-action.js,自身零导入)——
  // 相对导入一律重指真 web 件绝对 URL,装载内容仍是原文件零改写。
  const reroute = (src) => src
    .replace('from "/scripts/app.js"', `from ${JSON.stringify(appUrl)}`)
    .replace('from "/scripts/api.js"', `from ${JSON.stringify(apiUrl)}`)
    .replace(/from "(\.\/[^"]+)"/g, (_, rel) => `from ${JSON.stringify(pathToFileURL(join(WEB, rel.slice(2))).href)}`);
  await writeFile(proxyTheme, reroute(themeSrc));
  const extSrc = await readFile(EXT, "utf8");
  await writeFile(proxyExt, extSrc
    .replace('from "/scripts/app.js"', `from ${JSON.stringify(appUrl)}`)
    .replace('from "/scripts/api.js"', `from ${JSON.stringify(apiUrl)}`)
    .replace('from "./theme.js"', `from ${JSON.stringify(pathToFileURL(proxyTheme).href)}`));

  // ── 静态门:AGPL 头逐字节 / 零道劫词 ─────────────────────────────────
  console.log("[静态门]");
  const headerOf = async (p) => (await readFile(p, "utf8")).split("\n").slice(0, 3).join("\n") + "\n";
  ok("AGPL 头与兄弟件逐字节一致", (await headerOf(EXT)) === (await headerOf(SIBLING)));
  ok("新件零道劫词", !extSrc.includes("道劫"));
  ok("theme.js 零道劫词(含本批追加 token 块)", !themeSrc.includes("道劫"));

  // ── 装载(先 jsdom 全局后动态 import,顺序保证桩构造时 window 就位) ──
  const { app } = await import(stubApp);
  const { api } = await import(stubApi);
  await import(proxyExt);
  const { THEME, PROGRESS_HIGHLIGHT_TOKENS } = await import(proxyTheme);
  const ext = app.__registry.find((e) => e.name === "my.progress.highlight");
  ok("扩展已注册(名 my.progress.highlight)", !!ext, `registry=${app.__registry.map(e => e.name).join(",")}`);

  // ── 监听注册面:一次性注册断言(包一层计数器) ────────────────────────
  const registered = {};
  const origAdd = api.addEventListener.bind(api);
  api.addEventListener = (type, fn, opts) => { registered[type] = (registered[type] ?? 0) + 1; return origAdd(type, fn, opts); };
  const fire = (type, detail) => api.dispatchEvent(new dom.window.CustomEvent(type, { detail }));

  // 节点:7=setup 前已在图上(清扫路);42/55/207=nodeCreated 路;id 混数字/字符串。
  // strokeStyles 起始面=真前端包核出的六个内置键(构造器+setupStrokeStyles+工具箱)。
  const mkNode = (id) => ({ id, strokeStyles: Object.fromEntries(BUILTIN_KEYS.map((k) => [k, null])) });
  const n7 = mkNode(7), n42 = mkNode(42), n55 = mkNode("55"), n207 = mkNode(207), n90 = mkNode(90);
  app.graph._nodes.push(n7);

  ext.setup(app);
  const expectOnce = ["executing", "progress", "executed", "status", "execution_error", "execution_interrupted"];
  for (const t of expectOnce) ok(`setup 注册 ${t} 监听恰一次`, registered[t] === 1, `实际=${registered[t] ?? 0}`);

  const styleOf = (n) => n.strokeStyles.myProgress;
  for (const n of [n42, n55, n207, n90]) ext.nodeCreated(n);
  const fnAfterFirst = styleOf(n42);
  ext.nodeCreated(n42); // 双路幂等:重复 nodeCreated 不换函数不叠层
  ok("nodeCreated 挂 myProgress 函数式槽", [n42, n55, n207, n90].every((n) => typeof styleOf(n) === "function"));
  ok("setup 清扫路(setup 前在图节点)同挂", typeof styleOf(n7) === "function");
  ok("重复 nodeCreated 幂等(函数引用不变)", styleOf(n42) === fnAfterFirst && Object.keys(n42.strokeStyles).filter((k) => k === "myProgress").length === 1);
  ok("键与内置 strokeStyles 键零碰撞(只增一键,内置槽原样)", !BUILTIN_KEYS.includes("myProgress")
    && [n42, n55, n207, n90, n7].every((n) => BUILTIN_KEYS.every((k) => k in n.strokeStyles && n.strokeStyles[k] === null)
      && Object.keys(n.strokeStyles).length === BUILTIN_KEYS.length + 1));

  const lit = (n) => styleOf(n)?.call(n);
  const dirty = () => app.canvas.__dirty;

  // ── 场景 1:单节点 executing 高亮 ────────────────────────────────────
  console.log("[单节点]");
  const d0 = dirty();
  fire("executing", "42"); // 事件口径恒字符串;节点 id 数字 → 归一命中
  ok("executing 后节点 42 出描边样式", lit(n42)?.color === THEME.pending && lit(n42)?.lineWidth === PROGRESS_HIGHLIGHT_TOKENS.lineWidth, JSON.stringify(lit(n42)));
  ok("描边色值=THEME.pending(#fbbf24,真 theme.js 单源)", THEME.pending === "#fbbf24");
  ok("描边宽=token lineWidth=3", PROGRESS_HIGHLIGHT_TOKENS.lineWidth === 3);
  ok("未提及节点 55 无描边", lit(n55) === undefined);
  ok("画布 setDirty 被触发", dirty() > d0, `dirty ${d0}→${dirty()}`);

  // ── 场景 2:并发多节点同时高亮 ───────────────────────────────────────
  console.log("[并发]");
  fire("executing", "55");
  fire("progress", { value: 3, max: 20, prompt_id: "p1", node: "207" }); // real-id 路
  ok("并发三节点同亮(42 executing / 55 executing / 207 progress)", [n42, n55, n207].every((n) => lit(n) !== undefined));

  // ── 场景 3:完成即褪(display 键与 real 键两路) ─────────────────────
  console.log("[完成褪色]");
  fire("executed", { node: "42", display_node: "42", prompt_id: "p1" });
  ok("executed 后 42 即褪", lit(n42) === undefined);
  ok("其余并发节点仍在亮", lit(n55) !== undefined && lit(n207) !== undefined);
  fire("executing", "90");
  fire("executed", { node: "207", display_node: "90", prompt_id: "p1" }); // display≠real:两键同清
  ok("executed 双键(display_node+node)同清即褪", lit(n90) === undefined && lit(n207) === undefined);

  // ── 场景 4:未知 node_id 容错 ────────────────────────────────────────
  console.log("[未知 node_id]");
  let threw = false;
  try { fire("executing", "999"); fire("executed", { node: "999", display_node: "999", prompt_id: "p1" }); fire("executing", null); fire("executing"); } catch { threw = true; }
  ok("未知 id/null/缺 detail 全容错零抛", !threw);
  ok("容错事件不影响在亮节点", lit(n55) !== undefined);

  // ── 场景 5:status 清零兜底 + 非 null detail 不误清 ──────────────────
  console.log("[status 兜底]");
  fire("status", null);
  ok("status null(连接波动)不误清", lit(n55) !== undefined);
  fire("status", { exec_info: { queue_remaining: 1 } });
  ok("queue_remaining>0 不清(还有活)", lit(n55) !== undefined);
  fire("status", { exec_info: { queue_remaining: 0 } });
  ok("queue_remaining=0(引擎全闲)兜底清扫", lit(n55) === undefined);

  // ── 场景 6:error/interrupt 清扫 ─────────────────────────────────────
  console.log("[中断清扫]");
  fire("executing", "42");
  fire("execution_error", { node_id: "42", prompt_id: "p2" });
  ok("execution_error 后描边不滞留", lit(n42) === undefined);
  fire("executing", "42");
  fire("execution_interrupted", { prompt_id: "p3" });
  ok("execution_interrupted 后描边不滞留", lit(n42) === undefined);

  // ── 场景 7:setup 重入闩(监听零重复注册) ───────────────────────────
  console.log("[重入闩]");
  const before = { ...registered };
  ext.setup(app);
  ext.setup(app);
  ok("二次 setup 零新增监听", expectOnce.every((t) => registered[t] === before[t]), JSON.stringify({ before, now: registered }));
  fire("executing", "42");
  ok("单事件单触发(闩后行为不变)", lit(n42) !== undefined);
  fire("status", { exec_info: { queue_remaining: 0 } });

  console.log(`\nB6 探针结果: ${pass} 通过 / ${fail} 失败`);
  if (fail > 0) process.exitCode = 1;
} finally {
  await rm(tmp, { recursive: true, force: true });
}
