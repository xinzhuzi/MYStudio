import crypto from 'node:crypto'
import { Buffer } from 'node:buffer'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { spawnSync } from 'node:child_process'

const PROTECTED_ROOTS = new Map([
  ['storage-config.json', 'configuration'], ['projects', 'user-projects'], ['media', 'user-media'],
  ['assets', 'active-assets'], ['skills', 'skills'], ['python', 'python-runtime'],
  ['tts-models', 'models'], ['tts-runtime', 'tts-runtime'], ['remotion-runtime', 'remotion-runtime'],
  ['remotion-studio', 'remotion-studio'], ['logs', 'logs'], ['diagnostics', 'diagnostics'],
  ['self-media', 'self-media'],
])

const REBUILDABLE_CACHE_ROOTS = new Set([
  'Cache', 'Code Cache', 'GPUCache', 'DawnGraphiteCache', 'DawnWebGPUCache',
])

const ELECTRON_STATE_ROOTS = new Set([
  'Local Storage', 'IndexedDB', 'WebStorage', 'Preferences', 'File System',
  'Session Storage', 'Shared Dictionary', 'SharedStorage', 'databases',
  'databases-off-the-record', 'blob_storage', 'Network Persistent State',
  'TransportSecurity',
])

const RUNTIME_MARKERS = new Map([
  ['DevToolsActivePort', 'chromium-devtools-active-port'],
  ['SingletonLock', 'chromium-singleton-lock'],
  ['SingletonCookie', 'chromium-singleton-cookie'],
  ['SingletonSocket', 'chromium-singleton-socket'],
])

export const USER_DATA_TRASH_MANIFEST_SCHEMA_VERSION = 1
export const MAX_USER_DATA_TRASH_TARGETS = 20

function normalizeRelativePath(relativePath) {
  return relativePath.split(path.sep).join('/')
}

function markerKind(relativePath) {
  const normalized = normalizeRelativePath(relativePath)
  if (normalized.includes('/')) return null
  const basename = normalized
  if (RUNTIME_MARKERS.has(basename)) return RUNTIME_MARKERS.get(basename)
  if (/^\.com\.github\.Electron\.[^/]+$/.test(basename)) return 'electron-single-instance-token'
  return null
}

function classifyRelativePath(relativePath) {
  const normalized = normalizeRelativePath(relativePath)
  const first = normalized.split('/')[0]
  const basename = path.posix.basename(normalized)
  if (basename === '.DS_Store') {
    return { category: 'finder-metadata', disposition: 'trash-eligible-after-approval', evidence: 'basename=.DS_Store' }
  }
  if (normalized === 'assets.db') {
    return { category: 'legacy-orphan-evidence', disposition: 'preserve-until-approved', evidence: 'path=assets.db' }
  }
  if (/^assets\/assets\.db\.bak-.+$/.test(normalized)) {
    return { category: 'legacy-db-backup', disposition: 'preserve-until-approved', evidence: 'path=assets/assets.db.bak-*' }
  }
  if (normalized === 'assets/db.json.migrated') {
    return { category: 'migration-evidence', disposition: 'preserve-until-approved', evidence: 'path=assets/db.json.migrated' }
  }
  const marker = markerKind(normalized)
  if (marker) {
    return { category: 'runtime-lock-marker', disposition: 'preserve-until-exit-and-evidence', evidence: `marker=${marker}` }
  }
  if (REBUILDABLE_CACHE_ROOTS.has(first)) {
    return { category: 'rebuildable-cache', disposition: 'preserve-until-exit-and-evidence', evidence: `top-level=${first}` }
  }
  if (ELECTRON_STATE_ROOTS.has(first) || /^Cookies(?:-.+)?$/.test(first) || /^Trust Tokens(?:-.+)?$/.test(first)) {
    return { category: 'electron-state', disposition: 'preserve-until-exit-and-evidence', evidence: `top-level=${first}` }
  }
  const protectedCategory = PROTECTED_ROOTS.get(first)
  if (protectedCategory) {
    return { category: protectedCategory, disposition: 'preserve-until-approved', evidence: `top-level=${first}` }
  }
  return { category: 'unclassified', disposition: 'hold-unclassified', evidence: 'no-known-path-contract' }
}

function canonicalPath(input) {
  const unresolved = []
  let current = path.resolve(input)
  while (true) {
    try {
      return path.join(fs.realpathSync(current), ...unresolved)
    } catch {
      const parent = path.dirname(current)
      if (parent === current) return path.resolve(input)
      unresolved.unshift(path.basename(current))
      current = parent
    }
  }
}

function isInside(root, target) {
  const canonicalRoot = fs.realpathSync(root)
  const canonicalTarget = canonicalPath(target)
  const relative = path.relative(canonicalRoot, canonicalTarget)
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
}

function sha256(file) {
  try {
    const hash = crypto.createHash('sha256')
    const buffer = Buffer.allocUnsafe(1024 * 1024)
    const handle = fs.openSync(file, 'r')
    try {
      let bytesRead
      do {
        bytesRead = fs.readSync(handle, buffer, 0, buffer.length, null)
        if (bytesRead > 0) hash.update(buffer.subarray(0, bytesRead))
      } while (bytesRead > 0)
    } finally {
      fs.closeSync(handle)
    }
    return hash.digest('hex')
  } catch {
    return null
  }
}

function sha256Text(value) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function assertSafeBatchId(batchId) {
  if (typeof batchId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(batchId)) {
    throw new Error('batch id must be a short path-safe identifier')
  }
  return batchId
}

function assertOutsideUserData(root, output, label) {
  if (!output) throw new Error(`${label} is required`)
  if (fs.existsSync(output)) throw new Error(`${label} already exists: ${output}`)
  if (isInside(root, output)) throw new Error(`${label} must be outside userData`)
  return path.resolve(output)
}

function readPrefix(file, bytes) {
  const buffer = Buffer.alloc(bytes)
  const handle = fs.openSync(file, 'r')
  try {
    const bytesRead = fs.readSync(handle, buffer, 0, bytes, 0)
    return buffer.subarray(0, bytesRead)
  } finally {
    fs.closeSync(handle)
  }
}

function isSqliteLocked(message) {
  return /database (?:schema |table )?is locked|\bbusy\b|SQLITE_(?:BUSY|LOCKED)/i.test(message)
}

function symlinkDisposition({ escaped, resolved, marker, classification }) {
  if (escaped) return 'hold-symlink-escape'
  if (resolved === null && !marker) return 'hold-unresolved-symlink'
  if (classification.disposition === 'trash-eligible-after-approval') return 'preserve-until-approved'
  return classification.disposition
}

export function sqliteEvidence(file) {
  let prefix
  try {
    prefix = readPrefix(file, 16)
  } catch (error) {
    return { format: 'sqlite', status: 'corrupt-or-unreadable', error: error.message }
  }
  if (prefix.toString() !== 'SQLite format 3\0') return null
  const probe = [
    'import json,sqlite3,sys,urllib.parse',
    'try:',
    '  uri="file:"+urllib.parse.quote(sys.argv[1],safe="/")+"?mode=ro"',
    '  c=sqlite3.connect(uri,uri=True,timeout=0)',
    '  c.execute("pragma query_only=on")',
    '  integrity_rows=[r[0] for r in c.execute("pragma integrity_check")]',
    '  integrity="ok" if integrity_rows == ["ok"] else integrity_rows',
    '  tables=[r[0] for r in c.execute("select name from sqlite_master where type=\'table\' order by name")]',
    '  c.close()',
    '  print(json.dumps({"integrity":integrity,"tables":tables}))',
    'except Exception as error:',
    '  print(json.dumps({"errorType":type(error).__name__,"error":str(error)}),file=sys.stderr)',
    '  sys.exit(2)',
  ].join('\n')
  const python = spawnSync('python3', ['-c', probe, file], { encoding: 'utf8' })
  if (python.status !== 0) {
    const stderr = python.stderr.trim() || 'sqlite probe failed'
    let error = stderr
    try { error = JSON.parse(stderr).error || stderr } catch {}
    return { format: 'sqlite', status: isSqliteLocked(error) ? 'locked' : 'corrupt-or-unreadable', error }
  }
  try {
    const evidence = JSON.parse(python.stdout)
    return { format: 'sqlite', status: evidence.integrity === 'ok' ? 'ok' : 'corrupt-or-unreadable', ...evidence }
  } catch (error) {
    return { format: 'sqlite', status: 'corrupt-or-unreadable', error: `invalid sqlite probe output: ${error.message}` }
  }
}

function jsonEvidence(file) {
  if (!file.endsWith('.json')) return null
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8'))
    return { valid: true, rootType: Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value, keys: value && typeof value === 'object' && !Array.isArray(value) ? Object.keys(value).sort() : [] }
  } catch (error) { return { valid: false, error: error.message } }
}

export function scanUserData({ userData, output }) {
  if (!userData) throw new Error('userData is required')
  const root = fs.realpathSync(userData)
  if (output && fs.existsSync(output)) throw new Error(`output already exists: ${output}`)
  if (output && isInside(root, output)) throw new Error('output must be outside userData')
  const files = []
  const walk = (dir) => {
    const entries = fs.readdirSync(dir, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))
    for (const entry of entries) {
      const absolute = path.join(dir, entry.name)
      const rel = normalizeRelativePath(path.relative(root, absolute))
      const stat = fs.lstatSync(absolute)
      const classification = classifyRelativePath(rel)
      if (stat.isSymbolicLink()) {
        const target = fs.readlinkSync(absolute)
        let resolved = null
        let resolutionError = null
        try { resolved = fs.realpathSync(absolute) } catch (error) { resolutionError = error.message }
        const escaped = resolved !== null && !isInside(root, resolved)
        const marker = markerKind(rel)
        const resolutionStatus = resolved === null ? 'unresolved' : 'resolved'
        const disposition = symlinkDisposition({ escaped, resolved, marker, classification })
        files.push({
          path: rel,
          type: 'symlink',
          bytes: stat.size,
          mtimeMs: stat.mtimeMs,
          sha256: sha256Text(target),
          symlink: { target, resolved, escaped, resolutionStatus, ...(marker ? { markerKind: marker } : {}), ...(resolutionError ? { error: resolutionError } : {}) },
          category: classification.category,
          classificationEvidence: classification.evidence,
          disposition,
        })
      } else if (stat.isDirectory()) walk(absolute)
      else if (stat.isFile()) files.push({
        path: rel,
        type: 'file',
        bytes: stat.size,
        mtimeMs: stat.mtimeMs,
        sha256: sha256(absolute),
        sqlite: sqliteEvidence(absolute),
        json: jsonEvidence(absolute),
        category: classification.category,
        classificationEvidence: classification.evidence,
        disposition: classification.disposition,
      })
    }
  }
  walk(root)
  const sqliteFiles = files.filter((file) => file.sqlite)
  return {
    schemaVersion: 2,
    mode: 'read-only',
    userData: root,
    generatedAt: new Date().toISOString(),
    files,
    summary: {
      files: files.length,
      bytes: files.reduce((n, file) => n + file.bytes, 0),
      symlinks: files.filter((file) => file.type === 'symlink').length,
      sqlite: sqliteFiles.length,
      sqliteStatuses: {
        ok: sqliteFiles.filter((file) => file.sqlite.status === 'ok').length,
        locked: sqliteFiles.filter((file) => file.sqlite.status === 'locked').length,
        'corrupt-or-unreadable': sqliteFiles.filter((file) => file.sqlite.status === 'corrupt-or-unreadable').length,
      },
      invalidJson: files.filter((file) => file.json?.valid === false).length,
    },
  }
}

export function buildFinderMetadataTrashManifest({ scanManifest, batchId }) {
  if (!scanManifest || scanManifest.mode !== 'read-only' || !Array.isArray(scanManifest.files)) {
    throw new Error('scanManifest must be a read-only userData scan')
  }
  const safeBatchId = assertSafeBatchId(batchId)
  const targets = scanManifest.files
    .filter((file) => file.type === 'file'
      && file.category === 'finder-metadata'
      && file.disposition === 'trash-eligible-after-approval'
      && path.posix.basename(file.path) === '.DS_Store')
    .map((file) => ({
      path: file.path,
      type: file.type,
      bytes: file.bytes,
      mtimeMs: file.mtimeMs,
      sha256: file.sha256,
      category: file.category,
      classificationEvidence: file.classificationEvidence,
      approved: false,
    }))
  if (targets.length === 0) throw new Error('no Finder metadata targets were found')
  if (targets.length > MAX_USER_DATA_TRASH_TARGETS) {
    throw new Error(`Finder metadata batch exceeds ${MAX_USER_DATA_TRASH_TARGETS} targets`)
  }
  return {
    schemaVersion: USER_DATA_TRASH_MANIFEST_SCHEMA_VERSION,
    mode: 'trash-candidate',
    approved: false,
    batchId: safeBatchId,
    userData: scanManifest.userData,
    sourceManifest: {
      generatedAt: scanManifest.generatedAt,
      sha256: sha256Text(JSON.stringify(scanManifest)),
      summary: scanManifest.summary,
    },
    selection: {
      type: 'file',
      category: 'finder-metadata',
      disposition: 'trash-eligible-after-approval',
      basename: '.DS_Store',
    },
    summary: {
      targets: targets.length,
      bytes: targets.reduce((total, target) => total + target.bytes, 0),
    },
    targets,
  }
}

export function approveFinderMetadataTrashManifest({ candidate, approvalNote }) {
  if (!candidate || candidate.mode !== 'trash-candidate' || candidate.approved !== false) {
    throw new Error('candidate manifest must be pending human approval')
  }
  if (typeof approvalNote !== 'string' || approvalNote.trim().length === 0) {
    throw new Error('approval note is required')
  }
  return {
    ...candidate,
    mode: 'approved-trash',
    approved: true,
    approvedAt: new Date().toISOString(),
    approvalNote: approvalNote.trim(),
    targets: candidate.targets.map((target) => ({ ...target, approved: true })),
  }
}

function normalizeUserDataTarget(relativePath) {
  if (typeof relativePath !== 'string' || relativePath.length === 0 || relativePath.includes('\0')) {
    throw new Error('target path must be a non-empty relative path')
  }
  const portable = relativePath.replaceAll('\\', '/')
  if (path.isAbsolute(portable) || portable.split('/').includes('..') || portable.includes('*')) {
    throw new Error(`target path must stay relative and must not contain traversal or glob syntax: ${relativePath}`)
  }
  const normalized = path.posix.normalize(portable)
  if (normalized === '.' || normalized.startsWith('../') || normalized.includes('/../')) {
    throw new Error(`target path must not resolve to the userData root: ${relativePath}`)
  }
  return normalized
}

function assertNoSymlinkComponents(root, absolutePath) {
  const relative = path.relative(root, absolutePath)
  let current = root
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment)
    if (fs.lstatSync(current).isSymbolicLink()) throw new Error(`target path contains a symlink: ${current}`)
  }
}

function userDataTargetEvidence(root, target) {
  const relativePath = normalizeUserDataTarget(target.path)
  const absolutePath = path.resolve(root, ...relativePath.split('/'))
  if (!isInside(root, absolutePath)) throw new Error(`target is outside userData: ${relativePath}`)
  assertNoSymlinkComponents(root, absolutePath)
  const stats = fs.lstatSync(absolutePath)
  if (!stats.isFile() || path.posix.basename(relativePath) !== '.DS_Store') {
    throw new Error(`target is not a regular Finder metadata file: ${relativePath}`)
  }
  const classification = classifyRelativePath(relativePath)
  if (classification.category !== 'finder-metadata' || classification.disposition !== 'trash-eligible-after-approval') {
    throw new Error(`target is not currently trash-eligible Finder metadata: ${relativePath}`)
  }
  const current = {
    path: relativePath,
    type: 'file',
    bytes: stats.size,
    mtimeMs: stats.mtimeMs,
    sha256: sha256(absolutePath),
  }
  if (target.type !== current.type || target.bytes !== current.bytes || target.mtimeMs !== current.mtimeMs || target.sha256 !== current.sha256) {
    throw new Error(`target evidence drifted since approval: ${relativePath}`)
  }
  return { ...current, absolutePath }
}

function validateApprovedUserDataTrashManifest({ root, manifest, batchId }) {
  if (!manifest || manifest.schemaVersion !== USER_DATA_TRASH_MANIFEST_SCHEMA_VERSION || manifest.mode !== 'approved-trash' || manifest.approved !== true) {
    throw new Error('approved userData manifest requires schemaVersion, mode=approved-trash and approved=true')
  }
  if (manifest.batchId !== batchId) throw new Error(`approved userData manifest batch id does not match: ${batchId}`)
  if (path.resolve(manifest.userData) !== root) throw new Error('approved userData manifest root does not match')
  if (!Array.isArray(manifest.targets) || manifest.targets.length === 0 || manifest.targets.length > MAX_USER_DATA_TRASH_TARGETS) {
    throw new Error(`approved userData manifest must contain 1-${MAX_USER_DATA_TRASH_TARGETS} targets`)
  }
  const targets = manifest.targets.map((target) => {
    if (!target || target.approved !== true) throw new Error('every target must be explicitly approved')
    return userDataTargetEvidence(root, target)
  })
  const paths = targets.map((target) => target.path)
  if (new Set(paths).size !== paths.length) throw new Error('approved userData manifest contains duplicate targets')
  return targets
}

function defaultTrashRunner(argv) {
  const result = spawnSync(argv[0], argv.slice(1), { stdio: 'inherit' })
  if (result.error) throw result.error
  return { status: result.status ?? 1 }
}

function writeEvidence(output, evidence, { overwrite = false } = {}) {
  if (!overwrite) {
    fs.writeFileSync(output, `${JSON.stringify(evidence, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
    return
  }
  const temporary = `${output}.update-${process.pid}-${crypto.randomUUID()}`
  fs.writeFileSync(temporary, `${JSON.stringify(evidence, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
  fs.renameSync(temporary, output)
}

export function applyApprovedUserDataTrashManifest({ userData, manifest, manifestPath, batchId, appliedOutput, confirmAppExited, trashRunner = defaultTrashRunner }) {
  if (confirmAppExited !== true) throw new Error('confirmAppExited=true is required before moving userData to Trash')
  const root = fs.realpathSync(userData)
  const safeBatchId = assertSafeBatchId(batchId)
  const candidate = manifest ?? JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  const targets = validateApprovedUserDataTrashManifest({ root, manifest: candidate, batchId: safeBatchId })
  const output = assertOutsideUserData(root, path.resolve(appliedOutput), 'applied evidence output')
  fs.mkdirSync(path.dirname(output), { recursive: true })
  const argv = ['/usr/bin/trash', '--stopOnError', '--verbose', ...targets.map((target) => target.absolutePath)]
  const pending = {
    schemaVersion: USER_DATA_TRASH_MANIFEST_SCHEMA_VERSION,
    mode: 'applied-trash',
    status: 'pending',
    batchId: safeBatchId,
    userData: root,
    pendingAt: new Date().toISOString(),
    command: { executable: argv[0], args: argv.slice(1), paths: targets.map((target) => target.absolutePath) },
    targets: targets.map(({ absolutePath, ...target }) => ({
      ...target,
      originalAbsolutePath: absolutePath,
      recovery: { originalPath: absolutePath, mechanism: 'macOS Trash' },
    })),
  }
  writeEvidence(output, pending)
  const fail = (reason) => {
    const failed = { ...pending, status: 'failed', failedAt: new Date().toISOString(), failureReason: reason }
    writeEvidence(output, failed, { overwrite: true })
    throw new Error(reason)
  }
  let result
  try {
    result = trashRunner(argv)
  } catch (error) {
    fail(`trash runner threw: ${error instanceof Error ? error.message : String(error)}`)
  }
  const status = Number.isInteger(result?.status) ? result.status : Number.isInteger(result?.code) ? result.code : null
  if (status !== 0) fail(`trash runner failed with status ${status ?? 'unknown'}`)
  const applied = { ...pending, status: 'applied', appliedAt: new Date().toISOString() }
  writeEvidence(output, applied, { overwrite: true })
  return { applied, output, argv }
}

export function runCli(argv = process.argv.slice(2)) {
  const command = argv[0] && !argv[0].startsWith('--') ? argv[0] : 'scan'
  const get = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined }
  const userData = get('--user-data')
  const output = get('--output')
  if (command === 'batch') {
    const batchId = get('--batch-id')
    if (!userData || !output || !batchId) throw new Error('batch requires --user-data, --output and --batch-id')
    const scan = scanUserData({ userData })
    const candidate = buildFinderMetadataTrashManifest({ scanManifest: scan, batchId })
    const batchOutput = assertOutsideUserData(fs.realpathSync(userData), path.resolve(output), 'trash candidate output')
    fs.mkdirSync(path.dirname(batchOutput), { recursive: true })
    fs.writeFileSync(batchOutput, `${JSON.stringify(candidate, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
    return { output: batchOutput, manifest: candidate }
  }
  if (command === 'trash') {
    const manifestPath = get('--manifest')
    const batchId = get('--batch-id')
    const appliedOutput = get('--applied-output')
    if (!userData || !manifestPath || !batchId || !appliedOutput || !argv.includes('--confirm-app-exited')) {
      throw new Error('trash requires --user-data, --manifest, --batch-id, --applied-output and --confirm-app-exited')
    }
    return applyApprovedUserDataTrashManifest({
      userData,
      manifestPath,
      batchId,
      appliedOutput,
      confirmAppExited: true,
    })
  }
  if (command === 'approve') {
    const manifestPath = get('--manifest')
    const approvalNote = get('--approval-note')
    if (!userData || !manifestPath || !output || !approvalNote) {
      throw new Error('approve requires --user-data, --manifest, --output and --approval-note')
    }
    const candidate = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    if (path.resolve(candidate.userData) !== fs.realpathSync(userData)) throw new Error('candidate userData root does not match')
    const approved = approveFinderMetadataTrashManifest({ candidate, approvalNote })
    const approvedOutput = assertOutsideUserData(fs.realpathSync(userData), path.resolve(output), 'approved manifest output')
    fs.mkdirSync(path.dirname(approvedOutput), { recursive: true })
    fs.writeFileSync(approvedOutput, `${JSON.stringify(approved, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
    return { output: approvedOutput, manifest: approved }
  }
  if (command !== 'scan') throw new Error('supported commands are scan, batch, approve and trash')
  const manifest = scanUserData({ userData, output })
  if (output) fs.writeFileSync(output, `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' })
  return manifest
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const result = runCli()
    if (result?.manifest?.mode === 'trash-candidate') console.log(`Finder metadata candidate written: ${result.output} (targets=${result.manifest.summary.targets})`)
    else if (result?.manifest?.mode === 'approved-trash') console.log(`Finder metadata batch approved: ${result.output} (batch=${result.manifest.batchId}, targets=${result.manifest.targets.length})`)
    else if (result?.applied?.mode === 'applied-trash') console.log(`UserData trash applied: ${result.output} (batch=${result.applied.batchId}, targets=${result.applied.targets.length})`)
    else console.log(`Scanned ${result.summary.files} files`)
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
