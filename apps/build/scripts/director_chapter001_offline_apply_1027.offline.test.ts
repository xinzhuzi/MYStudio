/** Synthetic fixtures; no real approval, project I/O, model or media claims. */
import { afterEach, describe, expect, it } from 'vitest';
import path from 'node:path';
import { CHAPTER001_PROJECT_ID, chapter001Sha256 as sha, type Chapter001Snapshot, type Chapter001ApplyJob, type Chapter001StageArtifact } from './director_chapter001_bridge_1026.test';
import { applyChapter001Offline1027, preflightChapter001Offline1027, offlineBaselineHash1027, OfflineApplyFailure1027, type OfflineApplyOptions, type OfflineFileAdapter } from './director_chapter001_offline_apply_1027.test';
import { REQUIRED_DIRECTOR_PLAN_SECTIONS } from '@/lib/studio/director-plan';
import { planStudioWorkflowShards, mergeStudioWorkflowShards } from '@/lib/storage/studio-workflow-shards';
import workflowReadme from '@/assets/docs/studio-workflow/README.md?raw';
import projectReadme from '@/assets/docs/project/README.md?raw';
import backupsReadme from '@/assets/docs/backups/README.md?raw';
import { __resetModuleStorageWriteLockForTests } from '@/lib/storage/storage-project-sharded';
import { normalizeStoredJson } from '@/electron/storage/pretty-json';
import { fileStorage } from '@/lib/storage/indexed-db-storage';
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
  const manifest = { layout: 'studio-workflow-shards-v1', version: 11, shards: ['core.json', 'chapters/chapter-002/sentinel.json'], activeChapterId: 'chapter-001', chapterIndex: index };
  const manifestRaw = JSON.stringify(manifest);
  const snapshot = {
    projectId: CHAPTER001_PROJECT_ID, projectRoot: '/synthetic-only', chapterId: 'chapter-001', manifestRaw, manifest, manifestSha256: sha(manifestRaw), sourceSha256: sha(chapter.sourceText),
    shards: [{ relativePath: 'core.json', content, sha256: sha(content) }], sourceFiles: [],
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
  snapshot.shards = plan.files.filter(file => !file.name.startsWith('chapters/') || file.name.split('/')[1] === 'chapter-001').map(file => ({relativePath:file.name, content:normalizeStoredJson(file.content), sha256:sha(normalizeStoredJson(file.content))}));
  const merged = mergeStudioWorkflowShards(snapshot.shards.map(shard => shard.content));
  const chapters = merged.state.novelChapters as typeof state.novelChapters;
  merged.state.novelChapters = plan.manifest.chapterIndex!.map(entry => entry.id === 'chapter-001' ? chapters.find(chapter => chapter.id === entry.id)! : entry);
  merged.state.activeChapterId = 'chapter-001';
  snapshot.envelope = {state: merged.state as typeof state, version: 11};
  const files = new Map(plan.files.map(file => [path.join(root, 'store/studio-workflow', file.name), normalizeStoredJson(file.content)]));
  files.set(path.join(root, 'store/studio-workflow/manifest.json'), snapshot.manifestRaw);
  files.set(path.join(root, 'store/studio-workflow/README.md'), workflowReadme);
  files.set(path.join(root, 'README.md'), projectReadme);
  files.set(path.join(root, 'backups/README.md'), backupsReadme);
  files.set(path.join(root, 'store/studio-workflow-store.json'), 'legacy preserved');
  snapshot.sourceFiles = ['store/studio-workflow/manifest.json', ...snapshot.shards.map(shard => 'store/studio-workflow/'+shard.relativePath)].map(relativePath => ({ relativePath, realpath: path.join(root, relativePath), sha256: sha(files.get(path.join(root, relativePath))!) }));
  const source = {read: (name: string) => files.get(name) ?? null, realpath: (name: string) => name};
  return {snapshot, job, files, source};
}

const task = path.resolve(import.meta.dirname,'../../../.trellis/tasks/10-25-daojie-director-rule-conflict-validation');
afterEach(async () => { await __resetModuleStorageWriteLockForTests(); });
async function offlineFixture() {
  const f = persistenceFixture();
  const registryFile = '/Users/zhengbingjin/Project/IP/漫影工作室/projects/mystudio-project-store.json';
  const registry = JSON.stringify({state:{projects:[{id:CHAPTER001_PROJECT_ID,location:f.snapshot.projectRoot}]}});
  f.files.set(registryFile,registry);
  const approval = path.join(task,'research/chapter001-offline-apply-1027/synthetic-root-receipt.json');
  f.files.set(approval,'synthetic root/build/media receipt');
  const changes: string[] = [];
  const io: OfflineFileAdapter = {
    read: name => f.files.has(name) ? Buffer.from(f.files.get(name)!) : null,
    realpath: name => name,
    exclusive: (name,bytes,guard) => { guard(); if(f.files.has(name)) throw new Error('exclusive claim/output already exists'); f.files.set(name,bytes.toString('utf8')); changes.push(name); },
    atomic: (name,bytes,guard) => { guard(); f.files.set(name,bytes.toString('utf8')); changes.push(name); },
  };
  const rehearsal = await preflightChapter001Offline1027(f.snapshot,f.job,io);
  const options: OfflineApplyOptions = {approved:true,registryFile,files:io,processes:() => [{pid:1234,command:'/usr/bin/node'}],window:{operator:'root',id:'synthetic-window',startedAt:Date.now()-1000,expiresAt:Date.now()+60000,assertion:'all-installed-and-dev-MYStudio-Electron-writers-stopped',snapshotSha256:sha(JSON.stringify(f.snapshot)),jobSha256:sha(JSON.stringify(f.job)),registrySha256:sha(registry),baselineSha256:offlineBaselineHash1027(rehearsal.baselineHashes),receipts:[{file:approval,sha256:sha(f.files.get(approval)!)}]}};
  return {...f,io,options,changes};
}
describe('exclusive offline apply', () => {
  it('rejects a live installed App and development Electron before any mutation', async () => {
    for (const command of ['/Applications/MYStudio.app/Contents/MacOS/MYStudio','/repo/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron']) {
      const f = await offlineFixture(); f.options.processes = () => [{pid:7,command}];
      await expect(applyChapter001Offline1027(f.snapshot,f.job,f.options)).rejects.toThrow(/writer process/);
      expect(f.changes).toEqual([]);
    }
  });
  it('saves manifest last once, freshly reloads the actual factory, preserves other4124 and backs up exact original bytes', async () => {
    const f = await offlineFixture(); const before = new Map(f.files);
    const result = await applyChapter001Offline1027(f.snapshot,f.job,f.options);
    expect(result).toMatchObject({status:'applied',hydrated:true,manifestLast:true,archivedChapters:4124,archivedShardHashesUnchanged:true,sourceIdentityUnchanged:true,rollbackAttempted:false});
    const writes = result.mutations as {relativePath:string;kind:string}[];
    expect(writes.filter(row => row.kind === 'data').at(-1)?.relativePath).toBe('store/studio-workflow/manifest.json');
    expect(writes.filter(row => row.relativePath === 'store/studio-workflow/manifest.json')).toHaveLength(1);
    const backups = result.backups as {relativePath:string;existed:boolean;backupFile:string|null}[];
    expect(backups.some(row => !row.existed)).toBe(true);
    for(const row of backups.filter(row => row.existed && row.relativePath !== 'store/.storage-write-lock.json')) expect(f.files.get(row.backupFile!)).toBe(before.get(path.join(f.snapshot.projectRoot,row.relativePath)));
    expect(f.files.get(path.join(f.snapshot.projectRoot,'store/.storage-write-lock.json'))).toContain('"ts":0');
  });
  it('rejects stale original sources, changed registry, baseline hash and foreign fresh lock', async () => {
    for (const mode of ['source','registry','baseline','lock']) {
      const f = await offlineFixture();
      if(mode === 'source') f.files.set(f.snapshot.sourceFiles[1].realpath,f.source.read(f.snapshot.sourceFiles[1].realpath)+' ');
      if(mode === 'registry') f.files.set(f.options.registryFile,f.source.read(f.options.registryFile)+' ');
      if(mode === 'baseline') f.options.window.baselineSha256 = 'bad';
      if(mode === 'lock') f.files.set(path.join(f.snapshot.projectRoot,'store/.storage-write-lock.json'),JSON.stringify({id:'foreign',ts:Date.now()}));
      await expect(applyChapter001Offline1027(f.snapshot,f.job,f.options)).rejects.toThrow(/drift|binding|baseline|foreign fresh/);
      expect(f.changes).toEqual([]);
    }
  });
  it('rejects a second invocation before replacing shared production adapters', async () => {
    const f = await offlineFixture();
    const result = await Promise.allSettled([applyChapter001Offline1027(f.snapshot,f.job,f.options),applyChapter001Offline1027(f.snapshot,f.job,f.options)]);
    expect(result[0].status).toBe('fulfilled'); expect(result[1].status).toBe('rejected');
    if(result[1].status === 'rejected') expect(String(result[1].reason)).toMatch(/already running/);
    await expect(applyChapter001Offline1027(f.snapshot,f.job,f.options)).rejects.toThrow(/original source drift|exclusive/);
  });
  it('preserves original manifest and old generation on publication failure, retaining unreferenced new shards and backups', async () => {
    const f = await offlineFixture(); const before = new Map(f.files);
    const atomic = f.io.atomic;
    f.io.atomic = (name,bytes,guard) => { if(name.endsWith('/manifest.json')) throw new Error('injected publication failure'); atomic(name,bytes,guard); };
    let failure: unknown;
    try { await applyChapter001Offline1027(f.snapshot,f.job,f.options); } catch(error) { failure = error; }
    expect(failure).toBeInstanceOf(OfflineApplyFailure1027);
    expect((failure as OfflineApplyFailure1027).receipt).toMatchObject({status:'blocked',originalManifestPreserved:true,publicationObserved:false,rollbackAttempted:false});
    for(const [name,raw] of before) expect(f.files.get(name)).toBe(raw);
    expect([...f.files.keys()].filter(name => !before.has(name) && name.includes('/store/studio-workflow/')).length).toBeGreaterThan(0);
    expect([...f.files.values()]).toContain(f.snapshot.manifestRaw);
  });
  it.each([false,true])('preserves the receipt and resets adapters after temp inspection errors (published=%s)', async published => {
    const f = await offlineFixture(); const atomic = f.io.atomic; const read = f.io.read;
    const oldGet = fileStorage.getItem, oldSet = fileStorage.setItem;
    const oldWindow = (globalThis as unknown as {window?:unknown}).window;
    const temporary = ['/synthetic-unreadable-a','/synthetic-retained','/synthetic-missing','/synthetic-unreadable-b'];
    const inspected: string[] = [];
    f.io.temporaryFiles = temporary;
    f.files.set(temporary[1],'retained bytes');
    f.io.read = name => {
      if(temporary.includes(name)) {
        inspected.push(name);
        if(name === temporary[0] || name === temporary[3]) throw new Error('injected temp EIO: '+name);
      }
      return read(name);
    };
    f.io.atomic = (name,bytes,guard) => {
      if(!published && name.endsWith('/manifest.json')) throw new Error('injected publication failure');
      atomic(name,bytes,guard);
    };
    let failure: unknown;
    try { await applyChapter001Offline1027(f.snapshot,f.job,f.options); } catch(error) { failure = error; }
    expect(failure).toBeInstanceOf(OfflineApplyFailure1027);
    const receipt = (failure as OfflineApplyFailure1027).receipt;
    const current = f.files.get(f.snapshot.sourceFiles[0].realpath)!;
    expect(receipt).toMatchObject({status:'blocked',publicationObserved:published,originalManifestPreserved:!published,currentManifestSha256:sha(current),rollbackAttempted:false,deletes:0});
    expect(receipt.blocker).toBe(published ? 'temporary file inspection failed' : 'injected publication failure');
    expect(receipt.retainedTemporaryFiles).toEqual([temporary[0],temporary[1],temporary[3]]);
    expect(receipt.temporaryInspectionErrors).toEqual([temporary[0],temporary[3]].map(file => ({file,error:'Error: injected temp EIO: '+file})));
    expect(inspected).toEqual(temporary);
    const mutations = receipt.mutations as {kind:string;relativePath:string}[];
    expect(receipt.dataWrites).toBe(mutations.filter(row => row.kind === 'data').length);
    expect(Number(receipt.dataWrites)).toBeGreaterThan(0);
    const backups = receipt.backups as {relativePath:string;backupFile:string|null}[];
    const manifestBackup = backups.find(row => row.relativePath === 'store/studio-workflow/manifest.json');
    expect(f.files.get(manifestBackup!.backupFile!)).toBe(f.snapshot.manifestRaw);
    if(published) expect(receipt).toMatchObject({hydrated:true,manifestLast:true,manifestSha256:sha(current)});
    expect(fileStorage.getItem).toBe(oldGet); expect(fileStorage.setItem).toBe(oldSet);
    expect((globalThis as unknown as {window?:unknown}).window).toBe(oldWindow);
    await __resetModuleStorageWriteLockForTests();
    const next = await offlineFixture();
    next.options.processes = () => [{pid:7,command:'/Applications/MYStudio.app/Contents/MacOS/MYStudio'}];
    await expect(applyChapter001Offline1027(next.snapshot,next.job,next.options)).rejects.toThrow(/writer process present/);
    expect(next.changes).toEqual([]);
  });
  it('preserves an early refusal receipt when temp and manifest inspection both fail', async () => {
    const f = await offlineFixture(); const read = f.io.read;
    f.options.processes = () => [{pid:7,command:'/Applications/MYStudio.app/Contents/MacOS/MYStudio'}];
    f.io.temporaryFiles = ['/synthetic-unreadable'];
    f.io.read = name => {
      if(name === '/synthetic-unreadable' || name === f.snapshot.sourceFiles[0].realpath) throw new Error('injected inspection EIO');
      return read(name);
    };
    let failure: unknown;
    try { await applyChapter001Offline1027(f.snapshot,f.job,f.options); } catch(error) { failure = error; }
    expect(failure).toBeInstanceOf(OfflineApplyFailure1027);
    expect((failure as OfflineApplyFailure1027).receipt).toMatchObject({status:'blocked',backups:[],mutations:[],dataWrites:0,publicationObserved:false,retainedTemporaryFiles:['/synthetic-unreadable'],temporaryInspectionErrors:[{file:'/synthetic-unreadable',error:'Error: injected inspection EIO'}],inspectionError:'Error: injected inspection EIO'});
    expect((failure as OfflineApplyFailure1027).receipt.blocker).toMatch(/writer process present/);
    expect(f.changes).toEqual([]);
  });
  it('fences every data write when a foreign owner or new App appears after acquisition', async () => {
    for(const mode of ['lock','process','source','manifest']) {
      const f = await offlineFixture(); const atomic = f.io.atomic; let acquired = false;
      f.options.processes = () => [{pid:1234,command:mode === 'process' && acquired ? '/Applications/MYStudio.app/Contents/MacOS/MYStudio' : '/usr/bin/node'}];
      f.io.atomic = (name,bytes,guard) => {
        atomic(name,bytes,guard);
        if(name.endsWith('/.storage-write-lock.json') && !acquired) {
          acquired = true;
          if(mode === 'lock') f.files.set(name,JSON.stringify({id:'foreign',ts:Date.now()}));
          if(mode === 'source') f.files.set(f.snapshot.sourceFiles[1].realpath,f.source.read(f.snapshot.sourceFiles[1].realpath)+' ');
          if(mode === 'manifest') f.files.set(f.snapshot.sourceFiles[0].realpath,'foreign manifest');
        }
      };
      await expect(applyChapter001Offline1027(f.snapshot,f.job,f.options)).rejects.toThrow(/ownership|writer process|drift|readback/);
      expect(f.changes.filter(name => name.includes('/store/studio-workflow/'))).toEqual([]);
      if(mode === 'manifest') expect(f.files.get(f.snapshot.sourceFiles[0].realpath)).toBe('foreign manifest');
      if(mode === 'lock') expect(f.files.get(path.join(f.snapshot.projectRoot,'store/.storage-write-lock.json'))).toContain('foreign');
    }
  });
  it('never restores over a foreign manifest observed after publication', async () => {
    const f = await offlineFixture(); const atomic = f.io.atomic;
    f.io.atomic = (name,bytes,guard) => { atomic(name,bytes,guard); if(name.endsWith('/manifest.json')) f.files.set(name,'foreign committed manifest'); };
    let failure: unknown;
    try { await applyChapter001Offline1027(f.snapshot,f.job,f.options); } catch(error) { failure = error; }
    expect(failure).toBeInstanceOf(OfflineApplyFailure1027);
    expect((failure as OfflineApplyFailure1027).receipt).toMatchObject({status:'blocked',originalManifestPreserved:false,publicationObserved:true,rollbackAttempted:false});
    expect(f.files.get(f.snapshot.sourceFiles[0].realpath)).toBe('foreign committed manifest');
  });
  it('rejects README repair, expired window, missing approval and uncertain process inventory', async () => {
    for(const mode of ['README','expiry','approval','process']) {
      const f = await offlineFixture();
      if(mode === 'README') f.files.set(path.join(f.snapshot.projectRoot,'store/studio-workflow/README.md'),'changed readme');
      if(mode === 'expiry') f.options.window.expiresAt = Date.now()-1;
      if(mode === 'approval') f.job.stages.script.primaryReview.passed = false;
      if(mode === 'process') f.options.processes = () => [];
      await expect(applyChapter001Offline1027(f.snapshot,f.job,f.options)).rejects.toThrow();
      expect(f.changes).toEqual([]);
    }
  });
});
