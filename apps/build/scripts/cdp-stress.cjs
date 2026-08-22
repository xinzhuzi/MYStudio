// 模拟真实交互:反复进入/退出图片工作流,观察堆是否单边上涨
const http = require('http');
const path = require('path');
const WebSocket = require(path.join(__dirname, '../../node_modules/ws'));
function getJson(p){return new Promise((res,rej)=>{http.get({host:'127.0.0.1',port:9222,path:p},(r)=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>res(JSON.parse(d)));}).on('error',rej);});}

(async()=>{
  const list=await getJson('/json/list');
  const page=list.find(t=>t.type==='page');
  if(!page){console.log('NO_PAGE');process.exit(1);}
  const ws=new WebSocket(page.webSocketDebuggerUrl,{maxPayload:1024*1024*1024});
  let id=0;const pending=new Map();
  ws.on('message',(d)=>{const m=JSON.parse(d);if(m.id&&pending.has(m.id)){pending.get(m.id)(m);pending.delete(m.id);}});
  const send=(m2,p={})=>new Promise((res)=>{const mid=++id;pending.set(mid,res);ws.send(JSON.stringify({id:mid,method:m2,params:p}));});
  await new Promise(r=>ws.on('open',r));
  const heap=()=>send('Runtime.evaluate',{expression:'performance.memory.usedJSHeapSize',returnByValue:true}).then(r=>Math.round(r.result.result.value/1024/1024));
  const evalJs=(expr)=>send('Runtime.evaluate',{expression:expr,returnByValue:true,awaitPromise:true}).then(r=>r.result.result&&r.result.result.value);

  console.log('起始堆:',await heap(),'MB');
  // 探:当前是否能导航到工作流(点「返回」或找入口)
  const nav=await evalJs(`(function(){
    const back=document.querySelector('button[aria-label="返回"], button:has(svg)');
    const allBtns=[...document.querySelectorAll('button')].map(b=>b.textContent.trim().slice(0,12));
    return JSON.stringify({btns:allBtns.slice(0,15), url:location.hash||location.pathname});
  })()`);
  console.log('页面按钮:', nav);

  // 用键盘 Escape + 反复触发 React 状态更新的方式压测
  // 核心:模拟 store 反复 upsert imageWorkflows(真实使用里反复进工作流/生图会触发)
  for(let round=1;round<=8;round++){
    await evalJs(`(async function(){
      // 触发 store 订阅风暴:反复读写 zustand
      const store = window.__ZUSTAND_STUDIO__ || null;
      // 没有暴露就退化为反复 dispatch resize+滚动
      for(let i=0;i<10;i++){ window.dispatchEvent(new Event('resize')); await new Promise(r=>setTimeout(r,20)); }
      return true;
    })()`);
    if(round%2===0) console.log(`第${round}轮后堆:`,await heap(),'MB');
  }
  console.log('压测结束堆:',await heap(),'MB');
  ws.close();process.exit(0);
})().catch(e=>{console.log('ERR',e.message);process.exit(1);});
