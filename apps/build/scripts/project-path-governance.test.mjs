// @vitest-environment node
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  applyApprovedTrashManifest,
  buildPathGovernanceManifest,
  classifyRelativePath,
  formatPathGovernanceCliResult,
  runPathGovernanceCli,
} from './project-path-governance.mjs'

const roots = []

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mystudio-path-governance-'))
  roots.push(root)
  fs.mkdirSync(path.join(root, 'apps', 'frontend', 'src'), { recursive: true })
  fs.mkdirSync(path.join(root, 'apps', 'frontend', 'out'), { recursive: true })
  fs.mkdirSync(path.join(root, 'apps', 'backend', 'tts'), { recursive: true })
  fs.mkdirSync(path.join(root, 'apps', 'build', 'scripts'), { recursive: true })
  fs.mkdirSync(path.join(root, 'apps', '.trellis'), { recursive: true })
  fs.mkdirSync(path.join(root, 'apps', 'node_modules', 'pkg'), { recursive: true })
  fs.mkdirSync(path.join(root, 'apps', '.cache', 'remotion-bundle'), { recursive: true })
  fs.mkdirSync(path.join(root, 'apps', 'release'), { recursive: true })
  fs.mkdirSync(path.join(root, 'apps', 'backend', 'tts', '__pycache__'), { recursive: true })
  fs.mkdirSync(path.join(root, '.trellis', 'tasks'), { recursive: true })
  fs.mkdirSync(path.join(root, 'output'), { recursive: true })
  fs.writeFileSync(path.join(root, 'apps', 'frontend', 'src', 'app.ts'), 'export const app = true\n')
  fs.writeFileSync(path.join(root, 'apps', 'frontend', 'out', 'old.js'), 'old build\n')
  fs.writeFileSync(path.join(root, 'apps', 'backend', 'tts', 'server.py'), 'print("tts")\n')
  fs.writeFileSync(path.join(root, 'apps', 'build', 'scripts', 'build.mjs'), 'export {}\n')
  fs.writeFileSync(path.join(root, 'apps', '.trellis', 'inventory.json'), '{}\n')
  fs.writeFileSync(path.join(root, 'apps', 'node_modules', 'pkg', 'index.js'), 'dependency\n')
  fs.writeFileSync(path.join(root, 'apps', '.cache', 'remotion-bundle', 'bundle.js'), 'current bundle\n')
  fs.writeFileSync(path.join(root, 'apps', 'release', 'app.asar'), 'release\n')
  fs.writeFileSync(path.join(root, 'apps', 'frontend', 'src', '.DS_Store'), 'finder\n')
  fs.writeFileSync(path.join(root, 'apps', 'backend', 'tts', '__pycache__', 'server.cpython-313.pyc'), 'bytecode\n')
  fs.writeFileSync(path.join(root, '.trellis', 'tasks', 'keep.json'), '{"keep":true}\n')
  fs.writeFileSync(path.join(root, 'output', 'report.json'), '{"ok":false}\n')
  return root
}

function researchOutput(root, name) {
  return path.join(
    root,
    '.trellis',
    'tasks',
    '08-01-audit-project-paths-and-cleanup',
    'research',
    name,
  )
}

function approvedManifest(root, targets, batchId) {
  const scan = buildPathGovernanceManifest({ repoRoot: root, targets })
  return {
    schemaVersion: 1,
    mode: 'approved-trash',
    approved: true,
    batchId,
    repoRoot: root,
    targets: scan.targets.map((target) => ({
      ...target,
      approved: true,
      deletionEligible: true,
    })),
  }
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`)
}

afterEach(() => {
  vi.restoreAllMocks()
  while (roots.length > 0) fs.rmSync(roots.pop(), { recursive: true, force: true })
})

describe('project path governance scanner', () => {
  it('emits a read-only manifest with file hash, size and mtime evidence', () => {
    const root = fixture()
    const manifest = buildPathGovernanceManifest({
      repoRoot: root,
      targets: ['apps/frontend/out/', 'output'],
      generatedAt: '2026-08-01T00:00:00.000Z',
    })
    const output = manifest.targets.find((target) => target.relativePath === 'apps/frontend/out')
    const file = output.files.find((entry) => entry.relativePath === 'apps/frontend/out/old.js')
    expect(manifest).toMatchObject({ schemaVersion: 1, mode: 'read-only', repoRoot: root })
    expect(file).toMatchObject({ relativePath: 'apps/frontend/out/old.js', bytes: 10 })
    expect(file.mtimeMs).toEqual(expect.any(Number))
    expect(file.sha256).toBe(crypto.createHash('sha256').update('old build\n').digest('hex'))
    expect(manifest.summary).toMatchObject({ files: 2, bytes: 23, protectedTargets: 0 })
    expect(fs.existsSync(path.join(root, 'apps', 'frontend', 'out', 'old.js'))).toBe(true)
  })

  it('hard-protects Trellis, source, dependency, release and current bundle paths', () => {
    const root = fixture()
    expect(classifyRelativePath('.trellis/tasks/keep.json')).toMatchObject({ protected: true, category: 'trellis' })
    expect(classifyRelativePath('apps/.trellis/cache.json')).toMatchObject({ protected: true, category: 'trellis' })
    expect(classifyRelativePath('apps/frontend/src/app.ts')).toMatchObject({ protected: true, category: 'source' })
    expect(classifyRelativePath('apps/backend/tts/server.py')).toMatchObject({ protected: true, category: 'source' })
    expect(classifyRelativePath('apps/build/scripts/build.mjs')).toMatchObject({ protected: true, category: 'source' })
    expect(classifyRelativePath('apps/frontend/src/.DS_Store')).toMatchObject({ protected: false, category: 'candidate' })
    expect(classifyRelativePath('apps/backend/tts/__pycache__/server.cpython-313.pyc')).toMatchObject({ protected: false, category: 'candidate' })
    expect(classifyRelativePath('apps/.trellis/__pycache__/cache.pyc')).toMatchObject({ protected: true, category: 'trellis' })
    expect(classifyRelativePath('apps/node_modules/pkg/index.js')).toMatchObject({ protected: true, category: 'dependencies' })
    expect(classifyRelativePath('apps/node_modules/pkg/__pycache__/cache.pyc')).toMatchObject({ protected: true, category: 'dependencies' })
    expect(classifyRelativePath('apps/build/scripts/workspace-full-test-2026-07-26.log')).toMatchObject({ protected: false, category: 'candidate' })
    expect(classifyRelativePath('apps/build/scripts/other.log')).toMatchObject({ protected: true, category: 'source' })
    expect(classifyRelativePath('node_modules/pkg/index.js')).toMatchObject({ protected: true, category: 'dependencies' })
    expect(classifyRelativePath('apps/release/app.asar')).toMatchObject({ protected: true, category: 'release' })
    expect(classifyRelativePath('apps/release/.DS_Store')).toMatchObject({ protected: true, category: 'release' })
    expect(classifyRelativePath('apps/.cache/remotion-bundle/bundle.js')).toMatchObject({ protected: true, category: 'current-remotion-bundle' })
    expect(classifyRelativePath('apps/out/renderer/index.html')).toMatchObject({ protected: true, category: 'current-build' })
    expect(classifyRelativePath('apps/package.json')).toMatchObject({ protected: true, category: 'source' })
    expect(classifyRelativePath('docs/engineering/README.md')).toMatchObject({ protected: true, category: 'project-documentation' })
    expect(classifyRelativePath('.agents/skills/example.md')).toMatchObject({ protected: true, category: 'project-control' })
    expect(classifyRelativePath('.claude/CLAUDE.md')).toMatchObject({ protected: true, category: 'project-control' })
    expect(classifyRelativePath('.codex/config.toml')).toMatchObject({ protected: true, category: 'project-control' })
    expect(classifyRelativePath('.github/workflows/test.yml')).toMatchObject({ protected: true, category: 'project-control' })
    expect(classifyRelativePath('README.md')).toMatchObject({ protected: true, category: 'root-project-file' })
    expect(classifyRelativePath('.gitignore')).toMatchObject({ protected: true, category: 'root-project-file' })

    const manifest = buildPathGovernanceManifest({ repoRoot: root, targets: [
      '.trellis',
      'apps/.trellis',
      'apps/frontend/src',
      'apps/backend',
      'apps/build',
      'apps/node_modules',
      'apps/release',
      'apps/.cache/remotion-bundle',
    ] })
    expect(manifest.targets.every((target) => target.protected && target.skipped)).toBe(true)
    expect(manifest.summary.protectedTargets).toBe(8)
    expect(manifest.summary.files).toBe(0)
  })

  it('rejects absolute, parent-traversing and symlink-escaping targets', () => {
    const root = fixture()
    expect(() => buildPathGovernanceManifest({ repoRoot: root, targets: [path.join(root, 'output')] }))
      .toThrow(/relative target/)
    expect(() => buildPathGovernanceManifest({ repoRoot: root, targets: ['../outside'] }))
      .toThrow(/relative target/)
    expect(() => buildPathGovernanceManifest({ repoRoot: root, targets: ['output/*'] }))
      .toThrow(/glob/)

    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'mystudio-path-outside-'))
    roots.push(outside)
    fs.writeFileSync(path.join(outside, 'secret.txt'), 'outside\n')
    fs.symlinkSync(outside, path.join(root, 'linked-output'))
    expect(() => buildPathGovernanceManifest({ repoRoot: root, targets: ['linked-output'] }))
      .toThrow(/symbolic link|outside repository/)
    fs.symlinkSync(outside, path.join(root, 'output', 'linked-secret'))
    expect(() => buildPathGovernanceManifest({ repoRoot: root, targets: ['output'] }))
      .toThrow(/symbolic link|outside repository/)
  })

  it('writes only an explicit scan manifest and rejects unsupported apply commands', () => {
    const root = fixture()
    const output = researchOutput(root, 'scan.json')
    const result = runPathGovernanceCli([
      'scan', '--target', 'output', '--output', output,
    ], { repoRoot: root })
    expect(result.output).toBe(path.join(fs.realpathSync(root), path.relative(root, output)))
    expect(JSON.parse(fs.readFileSync(output, 'utf8'))).toMatchObject({ mode: 'read-only' })
    const relativeOutput = '.trellis/tasks/08-01-audit-project-paths-and-cleanup/research/relative-scan.json'
    const relativeResult = runPathGovernanceCli([
      'scan', '--target', 'output', '--output', relativeOutput,
    ], { repoRoot: root })
    expect(relativeResult.output).toBe(path.join(fs.realpathSync(root), relativeOutput))
    expect(() => runPathGovernanceCli([
      'trash',
    ], { repoRoot: root, trashRunner: () => { throw new Error('runner must not be called') } }))
      .toThrow(/requires --manifest/)
    expect(() => runPathGovernanceCli(['scan', '--repo-root', root], { repoRoot: root }))
      .toThrow(/repo-root/)
    expect(() => runPathGovernanceCli(['scan', '--unknown', 'value'], { repoRoot: root }))
      .toThrow(/unknown|unexpected/)
  })

  it('rejects command-specific flags instead of ignoring them', () => {
    const root = fixture()
    const appliedOutput = researchOutput(root, 'applied.json')
    const manifestPath = researchOutput(root, 'approved.json')

    for (const args of [
      ['scan', '--manifest', manifestPath],
      ['scan', '--batch-id', 'batch-a-flags'],
      ['scan', '--applied-output', appliedOutput],
    ]) {
      expect(() => runPathGovernanceCli(args, { repoRoot: root })).toThrow(/not valid for scan/)
    }

    for (const extraArgs of [['--target', 'output'], ['--output', appliedOutput]]) {
      expect(() => runPathGovernanceCli([
        'trash',
        '--manifest', manifestPath,
        '--batch-id', 'batch-a-flags',
        '--applied-output', appliedOutput,
        ...extraArgs,
      ], { repoRoot: root, trashRunner: () => { throw new Error('runner must not be called') } }))
        .toThrow(/not valid for trash/)
    }
  })

  it('formats a successful trash CLI result without reading scan-only summary fields', () => {
    const root = fixture()
    const batchId = 'batch-a-cli'
    const manifestPath = researchOutput(root, 'approved-cli.json')
    const appliedOutput = researchOutput(root, 'applied-cli.json')
    writeJson(manifestPath, approvedManifest(root, ['output'], batchId))

    const result = runPathGovernanceCli([
      'trash',
      '--manifest', manifestPath,
      '--batch-id', batchId,
      '--applied-output', appliedOutput,
    ], { repoRoot: root, trashRunner: () => ({ status: 0 }) })

    const canonicalAppliedOutput = path.join(fs.realpathSync(root), path.relative(root, appliedOutput))
    expect(formatPathGovernanceCliResult(result)).toBe(
      `Path governance trash applied: ${canonicalAppliedOutput} (batch=${batchId}, targets=1)`,
    )
  })

  it('refuses manifest output through a symbolic link and never overwrites an existing file', () => {
    const root = fixture()
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'mystudio-path-output-'))
    roots.push(outside)
    const taskRoot = path.join(root, '.trellis', 'tasks', '08-01-audit-project-paths-and-cleanup')
    fs.mkdirSync(taskRoot, { recursive: true })
    fs.symlinkSync(outside, path.join(taskRoot, 'research'))

    expect(() => runPathGovernanceCli([
      'scan', '--target', 'output', '--output', researchOutput(root, 'scan.json'),
    ], { repoRoot: root })).toThrow(/symbolic link|outside repository/)
    expect(fs.existsSync(path.join(outside, 'scan.json'))).toBe(false)
    fs.unlinkSync(path.join(taskRoot, 'research'))

    const protectedOutput = path.join(root, 'apps', 'release', 'governance-scan.json')
    expect(() => runPathGovernanceCli([
      'scan', '--target', 'output', '--output', protectedOutput,
    ], { repoRoot: root })).toThrow(/task research/)
    expect(fs.existsSync(protectedOutput)).toBe(false)

    const overlappingOutput = researchOutput(root, 'overlapping-scan.json')
    expect(() => runPathGovernanceCli([
      'scan', '--target', '.trellis/tasks/08-01-audit-project-paths-and-cleanup/research', '--output', overlappingOutput,
    ], { repoRoot: root })).toThrow(/scan target/)
    expect(fs.existsSync(overlappingOutput)).toBe(false)

    const existing = researchOutput(root, 'existing-scan.json')
    fs.mkdirSync(path.dirname(existing), { recursive: true })
    fs.writeFileSync(existing, 'keep\n')
    expect(() => runPathGovernanceCli([
      'scan', '--target', 'output', '--output', existing,
    ], { repoRoot: root })).toThrow(/already exists/)
    expect(fs.readFileSync(existing, 'utf8')).toBe('keep\n')
  })

  it('requires a production --manifest path inside this task research directory', () => {
    const root = fixture()
    const batchId = 'batch-a-manifest-path'
    const manifestPath = path.join(root, 'approved-outside-task.json')
    const appliedOutput = researchOutput(root, 'outside-manifest-applied.json')
    writeJson(manifestPath, approvedManifest(root, ['output'], batchId))
    const trashRunner = vi.fn(() => ({ status: 0 }))

    expect(() => runPathGovernanceCli([
      'trash',
      '--manifest', manifestPath,
      '--batch-id', batchId,
      '--applied-output', appliedOutput,
    ], { repoRoot: root, trashRunner })).toThrow(/manifest must stay inside task research/)
    expect(trashRunner).not.toHaveBeenCalled()
    expect(fs.existsSync(appliedOutput)).toBe(false)
  })

  it('binds approval to the exact batch id and rejects duplicate or overlapping targets', () => {
    const root = fixture()
    const appliedOutput = researchOutput(root, 'invalid-target-set-applied.json')
    const trashRunner = vi.fn(() => ({ status: 0 }))

    expect(() => applyApprovedTrashManifest({
      repoRoot: root,
      manifest: approvedManifest(root, ['output'], 'batch-a-approved'),
      batchId: 'batch-a-relabeled',
      appliedOutput,
      trashRunner,
    })).toThrow(/manifest batch id.*batch-a-relabeled/)

    const duplicate = approvedManifest(root, ['output'], 'batch-a-duplicate')
    duplicate.targets.push({ ...duplicate.targets[0] })
    expect(() => applyApprovedTrashManifest({
      repoRoot: root,
      manifest: duplicate,
      batchId: 'batch-a-duplicate',
      appliedOutput,
      trashRunner,
    })).toThrow(/duplicate targets/)

    expect(() => applyApprovedTrashManifest({
      repoRoot: root,
      manifest: approvedManifest(root, ['output', 'output/report.json'], 'batch-a-overlap'),
      batchId: 'batch-a-overlap',
      appliedOutput,
      trashRunner,
    })).toThrow(/overlapping targets/)

    expect(trashRunner).not.toHaveBeenCalled()
    expect(fs.existsSync(appliedOutput)).toBe(false)
  })

  it('rejects mixed targets containing protected descendants and requires runner injection for fixture roots', () => {
    const root = fixture()
    const mixedAppliedOutput = researchOutput(root, 'mixed-target-applied.json')
    const mixedRunner = vi.fn(() => ({ status: 0 }))
    expect(() => applyApprovedTrashManifest({
      repoRoot: root,
      manifest: approvedManifest(root, ['apps'], 'batch-a-mixed'),
      batchId: 'batch-a-mixed',
      appliedOutput: mixedAppliedOutput,
      trashRunner: mixedRunner,
    })).toThrow(/protected descendants/)
    expect(mixedRunner).not.toHaveBeenCalled()
    expect(fs.existsSync(mixedAppliedOutput)).toBe(false)

    const manifestPath = researchOutput(root, 'runner-required-approved.json')
    const appliedOutput = researchOutput(root, 'runner-required-applied.json')
    writeJson(manifestPath, approvedManifest(root, ['output'], 'batch-a-runner-required'))
    expect(() => runPathGovernanceCli([
      'trash',
      '--manifest', manifestPath,
      '--batch-id', 'batch-a-runner-required',
      '--applied-output', appliedOutput,
    ], { repoRoot: root })).toThrow(/trashRunner is required/)
    expect(fs.existsSync(path.join(root, 'output', 'report.json'))).toBe(true)
    expect(fs.existsSync(appliedOutput)).toBe(false)
  })

  it('applies an explicitly approved manifest through an injected exact trash argv', () => {
    const root = fixture()
    const manifestPath = researchOutput(root, 'approved.json')
    const appliedOutput = researchOutput(root, 'applied.json')
    writeJson(manifestPath, approvedManifest(root, ['output'], 'batch-a-001'))
    const calls = []
    const fsyncSpy = vi.spyOn(fs, 'fsyncSync')
    const result = applyApprovedTrashManifest({
      repoRoot: root,
      manifestPath,
      batchId: 'batch-a-001',
      appliedOutput,
      trashRunner: (argv) => {
        calls.push(argv)
        expect(JSON.parse(fs.readFileSync(appliedOutput, 'utf8'))).toMatchObject({
          mode: 'applied-trash',
          status: 'pending',
          batchId: 'batch-a-001',
        })
        expect(fsyncSpy).toHaveBeenCalled()
        return { status: 0 }
      },
    })
    expect(calls).toEqual([['/usr/bin/trash', '--stopOnError', '--verbose', path.join(fs.realpathSync(root), 'output')]])
    expect(result.applied).toMatchObject({ mode: 'applied-trash', status: 'applied', batchId: 'batch-a-001' })
    expect(JSON.parse(fs.readFileSync(appliedOutput, 'utf8'))).toMatchObject({ status: 'applied', batchId: 'batch-a-001' })
    expect(fs.existsSync(path.join(root, 'output', 'report.json'))).toBe(true)
  })

  it('fails closed for missing approval, protected paths, more than 20 targets and drift', () => {
    const root = fixture()
    const appliedOutput = researchOutput(root, 'applied.json')
    const invoke = (manifest, batchId = 'batch-a-002') => applyApprovedTrashManifest({
      repoRoot: root,
      manifest,
      batchId,
      appliedOutput,
      trashRunner: () => { throw new Error('runner must not be called') },
    })
    expect(() => invoke({ ...approvedManifest(root, ['output'], 'batch-a-002'), approved: false })).toThrow(/approved=true/)
    expect(() => invoke(approvedManifest(root, ['apps/release'], 'batch-a-002'))).toThrow(/protected|eligible/)

    for (let index = 0; index < 21; index += 1) fs.writeFileSync(path.join(root, `candidate-${index}.txt`), `${index}\n`)
    expect(() => invoke(approvedManifest(root, Array.from({ length: 21 }, (_, index) => `candidate-${index}.txt`), 'batch-a-002'))).toThrow(/1-20/)

    const drifted = approvedManifest(root, ['output'], 'batch-a-002')
    fs.appendFileSync(path.join(root, 'output', 'report.json'), 'drift\n')
    expect(() => invoke(drifted)).toThrow(/drifted|changed/)
  })

  it.each([
    ['throw', () => { throw new Error('injected runner boom') }, /injected runner boom/],
    ['nonzero', () => ({ status: 7 }), /status 7/],
  ])('updates reserved evidence to failed when the runner returns %s', (_label, trashRunner, errorPattern) => {
    const root = fixture()
    const appliedOutput = researchOutput(root, 'failed-applied.json')
    const batchId = 'batch-a-runner-failure'
    expect(() => applyApprovedTrashManifest({
      repoRoot: root,
      manifest: approvedManifest(root, ['output'], batchId),
      batchId,
      appliedOutput,
      trashRunner,
    })).toThrow(errorPattern)
    expect(JSON.parse(fs.readFileSync(appliedOutput, 'utf8'))).toMatchObject({
      mode: 'applied-trash',
      status: 'failed',
      batchId,
      failureReason: expect.stringMatching(errorPattern),
    })
  })

  it('keeps durable pending evidence intact when the post-runner applied update fails', () => {
    const root = fixture()
    const appliedOutput = researchOutput(root, 'pending-applied.json')
    const batchId = 'batch-a-post-move-write-failure'
    const renameSpy = vi.spyOn(fs, 'renameSync').mockImplementation(() => {
      throw new Error('injected post-move evidence write failure')
    })

    expect(() => applyApprovedTrashManifest({
      repoRoot: root,
      manifest: approvedManifest(root, ['output'], batchId),
      batchId,
      appliedOutput,
      trashRunner: () => ({ status: 0 }),
    })).toThrow(/post-move evidence write failure/)
    renameSpy.mockRestore()
    expect(JSON.parse(fs.readFileSync(appliedOutput, 'utf8'))).toMatchObject({
      mode: 'applied-trash',
      status: 'pending',
      batchId,
    })
  })

  it('rejects unsafe batch/path manifests and never overwrites existing applied evidence', () => {
    const root = fixture()
    const appliedOutput = researchOutput(root, 'failed-applied.json')
    const unsafeBatchManifest = approvedManifest(root, ['output'], '../escape')
    expect(() => applyApprovedTrashManifest({
      repoRoot: root, manifest: unsafeBatchManifest, batchId: '../escape', appliedOutput, trashRunner: () => ({ status: 0 }),
    })).toThrow(/batch id/)
    const pathEscapeManifest = approvedManifest(root, ['output'], 'batch-a-003')
    expect(() => applyApprovedTrashManifest({
      repoRoot: root, manifest: { ...pathEscapeManifest, targets: [{ ...pathEscapeManifest.targets[0], relativePath: '../output' }] }, batchId: 'batch-a-003', appliedOutput, trashRunner: () => ({ status: 0 }),
    })).toThrow(/relative target/)

    writeJson(appliedOutput, { keep: true })
    const existingOutputManifest = approvedManifest(root, ['output'], 'batch-a-005')
    expect(() => applyApprovedTrashManifest({
      repoRoot: root, manifest: existingOutputManifest, batchId: 'batch-a-005', appliedOutput, trashRunner: () => ({ status: 0 }),
    })).toThrow(/already exists/)
    expect(JSON.parse(fs.readFileSync(appliedOutput, 'utf8'))).toEqual({ keep: true })
  })
})
