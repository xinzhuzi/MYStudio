#!/usr/bin/env node
// ts_inner_outline.mjs —— 列出一个大组件(或大函数)内部的结构,用来决定怎么把它拆成子组件(2026-11-24 超线文件拆分)。
//
//   node build/scripts/campaigns/file_split_1124/ts_inner_outline.mjs <文件> --fn <顶层函数名> [--min 20]
//       在 apps/ 目录下运行。
//       列出这个函数体内部所有「内层声明」(函数声明、箭头函数常量、useMemo/useCallback/useState 等),行数达到 --min 的逐个列出:
//       行范围、行数、名字、它引用的外层变量(闭包变量:外层函数的参数与局部变量、以及文件顶层的名字)。
//       拆子组件时,这些外层变量就是要当 props 传进去的东西——越少越好拆。
import ts from "typescript";
import fs from "node:fs";

const [file, ...rest] = process.argv.slice(2);
let fnName = null, min = 20;
for (let i = 0; i < rest.length; i++) {
  if (rest[i] === "--fn") fnName = rest[++i];
  else if (rest[i] === "--min") min = Number(rest[++i]);
}
if (!file || !fnName) { console.error("用法见文件头注释"); process.exit(1); }

const text = fs.readFileSync(file, "utf8");
const scriptKind = file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, scriptKind);

function nameOf(stmt) {
  if (ts.isFunctionDeclaration(stmt)) return stmt.name?.text ?? "(匿名函数)";
  if (ts.isVariableStatement(stmt)) return stmt.declarationList.declarations.map((d) => (ts.isIdentifier(d.name) ? d.name.text : "(解构)")).join(", ");
  if (ts.isExpressionStatement(stmt) && ts.isCallExpression(stmt.expression)) {
    const callee = stmt.expression.expression.getText(sf);
    return `${callee}() 调用`;
  }
  return stmt.getText(sf).slice(0, 40).replace(/\s+/g, " ");
}

/** 这个节点内部声明的全部名字(参数、变量、函数、类型参数、内层函数的参数等)。 */
function declaredInside(node) {
  const names = new Set();
  const visit = (n) => {
    if (ts.isParameter(n) && ts.isIdentifier(n.name)) names.add(n.name.text);
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name)) names.add(n.name.text);
    if (ts.isBindingElement(n) && ts.isIdentifier(n.name)) names.add(n.name.text);
    if ((ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n)) && n.name) names.add(n.name.text);
    if (ts.isTypeParameterDeclaration(n)) names.add(n.name.text);
    if (ts.isInterfaceDeclaration(n) || ts.isTypeAliasDeclaration(n) || ts.isEnumDeclaration(n)) names.add(n.name.text);
    if (ts.isImportSpecifier(n) || ts.isImportClause(n)) names.add(n.name?.text ?? "");
    ts.forEachChild(n, visit);
  };
  visit(node);
  return names;
}

/** 节点里「对变量的引用」(不含属性名、对象键、声明名)。 */
function references(node) {
  const refs = new Map();
  const visit = (n) => {
    if (ts.isIdentifier(n)) {
      const p = n.parent;
      let skip = false;
      if (p) {
        if (p.name === n && !ts.isShorthandPropertyAssignment(p)) skip = true;
        if (ts.isJsxAttribute(p) && p.name === n) skip = true;
        if (ts.isExportSpecifier(p) || ts.isImportSpecifier(p) || ts.isEnumMember(p)) skip = true;
        if (ts.isTypeParameterDeclaration(p) && p.name === n) skip = true;
        if (ts.isParameter(p) && p.name === n) skip = true;
        if (ts.isVariableDeclaration(p) && p.name === n) skip = true;
        if (ts.isBindingElement(p) && p.name === n) skip = true;
        if ((ts.isFunctionDeclaration(p) || ts.isFunctionExpression(p)) && p.name === n) skip = true;
      }
      if (!skip) refs.set(n.text, (refs.get(n.text) ?? 0) + 1);
    }
    ts.forEachChild(n, visit);
  };
  visit(node);
  return refs;
}

const top = [...sf.statements].find((s) => (ts.isFunctionDeclaration(s) && s.name?.text === fnName) || (ts.isVariableStatement(s) && s.declarationList.declarations.some((d) => ts.isIdentifier(d.name) && d.name.text === fnName)));
if (!top) { console.error(`找不到顶层声明 ${fnName}`); process.exit(1); }
const fnNode = ts.isFunctionDeclaration(top) ? top : (ts.isArrowFunction(top.declarationList.declarations[0].initializer) || ts.isFunctionExpression(top.declarationList.declarations[0].initializer) ? top.declarationList.declarations[0].initializer : top);
const body = fnNode.body;
const line = (pos) => sf.getLineAndCharacterOfPosition(pos).line + 1;
console.log(`# ${file} → ${fnName}:第 ${line(top.getStart(sf))}-${line(top.getEnd())} 行,共 ${line(top.getEnd()) - line(top.getStart(sf)) + 1} 行`);

// 外层函数自己的参数与「直接的」局部声明(只在函数体的第一层语句里找,不深入内层函数)
const outerNames = new Map(); // 名字 → 行
for (const p of fnNode.parameters ?? []) for (const n of declaredInside(p)) outerNames.set(n, line(p.getStart(sf)));
const firstLevel = [];
if (body && ts.isBlock(body)) {
  for (const stmt of body.statements) {
    firstLevel.push(stmt);
    if (ts.isVariableStatement(stmt)) for (const d of stmt.declarationList.declarations) {
      if (ts.isIdentifier(d.name)) outerNames.set(d.name.text, line(d.getStart(sf)));
      else for (const n of declaredInside(d.name)) outerNames.set(n, line(d.getStart(sf)));
    }
    if (ts.isFunctionDeclaration(stmt) && stmt.name) outerNames.set(stmt.name.text, line(stmt.getStart(sf)));
  }
}
console.log(`外层第一层声明 ${outerNames.size} 个;第一层语句 ${firstLevel.length} 条`);
console.log("\n== 第一层语句(按行)==");
for (const stmt of firstLevel) {
  const s = line(stmt.getStart(sf)), e = line(stmt.getEnd());
  const kind = ts.isVariableStatement(stmt) ? "常量" : ts.isFunctionDeclaration(stmt) ? "函数" : ts.isExpressionStatement(stmt) ? "表达式" : ts.isIfStatement(stmt) ? "if" : ts.isReturnStatement(stmt) ? "return" : "其他";
  const label = nameOf(stmt);
  const init = ts.isVariableStatement(stmt) ? stmt.declarationList.declarations[0].initializer : null;
  const isHook = init && ts.isCallExpression(init) && /^use[A-Z]/.test(init.expression.getText(sf));
  const hook = isHook ? init.expression.getText(sf) : "";
  console.log(`${String(s).padStart(5)}-${String(e).padEnd(5)} ${String(e - s + 1).padStart(4)}行  ${kind}${hook ? "[" + hook + "]" : ""}  ${label.slice(0, 90)}`);
}

console.log(`\n== 内层声明(行数 ≥ ${min})与它们引用的外层变量 ==`);
const found = [];
const visitInner = (n, depth) => {
  if (n !== fnNode && (ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n) || ts.isArrowFunction(n))) {
    const s = line(n.getStart(sf)), e = line(n.getEnd());
    if (e - s + 1 >= min) {
      // 名字:函数声明名,或它所属的变量名(箭头函数常量)
      let label = "(匿名函数)", owner = n.parent;
      if (ts.isFunctionDeclaration(n) && n.name) label = n.name.text;
      else if (owner && ts.isVariableDeclaration(owner)) label = ts.isIdentifier(owner.name) ? owner.name.text : "(解构)";
      else if (owner && ts.isCallExpression(owner)) label = `${owner.expression.getText(sf)}(…) 的回调`;
      else if (owner && ts.isPropertyAssignment(owner)) label = `对象属性 ${owner.name.getText(sf)}`;
      // 外层变量:引用的标识符 − 自己内部声明的;再标注是否是外层函数的名字
      const inside = declaredInside(n);
      const refs = references(n);
      const free = [...refs.keys()].filter((k) => !inside.has(k)).sort();
      const outer = free.filter((k) => outerNames.has(k));
      found.push({ s, e, label, free, outer, depth });
    }
  }
  ts.forEachChild(n, (c) => visitInner(c, depth + 1));
};
visitInner(fnNode, 0);
// 只保留「最外层」的内层声明(被列出的更深的嵌套另起缩进显示)
for (const f of found.sort((a, b) => a.s - b.s)) {
  console.log(`${String(f.s).padStart(5)}-${String(f.e).padEnd(5)} ${String(f.e - f.s + 1).padStart(4)}行  ${"  ".repeat(Math.min(f.depth, 3))}${f.label.slice(0, 80)}`);
  console.log(`${" ".repeat(20)}外层变量 ${f.outer.length} 个: ${f.outer.join(", ") || "-"}`);
  const other = f.free.filter((k) => !outerNames.has(k));
  if (other.length) console.log(`${" ".repeat(20)}还用到文件顶层/全局的名字 ${other.length} 个: ${other.slice(0, 30).join(", ")}${other.length > 30 ? " …" : ""}`);
}
