#!/usr/bin/env node
/**
 * 画布读取路径只读探针(1007晚二场立,七犯防再犯工具)
 *
 * 用途:用户重开画布后第一动作跑本探针,一次读全五层,定谳「屏幕此刻从哪层读到什么」:
 *   A 激活工作流(activeWorkflow.path)  B 子图定义 outputs  C 子图实例 outputs(按id缓存,
 *   loadGraphData 不重建)  D 画布视图 canvas.graph.outputs(=屏上渲染源,交付判定只认这个)
 *   E localStorage 草稿(Comfy.Workflow.Draft.v2,恢复优先级高于盘上文件)
 *
 * 纯只读零写入零重载——不推 loadGraphData、不 reload、不杀进程。
 *
 * 用法:node apps/build/scripts/canvas-readpath-probe.mjs [子图名关键词,默认"提示词类型优化"] [CDP口,默认9225]
 * 注:webview target 不在 /json/list 时走主窗 webview.executeJavaScript 通道(两路自适应)。
 */
const KEYWORD = process.argv[2] || "提示词类型优化";
const CDP = Number(process.argv[3] || 9225);
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a.map((x) => (x && typeof x === "object") ? JSON.stringify(x) : x));

async function main() {
  const list = await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json();
  const wvT = list.find((t) => t.type === "webview" && t.webSocketDebuggerUrl);
  const page = list.find((t) => t.type === "page" && !/127\.0\.0\.1/.test(t.url || ""));
  const target = wvT || page;
  if (!target) throw new Error(`CDP ${CDP} 无可用 target(webview/主窗均缺)`);

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener("open", res, { once: true }); ws.addEventListener("error", rej, { once: true }); });
  let id = 0; const pending = new Map();
  ws.addEventListener("message", (ev) => {
    const m = JSON.parse(String(ev.data));
    if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result); }
  });
  const send = (method, params = {}) => new Promise((res, rej) => {
    const mid = ++id; pending.set(mid, { res, rej }); ws.send(JSON.stringify({ id: mid, method, params }));
  });
  await send("Runtime.enable");
  const ev = async (expression) => {
    const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) return { __err: r.exceptionDetails.exception?.description?.slice(0, 300) };
    return r.result.value;
  };
  // 直连 webview 用 ev,否则经主窗桥;两路都必须把箭头函数体包成 IIFE 再注入
  const run = wvT ? (code) => ev(`(${code})()`) : (code) => ev(`(async () => { const w = document.querySelector('webview'); if (!w) return { __note: '主窗无 webview 元素(画布是独立 view 或已关)' };
    try { return await w.executeJavaScript(${JSON.stringify("((" + code + ")())")}, false); } catch (e) { return { __err: String(e).slice(0,300) }; } })()`);
  const K = JSON.stringify(KEYWORD);

  log("通道:", wvT ? "webview直连" : "主窗桥接", "| 关键词:", KEYWORD);
  log("A·激活工作流:", await run(`() => { const app = window.comfyAPI?.app?.app ?? window.app;
    return { path: app?.activeWorkflow?.path, name: app?.activeWorkflow?.name }; }`));
  log("B·定义outputs:", await run(`() => { const app = window.comfyAPI?.app?.app ?? window.app;
    const defs = app?.graph?.definitions?.subgraphs || [];
    const asm = defs.find(s => String(s.name).includes(${K}));
    if (!asm) return { found: false, names: defs.map(s => s.name) };
    return { found: true, outs: (asm.outputs || []).map(o => ({ n: o.name, p: o.pos })) }; }`));
  log("C·实例outputs:", await run(`() => { const app = window.comfyAPI?.app?.app ?? window.app;
    const root = app?.graph; if (!root) return { root: false };
    const asm = (root.definitions?.subgraphs || []).find(s => String(s.name).includes(${K}));
    if (!asm) return { asm: false };
    const host = (root.nodes || []).find(n => String(n.type) === String(asm.id));
    if (!host) return { host: false };
    return { outs: (host.subgraph?.outputs || []).map(o => ({ n: o.name, p: o.pos })) }; }`));
  log("D·画布视图(渲染源):", await run(`() => { const app = window.comfyAPI?.app?.app ?? window.app;
    const cg = app?.canvas?.graph;
    return { name: cg?.name, isRoot: cg === app?.graph, outs: (cg?.outputs || []).map(o => ({ n: o.name, p: o.pos })) }; }`));
  log("E·草稿localStorage:", await run(`() => { const ks = Object.keys(localStorage).filter(k => k.startsWith('Comfy.Workflow.Draft'));
    if (!ks.length) return { drafts: 0 };
    return ks.map(k => { const raw = localStorage.getItem(k); let d = null, obj = null;
      try { d = JSON.parse(raw); } catch {}
      if (d && typeof d.data === 'string') { try { obj = JSON.parse(d.data); } catch {} }
      const t = obj ?? d ?? {}; const asm = (t.definitions?.subgraphs || []).find(s => String(s.name).includes(${K}));
      return { key: k, dataIsString: d ? typeof d.data === 'string' : null, wf: t.name,
        outs: asm ? (asm.outputs || []).map(o => ({ n: o.name, p: o.pos })) : '无该子图' }; }); }`));

  ws.close();
}
main().catch((e) => { console.error("探针失败:", e.message); process.exit(1); });
