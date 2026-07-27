// @vitest-environment node
import crypto from 'node:crypto'
import fs from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { runUpgradeSmoke } from './aitoearn-upgrade-smoke.mjs'
import { hashFile, hashSourceTree, runSync } from './sync-aitoearn-core.mjs'

const OLD_COMMIT = 'a'.repeat(40)
const NEW_COMMIT = 'b'.repeat(40)
const roots = []
const appsRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

async function makeFixture({ stale = false } = {}) {
  const root = fs.mkdtempSync(path.join(tmpdir(), 'mystudio-aitoearn-sync-'))
  roots.push(root)
  const sourceRoot = path.join(root, 'source')
  const vendorRoot = path.join(root, 'vendor', 'aitoearn-core')
  fs.mkdirSync(sourceRoot, { recursive: true })
  fs.mkdirSync(vendorRoot, { recursive: true })
  const sourceFiles = ['electron/plat/index.ts', 'electron/main/plat/pub/PubItemVideo.ts']
  for (const relativePath of sourceFiles) {
    const sourcePath = path.join(sourceRoot, relativePath)
    fs.mkdirSync(path.dirname(sourcePath), { recursive: true })
    fs.writeFileSync(sourcePath, `old:${relativePath}\n`)
    const vendorPath = path.join(vendorRoot, relativePath)
    fs.mkdirSync(path.dirname(vendorPath), { recursive: true })
    fs.copyFileSync(sourcePath, vendorPath)
  }
  fs.writeFileSync(path.join(vendorRoot, 'LICENSE-AITOEARN.txt'), 'MIT AiToEarn notice\n')
  fs.writeFileSync(path.join(vendorRoot, 'adapter-metadata.json'), '{"preserve":true}\n')
  const sourceTree = await hashSourceTree(sourceRoot, sourceFiles)
  const snapshotEntries = [...sourceTree.entries]
  if (stale) {
    fs.writeFileSync(path.join(vendorRoot, 'stale-source.ts'), 'stale\n')
    snapshotEntries.push({ path: 'stale-source.ts', ...(await hashFile(path.join(vendorRoot, 'stale-source.ts'))) })
  }
  const snapshotTree = crypto.createHash('sha256')
  for (const entry of snapshotEntries) {
    snapshotTree.update(`${entry.path}\0`)
    snapshotTree.update(fs.readFileSync(path.join(vendorRoot, entry.path)))
  }
  const license = await hashFile(path.join(vendorRoot, 'LICENSE-AITOEARN.txt'))
  const manifest = {
    schemaVersion: 1,
    adapterContractVersion: 'self-media/v1',
    upstream: { repository: 'https://example.invalid/AiToEarn.git', ref: 'fixture', commit: OLD_COMMIT, sourceTreeSha256: sourceTree.sha256 },
    sourceFiles,
    license: { spdx: 'MIT', noticeFiles: ['LICENSE-AITOEARN.txt (fixture)'], attribution: 'AiToEarn (fixture)' },
    snapshot: { root: '.', status: 'synced', treeSha256: snapshotTree.digest('hex'), files: snapshotEntries, licenseFiles: [{ path: 'LICENSE-AITOEARN.txt', ...license }] },
  }
  fs.writeFileSync(path.join(vendorRoot, 'aitoearn-source.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  fs.writeFileSync(path.join(vendorRoot, 'aitoearn-source.previous.json'), '{"previous":true}\n')
  const matrixPath = path.join(root, 'compatibility', 'provider-matrix.json')
  fs.mkdirSync(path.dirname(matrixPath), { recursive: true })
  fs.writeFileSync(matrixPath, JSON.stringify({
    contractVersion: 'self-media/v1',
    providers: [{ providerId: 'aitoearn-local', upstreamCommit: OLD_COMMIT }],
  }))
  return { root, sourceRoot, vendorRoot, manifestPath: path.join(vendorRoot, 'aitoearn-source.json'), matrixPath, sourceFiles }
}

function syncArgs(fixture, mode, ...extra) {
  return [mode, '--source-root', fixture.sourceRoot, '--manifest', fixture.manifestPath, '--compatibility-matrix', fixture.matrixPath, ...extra]
}

function applyArgs(fixture, ...extra) {
  return syncArgs(fixture, 'apply', ...extra)
}

function setMatrixCommit(fixture, upstreamCommit) {
  const matrix = JSON.parse(fs.readFileSync(fixture.matrixPath, 'utf8'))
  matrix.providers[0].upstreamCommit = upstreamCommit
  fs.writeFileSync(fixture.matrixPath, JSON.stringify(matrix))
}

function findSnapshots(vendorRoot, label) {
  const parent = path.dirname(vendorRoot)
  return fs.readdirSync(parent).filter((entry) => new RegExp(`^${path.basename(vendorRoot)}\\.${label}-\\d+-\\d+-`).test(entry)).map((entry) => path.join(parent, entry))
}

afterEach(() => {
  while (roots.length) fs.rmSync(roots.pop(), { recursive: true, force: true })
})

describe('AiToEarn snapshot upgrade boundary', () => {
  it('refuses an unreviewed source ref without touching the old root', async () => {
    const fixture = await makeFixture()
    fs.appendFileSync(path.join(fixture.sourceRoot, fixture.sourceFiles[0]), 'new\n')
    const oldManifest = fs.readFileSync(fixture.manifestPath)
    await expect(runSync(applyArgs(fixture, '--approve'), { emit: false })).rejects.toThrow(/review the ref|reviewed ref/)
    expect(fs.readFileSync(fixture.manifestPath)).toEqual(oldManifest)
    expect(findSnapshots(fixture.vendorRoot, 'previous')).toEqual([])
  })

  it('rejects an incompatible adapter contract before reading or copying a source tree', async () => {
    const fixture = await makeFixture()
    const manifest = JSON.parse(fs.readFileSync(fixture.manifestPath, 'utf8'))
    manifest.adapterContractVersion = 'self-media/v2'
    fs.writeFileSync(fixture.manifestPath, JSON.stringify(manifest))
    await expect(runSync(syncArgs(fixture, 'check'), { emit: false }))
      .rejects.toThrow(/adapterContractVersion/)
    expect(findSnapshots(fixture.vendorRoot, 'previous')).toEqual([])
  })

  it('rejects source and stale entries that target MYStudio control files', async () => {
    for (const controlPath of ['aitoearn-source.json', 'LICENSE-AITOEARN.txt', 'adapter-metadata.json']) {
      const sourceFixture = await makeFixture()
      const sourceManifest = JSON.parse(fs.readFileSync(sourceFixture.manifestPath, 'utf8'))
      sourceManifest.sourceFiles.push(controlPath)
      fs.writeFileSync(sourceFixture.manifestPath, JSON.stringify(sourceManifest))
      await expect(runSync(syncArgs(sourceFixture, 'check'), { emit: false }))
        .rejects.toThrow(/reserved MYStudio control path/)

      const staleFixture = await makeFixture()
      const staleManifest = JSON.parse(fs.readFileSync(staleFixture.manifestPath, 'utf8'))
      staleManifest.snapshot.files.push({ path: controlPath, sha256: '0'.repeat(64), bytes: 0 })
      fs.writeFileSync(staleFixture.manifestPath, JSON.stringify(staleManifest))
      await expect(runSync(syncArgs(staleFixture, 'check'), { emit: false }))
        .rejects.toThrow(/reserved MYStudio control path/)
    }
  })

  it.each([
    ['source file', (fixture) => path.join(fixture.sourceRoot, fixture.sourceFiles[0])],
    ['vendor snapshot file', (fixture) => path.join(fixture.vendorRoot, fixture.sourceFiles[0])],
    ['license notice', (fixture) => path.join(fixture.vendorRoot, 'LICENSE-AITOEARN.txt')],
  ])('rejects a symlinked %s without touching its external target', async (_label, targetPath) => {
    const fixture = await makeFixture()
    const sentinelPath = path.join(fixture.root, 'outside-sentinel.txt')
    fs.writeFileSync(sentinelPath, 'outside sentinel\n')
    const linkedPath = targetPath(fixture)
    fs.rmSync(linkedPath)
    fs.symlinkSync(sentinelPath, linkedPath)

    await expect(runSync(syncArgs(fixture, 'check'), { emit: false }))
      .rejects.toThrow(/symlink/)
    await expect(runSync(applyArgs(fixture, '--approve'), { emit: false }))
      .rejects.toThrow(/symlink/)
    expect(fs.readFileSync(sentinelPath, 'utf8')).toBe('outside sentinel\n')
    expect(findSnapshots(fixture.vendorRoot, 'previous')).toEqual([])
  })

  it('reports a valid old snapshot separately from an approved new source and scopes writeSet', async () => {
    const fixture = await makeFixture()
    fs.appendFileSync(path.join(fixture.sourceRoot, fixture.sourceFiles[0]), 'new\n')
    const report = await runSync(syncArgs(fixture, 'dry-run', '--reviewed-ref', NEW_COMMIT), { emit: false })
    expect(report.sourceStatus).toBe('mismatching-approved-source')
    expect(report.oldSnapshotValid).toBe(true)
    expect(report.snapshotMatches).toBe(false)
    expect(report.writeSet.every(({ path: relativePath }) => !/^frontend\//.test(relativePath))).toBe(true)
    expect(report.writeSet.map(({ path: relativePath }) => relativePath)).toContain(fixture.sourceFiles[0])
  })

  it('detects tamper and stale snapshot entries before apply', async () => {
    const tampered = await makeFixture()
    fs.appendFileSync(path.join(tampered.vendorRoot, tampered.sourceFiles[0]), 'tampered\n')
    const tamperReport = await runSync(syncArgs(tampered, 'check'), { emit: false })
    expect(tamperReport.currentSnapshotIntact).toBe(false)
    expect(tamperReport.oldSnapshotValid).toBe(false)
    await expect(runSync(applyArgs(tampered, '--approve', '--reviewed-ref', OLD_COMMIT), { emit: false })).rejects.toThrow(/tampered or stale/)

    const stale = await makeFixture({ stale: true })
    const staleReport = await runSync(syncArgs(stale, 'dry-run'), { emit: false })
    expect(staleReport.oldSnapshotValid).toBe(true)
    expect(staleReport.staleFiles).toEqual(['stale-source.ts'])
    expect(staleReport.writeSet).toContainEqual({ path: 'stale-source.ts', action: 'stale' })
  })

  it('requires the MYStudio matrix to be reviewed for the replacement commit before apply', async () => {
    const fixture = await makeFixture()
    fs.appendFileSync(path.join(fixture.sourceRoot, fixture.sourceFiles[0]), 'new\n')
    await expect(runSync(applyArgs(fixture, '--approve', '--reviewed-ref', NEW_COMMIT), { emit: false }))
      .rejects.toThrow(/compatibility matrix upstreamCommit/)
    expect(findSnapshots(fixture.vendorRoot, 'previous')).toEqual([])
  })

  it('atomically applies a complete root, preserves license/metadata, and never deletes an existing rollback', async () => {
    const fixture = await makeFixture()
    const protectedFiles = [
      path.join(fixture.root, 'frontend', 'components', 'sentinel.txt'),
      path.join(fixture.root, 'frontend', 'stores', 'sentinel.txt'),
      path.join(fixture.root, 'frontend', 'lib', 'sentinel.txt'),
    ]
    for (const protectedFile of protectedFiles) {
      fs.mkdirSync(path.dirname(protectedFile), { recursive: true })
      fs.writeFileSync(protectedFile, `protected:${path.dirname(protectedFile)}\n`)
    }
    const existingRollback = path.join(path.dirname(fixture.vendorRoot), 'aitoearn-core.rollback-existing')
    fs.mkdirSync(existingRollback)
    fs.writeFileSync(path.join(existingRollback, 'keep.txt'), 'keep\n')
    fs.appendFileSync(path.join(fixture.sourceRoot, fixture.sourceFiles[0]), 'new\n')
    setMatrixCommit(fixture, NEW_COMMIT)
    const result = await runSync(applyArgs(fixture, '--approve', '--reviewed-ref', NEW_COMMIT), { emit: false, now: () => new Date('2030-01-01T00:00:00.000Z') })
    expect(result.applied).toBe(true)
    const nextManifest = JSON.parse(fs.readFileSync(fixture.manifestPath, 'utf8'))
    expect(nextManifest.upstream.commit).toBe(NEW_COMMIT)
    expect(fs.readFileSync(path.join(fixture.vendorRoot, 'LICENSE-AITOEARN.txt'), 'utf8')).toBe('MIT AiToEarn notice\n')
    expect(fs.readFileSync(path.join(fixture.vendorRoot, 'adapter-metadata.json'), 'utf8')).toBe('{"preserve":true}\n')
    expect(fs.readFileSync(path.join(existingRollback, 'keep.txt'), 'utf8')).toBe('keep\n')
    const previous = findSnapshots(fixture.vendorRoot, 'previous')
    expect(previous).toHaveLength(1)
    expect(fs.readFileSync(path.join(previous[0], 'aitoearn-source.json'))).not.toEqual(fs.readFileSync(fixture.manifestPath))
    expect(fs.readFileSync(path.join(previous[0], 'LICENSE-AITOEARN.txt'), 'utf8')).toBe('MIT AiToEarn notice\n')
    expect(fs.existsSync(path.join(fixture.vendorRoot, 'aitoearn-source.previous.json'))).toBe(true)
    expect(protectedFiles.map((file) => fs.readFileSync(file, 'utf8'))).toEqual([
      `protected:${path.join(fixture.root, 'frontend', 'components')}\n`,
      `protected:${path.join(fixture.root, 'frontend', 'stores')}\n`,
      `protected:${path.join(fixture.root, 'frontend', 'lib')}\n`,
    ])
  })

  it.each([
    ['swap', (base) => {
      let count = 0
      return { ...base, rename: async (...args) => { count += 1; if (count === 2) throw new Error('injected swap failure'); return fs.promises.rename(...args) } }
    }],
    ['manifest write', (base) => ({ ...base, writeFile: async (...args) => { throw new Error('injected manifest write failure') } })],
  ])('restores the exact old root and manifest on injected %s failure', async (_label, makeIo) => {
    const fixture = await makeFixture()
    fs.appendFileSync(path.join(fixture.sourceRoot, fixture.sourceFiles[0]), 'new\n')
    setMatrixCommit(fixture, NEW_COMMIT)
    const oldRootFile = fs.readFileSync(path.join(fixture.vendorRoot, fixture.sourceFiles[0]))
    const oldManifest = fs.readFileSync(fixture.manifestPath)
    const io = makeIo({ ...fs.promises })
    await expect(runSync(applyArgs(fixture, '--approve', '--reviewed-ref', NEW_COMMIT), { emit: false, fsOps: io })).rejects.toThrow(/injected/)
    expect(fs.readFileSync(path.join(fixture.vendorRoot, fixture.sourceFiles[0]))).toEqual(oldRootFile)
    expect(fs.readFileSync(fixture.manifestPath)).toEqual(oldManifest)
    expect(findSnapshots(fixture.vendorRoot, 'previous')).toEqual([])
  })

  it('keeps the shipped local compatibility matrix aligned with the vendor manifest', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(appsRoot, 'frontend/electron/aitoearn/vendor/aitoearn-core/aitoearn-source.json'), 'utf8'))
    const matrix = JSON.parse(fs.readFileSync(path.join(appsRoot, 'frontend/electron/aitoearn/providers/aitoearn-local/compatibility/provider-matrix.json'), 'utf8'))
    const local = matrix.providers.find((provider) => provider.providerId === 'aitoearn-local')
    expect(matrix.contractVersion).toBe(manifest.adapterContractVersion)
    expect(local?.upstreamCommit).toBe(manifest.upstream.commit)
  })

  it('executes all no-network upgrade smoke cases against the mocked adapter', () => {
    const report = runUpgradeSmoke()
    expect(report.passed).toBe(true)
    expect(report.execution.networkRequests).toBe(0)
    expect(report.execution.externalPublishAttempts).toBe(0)
    expect(report.cases['accounts'].ok).toBe(true)
    expect(report.cases['video'].ok).toBe(true)
    expect(report.cases['image-text'].ok).toBe(true)
    expect(report.cases['schedule-poll'].ok).toBe(true)
    expect(report.cases['partial-failure'].ok).toBe(true)
    expect(report.cases['credential-redaction'].ok).toBe(true)
    expect(report.cases['provider-incompatibility'].ok).toBe(true)
  })
})
