// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it, vi } from 'vitest';
import { exportCliNarratorInput, NARRATOR_AUDIO_QUERY, runNarratorExporterCli } from './export-cli-narrator-input';
import { createCliTtsFingerprint } from './cli-tts-fingerprint';
import { buildRoleAudioCandidates } from '@/components/panels/assets/role-audio-auto-assign';
import { filterNarratorVoiceFamily, resolveNarratorShotProfile } from '@/lib/tts/narrator-voice';
import { createStoryboardTtsInputFingerprint } from '@/lib/studio/storyboard-tts-runner';
import { hashFileSha256 } from '../remotion/render-smoke-evidence';
import type { PersistedTtsState } from '@/stores/tts/tts-store';
import type { StoryboardItem } from '@/types/studio';

function fixture() {
 const root = fs.mkdtempSync(path.join(os.tmpdir(), 'narrator-export-'));
 const projectDir = path.join(root, 'project'), assetsRoot = path.join(root, 'assets');
 fs.mkdirSync(path.join(projectDir, 'store'), { recursive: true });
 fs.mkdirSync(path.join(assetsRoot, 'files', 'audio'), { recursive: true });
 const dbPath = path.join(root, 'snapshot.db');
 const db = new DatabaseSync(dbPath);
 db.exec('CREATE TABLE assets(id TEXT,type TEXT,name TEXT,description TEXT,filePath TEXT,tags TEXT,prompt TEXT,setting TEXT,remark TEXT,images TEXT)');
 const add = db.prepare('INSERT INTO assets VALUES(?,?,?,?,?,?,?,?,?,?)');
 add.run('sad', 'audio', '木成·悲伤', '泪落', 'audio/sad.wav', '["voice"]', '', '', '', '[]');
 add.run('empty', 'audio', '空壳', '', '', '[]', '', '', '', '[]');
 add.run('image', 'role', '木成·平静', '', 'wrong.png', '[]', '', '', '', '[]');
 add.run('metadata', 'audio', '说明音频', '', '', '[]', 'metadata only', '', '', '[]');
 add.run('calm', 'audio', '木成·平静', '平静', 'audio/calm.wav', 'broken-json', '', '', '', '[]');
 db.close();
 fs.writeFileSync(path.join(assetsRoot, 'files/audio/sad.wav'), 'sad bytes');
 fs.writeFileSync(path.join(assetsRoot, 'files/audio/calm.wav'), 'calm bytes');
 const state = { materials: [], workflowConfig: { narratorVoiceFamily: '木成' } };
 const profile = { id: 'n', name: '木成', type: 'reference', language: 'zh', defaultEngine: 'qwen', referenceAudioPath: 'asset-file://audio/calm.wav', createdAt: 1, updatedAt: 1 };
 const tts = { projects: { p: { bindings: { narrator: { profileId: 'n' } } } }, voiceProfiles: { n: profile } } as unknown as PersistedTtsState;
 const studioFile = path.join(projectDir, 'store/studio-workflow-store.json');
 fs.writeFileSync(studioFile, JSON.stringify({ state, version: 1 }));
 fs.writeFileSync(path.join(projectDir, 'store/tts.json'), JSON.stringify({ state: tts }));
 return { root, state, tts, studioFile, projectDir, assetsRoot, assetsDbSnapshot: dbPath, projectId: 'p', chapterId: 'chapter-001', outputPath: path.join(root, 'contract.json') };
}

describe('readonly narrator DB exporter', () => {
 it('queries real rows in UI order, excludes empty/non-audio rows, resolves virtual paths and matches generation fingerprints', async () => {
  const f = fixture(), before = await hashFileSha256(f.assetsDbSnapshot);
  const contract = await exportCliNarratorInput(f);
  expect(contract.runtimeAssets.map(a => a.id)).toEqual(['sad', 'metadata', 'calm']);
  expect(contract.runtimeAssets[0]).toMatchObject({ source: 'manying-local', previewUrl: 'asset-file://audio/sad.wav', tags: ['voice'], state: 'success' });
  expect(contract.runtimeAssets[2].tags).toEqual([]);
  expect(contract.resolvedPaths['asset-file://audio/sad.wav']).toBe(fs.realpathSync(path.join(f.assetsRoot, 'files/audio/sad.wav')));
  expect(NARRATOR_AUDIO_QUERY).toContain('ORDER BY rowid ASC LIMIT 9999 OFFSET 0');
  expect(await hashFileSha256(f.assetsDbSnapshot)).toBe(before);
  expect(fs.existsSync(`${f.assetsDbSnapshot}-wal`)).toBe(false);
  expect(fs.existsSync(`${f.assetsDbSnapshot}-shm`)).toBe(false);
  const sb = { id: 's', index: 1, speakerId: 'narrator', speaker: '旁白', ttsSpokenText: '平静 泪落', speechUtterances: [{ speakerId: 'narrator', speaker: '旁白', text: '平静' }, { speakerId: 'narrator', speaker: '旁白', text: '泪落' }] } as StoryboardItem;
  const input = { state: f.state, tts: f.tts, storyboard: sb, projectId: 'p', chapterId: f.chapterId, resolveMedia: (v: string) => v, contractPath: f.outputPath };
  const actual = await createCliTtsFingerprint(input);
  const base = f.tts.voiceProfiles.n;
  const family = filterNarratorVoiceFamily(buildRoleAudioCandidates([], contract.runtimeAssets), '木成');
  const selected = sb.speechUtterances!.map(p => resolveNarratorShotProfile(base, { text: p.text }, family));
  const expected = await createStoryboardTtsInputFingerprint({ projectId: 'p', chapterId: f.chapterId, storyboard: sb, profile: actual.profile, profiles: { narrator: base }, utteranceProfiles: selected, utteranceReferenceSha256s: await Promise.all(selected.map(p => hashFileSha256(contract.resolvedPaths[p.referenceAudioPath!]))) });
  expect(actual.fingerprint).toBe(expected);
  fs.writeFileSync(path.join(f.assetsRoot, 'files/audio/sad.wav'), 'changed reference');
  expect((await createCliTtsFingerprint(input)).fingerprint).not.toBe(actual.fingerprint);
  const changedDb = new DatabaseSync(f.assetsDbSnapshot); changedDb.exec("UPDATE assets SET name='changed' WHERE id='calm'"); changedDb.close();
  await expect(createCliTtsFingerprint(input)).rejects.toThrow('SHA');
 });
 it('rejects missing family references, without publishing output', async () => {
  const f = fixture();
  const db = new DatabaseSync(f.assetsDbSnapshot); db.exec("UPDATE assets SET filePath='audio/missing.wav' WHERE id='sad'"); db.close();
  await expect(exportCliNarratorInput(f)).rejects.toThrow(/ENOENT|missing/);
  expect(fs.existsSync(f.outputPath)).toBe(false);
 });
 it('rejects WAL sidecars and WAL-mode snapshots before SQLite can create shared memory', async () => {
  const f = fixture(); fs.writeFileSync(`${f.assetsDbSnapshot}-wal`, 'unmerged');
  await expect(exportCliNarratorInput(f)).rejects.toThrow('snapshot');
  const g = fixture(), db = new DatabaseSync(g.assetsDbSnapshot); db.exec('PRAGMA journal_mode=WAL'); db.close();
  await expect(exportCliNarratorInput(g)).rejects.toThrow('snapshot');
  expect(fs.existsSync(`${g.assetsDbSnapshot}-shm`)).toBe(false);
 });
 it('rejects store drift while reading references', async () => {
  const f = fixture(); const original = fs.accessSync;
  const spy = vi.spyOn(fs, 'accessSync').mockImplementation((...args) => { original(...args); fs.writeFileSync(f.studioFile, JSON.stringify({ state: { changed: true } })); });
  try { await expect(exportCliNarratorInput(f)).rejects.toThrow('drift'); } finally { spy.mockRestore(); }
  expect(fs.existsSync(f.outputPath)).toBe(false);
 });
 it('matches the UI limit without sorting or silently omitting usable metadata rows', async () => {
  const f = fixture(), db = new DatabaseSync(f.assetsDbSnapshot);
  db.exec('BEGIN');
  const add = db.prepare("INSERT INTO assets(id,type,name,description,images) VALUES(?, 'audio', ?, 'metadata', '[]')");
  for (let i = 0; i < 10000; i++) add.run(`extra-${i}`, `音频${i}`);
  db.exec('COMMIT'); db.close();
  const result = await exportCliNarratorInput(f);
  expect(result.runtimeAssets).toHaveLength(9999);
  expect(result.runtimeAssets.at(-1)?.id).toBe('extra-9995');
 });
 it('rejects DB drift and validates explicit CLI arguments', async () => {
  const f = fixture(), original = fs.accessSync;
  let mutated = false;
  const spy = vi.spyOn(fs, 'accessSync').mockImplementation((...args) => {
   original(...args);
   if (!mutated) { mutated = true; const db = new DatabaseSync(f.assetsDbSnapshot); db.exec("UPDATE assets SET description='changed' WHERE id='calm'"); db.close(); }
  });
  try { await expect(exportCliNarratorInput(f)).rejects.toThrow('drift'); } finally { spy.mockRestore(); }
  expect(fs.existsSync(f.outputPath)).toBe(false);
  await expect(runNarratorExporterCli([])).rejects.toThrow('Usage');
  await expect(runNarratorExporterCli(['--unknown', 'x'])).rejects.toThrow('Usage');
 });
 it('never overwrites an existing destination or writes into the project', async () => {
  const f = fixture(); fs.writeFileSync(f.outputPath, 'keep');
  await expect(exportCliNarratorInput(f)).rejects.toThrow();
  expect(fs.readFileSync(f.outputPath, 'utf8')).toBe('keep');
  await expect(exportCliNarratorInput({ ...f, outputPath: path.join(f.projectDir, 'bad.json') })).rejects.toThrow('output');
 });
});
