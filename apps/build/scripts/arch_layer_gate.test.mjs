// @vitest-environment node
// arch_layer_gate.mjs 的夹具自测(implement.md Task I Step 2)。
// 七条用例全部经命令行这一公共接口(spawnSync 起脚本)断言退出码与输出,不触达脚本内部。
// 夹具布局镜像仓库的 apps/:frontend(扫描根)、build/scripts(基线)、output(报告),
// 整棵夹具住在临时目录里,真实仓库的基线不被测试触碰。
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

const SCRIPT = fileURLToPath(new URL('./arch_layer_gate.mjs', import.meta.url))
const tmpRoots = []

// 只含 @/* 别名的 tsconfig:paths 相对 tsconfig 所在目录解析。
const TSCONFIG = JSON.stringify({ compilerOptions: { paths: { '@/*': ['./*'] } } })

// lib/alpha.ts 的干净形态;越层形态在第 3 行多一条 lib → components 的 import。
const ALPHA_CLEAN = [
  '// 夹具:lib 层模块',
  'import { beta } from "./beta";',
  'export const alpha = `alpha-${beta}`;',
  '',
].join('\n')
const ALPHA_VIOLATING = [
  '// 夹具:lib 层模块',
  'import { beta } from "./beta";',
  'import { Button } from "@/components/ui/button";',
  'export const alpha = `alpha-${beta}`;',
  '',
].join('\n')
const ORPHAN = 'export const orphan = "orphan";\n'

function write(root, relPath, content) {
  const target = path.join(root, relPath)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, content)
}

// 一棵全可达、零越层边的夹具树:入口 electron/main/main.ts 经三个别名 import 到达全部文件。
function fixture() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'mystudio-arch-layer-gate-'))
  tmpRoots.push(base)
  const root = path.join(base, 'frontend')
  write(root, 'tsconfig.json', TSCONFIG)
  write(root, 'electron/main/main.ts', [
    'import "@/lib/alpha";',
    'import "@/components/panels/HomePanel";',
    'import "@/stores/counter-store";',
    '',
  ].join('\n'))
  write(root, 'lib/alpha.ts', ALPHA_CLEAN)
  write(root, 'lib/beta.ts', 'export const beta = "beta";\n')
  write(root, 'components/ui/button.ts', 'export const Button = "button";\n')
  write(root, 'hooks/use-thing.ts', [
    'import { beta } from "@/lib/beta";',
    'export const useThing = () => beta;',
    '',
  ].join('\n'))
  write(root, 'components/panels/HomePanel.tsx', [
    'import { Button } from "@/components/ui/button";',
    'import { useThing } from "@/hooks/use-thing";',
    'export const HomePanel = () => `${Button}-${useThing()}`;',
    '',
  ].join('\n'))
  write(root, 'stores/counter-store.ts', [
    'import { alpha } from "@/lib/alpha";',
    'export const useCounter = () => alpha;',
    '',
  ].join('\n'))
  return root
}

// 起脚本并断言进程确实起来了。root 为 null 时不带 --root,即对真实仓库跑。
function runGate(root, ...args) {
  const argv = root ? ['--root', root, ...args] : args
  const result = spawnSync(process.execPath, [SCRIPT, ...argv], { encoding: 'utf8' })
  expect(result.error, `起脚本失败:${result.error?.message}`).toBeUndefined()
  return result
}

function outputOf(result) {
  return `${result.stdout}\n${result.stderr}`
}

afterEach(() => {
  while (tmpRoots.length) fs.rmSync(tmpRoots.pop(), { recursive: true, force: true })
})

describe('arch_layer_gate', () => {
  it('基线与现树相同时 exit=0', () => {
    const root = fixture()
    expect(runGate(root, '--update-baseline').status).toBe(0)

    const result = runGate(root)

    expect(result.status).toBe(0)
    expect(outputOf(result)).toContain('新增 0')
  })

  it('新增一个没有入口能到的文件时 exit=1,输出含该文件名', () => {
    const root = fixture()
    expect(runGate(root, '--update-baseline').status).toBe(0)
    write(root, 'lib/orphan.ts', ORPHAN)

    const result = runGate(root)

    expect(result.status).toBe(1)
    expect(outputOf(result)).toContain('lib/orphan.ts')
  })

  it('新增一条 lib 指向 components 的 import 时 exit=1,输出含「文件名:行号」', () => {
    const root = fixture()
    expect(runGate(root, '--update-baseline').status).toBe(0)
    write(root, 'lib/alpha.ts', ALPHA_VIOLATING)

    const result = runGate(root)

    expect(result.status).toBe(1)
    expect(outputOf(result)).toContain('lib/alpha.ts:3')
  })

  it('基线里有而现树已没有的边与文件时 exit=0(只减不增)', () => {
    const root = fixture()
    write(root, 'lib/alpha.ts', ALPHA_VIOLATING)
    write(root, 'lib/orphan.ts', ORPHAN)
    expect(runGate(root, '--update-baseline').status).toBe(0)
    write(root, 'lib/alpha.ts', ALPHA_CLEAN)
    fs.rmSync(path.join(root, 'lib/orphan.ts'))

    const result = runGate(root)

    expect(result.status).toBe(0)
    expect(outputOf(result)).toContain('新增 0')
  })

  it('跑过 --update-baseline 之后 exit=0', () => {
    const root = fixture()
    expect(runGate(root, '--update-baseline').status).toBe(0)
    write(root, 'lib/orphan.ts', ORPHAN)
    write(root, 'lib/alpha.ts', ALPHA_VIOLATING)
    expect(runGate(root).status).toBe(1)

    const update = runGate(root, '--update-baseline')
    expect(update.status).toBe(0)

    const result = runGate(root)
    expect(result.status).toBe(0)
  })

  it('基线缺失时 exit=1,输出含「先生成基线」', () => {
    const root = fixture()

    const result = runGate(root)

    expect(result.status).toBe(1)
    expect(outputOf(result)).toContain('先生成基线')
  })

  it('对真实仓库跑一次冒烟 exit=0', { timeout: 180_000 }, () => {
    const result = runGate(null)

    expect(outputOf(result)).toContain('新增 0')
    expect(result.status).toBe(0)
  })
})
