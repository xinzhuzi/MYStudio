#!/usr/bin/env node
/**
 * 一次性迁移脚本 —— 把注册表中的指定项目从应用数据目录 (_p/<pid>) 迁移到外部目录。
 *
 * 用法:
 *   node apps/build/scripts/migrate-project-to-external.mjs [--dry-run]
 *        [--app-data <dir>]        默认 ~/Library/Application Support/漫影工作室
 *        [--project-name <名>]     默认取项目索引中唯一工程
 *        [--target <dir>]          默认 /Users/zhengbingjin/Project/IP/MA
 *
 * 流程(任一步失败即回滚并退出非零):
 *   1. 前置:应用未运行;注册表可解析且按名找到项目;projects/_p/<pid> 存在;
 *      目标不存在或为空目录(存在且空 → 先 rmdir 再 rename);源≠目标。
 *   2. 备份:注册表 JSON 与 project-locations.json(若存在)复制为 .bak-<ts>。
 *   3. fs.renameSync(src, target);EXDEV → 直接报错退出(手工 cp -a 后重跑接管),不自动跨卷复制。
 *   4. 写位置表(merge {pid: target},原子写);注册表 JSON 增加/更新 location 字段(单行)。
 *   5. 校验:target 非空且含 script.json 或 director.json 之一;_p/<pid> 不存在;两 JSON 回读合法。
 *   6. 回滚(rename 后任一步失败):反向 rename + 恢复两份 JSON 备份。
 *
 * 迁移必须在「新版应用安装后、应用退出时」执行:旧版应用不识别位置表,
 * 会把项目在旧路径重建为空项目。
 */
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const DEFAULT_APP_DATA = '~/Library/Application Support/漫影工作室'
// Personal-machine default resolved at runtime: single project in the store wins.
function resolveDefaultProjectName() {
  try {
    const store = JSON.parse(fs.readFileSync(
      path.resolve(process.env.HOME || '', 'Library/Application Support/漫影工作室/projects/mystudio-project-store.json'), 'utf8'))
    const projects = store?.state?.projects || []
    const names = projects.map((p) => String(p.name || '').trim()).filter(Boolean)
    return names.length === 1 ? names[0] : ''
  } catch { return '' }
}
const DEFAULT_PROJECT_NAME = resolveDefaultProjectName()
const DEFAULT_TARGET = '/Users/zhengbingjin/Project/IP/MA'
const APP_PROCESS_PATTERN = '/Applications/漫影工作室.app'

function usage() {
  console.log(`用法: node migrate-project-to-external.mjs [--dry-run]
  --app-data <dir>      应用 userData 目录 (默认 ${DEFAULT_APP_DATA})
  --project-name <名>   注册表中的项目名 (默认 ${DEFAULT_PROJECT_NAME})
  --target <dir>        迁移目标目录,直接作为项目根 (默认 ${DEFAULT_TARGET})
  --dry-run             只打印迁移计划,不执行任何修改`)
}

function fail(message) {
  console.error(`[migrate] 失败: ${message}`)
  process.exit(1)
}

function parseArgs(argv) {
  const opts = {
    appData: DEFAULT_APP_DATA,
    projectName: DEFAULT_PROJECT_NAME,
    target: DEFAULT_TARGET,
    dryRun: false,
  }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    const next = () => {
      i += 1
      if (i >= argv.length || argv[i].startsWith('--')) fail(`${arg} 需要一个参数值`)
      return argv[i]
    }
    if (arg === '--dry-run') opts.dryRun = true
    else if (arg === '--app-data') opts.appData = next()
    else if (arg === '--project-name') opts.projectName = next()
    else if (arg === '--target') opts.target = next()
    else if (arg === '--help' || arg === '-h') {
      usage()
      process.exit(0)
    } else {
      fail(`未知参数: ${arg}（--help 查看用法）`)
    }
  }
  return opts
}

function resolveTilde(value) {
  if (value.startsWith('~/') || value === '~') return path.join(process.env.HOME ?? '', value.slice(1))
  return value
}

function samePath(left, right) {
  return path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase()
}

function isAppRunning() {
  try {
    const stdout = execFileSync('pgrep', ['-f', APP_PROCESS_PATTERN], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    return stdout.trim().length > 0
  } catch {
    // pgrep exits 1 when no process matches.
    return false
  }
}

function writeAtomic(filePath, contents) {
  const temporaryPath = `${filePath}.tmp-${process.pid}`
  fs.writeFileSync(temporaryPath, contents, 'utf8')
  fs.renameSync(temporaryPath, filePath)
}

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'))
}

function main() {
  const opts = parseArgs(process.argv.slice(2))
  const appData = path.resolve(resolveTilde(opts.appData))
  const target = path.resolve(resolveTilde(opts.target))
  const dryRun = opts.dryRun

  console.log(`[migrate] 项目名: ${opts.projectName}`)
  console.log(`[migrate] 应用数据目录: ${appData}`)
  console.log(`[migrate] 迁移目标(即新项目根): ${target}`)
  console.log(`[migrate] 模式: ${dryRun ? 'DRY-RUN(只打印计划,不执行)' : '真实执行'}`)

  // ---- basePath 解析(与 storage-manager.getStorageBasePath 同规则) ----
  let basePath = appData
  try {
    const storageConfigPath = path.join(appData, 'storage-config.json')
    if (fs.existsSync(storageConfigPath)) {
      const config = readJsonFile(storageConfigPath)
      if (typeof config.basePath === 'string' && config.basePath.trim()) {
        basePath = path.resolve(resolveTilde(config.basePath.trim()))
      } else if (typeof config.projectPath === 'string' && config.projectPath.trim()) {
        basePath = path.dirname(path.resolve(resolveTilde(config.projectPath.trim())))
      }
    }
  } catch (error) {
    console.warn(`[migrate] storage-config.json 解析失败,回退默认 basePath: ${error instanceof Error ? error.message : String(error)}`)
  }
  const dataRoot = path.join(basePath, 'projects')
  const registryPath = path.join(dataRoot, 'mystudio-project-store.json')
  const locationsPath = path.join(appData, 'project-locations.json')
  console.log(`[migrate] 数据根(注册表所在): ${dataRoot}`)

  // ---- 前置 1: 应用未运行 ----
  // MYSTUDIO_MIGRATE_SKIP_APP_CHECK=1 仅用于沙箱/CI fixture 验证,生产迁移严禁使用。
  if (process.env.MYSTUDIO_MIGRATE_SKIP_APP_CHECK === '1') {
    console.warn('[migrate] 警告: 已通过 MYSTUDIO_MIGRATE_SKIP_APP_CHECK=1 跳过"应用未运行"检查(仅限沙箱测试)。')
  } else if (isAppRunning()) {
    fail('漫影工作室应用仍在运行,请先完全退出应用(Cmd+Q)后重试。旧版应用不识别位置表,必须在升级安装新版并退出后执行迁移。')
  } else {
    console.log('[migrate] 前置通过: 应用未运行')
  }

  // ---- 前置 2: 注册表可解析且按名找到项目 ----
  if (!fs.existsSync(registryPath)) fail(`注册表不存在: ${registryPath}`)
  let registry
  try {
    registry = readJsonFile(registryPath)
  } catch (error) {
    fail(`注册表 JSON 无法解析: ${registryPath} (${error instanceof Error ? error.message : String(error)})`)
  }
  const projects = registry?.state?.projects
  if (!Array.isArray(projects) || projects.length === 0) fail('注册表缺少 state.projects 数组')
  const project = projects.find((entry) => entry && entry.name === opts.projectName)
  if (!project) {
    fail(`注册表中未找到名为「${opts.projectName}」的项目。现有项目: ${projects.map((entry) => entry?.name).join('、')}`)
  }
  const pid = project.id
  if (typeof pid !== 'string' || !pid) fail('项目条目缺少有效 id')
  const src = path.join(dataRoot, '_p', pid)
  console.log(`[migrate] 前置通过: 项目 ${opts.projectName} → pid ${pid}`)
  console.log(`[migrate] 源目录: ${src}`)

  // ---- 前置 3: 源目录存在 ----
  let srcStat
  try {
    srcStat = fs.statSync(src)
  } catch {
    fail(`源目录不存在: ${src}`)
  }
  if (!srcStat.isDirectory()) fail(`源路径不是文件夹: ${src}`)

  // ---- 前置 4: 源≠目标 ----
  if (samePath(src, target)) fail(`源与目标相同: ${src}`)

  // ---- 前置 5: 目标不存在或为空目录 ----
  let targetExistsEmpty = false
  if (fs.existsSync(target)) {
    const targetStat = fs.statSync(target)
    if (!targetStat.isDirectory()) fail(`目标已存在且不是文件夹: ${target}`)
    const entries = fs.readdirSync(target)
    if (entries.length > 0) fail(`目标目录非空(${entries.length} 项),拒绝覆盖: ${target}`)
    targetExistsEmpty = true
    console.log('[migrate] 前置通过: 目标为已存在的空目录(将先 rmdir 再 rename)')
  } else {
    console.log('[migrate] 前置通过: 目标不存在')
  }

  const plan = [
    `备份 ${registryPath} → .bak-<ts>${fs.existsSync(locationsPath) ? `;备份 ${locationsPath} → .bak-<ts>` : '(project-locations.json 尚不存在,无需备份)'}`,
    targetExistsEmpty ? `rmdir 空目标 ${target}` : '(目标不存在,无需清理)',
    `rename ${src} → ${target}(同卷即时完成;EXDEV 直接报错,不自动跨卷复制)`,
    `写位置表 ${locationsPath}: locations["${pid}"] = ${target}(merge + 原子写)`,
    `注册表 ${registryPath}: projects 中「${opts.projectName}」增加/更新 location = ${target}(保持单行 JSON)`,
    `校验: ${target} 非空且含 script.json 或 director.json;${src} 不存在;两 JSON 回读合法`,
  ]
  console.log('[migrate] 迁移计划:')
  plan.forEach((step, index) => console.log(`  ${index + 1}. ${step}`))

  if (dryRun) {
    console.log('[migrate] DRY-RUN 结束: 未执行任何修改。')
    return
  }

  // ---- 备份 ----
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const registryBackupPath = `${registryPath}.bak-${stamp}`
  fs.copyFileSync(registryPath, registryBackupPath)
  const locationsExisted = fs.existsSync(locationsPath)
  const locationsBackupPath = locationsExisted ? `${locationsPath}.bak-${stamp}` : null
  if (locationsExisted) fs.copyFileSync(locationsPath, locationsBackupPath)
  console.log(`[migrate] 已备份: ${registryBackupPath}${locationsBackupPath ? `; ${locationsBackupPath}` : ''}`)

  // ---- 空目标清理 ----
  if (targetExistsEmpty) {
    fs.rmdirSync(target)
    console.log(`[migrate] 已移除空目标目录: ${target}`)
  }

  // ---- rename ----
  // rename 失败时恢复"预先存在的空目标目录"(rmdir 发生在 rename 之前,失败路径必须还原)。
  const restoreEmptyTarget = () => {
    if (targetExistsEmpty && !fs.existsSync(target)) {
      fs.mkdirSync(target, { recursive: true })
      console.log(`[migrate] 已恢复预先存在的空目标目录: ${target}`)
    }
  }
  try {
    // 目标父目录可能不存在(如 --target 指向尚未创建的目录层级):rename 不会自动建父目录。
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.renameSync(src, target)
    console.log(`[migrate] 已迁移目录: ${src} → ${target}`)
  } catch (error) {
    restoreEmptyTarget()
    if (error && (error.code === 'EXDEV' || error.code === 'EPERM')) {
      fail(`跨卷/权限错误(${error.code}): 源与目标不在同一卷。请手工执行 cp -a "${src}" "${target}" 并确认数据完整后,删除源目录,再用本脚本同参数重跑(接管模式: 源缺失时脚本会在前置阶段报错,可先手工建空源目录占位或直接手工编辑两份 JSON)。`)
    }
    throw error
  }

  // ---- 位置表 + 注册表写入与校验(rename 之后;任一失败即回滚) ----
  const rollback = (reason) => {
    console.error(`[migrate] ${reason},正在回滚…`)
    try {
      if (fs.existsSync(target)) fs.renameSync(target, src)
      if (targetExistsEmpty && !fs.existsSync(target)) fs.mkdirSync(target, { recursive: true })
      fs.copyFileSync(registryBackupPath, registryPath)
      if (locationsBackupPath) fs.copyFileSync(locationsBackupPath, locationsPath)
      else if (fs.existsSync(locationsPath)) fs.rmSync(locationsPath, { force: true })
      console.error('[migrate] 回滚完成: 目录与两份 JSON 已恢复原状。')
    } catch (rollbackError) {
      console.error(`[migrate] 回滚失败!请手工处理: 反向 mv "${target}" "${src}",并从 ${registryBackupPath} 恢复注册表。`, rollbackError)
    }
  }

  try {
    // 位置表 merge + 原子写
    let locationsTable = { version: 1, locations: {} }
    if (fs.existsSync(locationsPath)) {
      const parsed = readJsonFile(locationsPath)
      if (parsed && typeof parsed === 'object' && parsed.locations && typeof parsed.locations === 'object') {
        locationsTable = { version: 1, locations: { ...parsed.locations } }
      }
    }
    locationsTable.locations[pid] = target
    writeAtomic(locationsPath, `${JSON.stringify(locationsTable, null, 2)}\n`)
    console.log(`[migrate] 位置表已更新: ${locationsPath}`)

    // 注册表 location 字段
    project.location = target
    writeAtomic(registryPath, `${JSON.stringify(registry, null, 2)}\n`)
    console.log(`[migrate] 注册表已更新: ${registryPath}`)

    // 校验
    const targetEntries = fs.readdirSync(target)
    if (targetEntries.length === 0) throw new Error(`目标目录为空: ${target}`)
    const hasScriptStore = ['剧本.json', 'script.json'].some((n) => fs.existsSync(path.join(target, n)));
    if (!hasScriptStore && !fs.existsSync(path.join(target, 'director.json'))) {
      throw new Error(`目标目录缺少 剧本.json(script.json) / director.json: ${target}`)
    }
    if (fs.existsSync(src)) throw new Error(`源目录仍存在: ${src}`)
    readJsonFile(locationsPath)
    readJsonFile(registryPath)
    console.log('[migrate] 校验通过: 目标数据完整、源已清空、两份 JSON 回读合法。')
  } catch (error) {
    rollback(error instanceof Error ? error.message : String(error))
    fail('迁移未完成(已回滚)。')
  }

  console.log(`[migrate] 迁移成功: 「${opts.projectName}」现位于 ${target}`)
  console.log('[migrate] 下一步: 启动新版应用,确认项目可打开、分镜/时间线数据完整。')
}

try {
  main()
} catch (error) {
  fail(error instanceof Error ? error.message : String(error))
}
