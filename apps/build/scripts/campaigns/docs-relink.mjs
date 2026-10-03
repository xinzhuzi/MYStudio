// docs 链接全量重写脚本
// 用法: node apps/build/scripts/docs-relink.mjs --dry-run | --write | --check
//
// 原理：
// 1. 扫描 docs/ 下所有 *.md 文件的当前位置，构建 basename->真实路径 索引
// 2. 遍历所有 md（docs/ + 根 README.md + README_EN.md + apps/backend/README.md）
// 3. 对每个 markdown 链接 [text](path)：
//    - 跳过 http(s)://, mailto:, #anchor, 纯锚点, 非md非目录路径
//    - 解析链接 target 相对于当前文件的磁盘路径
//    - 如果 target 指向一个 .md 文件，查找它现在的新位置
//    - 用 path.relative(当前文件目录, 新位置) 重写
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join, dirname, resolve, relative, basename, extname, normalize } from 'path';

const root = process.cwd();
const mode = process.argv[2] || '--dry-run';

// === 构建 basename -> 真实路径 索引（移动后的新位置）===
function walkDir(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name.startsWith('.') && name !== '.') continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      // 跳过 node_modules
      if (name === 'node_modules') continue;
      walkDir(full, out);
    } else if (name.endsWith('.md')) {
      out.push(full);
    }
  }
  return out;
}

const allDocsMd = walkDir(join(root, 'docs'));
// 额外索引：仓库根目录的非 docs 文件（LICENSE, COMMERCIAL_LICENSE.md 等）
// 这些文件可能被 docs 内文档引用，文件移动后相对路径会变
const rootExtraFiles = [
  join(root, 'LICENSE'),
  join(root, 'COMMERCIAL_LICENSE.md'),
  join(root, 'CONTRIBUTING.md'),
  join(root, 'CODE_OF_CONDUCT.md'),
  join(root, 'README.md'),
  join(root, 'README_EN.md'),
].filter(f => existsSync(f));

// basename -> 真实绝对路径（新位置）
// 处理 basename 冲突：用完整相对路径做二级索引
const basenameIndex = new Map();
const basenameConflicts = new Map(); // bn -> [paths]
// 用 pathKey（相对 docs 根的路径 + basename）做精确匹配
const pathIndex = new Map(); // 磁盘路径 -> basename

function indexFile(f) {
  const bn = basename(f);
  if (basenameIndex.has(bn)) {
    if (!basenameConflicts.has(bn)) {
      basenameConflicts.set(bn, [basenameIndex.get(bn)]);
    }
    basenameConflicts.get(bn).push(f);
  }
  basenameIndex.set(bn, f);
  pathIndex.set(normalize(f), bn);
}

for (const f of allDocsMd) indexFile(f);
// 根目录文件也加入索引（用不带扩展名的 basename 也建条目，如 LICENSE）
for (const f of rootExtraFiles) indexFile(f);

if (basenameConflicts.size) {
  console.log(`ℹ️ basename 冲突（将用路径上下文消歧）:`);
  for (const [bn, paths] of basenameConflicts) {
    console.log(`  ${bn}: ${paths.length} 处`);
  }
}

// === vendored 第三方 README 快照范围排除(2026-09-29,09-28 任务 AC7 存量红清偿) ===
// docs/prompts/krea2官方/角色设定表/ 混居两类文件:自研文档(README.md/
// X_角色设定图提示词精选.md/Krea官方_* 等,照常检查)与上游 repo 原样拷贝的快照
// (文件名保留上游原名,共 9 件,逐文件白名单如下)。快照内链指向上游库内文件
// (CHANGELOG.md/SKILL.md/README.ja.md/assets/*.webp/@GeminiApp mention),本仓无
// 对应实体属快照本性——改写快照正文=破坏第三方快照保真,故重写器整体跳过这些
// 文件:死链不报 + 链接不改写(否则如 [English](README.md) 会被 basename 冲突
// 消歧误重写到仓库根 README.md)。basenameIndex 索引仍含它们,活文档指向快照的
// 链接解析不受影响。
const VENDORED_SNAPSHOT_FILES = new Set([
  'docs/prompts/krea2官方/角色设定表/2_krea2edit引擎件/comfyui-krea2edit-README.md',
  'docs/prompts/krea2官方/角色设定表/2_krea2edit引擎件/comfyui-krea2edit-CHANGELOG.md',
  'docs/prompts/krea2官方/角色设定表/3_通用写法母版/anime-character-sheet-prompter-README.md',
  'docs/prompts/krea2官方/角色设定表/3_通用写法母版/anime-character-sheet-prompter-SKILL.md',
  'docs/prompts/krea2官方/角色设定表/3_通用写法母版/gpt-image-2-character-sheet-README.zh-CN.md',
  'docs/prompts/krea2官方/角色设定表/3_通用写法母版/niji-character-sheet-patterns.md',
  'docs/prompts/krea2官方/角色设定表/4_云端模型参考/Awesome-Nano-Banana-images_README.md',
  'docs/prompts/krea2官方/角色设定表/4_云端模型参考/awesome-nanobanana-pro-README.md',
  'docs/prompts/krea2官方/角色设定表/4_云端模型参考/nanobanana-prompt_README.md',
]);
const isVendoredSnapshot = (f) => VENDORED_SNAPSHOT_FILES.has(relative(root, f));

// === 需要扫描和重写链接的文件 ===
const targets = [
  ...allDocsMd.filter(f => !isVendoredSnapshot(f)),
  join(root, 'README.md'),
  join(root, 'README_EN.md'),
  join(root, 'apps/backend/README.md'),
].filter(f => existsSync(f));

// === 链接正则：匹配 [text](url)，url 不以 http/mailto/# 开头 ===
const linkRe = /(\[([^\]]*)\]\()([^)]+)(\))/g;

let totalLinks = 0;
let rewritten = 0;
let skipped = 0;
let unchanged = 0;
const changes = [];
const unresolved = [];

function rewriteFile(filePath) {
  const text = readFileSync(filePath, 'utf8');
  const fileDir = dirname(filePath);
  let match;
  let fileChanged = false;
  let newText = text;

  // 重置正则 lastIndex（因为用 /g 标志）
  linkRe.lastIndex = 0;
  const localChanges = [];

  while ((match = linkRe.exec(text)) !== null) {
    const [full, prefix, label, rawTarget, suffix] = match;
    let target = rawTarget.trim();

    // 跳过：外部 URL、邮件、纯锚点
    if (/^[a-z][a-z0-9+.-]*:/i.test(target)) { skipped++; continue; }
    if (target.startsWith('mailto:')) { skipped++; continue; }
    if (target.startsWith('#')) { skipped++; continue; }

    // 跳过：非链接形态(2026-09-29,09-28 任务 AC7 存量红清偿;三判据只放行,
    // 不参与重写/死链判定,亦非逐文件豁免——判据通用,防同类新增):
    // 1) @ 开头 = GitHub mention(vendored 快照内 [@GeminiApp](@GeminiApp) 写法);
    // 2) 含裸空格 = 行内注解句——本仓活文档的 `[编号](中文注解)` 标注习惯写法
    //    (如 LoRA库存台账 `[100](换装流 09-19 验证过)`);CommonMark 规定 inline
    //    link 的 destination 含空格必须用 <> 包裹或 %20 编码,裸空格即非合法链接,
    //    此判定与 GitHub 渲染行为一致;
    // 3) 无 `/` 分隔且 basename 无扩展名 = 行号/编号引用等非文件路径形态
    //    (如 Qwen 实录 `[0,1](L141)`、漫影工作流清单 `[163](头句+装配全文+尾句,…)`)。
    if (target.startsWith('@')) { skipped++; continue; }
    if (/\s/.test(target)) { skipped++; continue; }
    if (!target.includes('/') && !basename(target).includes('.')) { skipped++; continue; }

    totalLinks++;

    // 去掉锚点部分
    const hashIdx = target.indexOf('#');
    let hash = '';
    if (hashIdx >= 0) {
      hash = target.slice(hashIdx);
      target = target.slice(0, hashIdx);
    }
    if (!target) { continue; } // 纯锚点如 (#xxx)

    // 解析 target 的磁盘绝对路径
    const resolvedTarget = resolve(fileDir, target);

    // A current, resolvable relative link is authoritative even when another
    // document shares its basename in the relocation index.
    if (existsSync(resolvedTarget)) {
      unchanged++;
      continue;
    }

    // 判断 target 是否指向索引中的文件（.md 或根目录文件如 LICENSE）
    let bn = basename(target);
    let decodedBn = bn;
    try { decodedBn = decodeURIComponent(bn); } catch {}

    let newRealPath = basenameIndex.get(decodedBn) || basenameIndex.get(bn);

    // basename 冲突消歧：如果有多个同名文件，优先选择与原解析路径精确匹配的
    const conflictPaths = basenameConflicts.get(decodedBn) || basenameConflicts.get(bn);
    if (conflictPaths && conflictPaths.length > 1) {
      if (conflictPaths.includes(resolvedTarget)) {
        newRealPath = resolvedTarget;
      }
    }

    if (newRealPath) {
      // 检查是否已经是正确路径
      if (normalize(resolvedTarget) === normalize(newRealPath)) {
        unchanged++;
        continue;
      }
      // 计算新的相对路径
      const newRel = relative(fileDir, newRealPath);
      const newFull = prefix + newRel + hash + suffix;
      localChanges.push({
        old: full,
        new: newFull,
        label,
        oldTarget: rawTarget,
        newTarget: newRel + hash,
      });
      rewritten++;
      fileChanged = true;
    } else {
      // 索引中找不到——检查是否指向 docs 内（真实断链）
      const resolvedRel = relative(join(root, 'docs'), resolvedTarget);
      if (!resolvedRel.startsWith('..') && !existsSync(resolvedTarget)) {
        unresolved.push({ file: filePath, target: rawTarget });
      }
      // 指向 docs 外部且存在的文件视为有效，不报
    }
  }

  if (fileChanged && mode === '--write') {
    // 重新生成文件内容（基于原始 text 应用所有改动）
    let result = text;
    for (const c of localChanges) {
      result = result.replace(c.old, c.new);
    }
    writeFileSync(filePath, result, 'utf8');
  }

  if (localChanges.length) {
    changes.push({ file: filePath, items: localChanges });
  }
}

// 执行
for (const f of targets) {
  rewriteFile(f);
}

// 报告
console.log(`扫描文件: ${targets.length}`);
console.log(`检查链接: ${totalLinks}`);
console.log(`已重写: ${rewritten}`);
console.log(`未变(已正确): ${unchanged}`);
console.log(`跳过(外部/锚点): ${skipped}`);
console.log(`无法解析: ${unresolved.length}`);

if (unresolved.length) {
  console.log('\n⚠️ 无法解析的链接（目标可能已删除或路径变化）:');
  for (const u of unresolved) {
    console.log(`  ${relative(root, u.file)} -> ${u.target}`);
  }
}

if (mode === '--dry-run' && changes.length) {
  console.log(`\n--- 改动预览（前 40 条）---`);
  let shown = 0;
  for (const c of changes) {
    for (const item of c.items) {
      if (shown >= 40) { console.log('  ...（更多省略）'); break; }
      console.log(`  ${relative(root, c.file)}:`);
      console.log(`    ${item.oldTarget}  →  ${item.newTarget}`);
      shown++;
    }
    if (shown >= 40) break;
  }
}

if (mode === '--write') {
  console.log('\n✅ 链接已写入');
} else if (mode === '--check') {
  if (unresolved.length === 0) {
    console.log('\n✅ check 通过：无无法解析的链接');
  } else {
    console.log('\n❌ check 失败：存在无法解析的链接');
    process.exit(1);
  }
}
