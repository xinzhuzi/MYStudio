/**
 * Minimal CDP evaluator for driving the installed app (no playwright dep).
 * Usage: node cdp-eval.cjs "<js-expression>" [--click-selector "<css>"|--click-text "<text>"]
 * Five-event pointer sequence for Radix (memory recipe) when clicking.
 */
const WebSocket = require("ws");
const http = require("node:http");

function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
      });
    }).on("error", reject);
  });
}

async function main() {
  const [, , expression, ...rest] = process.argv;
  const pages = (await getJson("http://127.0.0.1:9222/json")).filter((p) => p.type === "page");
  const page = pages[0];
  if (!page) throw new Error("no page");
  const ws = new WebSocket(page.webSocketDebuggerUrl, { maxPayload: 256 * 1024 * 1024 });
  let id = 0;
  const pending = new Map();
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const msgId = ++id;
    pending.set(msgId, { resolve, reject });
    ws.send(JSON.stringify({ id: msgId, method, params }));
  });
  ws.on("message", (raw) => {
    const msg = JSON.parse(raw.toString());
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
    }
  });
  await new Promise((resolve) => ws.on("open", resolve));
  await send("Runtime.enable");
  await send("Page.enable");

  for (let i = 0; i < rest.length; i += 2) {
    const flag = rest[i];
    const value = rest[i + 1];
    if (flag === "--click-selector" || flag === "--click-text") {
      const clickJs = `(async () => {
        const el = ${flag === "--click-selector" ? `document.querySelector(${JSON.stringify(value)})` : `[...document.querySelectorAll('button,[role=button]')].find((b) => (b.textContent || '').includes(${JSON.stringify(value)}))`};
        if (!el) return 'NOT_FOUND';
        el.scrollIntoView({ block: 'center' });
        const rect = el.getBoundingClientRect();
        const x = rect.left + rect.width / 2, y = rect.top + rect.height / 2;
        const opts = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y, button: 0 };
        el.dispatchEvent(new PointerEvent('pointerover', opts));
        el.dispatchEvent(new PointerEvent('pointerenter', opts));
        el.dispatchEvent(new PointerEvent('pointerdown', opts));
        el.dispatchEvent(new MouseEvent('mousedown', opts));
        el.dispatchEvent(new PointerEvent('pointerup', opts));
        el.dispatchEvent(new MouseEvent('mouseup', opts));
        el.dispatchEvent(new MouseEvent('click', opts));
        return 'CLICKED:' + (el.textContent || '').trim().slice(0, 40);
      })()`;
      const clickResult = await send("Runtime.evaluate", { expression: clickJs, awaitPromise: true, returnByValue: true });
      console.error(clickResult.result.value);
      await new Promise((r) => setTimeout(r, 1200));
    }
  }

  if (expression && expression !== "-") {
    const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) {
      console.error("EXCEPTION:", JSON.stringify(result.exceptionDetails.exception?.description || result.exceptionDetails.text).slice(0, 500));
    } else {
      const value = result.result.value;
      console.log(typeof value === "string" ? value : JSON.stringify(value));
    }
  }
  ws.close();
}

main().catch((e) => { console.error(e.message); process.exit(1); });
