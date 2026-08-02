// @vitest-environment node
import { Buffer } from 'node:buffer'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { once } from 'node:events'
import { spawn, spawnSync } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'
import {
  applyApprovedUserDataTrashManifest,
  approveFinderMetadataTrashManifest,
  buildFinderMetadataTrashManifest,
  runCli,
  scanUserData,
  sqliteEvidence,
} from './user-data-governance.mjs'

const roots = []
afterEach(() => { while (roots.length) fs.rmSync(roots.pop(), { recursive: true, force: true }) })

function makeRoot(prefix = 'mystudio-user-data-') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  roots.push(root)
  return root
}

function createSqlite(file, table = 'evidence') {
  const result = spawnSync('python3', ['-c', `import sqlite3,sys; c=sqlite3.connect(sys.argv[1]); c.execute("create table ${table}(id integer)"); c.commit(); c.close()`, file], { encoding: 'utf8' })
  expect(result.status, result.stderr).toBe(0)
}

async function startExclusiveSqliteLock(file) {
  const child = spawn('python3', ['-u', '-c', 'import sqlite3,sys; c=sqlite3.connect(sys.argv[1], timeout=0); c.execute("begin exclusive"); print("locked", flush=True); sys.stdin.read(1); c.rollback(); c.close()', file], {
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  const ready = new Promise((resolve, reject) => {
    child.stdout.once('data', (data) => resolve(data.toString().trim()))
    child.stderr.once('data', (data) => reject(new Error(data.toString())))
    child.once('exit', (code) => reject(new Error(`SQLite lock process exited before ready: ${code}`)))
  })
  expect(await ready).toBe('locked')
  return child
}

async function stopExclusiveSqliteLock(child) {
  const exited = once(child, 'exit')
  child.stdin.write('x')
  const [code] = await exited
  expect(code).toBe(0)
}

describe('user data governance scanner', () => {
  it('emits read-only file, JSON, SQLite and protected-category evidence in an isolated fixture', () => {
    const root = makeRoot()
    fs.mkdirSync(path.join(root, 'assets'), { recursive: true })
    fs.mkdirSync(path.join(root, 'projects'), { recursive: true })
    fs.writeFileSync(path.join(root, 'storage-config.json'), '{"basePath":""}\n')
    fs.writeFileSync(path.join(root, 'projects', 'note.txt'), 'hello\n')
    fs.writeFileSync(path.join(root, 'assets.db'), '')
    createSqlite(path.join(root, 'assets', 'assets.db'))
    const manifest = scanUserData({ userData: root })
    expect(manifest.schemaVersion).toBe(2)
    expect(manifest.mode).toBe('read-only')
    expect(manifest.files.find((f) => f.path === 'storage-config.json')).toMatchObject({ type: 'file', category: 'configuration', json: { valid: true } })
    expect(manifest.files.find((f) => f.path === 'projects/note.txt')).toMatchObject({ category: 'user-projects', disposition: 'preserve-until-approved' })
    expect(manifest.files.find((f) => f.path === 'assets/assets.db')?.sqlite).toMatchObject({ format: 'sqlite', status: 'ok', integrity: 'ok', tables: ['evidence'] })
    expect(manifest.files.find((f) => f.path === 'assets.db')).toMatchObject({ category: 'legacy-orphan-evidence', disposition: 'preserve-until-approved', sqlite: null })
    expect(manifest.summary.sqlite).toBe(1)
    expect(manifest.summary.sqliteStatuses).toEqual({ ok: 1, locked: 0, 'corrupt-or-unreadable': 0 })
    expect(fs.existsSync(path.join(root, 'projects', 'note.txt'))).toBe(true)
  })

  it('classifies Finder metadata, Chromium state, runtime markers and held historical evidence', () => {
    const root = makeRoot()
    fs.mkdirSync(path.join(root, 'Cache'), { recursive: true })
    fs.mkdirSync(path.join(root, 'Local Storage', 'leveldb'), { recursive: true })
    fs.mkdirSync(path.join(root, 'assets'), { recursive: true })
    fs.mkdirSync(path.join(root, 'projects'), { recursive: true })
    fs.writeFileSync(path.join(root, 'projects', '.DS_Store'), 'finder')
    fs.writeFileSync(path.join(root, 'Cache', 'data.bin'), 'cache')
    fs.writeFileSync(path.join(root, 'Local Storage', 'leveldb', '000003.log'), 'state')
    fs.writeFileSync(path.join(root, 'DevToolsActivePort'), '9222\nfixture')
    fs.writeFileSync(path.join(root, '.com.github.Electron.fixture'), 'single-instance-token')
    fs.writeFileSync(path.join(root, 'assets', 'assets.db.bak-20260803'), 'backup')
    fs.writeFileSync(path.join(root, 'assets', 'db.json.migrated'), '{}\n')
    fs.writeFileSync(path.join(root, 'unknown.bin'), 'unknown')

    const manifest = scanUserData({ userData: root })
    expect(manifest.files.find((f) => f.path === 'projects/.DS_Store')).toMatchObject({
      category: 'finder-metadata',
      disposition: 'trash-eligible-after-approval',
      classificationEvidence: 'basename=.DS_Store',
    })
    expect(manifest.files.find((f) => f.path === 'Cache/data.bin')).toMatchObject({ category: 'rebuildable-cache', disposition: 'preserve-until-exit-and-evidence' })
    expect(manifest.files.find((f) => f.path === 'Local Storage/leveldb/000003.log')).toMatchObject({ category: 'electron-state', disposition: 'preserve-until-exit-and-evidence' })
    expect(manifest.files.find((f) => f.path === 'DevToolsActivePort')).toMatchObject({ category: 'runtime-lock-marker', disposition: 'preserve-until-exit-and-evidence' })
    expect(manifest.files.find((f) => f.path === '.com.github.Electron.fixture')).toMatchObject({ category: 'runtime-lock-marker', disposition: 'preserve-until-exit-and-evidence' })
    expect(manifest.files.find((f) => f.path === 'assets/assets.db.bak-20260803')).toMatchObject({ category: 'legacy-db-backup', disposition: 'preserve-until-approved' })
    expect(manifest.files.find((f) => f.path === 'assets/db.json.migrated')).toMatchObject({ category: 'migration-evidence', disposition: 'preserve-until-approved' })
    expect(manifest.files.find((f) => f.path === 'unknown.bin')).toMatchObject({ category: 'unclassified', disposition: 'hold-unclassified' })
    expect(manifest.files.filter((f) => f.disposition === 'trash-eligible-after-approval').map((f) => f.path)).toEqual(['projects/.DS_Store'])
  })

  it('distinguishes internal, external and unresolved marker-style symlinks', () => {
    const root = makeRoot()
    const outside = makeRoot('mystudio-outside-')
    fs.mkdirSync(path.join(root, 'python', 'bin'), { recursive: true })
    fs.writeFileSync(path.join(root, 'python', 'bin', 'python3.12'), 'runtime')
    fs.writeFileSync(path.join(outside, 'secret.txt'), 'secret')
    fs.symlinkSync('python3.12', path.join(root, 'python', 'bin', 'python3'))
    fs.symlinkSync(path.join(outside, 'secret.txt'), path.join(root, 'escape.txt'))
    fs.symlinkSync('missing.txt', path.join(root, 'broken.txt'))
    fs.symlinkSync(path.join(outside, 'missing-singleton.sock'), path.join(root, 'SingletonSocket'))

    const manifest = scanUserData({ userData: root })
    expect(manifest.files.find((f) => f.path === 'python/bin/python3')).toMatchObject({
      category: 'python-runtime',
      disposition: 'preserve-until-approved',
      symlink: { target: 'python3.12', escaped: false, resolutionStatus: 'resolved' },
    })
    expect(manifest.files.find((f) => f.path === 'escape.txt')).toMatchObject({
      disposition: 'hold-symlink-escape',
      symlink: { target: path.join(outside, 'secret.txt'), escaped: true, resolutionStatus: 'resolved' },
    })
    expect(manifest.files.find((f) => f.path === 'broken.txt')).toMatchObject({
      disposition: 'hold-unresolved-symlink',
      symlink: { target: 'missing.txt', resolved: null, escaped: false, resolutionStatus: 'unresolved' },
    })
    expect(manifest.files.find((f) => f.path === 'SingletonSocket')).toMatchObject({
      category: 'runtime-lock-marker',
      disposition: 'preserve-until-exit-and-evidence',
      symlink: {
        target: path.join(outside, 'missing-singleton.sock'),
        resolved: null,
        escaped: false,
        resolutionStatus: 'unresolved',
        markerKind: 'chromium-singleton-socket',
      },
    })
  })

  it('builds an exact Finder metadata candidate and requires explicit approval', () => {
    const root = makeRoot()
    fs.mkdirSync(path.join(root, 'projects'), { recursive: true })
    fs.writeFileSync(path.join(root, '.DS_Store'), 'root finder')
    fs.writeFileSync(path.join(root, 'projects', '.DS_Store'), 'nested finder')
    fs.writeFileSync(path.join(root, 'projects', 'project.json'), '{}')

    const scan = scanUserData({ userData: root })
    const candidate = buildFinderMetadataTrashManifest({ scanManifest: scan, batchId: 'batch-userdata-ds-001' })
    expect(candidate).toMatchObject({ mode: 'trash-candidate', approved: false, summary: { targets: 2 } })
    expect(candidate.targets.map((target) => target.path)).toEqual(['.DS_Store', 'projects/.DS_Store'])
    expect(candidate.targets.every((target) => target.approved === false)).toBe(true)
    expect(() => approveFinderMetadataTrashManifest({ candidate })).toThrow(/approval note/)

    const approved = approveFinderMetadataTrashManifest({ candidate, approvalNote: '用户批准精确 Finder 元数据批次' })
    expect(approved).toMatchObject({ mode: 'approved-trash', approved: true, batchId: 'batch-userdata-ds-001' })
    expect(approved.targets.every((target) => target.approved === true)).toBe(true)

    const outputRoot = makeRoot('mystudio-user-data-batch-output-')
    const output = path.join(outputRoot, 'candidate.json')
    const cliResult = runCli(['batch', '--user-data', root, '--output', output, '--batch-id', 'batch-userdata-ds-cli'])
    expect(cliResult.manifest).toMatchObject({ mode: 'trash-candidate', batchId: 'batch-userdata-ds-cli', summary: { targets: 2 } })
    expect(() => runCli(['batch', '--user-data', root, '--output', output, '--batch-id', 'batch-userdata-ds-cli'])).toThrow(/already exists/)

    const candidatePath = path.join(outputRoot, 'candidate-api.json')
    const approvedOutput = path.join(outputRoot, 'approved.json')
    fs.writeFileSync(candidatePath, `${JSON.stringify(candidate)}\n`)
    const approvedCli = runCli(['approve', '--user-data', root, '--manifest', candidatePath, '--output', approvedOutput, '--approval-note', 'CLI approval fixture'])
    expect(approvedCli.manifest).toMatchObject({ mode: 'approved-trash', approved: true, approvalNote: 'CLI approval fixture' })
  })

  it('applies only an approved, unchanged Finder metadata batch through exact Trash argv', () => {
    const root = makeRoot()
    const evidenceRoot = makeRoot('mystudio-user-data-evidence-')
    fs.writeFileSync(path.join(root, '.DS_Store'), 'finder')
    const candidate = buildFinderMetadataTrashManifest({
      scanManifest: scanUserData({ userData: root }),
      batchId: 'batch-userdata-ds-002',
    })
    const approved = approveFinderMetadataTrashManifest({ candidate, approvalNote: 'approved fixture batch' })
    const appliedOutput = path.join(evidenceRoot, 'applied.json')
    const calls = []
    const result = applyApprovedUserDataTrashManifest({
      userData: root,
      manifest: approved,
      batchId: 'batch-userdata-ds-002',
      appliedOutput,
      confirmAppExited: true,
      trashRunner: (argv) => {
        calls.push(argv)
        fs.unlinkSync(argv.at(-1))
        return { status: 0 }
      },
    })

    expect(calls).toEqual([['/usr/bin/trash', '--stopOnError', '--verbose', path.join(fs.realpathSync(root), '.DS_Store')]])
    expect(fs.existsSync(path.join(root, '.DS_Store'))).toBe(false)
    expect(JSON.parse(fs.readFileSync(appliedOutput, 'utf8'))).toMatchObject({ mode: 'applied-trash', status: 'applied', batchId: 'batch-userdata-ds-002' })
    expect(result.applied.targets[0].recovery.mechanism).toBe('macOS Trash')
    expect(() => applyApprovedUserDataTrashManifest({ userData: root, manifest: approved, batchId: 'batch-userdata-ds-002', appliedOutput: path.join(evidenceRoot, 'second.json'), confirmAppExited: false, trashRunner: () => ({ status: 0 }) })).toThrow(/confirmAppExited/)
  })

  it('classifies SQLite integrity as ok, locked or corrupt-or-unreadable', async () => {
    const root = makeRoot()
    fs.mkdirSync(path.join(root, 'assets'), { recursive: true })
    createSqlite(path.join(root, 'assets', 'assets.db'), 'active_assets')
    createSqlite(path.join(root, 'locked.db'), 'locked_evidence')
    const corrupt = Buffer.alloc(512, 0x7f)
    corrupt.write('SQLite format 3\0', 0, 'binary')
    fs.writeFileSync(path.join(root, 'corrupt.db'), corrupt)
    const locker = await startExclusiveSqliteLock(path.join(root, 'locked.db'))

    try {
      const manifest = scanUserData({ userData: root })
      expect(manifest.files.find((f) => f.path === 'assets/assets.db')?.sqlite).toMatchObject({ status: 'ok', integrity: 'ok' })
      expect(manifest.files.find((f) => f.path === 'locked.db')?.sqlite).toMatchObject({ status: 'locked' })
      expect(manifest.files.find((f) => f.path === 'corrupt.db')?.sqlite).toMatchObject({ status: 'corrupt-or-unreadable' })
      expect(manifest.summary.sqliteStatuses).toEqual({ ok: 1, locked: 1, 'corrupt-or-unreadable': 1 })
    } finally {
      await stopExclusiveSqliteLock(locker)
    }
  })

  it('keeps scanning when a SQLite header cannot be read', () => {
    const root = makeRoot()
    const evidence = sqliteEvidence(path.join(root, 'unreadable.db'))
    expect(evidence).toMatchObject({ format: 'sqlite', status: 'corrupt-or-unreadable' })
  })

  it('keeps output outside userData and never overwrites an existing manifest', () => {
    const root = makeRoot()
    const outputRoot = makeRoot('mystudio-manifest-output-')
    fs.writeFileSync(path.join(root, 'note.txt'), 'evidence')
    const output = path.join(outputRoot, 'manifest.json')
    const first = runCli(['--user-data', root, '--output', output])
    const firstBytes = fs.readFileSync(output, 'utf8')
    expect(first.mode).toBe('read-only')
    expect(() => runCli(['--user-data', root, '--output', output])).toThrow(/output already exists/)
    expect(fs.readFileSync(output, 'utf8')).toBe(firstBytes)
    expect(() => scanUserData({ userData: root, output: path.join(root, 'reports', 'manifest.json') })).toThrow(/outside userData/)
  })
})
