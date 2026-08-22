// 在应用页面里模拟真实操作(切工作流/点生成按钮),观察堆变化
// 用法: node apps/build/scripts/cdp-simulate.cjs
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

  // 探测当前在哪个页面/有什么可点
  const pageInfo=await evalJs(`(function(){
    return JSON.stringify({
      url: location.href.slice(0,60),
      title: document.title,
      hasReactFlow: !!document.querySelector('.react-flow'),
      selectCount: document.querySelectorAll('select').length,
      buttonCount: document.querySelectorAll('button').length,
      workflowSelector: !!document.querySelector('[data-image-workflow-selector]'),
      genButtons: document.querySelectorAll('[data-image-workflow-global-action]').length,
    });
  })()`);
  console.log('页面状态:', pageInfo);

  // 模拟:反复触发 React 重渲染(切工作流如果有多个)
  const workflowCount=await evalJs(`(function(){const s=document.querySelector('[data-image-workflow-selector]');return s?s.options.length:0})()`);
  console.log('工作流数量:', workflowCount);

  // 如果有多个工作流,快速来回切换 N 轮
  if(workflowCount>1){
    for(let round=0;round<5;round++){
      for(let i=0;i<workflowCount;i++){
        await evalJs(`(function(){
          const s=document.querySelector('[data-image-workflow-selector]');
          if(!s) return false;
          s.selectedIndex=${i};
          s.dispatchEvent(new Event('change',{bubbles:true}));
          return true;
        })()`);
        await new Promise(r=>setTimeout(r,300));
      }
      console.log(`切换第${round+1}轮后堆:`,await heap(),'MB');
    }
  } else {
    console.log('工作流≤1,改模拟反复 setState:强制触发 React 重渲染');
    // 反复 resize 窗口触发重渲染
    for(let i=0;i<20;i++){
      await evalJs('window.dispatchEvent(new Event("resize"));1');
      await new Promise(r=>setTimeout(r,100));
    }
    console.log('20次resize后堆:',await heap(),'MB');
  }

  console.log('最终堆:',await heap(),'MB');
  ws.close();process.exit(0);
})().catch(e=>{console.log('ERR',e.message);process.exit(1);});
