// app_short_conn.mjs — qi21-9xing-livefire 短连封装(本役改造自 /tmp/short_conn_lib.mjs)
// 铁律:即连即断,每次操作一个短连接;ws 操作 ≤15s 超时;口漂移自愈(9222-9240 全扫)。
// attach 优先级:①type==="webview" 直连(ComfyUI 上下文 window.app 直达);
//               ②type==="page" 主窗口(Electron 壳)经 document.querySelector('webview') 桥入。

const PORTS = [9222, 9223, 9224, 9225, 9226, 9227, 9228, 9229, 9230, 9231, 9232, 9233, 9234, 9235, 9236, 9237, 9238, 9239, 9240];

async function fetchTimeout(url, ms = 2000) {
  return fetch(url, { signal: AbortSignal.timeout(ms) });
}

// 扫全部口,返回 [{port, targets}] 只含活口
export async function scanCdp() {
  const alive = [];
  for (const p of PORTS) {
    try {
      const r = await fetchTimeout(`http://127.0.0.1:${p}/json/list`, 1500);
      const list = await r.json();
      if (Array.isArray(list) && list.length) alive.push({ port: p, targets: list });
    } catch { /* 口死,跳过 */ }
  }
  return alive;
}

// 选口与 target:webview 直连 > page 主窗口桥
export function pickTarget(alive) {
  for (const { port, targets } of alive) {
    const wv = targets.find((t) => t.type === "webview" && /qi21|ComfyUI|17000|17001/.test(`${t.title || ""} ${t.url || ""}`));
    if (wv) return { port, target: wv, mode: "webview-direct" };
  }
  for (const { port, targets } of alive) {
    const wv = targets.find((t) => t.type === "webview");
    if (wv) return { port, target: wv, mode: "webview-direct" };
  }
  for (const { port, targets } of alive) {
    const page = targets.find((t) => t.type === "page" && !/127\.0\.0\.1/.test(t.url || ""));
    if (page) return { port, target: page, mode: "page-bridge" };
  }
  return null;
}

// withCDP(fn) — fn 收到 { evalJs },evalJs(expr) 在 ComfyUI(webview)上下文求值,15s 超时。
export async function withCDP(fn) {
  const alive = await scanCdp();
  if (!alive.length) throw new Error("CDP 9222-9240 全部连不上");
  const pick = pickTarget(alive);
  if (!pick) throw new Error("无可用 page/webview target");
  const { port, target, mode } = pick;
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.addEventListener("open", res, { once: true });
    ws.addEventListener("error", rej, { once: true });
    setTimeout(() => rej(new Error("ws open 超时")), 8000);
  });
  let id = 0;
  const pending = new Map();
  ws.addEventListener("message", (ev) => {
    const m = JSON.parse(String(ev.data));
    if (m.id && pending.has(m.id)) {
      const q = pending.get(m.id);
      pending.delete(m.id);
      m.error ? q.rej(new Error(m.error.message)) : q.res(m.result);
    }
  });
  const send = (method, params = {}) => new Promise((res, rej) => {
    const mid = ++id;
    pending.set(mid, { res, rej });
    ws.send(JSON.stringify({ id: mid, method, params }));
    setTimeout(() => { if (pending.has(mid)) { pending.delete(mid); rej(new Error(`CDP 超时: ${method}`)); } }, 15000);
  });
  // webview 直连:上下文即 ComfyUI;page 桥:经 webview.executeJavaScript
  const evalJs = async (expr) => {
    if (mode === "webview-direct") {
      const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
      if (r.exceptionDetails) return "EXC:" + JSON.stringify(r.exceptionDetails).slice(0, 300);
      return r.result?.value ?? null;
    }
    const r = await send("Runtime.evaluate", {
      expression: `(async () => { const wv = document.querySelector('webview'); if (!wv) return null; try { return await wv.executeJavaScript(${JSON.stringify(expr)}, false); } catch (e) { return 'ERR:' + e.message; } })()`,
      returnByValue: true, awaitPromise: true,
    });
    if (r.exceptionDetails) return "EXC:" + JSON.stringify(r.exceptionDetails).slice(0, 300);
    return r.result?.value ?? null;
  };
  try { return await fn({ evalJs, port, mode, targetTitle: target.title }); }
  finally { try { ws.close(); } catch { /* 即断 */ } }
}
