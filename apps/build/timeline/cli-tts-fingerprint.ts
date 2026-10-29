import fs from 'node:fs';
import path from 'node:path';
import type { StoryboardItem, StudioMaterial } from '@/types/studio';
import type { StudioAssetSummary } from '@/types/studio-assets';
import type { PersistedTtsState } from '@/stores/tts/tts-store';
import type { TtsSpeakerId, VoiceProfile } from '@/types/tts';
import { buildRoleAudioCandidates } from '@/components/panels/assets/role-audio-auto-assign';
import { filterNarratorVoiceFamily, resolveNarratorShotProfile, type RoleAudioCandidate } from '@/lib/tts/narrator-voice';
import { createStoryboardTtsInputFingerprint } from '@/lib/studio/storyboard-tts-runner';
import { sha256CanonicalJson } from '@/lib/studio/remotion/canonical-json';
import { hashFileSha256 } from '../remotion/render-smoke-evidence';
import { requireSourceHash } from './run-full-pipeline-inputs';

interface NarratorInput {
 schemaVersion: 1; projectId: string; chapterId: string;
 studioStateSha256: string; ttsStateSha256: string;
 assetsSource: { path: string; sha256: string; walSha256: string | null };
 runtimeAssets: StudioAssetSummary[];
 resolvedPaths: Record<string, string>;
}
/** Explicit export contract: bind the ordered asset list to live DB/WAL and current stores.
 * The exporter must obtain runtimeAssets from the real audio list, preserving order.
 * No Electron initialization or asset migration is safe in this CLI.
 */
export async function createCliTtsFingerprint(input: {
 state: Record<string, unknown>; tts: PersistedTtsState; storyboard: StoryboardItem;
 projectId: string; chapterId: string; resolveMedia: (value: string) => string;
 contractPath?: string;
}) {
 const { state, tts, storyboard: sb, projectId, chapterId } = input;
 const profiles: Partial<Record<TtsSpeakerId, VoiceProfile>> = {};
 for (const speaker of new Set([sb.speakerId, ...(sb.speechUtterances ?? []).map(p => p.speakerId)])) {
  if (!speaker) throw new Error('缺少 canonical speaker');
  const binding = tts.projects[projectId]?.bindings[speaker];
  const profile = binding && tts.voiceProfiles[binding.profileId];
  if (!profile) throw new Error(`缺少 current voice profile: ${speaker}`);
  profiles[speaker] = profile;
 }
 const base = sb.speakerId && profiles[sb.speakerId];
 if (!base) throw new Error('缺少 current voice profile');
 let contract: NarratorInput | undefined;
 let family: RoleAudioCandidate[] | undefined;
 const loadFamily = async () => {
  if (family) return family;
  const file = input.contractPath ?? process.env.MYSTUDIO_NARRATOR_INPUT;
  if (!file) throw new Error('参考型旁白需要 MYSTUDIO_NARRATOR_INPUT');
  const value = JSON.parse(fs.readFileSync(file, 'utf8')) as NarratorInput;
  if (value.schemaVersion !== 1 || value.projectId !== projectId || value.chapterId !== chapterId
   || value.studioStateSha256 !== await sha256CanonicalJson(state) || value.ttsStateSha256 !== await sha256CanonicalJson(tts)) throw new Error('narrator source stores 已过期');
  const source = value.assetsSource;
  if (!source || typeof source.path !== 'string' || !path.isAbsolute(source.path)) throw new Error('narrator assets source 无效');
  requireSourceHash(source.sha256);
  if (await hashFileSha256(source.path) !== source.sha256) throw new Error('narrator assets source SHA 已过期');
  const wal = `${source.path}-wal`;
  if (fs.existsSync(wal)) {
   requireSourceHash(source.walSha256);
   if (await hashFileSha256(wal) !== source.walSha256) throw new Error('narrator assets source WAL 已过期');
  } else if (source.walSha256 !== null) throw new Error('narrator assets source WAL 已过期');
  if (!Array.isArray(value.runtimeAssets) || value.runtimeAssets.some(a => !a || a.type !== 'audio' || typeof a.id !== 'string' || typeof a.name !== 'string')
   || !value.resolvedPaths || typeof value.resolvedPaths !== 'object') throw new Error('narrator assets source list 无效');
  contract = value;
  family = filterNarratorVoiceFamily(buildRoleAudioCandidates((state.materials ?? []) as StudioMaterial[], value.runtimeAssets), (state.workflowConfig as { narratorVoiceFamily?: string } | undefined)?.narratorVoiceFamily);
  if (!family.length) throw new Error('缺少 required narrator family');
  return family;
 };
 const resolveProfile = async (fixed: VoiceProfile, text: string) => fixed.type === 'reference'
  ? resolveNarratorShotProfile(fixed, { emotion: sb.emotion, text }, await loadFamily()) : fixed;
 const profile = sb.speakerId === 'narrator' || sb.mediaRef?.kind === 'video'
  ? await resolveProfile(base, [sb.prompt, sb.lines, sb.line, sb.ttsSpokenText].filter(Boolean).join('\n')) : base;
 const utteranceProfiles = sb.mediaRef?.kind !== 'video' && sb.speechUtterances
  ? await Promise.all(sb.speechUtterances.map(part => {
    const fixed = profiles[part.speakerId];
    if (!fixed) throw new Error('缺少逐句 current voice profile');
    return part.speakerId === 'narrator' ? resolveProfile(fixed, part.text) : fixed;
   })) : undefined;
 const hashProfile = async (p: VoiceProfile) => {
  if (!p.referenceAudioPath) return undefined;
  const mapped = contract?.resolvedPaths[p.referenceAudioPath];
  if (mapped !== undefined && (typeof mapped !== 'string' || !path.isAbsolute(mapped))) throw new Error('narrator reference source path 无效');
  const file = mapped ?? input.resolveMedia(p.referenceAudioPath);
  if (!path.isAbsolute(file)) throw new Error('narrator reference source 需要绝对路径');
  return hashFileSha256(file);
 };
 // Ordered composition fingerprints intentionally omit top-level reference hash (runner contract).
 const referenceAudioSha256 = utteranceProfiles ? undefined : await hashProfile(profile);
 const utteranceReferenceSha256s = utteranceProfiles ? await Promise.all(utteranceProfiles.map(hashProfile)) : undefined;
 return { profile, utteranceProfiles, fingerprint: await createStoryboardTtsInputFingerprint({ projectId, chapterId, storyboard: sb, profile, profiles, referenceAudioSha256, utteranceProfiles, utteranceReferenceSha256s }) };
}
