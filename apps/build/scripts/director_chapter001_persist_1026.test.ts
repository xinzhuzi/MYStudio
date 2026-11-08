/** Task-only, dry-run-only rehearsal. No real-project write adapter exists. */
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { it, vi } from 'vitest';
import { applyChapter001InMemory, validateChapter001Snapshot, CHAPTER001_PROJECT_ID, chapter001Sha256 as sha, type Chapter001ApplyJob, type Chapter001Snapshot } from './director_chapter001_bridge_1026.test';
import { validateChapter001Media1027, type MediaPublicationInput1027, type MediaRead1027 } from './director_chapter001_media_publication_1027.test';
import { parseStudioWorkflowShardManifest } from '@/lib/storage/studio-workflow-shards';

// The actual production factory is imported; only its I/O/router boundaries are mocked.
const memory = vi.hoisted(() => ({ files: new Map<string, string>(), writes: [] as { key: string; content: string; channel: 'fileStorage.setItem' | 'projectFiles.writeText' }[], active: false }));
vi.mock('@/lib/storage/indexed-db-storage', () => ({ fileStorage: {
  getItem: async (key: string) => memory.files.get(key) ?? null,
  setItem: async (key: string, content: string) => {
    if (!memory.active) throw new Error('dry-run adapter not active');
    memory.writes.push({ key, content, channel:'fileStorage.setItem' }); memory.files.set(key, content);
  },
  // Deliberately no removeItem: cleanup enumeration below is preservation-only.
} }));
vi.mock('@/stores/project/project-store', () => ({ useProjectStore: {
  getState: () => ({ activeProjectId: '49dce4c1-64b1-42de-85c2-9f266698aec4', projects: [{ id: '49dce4c1-64b1-42de-85c2-9f266698aec4' }] }),
  persist: { hasHydrated: () => true, onFinishHydration: () => () => undefined },
} }));
vi.mock('@/stores/app/app-settings-store', () => ({ useAppSettingsStore: { getState: () => ({ resourceSharing: { shareCharacters: true, shareScenes: true, shareMedia: true } }) } }));
import { createStudioWorkflowShardedStorage, __resetModuleStorageWriteLockForTests } from '@/lib/storage/storage-project-sharded';

export const CHAPTER001_PERSIST_ROOT = '/Users/zhengbingjin/Project/IP/MA';
const chapter = 'chapter-001';
const storeName = 'studio-workflow-store';
const prefix = `_p/${CHAPTER001_PROJECT_ID}/`;
const manifestPath = 'store/studio-workflow/manifest.json';
const lockPath = 'store/.storage-write-lock.json';
const research = path.resolve(import.meta.dirname, '../../../.trellis/tasks/10-25-daojie-director-rule-conflict-validation/research/chapter001-repair-1026');

export interface Chapter001ReadOnlySource {
  read(absolutePath: string): string | null;
  realpath(absolutePath: string): string;
}
const diskSource: Chapter001ReadOnlySource = {
  read: file => {
    try { return readFileSync(file, 'utf8'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
  },
  realpath: file => realpathSync(file),
};
function requirePersist(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
function safeRelative(relative: string): string {
  requirePersist(typeof relative === 'string' && relative.length > 0 && !path.isAbsolute(relative) && !relative.includes('\\') && relative.split('/').every(part => part !== '' && part !== '.' && part !== '..') && [...relative].every(char => char.charCodeAt(0) >= 32), 'unsafe relative path');
  return relative;
}
function keyForFile(relative: string): string {
  safeRelative(relative);
  return relative.startsWith('store/') ? prefix + relative.slice(6).replace(/\.json$/, '') : prefix + relative;
}
function fileForKey(key: string): string {
  requirePersist(key.startsWith(prefix), 'production routed to wrong project');
  const relative = safeRelative(key.slice(prefix.length));
  if (relative === 'studio-workflow/README.md') return `store/${relative}`;
  return relative.startsWith('studio-workflow/') || relative === storeName ? `store/${relative}.json` : relative;
}

/** Replays approved stages, then production hydration/setItem/getItem entirely in memory.
 * Read-only source injection is for offline fixtures; CLI always uses diskSource.
 * Concurrent calls are rejected because the production factory's window and lock are module-scoped.
 */
let rehearsalRunning = false;
export async function dryRunChapter001Persistence(snapshot: Chapter001Snapshot, job: Chapter001ApplyJob, source: Chapter001ReadOnlySource = diskSource, media?: {input:MediaPublicationInput1027; files:MediaRead1027}) {
  requirePersist(!rehearsalRunning, 'persistence rehearsal already running');
  rehearsalRunning = true;
  try { return await rehearseChapter001Persistence(snapshot, job, source, media); }
  finally { rehearsalRunning = false; }
}
async function rehearseChapter001Persistence(snapshotInput: Chapter001Snapshot, jobInput: Chapter001ApplyJob, source: Chapter001ReadOnlySource, media?: {input:MediaPublicationInput1027; files:MediaRead1027}) {
  const snapshot = structuredClone(snapshotInput);
  const job = structuredClone(jobInput);
  requirePersist(snapshot.projectId === CHAPTER001_PROJECT_ID && job.projectId === CHAPTER001_PROJECT_ID && snapshot.chapterId === chapter && job.chapterId === chapter, 'project/chapter mismatch');
  requirePersist(snapshot.projectRoot === CHAPTER001_PERSIST_ROOT && source.realpath(CHAPTER001_PERSIST_ROOT) === CHAPTER001_PERSIST_ROOT, 'project root mismatch');
  validateChapter001Snapshot(snapshot);
  const expectedSources = new Map<string, string>([[manifestPath, snapshot.manifestRaw], ...snapshot.shards.map(shard => [`store/studio-workflow/${shard.relativePath}`, shard.content] as const)]);
  requirePersist(snapshot.sourceFiles.length === expectedSources.size && new Set(snapshot.sourceFiles.map(file => file.relativePath)).size === expectedSources.size, 'sourceFiles scope mismatch');
  const read = (relative: string, optional = false): string | null => {
    const absolute = path.join(CHAPTER001_PERSIST_ROOT, safeRelative(relative));
    const raw = source.read(absolute);
    requirePersist(optional || raw !== null, `baseline file missing: ${relative}`);
    if (raw !== null) requirePersist(source.realpath(absolute) === absolute, `source path escape: ${relative}`);
    return raw;
  };
  const verifySources = () => {
    for (const item of snapshot.sourceFiles) {
      const expected = expectedSources.get(item.relativePath);
      requirePersist(expected !== undefined && item.realpath === path.join(CHAPTER001_PERSIST_ROOT, item.relativePath) && item.sha256 === sha(expected), 'sourceFiles identity/hash mismatch');
      requirePersist(sha(read(item.relativePath)!) === item.sha256, `live source changed: ${item.relativePath}`);
    }
    return snapshot;
  };
  verifySources();
  const baseline = new Map<string, string>();
  baseline.set(manifestPath, snapshot.manifestRaw);
  requirePersist(new Set(snapshot.manifest.shards).size === snapshot.manifest.shards.length, 'duplicate manifest references');
  for (const name of snapshot.manifest.shards) {
    requirePersist(name.endsWith('.json'), 'invalid shard extension');
    const relative = `store/studio-workflow/${safeRelative(name)}`;
    baseline.set(relative, read(relative)!);
  }
  for (const relative of ['store/studio-workflow/README.md', 'README.md', 'backups/README.md', `store/${storeName}.json`, lockPath]) {
    const raw = read(relative, true); if (raw !== null) baseline.set(relative, raw);
  }
  const verifyBaseline = () => {
    verifySources();
    for (const [relative, raw] of baseline) requirePersist(read(relative) === raw, `baseline conflict: ${relative}`);
  };
  const mediaValidation = media ? await validateChapter001Media1027(snapshot,job,media.input,media.files,verifySources) : undefined;
  const applied = mediaValidation ? {...mediaValidation.bridge, envelope:mediaValidation.envelope} : await applyChapter001InMemory(snapshot, job, verifySources);
  if (mediaValidation) {
    const baselineHash=sha(JSON.stringify([...baseline].filter(([relativePath])=>relativePath!==lockPath).map(([relativePath,raw])=>({relativePath,sha256:sha(raw),bytes:Buffer.byteLength(raw)})).sort((a,b)=>a.relativePath.localeCompare(b.relativePath))));
    requirePersist(mediaValidation.baselineSha256===baselineHash,'media frozen baseline mismatch');
  }
  verifyBaseline();
  memory.active = true;
  memory.files = new Map([...baseline].map(([relative, raw]) => [relative === lockPath ? prefix + lockPath : keyForFile(relative), raw]));
  memory.writes = [];
  const lockOperations: {operation: string; relativePath: string; content: string}[] = [];
  const cleanup: {operation: string; policy: string}[] = [];
  const preserved = [...baseline.keys()].filter(relative => relative !== manifestPath && relative !== lockPath);
  const oldWindow = (globalThis as unknown as {window?: unknown}).window;
  let hydrated = false;
  const lockFiles = new Map<string, string>();
  if (baseline.has(lockPath)) lockFiles.set(lockPath, baseline.get(lockPath)!);
  const checkPid = (pid: string) => requirePersist(pid === CHAPTER001_PROJECT_ID, 'lock project mismatch');
  (globalThis as unknown as {window: unknown}).window = {
    fileStorage: {
      exists: async (key: string) => memory.files.has(key),
      // Explicit cleanup no-op: do not enumerate files to the production deleter.
      listKeys: async () => { cleanup.push({ operation: 'listKeys', policy: 'preserved' }); return []; },
      listDirs: async () => { cleanup.push({ operation: 'listDirs', policy: 'preserved' }); return []; },
      renameItem: async () => { cleanup.push({ operation: 'renameItem', policy: 'preserved' }); return false; },
    },
    projectFiles: {
      readText: async ({projectId, relativePath}: {projectId: string; relativePath: string}) => {
        checkPid(projectId); safeRelative(relativePath);
        const text = relativePath === lockPath ? lockFiles.get(relativePath) : memory.files.get(keyForFile(relativePath));
        return text === undefined ? null : {success: true, text};
      },
      writeBinary: async ({projectId, relativePath, bytes}: {projectId: string; relativePath: string; bytes: Uint8Array}) => {
        checkPid(projectId); requirePersist(relativePath === lockPath, 'unexpected binary write');
        const content = new TextDecoder().decode(bytes);
        lockFiles.set(relativePath, content); lockOperations.push({operation:'writeBinary', relativePath, content}); return {success:true};
      },
      writeText: async (key: string, content: string) => {
        // Production README self-repair is recorded too, never hidden.
        fileForKey(key); memory.writes.push({key, content, channel:'projectFiles.writeText'}); memory.files.set(key, content); return {success:true};
      },
    },
  };
  try {
    const storage = createStudioWorkflowShardedStorage(storeName, {isHydrated: () => hydrated});
    const loaded = await storage.getItem(storeName);
    requirePersist(loaded !== null && isDeepStrictEqual(JSON.parse(loaded), snapshot.envelope), 'production hydration differs from snapshot');
    hydrated = true;
    verifyBaseline();
    await storage.setItem(storeName, JSON.stringify(applied.envelope));
    const writes = memory.writes.map(({key,content,channel}) => ({relativePath:fileForKey(key), channel, targetScope:channel === 'projectFiles.writeText' ? 'app-shadow' : 'registered-project', content, sha256:sha(content), bytes:Buffer.byteLength(content)}));
    requirePersist(writes.some(write => write.relativePath === manifestPath), 'production write rejected (write lock/hydration guard)');
    const nextManifestRaw = memory.files.get(keyForFile(manifestPath))!;
    const nextManifest = parseStudioWorkflowShardManifest(nextManifestRaw);
    requirePersist(nextManifest?.chapterIndex && isDeepStrictEqual(nextManifest.chapterIndex, snapshot.manifest.chapterIndex) && nextManifest.activeChapterId === chapter, 'chapter index changed');
    const archived = snapshot.manifest.shards.filter(name => name.startsWith('chapters/') && name.split('/')[1] !== chapter);
    requirePersist(isDeepStrictEqual(nextManifest.shards.filter(name => name.startsWith('chapters/') && name.split('/')[1] !== chapter), archived), 'archived chapter references changed');
    for (const name of snapshot.manifest.shards) {
      const relative = `store/studio-workflow/${name}`;
      requirePersist(memory.files.get(keyForFile(relative)) === baseline.get(relative), `old shard bytes changed: ${name}`);
    }
    // Fresh production instance: proves reads are from generated files, not its write cache.
    const reloadRaw = await createStudioWorkflowShardedStorage(storeName, {isHydrated: () => hydrated}).getItem(storeName);
    requirePersist(reloadRaw !== null, 'production reload failed');
    const reloaded = JSON.parse(reloadRaw) as Chapter001Snapshot['envelope'];
    const persistedEnvelope = JSON.parse(JSON.stringify(applied.envelope)) as Chapter001Snapshot['envelope'];
    requirePersist(isDeepStrictEqual(reloaded, persistedEnvelope), 'production reload differs from applied envelope: ' + Object.keys(persistedEnvelope.state).filter(key => !isDeepStrictEqual(reloaded.state[key], persistedEnvelope.state[key])).join(','));
    verifyBaseline();
    const manifestLast = writes.at(-1)?.relativePath === manifestPath;
    const blockers = manifestLast ? [] : ['production wrote README/other data after manifest; reconcile the baseline before any real commit'];
    return { mode:'dry-run' as const, safeToApply:manifestLast, realApplyImplemented:false, requiresMainReview:true, blockers, realProjectWrites:0, deletes:0, manifestLast, hydrated, writes, lockOperations, cleanup, preserved,
      projectId:CHAPTER001_PROJECT_ID, projectRoot:CHAPTER001_PERSIST_ROOT, chapterId:chapter, manifestSha256:snapshot.manifestSha256, sourceSha256:snapshot.sourceSha256,
      baselineHashes:[...baseline].map(([relativePath,raw]) => ({relativePath,sha256:sha(raw),bytes:Buffer.byteLength(raw)})),
      archivedChapters:snapshot.manifest.chapterIndex!.filter(entry => entry.id !== chapter).length, archivedShardCount:archived.length, archivedBytesUnchanged:true, allOldShardBytesPreserved:true,
      appliedDiff:applied.diff, media:mediaValidation ? {pins:mediaValidation.pins,frameCount:mediaValidation.frameCount,rendererSha256:mediaValidation.rendererSha256} : undefined, reloaded };
  } finally {
    // No deleteFile supplied: the production release contract writes ts=0 in memory.
    await __resetModuleStorageWriteLockForTests();
    (globalThis as unknown as {window: unknown}).window = oldWindow;
    memory.active = false;
    memory.files = new Map();
  }
}

function taskFile(file: string, output = false): string {
  const resolved = output ? path.join(realpathSync(path.dirname(file)), path.basename(file)) : realpathSync(file);
  const relative = path.relative(realpathSync(research), resolved);
  requirePersist(relative !== '' && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative), 'task artifact path escape');
  return resolved;
}
const inputFile = process.env.DIRECTOR_CHAPTER001_PERSIST_INPUT;
const outputFile = process.env.DIRECTOR_CHAPTER001_PERSIST_OUTPUT;
it.skipIf(!inputFile || !outputFile)('chapter001 production persistence dry-run CLI (no apply mode)', async () => {
  requirePersist(!process.env.DIRECTOR_CHAPTER001_APPLY_INPUT && !process.env.DIRECTOR_CHAPTER001_APPLY_OUTPUT, 'do not activate the bridge CLI in the same run');
  const input = JSON.parse(readFileSync(taskFile(inputFile!), 'utf8')) as {snapshotFile: string; job: Chapter001ApplyJob};
  const snapshot = JSON.parse(readFileSync(taskFile(input.snapshotFile), 'utf8')) as Chapter001Snapshot;
  const output = taskFile(outputFile!, true);
  const result = await dryRunChapter001Persistence(snapshot, input.job);
  writeFileSync(output, JSON.stringify(result, null, 2) + '\n', {flag:'wx'});
  requirePersist(result.safeToApply, result.blockers.join('; '));
});
