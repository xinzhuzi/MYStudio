// probe_canvas.mjs — 短连探针:读 App 画布现态(只读,零改动)
import { withCDP, scanCdp } from "./app_short_conn.mjs";

const alive = await scanCdp();
console.log("活口:", alive.map((a) => `${a.port}(${a.targets.map((t) => t.type).join(",")})`).join(" "));

const r = await withCDP(async ({ evalJs, port, mode }) => {
  const out = { port, mode };
  out.appReady = await evalJs(`(() => { const a = window.app; return a ? { ready: a.isGraphReady === true, nodes: (a.graph && a.graph._nodes || []).length } : null; })()`);
  // 宿主节点:type 为 uuid 且 title 含「提示词」
  out.hosts = await evalJs(`(() => { return (window.app.graph._nodes || [])
    .filter(n => /^[0-9a-f]{8}-[0-9a-f]{4}/.test(n.type) && (n.title || '').includes('提示词'))
    .map(n => ({ id: String(n.id), type: n.type, title: n.title, widgets: (n.widgets || []).map(w => ({ name: w.name, value: w.value })) })); })()`);
  out.n400 = await evalJs(`(() => { const n = (window.app.graph._nodes || []).find(x => String(x.id) === '400'); if (!n) return null; const w = (n.widgets || []).find(w => w.name === 'value'); return w ? { len: String(w.value).length, head: String(w.value).slice(0, 40) } : 'no-widget'; })()`);
  out.n404 = await evalJs(`(() => { const n = (window.app.graph._nodes || []).find(x => String(x.id) === '404'); if (!n) return null; const w = (n.widgets || []).find(w => w.name === 'value'); return w ? { len: String(w.value).length } : 'no-widget'; })()`);
  out.n401 = await evalJs(`(() => { const n = (window.app.graph._nodes || []).find(x => String(x.id) === '401'); if (!n) return null; const w = (n.widgets || []).find(w => w.__myPreviewDisplay); return w ? { name: w.name, len: String(w.value || '').length, head: String(w.value || '').slice(0, 60).replace(/\\n/g, '|') } : 'no-preview-widget'; })()`);
  out.n7 = await evalJs(`(() => { const n = (window.app.graph._nodes || []).find(x => String(x.id) === '7' || x.type === 'e7b9d4a2-3c5f-4e61-8d70-9f2a5c8b4d6e'); if (!n) return null; const o = {}; for (const w of n.widgets || []) o[w.name] = w.value; return o; })()`);
  out.queuePromptFn = await evalJs(`typeof window.app.queuePrompt === 'function' ? 'fn-ok' : 'missing'`);
  return out;
});
console.log(JSON.stringify(r, null, 1));
