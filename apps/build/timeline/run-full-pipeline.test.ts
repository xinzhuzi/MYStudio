// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { assertCliDuration, validatePipelineReview } from './run-full-pipeline-inputs';
import type { StoryboardItem } from '@/types/studio';
const shot = (duration: number) => ({ duration } as StoryboardItem);
const context = { workflowConfig: { directorManualId: 'Daojie_xianxia' }, novelChapters: [{ id: 'c', sourceText: 'real source' }] };
describe('CLI strict chapter gate', () => {
 it('permits195 and rejects one microsecond overflow and nonfinite', () => {
  expect(() => assertCliDuration(context, 'c', [shot(195)])).not.toThrow();
  for (const n of [195.000001, NaN, Infinity]) expect(() => assertCliDuration(context, 'c', [shot(n)])).toThrow();
 });
 it('counts real voice endpoint plus400ms', () => {
  const s = { duration: 192, shotAudioBindings: [{ role: 'voice', shotStartUs: 0, durationUs: 194600001 }] } as StoryboardItem;
  expect(() => assertCliDuration(context, 'c', [s])).toThrow();
 });
 it('keeps partial repair and generic selection independent', () => {
  expect(() => assertCliDuration(context, 'c', [shot(210)], true)).not.toThrow();
  expect(() => assertCliDuration({ ...context, novelChapters: [] }, 'c', [shot(210)])).not.toThrow();
 });
});
describe('external source bound review', () => {
 const hash = 'a'.repeat(64);
 const artifact = { projectId: 'p', chapterId: 'c', revision: 3, sourceSha256: hash, audioSha256: hash, textSha256: hash, evidence: { artifactSha256: hash } };
 it('never accepts absent or stale review', async () => {
  await expect(validatePipelineReview(undefined, artifact)).rejects.toThrow();
  await expect(validatePipelineReview({ ...artifact, revision: 2 }, artifact)).rejects.toThrow();
 });
 it('rejects zero source identity', async () => {
  await expect(validatePipelineReview({ ...artifact, sourceSha256: '0'.repeat(64) }, artifact)).rejects.toThrow();
 });
});

describe('entrypoint wiring', () => {
 it('contains no r2 source fallback or manufactured human review', async () => {
  const fs = await import('node:fs');
  const source = fs.readFileSync(new URL('./run-full-pipeline.ts', import.meta.url), 'utf8');
  expect(source).not.toContain('r2RunPath');
  expect(source).not.toContain('reviewer: "full-pipeline-automation"');
  expect(source).not.toContain('decision: "human"');
  expect(source.indexOf('const initialShotInputs')).toBeLessThan(source.indexOf('probeVideoUseRuntime(runtimePaths)'));
  expect(source.indexOf('if (!externalReview) {')).toBeLessThan(source.indexOf('const acceptResult = await acceptVideoUseArtifact'));
 });
});

const fixtures = vi.hoisted(() => ({ state: {} as Record<string, unknown>, plan: {} as Record<string, unknown>, manifest: {} as Record<string, unknown>, root: '' }));
vi.mock('./storage-paths', () => ({
 readStudioWorkflowStoreState: () => ({ state: fixtures.state }),
 deriveStorageRoots: (root: string) => ({ projectId: 'p', dataRoot: root, mediaRoot: root }),
 resolveTimelineSourcePath: ({ sourcePath }: { sourcePath: string }) => sourcePath.startsWith('project-file://p/') ? `${fixtures.root}/${sourcePath.slice(17)}` : sourcePath,
}));
vi.mock('@/lib/studio/remotion/remotion-shot-plan-builder', async importOriginal => ({
 ...await importOriginal<typeof import('@/lib/studio/remotion/remotion-shot-plan-builder')>(),
 buildRemotionShotPlans: async () => fixtures.plan,
}));
vi.mock('@rendering/plugins/remotion/manifest/remotion-chapter-manifest-service', () => ({
 RemotionChapterManifestService: class { async read() { return fixtures.manifest; } },
}));
vi.mock('@/lib/studio/remotion/remotion-current-slot', () => ({
 validateCurrentSlot: (value: unknown) => ({ success: true, value }),
 resolveRemotionCurrentSlotOutputPath: (_root: string, slot: { videoPath: string }) => slot.videoPath,
}));
describe('current shot input rejection', () => {
 it('rejects missing and duplicate slots without historical fallback', async () => {
  const { buildShotInputs } = await import('./run-full-pipeline');
  fixtures.state = { storyboards: [{ id: 's', episodeId: 'c', index: 1, duration: 1 }] };
  await expect(buildShotInputs('/tmp/no-project', 'p', 'c', [])).rejects.toThrow('缺失/重复');
  fixtures.state = { storyboards: [{ id: 's', episodeId: 'c', index: 1, duration: 1 }, { id: 's', episodeId: 'c', index: 2, duration: 1 }] };
  await expect(buildShotInputs('/tmp/no-project', 'p', 'c', [])).rejects.toThrow('缺失/重复');
 });
});

describe('real external review evidence', () => {
 it('permits imported automated evidence without claiming human review and rejects wrong bytes', async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const crypto = await import('node:crypto');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ch1-cli-review-'));
  const file = path.join(dir, 'review.json');
  fs.writeFileSync(file, '{"checked":true}');
  const hash = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  const a = { projectId: 'p', chapterId: 'c', revision: 3, sourceSha256: hash, audioSha256: hash, textSha256: hash, evidence: { artifactSha256: hash } };
  const r = { ...a, artifactSha256: hash, decision: 'accepted', reviewer: 'actual-review-run', timestamp: 1,
   subtitleAuthority: { mode: 'clean-remotion', evidence: { mode: 'clean-remotion', decision: 'imported-manifest', reviewer: 'automated', reviewedAt: 1, sourceFingerprint: hash, evidencePaths: [file], evidenceSha256: { [file]: hash } } } };
  await expect(validatePipelineReview(r, a)).resolves.toEqual(r);
  for (const patch of [{ revision: 4 }, { chapterId: 'wrong' }, { artifactSha256: 'b'.repeat(64) }]) await expect(validatePipelineReview({ ...r, ...patch }, a)).rejects.toThrow();
  fs.writeFileSync(file, 'changed');
  await expect(validatePipelineReview(r, a)).rejects.toThrow('hash');
 });
 it('rejects final projection overflow even if requested chapter fits', () => {
  expect(() => assertCliDuration(context, 'c', [shot(192)], false, 195000001)).toThrow();
 });
});

describe('canonical current input data', () => {
 it('uses current arbitrary count/order/text/audio and rejects stale voice, slot and bytes', async () => {
  const fs = await import('node:fs'); const os = await import('node:os'); const path = await import('node:path'); const crypto = await import('node:crypto');
  const { createStoryboardTtsInputFingerprint } = await import('@/lib/studio/storyboard-tts-runner');
  const { createRemotionAudioBindingFingerprint } = await import('@/lib/studio/remotion/remotion-audio-fingerprint');
  const { buildShotInputs } = await import('./run-full-pipeline');
  fixtures.root = fs.mkdtempSync(path.join(os.tmpdir(), 'ch1-cli-input-'));
  fs.mkdirSync(path.join(fixtures.root, 'store'));
  fs.writeFileSync(path.join(fixtures.root, 'audio.wav'), 'real fixture bytes');
  fs.writeFileSync(path.join(fixtures.root, 'video.mp4'), 'fixture video bytes');
  const hash = (file: string) => crypto.createHash('sha256').update(fs.readFileSync(path.join(fixtures.root, file))).digest('hex');
  const h = hash('audio.wav'), v = hash('video.mp4');
  const profile: import('@/types/tts').VoiceProfile = { id: 'voice', name: 'fixture', type: 'preset', language: 'zh', defaultEngine: 'qwen', createdAt: 1, updatedAt: 1 };
  fs.writeFileSync(path.join(fixtures.root, 'store', 'tts.json'), JSON.stringify({ state: { projects: { p: { bindings: { narrator: { profileId: 'voice' } } } }, voiceProfiles: { voice: profile } } }));
  const sb = { id: 'current', episodeId: 'c', sourceId: 'c', revision: 7, index: 2, duration: 1, outputVersion: 2, speakerId: 'narrator', ttsSpokenText: 'current words', audioRef: { kind: 'audio', path: path.join(fixtures.root, 'audio.wav'), contentSha256: h } } as StoryboardItem;
  const fp = await createStoryboardTtsInputFingerprint({ projectId: 'p', chapterId: 'c', storyboard: sb, profile, profiles: { narrator: profile }, referenceAudioSha256BySpeaker: {} });
  const voice = { schemaVersion: 2, role: 'voice', projectId: 'p', chapterId: 'c', shotId: sb.id, shotRevision: 2, source: { projectId: 'p', relativePath: 'audio.wav', contentSha256: h }, sourceFingerprint: h, ttsInputFingerprint: fp } as import('@/types/remotion-workspace').RemotionShotAudioBindingV2;
  voice.bindingFingerprint = await createRemotionAudioBindingFingerprint(voice);
  sb.shotAudioBindings = [voice]; sb.ttsJob = { projectId: 'p', chapterId: 'c', shotId: sb.id, shotRevision: 2, status: 'completed', inputFingerprint: fp } as NonNullable<StoryboardItem['ttsJob']>;
  fixtures.state = { storyboards: [sb], novelChapters: [{ id: 'c', sourceId: 'c', revision: 7 }] }; fixtures.manifest = { revision: 1, requiredShotIds: [sb.id], sourceSnapshotHash: h };
  fixtures.plan = { success: true, sourceSnapshotHash: h, plans: [{ shot: { shotId: sb.id }, inputHash: h }] };
  const slot = { projectId: 'p', target: { kind: 'shot', shotId: sb.id, chapterId: 'c', shotRevision: 2 }, job: { inputHash: h }, evidence: { sha256: v, durationUs: 1000000 }, videoPath: path.join(fixtures.root, 'video.mp4') } as unknown as import('@/types/remotion-workspace').RemotionCurrentSlotV1;
  const result = await buildShotInputs(fixtures.root, 'p', 'c', [slot]);
  expect(result.map(s => [s.shotId, s.ttsSpokenText, s.audioSha256])).toEqual([['current', 'current words', h]]);
  sb.revision = 6;
  await expect(buildShotInputs(fixtures.root, 'p', 'c', [slot])).rejects.toThrow('source identity');
  sb.revision = 7;
  fixtures.state.entityExtractions = [{ episodeId: 'c', characters: [{ characterId: 'hero', name: '角色甲', aliases: ['别名甲'] }] }];
  sb.lines = '别名甲：current words';
  await expect(buildShotInputs(fixtures.root, 'p', 'c', [slot])).rejects.toThrow('speakerId');
  sb.speaker = '别名甲'; sb.speechUtterances = [{ speaker: '别名甲', speakerId: 'narrator', text: 'current words' }];
  await expect(buildShotInputs(fixtures.root, 'p', 'c', [slot])).rejects.toThrow('speakerId');
  sb.lines = undefined; sb.speechUtterances = undefined; sb.speaker = undefined;
  sb.ttsJob.chapterId = 'wrong'; await expect(buildShotInputs(fixtures.root, 'p', 'c', [slot])).rejects.toThrow('voice/job'); sb.ttsJob.chapterId = 'c';
  slot.job.inputHash = v; await expect(buildShotInputs(fixtures.root, 'p', 'c', [slot])).rejects.toThrow('lineage'); slot.job.inputHash = h;
  sb.ttsSpokenText = 'stale text'; await expect(buildShotInputs(fixtures.root, 'p', 'c', [slot])).rejects.toThrow('fingerprint'); sb.ttsSpokenText = 'current words';
  fs.writeFileSync(path.join(fixtures.root, 'audio.wav'), 'changed'); await expect(buildShotInputs(fixtures.root, 'p', 'c', [slot])).rejects.toThrow('SHA');
 });
});
