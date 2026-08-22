const http = require('http');
function get(path) {
  return new Promise((res, rej) => {
    http.get({ host: '127.0.0.1', port: 9222, path }, (r) => {
      let d = ''; r.on('data', c => d += c); r.on('end', () => res(d));
    }).on('error', rej);
  });
}
(async () => {
  const list = JSON.parse(await get('/json/list'));
  const page = list.find(t => t.type === 'page');
  if (!page) { console.log('NO_PAGE'); process.exit(1); }
  const WebSocket = require('ws');
  const ws = new WebSocket(page.webSocketDebuggerUrl, { maxPayload: 1024*1024*1024 });
  let id = 0; const pending = new Map();
  ws.on('message', (data) => { const m = JSON.parse(data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
  const send = (method, params={}) => new Promise((resolve) => { const mid=++id; pending.set(mid,resolve); ws.send(JSON.stringify({id:mid,method,params})); });
  await new Promise(r => ws.on('open', r));
  const heap = () => send('Runtime.evaluate',{expression:'performance.memory.usedJSHeapSize',returnByValue:true}).then(r=>r.result.result.value);
  console.log('当前堆:', ((await heap())/1024/1024).toFixed(0)+'MB');
  const probe = await send('Runtime.evaluate', { expression: `(function(){
    const out = {};
    try {
      for (let i=0;i<localStorage.length;i++){
        const k=localStorage.key(i); const v=localStorage.getItem(k);
        const b64=(v.match(/data:image\\/[a-z]+;base64,/g)||[]).length;
        const blob=(v.match(/blob:/g)||[]).length;
        if(b64||blob) out['ls:'+k]={lenMB:(v.length/1024/1024).toFixed(1),base64Count:b64,blobCount:blob};
      }
    } catch(e){ out.lsErr=String(e); }
    const imgs=[...document.images];
    const srcStat={data:0,blob:0,projectFile:0,localImage:0,http:0,other:0};
    for(const im of imgs){
      const s=im.src||'';
      if(s.startsWith('data:'))srcStat.data++;
      else if(s.startsWith('blob:'))srcStat.blob++;
      else if(s.startsWith('project-file:'))srcStat.projectFile++;
      else if(s.startsWith('local-image:'))srcStat.localImage++;
      else if(/^https?:/.test(s))srcStat.http++;
      else srcStat.other++;
    }
    out.imgStat=srcStat; out.imgCount=imgs.length;
    return JSON.stringify(out);
  })()`, returnByValue: true });
  console.log('探针结果:', probe.result.result.value);
  ws.close(); process.exit(0);
})().catch(e=>{console.log('ERR',e.message);process.exit(1);});
