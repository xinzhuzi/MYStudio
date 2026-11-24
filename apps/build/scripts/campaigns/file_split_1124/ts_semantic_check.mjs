#!/usr/bin/env node
// ts_semantic_check.mjs —— 不受他链在途坏文件影响的语义类型检查(2026-11-24 超线文件拆分)。
//
//   node build/scripts/campaigns/file_split_1124/ts_semantic_check.mjs [--stub <相对 apps/frontend 的文件>]… [--only <路径片段>]…
//       在 apps/ 下运行。
// 背景:`tsc` 只要在全树任何地方遇到语法错误,就只报语法错、不再做语义检查——
//       别的会话的在途文件一旦写坏,本役文件的「0 错」就只等于语法正确。
// 做法:按前端 tsconfig 建编译程序;--stub 指定的文件在内存里换成空模块(盘上内容不动),
//       然后取全程序的诊断(语法+语义)。只读,不写任何文件。
// 输出:各文件的错误数;--only 给了路径片段时,只把这些片段命中的文件的错误逐条列出(其余文件只计数)。
import ts from "typescript";
import path from "node:path";

const argv = process.argv.slice(2);
const stubs = new Set();
const only = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "--stub") stubs.add(path.resolve("frontend", argv[++i]));
  else if (argv[i] === "--only") only.push(argv[++i]);
  else { console.error("用法见文件头注释"); process.exit(2); }
}

const configPath = path.resolve("frontend/config/tsconfig.json");
const parsed = ts.getParsedCommandLineOfConfigFile(configPath, {}, {
  ...ts.sys,
  onUnRecoverableConfigFileDiagnostic: (d) => { console.error(ts.flattenDiagnosticMessageText(d.messageText, "\n")); process.exit(2); },
});
if (!parsed) { console.error("读不到 tsconfig"); process.exit(2); }

const host = ts.createCompilerHost(parsed.options, true);
const baseGetSourceFile = host.getSourceFile.bind(host);
const stubbed = [];
host.getSourceFile = (fileName, languageVersionOrOptions, onError, shouldCreateNewSourceFile) => {
  const abs = path.resolve(fileName);
  if (stubs.has(abs)) {
    stubbed.push(abs);
    return ts.createSourceFile(fileName, "export {};\n", languageVersionOrOptions, true);
  }
  return baseGetSourceFile(fileName, languageVersionOrOptions, onError, shouldCreateNewSourceFile);
};
// rootNames 里被 stub 的文件之外,凡经 import 进入程序的坏文件同样在 getSourceFile 处被换成空模块
const program = ts.createProgram({ rootNames: parsed.fileNames, options: parsed.options, host });
for (const s of stubs) if (!stubbed.includes(s)) console.error(`(注意:stub 文件未进入程序: ${s})`);

const diags = ts.getPreEmitDiagnostics(program);
const byFile = new Map();
for (const d of diags) {
  const file = d.file ? path.relative(process.cwd(), d.file.fileName) : "(全局)";
  if (!byFile.has(file)) byFile.set(file, []);
  byFile.get(file).push(d);
}
const mine = (file) => only.length === 0 || only.some((frag) => file.includes(frag));
const mineTotal = [...byFile.entries()].filter(([f]) => mine(f)).reduce((n, [, l]) => n + l.length, 0);
console.log(`诊断总数 ${diags.length};命中 --only 的 ${mineTotal}`);
for (const [file, list] of [...byFile.entries()].sort()) {
  console.log(`${mine(file) ? "▶" : " "} ${String(list.length).padStart(4)}  ${file}`);
  if (!mine(file)) continue;
  for (const d of list.slice(0, 40)) {
    const pos = d.file && d.start !== undefined ? d.file.getLineAndCharacterOfPosition(d.start) : null;
    console.log(`      ${pos ? `${pos.line + 1}:${pos.character + 1} ` : ""}${ts.DiagnosticCategory[d.category]} ${d.code != null ? `TS${d.code} ` : ""}${ts.flattenDiagnosticMessageText(d.messageText, " ")}`);
  }
  if (list.length > 40) console.log(`      …另 ${list.length - 40} 条`);
}
process.exit(mineTotal === 0 ? 0 : 1);
