/** Task-only media rehearsal contract. The root offline executor remains the sole publisher. */
import { createHash } from 'node:crypto';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { applyChapter001InMemory, chapter001Sha256 as sha, CHAPTER001_PROJECT_ID as pid, type Chapter001Snapshot, type Chapter001ApplyJob } from './director_chapter001_bridge_1026.test';
import { validateStoryboardKeyframes } from '@/lib/studio/keyframes';
import { approvedVisualReviewIssues } from '@/lib/studio/visual-continuity';
import { trackSourceFingerprint, storyboardSourceFingerprint } from '@/stores/studio/studio-store-continuity-helpers';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createRequire } from 'node:module';
import { workflowImageRelativePath } from '@/lib/studio/chapter-paths';
import type { VisualReviewResult } from '@/types/studio';
const {PNG}=createRequire(import.meta.url)('pngjs') as {PNG:{sync:{read(bytes:Buffer,options:{checkCRC:boolean}):{width:number;height:number;data:Buffer}}}};
import { createMaterialRecord } from '@/lib/studio/material';

const task = path.resolve(import.meta.dirname, '../../../.trellis/tasks/10-25-daojie-director-rule-conflict-validation');
const json = <T>(value:T):T => JSON.parse(JSON.stringify(value));
function demand(value:unknown,message:string):asserts value { if(!value) throw new Error(message); }
function keys(value:unknown, allowed:string[], label:string) {
  demand(value && typeof value === 'object' && !Array.isArray(value), label+' object required');
  demand(Object.keys(value).every(key => allowed.includes(key)), label+' unknown extra field');
}
type Entropy = {kind:'clock'|'random'; value:number};
type Bridge = Awaited<ReturnType<typeof applyChapter001InMemory>>;
export interface FrozenChapter001Bridge1027 {
  schema:'chapter001-frozen-bridge-v1'; snapshotSha256:string; jobSha256:string; baselineSha256:string;
  entropy:Entropy[]; bridge:Bridge;
}
let replayRunning = false;
/** Only runs the existing task bridge. Never captures storage/lock/lifecycle clocks. */
async function entropyBridge(snapshot:Chapter001Snapshot,job:Chapter001ApplyJob,current:()=>Chapter001Snapshot, transcript?:Entropy[]) {
  demand(!replayRunning,'bridge entropy replay already running');
  replayRunning = true;
  const clock = Date.now, random = Math.random;
  const scope=new AsyncLocalStorage<boolean>();
  const events:Entropy[] = []; let cursor = 0;
  const next = (kind:Entropy['kind'], original:()=>number) => {
    if(!transcript) { const value = original(); events.push({kind,value}); return value; }
    const event = transcript[cursor++];
    demand(event?.kind === kind && Number.isFinite(event.value) && (kind === 'clock' ? Number.isInteger(event.value) && event.value > 0 : event.value >= 0 && event.value < 1),'bridge entropy sequence mismatch');
    return event.value;
  };
  Date.now = () => scope.getStore() ? next('clock',clock) : clock(); Math.random = () => scope.getStore() ? next('random',random) : random();
  try {
    const bridge = json(await scope.run(true,()=>applyChapter001InMemory(snapshot,job,current)));
    demand(!transcript || cursor === transcript.length,'bridge entropy transcript not exhausted');
    return {bridge,entropy:events};
  } finally { Date.now = clock; Math.random = random; scope.disable(); replayRunning = false; }
}
export async function freezeChapter001Bridge1027(snapshot:Chapter001Snapshot,job:Chapter001ApplyJob,baselineSha256:string,current:()=>Chapter001Snapshot=()=>snapshot):Promise<FrozenChapter001Bridge1027> {
  demand(/^[a-f0-9]{64}$/.test(baselineSha256),'exact baseline hash required');
  const snapshotSha256=sha(JSON.stringify(snapshot)),jobSha256=sha(JSON.stringify(job));
  const captured=await entropyBridge(snapshot,job,current);
  return {schema:'chapter001-frozen-bridge-v1',snapshotSha256,jobSha256,baselineSha256,...captured};
}
export async function replayChapter001Bridge1027(snapshot:Chapter001Snapshot,job:Chapter001ApplyJob,frozen:FrozenChapter001Bridge1027,current:()=>Chapter001Snapshot=()=>snapshot):Promise<Bridge> {
  keys(frozen,['schema','snapshotSha256','jobSha256','baselineSha256','entropy','bridge'],'frozen bridge');
  demand(frozen.schema==='chapter001-frozen-bridge-v1' && frozen.snapshotSha256===sha(JSON.stringify(snapshot)) && frozen.jobSha256===sha(JSON.stringify(job)),'frozen source/job identity mismatch');
  demand(Array.isArray(frozen.entropy) && frozen.entropy.length>0 && frozen.entropy.length<100000,'frozen entropy missing');
  for(const event of frozen.entropy) keys(event,['kind','value'],'entropy');
  const {bridge}=await entropyBridge(snapshot,job,current,frozen.entropy);
  demand(isDeepStrictEqual(bridge,frozen.bridge),'replayed production bridge differs from frozen identity');
  return bridge;
}
export interface MediaArtifactRef1027 {file:string;sha256:string}
export interface MediaPublicationInput1027 {
  frozen:MediaArtifactRef1027; renderer:MediaArtifactRef1027;
  primaryReview:MediaArtifactRef1027; visualReview:MediaArtifactRef1027;
  /** Supplied/pinned by the trusted parent, never by the renderer. Labels are not authentication. */
  trustedParentCapture:MediaArtifactRef1027;
}
export interface MediaRead1027 {read(file:string):Buffer|null;realpath(file:string):string}
export interface MediaFrame1027 {
  storyboardId:string;frameId:string;workflowId:string;nodeId:string;path:string;file:string;sha256:string;bytes:number;
}
/** Successful boot.json fields emitted by media_execution_1027.main.mjs. */
interface ExecutionReceipt1027 {
  ok:boolean;generationAttempted:boolean;generationExecuted:boolean;denied:unknown[];
  counts:{posts:number;requests:number;saves:number};before:unknown;renderer:unknown;
  frames:MediaFrame1027[];mainReadbacks:Pick<MediaFrame1027,'path'|'file'|'sha256'|'bytes'>[];
  error?:string;
}
export interface RendererMedia1027 {
  schema:'chapter001-renderer-media-v1'; projectId:string; chapterId:'chapter-001';
  frozenSha256:string;snapshotSha256:string;jobSha256:string;sourceSha256:string;manifestSha256:string;baselineSha256:string;
  producer:'runImageWorkflowNodeGeneration/projectFiles.saveImage';
  envelope:Chapter001Snapshot['envelope'];frames:MediaFrame1027[];
}
/** The caller/root must independently pin this file from its actual execution capture. */
export interface ParentCapture1027 {
  schema:'chapter001-parent-capture-v1'; frozen:MediaArtifactRef1027;renderer:MediaArtifactRef1027;visualReview:MediaArtifactRef1027;
  executions:{receipt:MediaArtifactRef1027;frames:MediaFrame1027[]}[];
}
export function generatedFrameIdMatches1027(nodes:readonly {id:string;type:string;frameId?:string}[],nodeId:string,frameId:string,planned:readonly string[]):boolean {
  const generated=nodes.filter(node=>node.type==='generated'),node=generated.find(node=>node.id===nodeId);
  if(!node || !planned.includes(frameId)) return false;
  return node.frameId===frameId || (node.frameId===undefined && planned.length===1 && planned[0]===frameId && generated.length===1);
}
export interface MediaValidation1027 {bridge:Bridge;envelope:Chapter001Snapshot['envelope'];pins:{file:string;sha256:string;bytes:number}[];baselineSha256:string;rendererSha256:string;frameCount:number}
/** Hashes immutable task receipts and every canonical media byte again on each invocation. */
export function verifyMediaPins1027(pins:MediaValidation1027['pins'],files:MediaRead1027):void {
  for(const pin of pins) {
    demand(files.realpath(pin.file)===pin.file,'media/receipt path escape');
    const bytes=files.read(pin.file);
    demand(bytes && bytes.length===pin.bytes && createHash('sha256').update(bytes).digest('hex')===pin.sha256,'media/receipt readback hash mismatch: '+pin.file);
  }
}
export async function validateChapter001Media1027(snapshot:Chapter001Snapshot,job:Chapter001ApplyJob,input:MediaPublicationInput1027,files:MediaRead1027,current:()=>Chapter001Snapshot=()=>snapshot):Promise<MediaValidation1027> {
  keys(input,['frozen','renderer','primaryReview','visualReview','trustedParentCapture'],'media input');
  demand(input.trustedParentCapture,'trusted parent capture pin required');
  const pins:MediaValidation1027['pins']=[];
  const artifact=<T>(ref:MediaArtifactRef1027):T => {
    keys(ref,['file','sha256'],'artifact reference');
    demand(path.isAbsolute(ref.file) && ref.file.startsWith(path.join(task,'research')+path.sep) && files.realpath(ref.file)===ref.file,'media artifact outside canonical task research');
    const bytes=files.read(ref.file);
    demand(bytes && createHash('sha256').update(bytes).digest('hex')===ref.sha256,'media artifact hash mismatch');
    pins.push({file:ref.file,sha256:ref.sha256,bytes:bytes.length});
    return JSON.parse(bytes.toString('utf8')) as T;
  };
  const frozen=artifact<FrozenChapter001Bridge1027>(input.frozen);
  const renderer=artifact<RendererMedia1027>(input.renderer);
  const primary=artifact<{operator:string;passed:boolean;frozenSha256:string;snapshotSha256:string;jobSha256:string;baselineSha256:string}>(input.primaryReview);
  keys(primary,['operator','passed','frozenSha256','snapshotSha256','jobSha256','baselineSha256'],'primary root review');
  demand(primary.operator==='root' && primary.passed===true && primary.frozenSha256===input.frozen.sha256 && primary.snapshotSha256===frozen.snapshotSha256 && primary.jobSha256===frozen.jobSha256 && primary.baselineSha256===frozen.baselineSha256,'exact primary root receipt required');
  const capture=artifact<ParentCapture1027>(input.trustedParentCapture);
  keys(capture,['schema','frozen','renderer','visualReview','executions'],'parent capture');
  demand(capture.schema==='chapter001-parent-capture-v1' && isDeepStrictEqual(capture.frozen,input.frozen) && isDeepStrictEqual(capture.renderer,input.renderer) && isDeepStrictEqual(capture.visualReview,input.visualReview),'trusted parent capture pin mismatch');
  demand(new Set([input.renderer.file,input.visualReview.file,input.trustedParentCapture.file]).size===3,'renderer cannot author root visual review');
  demand(Array.isArray(capture.executions) && capture.executions.length>0,'parent execution capture missing');
  const capturedFrames:MediaFrame1027[]=[];const executions=new Set<string>();
  for(const execution of capture.executions) {
    keys(execution,['receipt','frames'],'captured execution');
    demand(!executions.has(execution.receipt.file),'duplicate execution receipt');executions.add(execution.receipt.file);
    const receipt=artifact<ExecutionReceipt1027>(execution.receipt);
    keys(receipt,['ok','generationAttempted','generationExecuted','denied','counts','before','renderer','frames','mainReadbacks','error'],'execution receipt');
    demand(receipt.ok===true && receipt.generationAttempted===true && receipt.generationExecuted===true && !Object.hasOwn(receipt,'error') && Array.isArray(receipt.denied) && receipt.denied.length===0,'successful actual execution capture required');
    // These fields describe the empty pre-generation boot, not the final generation state.
    demand(isDeepStrictEqual(receipt.before,{empty:true,noFileStorage:true,noNode:true}) && isDeepStrictEqual(receipt.renderer,{actualSingletonsHydrated:true,actualAiManagerImported:true,actualSingleShotEntryImported:true,projectWrites:0,generationExecuted:false}),'isolated actual execution boot required');
    demand(Array.isArray(execution.frames) && execution.frames.length>0 && execution.frames.length<=3,'bounded actual execution frames required');
    const count=execution.frames.length;
    demand(isDeepStrictEqual(receipt.counts,{posts:count,requests:2*count,saves:count}),'exact actual execution request/save counts required');
    demand(Array.isArray(receipt.frames) && isDeepStrictEqual(receipt.frames,execution.frames),'actual execution frame readback mismatch');
    const expectedReadbacks=execution.frames.map(({path,file,sha256,bytes})=>({path,file,sha256,bytes}));
    demand(Array.isArray(receipt.mainReadbacks) && isDeepStrictEqual(receipt.mainReadbacks,expectedReadbacks),'actual main per-frame readback mismatch');
    capturedFrames.push(...execution.frames);
  }
  demand(isDeepStrictEqual(capturedFrames,renderer.frames),'parent execution frame readback mismatch');
  const visual=artifact<{operator:string;passed:boolean;rendererSha256:string;frozenSha256:string;frames:MediaFrame1027[];storyboardReviews:{storyboardId:string;review:VisualReviewResult}[]}>(input.visualReview);
  keys(visual,['operator','passed','rendererSha256','frozenSha256','frames','storyboardReviews'],'visual root review');
  demand(visual.operator==='root' && visual.passed===true && visual.rendererSha256===input.renderer.sha256 && visual.frozenSha256===input.frozen.sha256 && isDeepStrictEqual(visual.frames,renderer.frames),'root per-frame visual approval required');
  keys(renderer,['schema','projectId','chapterId','frozenSha256','snapshotSha256','jobSha256','sourceSha256','manifestSha256','baselineSha256','producer','envelope','frames'],'renderer artifact');
  demand(renderer.schema==='chapter001-renderer-media-v1' && renderer.producer==='runImageWorkflowNodeGeneration/projectFiles.saveImage' && renderer.projectId===pid && renderer.chapterId==='chapter-001' && renderer.frozenSha256===input.frozen.sha256 && renderer.snapshotSha256===frozen.snapshotSha256 && renderer.jobSha256===frozen.jobSha256 && renderer.sourceSha256===snapshot.sourceSha256 && renderer.manifestSha256===snapshot.manifestSha256 && renderer.baselineSha256===frozen.baselineSha256,'renderer identity/source/baseline mismatch');
  const bridge=await replayChapter001Bridge1027(snapshot,job,frozen,current);
  const before=bridge.envelope.state, after=json(renderer.envelope.state);
  const reviewedIds=new Set<string>();
  demand(Array.isArray(visual.storyboardReviews),'separate root storyboard reviews required');
  for(const row of visual.storyboardReviews){
    keys(row,['storyboardId','review'],'root storyboard review');
    const board=after.storyboards.find(board=>board.id===row.storyboardId && board.episodeId==='chapter-001');
    demand(board && !reviewedIds.has(row.storyboardId) && board.visualReview?.reviewer!=='human','renderer cannot author root visual review');
    demand(row.review?.reviewer==='human' && row.review.status==='approved','separate human visual review required');
    reviewedIds.add(row.storyboardId);board.visualReview=json(row.review);
  }
  demand(after.storyboards.filter(b=>b.episodeId==='chapter-001').every(b=>reviewedIds.has(b.id)),'root review coverage incomplete');
  keys(renderer.envelope,['state','version'],'renderer envelope');
  demand(renderer.envelope.version===bridge.envelope.version,'envelope version changed');
  demand(isDeepStrictEqual(Object.keys(after).sort(),Object.keys(before).sort()),'unknown extra state domain');
  const mediaKeys=new Set(['storyboards','imageWorkflows','materials','mediaTasks','productionTracks']);
  for(const key of Object.keys(before)) if(!mediaKeys.has(key)) demand(isDeepStrictEqual(before[key],after[key]),'non-media domain changed: '+key);
  demand(Array.isArray(renderer.frames) && renderer.frames.length>0,'media frames missing');
  const chapterBoards=before.storyboards.filter(board=>board.episodeId==='chapter-001');
  const boardIds=new Set(chapterBoards.map(board=>board.id));
  demand(after.storyboards.length===before.storyboards.length,'storyboard identity/count changed');
  demand(after.productionTracks.length===before.productionTracks.length,'track identity/count changed');
  for(let index=0;index<before.productionTracks.length;index++) {
    const old=before.productionTracks[index],track=after.productionTracks[index];
    demand(isDeepStrictEqual(track,old.episodeId==='chapter-001'?{...old,sourceFingerprint:trackSourceFingerprint(old,after.storyboards)}:old),'unrelated track delta or stale dependent video requires separate review');
  }
  const frameKeys=new Set<string>(),urls=new Set<string>();
  for(const frame of renderer.frames) {
    keys(frame,['storyboardId','frameId','workflowId','nodeId','path','file','sha256','bytes'],'frame receipt');
    demand(boardIds.has(frame.storyboardId) && !frameKeys.has(frame.storyboardId+'/'+frame.frameId) && !urls.has(frame.path),'wrongchapter/duplicate frame');
    frameKeys.add(frame.storyboardId+'/'+frame.frameId);urls.add(frame.path);
    const url=new URL(frame.path);
    demand(url.protocol==='project-file:' && url.hostname===pid && !url.search && !url.hash,'wrong project media URL');
    const rel=decodeURIComponent(url.pathname.slice(1));
    demand(rel===workflowImageRelativePath(frame.workflowId,path.posix.basename(rel),'chapter-001') && path.posix.extname(rel)==='.png' && rel.split('/').every(part=>part && part!=='.' && part!=='..') && !rel.includes('\\') && frame.file===path.join(snapshot.projectRoot,rel) && files.realpath(frame.file)===frame.file,'media path mismatch');
    demand(Number.isSafeInteger(frame.bytes) && frame.bytes>0 && /^[a-f0-9]{64}$/.test(frame.sha256),'invalid media byte receipt');
    const mediaBytes=files.read(frame.file);demand(mediaBytes,'missing media bytes');
    demand(mediaBytes.length>=33 && mediaBytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),'PNG bytes required');
    const width=mediaBytes.readUInt32BE(16),height=mediaBytes.readUInt32BE(20);
    demand(width>0 && height>0 && width<=16384 && height<=16384 && width*height<=67108864,'unsafe PNG dimensions');
    const decoded=PNG.sync.read(mediaBytes,{checkCRC:true});
    demand(decoded.width===width && decoded.height===height && decoded.data.length===width*height*4,'PNG full decode/readback failed');
    pins.push({file:frame.file,sha256:frame.sha256,bytes:frame.bytes});
  }
  const allowedBoard=new Set(['keyframes','mediaRef','imageWorkflowId','imageWorkflowNodeId','orderedReferenceManifest','continuityState','visualReview','state','reason','stale','staleReason','staleSince','sourceFingerprint','outputVersion']);
  let count=0;
  for(let index=0;index<before.storyboards.length;index++) {
    const old=before.storyboards[index],board=after.storyboards[index];
    demand(old.id===board.id,'different storyboard identity/order');
    if(!boardIds.has(old.id)) { demand(isDeepStrictEqual(old,board),'other chapter changed');continue; }
    for(const key of new Set([...Object.keys(old),...Object.keys(board)])) if(!allowedBoard.has(key)) demand(isDeepStrictEqual((old as unknown as Record<string,unknown>)[key],(board as unknown as Record<string,unknown>)[key]),'text/source/unknown storyboard field changed: '+key);
    demand(board.state==='ready' && !board.stale && !board.staleSince && !board.staleReason && board.sourceFingerprint===storyboardSourceFingerprint(board),'stale media storyboard');
    demand(board.keyframes?.length===old.keyframes?.length && board.keyframes && !validateStoryboardKeyframes(board.keyframes,{shotDurationUs:board.duration*1000000}).length,'partial/invalid frame slots');
    demand(isDeepStrictEqual(board.mediaRef,board.keyframes[0].mediaRef),'first-frame mirror differs');
    keys(board.continuityState,['groupId','previousStoryboardId','sceneVersionId','sceneViewpointId','lighting','palette','actionIn','actionOut','characters','styleContractVersion','styleContractFingerprint','promptAuditVersion','sourceSemanticsFingerprint','inputFingerprint','worldAnchor','dialogueCueId','dialogueText','frameReferencePresence'],'continuity');
    for(const character of board.continuityState!.characters) keys(character,['characterId','versionId','position','orientation','actionIn','actionOut'],'continuity character');
    for(const anchor of board.continuityState!.worldAnchor??[]) keys(anchor,['characterId','landmark','relation'],'world anchor');
    if(board.continuityState!.frameReferencePresence) keys(board.continuityState!.frameReferencePresence,['first','last'],'frame presence');
    keys(board.visualReview,['status','reasons','characterChecks','sceneChecks','propChecks','transitionChecks','textWatermarkCheck','reviewer','reviewedAt','evidencePaths','inputFingerprint'],'visual review');
    for(const check of board.visualReview!.characterChecks) keys(check,['characterId','passed','reason'],'character check');
    for(const check of board.visualReview!.sceneChecks) keys(check,['sceneVersionId','passed','reason'],'scene check');
    for(const check of board.visualReview!.propChecks??[]) keys(check,['assetId','versionId','passed','reason'],'prop check');
    for(const check of board.visualReview!.transitionChecks) keys(check,['previousStoryboardId','passed','reason'],'transition check');
    keys(board.visualReview!.textWatermarkCheck,['passed','reason'],'watermark check');
    for(const reference of board.orderedReferenceManifest??[]) keys(reference,['order','assetId','assetName','assetKind','imageId','imagePath','referenceImagePaths','referenceImageSha256','referenceViewTypes','source','missing','versionId','referenceRole','identityAnchors','negativePrompt','wardrobeVersion','sceneViewpointId','contentFingerprint','approvalFingerprint','approved'],'ordered reference');
    demand(board.visualReview?.status==='approved' && !approvedVisualReviewIssues(board,board.visualReview,after.continuityAssetVersions).length,'unapproved/stale visual review');
    for(let fi=0;fi<board.keyframes.length;fi++) {
      const slot=old.keyframes![fi],frame=board.keyframes[fi];
      keys(frame,['frameId','mediaRef','inUs','origin','momentDescription'],'keyframe');
      if(frame.origin) keys(frame.origin,['kind'],'frame origin');
      keys(frame.mediaRef,['kind','path','contentSha256','imageWorkflowId','imageWorkflowNodeId'],'frame mediaRef');
      demand(frame.frameId===slot.frameId && frame.inUs===slot.inUs && frame.momentDescription===slot.momentDescription && frame.origin?.kind==='generated' && frame.mediaRef.kind==='image','frame identity/plan changed');
      const receipt=renderer.frames.find(row=>row.storyboardId===board.id && row.frameId===frame.frameId);
      demand(receipt && receipt.path===frame.mediaRef.path && receipt.workflowId===frame.mediaRef.imageWorkflowId && receipt.nodeId===frame.mediaRef.imageWorkflowNodeId && (!frame.mediaRef.contentSha256 || frame.mediaRef.contentSha256===receipt.sha256),'frame source receipt mismatch');
      const graph=after.imageWorkflows.find(graph=>graph.id===receipt.workflowId),node=graph?.nodes.find(node=>node.id===receipt.nodeId);
      demand(graph?.target.kind==='storyboard' && graph.target.id===board.id && graph.targetSourceFingerprint===board.sourceFingerprint && node?.type==='generated' && node.status==='ready' && node.resultUrl===receipt.path && generatedFrameIdMatches1027(graph.nodes,node.id,frame.frameId,old.keyframes!.map(slot=>slot.frameId)) && Number.isFinite(node.generatedAt) && node.generatedAt!>0,'generated graph/frame identity mismatch');
      const material=after.materials.find(item=>item.id===(node.type==='generated'?node.resultMediaId:undefined));
      demand(material && material.kind==='image' && material.localPath===receipt.path && material.size===receipt.bytes,'material/frame mismatch');
      count++;
    }
  }
  demand(count===renderer.frames.length,'unknown extra or missing frame receipts');
  for(const old of before.materials) demand(after.materials.some(item=>isDeepStrictEqual(item,old)),'old material modified');
  const newMaterials=after.materials.filter(item=>!before.materials.some(old=>old.id===item.id));
  demand(new Set(after.materials.map(item=>item.id)).size===after.materials.length && newMaterials.length===count,'extra/duplicate media material');
  for(const item of newMaterials) {
    keys(item,['id','name','kind','localPath','sourceName','size','importedAt'],'material');
    demand(urls.has(item.localPath) && isDeepStrictEqual(item,createMaterialRecord({name:item.name,localPath:item.localPath,size:item.size,importedAt:item.importedAt})),'non-production material record');
  }
  for(const old of before.imageWorkflows) if(!boardIds.has(old.target.id??'')) demand(after.imageWorkflows.some(graph=>isDeepStrictEqual(graph,old)),'other workflow changed');
  demand(new Set(after.imageWorkflows.map(graph=>graph.id)).size===after.imageWorkflows.length,'duplicate workflow identity');
  for(const graph of after.imageWorkflows.filter(graph=>!before.imageWorkflows.some(old=>isDeepStrictEqual(graph,old)))) {
    keys(graph,['id','name','target','targetSourceFingerprint','assemblyTrace','nodes','edges','viewport','createdAt','updatedAt'],'workflow');
    keys(graph.target,['kind','id'],'workflow target');
    if(graph.viewport) keys(graph.viewport,['x','y','zoom'],'workflow viewport');
    if(graph.assemblyTrace) keys(graph.assemblyTrace,['manualId','templateId','templateTitle','factions','factionTracks','negativeApplied','styleTokenCount','assetReferenceTitles'],'assembly trace');
    demand(graph.target.kind==='storyboard' && boardIds.has(graph.target.id??'') && renderer.frames.some(frame=>frame.workflowId===graph.id),'wrongchapter/extra workflow');
    const common=['id','type','title','position','createdAt','updatedAt','bypassed','size'];
    for(const node of graph.nodes) {
      const fields=node.type==='generated'?['prompt','negativePrompt','model','paramsEdited','aspectRatio','resolution','resultUrl','resultMediaId','status','errorReason','generatedAt','frameId','frameMoment']:node.type==='prompt'?['prompt','negativePrompt','model','aspectRatio','resolution','targetNodeId']:node.type==='reference'?['imageUrl','source','notes','continuityOrder','continuityVersionId','referenceRole','identityAnchors','negativePrompt','wardrobeVersion','characterViewType','sceneViewpointId']:null;
      demand(fields,'unsupported workflow node type');keys(node,[...common,...fields],'workflow node');
      keys(node.position,['x','y'],'node position');if(node.size) keys(node.size,['width'],'node size');
      if(node.type==='reference' && node.source) keys(node.source,['kind','id','assetType','parentId'],'reference source');
      if(node.type==='generated') demand(renderer.frames.some(frame=>frame.workflowId===graph.id && frame.nodeId===node.id),'extra generated node');
    }
    demand(new Set(graph.nodes.map(node=>node.id)).size===graph.nodes.length,'duplicate workflow node');
    for(const edge of graph.edges) { keys(edge,['id','source','target','label','targetHandle','sourceHandle'],'workflow edge');demand(graph.nodes.some(node=>node.id===edge.source) && graph.nodes.some(node=>node.id===edge.target),'dangling workflow edge'); }
  }
  demand(after.mediaTasks.length>=before.mediaTasks.length && isDeepStrictEqual(after.mediaTasks.slice(0,before.mediaTasks.length),before.mediaTasks),'old media tasks changed');
  for(const item of after.mediaTasks.slice(before.mediaTasks.length)) {
    keys(item,['id','kind','targetId','episodeId','provider','runId','checkpointRef','inputFingerprint','retryOf','retryCount','status','createdAt','updatedAt','finishedAt','outputRef','outputRefs','errorReason'],'media task');
    demand(item.kind==='storyboardImage' && item.episodeId==='chapter-001' && boardIds.has(item.targetId) && item.status==='success' && item.provider==='keyframes' && (item.outputRefs??[]).length>0 && !item.errorReason && (item.outputRefs??[]).every(url=>urls.has(url)),'unrelated/failed media task');
  }
  verifyMediaPins1027(pins,files);
  return {bridge,envelope:{...json(renderer.envelope),state:after},pins,baselineSha256:frozen.baselineSha256,rendererSha256:input.renderer.sha256,frameCount:count};
}
