import { createHash, randomUUID } from 'node:crypto'
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, rename, stat, writeFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const appsRoot = path.resolve(scriptDir, '..', '..')
const defaultManifestPath = path.join(
  appsRoot,
  'frontend/electron/aitoearn/vendor/aitoearn-core/aitoearn-source.json',
)
const defaultCompatibilityMatrixPath = path.join(
  appsRoot,
  'frontend/electron/aitoearn/providers/aitoearn-local/compatibility/provider-matrix.json',
)

const defaultFsOps = { cp, lstat, mkdir, mkdtemp, readFile, readdir, rename, stat, writeFile, rm }
const ADAPTER_CONTRACT_VERSION = 'self-media/v1'
const RESERVED_SNAPSHOT_PATHS = new Set([
  'aitoearn-source.json',
  'aitoearn-source.previous.json',
  'LICENSE-AITOEARN.txt',
  'adapter-metadata.json',
])

function usage() {
  console.log(`Usage: node sync-aitoearn-core.mjs <check|dry-run|apply> [options]

Options:
  --source-root <path>  AiToEarn Electron checkout (required unless AITOEARN_SOURCE_ROOT is set)
  --manifest <path>     Override the MYStudio source manifest
  --compatibility-matrix <path>  Override the local provider compatibility matrix
  --approve              Required by apply; confirms the reviewed source replacement
  --reviewed-ref <sha>   Required by apply; exact reviewed upstream commit
`)
}

function optionValue(args, name) {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : undefined
}

function isSha256(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
}

function isCommit(value) {
  return typeof value === 'string' && /^[a-f0-9]{40}$/.test(value)
}

function assertRelativePath(value, label) {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    path.isAbsolute(value) ||
    value.split(/[\\/]+/).includes('..')
  ) {
    throw new Error(`${label} must be a safe relative path`)
  }
}

function assertSnapshotContentPath(value, label, licensePaths = new Set()) {
  assertRelativePath(value, label)
  if (RESERVED_SNAPSHOT_PATHS.has(value) || licensePaths.has(value)) {
    throw new Error(`${label} targets a reserved MYStudio control path: ${value}`)
  }
}

async function readJson(filePath, fsOps = defaultFsOps) {
  return JSON.parse((await fsOps.readFile(filePath)).toString('utf8'))
}

function validateCompatibilityMatrix(matrix, contractVersion, upstreamCommit) {
  if (!matrix || matrix.contractVersion !== contractVersion || !Array.isArray(matrix.providers)) {
    throw new Error('compatibility matrix contractVersion does not match the source manifest')
  }
  const local = matrix.providers.find((provider) => provider?.providerId === 'aitoearn-local')
  if (!local || local.upstreamCommit !== upstreamCommit) {
    throw new Error('compatibility matrix upstreamCommit does not match the source manifest')
  }
}

async function pathExists(filePath, fsOps = defaultFsOps) {
  try {
    await fsOps.stat(filePath)
    return true
  } catch (error) {
    if (error?.code === 'ENOENT') return false
    throw error
  }
}

async function assertNoSymlinks(root, label, fsOps = defaultFsOps) {
  const rootStat = await fsOps.lstat(root)
  if (rootStat.isSymbolicLink()) throw new Error(`${label} must not be a symlink`)
  if (!rootStat.isDirectory()) throw new Error(`${label} must be a directory`)
  const visit = async (directory) => {
    for (const entry of await fsOps.readdir(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name)
      const entryStat = await fsOps.lstat(entryPath)
      if (entryStat.isSymbolicLink()) throw new Error(`${label} contains a symlink: ${entryPath}`)
      if (entryStat.isDirectory()) await visit(entryPath)
    }
  }
  await visit(root)
}

function noticePath(notice, label) {
  const value = typeof notice === 'string' ? notice.split(/\s+\(/, 1)[0].trim() : ''
  assertRelativePath(value, label)
  return value
}

function manifestNoticePaths(manifest) {
  const paths = manifest.license.noticeFiles.map((notice, index) =>
    noticePath(notice, `license.noticeFiles[${index}]`),
  )
  if (new Set(paths).size !== paths.length) throw new Error('duplicate license notice file')
  return paths
}

function validateManifest(manifest) {
  if (!manifest || manifest.schemaVersion !== 1) {
    throw new Error('source manifest schemaVersion must be 1')
  }
  if (manifest.adapterContractVersion !== ADAPTER_CONTRACT_VERSION) {
    throw new Error(`source manifest adapterContractVersion must be ${ADAPTER_CONTRACT_VERSION}`)
  }
  if (!manifest.upstream || !isCommit(manifest.upstream.commit)) {
    throw new Error('source manifest must pin a full upstream commit')
  }
  if (!isSha256(manifest.upstream.sourceTreeSha256)) {
    throw new Error('source manifest must pin sourceTreeSha256')
  }
  if (!Array.isArray(manifest.sourceFiles) || manifest.sourceFiles.length === 0) {
    throw new Error('source manifest must list sourceFiles')
  }
  if (!manifest.license || manifest.license.spdx !== 'MIT' || !Array.isArray(manifest.license.noticeFiles) || manifest.license.noticeFiles.length === 0) {
    throw new Error('source manifest must preserve the MIT license notice')
  }
  const licensePaths = new Set(manifestNoticePaths(manifest))
  const seen = new Set()
  for (const file of manifest.sourceFiles) {
    assertSnapshotContentPath(file, 'sourceFiles entry', licensePaths)
    if (seen.has(file)) throw new Error(`duplicate source file: ${file}`)
    seen.add(file)
  }
  if (!manifest.snapshot || manifest.snapshot.root !== '.' || !isSha256(manifest.snapshot.treeSha256)) {
    throw new Error('snapshot.root must remain the manifest directory')
  }
  if (!Array.isArray(manifest.snapshot.files)) {
    throw new Error('snapshot.files must be an array')
  }
  const snapshotPaths = new Set()
  for (const entry of manifest.snapshot.files) {
    if (!entry || typeof entry.path !== 'string' || !isSha256(entry.sha256) || !Number.isInteger(entry.bytes)) {
      throw new Error('snapshot.files entries must contain path, sha256, and bytes')
    }
    assertSnapshotContentPath(entry.path, 'snapshot.files entry', licensePaths)
    if (snapshotPaths.has(entry.path)) throw new Error(`duplicate snapshot file: ${entry.path}`)
    snapshotPaths.add(entry.path)
  }
  if (manifest.snapshot.licenseFiles !== undefined) {
    if (!Array.isArray(manifest.snapshot.licenseFiles)) throw new Error('snapshot.licenseFiles must be an array')
    const licenseFilePaths = new Set()
    for (const entry of manifest.snapshot.licenseFiles) {
      if (!entry || typeof entry.path !== 'string' || !isSha256(entry.sha256) || !Number.isInteger(entry.bytes)) {
        throw new Error('snapshot.licenseFiles entries must contain path, sha256, and bytes')
      }
      assertRelativePath(entry.path, 'snapshot.licenseFiles entry')
      if (!licensePaths.has(entry.path)) throw new Error(`snapshot.licenseFiles entry is not a declared notice: ${entry.path}`)
      if (licenseFilePaths.has(entry.path)) throw new Error(`duplicate snapshot license file: ${entry.path}`)
      licenseFilePaths.add(entry.path)
    }
  }
}

async function hashFile(filePath, fsOps = defaultFsOps) {
  const contents = await fsOps.readFile(filePath)
  return {
    sha256: createHash('sha256').update(contents).digest('hex'),
    bytes: contents.byteLength,
  }
}

async function hashSourceTree(sourceRoot, files, fsOps = defaultFsOps) {
  await assertNoSymlinks(sourceRoot, 'source root', fsOps)
  const treeHash = createHash('sha256')
  const entries = []
  for (const relativePath of files) {
    const sourcePath = path.join(sourceRoot, relativePath)
    const fileHash = await hashFile(sourcePath, fsOps)
    treeHash.update(`${relativePath}\0`)
    treeHash.update(await fsOps.readFile(sourcePath))
    entries.push({ path: relativePath, ...fileHash })
  }
  return { sha256: treeHash.digest('hex'), entries }
}

function resolveSourceRoot(args) {
  const raw = optionValue(args, '--source-root') ?? process.env.AITOEARN_SOURCE_ROOT
  if (!raw) {
    throw new Error('source root is required; pass --source-root or set AITOEARN_SOURCE_ROOT')
  }
  return path.resolve(raw)
}

function relativeSnapshotPath(manifestPath, sourcePath) {
  const root = path.dirname(manifestPath)
  const destination = path.resolve(root, sourcePath)
  if (destination !== root && !destination.startsWith(`${root}${path.sep}`)) {
    throw new Error(`snapshot path escapes vendor root: ${sourcePath}`)
  }
  return destination
}

async function inspectLicenseFiles(manifest, manifestPath, fsOps = defaultFsOps) {
  const entries = []
  let intact = true
  for (const relativePath of manifestNoticePaths(manifest)) {
    const destination = relativeSnapshotPath(manifestPath, relativePath)
    try {
      entries.push({ path: relativePath, ...(await hashFile(destination, fsOps)) })
    } catch (error) {
      if (error?.code === 'ENOENT') intact = false
      else throw error
    }
  }
  const expected = manifest.snapshot.licenseFiles
  const expectedByPath = new Map((expected ?? []).map((entry) => [entry.path, entry]))
  const metadataMatches = expected === undefined
    ? intact
    : expected.length === entries.length && expectedByPath.size === entries.length &&
      entries.every((entry) => {
        const previous = expectedByPath.get(entry.path)
        return previous?.sha256 === entry.sha256 && previous.bytes === entry.bytes
      })
  return { entries, intact, metadataMatches }
}

async function checkSource(manifest, sourceRoot, manifestPath, fsOps = defaultFsOps) {
  await assertNoSymlinks(path.dirname(manifestPath), 'vendor root', fsOps)
  const sourceTree = await hashSourceTree(sourceRoot, manifest.sourceFiles, fsOps)
  const matchesPinnedTree = sourceTree.sha256 === manifest.upstream.sourceTreeSha256
  const snapshotFiles = manifest.snapshot.files
  const sourceEntriesByPath = new Map(sourceTree.entries.map((entry) => [entry.path, entry]))
  const snapshotEntriesByPath = new Map(
    snapshotFiles
      .filter((entry) => entry && typeof entry.path === 'string')
      .map((entry) => [entry.path, entry]),
  )
  const sameEntry = (snapshotEntry, sourceEntry) => Boolean(
    snapshotEntry &&
    sourceEntry &&
    isSha256(snapshotEntry.sha256) &&
    snapshotEntry.sha256 === sourceEntry.sha256 &&
    snapshotEntry.bytes === sourceEntry.bytes,
  )
  const currentTreeHash = createHash('sha256')
  let currentSnapshotIntact = isSha256(manifest.snapshot.treeSha256)
  for (const snapshotEntry of snapshotFiles) {
    if (!snapshotEntry || typeof snapshotEntry.path !== 'string' || !isSha256(snapshotEntry.sha256)) {
      currentSnapshotIntact = false
      continue
    }
    const destination = relativeSnapshotPath(manifestPath, snapshotEntry.path)
    try {
      const diskEntry = await hashFile(destination, fsOps)
      if (diskEntry.sha256 !== snapshotEntry.sha256 || diskEntry.bytes !== snapshotEntry.bytes) currentSnapshotIntact = false
      currentTreeHash.update(`${snapshotEntry.path}\0`)
      currentTreeHash.update(await fsOps.readFile(destination))
    } catch (error) {
      if (error?.code === 'ENOENT') currentSnapshotIntact = false
      else throw error
    }
  }
  if (currentTreeHash.digest('hex') !== manifest.snapshot.treeSha256) currentSnapshotIntact = false
  const license = await inspectLicenseFiles(manifest, manifestPath, fsOps)
  if (!license.intact || !license.metadataMatches) currentSnapshotIntact = false
  const snapshotMetadataMatchesSource =
    manifest.snapshot.treeSha256 === sourceTree.sha256 &&
    snapshotFiles.length === sourceTree.entries.length &&
    snapshotEntriesByPath.size === sourceEntriesByPath.size &&
    [...sourceEntriesByPath.entries()].every(([relativePath, sourceEntry]) => sameEntry(snapshotEntriesByPath.get(relativePath), sourceEntry))
  const snapshotMatches = snapshotMetadataMatchesSource && currentSnapshotIntact
  const oldSnapshotValid = manifest.snapshot.status === 'synced' && currentSnapshotIntact
  return {
    sourceTree,
    matchesPinnedTree,
    snapshotMatches,
    currentSnapshotIntact,
    oldSnapshotValid,
    license,
  }
}

function makeReport({
  mode,
  manifestPath,
  sourceRoot,
  manifest,
  sourceTree,
  matchesPinnedTree,
  snapshotMatches,
  currentSnapshotIntact,
  oldSnapshotValid,
  sourceStatus,
  reviewedRef,
  writeSet = [],
  staleFiles = [],
  license,
}) {
  const report = {
    mode,
    manifest: path.relative(appsRoot, manifestPath),
    sourceRoot,
    upstreamCommit: manifest.upstream.commit,
    sourceTreeSha256: sourceTree.sha256,
    pinnedSourceMatches: matchesPinnedTree,
    sourceStatus,
    reviewedRef: reviewedRef ?? null,
    snapshotStatus: manifest.snapshot.status,
    oldSnapshotValid,
    snapshotMatches,
    currentSnapshotIntact,
    licensePreserved: license?.intact === true && license?.metadataMatches !== false,
    staleFiles,
    writeSet,
    protectedRoots: [
      'frontend/components',
      'frontend/stores',
      'frontend/types',
      'frontend/lib',
      'frontend/electron/preload',
      'frontend/electron/main',
    ],
  }
  return report
}

function emitReport(report) {
  console.log(JSON.stringify(report, null, 2))
}

function classifySource({ matchesPinnedTree, reviewedRef, manifest }) {
  const reviewedRefValid = reviewedRef === undefined || isCommit(reviewedRef)
  const approvedReplacement =
    !matchesPinnedTree && reviewedRef !== undefined && reviewedRefValid && reviewedRef !== manifest.upstream.commit
  if (matchesPinnedTree && reviewedRef !== undefined && reviewedRef !== manifest.upstream.commit) {
    return { sourceStatus: 'pinned-source-with-invalid-new-ref', approvedReplacement: false }
  }
  if (matchesPinnedTree) return { sourceStatus: 'pinned', approvedReplacement: true }
  if (approvedReplacement) return { sourceStatus: 'mismatching-approved-source', approvedReplacement: true }
  return { sourceStatus: 'mismatching-unreviewed-source', approvedReplacement: false }
}

function assertVendorOnlyWriteSet(manifest, sourceTree, staleFiles) {
  const licensePaths = new Set(manifestNoticePaths(manifest))
  for (const entry of sourceTree.entries) {
    assertSnapshotContentPath(entry.path, 'source tree entry', licensePaths)
  }
  for (const stalePath of staleFiles) {
    assertSnapshotContentPath(stalePath, 'stale snapshot entry', licensePaths)
  }
}

async function computeWriteSet(manifest, sourceTree, manifestPath, fsOps = defaultFsOps) {
  const writeSet = []
  for (const entry of sourceTree.entries) {
    const destination = relativeSnapshotPath(manifestPath, entry.path)
    let existing
    try {
      existing = await hashFile(destination, fsOps)
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
    if (!existing || existing.sha256 !== entry.sha256 || existing.bytes !== entry.bytes) {
      writeSet.push({ path: entry.path, sha256: entry.sha256 })
    }
  }
  const sourcePaths = new Set(sourceTree.entries.map((entry) => entry.path))
  const staleFiles = manifest.snapshot.files
    .map((entry) => entry?.path)
    .filter((relativePath) => typeof relativePath === 'string' && !sourcePaths.has(relativePath))
  for (const relativePath of staleFiles) writeSet.push({ path: relativePath, action: 'stale' })

  for (const relativePath of manifestNoticePaths(manifest)) {
    const destination = relativeSnapshotPath(manifestPath, relativePath)
    if (!(await pathExists(destination, fsOps))) writeSet.push({ path: relativePath, action: 'license' })
  }
  return { writeSet, staleFiles }
}

async function uniqueSiblingPath(basePath, label, fsOps = defaultFsOps, idFactory = randomUUID) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const sibling = `${basePath}.${label}-${Date.now()}-${process.pid}-${idFactory()}`
    if (!(await pathExists(sibling, fsOps))) return sibling
  }
  throw new Error(`could not allocate a unique ${label} snapshot path`)
}

async function copyDirectoryContents(sourceRoot, destinationRoot, fsOps = defaultFsOps) {
  for (const entry of await fsOps.readdir(sourceRoot, { withFileTypes: true })) {
    await fsOps.cp(path.join(sourceRoot, entry.name), path.join(destinationRoot, entry.name), {
      recursive: true,
      force: true,
    })
  }
}

async function restoreOldRoot({ vendorRoot, previousRoot, fsOps, idFactory }) {
  if (await pathExists(vendorRoot, fsOps)) {
    const failedRoot = await uniqueSiblingPath(vendorRoot, 'failed', fsOps, idFactory)
    await fsOps.rename(vendorRoot, failedRoot)
  }
  if (!(await pathExists(previousRoot, fsOps))) {
    throw new Error('rollback failed: previous snapshot is missing')
  }
  await fsOps.rename(previousRoot, vendorRoot)
}

async function applySnapshot({
  manifest,
  manifestPath,
  sourceRoot,
  sourceTree,
  staleFiles,
  reviewedRef,
  fsOps = defaultFsOps,
  now = () => new Date(),
  idFactory = randomUUID,
}) {
  const vendorRoot = path.dirname(manifestPath)
  await assertNoSymlinks(vendorRoot, 'vendor root', fsOps)
  await assertNoSymlinks(sourceRoot, 'source root', fsOps)
  assertVendorOnlyWriteSet(manifest, sourceTree, staleFiles)
  const manifestName = path.basename(manifestPath)
  const stageRoot = await fsOps.mkdtemp(`${vendorRoot}.staging-${process.pid}-`)
  const previousRoot = await uniqueSiblingPath(vendorRoot, 'previous', fsOps, idFactory)
  let oldRootMoved = false
  let newRootLive = false
  try {
    await copyDirectoryContents(vendorRoot, stageRoot, fsOps)
    await assertNoSymlinks(stageRoot, 'staged vendor root', fsOps)
    const stagedManifest = await readJson(path.join(stageRoot, manifestName), fsOps)
    validateManifest(stagedManifest)
    const stagedLicense = await inspectLicenseFiles(stagedManifest, path.join(stageRoot, manifestName), fsOps)
    if (!stagedLicense.intact) throw new Error('staged snapshot is missing the preserved MIT license notice')

    for (const relativePath of staleFiles) {
      const stalePath = path.join(stageRoot, relativePath)
      if (await pathExists(stalePath, fsOps)) await fsOps.rm(stalePath, { recursive: true, force: true })
    }
    for (const entry of sourceTree.entries) {
      const destination = path.join(stageRoot, entry.path)
      await fsOps.mkdir(path.dirname(destination), { recursive: true })
      await fsOps.cp(path.join(sourceRoot, entry.path), destination, { force: true })
    }
    const stagedHash = await hashSourceTree(stageRoot, manifest.sourceFiles, fsOps)
    if (stagedHash.sha256 !== sourceTree.sha256) throw new Error('staged snapshot validation failed')

    await fsOps.rename(vendorRoot, previousRoot)
    oldRootMoved = true
    await fsOps.rename(stageRoot, vendorRoot)
    newRootLive = true

    const nextManifest = {
      ...manifest,
      upstream: {
        ...manifest.upstream,
        commit: reviewedRef ?? manifest.upstream.commit,
        sourceTreeSha256: sourceTree.sha256,
      },
      snapshot: {
        ...manifest.snapshot,
        status: 'synced',
        treeSha256: sourceTree.sha256,
        files: sourceTree.entries,
        licenseFiles: (await inspectLicenseFiles(manifest, path.join(vendorRoot, manifestName), fsOps)).entries,
        lastSyncAt: now().toISOString(),
      },
    }
    const tempManifestPath = `${manifestPath}.tmp-${process.pid}-${idFactory()}`
    await fsOps.writeFile(tempManifestPath, `${JSON.stringify(nextManifest, null, 2)}\n`, 'utf8')
    await fsOps.rename(tempManifestPath, manifestPath)
    return {
      applied: true,
      previousManifest: path.relative(appsRoot, path.join(previousRoot, manifestName)),
      previousSnapshot: path.relative(appsRoot, previousRoot),
      staleFiles,
      manifest: nextManifest,
    }
  } catch (error) {
    if (oldRootMoved) {
      try {
        await restoreOldRoot({ vendorRoot, previousRoot, fsOps, idFactory })
      } catch (rollbackError) {
        throw new Error(
          `upgrade failed and rollback failed: ${error instanceof Error ? error.message : String(error)}; ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`,
        )
      }
    }
    throw error
  } finally {
    if (!newRootLive && await pathExists(stageRoot, fsOps)) {
      await fsOps.rm(stageRoot, { recursive: true, force: true })
    }
  }
}

export async function runSync(args, {
  fsOps = defaultFsOps,
  emit = true,
  now = () => new Date(),
  idFactory = randomUUID,
} = {}) {
  const mode = args[0]
  if (!['check', 'dry-run', 'apply'].includes(mode)) throw new Error('mode must be check, dry-run, or apply')
  const manifestPath = path.resolve(optionValue(args, '--manifest') ?? defaultManifestPath)
  const manifest = await readJson(manifestPath, fsOps)
  validateManifest(manifest)
  const compatibilityMatrixPath = path.resolve(optionValue(args, '--compatibility-matrix') ?? defaultCompatibilityMatrixPath)
  const compatibilityMatrix = await readJson(compatibilityMatrixPath, fsOps)
  if (mode !== 'apply') {
    validateCompatibilityMatrix(compatibilityMatrix, manifest.adapterContractVersion, manifest.upstream.commit)
  }
  const sourceRoot = resolveSourceRoot(args)
  const reviewedRef = optionValue(args, '--reviewed-ref')
  const checked = await checkSource(manifest, sourceRoot, manifestPath, fsOps)
  const sourceClassification = classifySource({ ...checked, reviewedRef, manifest })
  const { writeSet, staleFiles } = await computeWriteSet(manifest, checked.sourceTree, manifestPath, fsOps)
  const report = makeReport({
    mode,
    manifestPath,
    sourceRoot,
    manifest,
    ...checked,
    sourceStatus: sourceClassification.sourceStatus,
    reviewedRef,
    writeSet,
    staleFiles,
  })
  if (emit) emitReport(report)

  if (reviewedRef !== undefined && !isCommit(reviewedRef)) {
    throw new Error('reviewed ref must be a full 40-character commit')
  }
  if (!sourceClassification.approvedReplacement) {
    if (!checked.matchesPinnedTree && sourceClassification.sourceStatus === 'mismatching-unreviewed-source') {
      throw new Error('source tree does not match the pinned upstream checksum; review the ref before syncing')
    }
    if (sourceClassification.sourceStatus === 'pinned-source-with-invalid-new-ref') {
      throw new Error('reviewed ref does not match the pinned source tree')
    }
  }
  if (mode === 'check' || mode === 'dry-run') return report
  if (!args.includes('--approve')) {
    throw new Error('apply is blocked until the reviewed source replacement is confirmed with --approve')
  }
  if (!checked.currentSnapshotIntact && manifest.snapshot.status === 'synced') {
    throw new Error('apply is blocked: current snapshot is tampered or stale; restore the previous known-good snapshot first')
  }
  const targetRef = reviewedRef ?? manifest.upstream.commit
  validateCompatibilityMatrix(compatibilityMatrix, manifest.adapterContractVersion, targetRef)
  const applied = await applySnapshot({
    manifest,
    manifestPath,
    sourceRoot,
    sourceTree: checked.sourceTree,
    staleFiles,
    reviewedRef: targetRef,
    fsOps,
    now,
    idFactory,
  })
  const result = { ...report, ...applied }
  if (emit) emitReport({
    applied: result.applied,
    previousManifest: result.previousManifest,
    previousSnapshot: result.previousSnapshot,
    staleFiles: result.staleFiles,
  })
  return result
}

async function main() {
  try {
    await runSync(process.argv.slice(2))
  } catch (error) {
    if (process.argv[2] === undefined || !['check', 'dry-run', 'apply'].includes(process.argv[2])) usage()
    console.error(`sync-aitoearn-core: ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  }
}

export { checkSource, hashFile, hashSourceTree, validateManifest, applySnapshot }

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) main()
