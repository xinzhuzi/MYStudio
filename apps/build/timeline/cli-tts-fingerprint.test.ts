// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createCliTtsFingerprint } from './cli-tts-fingerprint';
import { sha256CanonicalJson } from '@/lib/studio/remotion/canonical-json';
import { hashFileSha256 } from '../remotion/render-smoke-evidence';
import type { StoryboardItem } from '@/types/studio';
import type { PersistedTtsState } from '@/stores/tts/tts-store';

describe('CLI actual narrator generation fingerprint', () => {
 it('selects calm and sad per utterance and rejects changed source and reference bytes', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-narrator-'));
  const calm = path.join(root, 'calm.wav'), sad = path.join(root, 'sad.wav'), db = path.join(root, 'assets.db');
  fs.writeFileSync(calm, 'calm reference'); fs.writeFileSync(sad, 'sad reference'); fs.writeFileSync(db, 'source snapshot');
  const profile = { id: 'n', name: '木成', type: 'reference', language: 'zh', defaultEngine: 'qwen', referenceAudioPath: calm, createdAt: 1, updatedAt: 1 };
  const tts = { projects: { p: { bindings: { narrator: { profileId: 'n' } } } }, voiceProfiles: { n: profile } } as unknown as PersistedTtsState;
  const state = { materials: [], workflowConfig: { narratorVoiceFamily: '木成' } };
  const contract = { schemaVersion: 1, projectId: 'p', chapterId: 'c', studioStateSha256: await sha256CanonicalJson(state), ttsStateSha256: await sha256CanonicalJson(tts),
   assetsSource: { path: db, sha256: await hashFileSha256(db), walSha256: null as string | null },
   runtimeAssets: [{ id: 'calm', type: 'audio', name: '木成·平静', previewUrl: calm }, { id: 'sad', type: 'audio', name: '木成·悲伤', previewUrl: sad }], resolvedPaths: {} };
  const contractPath = path.join(root, 'input.json'); fs.writeFileSync(contractPath, JSON.stringify(contract));
  const sb = { id: 's', index: 1, speakerId: 'narrator', speaker: '旁白', ttsSpokenText: '平静 泪落', speechUtterances: [{ speakerId: 'narrator', speaker: '旁白', text: '平静' }, { speakerId: 'narrator', speaker: '旁白', text: '泪落' }] } as StoryboardItem;
  const input = { state, tts, storyboard: sb, projectId: 'p', chapterId: 'c', resolveMedia: (p: string) => p, contractPath };
  const first = await createCliTtsFingerprint(input);
  expect(first.utteranceProfiles?.map(p => p.referenceAudioPath)).toEqual([calm, sad]);
  const whole = await createCliTtsFingerprint({ ...input, storyboard: { ...sb, speechUtterances: undefined, prompt: '泪落' } });
  expect(whole.profile.referenceAudioPath).toBe(sad);
  const quiet = await createCliTtsFingerprint({ ...input, storyboard: { ...sb, speechUtterances: undefined, ttsSpokenText: '平静' } });
  expect(quiet.profile.referenceAudioPath).toBe(calm);
  expect(quiet.fingerprint).not.toBe(whole.fingerprint);
  await expect(createCliTtsFingerprint({ ...input, state: { ...state, materials: ['changed'] } })).rejects.toThrow('stores');
  fs.writeFileSync(`${db}-wal`, 'new WAL');
  await expect(createCliTtsFingerprint(input)).rejects.toThrow('SHA-256');
  contract.assetsSource.walSha256 = await hashFileSha256(`${db}-wal`);
  fs.writeFileSync(contractPath, JSON.stringify(contract));
  await expect(createCliTtsFingerprint(input)).resolves.toBeDefined();
  fs.writeFileSync(sad, 'changed reference');
  expect((await createCliTtsFingerprint(input)).fingerprint).not.toBe(first.fingerprint);
  fs.writeFileSync(db, 'changed persisted source');
  await expect(createCliTtsFingerprint(input)).rejects.toThrow('source');
  fs.writeFileSync(db, 'source snapshot'); contract.runtimeAssets = []; fs.writeFileSync(contractPath, JSON.stringify(contract));
  await expect(createCliTtsFingerprint(input)).rejects.toThrow('family');
  await expect(createCliTtsFingerprint({ ...input, contractPath: undefined })).rejects.toThrow('MYSTUDIO_NARRATOR_INPUT');
 });
});
