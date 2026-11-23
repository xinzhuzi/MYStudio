/** Task-only apply preflight. Real writes remain blocked by the production lock contract. */
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { it } from 'vitest';
import { CHAPTER001_PROJECT_ID, chapter001Sha256 as sha, type Chapter001ApplyJob, type Chapter001Snapshot } from './director_chapter001_bridge_1026.test';
import { CHAPTER001_PERSIST_ROOT, dryRunChapter001Persistence, type Chapter001ReadOnlySource } from './director_chapter001_persist_1026.test';

export const CHAPTER001_APPLY_1027_BLOCKER = 'production lock does not verify ownership after acquisition, revalidate a held owner, or fence data writes; safe cross-instance apply/rollback cannot be guaranteed without changing production contracts';
const taskRoot = path.resolve(import.meta.dirname, '../../../.trellis/tasks/10-25-daojie-director-rule-conflict-validation');
const sourceDisk: Chapter001ReadOnlySource = {
  read: file => {
    try { return readFileSync(file, 'utf8'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
  },
  realpath: file => realpathSync(file),
};
function requireApply(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
function record(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }
let running = false;

/** Deliberately has no writable project adapter. A valid rehearsal never grants apply permission. */
export async function prepareChapter001Apply1027(snapshotInput: Chapter001Snapshot, jobInput: Chapter001ApplyJob, options: { approved: boolean; registryFile: string; source?: Chapter001ReadOnlySource }) {
  requireApply(options.approved === true, 'explicit apply opt-in required');
  requireApply(!running, 'apply preflight already running');
  running = true;
  try {
    const snapshot = structuredClone(snapshotInput);
    const job = structuredClone(jobInput);
    const source = options.source ?? sourceDisk;
    const raw = source.read(options.registryFile);
    requireApply(raw !== null && source.realpath(options.registryFile) === options.registryFile, 'registered project registry missing or noncanonical');
    const registry: unknown = JSON.parse(raw);
    requireApply(record(registry) && record(registry.state) && Array.isArray(registry.state.projects), 'invalid project registry');
    const projects = registry.state.projects.filter((project: unknown) => record(project) && project.id === CHAPTER001_PROJECT_ID);
    requireApply(projects.length === 1 && record(projects[0]) && projects[0].location === CHAPTER001_PERSIST_ROOT && snapshot.projectRoot === projects[0].location, 'registered MA project location mismatch');
    requireApply(source.realpath(CHAPTER001_PERSIST_ROOT) === CHAPTER001_PERSIST_ROOT, 'registered MA project root is noncanonical');
    const rehearsal = await dryRunChapter001Persistence(snapshot, job, source);
    requireApply(source.read(options.registryFile) === raw, 'project registry changed during preflight');
    return {
      status: 'blocked' as const, realApplyImplemented: false, realProjectWrites: 0, backupsCreated: 0, deletes: 0,
      blockers: [CHAPTER001_APPLY_1027_BLOCKER, ...rehearsal.blockers],
      projectId: CHAPTER001_PROJECT_ID, projectRoot: CHAPTER001_PERSIST_ROOT, chapterId: 'chapter-001',
      registrySha256: sha(raw), manifestSha256: snapshot.manifestSha256, sourceSha256: snapshot.sourceSha256,
      rehearsal: {
        safeToApply: rehearsal.safeToApply, manifestLast: rehearsal.manifestLast, hydrated: rehearsal.hydrated,
        archivedChapters: rehearsal.archivedChapters, archivedShardCount: rehearsal.archivedShardCount,
        archivedBytesUnchanged: rehearsal.archivedBytesUnchanged, allOldShardBytesPreserved: rehearsal.allOldShardBytesPreserved,
        reloadedEnvelopeSha256: sha(JSON.stringify(rehearsal.reloaded)), baselineHashes: rehearsal.baselineHashes,
        writes: rehearsal.writes.map(({relativePath, channel, sha256, bytes}) => ({relativePath, channel, sha256, bytes})),
      },
    };
  } finally { running = false; }
}

function artifact(file: string, output = false): string {
  const resolved = output ? path.join(realpathSync(path.dirname(file)), path.basename(file)) : realpathSync(file);
  const base = realpathSync(path.join(taskRoot, 'research'));
  const relative = path.relative(base, resolved);
  requireApply(relative !== '' && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative), 'apply artifact path escape');
  if (output) requireApply(relative.split(path.sep)[0].startsWith('chapter001-apply-'), 'output must be chapter001-apply-prefixed evidence');
  return resolved;
}
const inputFile = process.env.DIRECTOR_CHAPTER001_REAL_APPLY_1027_INPUT;
const outputFile = process.env.DIRECTOR_CHAPTER001_REAL_APPLY_1027_OUTPUT;
it.skipIf(!inputFile || !outputFile)('chapter001 real apply 1027 CLI: validates then refuses unsafe production locking', async () => {
  requireApply(process.env.DIRECTOR_CHAPTER001_REAL_APPLY_1027 === '1', 'explicit apply opt-in required');
  requireApply(!process.env.DIRECTOR_CHAPTER001_APPLY_INPUT && !process.env.DIRECTOR_CHAPTER001_APPLY_OUTPUT && !process.env.DIRECTOR_CHAPTER001_PERSIST_INPUT && !process.env.DIRECTOR_CHAPTER001_PERSIST_OUTPUT, 'disable imported bridge/persist CLIs');
  const input = JSON.parse(readFileSync(artifact(inputFile!), 'utf8')) as {snapshotFile: string; job: Chapter001ApplyJob};
  const snapshot = JSON.parse(readFileSync(artifact(input.snapshotFile), 'utf8')) as Chapter001Snapshot;
  const registryFile = process.env.DIRECTOR_CHAPTER001_REAL_APPLY_1027_REGISTRY;
  requireApply(registryFile && path.isAbsolute(registryFile), 'canonical registry path required');
  const result = await prepareChapter001Apply1027(snapshot, input.job, {approved:true, registryFile});
  writeFileSync(artifact(outputFile!, true), JSON.stringify(result, null, 2) + '\n', {flag:'wx'});
  throw new Error(result.blockers.join('; '));
});
