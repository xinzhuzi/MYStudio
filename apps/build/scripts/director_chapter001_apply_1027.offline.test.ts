/** Synthetic fixtures; no real approval, project I/O, model or media claims. */
import { describe, expect, it, vi } from 'vitest';
import path from 'node:path';
import { CHAPTER001_PROJECT_ID, chapter001Sha256 as sha, type Chapter001Snapshot, type Chapter001ApplyJob, type Chapter001StageArtifact } from './director_chapter001_bridge_1026.test';
import { prepareChapter001Apply1027 } from './director_chapter001_apply_1027.test';
import { REQUIRED_DIRECTOR_PLAN_SECTIONS } from '@/lib/studio/director-plan';
import { planStudioWorkflowShards, mergeStudioWorkflowShards } from '@/lib/storage/studio-workflow-shards';
import workflowReadme from '@/assets/docs/studio-workflow/README.md?raw';
import projectReadme from '@/assets/docs/project/README.md?raw';
import backupsReadme from '@/assets/docs/backups/README.md?raw';
import { fileStorage } from '@/lib/storage/indexed-db-storage';
import { createStudioWorkflowShardedStorage, __resetModuleStorageWriteLockForTests } from '@/lib/storage/storage-project-sharded';
import { createStorageWriteLock } from '@/lib/storage/storage-write-lock';
function fixture() {
  const chapter = { id: 'chapter-001', title: '合成测试', sourceId: 'chapter-001', revision: 3, sourceText: '雨落。', index: 1 };
  const index = Array.from({ length: 4125 }, (_, i) => ({ id: `chapter-${String(i + 1).padStart(3, '0')}`, title: String(i + 1), index: i + 1 }));
  const state = {
    materials: [], novelChapters: [chapter], activeChapterId: 'chapter-001', sourceBible: '合成设定',
    agentWorkData: [{ id: 'other-work', key: 'scriptDraft', episodeId: 'chapter-002', data: '保留其他章', updatedAt: 1, createdAt: 1 }],
    entityExtractions: [{ id: 'entities', episodeId: 'chapter-001', characters: [], scenes: [], props: [] }],
    scriptPlans: [], seriesBible: { projectId: CHAPTER001_PROJECT_ID }, episodeOutlines: [], storyboards: [], continuityAssetVersions: [], productionTracks: [], videoCandidates: [], sceneSegments: [], imageWorkflows: [], agentRuns: [], mediaTasks: [], eventGraph: [], projectMemoryRecords: [], workflowConfig: { directorManualId: 'Daojie_xianxia' }, unknownField: { preserve: '全部源字段' },
  };
  const content = JSON.stringify({ state, version: 11 });
  const initialPlan = planStudioWorkflowShards(content, {emitChapterIndex:true});
  const manifest = initialPlan.manifest;
  const manifestRaw = JSON.stringify(manifest);
  const snapshot = {
    projectId: CHAPTER001_PROJECT_ID, projectRoot: '/synthetic-only', chapterId: 'chapter-001', manifestRaw, manifest, manifestSha256: sha(manifestRaw), sourceSha256: sha(chapter.sourceText),
    shards: initialPlan.files.map(file=>({relativePath:file.name,content:file.content,sha256:sha(file.content)})), sourceFiles: [],
    envelope: { state: { ...state, novelChapters: index.map(item => item.id === chapter.id ? chapter : item) }, version: 11 },
    input: { episodeId: 'chapter-001', chapterTitle: chapter.title, chapterText: chapter.sourceText, bibleContext: state.sourceBible, assetsInventory: '' },
  } as unknown as Chapter001Snapshot;
  const script = ['# 合成测试', '# 范围与目标：本章|时长：0.1666666667分钟', '# 已确定要求：16:9', '## 剧情梗概', '雨落。', '1 庭院 日/外 ·约10秒', '镜头1：雨落。', '## 改编追踪', '雨落。'].join('\n');
  const paragraph = '雨落，保持场景空间及情绪连续，以场景意图表达原文，所有场内事实仍以原文为准。';
  const plan = ['<scriptPlan>', ...REQUIRED_DIRECTOR_PLAN_SECTIONS.flatMap((section, i) => [
    `## ${section}`,
    ...(i === 3 ? ['### Sc 1-1 庭院 日/外 ·约10秒', `- **情绪目标**：${paragraph.repeat(3)}`, `- **氛围方向**：${paragraph.repeat(3)}`, `- **镜头意图**：${paragraph.repeat(3)}`, `- **空间叙事**：${paragraph.repeat(3)}`, '- **连续性锚点**：雨落。'] : [paragraph.repeat(8)]),
    ...(i === 5 ? ['- Sc 1 → Sc 2：风格词=水墨晕染；氛围词=战斗'] : []),
  ]), '</scriptPlan>'].join('\n');
  const semantics = { sceneViewpointId: 'courtyard', personFree: true, visibleCharacters: [], visibleProps: [], actionIn: '雨落', actionOut: '雨落' };
  const storyboard = ['<storyboardTable>', '| 序号 | 画面描述 | 场景 | 关联资产名称 | 时长 | 景别 | 运镜 | 角色动作 | 朝向 | 空间关系 | 情绪 | 台词 | 音效 | 关联资产ID | 出镜语义JSON |', '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|', `| 1 | 雨落。 | 庭院 | [] | 10 | 远景 | 静止 | 雨落 | 无 | 无 | 平静 | 无台词 | 无 | [] | ${JSON.stringify(semantics)} |`, '</storyboardTable>'].join('\n');
  const artifact = (stage: string, text: string): Chapter001StageArtifact => {
    const dims = ['facts', 'chronology', 'dialogue', 'stageBoundary', 'visibleCharacters'];
    const reviewText = JSON.stringify({ stage, passed: true, checks: Object.fromEntries(dims.map(dim => [dim, true])), evidence: Object.fromEntries(dims.map(dim => [dim, [{ outputQuote: '雨落', sourceQuote: '雨落', sourceKind: 'chapter', kind: 'physical_fact', supported: true, reason: '合成协议夹具，不是实际审核' }]])), findings: [] });
    return { text, sha256: sha(text), sourceSha256: snapshot.sourceSha256, reviewText, reviewSha256: sha(reviewText), primaryReview: { passed: true, reviewer: 'synthetic-fixture-only', outputSha256: sha(text), sourceSha256: snapshot.sourceSha256, reviewSha256: sha(reviewText) } };
  };
  const job: Chapter001ApplyJob = { projectId: CHAPTER001_PROJECT_ID, chapterId: 'chapter-001', manifestSha256: snapshot.manifestSha256, sourceSha256: snapshot.sourceSha256, stages: { script: artifact('script', script), planning: artifact('planning', plan), storyboard: artifact('storyboard', storyboard) } };
  job.stages.planning.scriptSha256 = sha(script);
  job.stages.storyboard.scriptSha256 = sha(script);
  job.stages.storyboard.planSha256 = sha(plan);
  return { snapshot, job };
}
function persistenceFixture() {
  const { snapshot, job } = fixture();
  const root = '/Users/zhengbingjin/Project/IP/MA';
  const state = structuredClone(snapshot.envelope.state);
  state.agentWorkData.push({ ...state.agentWorkData[0], id: 'old-first-chapter-work', episodeId: 'chapter-001' });
  state.novelChapters = state.novelChapters.map(chapter => chapter.id === 'chapter-001' ? chapter : { ...chapter, sourceText: 'synthetic archived source' });
  const plan = planStudioWorkflowShards(JSON.stringify({state, version: 11}), { emitChapterIndex: true });
  snapshot.projectRoot = root;
  snapshot.manifest = plan.manifest;
  snapshot.manifestRaw = JSON.stringify(plan.manifest);
  snapshot.manifestSha256 = sha(snapshot.manifestRaw);
  job.manifestSha256 = snapshot.manifestSha256;
  snapshot.shards = plan.files.filter(file => !file.name.startsWith('chapters/') || file.name.split('/')[1] === 'chapter-001').map(file => ({relativePath:file.name, content:file.content, sha256:sha(file.content)}));
  const merged = mergeStudioWorkflowShards(snapshot.shards.map(shard => shard.content));
  const chapters = merged.state.novelChapters as typeof state.novelChapters;
  merged.state.novelChapters = plan.manifest.chapterIndex!.map(entry => entry.id === 'chapter-001' ? chapters.find(chapter => chapter.id === entry.id)! : entry);
  merged.state.activeChapterId = 'chapter-001';
  snapshot.envelope = {state: merged.state as typeof state, version: 11};
  const files = new Map(plan.files.map(file => [path.join(root, 'store/studio-workflow', file.name), file.content]));
  files.set(path.join(root, 'store/studio-workflow/manifest.json'), snapshot.manifestRaw);
  files.set(path.join(root, 'store/studio-workflow/README.md'), workflowReadme);
  files.set(path.join(root, 'README.md'), projectReadme);
  files.set(path.join(root, 'backups/README.md'), backupsReadme);
  files.set(path.join(root, 'store/studio-workflow-store.json'), 'legacy preserved');
  snapshot.sourceFiles = ['store/studio-workflow/manifest.json', ...snapshot.shards.map(shard => 'store/studio-workflow/'+shard.relativePath)].map(relativePath => ({ relativePath, realpath: path.join(root, relativePath), sha256: sha(files.get(path.join(root, relativePath))!) }));
  const source = {read: (name: string) => files.get(name) ?? null, realpath: (name: string) => name};
  return {snapshot, job, files, source};
}

describe('chapter001 guarded real apply preflight', () => {
  it('replays the full production rehearsal and reports the unsafe lock before any write', async () => {
    const {snapshot, job, files, source} = persistenceFixture();
    const registryFile = '/synthetic/registry.json';
    files.set(registryFile, JSON.stringify({state:{projects:[{id:CHAPTER001_PROJECT_ID,location:snapshot.projectRoot}]}}));
    const before = JSON.stringify([...files]);
    const result = await prepareChapter001Apply1027(snapshot, job, {approved:true, registryFile, source});
    expect(result).toMatchObject({status:'blocked',realProjectWrites:0,deletes:0,realApplyImplemented:false});
    expect(result.blockers[0]).toMatch(/lock/);
    expect(result.rehearsal).toMatchObject({safeToApply:true,manifestLast:true,archivedChapters:4124});
    expect(JSON.stringify([...files])).toBe(before);
  });
  it('requires explicit opt-in before even reading the registry', async () => {
    const {snapshot,job} = persistenceFixture();
    const read = vi.fn(() => { throw new Error('unexpected read'); });
    await expect(prepareChapter001Apply1027(snapshot,job,{approved:false,registryFile:'/synthetic/registry',source:{read,realpath:x=>x}})).rejects.toThrow(/opt-in/);
    expect(read).not.toHaveBeenCalled();
  });
  it('rejects a foreign registered root before the rehearsal', async () => {
    const {snapshot,job,files,source} = persistenceFixture();
    files.set('/synthetic/registry',JSON.stringify({state:{projects:[{id:CHAPTER001_PROJECT_ID,location:'/foreign'}]}}));
    await expect(prepareChapter001Apply1027(snapshot,job,{approved:true,registryFile:'/synthetic/registry',source})).rejects.toThrow(/location/);
  });
  it('reuses the source hash gate rather than approving a stale baseline', async () => {
    const {snapshot,job,files,source} = persistenceFixture();
    files.set('/synthetic/registry',JSON.stringify({state:{projects:[{id:CHAPTER001_PROJECT_ID,location:snapshot.projectRoot}]}}));
    files.set(snapshot.sourceFiles[0].realpath,snapshot.manifestRaw+' ');
    await expect(prepareChapter001Apply1027(snapshot,job,{approved:true,registryFile:'/synthetic/registry',source})).rejects.toThrow(/live source changed/);
  });
  it('reuses the three-stage primary approval gate', async () => {
    const {snapshot,job,files,source} = persistenceFixture();
    files.set('/synthetic/registry',JSON.stringify({state:{projects:[{id:CHAPTER001_PROJECT_ID,location:snapshot.projectRoot}]}}));
    job.stages.storyboard.primaryReview.passed=false;
    await expect(prepareChapter001Apply1027(snapshot,job,{approved:true,registryFile:'/synthetic/registry',source})).rejects.toThrow(/primary review/);
  });
  it('rejects a fresh foreign lock through the actual production factory', async () => {
    const {snapshot,job,files,source} = persistenceFixture();
    files.set('/synthetic/registry',JSON.stringify({state:{projects:[{id:CHAPTER001_PROJECT_ID,location:snapshot.projectRoot}]}}));
    files.set(path.join(snapshot.projectRoot,'store/.storage-write-lock.json'),JSON.stringify({id:'foreign',ts:Date.now()}));
    await expect(prepareChapter001Apply1027(snapshot,job,{approved:true,registryFile:'/synthetic/registry',source})).rejects.toThrow(/production write rejected/);
  });
  it('rejects concurrent callers before replacing the shared production I/O adapter', async () => {
    const {snapshot,job,files,source} = persistenceFixture();
    files.set('/synthetic/registry',JSON.stringify({state:{projects:[{id:CHAPTER001_PROJECT_ID,location:snapshot.projectRoot}]}}));
    const options = {approved:true,registryFile:'/synthetic/registry',source};
    const results = await Promise.allSettled([prepareChapter001Apply1027(snapshot,job,options),prepareChapter001Apply1027(snapshot,job,options)]);
    expect(results[0].status).toBe('fulfilled');
    expect(results[1].status).toBe('rejected');
    if (results[1].status === 'rejected') expect(String(results[1].reason)).toMatch(/already running/);
  });
});

// Diagnostic tests prove the current unsafe contract, not a successful apply.
// Only I/O is injected. The planner, factory, hydration and write lock are real.
async function productionProbe(mode: 'acquire-race' | 'lost-owner' | 'fail-manifest' | 'normal') {
  const prefix = `_p/${CHAPTER001_PROJECT_ID}/studio-workflow/`;
  const manifestKey = prefix + 'manifest';
  const envelope = JSON.stringify({version:11,state:{novelChapters:[{id:'chapter-001',title:'合成',sourceId:'chapter-001',revision:3,sourceText:'雨落。',index:1}],activeChapterId:'chapter-001',sourceBible:'old'}});
  const plan = planStudioWorkflowShards(envelope,{emitChapterIndex:true});
  const files = new Map(plan.files.map(file=>[prefix+file.name.replace(/\.json$/,''),file.content]));
  files.set(manifestKey,JSON.stringify(plan.manifest));
  const oldManifest = files.get(manifestKey)!;
  const before = new Map(files);
  const writes: {key:string;owner:string}[] = [];
  let lock: {id:string;ts:number} | null = null;
  const oldWindow = (globalThis as unknown as {window:unknown}).window;
  let hydrated = false;
  const get = vi.spyOn(fileStorage,'getItem').mockImplementation(async key=>files.get(key)??null);
  const set = vi.spyOn(fileStorage,'setItem').mockImplementation(async (key,content)=>{
    if (mode === 'fail-manifest' && key === manifestKey) throw new Error('injected manifest publication failure');
    writes.push({key,owner:lock?.id??'none'}); files.set(key,content);
  });
  (globalThis as unknown as {window:unknown}).window = {
    fileStorage:{exists:async()=>false,listKeys:async()=>[],listDirs:async()=>[]},
    projectFiles:{
      readText:async ({relativePath}:{relativePath:string})=>({success:true,text:relativePath==='store/.storage-write-lock.json'?(lock===null?'null':JSON.stringify(lock)):relativePath==='studio-workflow/README.md'?workflowReadme:relativePath==='README.md'?projectReadme:backupsReadme}),
      writeBinary:async ({bytes}:{bytes:Uint8Array})=>{
        lock=JSON.parse(new TextDecoder().decode(bytes));
        // A second bundle read the same absent/stale lock before our write.
        if(mode==='acquire-race' && lock!.ts>0) lock={id:'fresh-foreign-owner',ts:Date.now()};
        return {success:true};
      },
    },
  };
  try {
    const storage=createStudioWorkflowShardedStorage('studio-workflow-store',{isHydrated:()=>hydrated});
    const loaded=await storage.getItem('studio-workflow-store');
    expect(loaded).not.toBeNull();
    hydrated=true;
    if(mode==='lost-owner') {
      await storage.setItem('studio-workflow-store',loaded!);
      writes.length=0;
      lock={id:'fresh-foreign-owner',ts:Date.now()};
    }
    const value=JSON.parse(loaded!); value.state.sourceBible='new';
    let failure='';
    try { await storage.setItem('studio-workflow-store',JSON.stringify(value)); }
    catch(error) { failure=String(error); }
    const reload=await createStudioWorkflowShardedStorage('studio-workflow-store',{isHydrated:()=>hydrated}).getItem('studio-workflow-store');
    return {writes,failure,oldManifest,currentManifest:files.get(manifestKey),reloaded:JSON.parse(reload!),oldBytesPreserved:[...before].every(([key,raw])=>files.get(key)===raw),manifestKey};
  } finally {
    // Test cleanup only; the blocked real entry never resets or overrides guards.
    await __resetModuleStorageWriteLockForTests();
    get.mockRestore(); set.mockRestore();
    (globalThis as unknown as {window:unknown}).window=oldWindow;
  }
}
describe('current production locking blockers (synthetic diagnostic evidence)',()=>{
  it('grants ownership to two actual lock instances that both read the same absent lock',async()=>{
    let readCount=0;
    let unblock!:()=>void;
    const bothRead=new Promise<void>(resolve=>{unblock=resolve;});
    const owners:string[]=[];
    const bridge={
      readText:async()=>{
        readCount+=1;
        if(readCount===2) unblock();
        await bothRead;
        return null;
      },
      writeBinary:async({bytes}:{bytes:Uint8Array})=>{
        const value=JSON.parse(new TextDecoder().decode(bytes)) as {id:string;ts:number};
        if(value.ts>0) owners.push(value.id);
        return {success:true};
      },
    };
    const first=createStorageWriteLock(()=>bridge);
    const second=createStorageWriteLock(()=>bridge);
    try {
      const verdicts=await Promise.all([first.ensure(CHAPTER001_PROJECT_ID),second.ensure(CHAPTER001_PROJECT_ID)]);
      expect(verdicts).toEqual([{ok:true},{ok:true}]);
      expect(new Set(owners).size).toBe(2);
      expect(readCount).toBe(2);
    } finally { await first.release(CHAPTER001_PROJECT_ID); await second.release(CHAPTER001_PROJECT_ID); }
  });
  it('commits a manifest while a fresh foreign lock wins the acquisition race',async()=>{
    const result=await productionProbe('acquire-race');
    expect(result.writes.length).toBeGreaterThan(0);
    expect(result.writes.every(write=>write.owner==='fresh-foreign-owner')).toBe(true);
    expect(result.writes.at(-1)?.key).toBe(result.manifestKey);
    expect(result.reloaded.state.sourceBible).toBe('new');
  });
  it('commits again after its cached held owner has been replaced by a fresh foreign owner',async()=>{
    const result=await productionProbe('lost-owner');
    expect(result.writes.length).toBeGreaterThan(0);
    expect(result.writes.every(write=>write.owner==='fresh-foreign-owner')).toBe(true);
    expect(result.reloaded.state.sourceBible).toBe('new');
  });
  it('publishes manifest last and reloads new domain values in the uncontended case',async()=>{
    const result=await productionProbe('normal');
    expect(result.failure).toBe('');
    expect(result.writes.at(-1)?.key).toBe(result.manifestKey);
    expect(result.reloaded.state.sourceBible).toBe('new');
  });
  it('keeps the previous readable generation on manifest failure, retaining new orphan shards without deletion',async()=>{
    const result=await productionProbe('fail-manifest');
    expect(result.failure).toMatch(/injected manifest publication failure/);
    expect(result.currentManifest).toBe(result.oldManifest);
    expect(result.oldBytesPreserved).toBe(true);
    expect(result.writes.some(write=>write.key!==result.manifestKey)).toBe(true);
    expect(result.reloaded.state.sourceBible).toBe('old');
  });
});
