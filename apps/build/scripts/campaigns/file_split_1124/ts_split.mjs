#!/usr/bin/env node
// ts_split.mjs —— 超线文件拆分工具(用 TypeScript 编译器 API;2026-11-24 任务 11-24-apps-architecture-restructure)。
//
//   node build/scripts/campaigns/file_split_1124/ts_split.mjs analyze <文件>
//       列出顶层声明:序号、种类、是否导出、行范围、行数、引用了本文件哪些顶层声明、被哪些顶层声明引用。用来决定搬哪些。
//   node build/scripts/campaigns/file_split_1124/ts_split.mjs split <文件> --to <新文件> --move 名字1,名字2 [--header "一句话说明"]
//       把选中的顶层声明搬到新文件。原文件仍是入口:原来对外导出的名字原样再导出,引用方一行都不用改。
//       - 新文件需要的导入按实际用到的名字生成;相对路径按新文件所在目录重算,别名(@/…)原样。
//       - 原文件里因此不再用到的导入自动删掉(项目开了 noUnusedLocals)。
//       - 类型一律写成 import type / export type(项目开了 isolatedModules)。
//       - 要搬走的代码如果还用到留在原文件里的「值」(常量、函数、类、枚举),拒绝执行并列出名字:
//         那种要么把被依赖的声明一起搬,要么别搬依赖它的声明。只用到「类型」时自动写 import type。
//       - 默认导出、export { … } 名单、命名空间不能搬;遇到就拒绝,人工处理。
//       - 按名字选声明时搬的是整条语句(export const a = 1, b = 2; 会把 a、b 一起搬走)。
//   在 apps/ 目录下运行(要用到 node_modules 里的 typescript)。
import ts from "typescript";
import fs from "node:fs";
import path from "node:path";

const KIND_NAMES = {
  import: "导入", var: "常量", function: "函数", class: "类", interface: "接口", type: "类型", enum: "枚举",
  namespace: "命名空间", exportList: "导出名", exportStar: "再导出", exportDefault: "默认导", expr: "表达式", other: "其他",
};
const MOVABLE = new Set(["var", "function", "class", "interface", "type", "enum"]);
const fail = (msg) => { console.error("✗ " + msg); process.exit(2); };

function load(file) {
  const text = fs.readFileSync(file, "utf8");
  const scriptKind = file.endsWith(".tsx") ? ts.ScriptKind.TSX : file.endsWith(".jsx") ? ts.ScriptKind.JSX : ts.ScriptKind.TS;
  return { text, sf: ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, scriptKind) };
}

function modifiersOf(stmt) {
  return ts.canHaveModifiers(stmt) ? (ts.getModifiers(stmt) ?? []) : [];
}
const isExported = (stmt) => modifiersOf(stmt).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
const isDefaultExported = (stmt) => isExported(stmt) && modifiersOf(stmt).some((m) => m.kind === ts.SyntaxKind.DefaultKeyword);

function kindOf(stmt) {
  if (ts.isImportDeclaration(stmt) || ts.isImportEqualsDeclaration(stmt)) return "import";
  if (ts.isVariableStatement(stmt)) return "var";
  if (ts.isFunctionDeclaration(stmt)) return "function";
  if (ts.isClassDeclaration(stmt)) return "class";
  if (ts.isInterfaceDeclaration(stmt)) return "interface";
  if (ts.isTypeAliasDeclaration(stmt)) return "type";
  if (ts.isEnumDeclaration(stmt)) return "enum";
  if (ts.isModuleDeclaration(stmt)) return "namespace";
  if (ts.isExportDeclaration(stmt)) return stmt.exportClause && ts.isNamedExports(stmt.exportClause) ? "exportList" : "exportStar";
  if (ts.isExportAssignment(stmt)) return "exportDefault";
  if (ts.isExpressionStatement(stmt)) return "expr";
  return "other";
}

function patternNames(name) {
  if (ts.isIdentifier(name)) return [name.text];
  const out = [];
  const walk = (n) => {
    if (ts.isIdentifier(n)) { out.push(n.text); return; }
    if (ts.isObjectBindingPattern(n) || ts.isArrayBindingPattern(n)) {
      for (const el of n.elements) if (ts.isBindingElement(el)) { if (ts.isIdentifier(el.name)) out.push(el.name.text); else walk(el.name); }
    }
  };
  walk(name);
  return out;
}

function namesOf(stmt) {
  const k = kindOf(stmt);
  if (k === "var") return stmt.declarationList.declarations.flatMap((d) => patternNames(d.name));
  if (["function", "class", "interface", "type", "enum", "namespace"].includes(k)) return stmt.name ? [stmt.name.text] : [];
  return [];
}
const isTypeDecl = (k) => k === "interface" || k === "type";

/** 语句里引用到的标识符及次数。属性名、对象字面量的键、形参名、局部声明名这类不算引用。 */
function referencedIdentifiers(stmt) {
  const refs = new Map();
  const visit = (node) => {
    if (ts.isIdentifier(node)) {
      const p = node.parent;
      let skip = false;
      if (p) {
        if (p.name === node && !ts.isShorthandPropertyAssignment(p)) skip = true;
        if (ts.isJsxAttribute(p) && p.name === node) skip = true;
        if (ts.isExportSpecifier(p) || ts.isImportSpecifier(p) || ts.isEnumMember(p)) skip = true;
        if (ts.isTypeParameterDeclaration(p) && p.name === node) skip = true;
      }
      if (!skip) refs.set(node.text, (refs.get(node.text) ?? 0) + 1);
    }
    ts.forEachChild(node, visit);
  };
  visit(stmt);
  return refs;
}

function buildIndex(sf) {
  const stmts = [...sf.statements];
  const decls = new Map(); // 顶层名字 → { index(首条), kind, all(声明它的全部语句序号:函数重载是多条) }
  stmts.forEach((stmt, index) => {
    for (const n of namesOf(stmt)) {
      if (!decls.has(n)) decls.set(n, { index, kind: kindOf(stmt), all: [] });
      decls.get(n).all.push(index);
    }
  });
  const refs = stmts.map((stmt) => (kindOf(stmt) === "import" ? new Map() : referencedIdentifiers(stmt)));
  return { stmts, decls, refs };
}

function lineRange(stmt, sf) {
  const jsDoc = stmt.jsDoc;
  const start = sf.getLineAndCharacterOfPosition(jsDoc && jsDoc.length ? jsDoc[0].getStart(sf) : stmt.getStart(sf)).line + 1;
  const end = sf.getLineAndCharacterOfPosition(stmt.getEnd()).line + 1;
  return [start, end];
}

function analyze(file) {
  const { sf } = load(file);
  const { stmts, decls, refs } = buildIndex(sf);
  const incoming = stmts.map(() => new Set());
  stmts.forEach((stmt, i) => {
    for (const name of refs[i].keys()) {
      const d = decls.get(name);
      if (d && d.index !== i) incoming[d.index].add(i);
    }
  });
  const total = sf.getText().split("\n").length;
  console.log(`# ${file}  共 ${total} 行,顶层语句 ${stmts.length} 条`);
  stmts.forEach((stmt, i) => {
    const k = kindOf(stmt);
    const [s, e] = lineRange(stmt, sf);
    const names = namesOf(stmt);
    const exp = isExported(stmt) ? (isDefaultExported(stmt) ? "默认" : "导出") : "内部";
    const pad = (x, n) => String(x).padStart(n);
    if (k === "import") {
      const clause = stmt.importClause;
      const what = clause ? [clause.name?.text, clause.namedBindings?.getText(sf)].filter(Boolean).join(", ") : "(副作用导入)";
      console.log(`${pad(i, 4)} 导入        ${pad(s, 5)}-${String(e).padEnd(5)}    1行  ${what}  ← ${stmt.moduleSpecifier.text}`);
      return;
    }
    const out = [...refs[i].keys()].filter((n) => decls.has(n) && decls.get(n).index !== i);
    const inc = [...incoming[i]];
    const label = names.length ? names.join(", ") : (k === "expr" ? stmt.getText(sf).slice(0, 50) : KIND_NAMES[k]);
    console.log(`${pad(i, 4)} ${KIND_NAMES[k].padEnd(4, "　")} ${exp.padEnd(2, "　")} ${pad(s, 5)}-${String(e).padEnd(5)} ${pad(e - s + 1, 4)}行  ${label}`);
    if (out.length || inc.length) {
      const outS = out.map((n) => `${n}#${decls.get(n).index}`).join(" ");
      console.log(`       引用: ${outS || "-"}   被引用: ${inc.length ? inc.join(",") : "-"}`);
    }
  });
}

function relSpec(fromDir, absTarget) {
  let r = path.relative(fromDir, absTarget).split(path.sep).join("/");
  if (!r.startsWith(".")) r = "./" + r;
  return r;
}
const noExt = (p) => p.replace(/\.(tsx?|jsx?)$/, "");

function parseImport(stmt) {
  const spec = stmt.moduleSpecifier.text;
  const clause = stmt.importClause;
  if (!clause) return { spec, sideEffect: true };
  const typeOnlyClause = clause.isTypeOnly;
  const def = clause.name && ts.isIdentifier(clause.name) ? { local: clause.name.text, typeOnly: typeOnlyClause } : null;
  let ns = null;
  const named = [];
  const nb = clause.namedBindings;
  if (nb && ts.isNamespaceImport(nb)) ns = nb.name.text;
  if (nb && ts.isNamedImports(nb)) {
    for (const el of nb.elements) named.push({ local: el.name.text, prop: el.propertyName ? el.propertyName.text : el.name.text, typeOnly: typeOnlyClause || el.isTypeOnly });
  }
  return { spec, def, ns, named, clauseTypeOnly: typeOnlyClause };
}

/** 名单太长时一行一个名字(超过 110 个字符就换行)。 */
function listClause(items) {
  const oneLine = `{ ${items.join(", ")} }`;
  if (oneLine.length <= 110) return oneLine;
  return `{\n${items.map((x) => `  ${x},`).join("\n")}\n}`;
}

/** clauseTypeOnly:沿用原句的写法(整句 import type,或每个名字前单独标 type);不传则按「全是类型就整句标」生成。 */
function buildImports(spec, def, ns, named, clauseTypeOnly) {
  const allType = named.every((n) => n.typeOnly) && (!def || def.typeOnly);
  const useImportType = clauseTypeOnly ?? allType;
  const fmt = (n) => (n.typeOnly && !useImportType ? "type " : "") + (n.prop !== n.local ? `${n.prop} as ${n.local}` : n.local);
  const clause = (items) => listClause(items.map(fmt));
  const lines = [];
  if (ns) lines.push(`import * as ${ns} from "${spec}";`);
  if (def && named.length === 0) lines.push(`import${def.typeOnly ? " type" : ""} ${def.local} from "${spec}";`);
  else if (def && def.typeOnly && named.length) {
    lines.push(`import type ${def.local} from "${spec}";`);
    lines.push(`import ${clause(named)} from "${spec}";`);
  } else if (def) lines.push(`import ${def.local}, ${clause(named)} from "${spec}";`);
  else if (named.length) lines.push(`import${useImportType ? " type" : ""} ${clause(named)} from "${spec}";`);
  return lines;
}

/** 原文件里补的 import / 再导出名单:长的也一行一个名字。 */
function lineWithList(prefix, names, suffix) {
  const oneLine = `${prefix}{ ${names.join(", ")} }${suffix}`;
  if (oneLine.length <= 110) return oneLine;
  return `${prefix}{\n${names.map((x) => `  ${x},`).join("\n")}\n}${suffix}`;
}

function statementText(stmt, sf) {
  let full = stmt.getFullText(sf);
  // 上一条语句同一行末尾的注释会算作本语句的前导注释:那不是本语句的,丢掉
  const firstNl = full.indexOf("\n");
  if (/^[ \t]+\/\//.test(full) && firstNl >= 0) full = full.slice(firstNl + 1);
  full = full.replace(/^(\s*\n)+/, "");
  const body = stmt.getText(sf);
  const lead = full.slice(0, full.length - body.length);
  return lead + (isExported(stmt) ? "" : "export ") + body;
}

/** 去掉文件里不再用到的导入(按标识符在其余文本里是否出现判断)。返回 { text, removed, trimmed } */
function pruneUnusedImports(text, fileName) {
  const scriptKind = fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, scriptKind);
  const imports = sf.statements.filter((s) => ts.isImportDeclaration(s));
  const rest = sf.statements.filter((s) => !ts.isImportDeclaration(s)).map((s) => s.getFullText(sf)).join("\n");
  const used = (local) => new RegExp(`(^|[^A-Za-z0-9_$])${local.replace(/\$/g, "\\$")}([^A-Za-z0-9_$]|$)`).test(rest);
  const edits = [], removed = [], trimmed = [];
  for (const stmt of imports) {
    const info = parseImport(stmt);
    if (info.sideEffect) continue;
    const keepNamed = info.named.filter((n) => used(n.local));
    const keepDef = info.def && used(info.def.local) ? info.def : null;
    const keepNs = info.ns && used(info.ns) ? info.ns : null;
    if (keepNamed.length === info.named.length && !!keepDef === !!info.def && !!keepNs === !!info.ns) continue;
    const drop = [...info.named.filter((n) => !keepNamed.includes(n)).map((n) => n.local), ...(info.def && !keepDef ? [info.def.local] : []), ...(info.ns && !keepNs ? [info.ns] : [])];
    if (!keepNamed.length && !keepDef && !keepNs) {
      edits.push({ start: stmt.getStart(sf), end: stmt.getEnd() + 1, text: "" }); // 连同换行
      removed.push(...drop);
    } else {
      edits.push({ start: stmt.getStart(sf), end: stmt.getEnd(), text: buildImports(info.spec, keepDef, keepNs, keepNamed, info.clauseTypeOnly).join("\n") });
      trimmed.push(...drop);
    }
  }
  for (const e of edits.sort((a, b) => b.start - a.start)) text = text.slice(0, e.start) + e.text + text.slice(e.end);
  return { text, removed, trimmed };
}

function split(file, newFile, moveNames, header) {
  if (!fs.existsSync(file)) fail(`文件不存在: ${file}`);
  if (fs.existsSync(newFile)) fail(`新文件已存在: ${newFile}`);
  const { text, sf } = load(file);
  const { stmts, decls, refs } = buildIndex(sf);
  const sel = new Set();
  for (const name of moveNames) {
    const d = decls.get(name);
    if (!d) fail(`「${name}」不是 ${path.basename(file)} 的顶层声明`);
    for (const i of d.all) sel.add(i); // 重载的签名与实现一起走
  }
  for (const i of sel) {
    const k = kindOf(stmts[i]);
    if (!MOVABLE.has(k)) fail(`序号 ${i}(${namesOf(stmts[i]).join(", ")})是「${KIND_NAMES[k]}」,不能搬`);
    if (isDefaultExported(stmts[i])) fail(`序号 ${i} 是默认导出,不能搬`);
  }
  const movedNames = new Set();
  for (const i of sel) for (const n of namesOf(stmts[i])) movedNames.add(n);
  stmts.forEach((stmt) => {
    if (kindOf(stmt) === "exportList" && !stmt.moduleSpecifier) {
      for (const el of stmt.exportClause.elements) {
        const local = (el.propertyName ?? el.name).text;
        if (movedNames.has(local)) fail(`export { … } 名单里有要搬走的名字「${local}」,请人工处理`);
      }
    }
  });
  const needTypeFromOrig = new Set(), badValues = new Map();
  for (const i of sel) {
    for (const name of refs[i].keys()) {
      const d = decls.get(name);
      if (!d || d.all.every((i) => sel.has(i))) continue;
      if (isTypeDecl(d.kind)) needTypeFromOrig.add(name); else badValues.set(name, d.index);
    }
  }
  if (badValues.size) {
    fail(`要搬走的代码还用到留在原文件里的「值」:${[...badValues].map(([n, i]) => `${n}(序号 ${i})`).join("、")}。要么把它们一起搬,要么别搬依赖它们的声明。`);
  }
  const usedByRemaining = new Set();
  stmts.forEach((stmt, i) => { if (!sel.has(i)) for (const name of refs[i].keys()) if (movedNames.has(name)) usedByRemaining.add(name); });

  // 新文件的导入
  const allRefs = new Map();
  for (const i of sel) for (const [k, v] of refs[i]) allRefs.set(k, (allRefs.get(k) ?? 0) + v);
  const origDir = path.dirname(path.resolve(file)), newDir = path.dirname(path.resolve(newFile));
  const inScope = new Map(); // 新文件里直接过滤:只看搬走的代码用到的名字
  for (const [k, v] of allRefs) inScope.set(k, v);
  const importLines = [];
  for (const stmt of stmts) {
    if (!ts.isImportDeclaration(stmt)) continue;
    const info = parseImport(stmt);
    if (info.sideEffect) continue;
    const has = (local) => inScope.has(local);
    const spec = info.spec.startsWith(".") ? relSpec(newDir, path.resolve(origDir, info.spec)) : info.spec;
    const def = info.def && has(info.def.local) ? info.def : null;
    const ns = info.ns && has(info.ns) ? info.ns : null;
    const named = info.named.filter((n) => has(n.local));
    if (!def && !ns && !named.length) continue;
    importLines.push(...buildImports(spec, def, ns, named));
  }
  const ordered = (set) => {
    const out = [];
    for (const n of set) out.push(n);
    return out.sort((a, b) => decls.get(a).index - decls.get(b).index || namesOf(stmts[decls.get(a).index]).indexOf(a) - namesOf(stmts[decls.get(b).index]).indexOf(b));
  };
  const typeFromOrig = ordered(needTypeFromOrig);
  if (typeFromOrig.length) importLines.push(lineWithList("import type ", typeFromOrig, ` from "${relSpec(newDir, path.resolve(noExt(file)))}";`));

  // 新文件正文
  const directives = stmts.filter((s) => ts.isExpressionStatement(s) && ts.isStringLiteral(s.expression)).map((s) => s.getText(sf));
  const bodies = [...sel].sort((a, b) => a - b).map((i) => statementText(stmts[i], sf).trimEnd());
  const title = header || `从 ${path.basename(file)} 拆出(2026-11-24 超线文件拆分);${path.basename(file)} 仍是入口,对外导出不变。`;
  const newContent = [
    `// ${title}`,
    ...directives,
    "",
    ...(importLines.length ? [...importLines, ""] : []),
    ...bodies.flatMap((b, i) => (i ? ["", b] : [b])),
    "",
  ].join("\n");

  // 原文件:删掉搬走的语句,补 import 与再导出
  const modBack = relSpec(origDir, path.resolve(noExt(newFile)));
  const byKind = (pred) => ordered(new Set([...movedNames].filter((n) => pred(decls.get(n).kind))));
  const ins = [];
  const tInternal = byKind((k) => isTypeDecl(k)).filter((n) => usedByRemaining.has(n));
  const vInternal = byKind((k) => !isTypeDecl(k)).filter((n) => usedByRemaining.has(n));
  const tExported = byKind((k) => isTypeDecl(k)).filter((n) => isExported(stmts[decls.get(n).index]));
  const vExported = byKind((k) => !isTypeDecl(k)).filter((n) => isExported(stmts[decls.get(n).index]));
  if (tInternal.length) ins.push(lineWithList("import type ", tInternal, ` from "${modBack}";`));
  if (vInternal.length) ins.push(lineWithList("import ", vInternal, ` from "${modBack}";`));
  if (tExported.length) ins.push(lineWithList("export type ", tExported, ` from "${modBack}";`));
  if (vExported.length) ins.push(lineWithList("export ", vExported, ` from "${modBack}";`));
  const edits = [];
  for (const i of sel) edits.push({ start: stmts[i].getFullStart(), end: stmts[i].getEnd(), text: "" });
  const lastImport = [...stmts].reverse().find((s) => ts.isImportDeclaration(s));
  const lastDirective = [...stmts].reverse().find((s) => ts.isExpressionStatement(s) && ts.isStringLiteral(s.expression));
  let anchor = lastImport ? lastImport.getEnd() : (lastDirective ? lastDirective.getEnd() : 0);
  if (sel.has(stmts.indexOf(lastImport))) fail("内部错误:导入语句不可能是被选中的");
  edits.push({ start: anchor, end: anchor, text: "\n" + ins.join("\n") });
  let out = text;
  for (const e of edits.sort((a, b) => b.start - a.start)) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  const beforeBlank = out.length;
  out = out.replace(/\n{3,}/g, "\n\n");
  const pruned = pruneUnusedImports(out, file);
  fs.mkdirSync(path.dirname(path.resolve(newFile)), { recursive: true });
  fs.writeFileSync(newFile, newContent);
  fs.writeFileSync(file, pruned.text);
  const lines = (s) => s.split("\n").length - (s.endsWith("\n") ? 1 : 0);
  console.log(`✓ 已把 ${movedNames.size} 个名字(${sel.size} 条语句)搬到 ${newFile}`);
  console.log(`    新文件 ${lines(newContent)} 行 | 原文件 ${lines(text)} → ${lines(pruned.text)} 行`);
  console.log(`    新文件导入 ${importLines.length - (typeFromOrig.length ? 1 : 0)} 条${typeFromOrig.length ? ` + 从原文件取类型 ${typeFromOrig.length} 个` : ""}`);
  console.log(`    原文件新增: ${ins.length} 条(内部用到的类型 ${tInternal.length}、值 ${vInternal.length};再导出类型 ${tExported.length}、值 ${vExported.length})`);
  if (pruned.removed.length) console.log(`    原文件删掉不再用的导入: ${pruned.removed.join(", ")}`);
  if (pruned.trimmed.length) console.log(`    原文件导入里去掉不再用的名字: ${pruned.trimmed.join(", ")}`);
  if (out.length !== beforeBlank) console.log(`    (顺手把删除后留下的连续空行收成一个)`);
  console.log(`    接下来:类型检查、这两个文件的 ESLint、相关测试。`);
}

const [mode, file, ...rest] = process.argv.slice(2);
if (!mode || !file) { console.error("用法见文件头注释"); process.exit(1); }
if (mode === "analyze") analyze(file);
else if (mode === "split") {
  let to = null, header = null, move = [];
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === "--to") to = rest[++i];
    else if (rest[i] === "--move") move = rest[++i].split(",").map((s) => s.trim()).filter(Boolean);
    else if (rest[i] === "--header") header = rest[++i];
  }
  if (!to || !move.length) fail("split 需要 --to <新文件> 和 --move <名字列表>");
  split(file, to, move, header);
} else fail(`不认识的模式: ${mode}`);
