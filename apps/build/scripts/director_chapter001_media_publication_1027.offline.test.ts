/** All fixtures are synthetic; no real review, image generation or project writes. */
import { describe, expect, it, afterEach } from 'vitest';
import { mediaPublicationFixture1027, syntheticMediaExecutionReceipt1027 } from './director_chapter001_media_publication_1027.fixtures';
import { freezeChapter001Bridge1027, replayChapter001Bridge1027 } from './director_chapter001_media_publication_1027.test';
import { __resetModuleStorageWriteLockForTests } from '@/lib/storage/storage-project-sharded';
afterEach(async () => { await __resetModuleStorageWriteLockForTests(); });
describe('immutable chapter001 bridge identity', () => {
  it('replays actual production stages with exactly the frozen IDs and timestamps', async () => {
    const f = await mediaPublicationFixture1027();
    const frozen = await freezeChapter001Bridge1027(f.snapshot,f.job,f.options.window.baselineSha256);
    await expect(replayChapter001Bridge1027(f.snapshot,f.job,frozen)).resolves.toEqual(frozen.bridge);
    expect(frozen.entropy.length).toBeGreaterThan(0);
  });
  it('rejects edited frozen state and changed source inputs', async () => {
    const f = await mediaPublicationFixture1027();
    const frozen = await freezeChapter001Bridge1027(f.snapshot,f.job,f.options.window.baselineSha256);
    frozen.bridge.envelope.state.sourceBible = 'tampered';
    await expect(replayChapter001Bridge1027(f.snapshot,f.job,frozen)).rejects.toThrow();
  });
});

import path from 'node:path';
import { createRequire } from 'node:module';
const {PNG}=createRequire(import.meta.url)('pngjs') as {PNG:{sync:{write(image:{width:number;height:number;data:Buffer}):Buffer}}};
import { createHash } from 'node:crypto';
import { chapter001Sha256 as sha } from './director_chapter001_bridge_1026.test';
import { validateChapter001Media1027, type MediaPublicationInput1027, type RendererMedia1027 } from './director_chapter001_media_publication_1027.test';
import { applyChapter001Offline1027, preflightChapter001Offline1027, OfflineApplyFailure1027 } from './director_chapter001_offline_apply_1027.test';
import { createMaterialRecord } from '@/lib/studio/material';
import { storyboardShotSemanticsFingerprint, visualContinuityFingerprint, createHumanVisualReview } from '@/lib/studio/visual-continuity';
import { createStoryboardSliceActions } from '@/stores/studio/storyboard-slice';
import { createRunTaskSliceActions } from '@/stores/studio/run-task-slice';
import { trackSourceFingerprint, storyboardSourceFingerprint } from '@/stores/studio/studio-store-continuity-helpers';
import { createProjectFileUrl } from '@/electron/storage/storage-paths';
const taskResearch=path.resolve(import.meta.dirname,'../../../.trellis/tasks/10-25-daojie-director-rule-conflict-validation/research');
async function syntheticMedia() {
  const f=await mediaPublicationFixture1027();
  const frozen=await freezeChapter001Bridge1027(f.snapshot,f.job,f.options.window.baselineSha256);
  const state=structuredClone(frozen.bridge.envelope.state);
  const actions:Record<string,unknown>={};
  const set=(update:Record<string,unknown>|((s:typeof state)=>Record<string,unknown>))=>Object.assign(state,typeof update==='function'?update(state):update);
  const get=()=>({...state,...actions});
  Object.assign(actions,createRunTaskSliceActions(set as never,get as never),createStoryboardSliceActions(set as never,get as never),{rebuildTracks:()=>undefined});
  const renderer:RendererMedia1027={schema:'chapter001-renderer-media-v1',projectId:f.snapshot.projectId,chapterId:'chapter-001',frozenSha256:'',snapshotSha256:frozen.snapshotSha256,jobSha256:frozen.jobSha256,sourceSha256:f.snapshot.sourceSha256,manifestSha256:f.snapshot.manifestSha256,baselineSha256:frozen.baselineSha256,producer:'runImageWorkflowNodeGeneration/projectFiles.saveImage',envelope:{state,version:f.snapshot.envelope.version},frames:[]};
  const board=state.storyboards.find(item=>item.episodeId==='chapter-001')!;
  const workflowId='synthetic-production-shaped-graph';
  const graph={id:workflowId,name:'Synthetic only',target:{kind:'storyboard' as const,id:board.id},targetSourceFingerprint:board.sourceFingerprint,nodes:[] as typeof state.imageWorkflows[number]['nodes'],edges:[],createdAt:1,updatedAt:1};
  const slots=board.keyframes!.map((slot,index)=>{
    // The byte fixture never reaches disk and is not a real generated image.
    const bytes=PNG.sync.write({width:1,height:1,data:Buffer.from([0,0,0,255])});
    const relative='workflow-images/chapter-001/'+workflowId+'/synthetic-only-'+index+'.png';
    const url=createProjectFileUrl(f.snapshot.projectId,relative),file=path.join(f.snapshot.projectRoot,relative),nodeId='frame-'+index;
    f.files.set(file,bytes.toString('base64'));
    const read=f.io.read;f.io.read=name=>name===file && f.files.get(name)===bytes.toString('base64')?bytes:read(name);
    const material=createMaterialRecord({name:'synthetic-'+index+'.png',localPath:url,size:bytes.length,importedAt:index+1});state.materials.unshift(material);
    graph.nodes.push({id:nodeId,type:'generated',title:'Synthetic only',position:{x:0,y:0},createdAt:1,updatedAt:1,prompt:'雨落',aspectRatio:'16:9',status:'ready',resultUrl:url,resultMediaId:material.id,generatedAt:1,frameId:slot.frameId});
    renderer.frames.push({storyboardId:board.id,frameId:slot.frameId,workflowId,nodeId,path:url,file,sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length});
    return {...slot,mediaRef:{kind:'image' as const,path:url,imageWorkflowId:workflowId,imageWorkflowNodeId:nodeId}};
  });
  const scene=state.continuityAssetVersions[0];
  board.orderedReferenceManifest=[{order:1,assetId:scene.assetId,assetKind:'scene',versionId:scene.versionId,imagePath:scene.referenceImagePaths[0],referenceRole:'scene-viewpoint',sceneViewpointId:'courtyard',contentFingerprint:scene.contentFingerprint,approvalFingerprint:scene.approvalFingerprint,approved:true}];
  board.continuityState={groupId:'synthetic-group',sceneVersionId:'synthetic-scene',sceneViewpointId:'courtyard',lighting:'day',palette:'ink',actionIn:'雨落',actionOut:'雨落',characters:[],sourceSemanticsFingerprint:storyboardShotSemanticsFingerprint(board.shotSemantics),inputFingerprint:''};
  board.continuityState.inputFingerprint=visualContinuityFingerprint(board);
  board.sourceFingerprint=storyboardSourceFingerprint(board);
  graph.targetSourceFingerprint=board.sourceFingerprint;
  state.imageWorkflows.push(graph);
  (actions.setStoryboardKeyframes as (id:string,frames:typeof slots,reason:string)=>void)(board.id,slots,'generate');
  state.productionTracks=state.productionTracks.map(track=>({...track,sourceFingerprint:trackSourceFingerprint(track,state.storyboards)}));
  const written=state.storyboards.find(item=>item.id===board.id)!;
  written.visualReview=createHumanVisualReview(written,{status:'approved',reviewedAt:1,reasons:[],evidencePaths:slots.map(slot=>slot.mediaRef.path),characterChecks:[],sceneChecks:[{sceneVersionId:'synthetic-scene',passed:true}],propChecks:[],transitionChecks:[],textWatermarkCheck:{passed:true}},state.continuityAssetVersions);
  const put=(name:string,value:unknown)=>{
    const file=path.join(taskResearch,'chapter001-media-publication-synthetic-'+name+'.json'),raw=JSON.stringify(value);
    f.files.set(file,raw);return {file,sha256:sha(raw)};
  };
  const frozenRef=put('frozen',frozen); renderer.frozenSha256=frozenRef.sha256;
  const primaryReview=put('primary',{operator:'root',passed:true,frozenSha256:frozenRef.sha256,snapshotSha256:frozen.snapshotSha256,jobSha256:frozen.jobSha256,baselineSha256:frozen.baselineSha256});
  const input:MediaPublicationInput1027={frozen:frozenRef,renderer:put('renderer',renderer),primaryReview,visualReview:{file:'',sha256:''},trustedParentCapture:{file:'',sha256:''}};
  const rootReviews=[{storyboardId:written.id,review:written.visualReview!}];
  written.visualReview=undefined;
  const reseal=(editReceipt?:(receipt:Record<string,unknown>)=>void)=>{
    if(written.visualReview){rootReviews[0].review=written.visualReview;written.visualReview=undefined;}
    input.renderer=put('renderer',renderer);
    input.visualReview=put('visual',{operator:'root',passed:true,rendererSha256:input.renderer.sha256,frozenSha256:input.frozen.sha256,frames:renderer.frames,storyboardReviews:rootReviews});
    const receipt:Record<string,unknown>=syntheticMediaExecutionReceipt1027(renderer.frames);
    editReceipt?.(receipt);
    const execution=put('synthetic-execution-not-live',receipt);
    input.trustedParentCapture=put('synthetic-parent-not-live',{schema:'chapter001-parent-capture-v1',frozen:input.frozen,renderer:input.renderer,visualReview:input.visualReview,executions:[{receipt:execution,frames:renderer.frames}]});
    f.options.media=input;f.options.window.receipts=Object.values(input).map(ref=>({...ref}));
  };
  reseal();return {...f,input,renderer,frozen,reseal,rootReviews};
}
describe('media publication through the existing production factory',()=>{
  it('rehearses and publishes exact frozen media with all original offline guards',async()=>{
    const f=await syntheticMedia();const original=JSON.stringify([...f.files]);
    const rehearsal=await preflightChapter001Offline1027(f.snapshot,f.job,f.io,f.input);
    const expected=structuredClone(f.renderer.envelope);
    expected.state.storyboards.find(b=>b.episodeId==='chapter-001')!.visualReview=f.rootReviews[0].review;
    expect(rehearsal.reloaded).toEqual(JSON.parse(JSON.stringify(expected)));
    expect(JSON.stringify([...f.files])).toBe(original);
    const result=await applyChapter001Offline1027(f.snapshot,f.job,f.options);
    expect(result).toMatchObject({status:'applied',publicationObserved:true,archivedChapters:4124,manifestLast:true,media:{frameCount:2}});
  });
  it.each(['source','extra','partial','wrongchapter','identity','unapproved','hash','receipt','baseline'])('rejects %s before any publication',async mode=>{
    const f=await syntheticMedia();const board=f.renderer.envelope.state.storyboards.find(item=>item.episodeId==='chapter-001')!;
    if(mode==='source') f.renderer.sourceSha256=sha('wrong source');
    if(mode==='extra') f.renderer.envelope.state.extraHiddenDomain={payload:true};
    if(mode==='partial') board.keyframes!.pop();
    if(mode==='wrongchapter') f.renderer.chapterId='chapter-002' as 'chapter-001';
    if(mode==='identity') board.sourceScript!.entryId='different-draft';
    if(mode==='unapproved') f.rootReviews[0].review.status='pending';
    if(mode==='hash') f.files.set(f.renderer.frames[0].file,'changed bytes');
    if(mode==='baseline') f.renderer.baselineSha256=sha('other baseline');
    f.reseal();
    if(mode==='receipt') f.options.window.receipts.pop();
    await expect(applyChapter001Offline1027(f.snapshot,f.job,f.options)).rejects.toBeInstanceOf(OfflineApplyFailure1027);
    expect(f.changes).toEqual([]);
  });
  it.each([false,true])('retains accurate failure receipt and media checks around publication (published=%s)',async published=>{
    const f=await syntheticMedia(),atomic=f.io.atomic;
    f.io.atomic=(name,bytes,guard)=>{
      if(name.endsWith('/manifest.json')&&!published) throw new Error('synthetic pre-publication failure');
      atomic(name,bytes,guard);
      if(name.endsWith('/manifest.json')) f.files.set(f.renderer.frames[0].file,'media changed after publication');
    };
    let failure:unknown;
    try {await applyChapter001Offline1027(f.snapshot,f.job,f.options);}catch(error){failure=error;}
    expect(failure).toBeInstanceOf(OfflineApplyFailure1027);
    expect((failure as OfflineApplyFailure1027).receipt).toMatchObject({status:'blocked',publicationObserved:published,originalManifestPreserved:!published,rollbackAttempted:false,deletes:0});
  });
  it('rejects a changed immutable primary receipt hash and replay entropy without leaking overrides',async()=>{
    const f=await syntheticMedia(),clock=Date.now,random=Math.random;
    f.frozen.entropy.push({kind:'clock',value:1});
    await expect(replayChapter001Bridge1027(f.snapshot,f.job,f.frozen)).rejects.toThrow(/transcript/);
    expect(Date.now).toBe(clock);expect(Math.random).toBe(random);
    f.files.set(f.input.primaryReview.file,'edited primary');
    await expect(validateChapter001Media1027(f.snapshot,f.job,f.input,f.io)).rejects.toThrow(/hash/);
  });
});

// Regression probes use only synthetic bytes and memory I/O. No live receipt is created.
describe('publication evidence regressions',()=>{
  it('isolates unrelated async clock/random calls and restores globals on failure',async()=>{
    const f=await mediaPublicationFixture1027(),clock=Date.now,random=Math.random;
    const pending=freezeChapter001Bridge1027(f.snapshot,f.job,f.options.window.baselineSha256);
    Math.random();Date.now();await Promise.resolve();Math.random();Date.now();
    const frozen=await pending;
    await expect(replayChapter001Bridge1027(f.snapshot,f.job,frozen)).resolves.toEqual(frozen.bridge);
    const bad=structuredClone(frozen);bad.entropy[0].kind=bad.entropy[0].kind==='clock'?'random':'clock';
    await expect(replayChapter001Bridge1027(f.snapshot,f.job,bad)).rejects.toThrow(/entropy/);
    expect(Date.now).toBe(clock);expect(Math.random).toBe(random);
  });
  it.each(['header','truncated','crc','no-pixels'])('rejects %s PNG despite matching receipts',async mode=>{
    const f=await syntheticMedia();
    const original=f.io.read(f.renderer.frames[0].file)!;
    const bytes=mode==='header'?Buffer.alloc(24):mode==='truncated'?original.subarray(0,original.length-8):Buffer.from(original);
    if(mode==='header'){Buffer.from([137,80,78,71,13,10,26,10]).copy(bytes);bytes.writeUInt32BE(1,16);bytes.writeUInt32BE(1,20);}
    if(mode==='crc')bytes[29]^=1;
    const invalid=mode==='no-pixels'?Buffer.concat([original.subarray(0,33),original.subarray(-12)]):bytes;
    for(const row of f.renderer.frames){const read=f.io.read;f.io.read=name=>name===row.file?invalid:read(name);row.sha256=createHash('sha256').update(invalid).digest('hex');row.bytes=invalid.length;f.renderer.envelope.state.materials.find(m=>m.localPath===row.path)!.size=invalid.length;}
    f.reseal();
    await expect(validateChapter001Media1027(f.snapshot,f.job,f.input,f.io)).rejects.toThrow();
  });
  it.each(['chapter','workflow','missing-workflow','extension'])('rejects wrong %s path',async mode=>{
    const f=await syntheticMedia();
    const state=f.renderer.envelope.state,board=state.storyboards.find(b=>b.episodeId==='chapter-001')!;
    const replacements=new Map<string,string>();
    for(const row of f.renderer.frames){
      const old=row.path,oldFile=row.file,bytes=f.io.read(oldFile)!;
      const base=path.basename(oldFile);
      const suffix=mode==='chapter'?'workflow-images/chapter-002/'+row.workflowId+'/'+base:mode==='workflow'?'workflow-images/chapter-001/wrong/'+base:mode==='missing-workflow'?'workflow-images/chapter-001/'+base:'workflow-images/chapter-001/'+row.workflowId+'/'+base.replace('.png','.jpg');
      row.path=createProjectFileUrl(f.snapshot.projectId,suffix);row.file=path.join(f.snapshot.projectRoot,suffix);replacements.set(old,row.path);
      const read=f.io.read;f.io.read=name=>name===row.file?bytes:read(name);
    }
    for(const frame of board.keyframes!)frame.mediaRef.path=replacements.get(frame.mediaRef.path)!;
    board.mediaRef=board.keyframes![0].mediaRef;
    for(const graph of state.imageWorkflows)for(const node of graph.nodes)if(node.type==='generated')node.resultUrl=replacements.get(node.resultUrl!)??node.resultUrl;
    for(const m of state.materials)m.localPath=replacements.get(m.localPath)??m.localPath;
    for(const task of state.mediaTasks)if(task.outputRefs)task.outputRefs=task.outputRefs.map(s=>replacements.get(s)??s);
    board.visualReview=createHumanVisualReview(board,{status:'approved',reviewedAt:1,reasons:[],evidencePaths:board.keyframes!.map(f=>f.mediaRef.path),characterChecks:[],sceneChecks:[{sceneVersionId:'synthetic-scene',passed:true}],propChecks:[],transitionChecks:[],textWatermarkCheck:{passed:true}},state.continuityAssetVersions);
    f.reseal();
    await expect(validateChapter001Media1027(f.snapshot,f.job,f.input,f.io)).rejects.toThrow(/path/);
  });
  it('rejects producer and root labels without a trusted parent capture pin',async()=>{
    const f=await syntheticMedia();
    const input={...f.input, trustedParentCapture:undefined} as unknown as MediaPublicationInput1027;
    await expect(validateChapter001Media1027(f.snapshot,f.job,input,f.io)).rejects.toThrow(/parent capture/);
  });
});

import { generatedFrameIdMatches1027 } from './director_chapter001_media_publication_1027.test';
describe('production generated-node frame identity',()=>{
  it('accepts the unique existing single-slot mapping with no node frameId',()=>{
    expect(generatedFrameIdMatches1027([{id:'g',type:'generated'}],'g','kf',['kf'])).toBe(true);
  });
  it.each([
    [[{id:'g',type:'generated'}],'g','kf',['kf','kf2']],
    [[{id:'g',type:'generated'},{id:'other',type:'generated'}],'g','kf',['kf']],
    [[{id:'g',type:'generated',frameId:'wrong'}],'g','kf',['kf']],
    [[{id:'g',type:'generated'}],'missing','kf',['kf']],
  ] as const)('rejects ambiguous or wrong IDs (%j)',(nodes,nodeId,frameId,planned)=>{
    expect(generatedFrameIdMatches1027(nodes,nodeId,frameId,planned)).toBe(false);
  });
});

describe('parent capture and separate root review boundary',()=>{
  it('accepts the actual executor success shape with exact original frames and main readbacks',async()=>{
    const f=await syntheticMedia();
    await expect(validateChapter001Media1027(f.snapshot,f.job,f.input,f.io)).resolves.toMatchObject({frameCount:2});
    expect(f.changes).toEqual([]);
  });
  it('rejects an internally consistent partial chapter even with a complete-shaped execution receipt',async()=>{
    const f=await syntheticMedia();
    f.renderer.frames.pop();
    f.renderer.envelope.state.storyboards.find(b=>b.episodeId==='chapter-001')!.keyframes!.pop();
    f.reseal();
    await expect(validateChapter001Media1027(f.snapshot,f.job,f.input,f.io)).rejects.toThrow('partial/invalid frame slots');
    expect(f.changes).toEqual([]);
  });
  it.each(['minimal','contradictory'])('rejects reviewer %s receipt after every supplied hash is repinned',async mode=>{
    const f=await syntheticMedia();
    f.reseal(receipt=>{
      if(mode==='minimal') {
        for(const key of Object.keys(receipt)) if(!['ok','generationExecuted','counts'].includes(key)) Reflect.deleteProperty(receipt,key);
        receipt.counts={posts:2,saves:2};
      } else {
        receipt.frames=[{...f.renderer.frames[0],storyboardId:'unrelated',file:'/unrelated.png',sha256:sha('unrelated')}];
        receipt.mainReadbacks=[{path:'project-file://unrelated/wrong.png',file:'/unrelated.png',sha256:sha('unrelated'),bytes:1}];
        receipt.counts={posts:2,requests:0,saves:2};
      }
    });
    await expect(validateChapter001Media1027(f.snapshot,f.job,f.input,f.io)).rejects.toThrow(/execution|readback/);
    expect(f.changes).toEqual([]);
  });
  it.each(['ok','generationAttempted','generationExecuted','denied','counts','frames','mainReadbacks','before','renderer'])('rejects missing executor %s',async field=>{
    const f=await syntheticMedia();f.reseal(receipt=>{Reflect.deleteProperty(receipt,field);});
    await expect(validateChapter001Media1027(f.snapshot,f.job,f.input,f.io)).rejects.toThrow();
  });
  it.each(['ok','generationAttempted','generationExecuted'])('rejects false executor %s',async field=>{
    const f=await syntheticMedia();f.reseal(receipt=>{receipt[field]=false;});
    await expect(validateChapter001Media1027(f.snapshot,f.job,f.input,f.io)).rejects.toThrow(/execution/);
  });
  it.each(['missing','zero','extra','fractional','string'])('rejects %s executor request count',async mode=>{
    const f=await syntheticMedia();f.reseal(receipt=>{
      const counts=receipt.counts as Record<string,unknown>;
      counts.requests=mode==='missing'?undefined:mode==='zero'?0:mode==='extra'?5:mode==='fractional'?3.5:'4';
    });
    await expect(validateChapter001Media1027(f.snapshot,f.job,f.input,f.io)).rejects.toThrow(/execution/);
  });
  it.each(['posts','saves'])('rejects contradictory executor %s count',async field=>{
    const f=await syntheticMedia();f.reseal(receipt=>{(receipt.counts as Record<string,unknown>)[field]=1;});
    await expect(validateChapter001Media1027(f.snapshot,f.job,f.input,f.io)).rejects.toThrow(/execution/);
  });
  it.each(['nonempty-denied','missing-denied-array','error','not-isolated','not-hydrated'])('rejects %s execution state',async mode=>{
    const f=await syntheticMedia();f.reseal(receipt=>{
      if(mode==='nonempty-denied')receipt.denied=[{method:'POST',scheme:'https:'}];
      if(mode==='missing-denied-array')receipt.denied={length:0};
      if(mode==='error')receipt.error='failed after save';
      if(mode==='not-isolated')(receipt.before as Record<string,unknown>).noFileStorage=false;
      if(mode==='not-hydrated')(receipt.renderer as Record<string,unknown>).actualSingletonsHydrated=false;
    });
    await expect(validateChapter001Media1027(f.snapshot,f.job,f.input,f.io)).rejects.toThrow(/execution/);
  });
  it.each(['storyboardId','frameId','workflowId','nodeId','path','file','sha256','bytes'])('rejects contradictory executor frame %s',async field=>{
    const f=await syntheticMedia();f.reseal(receipt=>{
      const frame=(receipt.frames as Record<string,unknown>[])[0];frame[field]=field==='bytes'?1:'unrelated';
    });
    await expect(validateChapter001Media1027(f.snapshot,f.job,f.input,f.io)).rejects.toThrow(/execution.*frame|readback/);
  });
  it.each(['path','file','sha256','bytes'])('rejects contradictory main readback %s',async field=>{
    const f=await syntheticMedia();f.reseal(receipt=>{
      const row=(receipt.mainReadbacks as Record<string,unknown>[])[0];row[field]=field==='bytes'?1:'unrelated';
    });
    await expect(validateChapter001Media1027(f.snapshot,f.job,f.input,f.io)).rejects.toThrow(/readback/);
  });
  it.each(['empty','partial','extra','reordered','duplicate','null'])('rejects %s receipt frame array',async mode=>{
    const f=await syntheticMedia();f.reseal(receipt=>{
      const rows=receipt.frames as unknown[];
      receipt.frames=mode==='empty'?[]:mode==='partial'?rows.slice(1):mode==='extra'?[...rows,rows[0]]:mode==='reordered'?[...rows].reverse():mode==='duplicate'?[rows[0],rows[0]]:null;
    });
    await expect(validateChapter001Media1027(f.snapshot,f.job,f.input,f.io)).rejects.toThrow(/execution.*frame|readback/);
  });
  it.each(['empty','partial','extra','reordered','duplicate','null','identity-field'])('rejects %s main readbacks',async mode=>{
    const f=await syntheticMedia();f.reseal(receipt=>{
      const rows=receipt.mainReadbacks as Record<string,unknown>[];
      receipt.mainReadbacks=mode==='empty'?[]:mode==='partial'?rows.slice(1):mode==='extra'?[...rows,rows[0]]:mode==='reordered'?[...rows].reverse():mode==='duplicate'?[rows[0],rows[0]]:mode==='null'?null:rows.map(row=>({...row,frameId:'not-emitted-by-main'}));
    });
    await expect(validateChapter001Media1027(f.snapshot,f.job,f.input,f.io)).rejects.toThrow(/readback/);
  });
  it.each(['readback','execution','renderer-human'])('rejects %s evidence even with producer/root labels',async mode=>{
    const f=await syntheticMedia();
    const readJson=(ref:{file:string})=>JSON.parse(f.files.get(ref.file)!);
    const seal=(ref:{file:string;sha256:string},value:unknown)=>{const raw=JSON.stringify(value);f.files.set(ref.file,raw);ref.sha256=sha(raw);};
    const capture=readJson(f.input.trustedParentCapture);
    if(mode==='readback')capture.executions[0].frames[0].sha256=sha('different main readback');
    if(mode==='execution') {const ref=capture.executions[0].receipt;const receipt=readJson(ref);receipt.generationExecuted=false;seal(ref,receipt);}
    if(mode==='renderer-human') {
      f.renderer.envelope.state.storyboards.find(b=>b.episodeId==='chapter-001')!.visualReview=f.rootReviews[0].review;
      seal(f.input.renderer,f.renderer);capture.renderer=f.input.renderer;
      const visual=readJson(f.input.visualReview);visual.rendererSha256=f.input.renderer.sha256;seal(f.input.visualReview,visual);capture.visualReview=f.input.visualReview;
    }
    seal(f.input.trustedParentCapture,capture);
    await expect(validateChapter001Media1027(f.snapshot,f.job,f.input,f.io)).rejects.toThrow(/readback|execution|renderer cannot/);
  });
});
