/** Synthetic protocol fixtures only. No real source read, model or human acceptance. */
import { describe, expect, it } from 'vitest';
import { applyChapter001InMemory, CHAPTER001_PROJECT_ID, chapter001Sha256 as sha, validateChapter001Snapshot, type Chapter001Snapshot, type Chapter001ApplyJob, type Chapter001StageArtifact } from './director_chapter001_bridge_1026.test';
import { REQUIRED_DIRECTOR_PLAN_SECTIONS } from '@/lib/studio/director-plan';

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
function replaceReview(artifact: Chapter001StageArtifact, reviewText: string) {
  artifact.reviewText = reviewText;
  artifact.reviewSha256 = sha(reviewText);
  artifact.primaryReview.reviewSha256 = artifact.reviewSha256;
}

describe('chapter001 detached production apply (synthetic only)', () => {
  it('rejects wrong project before any action', async () => {
    const { snapshot, job } = fixture();
    job.projectId = 'wrong';
    await expect(applyChapter001InMemory(snapshot, job)).rejects.toThrow(/project/);
  });
  it('rejects missing audit before any action', async () => {
    const { snapshot, job } = fixture();
    job.stages.script.reviewText = '';
    await expect(applyChapter001InMemory(snapshot, job)).rejects.toThrow(/missing audit/);
  });
  it('replays real parsers and slices, preserves 4124 chapter stubs and other work, and plans empty frames', async () => {
    const { snapshot, job } = fixture();
    const original = JSON.stringify(snapshot);
    const result = await applyChapter001InMemory(snapshot, job);
    expect(result.envelope.state.novelChapters).toEqual(snapshot.envelope.state.novelChapters);
    expect(result.envelope.state.novelChapters).toHaveLength(4125);
    expect(result.envelope.state.agentWorkData.find(item => item.id === 'other-work')).toEqual(snapshot.envelope.state.agentWorkData[0]);
    expect(result.envelope.state.unknownField).toEqual({ preserve: '全部源字段' });
    expect(result.envelope.state.scriptPlans[0].sourceScript?.entryId).toBe(result.envelope.state.agentWorkData.find(item => item.key === 'scriptDraft' && item.episodeId === 'chapter-001')?.id);
    expect(result.envelope.state.storyboards).toHaveLength(1);
    expect(result.envelope.state.storyboards[0].shotSemantics?.personFree).toBe(true);
    expect(result.envelope.state.storyboards[0].keyframes).toHaveLength(2);
    expect(result.envelope.state.storyboards[0].keyframes!.every(frame => frame.mediaRef.path === '')).toBe(true);
    expect(result.diff).toMatchObject({ durations: { script: 10, planning: 10, storyboard: 10 }, projectWrites: 0, generatedImages: 0, otherChaptersUnchanged: true, otherChapterShardNames: ['chapters/chapter-002/sentinel.json'] });
    expect(JSON.stringify(snapshot)).toBe(original);
  });
  it('refuses a source change during audit replay and leaves supplied window untouched', async () => {
    const { snapshot, job } = fixture();
    let reads = 0;
    const original = JSON.stringify(snapshot);
    await expect(applyChapter001InMemory(snapshot, job, () => {
      if (++reads === 1) return snapshot;
      return { ...snapshot, sourceSha256: sha('changed') };
    })).rejects.toThrow(/source changed/);
    expect(JSON.stringify(snapshot)).toBe(original);
  });
  it('rejects a changed upstream script hash', async () => {
    const { snapshot, job } = fixture();
    job.stages.planning.scriptSha256 = sha('different script');
    await expect(applyChapter001InMemory(snapshot, job)).rejects.toThrow(/upstream script/);
  });
  it('rejects five true checks without grounded evidence', async () => {
    const { snapshot, job } = fixture();
    const review = JSON.parse(job.stages.script.reviewText);
    delete review.evidence;
    replaceReview(job.stages.script, JSON.stringify(review));
    await expect(applyChapter001InMemory(snapshot, job)).rejects.toThrow(/audit rejected/);
  });
  it('rejects missing primary approval even with a valid synthetic audit', async () => {
    const { snapshot, job } = fixture();
    job.stages.script.primaryReview.passed = false;
    await expect(applyChapter001InMemory(snapshot, job)).rejects.toThrow(/primary review/);
  });
  it('rejects duration drift before returning a persistence envelope', async () => {
    const { snapshot, job } = fixture();
    job.stages.planning.text = job.stages.planning.text.replace('·约10秒', '·约11秒');
    job.stages.planning.sha256 = sha(job.stages.planning.text);
    job.stages.planning.primaryReview.outputSha256 = job.stages.planning.sha256;
    await expect(applyChapter001InMemory(snapshot, job)).rejects.toThrow(/duration mismatch/);
  });
  it('rejects a tampered envelope instead of trusting exported projection', () => {
    const { snapshot } = fixture();
    snapshot.envelope.state.sourceBible = 'changed';
    expect(() => validateChapter001Snapshot(snapshot)).toThrow(/envelope changed/);
  });
});
