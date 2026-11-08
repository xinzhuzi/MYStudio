/** Synthetic fixtures; no real approval, project I/O, model or media claims. */
import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { CHAPTER001_PROJECT_ID, chapter001Sha256 as sha, type Chapter001Snapshot, type Chapter001ApplyJob, type Chapter001StageArtifact } from './director_chapter001_bridge_1026.test';
import { dryRunChapter001Persistence } from './director_chapter001_persist_1026.test';
import { REQUIRED_DIRECTOR_PLAN_SECTIONS } from '@/lib/studio/director-plan';
import { planStudioWorkflowShards, mergeStudioWorkflowShards } from '@/lib/storage/studio-workflow-shards';
import workflowReadme from '@/assets/docs/studio-workflow/README.md?raw';
import projectReadme from '@/assets/docs/project/README.md?raw';
import backupsReadme from '@/assets/docs/backups/README.md?raw';
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

describe('chapter001 real production persistence dry-run', () => {
  it('persists through the production factory and retains every archived byte without any real writes', async () => {
    const {snapshot, job, files, source} = persistenceFixture();
    const before = JSON.stringify([...files]);
    const result = await dryRunChapter001Persistence(snapshot, job, source);
    expect(result).toMatchObject({ mode:'dry-run', safeToApply:true, realProjectWrites:0, deletes:0, manifestLast:true, archivedChapters:4124, archivedBytesUnchanged:true, hydrated:true });
    expect(result.writes.at(-1)?.relativePath).toBe('store/studio-workflow/manifest.json');
    expect(result.reloaded.state.storyboards).toHaveLength(1);
    expect(result.reloaded.state.novelChapters).toHaveLength(4125);
    expect(result.preserved).toContain('store/studio-workflow-store.json');
    expect(result.lockOperations.some(op => op.operation === 'writeBinary')).toBe(true);
    expect(JSON.stringify([...files])).toBe(before);
  });
  it('rejects an incorrect project, chapter or root before production writes', async () => {
    for (const field of ['projectId', 'chapterId', 'projectRoot'] as const) {
      const {snapshot, job, source} = persistenceFixture();
      snapshot[field] = 'wrong';
      await expect(dryRunChapter001Persistence(snapshot, job, source)).rejects.toThrow(/project/);
    }
  });
  it('rejects missing approval and stale upstream receipts', async () => {
    const first = persistenceFixture();
    first.job.stages.script.primaryReview.passed = false;
    await expect(dryRunChapter001Persistence(first.snapshot, first.job, first.source)).rejects.toThrow(/primary review/);
    const second = persistenceFixture();
    second.job.stages.storyboard.planSha256 = sha('wrong upstream');
    await expect(dryRunChapter001Persistence(second.snapshot, second.job, second.source)).rejects.toThrow(/upstream plan/);
  });
  it('rejects a changed current source hash and duplicated source records', async () => {
    const first = persistenceFixture();
    first.files.set(first.snapshot.sourceFiles[0].realpath, first.snapshot.manifestRaw + ' ');
    await expect(dryRunChapter001Persistence(first.snapshot, first.job, first.source)).rejects.toThrow(/live source changed/);
    const second = persistenceFixture();
    second.snapshot.sourceFiles[1] = second.snapshot.sourceFiles[0];
    await expect(dryRunChapter001Persistence(second.snapshot, second.job, second.source)).rejects.toThrow(/sourceFiles scope/);
  });
  it('rejects changed archived bytes even though they are outside the hydrated window', async () => {
    const {snapshot,job,source} = persistenceFixture();
    const name = path.join(snapshot.projectRoot, 'store/studio-workflow', snapshot.manifest.shards.find(name => name.startsWith('chapters/chapter-002/'))!);
    let reads = 0;
    await expect(dryRunChapter001Persistence(snapshot,job,{...source,read: file => {
      const raw = source.read(file);
      return file === name && ++reads > 1 ? raw + ' ' : raw;
    }})).rejects.toThrow(/baseline conflict/);
  });
  it('refuses to bypass a fresh foreign production write lock', async () => {
    const {snapshot,job,files,source} = persistenceFixture();
    files.set(path.join(snapshot.projectRoot, 'store/.storage-write-lock.json'),JSON.stringify({id:'foreign-instance',ts:Date.now()}));
    await expect(dryRunChapter001Persistence(snapshot,job,source)).rejects.toThrow(/production write rejected/);
  });
  it('records exact README repair writes and blocks a manifest-last claim', async () => {
    const {snapshot,job,files,source} = persistenceFixture();
    files.set(path.join(snapshot.projectRoot,'store/studio-workflow/README.md'), 'drifted readme');
    const result = await dryRunChapter001Persistence(snapshot,job,source);
    expect(result).toMatchObject({safeToApply:false,manifestLast:false,realProjectWrites:0,deletes:0});
    expect(result.writes.at(-1)).toMatchObject({relativePath:'store/studio-workflow/README.md', content:workflowReadme});
    expect(result.blockers[0]).toMatch(/after manifest/);
    expect(files.get(path.join(snapshot.projectRoot,'store/studio-workflow/README.md'))).toBe('drifted readme');
  });
  it('rejects an unsafe source shard path without reading outside the project', async () => {
    const {snapshot,job,files,source} = persistenceFixture();
    const original = snapshot.manifest.shards.find(name => name.startsWith('chapters/chapter-002/'))!;
    snapshot.manifest.shards[snapshot.manifest.shards.indexOf(original)] = 'chapters/../../escape.json';
    snapshot.manifestRaw = JSON.stringify(snapshot.manifest);
    snapshot.manifestSha256 = sha(snapshot.manifestRaw);
    job.manifestSha256 = snapshot.manifestSha256;
    snapshot.sourceFiles[0].sha256 = snapshot.manifestSha256;
    files.set(snapshot.sourceFiles[0].realpath,snapshot.manifestRaw);
    await expect(dryRunChapter001Persistence(snapshot,job,source)).rejects.toThrow(/invalid window manifest|unsafe relative path/);
  });

  it('rejects overlapping rehearsals before their shared production adapter can be replaced', async () => {
    const {snapshot,job,source} = persistenceFixture();
    const results = await Promise.allSettled([dryRunChapter001Persistence(snapshot,job,source),dryRunChapter001Persistence(snapshot,job,source)]);
    expect(results[0].status).toBe('fulfilled');
    expect(results[1].status).toBe('rejected');
    if (results[1].status === 'rejected') expect(String(results[1].reason)).toMatch(/already running/);
  });

});
