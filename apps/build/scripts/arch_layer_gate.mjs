#!/usr/bin/env node
/**
 * arch_layer_gate.mjs —— 前端分层与入口可达性门禁(只减不增基线)。
 *
 * 取代 architecture_coupling_audit.py 里正则实现的前端分层段(design.md 2.7)。流水线六步:
 *   1. 枚举 apps/frontend 下全部 .ts 与 .tsx(排除 node_modules、out、release、.vite 与隐藏目录)。
 *   2. 解析模块说明符:tsconfig.json 的 paths(含 aitoearn 兼容别名)、相对路径、扩展名探测;
 *      其余裸包名记为外部依赖,不入图。
 *   3. 边分类:静态 import 与 export-from、动态 import()、new Worker(new URL(...));
 *      import type / export type 记为仅类型边。
 *   4. 分层规则全集(八条禁止边,见 RULES)。
 *   5. 入口可达性:自 8 个构建入口沿运行时边遍历。
 *   6. 对照基线 arch-layer-gate-baseline.json:新增越层边或新增不可达文件即退出码 1,逐条列名;
 *      只减不增;基线缺失也退出码 1。
 *
 * 用法:node apps/build/scripts/arch_layer_gate.mjs [--root <前端根>] [--update-baseline] [--json]
 * 退出码:0 没有新增;1 有新增、基线缺失或无法解析、没有任何入口;2 参数错误或运行环境读不到。
 *
 * 路径推导(带 --root 时整组随根平移,所以夹具可以整棵住在临时目录里):
 *   扫描根   apps/frontend                        ← --root
 *   tsconfig apps/frontend/config/tsconfig.json   (根下 tsconfig.json 存在时优先用它)
 *   基线     apps/build/scripts/arch-layer-gate-baseline.json(只有 --update-baseline 写它)
 *   报告     apps/output/automation/arch-layer-gate-report.json(gitignored)
 *
 * 口径说明:
 *   - 解析是语法级的:import type、export type 与全由 type 修饰的具名导入记仅类型边,其余 import
 *     一律记运行时边,不借助类型检查器判断「只当类型用」。
 *   - 测试文件(*.test.*、*.spec.* 与 __tests__/__fixtures__/__mocks__ 下的文件)和 .d.ts 不参与
 *     分层判定,也不列为不可达;不可达只数生产源文件。
 *   - 不可达条目的 kind:type-only 表示连仅类型边一起算才到得了;none 表示两种口径都到不了。
 *   - import.meta.glob 与字符串拼出来的路径不在语法级解析的视野内,靠它们加载的文件会被记成
 *     不可达,由基线收账。
 */
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..', '..', '..')
const DEFAULT_ROOT = path.join(REPO_ROOT, 'apps', 'frontend')
const BASELINE_NAME = 'arch-layer-gate-baseline.json'
const REPORT_NAME = 'arch-layer-gate-report.json'
const SCRIPT_COMMAND = 'node apps/build/scripts/arch_layer_gate.mjs'
const USAGE = `${SCRIPT_COMMAND} [--root <前端根>] [--update-baseline] [--json]`

// 8 个构建入口。前 5 个对应 apps/frontend/config/electron-vite.config.ts 里 main(4 个)与 preload(1 个)
// 两个输入块;main.tsx 由 renderer/index.html 加载;末两个是 Remotion 侧的入口。
// electron-vite.config.ts 增删输入时这里必须同步,否则可达性失真。
const ENTRIES = [
  'electron/main/main.ts',
  'electron/rendering/plugins/remotion/browser/remotion-browser-worker.ts',
  'electron/rendering/plugins/remotion/renderer/remotion-render-worker-entry.ts',
  'electron/rendering/plugins/hyperframes/hyperframes-worker.ts',
  'electron/preload/preload.ts',
  'main.tsx',
  'electron/rendering/plugins/remotion/composition/entry.tsx',
  'electron/rendering/plugins/remotion/studio/chapter-studio-projection.ts',
]

// 八条禁止边(取自 .trellis/spec/frontend/directory-structure.md 的分层依赖规则)。
// from 是引用方所在的层,layers 是被引方路径所在的层(见 layerOf),packages 是被引方的外部包名。
const ANY_COMPONENTS = ['panels', 'features', 'ui', 'components']
const RULES = [
  { id: 'ui->panels|features', from: 'ui', layers: ['panels', 'features'] },
  { id: 'features->panels', from: 'features', layers: ['panels'] },
  { id: 'hooks->components', from: 'hooks', layers: ANY_COMPONENTS },
  { id: 'lib->components', from: 'lib', layers: ANY_COMPONENTS },
  { id: 'lib->hooks', from: 'lib', layers: ['hooks'] },
  { id: 'lib->react', from: 'lib', packages: ['react', 'react-dom'] },
  { id: 'stores->components|hooks', from: 'stores', layers: [...ANY_COMPONENTS, 'hooks'] },
  { id: 'electron->stores|components', from: 'electron', layers: ['stores', ...ANY_COMPONENTS] },
].map((rule) => ({
  ...rule,
  layers: rule.layers ? new Set(rule.layers) : undefined,
  packages: rule.packages ? new Set(rule.packages) : undefined,
}))

const SOURCE_EXTENSIONS = /\.(ts|tsx)$/
const RESOLVE_EXTENSIONS = ['.ts', '.tsx', '.d.ts']
const SKIP_DIRS = new Set(['node_modules', 'out', 'release', '.vite'])
const TEST_FILE_RE = /\.(test|spec)\.tsx?$/
const TEST_DIR_SEGMENTS = new Set(['__tests__', '__fixtures__', '__mocks__'])

class UsageError extends Error {}
class SetupError extends Error {}

const compareStrings = (a, b) => (a < b ? -1 : a > b ? 1 : 0)

// ---------------------------------------------------------------------------
// 命令行与运行环境
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  /** @type {{ root: string | null, updateBaseline: boolean, json: boolean }} */
  const options = { root: null, updateBaseline: false, json: false }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--root') {
      const value = argv[i + 1]
      if (!value || value.startsWith('--')) throw new UsageError('--root 后面要跟一个目录')
      options.root = path.resolve(value)
      i += 1
    } else if (arg === '--update-baseline') {
      options.updateBaseline = true
    } else if (arg === '--json') {
      options.json = true
    } else {
      throw new UsageError(`未知参数:${arg}`)
    }
  }
  return options
}

function derivePaths(root) {
  const appsDir = path.resolve(root, '..')
  return {
    root,
    baselinePath: path.join(appsDir, 'build', 'scripts', BASELINE_NAME),
    reportPath: path.join(appsDir, 'output', 'automation', REPORT_NAME),
  }
}

// 解析器从 apps/node_modules 加载 typescript,不新增依赖。
function loadTypescript() {
  const requireFromApps = createRequire(path.join(REPO_ROOT, 'apps', 'package.json'))
  try {
    return requireFromApps('typescript')
  } catch (error) {
    throw new SetupError(`无法从 apps/node_modules 加载 typescript:${error.message}`)
  }
}

// ---------------------------------------------------------------------------
// 步骤 1:枚举与归类
// ---------------------------------------------------------------------------

function toPosix(value) {
  return value.split(path.sep).join('/')
}

function listSourceFiles(root) {
  const files = []
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      // 隐藏条目(会话草稿目录、缓存、.DS_Store)不是构建输入
      if (entry.name.startsWith('.')) continue
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) walk(path.join(dir, entry.name))
      } else if (entry.isFile() && SOURCE_EXTENSIONS.test(entry.name)) {
        files.push(toPosix(path.relative(root, path.join(dir, entry.name))))
      }
    }
  }
  walk(root)
  return files.sort(compareStrings)
}

function classifyFile(rel) {
  if (rel.endsWith('.d.ts')) return 'd.ts'
  if (TEST_FILE_RE.test(rel) || rel.split('/').some((segment) => TEST_DIR_SEGMENTS.has(segment))) {
    return 'test'
  }
  return 'source'
}

// ---------------------------------------------------------------------------
// 步骤 2:说明符解析
// ---------------------------------------------------------------------------

function loadTsconfig(ts, root) {
  const candidates = [path.join(root, 'tsconfig.json'), path.join(root, 'config', 'tsconfig.json')]
  const tsconfigPath = candidates.find((candidate) => fs.existsSync(candidate))
  if (!tsconfigPath) throw new SetupError(`找不到 tsconfig.json(依次找过:${candidates.join('、')})`)
  const read = ts.readConfigFile(tsconfigPath, ts.sys.readFile)
  if (read.error) {
    throw new SetupError(`tsconfig 解析失败:${ts.flattenDiagnosticMessageText(read.error.messageText, ' ')}`)
  }
  const compilerOptions = read.config?.compilerOptions ?? {}
  // baseUrl 已弃用:给出时仍以它为基,否则 paths 相对 tsconfig 所在目录解析
  const baseUrl = typeof compilerOptions.baseUrl === 'string'
    ? path.resolve(path.dirname(tsconfigPath), compilerOptions.baseUrl)
    : path.dirname(tsconfigPath)
  return { tsconfigPath, baseUrl, paths: compilerOptions.paths ?? {} }
}

// 返回通配符捕获到的部分;不匹配返回 null(整串匹配且无通配符时返回空串)
function matchAliasPattern(pattern, specifier) {
  if (pattern.starIndex === -1) return specifier === pattern.text ? '' : null
  const { prefix, suffix } = pattern
  if (!specifier.startsWith(prefix) || !specifier.endsWith(suffix)) return null
  if (specifier.length < prefix.length + suffix.length) return null
  return specifier.slice(prefix.length, specifier.length - suffix.length)
}

function createAliasResolver(paths) {
  const patterns = Object.entries(paths).map(([text, targets]) => {
    const starIndex = text.indexOf('*')
    return {
      text,
      targets: Array.isArray(targets) ? targets : [targets],
      starIndex,
      prefix: starIndex === -1 ? text : text.slice(0, starIndex),
      suffix: starIndex === -1 ? '' : text.slice(starIndex + 1),
    }
  })
  return (specifier) => {
    let best = null
    for (const pattern of patterns) {
      const wildcard = matchAliasPattern(pattern, specifier)
      if (wildcard === null) continue
      if (!best || pattern.prefix.length > best.pattern.prefix.length) best = { pattern, wildcard }
    }
    if (!best) return null
    // TypeScript 只替换目标里的第一个 *
    return best.pattern.targets.map((target) => target.replace('*', best.wildcard))
  }
}

function packageName(specifier) {
  return specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0]
}

// 扩展名探测:原样、.ts/.tsx/.d.ts、再目录下的 index
function resolveAsFile(relWithoutExt, fileSet) {
  if (RESOLVE_EXTENSIONS.some((ext) => relWithoutExt.endsWith(ext)) && fileSet.has(relWithoutExt)) {
    return relWithoutExt
  }
  for (const ext of RESOLVE_EXTENSIONS) {
    if (fileSet.has(relWithoutExt + ext)) return relWithoutExt + ext
  }
  for (const ext of RESOLVE_EXTENSIONS) {
    const indexFile = `${relWithoutExt}/index${ext}`
    if (fileSet.has(indexFile)) return indexFile
  }
  return null
}

// 返回 { pkg, specifier, targetRel, targetFile },路径一律相对扫描根。
// 裸包名(没有命中 paths)的 targetRel 与 targetFile 为 null;targetFile 为 null 而 targetRel 有值,
// 说明说明符指向的不是 .ts/.tsx(样式、图片、JSON 等)或在树里找不到。
function resolveTarget(rawSpecifier, importerRel, context) {
  const specifier = rawSpecifier.split(/[?#]/, 1)[0]
  const pkg = packageName(specifier)
  if (specifier.startsWith('.')) {
    const targetRel = path.posix.normalize(path.posix.join(path.posix.dirname(importerRel), specifier))
    return { pkg, specifier, targetRel, targetFile: resolveAsFile(targetRel, context.fileSet) }
  }
  const candidates = context.alias(specifier)
  if (!candidates) return { pkg, specifier, targetRel: null, targetFile: null }
  let fallbackRel = null
  for (const candidate of candidates) {
    const rel = toPosix(path.relative(context.root, path.resolve(context.baseUrl, candidate)))
    const targetFile = resolveAsFile(rel, context.fileSet)
    if (targetFile) return { pkg, specifier, targetRel: rel, targetFile }
    if (!fallbackRel) fallbackRel = rel
  }
  return { pkg, specifier, targetRel: fallbackRel, targetFile: null }
}

// ---------------------------------------------------------------------------
// 步骤 3:边分类
// ---------------------------------------------------------------------------

// 返回 collectReferences(rel, text):按源码顺序列出该文件的全部模块引用 { spec, line, kind },
// kind 取 static(import、export-from)、dynamic(import())、worker(new Worker(new URL(...)))、type。
function createReferenceCollector(ts) {
  const literalText = (node) => {
    if (!node) return null
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text
    return null
  }

  const isImportMetaUrl = (node) => !!node
    && ts.isPropertyAccessExpression(node)
    && node.name.text === 'url'
    && ts.isMetaProperty(node.expression)
    // keywordToken 区分 import.meta 与 new.target
    && node.expression.keywordToken === ts.SyntaxKind.ImportKeyword

  // 默认导入、命名空间导入与空的具名导入都算运行时边
  const isTypeOnlyImportClause = (clause) => {
    if (clause.isTypeOnly) return true
    if (clause.name) return false
    if (!clause.namedBindings || !ts.isNamedImports(clause.namedBindings)) return false
    const { elements } = clause.namedBindings
    return elements.length > 0 && elements.every((element) => element.isTypeOnly)
  }

  const isTypeOnlyExportDeclaration = (declaration) => {
    if (declaration.isTypeOnly) return true
    const clause = declaration.exportClause
    if (!clause || !ts.isNamedExports(clause)) return false
    return clause.elements.length > 0 && clause.elements.every((element) => element.isTypeOnly)
  }

  // new Worker(new URL("<字面量>", import.meta.url)) 的第一个实参;不是这个形态返回 null
  const workerUrlSpecifier = (newExpression) => {
    if (!ts.isIdentifier(newExpression.expression) || newExpression.expression.text !== 'Worker') return null
    const [url] = newExpression.arguments ?? []
    if (!url || !ts.isNewExpression(url)) return null
    if (!ts.isIdentifier(url.expression) || url.expression.text !== 'URL') return null
    const [specifier, base] = url.arguments ?? []
    return isImportMetaUrl(base) ? specifier : null
  }

  return (rel, text) => {
    const scriptKind = rel.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
    const sourceFile = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, false, scriptKind)
    const references = []
    const lineOf = (node) => sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1
    const add = (node, kind) => {
      const spec = literalText(node)
      if (spec !== null) references.push({ spec, line: lineOf(node), kind })
    }
    const visit = (node) => {
      if (ts.isImportDeclaration(node)) {
        const typeOnly = !!node.importClause && isTypeOnlyImportClause(node.importClause)
        add(node.moduleSpecifier, typeOnly ? 'type' : 'static')
        return
      }
      if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
        add(node.moduleSpecifier, isTypeOnlyExportDeclaration(node) ? 'type' : 'static')
        return
      }
      if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        add(node.arguments[0], 'dynamic')
        return
      }
      if (ts.isNewExpression(node)) add(workerUrlSpecifier(node), 'worker')
      if (ts.isImportTypeNode(node)) {
        // typeof import("./x") 与 import("./x").X 这类类型位置的引用
        add(node.argument?.literal, 'type')
        return
      }
      ts.forEachChild(node, visit)
    }
    visit(sourceFile)
    return references
  }
}

// ---------------------------------------------------------------------------
// 步骤 4、5:分层规则与入口可达性
// ---------------------------------------------------------------------------

function layerOf(rel) {
  if (rel.startsWith('components/panels/')) return 'panels'
  if (rel.startsWith('components/features/')) return 'features'
  if (rel.startsWith('components/ui/')) return 'ui'
  if (rel.startsWith('components/')) return 'components'
  if (rel.startsWith('hooks/')) return 'hooks'
  if (rel.startsWith('lib/')) return 'lib'
  if (rel.startsWith('stores/')) return 'stores'
  if (rel.startsWith('types/')) return 'types'
  if (rel.startsWith('electron/')) return 'electron'
  return 'other'
}

function reachableFrom(entries, adjacency) {
  const seen = new Set()
  const queue = [...entries]
  while (queue.length > 0) {
    const file = queue.pop()
    if (seen.has(file)) continue
    seen.add(file)
    for (const next of adjacency.get(file) ?? []) {
      if (!seen.has(next)) queue.push(next)
    }
  }
  return seen
}

function addToGraph(graph, from, to) {
  if (!graph.has(from)) graph.set(from, new Set())
  graph.get(from).add(to)
}

function analyze(ts, root) {
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    throw new SetupError(`扫描根不是目录:${root}`)
  }
  const tsconfig = loadTsconfig(ts, root)
  const allFiles = listSourceFiles(root)
  const fileSet = new Set(allFiles)
  const files = { total: allFiles.length, source: 0, test: 0, dts: 0 }
  const sourceFiles = []
  for (const rel of allFiles) {
    const kind = classifyFile(rel)
    if (kind === 'source') {
      files.source += 1
      sourceFiles.push(rel)
    } else if (kind === 'test') {
      files.test += 1
    } else {
      files.dts += 1
    }
  }

  const context = { root, baseUrl: tsconfig.baseUrl, alias: createAliasResolver(tsconfig.paths), fileSet }
  const collectReferences = createReferenceCollector(ts)
  const runtimeEdges = new Map()
  const typeEdges = new Map()
  const anyEdges = new Map()
  const externals = new Set()
  const unresolved = []
  const layerEdges = new Map()
  const rulesByLayer = new Map()
  for (const rule of RULES) {
    if (!rulesByLayer.has(rule.from)) rulesByLayer.set(rule.from, [])
    rulesByLayer.get(rule.from).push(rule)
  }

  for (const rel of sourceFiles) {
    const text = fs.readFileSync(path.join(root, rel), 'utf8')
    const rules = rulesByLayer.get(layerOf(rel)) ?? []
    for (const reference of collectReferences(rel, text)) {
      const target = resolveTarget(reference.spec, rel, context)
      if (target.targetFile) {
        const graph = reference.kind === 'type' ? typeEdges : runtimeEdges
        addToGraph(graph, rel, target.targetFile)
        addToGraph(anyEdges, rel, target.targetFile)
      } else if (target.targetRel) {
        const moduleLike = !/\.[a-z0-9]+$/i.test(target.specifier)
          || RESOLVE_EXTENSIONS.some((ext) => target.specifier.endsWith(ext))
        if (moduleLike) unresolved.push({ from: rel, line: reference.line, specifier: reference.spec })
      } else {
        externals.add(target.pkg)
      }
      const to = target.targetFile ?? target.targetRel ?? target.pkg
      for (const rule of rules) {
        const hit = rule.packages?.has(target.pkg)
          || (target.targetRel !== null && rule.layers?.has(layerOf(target.targetRel)))
        if (!hit) continue
        const key = `${rel}|${to}|${rule.id}`
        const previous = layerEdges.get(key)
        if (!previous || (previous.kind === 'type' && reference.kind !== 'type')) {
          layerEdges.set(key, { from: rel, line: reference.line, to, kind: reference.kind, rule: rule.id })
        }
      }
    }
  }

  const entries = ENTRIES.filter((entry) => fileSet.has(entry))
  const missingEntries = ENTRIES.filter((entry) => !fileSet.has(entry))
  const reachedRuntime = reachableFrom(entries, runtimeEdges)
  const reachedAny = reachableFrom(entries, anyEdges)
  const unreachable = sourceFiles
    .filter((rel) => !reachedRuntime.has(rel))
    .map((rel) => ({ file: rel, kind: reachedAny.has(rel) ? 'type-only' : 'none' }))

  const compareEdges = (a, b) => compareStrings(a.from, b.from) || a.line - b.line || compareStrings(a.to, b.to) || compareStrings(a.rule, b.rule)
  return {
    tsconfigPath: tsconfig.tsconfigPath,
    files,
    entries,
    missingEntries,
    layerEdges: [...layerEdges.values()].sort(compareEdges),
    unreachable,
    externals: [...externals].sort(compareStrings),
    unresolved: unresolved.sort((a, b) => compareStrings(a.from, b.from) || a.line - b.line),
  }
}

// ---------------------------------------------------------------------------
// 步骤 6:基线与对照
// ---------------------------------------------------------------------------

const edgeKey = (edge) => `${edge.from}|${edge.to}|${edge.rule}`

function readBaseline(baselinePath) {
  if (!fs.existsSync(baselinePath)) return { status: 'missing' }
  let data
  try {
    data = JSON.parse(fs.readFileSync(baselinePath, 'utf8'))
  } catch {
    return { status: 'corrupt' }
  }
  const isEdge = (edge) => !!edge && typeof edge.from === 'string' && typeof edge.to === 'string' && typeof edge.rule === 'string'
  const isFile = (item) => !!item && typeof item.file === 'string'
  const shapeOk = !!data
    && Array.isArray(data.layerEdges) && data.layerEdges.every(isEdge)
    && Array.isArray(data.unreachable) && data.unreachable.every(isFile)
  return shapeOk ? { status: 'ok', data } : { status: 'corrupt' }
}

// 只减不增:现势里有、基线里没有的逐条列出;基线里有、现势里没有的只计数。
// 边的身份取 (from, to, rule),行号与 kind 只作定位信息,不参与比较。
function diffAgainst(current, baselineData) {
  const baselineEdges = new Set(baselineData.layerEdges.map(edgeKey))
  const baselineFiles = new Set(baselineData.unreachable.map((item) => item.file))
  const currentEdges = new Set(current.layerEdges.map(edgeKey))
  const currentFiles = new Set(current.unreachable.map((item) => item.file))
  return {
    newLayerEdges: current.layerEdges.filter((edge) => !baselineEdges.has(edgeKey(edge))),
    newUnreachable: current.unreachable.filter((item) => !baselineFiles.has(item.file)),
    removedLayerEdges: [...baselineEdges].filter((key) => !currentEdges.has(key)).length,
    removedUnreachable: [...baselineFiles].filter((file) => !currentFiles.has(file)).length,
  }
}

function writeReport(reportPath, report) {
  try {
    fs.mkdirSync(path.dirname(reportPath), { recursive: true })
    fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`)
    return true
  } catch (error) {
    console.error(`警告:报告写不进 ${reportPath}:${error.message}`)
    return false
  }
}

function formatAdditions(diff) {
  const lines = []
  if (diff.newLayerEdges.length > 0) {
    lines.push(`新增越层边(${diff.newLayerEdges.length}):`)
    for (const edge of diff.newLayerEdges) lines.push(`  - ${edge.from}:${edge.line} → ${edge.to}  [${edge.rule}]  ${edge.kind}`)
  }
  if (diff.newUnreachable.length > 0) {
    lines.push(`新增不可达文件(${diff.newUnreachable.length}):`)
    for (const item of diff.newUnreachable) lines.push(`  - ${item.file}  [${item.kind}]`)
  }
  return lines
}

function run(options) {
  const paths = derivePaths(options.root ?? DEFAULT_ROOT)
  const analysis = analyze(loadTypescript(), paths.root)
  if (analysis.entries.length === 0) {
    return {
      code: 1,
      lines: [
        `没有任何入口存在:配置的 ${ENTRIES.length} 个入口在 ${paths.root} 下全部缺失`,
        '结论: 不通过(没有任何入口)',
      ],
    }
  }
  const current = {
    entries: analysis.entries,
    layerEdges: analysis.layerEdges,
    unreachable: analysis.unreachable,
  }
  const generatedAt = new Date().toISOString()
  const displayRoot = options.root ?? toPosix(path.relative(REPO_ROOT, paths.root))
  const reportBase = {
    generatedAt,
    root: displayRoot,
    tsconfig: analysis.tsconfigPath,
    files: analysis.files,
    missingEntries: analysis.missingEntries,
    ...current,
    externals: analysis.externals,
    unresolved: analysis.unresolved,
  }

  if (options.updateBaseline) {
    const previous = readBaseline(paths.baselinePath)
    try {
      fs.mkdirSync(path.dirname(paths.baselinePath), { recursive: true })
      fs.writeFileSync(paths.baselinePath, `${JSON.stringify({ generatedAt, ...current }, null, 2)}\n`)
    } catch (error) {
      return { code: 2, lines: [`基线写不进 ${paths.baselinePath}:${error.message}`] }
    }
    const lines = [
      `基线已写入: ${paths.baselinePath}(入口 ${current.entries.length}、越层边 ${current.layerEdges.length}、不可达 ${current.unreachable.length})`,
    ]
    if (previous.status === 'ok') {
      const additions = formatAdditions(diffAgainst(current, previous.data))
      if (additions.length > 0) {
        lines.push('注意: 新基线比旧基线多出下列条目(口径是只减不增;不是有意放行的话,请先处置再更新):')
        lines.push(...additions)
      }
    }
    lines.push('结论: 基线已更新')
    const report = { ...reportBase, baseline: { path: paths.baselinePath, status: 'written' }, verdict: '基线已更新' }
    writeReport(paths.reportPath, report)
    return { code: 0, lines, report }
  }

  const baseline = readBaseline(paths.baselinePath)
  if (baseline.status !== 'ok') {
    const why = baseline.status === 'missing' ? '基线缺失' : '基线无法解析'
    const rootArgument = options.root ? ` --root ${options.root}` : ''
    return {
      code: 1,
      lines: [
        `${why}: ${paths.baselinePath}`,
        ...(baseline.status === 'corrupt' ? ['要的是含 layerEdges 与 unreachable 两张清单的 JSON。'] : []),
        `请先运行 ${SCRIPT_COMMAND}${rootArgument} --update-baseline 先生成基线,再跑门禁对照。`,
        `现势: 越层边 ${current.layerEdges.length}、不可达 ${current.unreachable.length}。`,
        `结论: 不通过(${why})`,
      ],
    }
  }

  const diff = diffAgainst(current, baseline.data)
  const added = diff.newLayerEdges.length + diff.newUnreachable.length
  const verdict = added === 0 ? '通过(新增 0)' : `不通过(新增 ${added})`
  const report = {
    ...reportBase,
    baseline: {
      path: paths.baselinePath,
      status: 'ok',
      generatedAt: baseline.data.generatedAt ?? null,
      layerEdges: baseline.data.layerEdges.length,
      unreachable: baseline.data.unreachable.length,
    },
    ...diff,
    ok: added === 0,
    verdict,
  }
  writeReport(paths.reportPath, report)

  const lines = [
    'arch-layer-gate',
    `  扫描根: ${displayRoot}`,
    `  入口: ${current.entries.length} 个(配置 ${ENTRIES.length} 个)`,
    `  文件: ${analysis.files.total}(生产 ${analysis.files.source}、测试 ${analysis.files.test}、.d.ts ${analysis.files.dts})`,
    `  越层边: 现势 ${current.layerEdges.length},基线 ${report.baseline.layerEdges},新增 ${diff.newLayerEdges.length}`,
    `  不可达: 现势 ${current.unreachable.length},基线 ${report.baseline.unreachable},新增 ${diff.newUnreachable.length}`,
  ]
  if (analysis.missingEntries.length > 0) lines.push(`  入口不存在,跳过: ${analysis.missingEntries.join('、')}`)
  if (diff.removedLayerEdges > 0 || diff.removedUnreachable > 0) {
    lines.push(`  已减少: 越层边 ${diff.removedLayerEdges}、不可达 ${diff.removedUnreachable}(跑 --update-baseline 收账)`)
  }
  lines.push(...formatAdditions(diff))
  lines.push(`结论: ${verdict}`)
  return { code: added === 0 ? 0 : 1, lines, report }
}

function main(argv) {
  let options
  try {
    options = parseArgs(argv)
  } catch (error) {
    if (!(error instanceof UsageError)) throw error
    console.error(`参数错误:${error.message}`)
    console.error(`用法:${USAGE}`)
    return 2
  }
  let result
  try {
    result = run(options)
  } catch (error) {
    if (!(error instanceof SetupError)) throw error
    console.error(error.message)
    return 2
  }
  if (options.json && result.report) console.log(JSON.stringify(result.report, null, 2))
  else console.log(result.lines.join('\n'))
  return result.code
}

process.exit(main(process.argv.slice(2)))
