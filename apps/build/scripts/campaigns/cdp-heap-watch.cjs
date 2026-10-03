// 用法: node apps/build/scripts/cdp-heap-watch.cjs [秒数]
// 前提: MYSTUDIO_REMOTE_DEBUG=1 启动的漫影工作室在跑(9222 端口)
const http = require('http');
const path = require('path');
const WebSocket = require(path.join(__dirname, '../../node_modules/ws'));

function getJson(p) {
  return new Promise((res, rej) => {
    http.get({ host: '127.0.0.1', port: 9222, path: p }, (r) => {
      let d = ''; r.on('data', c => d += c); r.on('end', () => res(JSON.parse(d)));
    }).on('error', rej);
  });
}

(async () => {
  const list = await getJson('/json/list');
  const page = list.find(t => t.type === 'page');
  if (!page) { console.log('NO_PAGE'); process.exit(1); }
  const ws = new WebSocket(page.webSocketDebuggerUrl, { maxPayload: 1024*1024*1024 });
  let id = 0; const pending = new Map();
  ws.on('message', (d) => { const m = JSON.parse(d); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
  const send = (method, params={}) => new Promise((res) => { const mid=++id; pending.set(mid,res); ws.send(JSON.stringify({id:mid,method,params})); });
  await new Promise(r => ws.on('open', r));
  const evalJs = (expr) => send('Runtime.evaluate',{expression:expr,returnByValue:true}).then(r=>r.result.result && r.result.result.value);
  const heap = () => evalJs('performance.memory.usedJSHeapSize').then(v=>Math.round(v/1024/1024));
  const imgCount = () => evalJs('document.images.length');
  // 12MB 的 mystudio-freedom store 是当前活动项目持久化态,正常;这里看其增长
  const storeSize = () => evalJs(`(function(){try{const s=localStorage.getItem('mystudio-freedom')||'';return Math.round(s.length/1024);}catch(e){return -1}})()`);
  const secs = Number(process.argv[2] || 120);
  console.log('t(s)\theap(MB)\timgs\tstore(KB)');
  console.log('采样中...请在应用里:多点几次「生成」/「运行生成」+ 切工作流 + 拖拽缩放');
  const t0 = Date.now();
  const iv = setInterval(async () => {
    try {
      const [h, im, ss] = await Promise.all([heap(), imgCount(), storeSize()]);
      console.log(`${((Date.now()-t0)/1000).toFixed(0)}\t${h}\t${im}\t${ss}`);
    } catch(e){ console.log('采样中断:', e.message); }
    if (Date.now()-t0 > secs*1000) { clearInterval(iv); ws.close(); process.exit(0); }
  }, 5000);
})();
