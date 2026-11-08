import { normalizeContinuityAssetVersion, createHumanContinuityAssetApproval } from '@/lib/studio/visual-continuity';
import { normalizeStoredJson } from '@/electron/storage/pretty-json';
/** Synthetic fixtures; no real approval, project I/O, model or media claims. */
import path from 'node:path';
import { CHAPTER001_PROJECT_ID, chapter001Sha256 as sha, type Chapter001Snapshot, type Chapter001ApplyJob, type Chapter001StageArtifact } from './director_chapter001_bridge_1026.test';
import { preflightChapter001Offline1027, offlineBaselineHash1027, type OfflineApplyOptions, type OfflineFileAdapter } from './director_chapter001_offline_apply_1027.test';
import { REQUIRED_DIRECTOR_PLAN_SECTIONS } from '@/lib/studio/director-plan';
import { planStudioWorkflowShards, mergeStudioWorkflowShards } from '@/lib/storage/studio-workflow-shards';
import workflowReadme from '@/assets/docs/studio-workflow/README.md?raw';
import projectReadme from '@/assets/docs/project/README.md?raw';
import backupsReadme from '@/assets/docs/backups/README.md?raw';
import type { MediaFrame1027 } from './director_chapter001_media_publication_1027.test';

/** Exact successful boot.json shape; synthetic memory evidence, never a live receipt. */
export function syntheticMediaExecutionReceipt1027(frames:MediaFrame1027[]) {
  return {
    ok:true, generationAttempted:true, generationExecuted:true, denied:[],
    counts:{posts:frames.length,requests:2*frames.length,saves:frames.length},
    before:{empty:true,noFileStorage:true,noNode:true},
    renderer:{actualSingletonsHydrated:true,actualAiManagerImported:true,actualSingleShotEntryImported:true,projectWrites:0,generationExecuted:false},
    frames:structuredClone(frames),
    mainReadbacks:frames.map(({path,file,sha256,bytes})=>({path,file,sha256,bytes})),
  };
}
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
  const scene=normalizeContinuityAssetVersion({assetId:'scene:synthetic',versionId:'synthetic-scene',assetKind:'scene',label:'Synthetic only',referenceImagePaths:['/synthetic-scene.png'],reviewEvidencePaths:['/synthetic-scene-review_thumb.png'],reviewEvidenceSha256:['a'.repeat(64)],reviewEvidenceVerifiedAt:1,sceneViewpointId:'courtyard',spatialLayout:'courtyard',lightingDesign:'day',colorPalette:'ink',structurallyComplete:true,contentFingerprint:'',approved:false,source:'synthetic-only'});
  state.continuityAssetVersions=[createHumanContinuityAssetApproval(scene,{status:'approved',evidencePaths:scene.reviewEvidencePaths!,reviewedAt:1})];
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
export async function mediaPublicationFixture1027() {
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
