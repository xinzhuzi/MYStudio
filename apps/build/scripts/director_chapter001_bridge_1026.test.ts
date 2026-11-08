/** Task-only offline apply. No user-project write mode or model transport exists. */
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { it } from 'vitest';
import { mergeStudioWorkflowShards, parseStudioWorkflowShardManifest, buildAttributionContextFromState, chapterKeyOfDomainItem } from '@/lib/storage/studio-workflow-shards';
import { auditDirectorPlanStructure, parseDirectorPlan } from '@/lib/studio/director-plan';
import { reviewDaojieGeneration, type DaojieGenerationStage } from '@/lib/studio/daojie-generation-audit';
import { parseStoryboardTable, toStoryboardItems } from '@/lib/studio/storyboard-table';
import { analyzeScriptDraft } from '@/lib/studio/script-draft-metrics';
import { planStoryboardKeyframes } from '@/lib/studio/storyboard-frame-planner';
import { groupStoryboardsIntoTracks } from '@/lib/studio/production';
import { formatScriptPlanContext, scriptPlanSourceFingerprint } from '@/components/panels/studio/workflow-helpers';
import { createAgentWorkSliceActions } from '@/stores/studio/agent-work-slice';
import { createEntitySliceActions } from '@/stores/studio/entity-slice';
import { createStoryboardSliceActions } from '@/stores/studio/storyboard-slice';
import { createRunTaskSliceActions } from '@/stores/studio/run-task-slice';
import { markStale, trackSourceFingerprint } from '@/stores/studio/studio-store-continuity-helpers';
import type { StudioWorkflowState } from '@/stores/studio/studio-store';

export const CHAPTER001_PROJECT_ID = '49dce4c1-64b1-42de-85c2-9f266698aec4';
const chapterId = 'chapter-001';
const projectRoot = '/Users/zhengbingjin/Project/IP/MA';
const research = path.resolve(import.meta.dirname, '../../../.trellis/tasks/10-25-daojie-director-rule-conflict-validation/research/chapter001-repair-1026');

type WindowState = StudioWorkflowState & Record<string, unknown>;
export interface Chapter001Snapshot {
  projectId: string; projectRoot: string; chapterId: string; manifestRaw: string; manifestSha256: string; sourceSha256: string;
  manifest: { version: number; shards: string[]; activeChapterId?: string | null; chapterIndex?: Record<string, unknown>[] };
  sourceFiles: { relativePath: string; realpath: string; sha256: string }[];
  shards: { relativePath: string; content: string; sha256: string }[];
  envelope: { state: WindowState; version: number };
  input: { episodeId: string; chapterTitle: string; chapterText: string; bibleContext: string; assetsInventory: string };
}
export interface Chapter001StageArtifact {
  text: string; sha256: string; sourceSha256: string; scriptSha256?: string; planSha256?: string;
  reviewText: string; reviewSha256: string;
  primaryReview: { passed: boolean; reviewer: string; outputSha256: string; sourceSha256: string; reviewSha256: string };
}
export interface Chapter001ApplyJob {
  projectId: string; chapterId: string; manifestSha256: string; sourceSha256: string;
  stages: Record<DaojieGenerationStage, Chapter001StageArtifact>;
}
export function chapter001Sha256(raw: string): string { return createHash('sha256').update(raw).digest('hex'); }
function requireBridge(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }

/** Rebuild from original bytes through production merge; no inferred defaults/migration. */
export function validateChapter001Snapshot(snapshot: Chapter001Snapshot): void {
  requireBridge(snapshot.projectId === CHAPTER001_PROJECT_ID && snapshot.chapterId === chapterId, 'project/chapter mismatch');
  const manifest = parseStudioWorkflowShardManifest(snapshot.manifestRaw);
  requireBridge(manifest?.chapterIndex && manifest.activeChapterId === chapterId, 'invalid window manifest');
  requireBridge(chapter001Sha256(snapshot.manifestRaw) === snapshot.manifestSha256 && isDeepStrictEqual(manifest, snapshot.manifest), 'manifest changed');
  const wanted = manifest.shards.filter(name => !name.startsWith('chapters/') || name.split('/')[1] === chapterId);
  requireBridge(isDeepStrictEqual(snapshot.shards.map(item => item.relativePath), wanted), 'shard window mismatch');
  for (const shard of snapshot.shards) requireBridge(chapter001Sha256(shard.content) === shard.sha256, 'shard changed');
  const merged = mergeStudioWorkflowShards(snapshot.shards.map(item => item.content));
  const chapters = merged.state.novelChapters as WindowState['novelChapters'];
  const chapter = chapters?.find(item => item.id === chapterId);
  requireBridge(chapter?.sourceText && chapter.sourceId && Number.isInteger(chapter.revision), 'chapter source identity missing');
  merged.state.novelChapters = manifest.chapterIndex.map(item => item.id === chapterId ? chapter : item);
  merged.state.activeChapterId = chapterId;
  requireBridge(snapshot.envelope.version === manifest.version && isDeepStrictEqual(snapshot.envelope.state, merged.state), 'envelope changed');
  requireBridge(merged.state.seriesBible && (merged.state.seriesBible as WindowState['seriesBible'])?.projectId === snapshot.projectId, 'project identity mismatch');
  requireBridge(snapshot.input.episodeId === chapterId && snapshot.input.chapterTitle === chapter.title && snapshot.input.chapterText === chapter.sourceText && chapter001Sha256(chapter.sourceText) === snapshot.sourceSha256, 'source changed');
  requireBridge(snapshot.input.bibleContext === (merged.state.sourceBible ?? ''), 'bible changed');
  requireBridge((merged.state.workflowConfig as WindowState['workflowConfig'])?.directorManualId === 'Daojie_xianxia', 'director configuration mismatch');
}

function otherChapterProjection(state: WindowState) {
  const context = buildAttributionContextFromState(state);
  return Object.fromEntries(Object.entries(state).filter(([, value]) => Array.isArray(value)).map(([key, value]) => [key, (value as unknown[]).filter(item => {
    const id = chapterKeyOfDomainItem(key, item, context);
    return id !== null && id !== chapterId;
  })]));
}

/** Source/config/envelope equality is checked after every asynchronous audit replay. */
export async function applyChapter001InMemory(snapshot: Chapter001Snapshot, job: Chapter001ApplyJob, current: () => Chapter001Snapshot = () => snapshot) {
  requireBridge(snapshot.projectId === CHAPTER001_PROJECT_ID && job.projectId === snapshot.projectId && job.chapterId === chapterId, 'project/chapter mismatch');
  requireBridge(job.stages && ['script', 'planning', 'storyboard'].every(stage => Boolean(job.stages[stage as DaojieGenerationStage]?.reviewText)), 'missing audit');
  validateChapter001Snapshot(snapshot);
  requireBridge(job.manifestSha256 === snapshot.manifestSha256 && job.sourceSha256 === snapshot.sourceSha256, 'source changed');
  const frozen = JSON.stringify(snapshot);
  const checkCurrent = () => {
    const live = current();
    validateChapter001Snapshot(live);
    requireBridge(JSON.stringify(live) === frozen, 'source/config/upstream changed');
  };
  checkCurrent();
  const state = structuredClone(snapshot.envelope.state);
  const before = structuredClone(state);
  const source = state.novelChapters.find(item => item.id === chapterId)!;
  const identity = { sourceId: source.sourceId!, revision: source.revision! };
  const actions: Record<string, unknown> = {};
  const set = (update: Partial<WindowState> | ((value: WindowState) => Partial<WindowState>)) => Object.assign(state, typeof update === 'function' ? update(state) : update);
  const get = () => ({ ...state, ...actions });
  const tasks = createRunTaskSliceActions(set as never, get as never);
  const work = createAgentWorkSliceActions(set as never, get as never);
  const entities = createEntitySliceActions(set as never);
  // Same pure production grouping/fingerprint logic as studio-store.rebuildTracks,
  // constrained to this chapter; other-chapter track records stay byte-equivalent.
  const rebuildTracks = () => {
    const existing = new Map(state.productionTracks.map(track => [track.trackKey, track]));
    const staleIds = new Set<string>();
    const rebuilt = groupStoryboardsIntoTracks(state.storyboards).filter(track => track.episodeId === chapterId).map(track => {
      const old = existing.get(track.trackKey);
      const fingerprint = trackSourceFingerprint(track, state.storyboards);
      const changed = Boolean(old?.sourceFingerprint && old.sourceFingerprint !== fingerprint && (old.candidateVideoIds.length || old.selectedVideoId));
      if (changed) for (const id of old?.candidateVideoIds ?? []) staleIds.add(id);
      return { ...track, id: old?.id ?? track.id, prompt: old?.prompt || track.prompt, candidateVideoIds: old?.candidateVideoIds ?? [], selectedVideoId: old?.selectedVideoId, state: old?.state ?? track.state, reason: old?.reason, stale: changed ? true : old?.stale, staleReason: changed ? 'storyboard source changed' : old?.staleReason, staleSince: changed ? Date.now() : old?.staleSince, sourceRunId: old?.sourceRunId, sourceFingerprint: fingerprint, outputVersion: old?.outputVersion };
    });
    state.productionTracks = [...state.productionTracks.filter(track => track.episodeId !== chapterId), ...rebuilt];
    state.videoCandidates = state.videoCandidates.map(item => staleIds.has(item.id) ? markStale(item, 'track source changed') : item);
  };
  const boards = createStoryboardSliceActions(set as never, get as never);
  Object.assign(actions, tasks, work, entities, boards, { rebuildTracks });
  const reports: Partial<Record<DaojieGenerationStage, string>> = {};
  const durations: Partial<Record<DaojieGenerationStage, number>> = {};
  let draft: { id: string; updatedAt: number } | undefined;
  let planContext = '';
  for (const stage of ['script', 'planning', 'storyboard'] as const) {
    const artifact = job.stages[stage];
    requireBridge(artifact.text?.trim() && artifact.sha256 === chapter001Sha256(artifact.text) && artifact.sourceSha256 === snapshot.sourceSha256, `${stage} output/source hash mismatch`);
    if (stage !== 'script') requireBridge(artifact.scriptSha256 === job.stages.script.sha256, `${stage} upstream script changed`);
    if (stage === 'storyboard') requireBridge(artifact.planSha256 === job.stages.planning.sha256, 'storyboard upstream plan changed');
    const receipt = artifact.primaryReview;
    requireBridge(artifact.reviewSha256 === chapter001Sha256(artifact.reviewText) && receipt?.passed === true && receipt.reviewer?.trim() && receipt.outputSha256 === artifact.sha256 && receipt.sourceSha256 === snapshot.sourceSha256 && receipt.reviewSha256 === artifact.reviewSha256, `${stage} primary review missing or mismatched`);
    const parsedBoard = stage === 'storyboard' ? parseStoryboardTable(artifact.text, chapterId, { requireShotSemantics: true }) : undefined;
    if (parsedBoard) requireBridge(!parsedBoard.errors.length && parsedBoard.rows.length > 0, `storyboard parse: ${parsedBoard.errors.join(';')}`);
    if (stage === 'planning') {
      const audit = auditDirectorPlanStructure(artifact.text);
      requireBridge(audit.passed, `planning structure: ${audit.issues.join(';')}`);
      // Task contract: each production Sc header declares ·约N秒; fail closed
      // rather than treating an unverified runtime total as the plan's timing.
      const headers = artifact.text.split(/\r?\n/).filter(line => /^###\s+Sc\s*\d/.test(line));
      const seconds = headers.map(line => Number(/·约(\d+(?:\.\d+)?)秒\s*$/.exec(line)?.[1]));
      requireBridge(seconds.length > 0 && seconds.every(value => Number.isFinite(value) && value > 0), 'planning scene durations missing');
      durations.planning = seconds.reduce((sum, value) => sum + value, 0);
    }
    if (stage === 'script') {
      const metrics = analyzeScriptDraft(artifact.text);
      requireBridge(metrics.scenes.length && metrics.scenes.every(scene => scene.seconds !== null && scene.seconds > 0), 'script scene durations missing');
      durations.script = metrics.totalSeconds;
    }
    if (parsedBoard) durations.storyboard = parsedBoard.rows.reduce((sum, row) => sum + row.duration, 0);
    requireBridge(durations[stage]! > 0 && durations[stage]! <= 180 && (stage === 'script' || Math.round(durations[stage]!) === Math.round(durations.script!)), `${stage} duration mismatch`);
    const review = await reviewDaojieGeneration({ stage, sourceText: snapshot.input.chapterText, bibleContext: snapshot.input.bibleContext, scriptText: stage === 'script' ? undefined : job.stages.script.text, planText: stage === 'storyboard' ? planContext : undefined, outputText: artifact.text, totalDurationSeconds: durations[stage] }, async () => ({ success: true, text: artifact.reviewText }));
    checkCurrent();
    requireBridge(review.passed, `${stage} audit rejected`);
    reports[stage] = review.report;
    work.saveAgentWorkData('supervisionReport', review.report, chapterId, identity);
    if (stage === 'script') {
      const id = work.saveAgentWorkData('scriptDraft', artifact.text, chapterId, identity);
      const saved = state.agentWorkData.find(item => item.id === id)!;
      draft = { id, updatedAt: saved.updatedAt };
    } else if (stage === 'planning') {
      const { plan } = parseDirectorPlan(artifact.text, chapterId, identity);
      work.saveAgentWorkData('directorPlan', artifact.text, chapterId, identity);
      entities.saveScriptPlan({ ...plan, scriptFingerprint: scriptPlanSourceFingerprint(chapterId, job.stages.script.text), sourceScript: { entryId: draft!.id, updatedAt: draft!.updatedAt } });
      planContext = formatScriptPlanContext(plan);
    } else {
      work.saveAgentWorkData('storyboardTable', artifact.text, chapterId, identity);
      const characters = state.entityExtractions.find(item => item.episodeId === chapterId)?.characters;
      requireBridge(characters, 'chapter entity extraction missing');
      const items = toStoryboardItems(parsedBoard!.rows, chapterId, characters, identity, { unknownSpeaker: 'narrator', sourceScript: { entryId: draft!.id, updatedAt: draft!.updatedAt } });
      requireBridge(Math.round(items.reduce((sum, item) => sum + item.duration, 0)) === Math.round(durations.script!), 'built storyboard duration mismatch');
      boards.replaceStoryboardsForEpisode(chapterId, items);
      for (const item of items) boards.setStoryboardKeyframes(item.id, planStoryboardKeyframes({ id: item.id, durationUs: item.duration * 1_000_000, videoDesc: item.videoDesc, lines: item.lines, shotSemantics: item.shotSemantics }), 'plan');
    }
  }
  checkCurrent();
  requireBridge(isDeepStrictEqual(otherChapterProjection(before), otherChapterProjection(state)), 'other chapter changed');
  requireBridge(isDeepStrictEqual(before.novelChapters, state.novelChapters), 'chapter source/index changed');
  const changedKeys = Object.keys(state).filter(key => !isDeepStrictEqual(before[key], state[key]));
  return { envelope: { state, version: snapshot.envelope.version }, diff: { changedKeys, durations, otherChaptersUnchanged: true, projectWrites: 0, generatedImages: 0, persistenceImplemented: false, otherChapterShardNames: snapshot.manifest.shards.filter(name => name.startsWith('chapters/') && name.split('/')[1] !== chapterId) }, reviews: reports };
}

function taskFile(file: string, output = false): string {
  const resolved = output ? path.join(realpathSync(path.dirname(file)), path.basename(file)) : realpathSync(file);
  const relative = path.relative(realpathSync(research), resolved);
  requireBridge(relative !== '' && !relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative), 'task path scope mismatch');
  return resolved;
}
function verifyLiveSources(snapshot: Chapter001Snapshot): Chapter001Snapshot {
  requireBridge(snapshot.projectRoot === projectRoot && realpathSync(projectRoot) === snapshot.projectRoot, 'project root mismatch');
  const allowed = new Set(['store/studio-workflow/manifest.json', ...snapshot.shards.map(item => 'store/studio-workflow/' + item.relativePath)]);
  requireBridge(snapshot.sourceFiles.length === allowed.size && snapshot.sourceFiles.every(item => allowed.has(item.relativePath)), 'source scope mismatch');
  for (const item of snapshot.sourceFiles) {
    const resolved = realpathSync(path.join(projectRoot, item.relativePath));
    requireBridge(resolved.startsWith(realpathSync(path.join(projectRoot, 'store/studio-workflow')) + path.sep) && resolved === item.realpath, 'source path escape');
    requireBridge(createHash('sha256').update(readFileSync(resolved)).digest('hex') === item.sha256, 'live source changed');
  }
  return snapshot;
}

const inputFile = process.env.DIRECTOR_CHAPTER001_APPLY_INPUT;
const outputFile = process.env.DIRECTOR_CHAPTER001_APPLY_OUTPUT;
it.skipIf(!inputFile || !outputFile)('chapter001 task-only in-memory apply; never persists project', async () => {
  const input = JSON.parse(readFileSync(taskFile(inputFile!), 'utf8')) as { snapshotFile: string; job: Chapter001ApplyJob };
  const snapshot = JSON.parse(readFileSync(taskFile(input.snapshotFile), 'utf8')) as Chapter001Snapshot;
  const out = taskFile(outputFile!, true);
  const result = await applyChapter001InMemory(snapshot, input.job, () => verifyLiveSources(snapshot));
  writeFileSync(out, JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
});
