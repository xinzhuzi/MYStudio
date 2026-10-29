/** Offline, trusted exporter for createCliTtsFingerprint. Hashes detect drift, not forgery.
 * Requires an independently prepared, consistent non-WAL SQLite snapshot. Never opens
 * an Electron repository, migrates a store, discovers config paths or creates media.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import type { StudioAssetSummary } from '@/types/studio-assets';
import type { StudioMaterial } from '@/types/studio';
import type { PersistedTtsState } from '@/stores/tts/tts-store';
import { sha256CanonicalJson } from '@/lib/studio/remotion/canonical-json';
import { buildRoleAudioCandidates } from '@/components/panels/assets/role-audio-auto-assign';
import { filterNarratorVoiceFamily } from '@/lib/tts/narrator-voice';
import { createAssetFileUrl, resolveAssetFilePath, assertInsideRoot, parseProjectFileUrl, resolveLocalMediaPath } from '@/electron/storage/storage-paths';
import { isMovableStoreSegment, resolveStoreFilePathAny } from '@/electron/storage/project-store-layout';
import { parseStudioWorkflowShardManifest } from '@/lib/storage/studio-workflow-shards';
import { readStudioWorkflowStoreState } from './storage-paths';

// Exact listAssets('audio', undefined, 0, 9999, undefined) query, assets-queries.ts.
export const NARRATOR_AUDIO_QUERY = `SELECT id, type, name, description, filePath, tags FROM assets WHERE type='audio' AND (TRIM(COALESCE(filePath,''))<>'' OR TRIM(COALESCE(prompt,''))<>'' OR TRIM(COALESCE(description,''))<>'' OR TRIM(COALESCE(setting,''))<>'' OR TRIM(COALESCE(remark,''))<>'' OR COALESCE(images,'[]')<>'[]') ORDER BY rowid ASC LIMIT 9999 OFFSET 0;`;

export interface NarratorExportOptions {
 projectDir: string; assetsDbSnapshot: string; assetsRoot: string;
 projectId: string; chapterId: string; outputPath: string; mediaRoot?: string;
}
function record(value: unknown): Record<string, unknown> {
 if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected store object');
 return value as Record<string, unknown>;
}
function digest(file: string) { return createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function assertSnapshot(file: string) {
 for (const suffix of ['-wal', '-shm', '-journal']) {
  if (fs.existsSync(file + suffix)) throw new Error('Need consistent standalone non-WAL snapshot (no sidecars)');
 }
 const fd = fs.openSync(file, 'r');
 const header = Buffer.alloc(100);
 try { fs.readSync(fd, header, 0, 100, 0); } finally { fs.closeSync(fd); }
 if (header.subarray(0, 16).toString() !== 'SQLite format 3\0' || header[18] !== 1 || header[19] !== 1) throw new Error('Need consistent non-WAL SQLite snapshot');
}
function studioInputs(projectDir: string) {
 const base = fs.existsSync(path.join(projectDir, 'store')) ? path.join(projectDir, 'store') : projectDir;
 const manifestPath = path.join(base, 'studio-workflow/manifest.json');
 if (!fs.existsSync(manifestPath)) return [path.join(base, 'studio-workflow-store.json')];
 const manifest = parseStudioWorkflowShardManifest(fs.readFileSync(manifestPath, 'utf8'));
 if (!manifest) throw new Error('Invalid studio manifest');
 return [manifestPath, ...manifest.shards.map(name => assertInsideRoot(path.dirname(manifestPath), path.join(path.dirname(manifestPath), name), 'shard'))];
}
function rowSummary(row: Record<string, unknown>, assetsRoot: string): StudioAssetSummary {
 if (typeof row.id !== 'string' || typeof row.name !== 'string' || row.type !== 'audio') throw new Error('Invalid audio row');
 for (const key of ['description', 'filePath', 'tags']) if (row[key] !== null && row[key] !== undefined && typeof row[key] !== 'string') throw new Error(`Invalid audio row ${key}`);
 const filePath = row.filePath as string | undefined;
 let sourcePath: string | undefined;
 if (filePath) {
  try { sourcePath = resolveAssetFilePath(assetsRoot, createAssetFileUrl(filePath)); } catch { sourcePath = undefined; }
 }
 const previewUrl = sourcePath ? createAssetFileUrl(filePath!) : undefined;
 let tags: string[] = [];
 try { tags = row.tags ? JSON.parse(String(row.tags)) : []; } catch { tags = []; }
 return { id: row.id, source: 'manying-local', type: 'audio', name: row.name,
  description: row.description as string | undefined, tags,
  thumbnailUrl: sourcePath && fs.existsSync(sourcePath) ? previewUrl : undefined,
  previewUrl, filePath, sourcePath, state: 'success' };
}

export async function exportCliNarratorInput(options: NarratorExportOptions) {
 const { projectId, chapterId } = options;
 if (!projectId.trim() || !chapterId.trim()) throw new Error('Explicit project/chapter identity required');
 const projectDir = fs.realpathSync(options.projectDir), assetsRoot = fs.realpathSync(options.assetsRoot);
 const dbPath = fs.realpathSync(options.assetsDbSnapshot);
 const outputPath = path.join(fs.realpathSync(path.dirname(options.outputPath)), path.basename(options.outputPath));
 for (const root of [projectDir, assetsRoot]) if (outputPath === root || outputPath.startsWith(root + path.sep)) throw new Error('output must be outside project and assets roots');
 if (fs.existsSync(outputPath) || outputPath === dbPath) throw new Error('output already exists or aliases input');
 assertSnapshot(dbPath);
 const ttsPath = resolveStoreFilePathAny(projectDir, ['tts.json']);
 const inputFiles = [...studioInputs(projectDir), ttsPath, dbPath];
 const before = new Map(inputFiles.map(file => [file, digest(file)]));
 const studio = readStudioWorkflowStoreState(projectDir);
 if (!studio) throw new Error('Missing studio store');
 const tts = record(record(JSON.parse(fs.readFileSync(ttsPath, 'utf8'))).state) as unknown as PersistedTtsState;
 if (!tts.projects?.[projectId]?.bindings || !tts.voiceProfiles) throw new Error('Missing project TTS bindings');
 const db = new DatabaseSync(dbPath, { readOnly: true, allowExtension: false });
 let runtimeAssets: StudioAssetSummary[];
 try { runtimeAssets = db.prepare(NARRATOR_AUDIO_QUERY).all().map(row => rowSummary(row, assetsRoot)); } finally { db.close(); }
 const state = studio.state;
 const materials = state.materials ?? [];
 if (!Array.isArray(materials)) throw new Error('Invalid materials');
 const family = filterNarratorVoiceFamily(buildRoleAudioCandidates(materials as StudioMaterial[], runtimeAssets), (state.workflowConfig as { narratorVoiceFamily?: string } | undefined)?.narratorVoiceFamily);
 if (!family.length) throw new Error('Missing required narrator family');
 const resolvedPaths: Record<string, string> = {};
 const resolveReference = (value: string) => {
  let resolved: string;
  if (value.startsWith('asset-file://')) resolved = resolveAssetFilePath(assetsRoot, value);
  else if (value.startsWith('project-file://')) {
   const parsed = parseProjectFileUrl(value);
   if (!parsed || parsed.projectId !== projectId) throw new Error('Reference belongs to another project');
   const first = parsed.relativePath.split('/')[0];
   const base = isMovableStoreSegment(first) && fs.existsSync(path.join(projectDir, 'store')) ? path.join(projectDir, 'store') : projectDir;
   resolved = assertInsideRoot(projectDir, path.join(base, parsed.relativePath), 'project reference');
  } else if (value.startsWith('file://')) resolved = fileURLToPath(value);
  else if (value.startsWith('local-image://') || value.startsWith('local-video://')) {
   if (!options.mediaRoot) throw new Error('Explicit --media-root required for local media');
   resolved = resolveLocalMediaPath(options.mediaRoot, value);
  } else if (path.isAbsolute(value)) resolved = value;
  else throw new Error(`Unresolved reference: ${value}`);
  if (!fs.statSync(resolved).isFile()) throw new Error(`Reference is not a file: ${resolved}`);
  fs.accessSync(resolved, fs.constants.R_OK);
  resolvedPaths[value] = resolved;
  before.set(resolved, digest(resolved));
 };
 for (const item of family) resolveReference(item.filePath);
 for (const binding of Object.values(tts.projects[projectId].bindings)) {
  const profile = tts.voiceProfiles[binding.profileId];
  if (!profile) throw new Error('Missing fixed voice profile');
  if (profile.referenceAudioPath) resolveReference(profile.referenceAudioPath);
 }
 const contract = { schemaVersion: 1 as const, projectId, chapterId,
  studioStateSha256: await sha256CanonicalJson(state), ttsStateSha256: await sha256CanonicalJson(tts),
  assetsSource: { path: dbPath, sha256: before.get(dbPath)!, walSha256: null }, runtimeAssets, resolvedPaths };
 assertSnapshot(dbPath);
 const currentFiles = [...studioInputs(projectDir), resolveStoreFilePathAny(projectDir, ['tts.json']), dbPath];
 if (JSON.stringify(currentFiles) !== JSON.stringify(inputFiles)) throw new Error('Input drift: store file set');
 for (const [file, hash] of before) if (digest(file) !== hash) throw new Error(`Input drift: ${file}`);
 fs.writeFileSync(outputPath, JSON.stringify(contract, null, 2) + '\n', { flag: 'wx' });
 return contract;
}

const HELP = `Readonly narrator exporter (Node >=22.13 with node:sqlite).
Usage: MYSTUDIO_EXPORT_NARRATOR_INPUT=1 ./node_modules/.bin/vite-node --config build/timeline/vite-node.config.ts build/timeline/export-cli-narrator-input.ts --run-narrator-exporter --project-dir ABS --project-id ID --chapter-id ID --assets-db-snapshot ABS --assets-root ABS --output ABS [--media-root ABS]
Requires a consistent standalone non-WAL snapshot, no WAL/SHM/journal sidecars. Prepare it separately with SQLite backup; copying a live DB alone is not a consistent snapshot. No repository initialization or migration. Output must be new and outside project/assets roots. DB hashes check drift; the consumer trusts exported rows and mappings. They do not authenticate a maliciously edited export.\n`;
export async function runNarratorExporterCli(args = process.argv.slice(2)) {
 if (args.length === 1 && args[0] === '--help') { process.stdout.write(HELP); return; }
 const values: Record<string, string> = {};
 const flags = ['--project-dir', '--project-id', '--chapter-id', '--assets-db-snapshot', '--assets-root', '--output', '--media-root'];
 for (let i = 0; i < args.length; i += 2) {
  const key = args[i], value = args[i + 1];
  if (!flags.includes(key) || !value || value.startsWith('--') || values[key]) throw new Error(HELP);
  values[key] = value;
 }
 for (const key of flags.slice(0, 6)) if (!values[key]) throw new Error(HELP);
 for (const key of ['--project-dir', '--assets-db-snapshot', '--assets-root', '--output', '--media-root']) if (values[key] && !path.isAbsolute(values[key])) throw new Error(`Absolute path required: ${key}`);
 await exportCliNarratorInput({ projectDir: values['--project-dir'], projectId: values['--project-id'], chapterId: values['--chapter-id'], assetsDbSnapshot: values['--assets-db-snapshot'], assetsRoot: values['--assets-root'], outputPath: values['--output'], mediaRoot: values['--media-root'] });
 process.stdout.write(`Exported ${values['--output']}\n`);
}
// Existing script convention: explicit runner switch, never CLI execution on import.
if (process.env.MYSTUDIO_EXPORT_NARRATOR_INPUT === '1' && process.argv[2] === '--run-narrator-exporter') {
 runNarratorExporterCli(process.argv.slice(3)).catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
}
