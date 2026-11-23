/** Task-only foreground lifecycle window. Normal production prepare; no engine stop/restart API. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn,execFileSync,type ChildProcess} from 'node:child_process';
import {createInterface} from 'node:readline';
import {createImageGenRuntimeController} from '@/electron/rendering/plugins/image_gen/image-gen-runtime-controller';
const output=process.argv[2];
if(!output) throw new Error('new chapter001 evidence directory required');
const task=path.resolve('../.trellis/tasks/10-25-daojie-director-rule-conflict-validation/research/chapter001-repair-1026');
const folder=path.resolve(output);
if(!folder.startsWith(task+path.sep)||fs.existsSync(folder))throw new Error('new scoped destination required');
const storage=fs.realpathSync(path.join(os.homedir(),'Library/Application Support','漫影工作室'));
const config=JSON.parse(fs.readFileSync(path.join(storage,'python/profiles/image-gen/config.json'),'utf8'));
if(typeof config.controlToken!=='string'||!config.controlToken)throw new Error('existing control token required');
const manifest=JSON.parse(fs.readFileSync(path.join(storage,'comfyui/manifest.json'),'utf8'));
const enginePort=manifest.engine.port;
function pids(port:number){try{return execFileSync('lsof',['-nP',`-iTCP:${port}`,'-sTCP:LISTEN','-Fp'],{encoding:'utf8',timeout:5000}).trim().split('\n').filter(v=>v.startsWith('p')).map(v=>Number(v.slice(1)));}catch(e){if((e as {status?:number}).status===1)return [];throw e;}}
async function get(suffix:string){const r=await fetch(`http://127.0.0.1:${enginePort}${suffix}`,{signal:AbortSignal.timeout(5000)});if(!r.ok)throw new Error(`engine GET ${suffix}: ${r.status}`);return r.json();}
const enginePids=pids(enginePort);
if(enginePids.length!==1||pids(17595).length)throw new Error('one healthy engine and absent sidecar required');
const queue=await get('/queue');if(queue.queue_running.length||queue.queue_pending.length)throw new Error('engine busy');
await get('/system_stats');
const bridge=await get('/my_bridge/config');
if(typeof bridge.bridgeToken==='string'&&bridge.bridgeToken!==config.controlToken)throw new Error('production adoption token mismatch; no startup');
fs.mkdirSync(folder);
const receipt:Record<string,unknown>={startedAt:new Date().toISOString(),enginePort,enginePidsBefore:enginePids,queueBefore:queue,bridgeTokenReturned:typeof bridge.bridgeToken==='string',adoptionTokenMismatch:false,projectWrites:0,engineLifecycleCalls:0,maximumWindowMs:45*60_000};
fs.writeFileSync(path.join(folder,'preflight.json'),JSON.stringify(receipt,null,2),{flag:'wx'});
let owned:ChildProcess|undefined;
const controller=createImageGenRuntimeController({storageBasePath:storage,backendRoot:path.resolve('backend'),modelCacheDir:()=>path.join(storage,'model/imagegen'),spawnProcess:((...args:Parameters<typeof spawn>)=>{if(owned||pids(17595).length)throw new Error('sidecar ownership changed or retry refused');owned=spawn(...args);return owned;}) as typeof spawn});
let stop:()=>void=()=>{};let timer:ReturnType<typeof setTimeout>|undefined;
const end=new Promise<void>(resolve=>{stop=resolve;timer=setTimeout(resolve,45*60_000);});
const lines=createInterface({input:process.stdin});lines.on('line',line=>{if(line==='stop')stop();});
process.once('SIGINT',stop);process.once('SIGTERM',stop);
try{
 const status=await controller.prepareLifecycle();
 if(!status.running||!owned||owned.exitCode!==null)throw new Error('normal prepare failed');
 if(JSON.stringify(pids(enginePort))!==JSON.stringify(enginePids))throw new Error('engine identity changed during sidecar startup');
 fs.writeFileSync(path.join(folder,'ready.json'),JSON.stringify({at:new Date().toISOString(),sidecarPid:owned.pid,enginePids:pids(enginePort),normalPrepare:true,modelCount:status.models.length},null,2),{flag:'wx'});
 console.log(JSON.stringify({ready:true,sidecarPid:owned.pid,enginePids,output:folder}));
 await end;
}finally{
 if(timer)clearTimeout(timer);lines.close();
 // Only signal this exact child. Never controller.stop(), reclaim, engine stop or global process kill.
 if(owned&&owned.exitCode===null){owned.kill('SIGTERM');await new Promise<void>(resolve=>{const t=setTimeout(resolve,15000);owned!.once('close',()=>{clearTimeout(t);resolve();});});}
 const after=pids(enginePort);const cleanup={at:new Date().toISOString(),ownedSidecarPid:owned?.pid,sidecarExitCode:owned?.exitCode,sidecarSignal:owned?.signalCode,enginePidsAfter:after,originalEngineStillListening:JSON.stringify(after)===JSON.stringify(enginePids),onlyOwnedChildSignalled:true,controllerStopCalled:false};
 fs.writeFileSync(path.join(folder,'cleanup.json'),JSON.stringify(cleanup,null,2),{flag:'wx'});console.log(JSON.stringify(cleanup));
}
