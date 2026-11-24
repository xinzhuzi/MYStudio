#!/usr/bin/env node
// mcp_verify_move.mjs —— 核对 McpSettingsTab 拆分是「原样搬移」(2026-11-24 超线文件拆分)。
//
//   node build/scripts/campaigns/file_split_1124/mcp_verify_move.mjs      (在 apps/ 下运行;只读)
//
// 核对一(界面层):把各界面组件文件里的界面文本,按调用关系把子组件调用点拼回去,
//   得到每个大区块的完整文本;它必须在拆分前原文件(HEAD)里逐字节出现且恰一次;
//   再把原文件里这三段换成入口里的调用点,结果必须与现入口的 return 语句逐字节相同。
// 核对二(逻辑层):六个域钩子文件的每一行,除文件头/导入/签名/返回块/镜像回写等
//   少数新增行外,都必须能在原文件里逐字找到(去首尾空白后比较)。
import ts from "typescript";
import fs from "node:fs";
import { execSync } from "node:child_process";

const DIR = "frontend/components/panels/settings/";
const ENTRY = DIR + "McpSettingsTab.tsx";
const old = execSync(`git show HEAD:apps/${ENTRY}`, { encoding: "utf8" });
const must = (cond, msg) => { if (!cond) { console.error(`✗ ${msg}`); process.exit(1); } };

const returnOf = (fileText, fileName, fnName) => {
  const sf = ts.createSourceFile(fileName, fileText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let out = null;
  const visit = (n) => {
    if (ts.isFunctionDeclaration(n) && n.name?.text === fnName && n.body) {
      for (const st of n.body.statements) if (ts.isReturnStatement(st) && st.expression) out = st.expression.getText(sf);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  must(out, `${fileName}: 找不到 ${fnName} 的 return`);
  // 组件函数的 return 文本 = "(\n<body>\n  )";取出中间的界面文本
  const inner = out.replace(/^\(\n/, "").replace(/\n  \)$/, "");
  return inner;
};
const exportedFunctions = (fileText, fileName) => {
  const sf = ts.createSourceFile(fileName, fileText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  return sf.statements.filter((s) => ts.isFunctionDeclaration(s) && s.name).map((s) => s.name.text);
};

// ---------- 界面层 ----------
const UI_FILES = ["McpDeviceForms.tsx", "McpSshForms.tsx", "McpEngineSyncSection.tsx", "McpTorchUpgradeSection.tsx",
  "McpRemoteEngineSection.tsx", "McpSshConnectionsSection.tsx", "McpSettingsDialogs.tsx"];
const bodies = new Map(); // 组件名 → { raw, wrapped }
for (const f of UI_FILES) {
  const t = fs.readFileSync(DIR + f, "utf8");
  for (const name of exportedFunctions(t, f)) {
    const inner = returnOf(t, f, name);
    const wrapped = inner.startsWith("    <>\n") && inner.endsWith("\n    </>");
    bodies.set(name, { raw: wrapped ? inner.slice("    <>\n".length, -"\n    </>".length) : inner, wrapped });
  }
}
// 展开调用点:用语法树精确定位「标签名是已知子组件」的自闭合元素(正则会把成对标签
// 一路吞到后面的 />,把中间的调用点一并吞掉——首版核对脚本就栽在这里),从后往前原位换回子组件文本
const expand = (name) => {
  const { raw } = bodies.get(name);
  const PREFIX = "const __x = (\n"; // 语法树位置相对这份临时源码,切正文要减去前缀长度
  const sf = ts.createSourceFile("expand.tsx", `${PREFIX}${raw}\n);`, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const hits = [];
  const visit = (n) => {
    if (ts.isJsxSelfClosingElement(n)) {
      const tag = n.tagName.getText(sf);
      if (tag !== name && bodies.has(tag)) hits.push({ tag, start: n.getStart(sf) - PREFIX.length, end: n.getEnd() - PREFIX.length });
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  let out = raw;
  for (const h of hits.sort((a, b) => b.start - a.start)) out = out.slice(0, h.start) + expand(h.tag) + out.slice(h.end);
  return out;
};
const sections = ["McpRemoteEngineSection", "McpSshConnectionsSection", "McpSettingsDialogs"];
const occurrences = (hay, needle) => hay.split(needle).length - 1;
let reconstructed = old;
const ranges = [];
for (const name of sections) {
  const full = expand(name);
  const count = occurrences(old, full);
  must(count === 1, `${name} 拼回后的完整文本在原文件中出现 ${count} 次(应恰 1 次)`);
  const at = old.indexOf(full);
  ranges.push({ name, at, len: full.length });
  console.log(`  ✓ ${name}: ${full.split("\n").length} 行界面文本,与原文件逐字节一致`);
}
// 原文件三段 → 入口调用点
const entryNow = fs.readFileSync(ENTRY, "utf8");
const entryReturn = returnOf(entryNow, "McpSettingsTab.tsx", "McpSettingsTab");
for (const { name, at, len } of ranges.sort((a, b) => b.at - a.at)) {
  const m = entryReturn.match(new RegExp(`[ ]*<${name}\\n(?:[^\\n]*\\n)*?[ ]*\\/>`));
  must(m, `入口 return 里找不到 ${name} 的调用点`);
  const call = m[0];
  // 调用点缩进 = 原区块在原文件里的行首缩进;比较时把两者都去掉行首缩进差异
  const oldIndent = old.slice(old.lastIndexOf("\n", at) + 1, at);
  must(call.startsWith(oldIndent + `<${name}`), `${name} 调用点缩进与原区块不一致`);
  reconstructed = reconstructed.slice(0, at) + call.slice(oldIndent.length) + reconstructed.slice(at + len);
}
const oldReturn = returnOf(old, "orig.tsx", "McpSettingsTab");
const newReturnWithOld = returnOf(reconstructed, "recon.tsx", "McpSettingsTab");
must(newReturnWithOld === entryReturn, "入口 return 与「原界面三段换成调用点」的结果不一致");
console.log(`  ✓ 入口 return:与「原界面 + 三处调用点」逐字节一致(${entryReturn.split("\n").length} 行)`);
console.log(`  ✓ 原 return ${oldReturn.split("\n").length} 行 → 现 ${entryReturn.split("\n").length} 行`);

// ---------- 逻辑层 ----------
const oldLines = new Set(old.split("\n").map((l) => l.trim()));
for (const f of ["use-mcp-server-admin.ts", "use-remote-engine-admin.ts", "use-ssh-admin.ts", "use-engine-sync-admin.ts",
  "use-torch-upgrade-admin.ts", "use-engine-family-workflows.ts", "McpSettingsParts.tsx"]) {
  const lines = fs.readFileSync(DIR + f, "utf8").split("\n").map((l) => l.trim()).filter(Boolean);
  const fresh = lines.filter((l) => !oldLines.has(l));
  console.log(`  · ${f}: ${lines.length} 行,其中 ${fresh.length} 行不在原文件里`);
  for (const l of fresh) console.log(`        + ${l.slice(0, 130)}`);
}
