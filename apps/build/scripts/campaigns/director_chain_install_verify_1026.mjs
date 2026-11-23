// Task-scoped offline installed-bundle verification; no app launch or API calls.
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import * as asar from '@electron/asar';
import ts from 'typescript';
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const research = path.join(repo, '.trellis/tasks/10-25-daojie-director-rule-conflict-validation/research');
const load = file => JSON.parse(readFileSync(file, 'utf8'));
const hash = data => createHash('sha256').update(data).digest('hex');
const installed = load(path.join(research, 'installed-asar-path.json')).archive;
const release = path.join(repo, 'apps/release/build/mac-arm64');
const apps = [];
function locate(dir, depth) {
  for (const item of readdirSync(dir, { withFileTypes: true })) {
    if (!item.isDirectory()) continue;
    const file = path.join(dir, item.name);
    if (item.name.endsWith('.app')) apps.push(path.join(file, 'Contents/Resources/app.asar'));
    else if (depth < 2) locate(file, depth + 1);
  }
}
locate(release, 0);
if (apps.length !== 1 || !existsSync(apps[0])) throw new Error('Expected one packaged app archive');
const installedSha256 = hash(readFileSync(installed));
const packagedSha256 = hash(readFileSync(apps[0]));
const strings = new Set();
const jsFiles = asar.listPackage(installed).filter(file => file.startsWith('/out/renderer/') && file.endsWith('.js'));
for (const file of jsFiles) {
  const source = ts.createSourceFile(file, asar.extractFile(installed, file.slice(1)).toString('utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  function visit(node) {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) strings.add(node.text);
    ts.forEachChild(node, visit);
  }
  visit(source);
}
const manualFiles = load(path.join(research, 'model-comparison/chain-v10/manuals.json'));
const manualChecks = manualFiles.map(file => ({ relativePath: file.relativePath, sha256: hash(file.content), exactBundledLiteral: strings.has(file.content) }));
const markers = ['道劫原文保真边界', '审核协议无效、维度缺失或阶段不符', '道劫规划未通过原文审核', '道劫分镜未通过原文审核', '审核期间项目、原文或剧本已更新', '不执行通用自由创作方法', '剧本头部三行或分钟时长格式不合格'];
const markerChecks = markers.map(marker => ({ marker, present: [...strings].some(value => value.includes(marker)) }));
const sourceHashes = load(path.join(research, 'chain-final-production-source-hashes.json'));
const sourceChecks = Object.entries(sourceHashes).map(([file, expected]) => ({ file, expected, current: hash(readFileSync(path.join(repo, file))) }));
const smokeSource = path.join(repo, 'apps/output/automation/desktop-smoke-report.json');
const smoke = load(smokeSource);
const receipt = {
  generatedAt: new Date().toISOString(), archive: installed, packaged: apps[0], installedSha256, packagedSha256,
  smokeGeneratedAt: smoke.generatedAt, smokeOk: smoke.ok, realMediaGeneration: smoke.realMediaGeneration,
  manualChecks, markerChecks, sourceChecks,
  ok: installedSha256 === packagedSha256 && smoke.ok === true && manualChecks.every(x => x.exactBundledLiteral) && markerChecks.every(x => x.present) && sourceChecks.every(x => x.expected === x.current),
  limitation: 'Bundle content and installed UI smoke; actual model calls use production builders/helper offline bridge, not the installed hook. This does not prove full generation quality.',
};
writeFileSync(path.join(research, 'chain-final-installed-content-verification.json'), JSON.stringify(receipt, null, 2) + '\n');
writeFileSync(path.join(research, 'chain-final-installed-smoke-report.json'), JSON.stringify(smoke, null, 2) + '\n');
console.log(JSON.stringify({ ok: receipt.ok, installedSha256, packagedSha256, smokeOk: smoke.ok, manuals: manualChecks.filter(x => x.exactBundledLiteral).length, markers: markerChecks.filter(x => x.present).length }));
if (!receipt.ok) process.exitCode = 1;
