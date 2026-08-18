import { spawnSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const MANIFEST_SCHEMA_VERSION = 1
export const MAX_TRASH_TARGETS = 20
const TASK_RESEARCH_PREFIX = '.trellis/tasks/08-01-audit-project-paths-and-cleanup/research'
export const DEFAULT_SCAN_TARGETS = [
  'apps/frontend/out',
  'output',
  '.playwright-cli',
  '.pytest_cache',
  '.vite',
]

const PROTECTED_PREFIXES = [
  { prefix: '.git', category: 'control-data', reason: 'Git metadata is never a cleanup target' },
  { prefix: '.trellis', category: 'trellis', reason: 'Trellis workflow and evidence are hard-protected' },
  { prefix: '.agents', category: 'project-control', reason: 'Project agent instructions and skills are hard-protected' },
  { prefix: '.claude', category: 'project-control', reason: 'Project Claude configuration is hard-protected' },
  { prefix: '.codex', category: 'project-control', reason: 'Project Codex configuration is hard-protected' },
  { prefix: '.github', category: 'project-control', reason: 'Repository automation is hard-protected' },
  { prefix: 'docs', category: 'project-documentation', reason: 'Project documentation is hard-protected' },
  { prefix: 'apps/.trellis', category: 'trellis', reason: 'Nested Trellis data is hard-protected' },
  { prefix: 'apps/index.cjs', category: 'source', reason: 'Application entrypoint is hard-protected' },
  { prefix: 'apps/package.json', category: 'source', reason: 'Application package manifest is hard-protected' },
  { prefix: 'apps/pnpm-lock.yaml', category: 'source', reason: 'Application dependency lockfile is hard-protected' },
  { prefix: 'apps/frontend', category: 'source', reason: 'Frontend source is hard-protected' },
  { prefix: 'apps/backend', category: 'source', reason: 'Backend source is hard-protected' },
  { prefix: 'apps/build', category: 'source', reason: 'Build scripts are hard-protected' },
  { prefix: 'apps/out', category: 'current-build', reason: 'Current Electron build output is hard-protected' },
  { prefix: 'apps/node_modules', category: 'dependencies', reason: 'Installed dependencies are hard-protected' },
  { prefix: 'node_modules', category: 'dependencies', reason: 'Installed dependencies are hard-protected' },
  { prefix: 'apps/release', category: 'release', reason: 'Active release artifacts are hard-protected' },
  { prefix: 'apps/.cache/remotion-bundle', category: 'current-remotion-bundle', reason: 'Current Remotion bundle is a packaging input' },
  { prefix: '.cache/remotion-bundle', category: 'current-remotion-bundle', reason: 'Current Remotion bundle is a packaging input' },
  { prefix: '.gitignore', category: 'root-project-file', reason: 'Repository configuration is hard-protected' },
  { prefix: 'AGENTS.md', category: 'root-project-file', reason: 'Repository instructions are hard-protected' },
  { prefix: 'CODE_OF_CONDUCT.md', category: 'root-project-file', reason: 'Repository policy is hard-protected' },
  { prefix: 'COMMERCIAL_LICENSE.md', category: 'root-project-file', reason: 'Repository license is hard-protected' },
  { prefix: 'CONTRIBUTING.md', category: 'root-project-file', reason: 'Repository contribution guide is hard-protected' },
  { prefix: 'LICENSE', category: 'root-project-file', reason: 'Repository license is hard-protected' },
  { prefix: 'README.md', category: 'root-project-file', reason: 'Repository documentation is hard-protected' },
  { prefix: 'README_EN.md', category: 'root-project-file', reason: 'Repository documentation is hard-protected' },
  { prefix: 'skills-lock.json', category: 'root-project-file', reason: 'Repository agent-skill lockfile is hard-protected' },
]

function isPrefix(relativePath, prefix) {
  return relativePath === prefix || relativePath.startsWith(`${prefix}/`)
}

function isDisposableMetadataPath(relativePath) {
  const segments = relativePath.split('/')
  return segments.at(-1) === '.DS_Store' || segments.includes('__pycache__')
}

function isHistoricalWorkspaceLogPath(relativePath) {
  return /^apps\/build\/scripts\/workspace-[^/]+-2026-07-26\.log$/.test(relativePath)
}

function normalizeRelativePath(value) {
  if (typeof value !== 'string' || value.length === 0 || value.includes('\0')) {
    throw new Error('target must be a relative target path')
  }
  if (path.isAbsolute(value) || path.win32.isAbsolute(value)) {
    throw new Error(`target must be a relative target path: ${value}`)
  }
  const portable = value.replaceAll('\\', '/')
  if (['*', '?', '[', ']', '{', '}'].some((character) => portable.includes(character))) {
    throw new Error(`target must not contain glob syntax: ${value}`)
  }
  if (portable.startsWith('/') || portable.split('/').includes('..')) {
    throw new Error(`target must be a relative target path: ${value}`)
  }
  const normalized = path.posix.normalize(portable).replace(/\/+$/, '')
  if (normalized === '.' || normalized.startsWith('../') || normalized.includes('/../')) {
    throw new Error(`target must be a non-root relative path: ${value}`)
  }
  return normalized
}

function assertRepositoryRoot(repoRoot) {
  if (typeof repoRoot !== 'string' || !path.isAbsolute(repoRoot)) {
    throw new Error('repoRoot must be an absolute directory')
  }
  let stats
  try {
    stats = fs.statSync(repoRoot)
  } catch {
    throw new Error(`repoRoot does not exist: ${repoRoot}`)
  }
  if (!stats.isDirectory()) throw new Error(`repoRoot must be a directory: ${repoRoot}`)
  return fs.realpathSync(repoRoot)
}

function assertInsideRepository(repoRoot, absolutePath, label) {
  const relative = path.relative(repoRoot, absolutePath)
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`${label} is outside repository: ${absolutePath}`)
  }
  return relative.split(path.sep).join('/')
}

function assertNoSymlinkComponents(repoRoot, absolutePath, label) {
  const relativePath = assertInsideRepository(repoRoot, absolutePath, label)
  let currentPath = repoRoot
  for (const segment of relativePath.split('/').filter(Boolean)) {
    currentPath = path.join(currentPath, segment)
    let stats
    try {
      stats = fs.lstatSync(currentPath)
    } catch (error) {
      if (error?.code === 'ENOENT') return
      throw error
    }
    if (stats.isSymbolicLink()) {
      throw new Error(`${label} must not contain a symbolic link: ${currentPath}`)
    }
  }
}

function canonicalizePath(absolutePath) {
  const missing = []
  let current = absolutePath
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current)
    if (parent === current) return absolutePath
    missing.unshift(path.basename(current))
    current = parent
  }
  return path.join(fs.realpathSync(current), ...missing)
}

function resolveTarget(repoRoot, relativePath) {
  const normalized = normalizeRelativePath(relativePath)
  const absolutePath = path.resolve(repoRoot, ...normalized.split('/'))
  assertInsideRepository(repoRoot, absolutePath, 'target')
  return { normalized, absolutePath }
}

export function classifyRelativePath(relativePath) {
  const normalized = normalizeRelativePath(relativePath)

  // The old frontend build output is an explicit Batch A candidate, not source.
  if (isPrefix(normalized, 'apps/frontend/out')) {
    return { protected: false, category: 'candidate', reason: null }
  }

  const match = PROTECTED_PREFIXES.find(({ prefix }) => isPrefix(normalized, prefix))
  if (match) {
    // Finder metadata and Python bytecode are disposable even when nested in
    // source trees; control data, dependencies, release artifacts, and
    // current bundles remain hard-protected.
    if (match.category === 'source' && (isDisposableMetadataPath(normalized) || isHistoricalWorkspaceLogPath(normalized))) {
      return { protected: false, category: 'candidate', reason: null }
    }
    return { protected: true, category: match.category, reason: match.reason }
  }
  return { protected: false, category: 'candidate', reason: null }
}

function assertManifestOutputPolicy(relativePath, targets) {
  const normalizedOutput = normalizeRelativePath(relativePath)
  const normalizedTargets = targets.map(normalizeRelativePath)
  if (normalizedTargets.some((target) => isPrefix(normalizedOutput, target))) {
    throw new Error(`manifest output must not be inside a scan target: ${normalizedOutput}`)
  }
  if (!isPrefix(normalizedOutput, TASK_RESEARCH_PREFIX)) {
    throw new Error(`manifest output must stay inside task research: ${TASK_RESEARCH_PREFIX}`)
  }
}

function assertSafeBatchId(batchId) {
  if (typeof batchId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(batchId)) {
    throw new Error('batch id must be a short path-safe identifier')
  }
  return batchId
}

function resolveRepoPath(repoRoot, value, label, { mustExist = false } = {}) {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${label} is required`)
  const requested = path.isAbsolute(value) || path.win32.isAbsolute(value)
    ? path.resolve(value)
    : path.resolve(repoRoot, value)
  const canonical = canonicalizePath(requested)
  const relative = assertInsideRepository(repoRoot, canonical, label)
  assertNoSymlinkComponents(repoRoot, canonical, label)
  if (mustExist && !fs.existsSync(canonical)) throw new Error(`${label} does not exist: ${relative}`)
  return { absolutePath: canonical, relativePath: relative }
}

function normalizeEvidenceFiles(files, label) {
  if (!Array.isArray(files)) throw new Error(`${label}.files must be an array`)
  return files.map((file) => {
    if (!file || typeof file !== 'object') throw new Error(`${label}.files contains an invalid entry`)
    const relativePath = normalizeRelativePath(file.relativePath)
    if (!Number.isFinite(file.bytes) || !Number.isFinite(file.mtimeMs) || !/^[a-f0-9]{64}$/.test(file.sha256)) {
      throw new Error(`${label}.files has invalid evidence: ${relativePath}`)
    }
    return { relativePath, bytes: file.bytes, mtimeMs: file.mtimeMs, sha256: file.sha256 }
  }).sort((left, right) => left.relativePath.localeCompare(right.relativePath))
}

function evidenceEqual(left, right) {
  return left.relativePath === right.relativePath
    && left.bytes === right.bytes
    && left.mtimeMs === right.mtimeMs
    && left.sha256 === right.sha256
}

function targetEvidenceEqual(expected, actual) {
  if (expected.relativePath !== actual.relativePath || expected.type !== actual.type) return false
  if (expected.bytes !== actual.bytes || expected.mtimeMs !== actual.mtimeMs) return false
  if (expected.files.length !== actual.files.length) return false
  return expected.files.every((file, index) => evidenceEqual(file, actual.files[index]))
}

function validateApprovedTrashManifest({ repoRoot, manifest, batchId }) {
  if (!manifest || typeof manifest !== 'object') throw new Error('approved manifest must be an object')
  if (manifest.schemaVersion !== MANIFEST_SCHEMA_VERSION || manifest.mode !== 'approved-trash' || manifest.approved !== true) {
    throw new Error('approved manifest requires schemaVersion, mode=approved-trash and approved=true')
  }
  if (manifest.batchId !== batchId) {
    throw new Error(`approved manifest batch id does not match requested batch id: ${batchId}`)
  }
  const requestedRoot = typeof manifest.repoRoot === 'string' ? path.resolve(manifest.repoRoot) : ''
  if (!requestedRoot || fs.realpathSync(requestedRoot) !== repoRoot) throw new Error('approved manifest repoRoot does not match repository')
  if (!Array.isArray(manifest.targets) || manifest.targets.length === 0 || manifest.targets.length > MAX_TRASH_TARGETS) {
    throw new Error(`approved manifest must contain 1-${MAX_TRASH_TARGETS} top-level targets`)
  }
  const normalized = []
  for (const [index, entry] of manifest.targets.entries()) {
    if (!entry || typeof entry !== 'object' || entry.approved !== true || entry.deletionEligible !== true) {
      throw new Error(`target ${index} is not explicitly approved for trash`)
    }
    const relativePath = normalizeRelativePath(entry.relativePath)
    const classification = classifyRelativePath(relativePath)
    if (classification.protected) throw new Error(`protected target is not eligible: ${relativePath}`)
    assertNoSymlinkComponents(repoRoot, path.resolve(repoRoot, ...relativePath.split('/')), 'target')
    const current = inspectTarget({ repoRoot, relativePath })
    if (!current.exists || current.skipped) throw new Error(`target is missing or protected: ${relativePath}`)
    if ((current.protectedChildren?.length ?? 0) > 0) {
      throw new Error(`target contains protected descendants and cannot be trashed: ${relativePath}`)
    }
    const expected = {
      relativePath,
      type: entry.type,
      bytes: entry.bytes,
      mtimeMs: entry.mtimeMs,
      files: normalizeEvidenceFiles(entry.files, `target ${relativePath}`),
    }
    if (!targetEvidenceEqual(expected, { ...current, files: normalizeEvidenceFiles(current.files, `current ${relativePath}`) })) {
      throw new Error(`target evidence drifted since approval: ${relativePath}`)
    }
    normalized.push({ ...expected, absolutePath: path.resolve(repoRoot, ...relativePath.split('/')) })
  }
  const paths = normalized.map((target) => target.relativePath)
  if (new Set(paths).size !== paths.length) throw new Error('approved manifest contains duplicate targets')
  for (const target of normalized) {
    if (normalized.some((other) => other !== target && isPrefix(target.relativePath, other.relativePath))) {
      throw new Error('approved manifest contains overlapping targets')
    }
  }
  return normalized
}

function defaultTrashRunner(argv) {
  const result = spawnSync(argv[0], argv.slice(1), { stdio: 'inherit' })
  if (result.error) throw result.error
  return { status: result.status ?? 1 }
}

function fsyncDirectory(directoryPath) {
  const handle = fs.openSync(directoryPath, 'r')
  try {
    fs.fsyncSync(handle)
  } finally {
    fs.closeSync(handle)
  }
}

function reserveDurableEvidence(absolutePath, evidence) {
  let handle
  try {
    handle = fs.openSync(absolutePath, 'wx')
  } catch (error) {
    if (error?.code === 'EEXIST') throw new Error(`applied output already exists: ${absolutePath}`)
    throw error
  }
  try {
    fs.writeFileSync(handle, `${JSON.stringify(evidence, null, 2)}\n`, { encoding: 'utf8' })
    fs.fsyncSync(handle)
  } finally {
    fs.closeSync(handle)
  }
  fsyncDirectory(path.dirname(absolutePath))
}

function replaceDurableEvidence(absolutePath, evidence) {
  const temporaryPath = `${absolutePath}.update-${process.pid}-${crypto.randomUUID()}`
  const handle = fs.openSync(temporaryPath, 'wx')
  try {
    fs.writeFileSync(handle, `${JSON.stringify(evidence, null, 2)}\n`, { encoding: 'utf8' })
    fs.fsyncSync(handle)
  } finally {
    fs.closeSync(handle)
  }
  fs.renameSync(temporaryPath, absolutePath)
  fsyncDirectory(path.dirname(absolutePath))
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error)
}

export function applyApprovedTrashManifest({ repoRoot, manifest, manifestPath, batchId, appliedOutput, trashRunner }) {
  const resolvedRepoRoot = assertRepositoryRoot(repoRoot)
  if (typeof trashRunner !== 'function') throw new Error('trashRunner must be an explicit function')
  const safeBatchId = assertSafeBatchId(batchId)
  const manifestObject = manifest ?? (() => {
    const safeManifest = resolveRepoPath(resolvedRepoRoot, manifestPath, 'manifest', { mustExist: true })
    if (!isPrefix(safeManifest.relativePath, TASK_RESEARCH_PREFIX)) throw new Error('manifest must stay inside task research')
    return JSON.parse(fs.readFileSync(safeManifest.absolutePath, 'utf8'))
  })()
  const targets = validateApprovedTrashManifest({ repoRoot: resolvedRepoRoot, manifest: manifestObject, batchId: safeBatchId })
  const safeOutput = resolveRepoPath(resolvedRepoRoot, appliedOutput, 'applied output')
  if (!isPrefix(safeOutput.relativePath, TASK_RESEARCH_PREFIX)) throw new Error('applied output must stay inside task research')
  if (fs.existsSync(safeOutput.absolutePath)) throw new Error(`applied output already exists: ${safeOutput.absolutePath}`)
  const argv = ['/usr/bin/trash', '--stopOnError', '--verbose', ...targets.map((target) => target.absolutePath)]
  const pending = {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    mode: 'applied-trash',
    status: 'pending',
    batchId: safeBatchId,
    pendingAt: new Date().toISOString(),
    repoRoot: resolvedRepoRoot,
    command: { executable: argv[0], args: argv.slice(1), paths: targets.map((target) => target.absolutePath) },
    targets: targets.map(({ absolutePath, ...target }) => ({
      ...target,
      originalAbsolutePath: absolutePath,
      recovery: { originalRelativePath: target.relativePath, originalAbsolutePath: absolutePath },
    })),
  }
  fs.mkdirSync(path.dirname(safeOutput.absolutePath), { recursive: true })
  assertNoSymlinkComponents(resolvedRepoRoot, safeOutput.absolutePath, 'applied output')
  reserveDurableEvidence(safeOutput.absolutePath, pending)

  const recordFailure = (failureReason) => {
    const failed = {
      ...pending,
      status: 'failed',
      failedAt: new Date().toISOString(),
      failureReason,
    }
    try {
      replaceDurableEvidence(safeOutput.absolutePath, failed)
    } catch (evidenceError) {
      throw new Error(`${failureReason}; failed to update reserved evidence: ${errorMessage(evidenceError)}`)
    }
    throw new Error(failureReason)
  }

  let result
  try {
    result = trashRunner(argv)
  } catch (error) {
    recordFailure(`trash runner threw: ${errorMessage(error)}`)
  }
  const exitStatus = Number.isInteger(result?.status)
    ? result.status
    : Number.isInteger(result?.code) ? result.code : null
  if (exitStatus !== 0) recordFailure(`trash runner failed with status ${exitStatus ?? 'unknown'}`)

  const applied = {
    ...pending,
    status: 'applied',
    appliedAt: new Date().toISOString(),
  }
  replaceDurableEvidence(safeOutput.absolutePath, applied)
  return { applied, output: safeOutput.absolutePath, argv }
}

function hashFile(absolutePath) {
  const hash = crypto.createHash('sha256')
  const buffer = Buffer.allocUnsafe(1024 * 1024)
  const handle = fs.openSync(absolutePath, 'r')
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
}

function fileEvidence(repoRoot, absolutePath, relativePath, stats) {
  const sha256 = hashFile(absolutePath)
  const verifiedStats = fs.statSync(absolutePath)
  if (
    verifiedStats.dev !== stats.dev
    || verifiedStats.ino !== stats.ino
    || verifiedStats.size !== stats.size
    || verifiedStats.mtimeMs !== stats.mtimeMs
  ) {
    throw new Error(`file changed during scan: ${relativePath}`)
  }
  return {
    relativePath: assertInsideRepository(repoRoot, absolutePath, 'file'),
    bytes: verifiedStats.size,
    mtimeMs: verifiedStats.mtimeMs,
    sha256,
  }
}

function rejectSymlink(absolutePath, relativePath, repoRoot) {
  let resolved
  try {
    resolved = fs.realpathSync(absolutePath)
  } catch {
    throw new Error(`cannot resolve symbolic link: ${relativePath}`)
  }
  assertInsideRepository(repoRoot, resolved, 'symbolic link')
  throw new Error(`symbolic link is not allowed in scan targets: ${relativePath}`)
}

function inspectTarget({ repoRoot, relativePath }) {
  const classification = classifyRelativePath(relativePath)
  const { normalized, absolutePath } = resolveTarget(repoRoot, relativePath)
  let stats
  try {
    stats = fs.lstatSync(absolutePath)
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return {
        relativePath: normalized,
        exists: false,
        type: 'missing',
        protected: classification.protected,
        category: classification.category,
        protectionReason: classification.reason,
        skipped: classification.protected,
        files: [],
        fileCount: 0,
        bytes: 0,
        mtimeMs: null,
      }
    }
    throw error
  }

  if (stats.isSymbolicLink()) rejectSymlink(absolutePath, normalized, repoRoot)
  if (classification.protected) {
    return {
      relativePath: normalized,
      exists: true,
      type: stats.isDirectory() ? 'directory' : 'file',
      protected: true,
      category: classification.category,
      protectionReason: classification.reason,
      skipped: true,
      files: [],
      fileCount: 0,
      bytes: 0,
      mtimeMs: stats.mtimeMs,
    }
  }

  if (stats.isFile()) {
    return {
      relativePath: normalized,
      exists: true,
      type: 'file',
      protected: false,
      category: classification.category,
      protectionReason: null,
      skipped: false,
      files: [fileEvidence(repoRoot, absolutePath, normalized, stats)],
      fileCount: 1,
      bytes: stats.size,
      mtimeMs: stats.mtimeMs,
    }
  }
  if (!stats.isDirectory()) throw new Error(`unsupported target type: ${normalized}`)

  const files = []
  const protectedChildren = []
  function walk(directoryPath) {
    const entries = fs.readdirSync(directoryPath, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))
    for (const entry of entries) {
      const childPath = path.join(directoryPath, entry.name)
      const childRelative = assertInsideRepository(repoRoot, childPath, 'child path')
      const childClassification = classifyRelativePath(childRelative)
      const childStats = fs.lstatSync(childPath)
      if (childStats.isSymbolicLink()) rejectSymlink(childPath, childRelative, repoRoot)
      if (childClassification.protected) {
        protectedChildren.push({
          relativePath: childRelative,
          category: childClassification.category,
          reason: childClassification.reason,
        })
        continue
      }
      if (childStats.isDirectory()) walk(childPath)
      else if (childStats.isFile()) files.push(fileEvidence(repoRoot, childPath, childRelative, childStats))
      else throw new Error(`unsupported child type: ${childRelative}`)
    }
  }
  walk(absolutePath)

  return {
    relativePath: normalized,
    exists: true,
    type: 'directory',
    protected: false,
    category: classification.category,
    protectionReason: null,
    skipped: false,
    files,
    protectedChildren,
    fileCount: files.length,
    bytes: files.reduce((total, file) => total + file.bytes, 0),
    mtimeMs: stats.mtimeMs,
  }
}

export function buildPathGovernanceManifest({ repoRoot, targets = DEFAULT_SCAN_TARGETS, generatedAt = new Date().toISOString() }) {
  const requestedRepoRoot = path.resolve(repoRoot)
  const resolvedRepoRoot = assertRepositoryRoot(repoRoot)
  if (!Array.isArray(targets) || targets.length === 0) throw new Error('targets must be a non-empty array')

  // Validate all targets first before any processing
  for (const t of targets) {
    const normalized = normalizeRelativePath(t)
    if (normalized.startsWith('../') || normalized === '..') {
      throw new Error('G1: relative target not allowed: outside repository traversal')
    }
  }

  const normalizedTargets = [...new Set(targets.map(normalizeRelativePath))]
  const manifestTargets = normalizedTargets.map((relativePath) => inspectTarget({ repoRoot: resolvedRepoRoot, relativePath }))
  const summary = manifestTargets.reduce((result, target) => {
    result.targets += 1
    result.files += target.fileCount
    result.bytes += target.bytes
    if (target.protected) result.protectedTargets += 1
    if (!target.exists) result.missingTargets += 1
    result.protectedChildren += target.protectedChildren?.length ?? 0
    return result
  }, { targets: 0, files: 0, bytes: 0, protectedTargets: 0, protectedChildren: 0, missingTargets: 0 })

  return {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    mode: 'read-only',
    generatedAt,
    repoRoot: requestedRepoRoot,
    targets: manifestTargets,
    summary,
  }
}

function parseArgs(args) {
  const options = { targets: [] }
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument === '--target') {
      const value = args[++index]
      if (!value) throw new Error('--target requires a value')
      options.targets.push(value)
    } else if (['--output', '--repo-root', '--manifest', '--batch-id', '--applied-output'].includes(argument)) {
      const key = argument.slice(2)
      const value = args[++index]
      if (!value || value.startsWith('--')) throw new Error(`${argument} requires a value`)
      if (Object.hasOwn(options, key)) throw new Error(`${argument} must not be repeated`)
      options[key] = value
    } else if (argument.startsWith('--')) {
      throw new Error(`unexpected option: ${argument}`)
    } else if (!options.command) options.command = argument
    else throw new Error(`unexpected argument: ${argument}`)
  }
  return options
}

function assertCommandOptions(options) {
  if (options.command === 'scan') {
    const invalid = ['manifest', 'batch-id', 'applied-output'].find((key) => Object.hasOwn(options, key))
    if (invalid) throw new Error(`--${invalid} is not valid for scan`)
    return
  }
  if (options.command === 'trash') {
    if (options.targets.length > 0) throw new Error('--target is not valid for trash')
    if (Object.hasOwn(options, 'output')) throw new Error('--output is not valid for trash')
  }
}

export function runPathGovernanceCli(args = process.argv.slice(2), { repoRoot: repoRootOverride, trashRunner } = {}) {
  const options = parseArgs(args)
  if (Object.hasOwn(options, 'repo-root')) throw new Error('--repo-root is not supported; the production repository root is derived from the script location')
  assertCommandOptions(options)
  const scriptRoot = path.dirname(fileURLToPath(import.meta.url))
  const requestedRepoRoot = path.resolve(repoRootOverride || path.resolve(scriptRoot, '../../..'))
  const repoRoot = assertRepositoryRoot(requestedRepoRoot)
  if (options.command === 'trash') {
    if (!options.manifest || !options['batch-id'] || !options['applied-output']) {
      throw new Error('trash requires --manifest, --batch-id and --applied-output')
    }
    const effectiveTrashRunner = trashRunner ?? (repoRootOverride ? null : defaultTrashRunner)
    if (typeof effectiveTrashRunner !== 'function') {
      throw new Error('trashRunner is required when repoRoot is overridden')
    }
    return applyApprovedTrashManifest({
      repoRoot,
      manifestPath: options.manifest,
      batchId: options['batch-id'],
      appliedOutput: options['applied-output'],
      trashRunner: effectiveTrashRunner,
    })
  }
  if (options.command !== 'scan') throw new Error('supported commands are scan and trash')
  const targets = options.targets.length > 0 ? options.targets : DEFAULT_SCAN_TARGETS
  const manifest = buildPathGovernanceManifest({ repoRoot, targets })
  const outputOption = options.output || path.join(TASK_RESEARCH_PREFIX, 'path-governance-scan.json')
  const requestedOutput = path.isAbsolute(outputOption) || path.win32.isAbsolute(outputOption)
    ? path.resolve(outputOption)
    : path.resolve(requestedRepoRoot, outputOption)
  const outputRelativePath = assertInsideRepository(requestedRepoRoot, requestedOutput, 'manifest output')
  assertManifestOutputPolicy(outputRelativePath, targets)
  const output = path.resolve(repoRoot, ...outputRelativePath.split('/'))
  assertNoSymlinkComponents(repoRoot, output, 'manifest output')
  fs.mkdirSync(path.dirname(output), { recursive: true })
  assertNoSymlinkComponents(repoRoot, output, 'manifest output')
  try {
    fs.writeFileSync(output, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
  } catch (error) {
    if (error?.code === 'EEXIST') throw new Error(`manifest output already exists: ${output}`)
    throw error
  }
  return { output, manifest }
}

export function formatPathGovernanceCliResult(result) {
  if (result?.manifest?.mode === 'read-only') {
    return `Path governance scan written: ${result.output} (targets=${result.manifest.summary.targets}, files=${result.manifest.summary.files})`
  }
  if (result?.applied?.mode === 'applied-trash') {
    return `Path governance trash applied: ${result.output} (batch=${result.applied.batchId}, targets=${result.applied.targets.length})`
  }
  throw new Error('path governance command returned an unsupported result')
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    console.log(formatPathGovernanceCliResult(runPathGovernanceCli()))
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
