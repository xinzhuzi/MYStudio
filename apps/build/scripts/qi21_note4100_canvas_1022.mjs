/** Isolated render verification; never queues generation or changes user canvases. */
import {readFileSync,writeFileSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {homedir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {chromium}=require('/Users/zhengbingjin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root=process.cwd();
const appHome=join(homedir(),'Library/Application Support',readdirSync(join(homedir(),'Library/Application Support')).find(n=>n==='漫影工作室'));
const manifest=JSON.parse(readFileSync(join(appHome,'comfyui/manifest.json'),'utf8'));
const origin=`http://127.0.0.1:${manifest.engine.port}`;
const sourceRoot=process.argv[2] || join(root,'apps/backend/comfyui/workflows');
const file=execFileSync('fd',['-a','^qi21-道劫-t2i.json$',sourceRoot],{encoding:'utf8'}).trim();
const graph=JSON.parse(readFileSync(file,'utf8'));
const cache=join(homedir(),'Library/Caches/ms-playwright');
const executable=join(cache,readdirSync(cache).find(n=>n==='chromium_headless_shell-1243'),'chrome-headless-shell-mac-arm64/chrome-headless-shell');
const report={origin,source:file,liveAppAttached:false,generationSubmitted:false,blockedRequests:[],errors:[]};
const out=join(root,'apps/output/automation/qi21-note4100-layout-render-1022');
const browser=await chromium.launch({headless:true,executablePath:executable});
try {
 const context=await browser.newContext({viewport:{width:2000,height:1450}});
 await context.route('**/*',async route=>{const request=route.request();const url=new URL(request.url());if(request.method()!=='GET'||url.origin!==origin){report.blockedRequests.push({method:request.method(),path:url.pathname});await route.abort();}else await route.continue();});
 const page=await context.newPage();
 page.on('pageerror',e=>report.errors.push(String(e)));
 page.on('console',m=>{if(['warning','error'].includes(m.type()))report.errors.push(m.text().slice(0,500));});
 await page.goto(origin,{waitUntil:'domcontentloaded',timeout:20000});
 await page.waitForFunction(()=>{const app=window.comfyAPI?.app?.app;return app?.positionConversion&&app.committedGraphLoadSequence>0&&!app.configuringGraphLevel;},null,{timeout:25000});
 report.load=await page.evaluate(async graph=>{
  const {app}=await import('/scripts/app.js');
  const result=await app.loadGraphData(graph,true,false,null,{skipAssetScans:true});
  return {result,ids:app.graph.serialize().nodes.map(n=>n.id),body:document.body.innerText.slice(-2000)};
 },graph);
 await page.waitForFunction(()=>window.comfyAPI.app.app.graph.getNodeById(503),null,{timeout:10000});
 report.canvas=await page.evaluate(async()=>{
  const {app}=await import('/scripts/app.js');
  const host=app.graph.getNodeById(6); const subgraph=host.subgraph;
  app.canvas.openSubgraph(subgraph,host);
  await new Promise(resolve=>setTimeout(resolve,700));
  if(app.canvas.graph!==subgraph)throw new Error('Subgraph did not open');
  const nodes=subgraph.serialize().nodes.map(serial=>{const n=subgraph.getNodeById(serial.id);return {id:serial.id,runtimeId:n.id,title:n.title,pos:Array.from(n.pos),size:Array.from(n.size)};});
  const node=nodes.find(n=>n.id===4100);const peers=nodes.filter(n=>n.id!==4100);
  const center=(Math.min(...peers.map(n=>n.pos[0]))+Math.max(...peers.map(n=>n.pos[0]+n.size[0])))/2;
  if(node.size[0]!==1330||node.size[1]!==440||node.pos[1]!==80||Math.abs(node.pos[0]+node.size[0]/2-center)>0.001)throw new Error('Note size or center mismatch');
  const overlaps=peers.filter(n=>node.pos[0]<n.pos[0]+n.size[0]&&n.pos[0]<node.pos[0]+node.size[0]&&node.pos[1]-30<n.pos[1]+n.size[1]&&n.pos[1]-30<node.pos[1]+node.size[1]);
  if(overlaps.length)throw new Error('Rendered node overlap: '+JSON.stringify(overlaps));
  const ds=app.canvas.ds;ds.scale=0.53;ds.offset[0]=60;ds.offset[1]=100;app.canvas.setDirty(true,true);
  app.canvas.draw(true,true);
  await new Promise(resolve=>setTimeout(resolve,400));
  app.canvas.draw(true,true);
  return {node,contentCenter:center,centerDifference:node.pos[0]+node.size[0]/2-center,overlaps,nodes,subgraphId:subgraph.id};
 });
 await page.screenshot({path:out+'.png'});
 report.ok=true;
} catch(e){report.fatal=String(e);process.exitCode=1;}
finally {await browser.close();writeFileSync(out+'.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));}
