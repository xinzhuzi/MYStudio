#!/usr/bin/env node
/**
 * 一次性迁移:把已落地的 douyin 凭据脱敏补丁纳入 aitoearn-source.json 的完整性模型。
 *
 * 背景:08-18 安全加固直接修改了 vendor 快照内的 douyin/index.ts(脱敏凭据日志),
 * 但 manifest.snapshot 仍钉上游纯净哈希 → sync check 会把该文件判为「快照被篡改」。
 * sync-aitoearn-core.mjs 已升级为「snapshot 记补丁后哈希 + upstream 钉纯净树」的
 * 双轨模型;本脚本把现存 manifest 迁移到该模型,无需重新走完整上游同步。
 *
 * fail-closed 约束(任一不满足即退出 1、零写入):
 *   1. 磁盘与 manifest 的差异文件集合必须恰为「已激活安全补丁目标」的子集;
 *   2. 每个差异文件的磁盘内容必须已处于补丁后状态(幂等套用无变化);
 *   3. 其余文件逐一与旧 manifest 哈希一致(防止把无关篡改一并「洗白」)。
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  SECURITY_PATCHES,
  applySecurityPatchToContent,
  hashSourceTree,
  validateManifest,
} from './sync-aitoearn-core.mjs'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const manifestPath = path.resolve(
  scriptDir,
  '..',
  '..',
  'frontend/electron/aitoearn/vendor/aitoearn-core/aitoearn-source.json',
)

function fail(message) {
  throw new Error(message)
}

async function main() {
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
validateManifest(manifest)
const vendorRoot = path.dirname(manifestPath)

const activePatches = SECURITY_PATCHES.filter((patch) => manifest.sourceFiles.includes(patch.file))
const patchTargets = new Set(activePatches.map((patch) => patch.file))

const diffs = []
for (const entry of manifest.snapshot.files) {
  const diskHash = crypto
    .createHash('sha256')
    .update(fs.readFileSync(path.join(vendorRoot, entry.path)))
    .digest('hex')
  if (diskHash !== entry.sha256) diffs.push(entry.path)
}

const unexpected = diffs.filter((file) => !patchTargets.has(file))
if (unexpected.length > 0) {
  fail(`磁盘存在补丁目标之外的差异文件,拒绝迁移: ${unexpected.join(', ')}`)
}

const securityPatchEntries = []
for (const patch of activePatches) {
  const diskPath = path.join(vendorRoot, patch.file)
  const diskContent = fs.readFileSync(diskPath, 'utf8')
  let patched
  try {
    patched = applySecurityPatchToContent(diskContent, patch)
  } catch (error) {
    fail(`${patch.file} 补丁锚点漂移: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (patched !== diskContent) {
    fail(`${patch.file} 磁盘内容不是补丁后状态(仍含原始日志语句),拒绝迁移`)
  }
  securityPatchEntries.push({
    path: patch.file,
    description: patch.description,
    sha256: crypto.createHash('sha256').update(patched, 'utf8').digest('hex'),
    bytes: Buffer.byteLength(patched, 'utf8'),
  })
}

if (diffs.length === 0 && manifest.snapshot.securityPatches !== undefined) {
  console.log('manifest 已处于补丁模型,无需迁移')
  return
}

const snapshotTree = await hashSourceTree(vendorRoot, manifest.sourceFiles)
const nextManifest = {
  ...manifest,
  snapshot: {
    ...manifest.snapshot,
    treeSha256: snapshotTree.sha256,
    files: snapshotTree.entries,
    securityPatches: securityPatchEntries,
  },
}
validateManifest(nextManifest)

const tempPath = `${manifestPath}.tmp-${process.pid}`
fs.writeFileSync(tempPath, `${JSON.stringify(nextManifest, null, 2)}\n`, 'utf8')
fs.renameSync(tempPath, manifestPath)
console.log(`manifest 已迁移到安全补丁完整性模型: ${path.relative(scriptDir, manifestPath)}`)
console.log(`  补丁目标: ${securityPatchEntries.map((entry) => entry.path).join(', ') || '(无)'}`)
console.log(`  快照差异收敛: ${diffs.length} 个文件已按补丁后哈希入册`)
}

try {
  await main()
} catch (error) {
  console.error(`refresh-aitoearn-security-patch-manifest: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
}
