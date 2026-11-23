/** Default inert. --bundle is offline; root alone invokes native --boot/--generate. */
import fs from 'node:fs';
import path from 'node:path';
import { builtinModules, createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { executionTransportBoundary } from './director_chapter001_media_execution_1027.bundle.mjs';
import { demand, readArtifact, sha } from './director_chapter001_media_execution_1027.policy.mjs';
const entry=fileURLToPath(import.meta.url),repo=path.resolve(path.dirname(entry),'../../..');
const requireFromApps=createRequire(path.join(repo,'apps/package.json'));
const research=path.join(repo,'.trellis/tasks/10-25-daojie-director-rule-conflict-validation/research');
if(process.versions.electron) {
  demand(process.argv[2]==='--child' && process.argv.length===4,'Owned child required');
  const folder=fs.realpathSync(process.argv[3]);
  demand(path.dirname(folder)===fs.realpathSync(research) && (/^chapter001-media-(execution-|hardening-1027-)/).test(path.basename(folder)),'Child scope mismatch');
  const pins=JSON.parse(fs.readFileSync(path.join(folder,'source-evidence.json'),'utf8'));
  for(const source of pins.sources) demand(sha(fs.readFileSync(path.join(repo,source.path)))===source.sha256,'Source changed before child boot');
  for(const pin of pins.externalPins) demand(sha(fs.readFileSync(pin.file))===pin.sha256,'External dependency changed before child boot');
  demand(sha(fs.readFileSync(path.join(folder,'main.cjs')))===pins.mainSha256&&sha(fs.readFileSync(path.join(folder,'renderer.js')))===pins.rendererSha256,'Bundle changed before child boot');
  const {boot}=await import(path.join(folder,'main.cjs'));boot(folder,JSON.parse(fs.readFileSync(path.join(folder,'config.json'),'utf8')));
} else {
  const args=process.argv.slice(2),mode=args.shift();
  if(!mode || mode==='--help') process.stdout.write('Usage: --bundle|--boot --out <new research/chapter001-media-execution-* directory>; --generate also requires --accepted <root input JSON> --accepted-sha256 <SHA256>. Default inert. No runtime preparation.\n');
  else {
    demand(['--bundle','--boot','--generate'].includes(mode),'Unknown mode');
    const flags=new Map();
    while(args.length) {const key=args.shift(),value=args.shift();demand(['--out','--accepted','--accepted-sha256'].includes(key) && value && !flags.has(key),'Invalid flags');flags.set(key,value);}
    demand(flags.has('--out'),'New output directory required');
    demand(mode==='--generate' ? flags.has('--accepted')&&flags.has('--accepted-sha256') : flags.size===1,'Explicit accepted artifact/hash required only for generate');
    const folder=path.resolve(flags.get('--out'));
    demand(path.dirname(folder)===fs.realpathSync(research) && (/^chapter001-media-(execution-|hardening-1027-)/).test(path.basename(folder)) && !fs.existsSync(folder),'New canonical output directory required');
    const accepted=mode==='--generate'?{file:flags.get('--accepted'),sha256:flags.get('--accepted-sha256')}:null;
    if(accepted) readArtifact(accepted,research);
    const {build}=await import('vite');
    const sources=new Set([entry,entry.replace('.mjs','.preload.cjs'),path.join(repo,'apps/package.json'),path.join(repo,'apps/pnpm-lock.yaml')]);
    const boundary=executionTransportBoundary(repo),externalPins=new Map();
    const common={configFile:false,root:path.join(repo,'apps'),logLevel:'error',define:{'process.env.NODE_ENV':JSON.stringify('production')},resolve:{alias:{'@':path.join(repo,'apps/frontend'),'@rendering':path.join(repo,'apps/frontend/electron/rendering')}},plugins:[boundary.plugin,{name:'execution-source-receipt',transform(_code,id){const file=id.split('?')[0];if((file.startsWith(path.join(repo,'apps/frontend')+path.sep)||file.startsWith(entry.replace('.mjs','.')))&&fs.existsSync(file))sources.add(file);}}]};
    const bundle=async(suffix,name,format,external=[])=> {
      const result=await build({...common,build:{write:false,minify:false,lib:{entry:entry.replace('.mjs',suffix),name,formats:[format]},rollupOptions:{external,output:{paths:id=>{if(id==='electron'||id.startsWith('node:')||builtinModules.includes(id))return id;const file=requireFromApps.resolve(id);externalPins.set(file,{file,sha256:sha(fs.readFileSync(file))});return file;}}}}});
      const chunks=(Array.isArray(result)?result:[result]).flatMap(item=>item.output).filter(item=>item.type==='chunk');
      demand(chunks.length===1,'Self-contained bundle required');return chunks[0].code;
    };
    const renderer=await bundle('.renderer.ts','Chapter001MediaExecution','iife');
    const packages=Object.keys(JSON.parse(fs.readFileSync(path.join(repo,'apps/package.json'),'utf8')).dependencies);
    const main=await bundle('.main.mjs','Chapter001MediaExecutionMain','cjs',(id,importer)=>!boundary.matches(id,importer)&&(id==='electron'||id.startsWith('node:')||builtinModules.includes(id)||packages.some(pkg=>id===pkg||id.startsWith(pkg+'/'))));
    demand(boundary.count()===1,'Exactly one scoped production image transport boundary required');
    const productionChannels=[];
    for(const file of ['ipc/ai/api-request-ipc.ts','ipc/files/project-file-ipc.ts','ipc/assets/asset-library-ipc.ts']) {
      const content=fs.readFileSync(path.join(repo,'apps/frontend/electron',file),'utf8');
      for(const match of content.matchAll(/ipcMain\.handle\(["']([^"']+)["']/g)) productionChannels.push(match[1]);
    }
    demand(!sources.has(path.join(repo,'apps/frontend/electron/main/main.ts')),'Normal main forbidden');
    fs.mkdirSync(folder);
    const put=(name,value)=>fs.writeFileSync(path.join(folder,name),value,{flag:'wx'});
    put('renderer.js',renderer);put('main.cjs',main);put('preload.cjs',fs.readFileSync(entry.replace('.mjs','.preload.cjs')));
    sources.add(entry.replace('.mjs','.bundle.mjs'));sources.add(entry.replace('.mjs','.policy.mjs'));
    const inventory=[...sources].sort().map(file=>({path:path.relative(repo,file),sha256:sha(fs.readFileSync(file))}));
    put('source-evidence.json',JSON.stringify({sources:inventory,productionSourceOverrides:0,scopedTransportSubstitutions:boundary.count(),redirectMode:'error',externalPins:[...externalPins.values()],normalMainImported:false,rendererSha256:sha(renderer),mainSha256:sha(main)},null,2)+'\n');
    put('config.json',JSON.stringify({mode,accepted,backendRoot:path.join(repo,'apps/backend'),productionChannels},null,2)+'\n');
    for(const pin of externalPins.values()) demand(sha(fs.readFileSync(pin.file))===pin.sha256,'External dependency changed during bundle');
    if(mode!=='--bundle') {
      const env={...process.env,NODE_PATH:path.join(repo,'apps/node_modules')+(process.env.NODE_PATH?path.delimiter+process.env.NODE_PATH:'')};delete env.ELECTRON_RUN_AS_NODE;
      const child=spawn((await import('electron')).default,[entry,'--child',folder],{env,stdio:['ignore','pipe','pipe'],timeout:mode==='--generate'?900000:45000});
      let stdout='',stderr='';child.stdout.on('data',data=>{stdout+=data;process.stdout.write(data);});child.stderr.on('data',data=>{stderr+=data;process.stderr.write(data);});
      const result=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',(code,signal)=>resolve({code,signal,pid:child.pid}));});
      put('subprocess.json',JSON.stringify({...result,stdout,stderr},null,2)+'\n');
      demand(result.code===0 && JSON.parse(fs.readFileSync(path.join(folder,'boot.json'),'utf8')).ok===true,'Native execution failed; inspect task evidence');
    }
    for(const source of inventory) demand(sha(fs.readFileSync(path.join(repo,source.path)))===source.sha256,'Source changed during bundle/execution');
    process.stdout.write(mode==='--bundle'?'Offline production bundles prepared; generation was not executed.\n':'Owned Electron execution completed; inspect boot.json.\n');
  }
}
