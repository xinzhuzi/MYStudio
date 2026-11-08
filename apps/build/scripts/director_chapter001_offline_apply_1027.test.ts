/** Root-only opt-in executor for a separately established exclusive OFFLINE window.
 * No app/process is stopped here. The supervising root must keep all writers stopped.
 * This is a cooperative offline contract, not a repair of the production lock race.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { it } from 'vitest';
import { CHAPTER001_PROJECT_ID as pid, chapter001Sha256 as sha, type Chapter001Snapshot, type Chapter001ApplyJob } from './director_chapter001_bridge_1026.test';
import { CHAPTER001_PERSIST_ROOT as root, dryRunChapter001Persistence } from './director_chapter001_persist_1026.test';
import { fileStorage } from '@/lib/storage/indexed-db-storage';
import { createStudioWorkflowShardedStorage } from '@/lib/storage/storage-project-sharded';
import { parseStudioWorkflowShardManifest } from '@/lib/storage/studio-workflow-shards';
import { verifyMediaPins1027, type MediaPublicationInput1027, type MediaValidation1027 } from './director_chapter001_media_publication_1027.test';
import { normalizeStoredJson } from '@/electron/storage/pretty-json';

const task = path.resolve(import.meta.dirname, '../../../.trellis/tasks/10-25-daojie-director-rule-conflict-validation');
const manifest = 'store/studio-workflow/manifest.json';
const lock = 'store/.storage-write-lock.json';
const prefix = `_p/${pid}/`;
const store = 'studio-workflow-store';
const registryPath = '/Users/zhengbingjin/Project/IP/漫影工作室/projects/mystudio-project-store.json';
const claimFile = path.join(task, 'backups/chapter001-offline-apply-1027.claim.json');
const writerTokens = ['electron', 'mystudio', 'manying-studio', '漫影工作室'];
export interface OfflineProcess { pid: number; command: string }
export interface OfflineFileAdapter {
  temporaryFiles?: string[];
  read(file: string): Buffer | null;
  realpath(file: string): string;
  exclusive(file: string, bytes: Buffer, guard: () => void): void;
  atomic(file: string, bytes: Buffer, guard: () => void): void;
}
export interface OfflineWindowReceipt {
  operator: 'root'; id: string; startedAt: number; expiresAt: number;
  assertion: 'all-installed-and-dev-MYStudio-Electron-writers-stopped';
  snapshotSha256: string; jobSha256: string; registrySha256: string; baselineSha256: string;
  receipts: {file: string; sha256: string}[];
}
export interface OfflineApplyOptions {
  approved: boolean; media?: MediaPublicationInput1027; registryFile: string; window: OfflineWindowReceipt;
  files?: OfflineFileAdapter; processes?: () => OfflineProcess[]; now?: () => number;
}
function demand(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
function canonical(file: string): void {
  try { demand(realpathSync(file) === file, `noncanonical path: ${file}`); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    demand(path.dirname(file) !== file, 'cannot canonicalize path'); canonical(path.dirname(file));
  }
}
export const offlineDisk1027: OfflineFileAdapter = {
  temporaryFiles: [],
  read: file => { try { return readFileSync(file); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; } },
  realpath: file => { canonical(file); return file; },
  exclusive: (file, bytes, guard) => {
    guard(); canonical(file); mkdirSync(path.dirname(file), {recursive:true});
    guard(); writeFileSync(file, bytes, {flag:'wx'});
  },
  atomic: (file, bytes, guard) => {
    guard(); canonical(file); mkdirSync(path.dirname(file), {recursive:true});
    const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
    offlineDisk1027.temporaryFiles!.push(temporary);
    guard(); writeFileSync(temporary, bytes, {flag:'wx'});
    guard(); canonical(file); renameSync(temporary, file);
    // A failed guard/publication deliberately retains the temp; never delete/restore.
  },
};
export function offlineProcessInventory1027(): OfflineProcess[] {
  const raw = execFileSync('/bin/ps', ['-ww', '-axo', 'pid=,comm='], {encoding:'utf8',timeout:5000,maxBuffer:8*1024*1024});
  const rows = raw.trim().split('\n').map(line => {
    const match = /^\s*(\d+)\s+(.+)$/.exec(line);
    demand(match, 'uncertain process inventory row');
    return {pid:Number(match[1]), command:match[2]};
  });
  demand(rows.length > 0 && rows.some(row => row.pid === process.pid), 'incomplete process inventory');
  return rows;
}
export function offlineBaselineHash1027(rows: {relativePath:string;sha256:string;bytes:number}[]): string {
  return sha(JSON.stringify(rows.filter(row => row.relativePath !== lock).sort((a,b) => a.relativePath.localeCompare(b.relativePath))));
}
let preflightRunning = false;
let realAdaptersActive = false;
/** The old rehearsal mocks the IPC boundary before pretty JSON serialization.
 * Supply that real IPC formatting here; otherwise it falsely reports unchanged
 * pretty-printed source shards as overwritten by compact planning strings.
 */
export async function preflightChapter001Offline1027(snapshot: Chapter001Snapshot, job: Chapter001ApplyJob, files: OfflineFileAdapter = offlineDisk1027, media?: MediaPublicationInput1027) {
  demand(!preflightRunning && !realAdaptersActive, 'offline preflight/real apply already running');
  preflightRunning = true;
  const original = fileStorage.setItem;
  fileStorage.setItem = (key,raw) => original(key,normalizeStoredJson(raw));
  try {
    return await dryRunChapter001Persistence(snapshot,job,{
      read: file => files.read(file)?.toString('utf8') ?? null,
      realpath: files.realpath,
    }, media ? {input:media,files} : undefined);
  } finally { fileStorage.setItem = original; preflightRunning = false; }
}
function relative(value: string): string {
  demand(value && !path.isAbsolute(value) && !value.includes('\\') && value.split('/').every(part => part && part !== '.' && part !== '..') && [...value].every(char => char.charCodeAt(0) >= 32), 'unsafe relative path');
  return value;
}
function routed(key: string): string {
  demand(key.startsWith(prefix), 'wrong project storage route');
  const rest = relative(key.slice(prefix.length));
  demand(rest.startsWith('studio-workflow/') || rest === store, 'unexpected storage route');
  return `store/${rest}${rest.endsWith('.md') ? '' : '.json'}`;
}
type BackupRow = {state:'planned'|'verified'|'absent-recorded';relativePath:string; existed:boolean; sha256:string|null; bytes:number; backupFile:string|null};
type Mutation = {relativePath:string;sha256:string;bytes:number;kind:'lock'|'data'};
export class OfflineApplyFailure1027 extends Error {
  constructor(message:string, public receipt: Record<string,unknown>) { super(message); }
}
let running = false;
export async function applyChapter001Offline1027(snapshotInput: Chapter001Snapshot, jobInput: Chapter001ApplyJob, options: OfflineApplyOptions) {
  demand(options.approved === true, 'explicit offline apply opt-in required');
  demand(!running && !preflightRunning, 'offline apply already running');
  running = true;
  const files = options.files ?? offlineDisk1027;
  const now = options.now ?? Date.now;
  const processes = options.processes ?? offlineProcessInventory1027;
  const backups: BackupRow[] = [];
  const mutations: Mutation[] = [];
  const inventories: {at:number;sha256:string;count:number}[] = [];
  const result: Record<string,unknown> = {status:'blocked', operatingContract:'exclusive-offline', realApplyImplemented:true, projectId:pid,projectRoot:root,chapterId:'chapter-001', backups,mutations,inventories,deletes:0,rollbackAttempted:false,cleanupPolicy:'preserve-all-no-enumeration',legacyPolicy:'preserve-no-rename'};
  let owner: string | undefined;
  let publishedRaw: string | undefined;
  let sealed = false;
  let fatal: Error | undefined;
  let installed = false;
  const unload: (() => void)[] = [];
  const pending: Promise<unknown>[] = [];
  const oldWindow = (globalThis as unknown as {window?:unknown}).window;
  const oldGet = fileStorage.getItem, oldSet = fileStorage.setItem;
  const snapshot = structuredClone(snapshotInput), job = structuredClone(jobInput);
  const media = options.media ? structuredClone(options.media) : undefined;
  let mediaPins: MediaValidation1027['pins'] = [];
  const read = (file:string) => {
    const bytes = files.read(file);
    demand(bytes === null || files.realpath(file) === file, 'noncanonical source');
    if (bytes) demand(Buffer.from(bytes.toString('utf8')).equals(bytes), 'non-UTF8 storage bytes');
    return bytes?.toString('utf8') ?? null;
  };
  const text = (rel:string) => read(path.join(root,relative(rel)));
  let registryRaw: string | null = null;
  let claimRaw: string | undefined;
  const pinned = new Map<string,string|null>();
  const sourceOriginals = new Map(snapshot.sourceFiles.map(row => [row.relativePath,row.sha256]));
  const assertProcesses = () => {
    const rows = processes();
    demand(Array.isArray(rows) && rows.length > 0 && rows.every(row => Number.isInteger(row.pid) && row.pid > 0 && typeof row.command === 'string' && row.command.trim()), 'uncertain process inventory');
    const writers = rows.filter(row => writerTokens.some(token => row.command.toLowerCase().includes(token)));
    demand(writers.length === 0, 'writer process present: '+writers.map(row => `${row.pid}:${row.command}`).join(';'));
    inventories.push({at:now(),sha256:sha(JSON.stringify(rows)),count:rows.length});
  };
  const guard = () => {
    demand(!sealed && !fatal, fatal?.message ?? 'adapter sealed');
    assertProcesses();
    verifyMediaPins1027(mediaPins,files);
    const w = options.window;
    demand(w && w.operator === 'root' && w.assertion === 'all-installed-and-dev-MYStudio-Electron-writers-stopped' && /^[a-zA-Z0-9_-]{1,80}$/.test(w.id), 'root offline window receipt required');
    demand(Number.isFinite(w.startedAt) && Number.isFinite(w.expiresAt) && w.startedAt <= now() && w.expiresAt > now() && w.expiresAt-w.startedAt <= 15*60*1000, 'offline window expired or invalid');
    demand(read(options.registryFile) === registryRaw, 'project registry changed');
    for (const [file,raw] of pinned) demand(read(file) === raw, 'approved receipt/baseline drift: '+file);
    if (claimRaw) demand(read(claimFile) === claimRaw, 'exclusive invocation claim changed');
    for (const [rel,hash] of sourceOriginals) {
      const raw = text(rel);
      demand(raw !== null && (rel === manifest && publishedRaw !== undefined ? raw === publishedRaw : sha(raw) === hash), 'original source drift: '+rel);
    }
  };
  const lockShape = (raw = text(lock)) => {
    if (raw === null) return null;
    const value = JSON.parse(raw) as {id?:unknown;ts?:unknown};
    demand(value && typeof value.id === 'string' && value.id.length > 0 && typeof value.ts === 'number' && Number.isFinite(value.ts) && value.ts >= 0, 'uncertain lock record');
    return {id:value.id,ts:value.ts};
  };
  const assertOwner = () => {
    const current = lockShape();
    demand(owner && current?.id === owner && current.ts > 0 && now()-current.ts < 15000, 'own production lock ownership lost');
  };
  const backupDir = () => path.join(task,'backups','chapter001-offline-apply-1027-'+options.window.id);
  const mutate = (rel:string,raw:string,kind:'lock'|'data',expectedLockRaw?:string|null) => {
    try {
      guard();
      if (kind === 'data') assertOwner();
      const target = path.join(root,relative(rel));
      const previous = files.read(target);
      if (kind === 'lock') demand((previous?.toString('utf8') ?? null) === expectedLockRaw, 'lock changed before mutation');
      // Existing referenced immutable shards may only be rewritten byte-identically.
      if (sourceOriginals.has(rel) && rel !== manifest) demand(previous?.equals(Buffer.from(raw)), 'would overwrite original source shard: '+rel);
      const index = backups.length;
      const backupFile = previous === null ? null : path.join(backupDir(),`${index}.original`);
      const row: BackupRow = {state:'planned',relativePath:rel,existed:previous !== null,sha256:previous === null ? null : sha(previous.toString('utf8')),bytes:previous?.length ?? 0,backupFile};
      backups.push(row);
      if (backupFile && previous) {
        files.exclusive(backupFile,previous,guard);
        demand(files.read(backupFile)?.equals(previous), 'backup exact byte verification failed');
      }
      row.state = previous === null ? 'absent-recorded' : 'verified';
      files.exclusive(path.join(backupDir(),`${index}.receipt.json`),Buffer.from(JSON.stringify(row)),guard);
      const fence = () => {
        guard();
        if (kind === 'data') assertOwner();
        demand((files.read(target) === null && previous === null) || files.read(target)?.equals(previous!), 'target changed before mutation');
      };
      files.atomic(target,Buffer.from(raw),fence);
      if (rel === manifest) publishedRaw = raw;
      demand(read(target) === raw, 'atomic publication readback mismatch');
      mutations.push({relativePath:rel,sha256:sha(raw),bytes:Buffer.byteLength(raw),kind});
    } catch (error) { fatal = error instanceof Error ? error : new Error(String(error)); throw fatal; }
  };
  try {
    assertProcesses();
    demand(options.registryFile === registryPath && files.realpath(options.registryFile) === options.registryFile, 'authoritative canonical registry required');
    registryRaw = read(options.registryFile);
    demand(registryRaw !== null, 'project registry missing');
    const registry = JSON.parse(registryRaw) as {state?:{projects?:{id:string;location:string}[]}};
    demand(Array.isArray(registry.state?.projects), 'invalid project registry');
    const matches = registry.state.projects.filter(p => p.id === pid);
    demand(matches.length === 1 && registry.state.projects.filter(p => p.location === root).length === 1 && matches[0].location === root && snapshot.projectRoot === root && files.realpath(root) === root, 'registered MA project mismatch');
    demand(options.window?.registrySha256 === sha(registryRaw) && options.window.snapshotSha256 === sha(JSON.stringify(snapshot)) && options.window.jobSha256 === sha(JSON.stringify(job)), 'window hash binding mismatch');
    demand(options.window.receipts.length > 0, 'approved build/media/root receipts required');
    for (const row of options.window.receipts) {
      demand(path.isAbsolute(row.file) && row.file.startsWith(task+path.sep), 'approval receipt outside task');
      const raw = read(row.file); demand(raw !== null && sha(raw) === row.sha256, 'approval receipt hash mismatch'); pinned.set(row.file,raw);
    }
    if (media) for (const ref of Object.values(media)) demand(options.window.receipts.some(row=>row.file===ref.file && row.sha256===ref.sha256),'media artifact lacks exact root window receipt');
    guard();
    const initialLock = lockShape();
    demand(!initialLock || initialLock.ts === 0 || now()-initialLock.ts >= 15000, 'foreign fresh lock present');
    const rehearsal = await preflightChapter001Offline1027(snapshot,job,files,media);
    mediaPins = rehearsal.media?.pins ?? [];
    verifyMediaPins1027(mediaPins,files);
    demand(rehearsal.safeToApply && rehearsal.manifestLast && rehearsal.hydrated, 'preflight unsafe: '+rehearsal.blockers.join(';'));
    demand(rehearsal.archivedChapters === 4124 && rehearsal.archivedBytesUnchanged, 'other 4124 baseline incomplete');
    demand(options.window.baselineSha256 === offlineBaselineHash1027(rehearsal.baselineHashes), 'exact project baseline hash mismatch');
    for (const row of rehearsal.baselineHashes) {
      if (row.relativePath === lock) continue;
      const raw = text(row.relativePath); demand(raw !== null && sha(raw) === row.sha256, 'baseline changed');
      if (!sourceOriginals.has(row.relativePath) && !row.relativePath.startsWith('store/studio-workflow/chapters/')) pinned.set(path.join(root,row.relativePath),raw);
    }
    const verifyArchived = () => {
      for (const row of rehearsal.baselineHashes.filter(row => row.relativePath.startsWith('store/studio-workflow/chapters/') && row.relativePath.split('/')[3] !== 'chapter-001')) demand(sha(text(row.relativePath) ?? '') === row.sha256, 'other chapter shard hash changed: '+row.relativePath);
    };
    guard(); verifyArchived();
    const nextClaimRaw = JSON.stringify({operator:'root',id:options.window.id,pid:process.pid,startedAt:now(),jobSha256:options.window.jobSha256});
    // Persistent, non-reusable O_EXCL claim prevents another script invocation. Never deleted.
    files.exclusive(claimFile,Buffer.from(nextClaimRaw),guard);
    claimRaw = nextClaimRaw;
    result.window = structuredClone(options.window);
    result.media = rehearsal.media;
    result.registrySha256 = sha(registryRaw); result.baselineSha256 = options.window.baselineSha256;
    result.sourceSha256 = snapshot.sourceSha256; result.originalManifestSha256 = snapshot.manifestSha256;
    result.rehearsal = {safeToApply:true,manifestLast:true,archivedChapters:4124,baselineHashes:rehearsal.baselineHashes};
    let hydrated = false;
    const readKey = async (key:string) => text(routed(key));
    const writeKey = async (key:string,raw:string) => {
      const rel = routed(key);
      demand(rel.startsWith('store/studio-workflow/') && !rel.endsWith('.md'), 'unexpected data write');
      demand(!publishedRaw, 'data write after manifest');
      if (rel === manifest) verifyArchived();
      mutate(rel,normalizeStoredJson(raw),'data');
    };
    fileStorage.getItem = readKey; fileStorage.setItem = writeKey;
    (globalThis as unknown as {window:unknown}).window = {
      addEventListener: (name:string,callback:() => void) => { if (name === 'beforeunload') unload.push(callback); },
      fileStorage: {exists:async (key:string) => (await readKey(key)) !== null,listKeys:async () => [],listDirs:async () => [],renameItem:async () => false},
      projectFiles: {
        readText: async (payload:{projectId:string;relativePath:string}) => {
          demand(payload.projectId === pid && payload.relativePath === lock, 'unexpected production lock read');
          const raw = text(lock); return raw === null ? null : {success:true,text:raw};
        },
        writeBinary: (payload:{projectId:string;relativePath:string;bytes:Uint8Array}) => {
          const run = (async () => {
            try {
              demand(payload.projectId === pid && payload.relativePath === lock, 'unexpected production lock write');
              const raw = new TextDecoder().decode(payload.bytes);
              const value = JSON.parse(raw) as {id:string;ts:number};
              guard(); const currentRaw = text(lock); const current = lockShape(currentRaw);
              if (!owner) {
                demand(!current || current.ts === 0 || now()-current.ts >= 15000, 'foreign fresh lock present');
                owner = value.id;
              } else demand(current?.id === owner, 'production lock ownership lost');
              demand(value.id === owner, 'production owner token changed');
              mutate(lock,raw,'lock',currentRaw);
              return {success:true};
            } catch (error) { fatal = error instanceof Error ? error : new Error(String(error)); return {success:false}; }
          })(); pending.push(run); return run;
        },
        writeText: async () => { fatal = new Error('README must already match before apply'); throw fatal; },
      },
    };
    installed = true; realAdaptersActive = true;
    const storage = createStudioWorkflowShardedStorage(store,{isHydrated:() => hydrated});
    const loaded = await storage.getItem(store);
    demand(loaded !== null && isDeepStrictEqual(JSON.parse(loaded),snapshot.envelope), 'production hydration mismatch');
    hydrated = true; guard();
    await storage.setItem(store,JSON.stringify(rehearsal.reloaded)); // exactly one real production save
    demand(!fatal && publishedRaw && mutations.filter(row => row.kind === 'data').at(-1)?.relativePath === manifest, fatal?.message ?? 'production save rejected');
    guard(); assertOwner(); verifyArchived();
    const next = parseStudioWorkflowShardManifest(publishedRaw);
    const archived = (names:string[]) => names.filter(name => name.startsWith('chapters/') && name.split('/')[1] !== 'chapter-001');
    demand(next && isDeepStrictEqual(next.chapterIndex,snapshot.manifest.chapterIndex) && next.activeChapterId === 'chapter-001' && isDeepStrictEqual(archived(next.shards),archived(snapshot.manifest.shards)), 'published manifest identity mismatch');
    const fresh = await createStudioWorkflowShardedStorage(store,{isHydrated:() => hydrated}).getItem(store);
    demand(fresh !== null && isDeepStrictEqual(JSON.parse(fresh),rehearsal.reloaded), 'fresh production reload envelope/domain mismatch');
    result.status = 'applied'; result.hydrated = true; result.manifestLast = true;
    result.freshReloadSha256 = sha(fresh); result.manifestSha256 = sha(publishedRaw);
    result.archivedChapters = 4124; result.archivedShardHashesUnchanged = true;
    result.sourceIdentityUnchanged = true;
  } catch (error) {
    result.status = 'blocked'; result.blocker = error instanceof Error ? error.message : String(error);
  } finally {
    try {
      try {
        if (installed) {
          for (const callback of unload) callback();
          await Promise.all(pending);
          if (fatal) { result.status = 'blocked'; result.blocker = fatal.message; }
        }
      } catch (error) {
        result.status = 'blocked'; result.blocker ??= String(error); result.finalizationError = String(error);
      } finally {
        if (installed) {
          // Timers remain standard production timers; CLI exits after the receipt.
          // Tests alone clear timers with the existing production test cleanup hook.
          sealed = true; realAdaptersActive = false;
          fileStorage.getItem = oldGet; fileStorage.setItem = oldSet;
          (globalThis as unknown as {window:unknown}).window = oldWindow;
        }
      }
      result.dataWrites = mutations.filter(row => row.kind === 'data').length;
      result.publicationObserved = publishedRaw !== undefined;
      const retained: string[] = [];
      const inspectionErrors: {file:string;error:string}[] = [];
      for (const file of files.temporaryFiles ?? []) {
        try { if (files.read(file) !== null) retained.push(file); }
        catch (error) {
          // An unreadable path may still contain recovery evidence. Keep it unknown.
          retained.push(file); inspectionErrors.push({file,error:String(error)});
        }
      }
      result.retainedTemporaryFiles = retained;
      if (inspectionErrors.length > 0) {
        result.status = 'blocked'; result.blocker ??= 'temporary file inspection failed';
        result.temporaryInspectionErrors = inspectionErrors;
      }
      try {
        const current = text(manifest);
        result.originalManifestPreserved = current === snapshot.manifestRaw;
        result.currentManifestSha256 = sha(current ?? '');
      } catch (error) { result.status = 'blocked'; result.blocker ??= 'manifest inspection failed'; result.inspectionError = String(error); }
    } finally { running = false; }
  }
  if (result.status !== 'applied') throw new OfflineApplyFailure1027(String(result.blocker),result);
  return result;
}

function artifact(file:string, output=false): string {
  const resolved = output ? path.join(realpathSync(path.dirname(file)),path.basename(file)) : realpathSync(file);
  demand(resolved.startsWith(path.join(task,'research')+path.sep), 'artifact outside task research');
  if (output) demand(path.relative(path.join(task,'research'),resolved).split(path.sep)[0].startsWith('chapter001-offline-apply-'), 'output evidence prefix mismatch');
  return resolved;
}
const inputFile = process.env.DIRECTOR_CHAPTER001_OFFLINE_APPLY_1027_INPUT;
const outputFile = process.env.DIRECTOR_CHAPTER001_OFFLINE_APPLY_1027_OUTPUT;
it.skipIf(!inputFile || !outputFile)('root-only exclusive offline persistence CLI', async () => {
  const mode = process.env.DIRECTOR_CHAPTER001_OFFLINE_APPLY_1027;
  demand(mode === 'ROOT_EXCLUSIVE_OFFLINE' || mode === 'READ_ONLY_PREFLIGHT', 'explicit offline mode required');
  demand(!process.env.DIRECTOR_CHAPTER001_APPLY_INPUT && !process.env.DIRECTOR_CHAPTER001_APPLY_OUTPUT && !process.env.DIRECTOR_CHAPTER001_PERSIST_INPUT && !process.env.DIRECTOR_CHAPTER001_PERSIST_OUTPUT && !process.env.DIRECTOR_CHAPTER001_REAL_APPLY_1027_INPUT, 'disable imported CLIs');
  const output = artifact(outputFile!,true);
  demand(offlineDisk1027.read(output) === null, 'output already exists');
  let receipt: Record<string,unknown>; let code = 0;
  try {
    const input = JSON.parse(readFileSync(artifact(inputFile!), 'utf8')) as {snapshotFile:string;job:Chapter001ApplyJob;registryFile:string;window:OfflineWindowReceipt;media?:MediaPublicationInput1027};
    const snapshot = JSON.parse(readFileSync(artifact(input.snapshotFile),'utf8')) as Chapter001Snapshot;
    if (mode === 'READ_ONLY_PREFLIGHT') {
      demand(input.registryFile === registryPath, 'authoritative registry required');
      const registryRaw = readFileSync(realpathSync(input.registryFile),'utf8');
      const rehearsal = await preflightChapter001Offline1027(snapshot,input.job,offlineDisk1027,input.media);
      demand(rehearsal.safeToApply && rehearsal.manifestLast, 'unsafe persistence preflight');
      receipt = {status:'preflight-only',realProjectWrites:0,safeToApply:true,manifestLast:true,
        snapshotSha256:sha(JSON.stringify(snapshot)),jobSha256:sha(JSON.stringify(input.job)),registrySha256:sha(registryRaw),
        baselineSha256:offlineBaselineHash1027(rehearsal.baselineHashes),baselineHashes:rehearsal.baselineHashes,
        writes:rehearsal.writes.map(({relativePath,channel,bytes,sha256}) => ({relativePath,channel,bytes,sha256})),
        archivedChapters:rehearsal.archivedChapters,media:rehearsal.media};
    } else receipt = await applyChapter001Offline1027(snapshot,input.job,{approved:true,registryFile:input.registryFile,window:input.window,media:input.media});
  } catch (error) { code = 1; receipt = error instanceof OfflineApplyFailure1027 ? error.receipt : {status:'blocked',blocker:String(error)}; }
  writeFileSync(output,JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});
  // A dedicated Vitest worker is required; normal runner teardown ends timers.
  // The sealed I/O adapter rejects any heartbeat after this receipt.
  if (code !== 0) throw new Error(String(receipt.blocker ?? 'offline apply blocked')); 
},15*60*1000);
