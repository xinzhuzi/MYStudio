#!/usr/bin/env node
// mcp_sections_split.mjs —— 1124 超线拆分·MCP 设置页第三刀:界面区块组件化(原样搬移)。
//
//   node build/scripts/campaigns/file_split_1124/mcp_sections_split.mjs      (在 apps/ 下运行)
//
// 做法:
//   1. 用 TypeScript 语法树精确定位各界面区块的字节范围(data-testid / sectionId / 标签名);
//   2. 区块文本逐字搬进子组件文件(一个字符不改,含缩进);
//   3. 每个区块用到哪些外部名字,由语法树的自由变量分析算出:钩子返回键→从对应
//      模型对象解构(同名);入口导入→原样导入;折叠态两名字→同名 props。归不了类的名字直接报错停机;
//   4. 入口里被搬走的区块换成同名 props 的组件调用;钩子改为「模型对象 + 仅解构仍在用的名字」。
// 任何断言不过即抛错,不写盘(全部文件最后统一写)。
import ts from "typescript";
import fs from "node:fs";
import { execSync } from "node:child_process";

const DIR = "frontend/components/panels/settings/";
const ENTRY = DIR + "McpSettingsTab.tsx";
const COMPONENT = "McpSettingsTab";
const text = fs.readFileSync(ENTRY, "utf8");
const sf = ts.createSourceFile(ENTRY, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const line = (pos) => sf.getLineAndCharacterOfPosition(pos).line + 1;

const HOOKS = {
  mcpAdmin: { hook: "useMcpServerAdmin", file: "use-mcp-server-admin" },
  remoteAdmin: { hook: "useRemoteEngineAdmin", file: "use-remote-engine-admin" },
  sshAdmin: { hook: "useSshAdmin", file: "use-ssh-admin" },
  syncAdmin: { hook: "useEngineSyncAdmin", file: "use-engine-sync-admin" },
  torchAdmin: { hook: "useTorchUpgradeAdmin", file: "use-torch-upgrade-admin" },
  familyAdmin: { hook: "useEngineFamilyWorkflows", file: "use-engine-family-workflows" },
};

// ---------- 1. 钩子返回键 ----------
for (const h of Object.values(HOOKS)) {
  const src = fs.readFileSync(DIR + h.file + ".ts", "utf8");
  const f = ts.createSourceFile(h.file + ".ts", src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  let keys = null;
  const visit = (n) => {
    if (
      ts.isReturnStatement(n) && n.expression && ts.isObjectLiteralExpression(n.expression) &&
      ts.isBlock(n.parent) && ts.isFunctionDeclaration(n.parent.parent) && n.parent.parent.name?.text === h.hook
    ) {
      keys = n.expression.properties.map((p) => (p.name ? p.name.getText(f).replace(/^"|"$/g, "") : null)).filter(Boolean);
    }
    ts.forEachChild(n, visit);
  };
  visit(f);
  if (!keys) throw new Error(`钩子无顶层 return 对象: ${h.file}`);
  h.keys = keys;
}

// ---------- 2. 入口导入表 ----------
const importMap = new Map(); // 名字 → { module, typeOnly }
for (const st of sf.statements) {
  if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier) || !st.importClause) continue;
  const clause = st.importClause;
  if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
    for (const sp of clause.namedBindings.elements) {
      importMap.set(sp.name.text, { module: st.moduleSpecifier.text, typeOnly: clause.isTypeOnly || sp.isTypeOnly });
    }
  } else if (clause.name) {
    throw new Error(`入口有默认/命名空间导入,未处理: ${clause.name.text}`);
  }
}

// 第一步修剪入口导入后,只在界面区块里用到的名字(如 normalizeEngineUrl)已不在入口导入表——
// 并入拆分前原版(HEAD)的导入;同名以现入口为准(公共件已迁 ./McpSettingsParts)。
{
  const orig = execSync("git show HEAD:apps/frontend/components/panels/settings/McpSettingsTab.tsx", { encoding: "utf8" });
  const f0 = ts.createSourceFile("orig.tsx", orig, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  for (const st of f0.statements) {
    if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier) || !st.importClause) continue;
    const clause = st.importClause;
    if (!(clause.namedBindings && ts.isNamedImports(clause.namedBindings))) continue;
    for (const sp of clause.namedBindings.elements) {
      if (!importMap.has(sp.name.text)) {
        importMap.set(sp.name.text, { module: st.moduleSpecifier.text, typeOnly: clause.isTypeOnly || sp.isTypeOnly });
      }
    }
  }
}

// ---------- 3. 定位工具 ----------
const findAll = (pred) => {
  const out = [];
  const visit = (n) => { if (pred(n)) out.push(n); ts.forEachChild(n, visit); };
  visit(sf);
  return out;
};
const isElement = (n) => ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n);
// 自闭合标签(JsxSelfClosingElement)自身就带 tagName/attributes;成对标签挂在 openingElement 上
const openingOf = (n) => (ts.isJsxSelfClosingElement(n) ? n : n.openingElement);
const tagOf = (n) => (isElement(n) ? openingOf(n).tagName.getText(sf) : null);
const attrOf = (el, name) => {
  for (const a of openingOf(el).attributes.properties) {
    if (ts.isJsxAttribute(a) && a.name.text === name) {
      if (a.initializer && ts.isStringLiteral(a.initializer)) return a.initializer.text;
      if (a.initializer && ts.isJsxExpression(a.initializer)) return a.initializer.getText(sf);
      return true;
    }
  }
  return undefined;
};
const one = (nodes, label) => {
  if (nodes.length !== 1) throw new Error(`${label}: 期望恰 1 个,实得 ${nodes.length}`);
  return nodes[0];
};
const byTestid = (id) => findAll((n) => isElement(n) && attrOf(n, "data-testid") === id);
function ancestorTag(n, tag) {
  for (let p = n.parent; p; p = p.parent) if (tagOf(p) === tag) return p;
  throw new Error(`找不到祖先标签 <${tag}>(起点第 ${line(n.getStart(sf))} 行)`);
}
// 向上找到第一个「JSX 子表达式」{…}(中间可能隔着空片段 <>…</> 与括号)
function enclosingJsxExpression(n) {
  for (let p = n.parent; p; p = p.parent) if (ts.isJsxExpression(p)) return p;
  throw new Error(`找不到外层 JSX 表达式(起点第 ${line(n.getStart(sf))} 行)`);
}
const sectionRow = (id) => one(findAll((n) => isElement(n) && tagOf(n) === "McpRow" && attrOf(n, "sectionId") === id), `McpRow sectionId=${id}`);

// ---------- 4. 自由变量分析 ----------
// 内置标签名(<div>/<span>…)在语法树里也是标识符,但不是变量引用
const isIntrinsicTag = (n) => {
  const p = n.parent;
  return Boolean(p) && (ts.isJsxOpeningElement(p) || ts.isJsxSelfClosingElement(p) || ts.isJsxClosingElement(p)) && p.tagName === n && /^[a-z]/.test(n.text);
};
function freeNames(jsxText, wrap) {
  const body = wrap ? `<>\n${jsxText}\n</>` : jsxText;
  const file = ts.createSourceFile("block.tsx", `const __block = (\n${body}\n);\n`, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const declared = new Set();
  const refs = new Set();
  const visit = (n) => {
    if (ts.isIdentifier(n) && !isIntrinsicTag(n)) {
      const p = n.parent;
      // 声明名:变量/参数/解构元素/函数/类/接口/类型别名/类型参数/枚举/导入
      const isDecl = Boolean(p) && p.name === n && (
        ts.isVariableDeclaration(p) || ts.isParameter(p) || ts.isBindingElement(p) ||
        ts.isFunctionDeclaration(p) || ts.isFunctionExpression(p) || ts.isClassDeclaration(p) ||
        ts.isInterfaceDeclaration(p) || ts.isTypeAliasDeclaration(p) || ts.isTypeParameterDeclaration(p) ||
        ts.isEnumDeclaration(p) || ts.isImportSpecifier(p) || ts.isImportClause(p) || ts.isNamespaceImport(p)
      );
      // 属性名/对象键/JSX 属性名/限定名右段:既不是声明也不是引用(如 prop={prop} 左侧不算声明)
      const isPropName = Boolean(p) && !isDecl && (
        (p.name === n && !ts.isShorthandPropertyAssignment(p)) || (ts.isQualifiedName(p) && p.right === n)
      );
      if (isDecl) declared.add(n.text);
      else if (!isPropName) refs.add(n.text);
    }
    ts.forEachChild(n, visit);
  };
  visit(file);
  return [...refs].filter((k) => !declared.has(k)).sort();
}

const GLOBALS = new Set([
  "window", "navigator", "document", "JSON", "Boolean", "String", "Number", "Date", "Math", "Object", "Array",
  "Promise", "Error", "undefined", "NaN", "parseInt", "parseFloat", "console", "const", "RegExp", "Set", "Map",
  "encodeURIComponent", "setTimeout", "clearInterval", "setInterval", "isFinite",
]);
const SCALARS = {
  collapsedSections: "Set<SectionId>",
  toggleSectionCollapsed: "(sectionId: SectionId) => void",
};
function classify(names) {
  const models = new Map();
  const imports = [];
  const scalars = [];
  for (const name of names) {
    if (GLOBALS.has(name)) continue;
    const model = Object.keys(HOOKS).find((m) => HOOKS[m].keys.includes(name));
    if (model) {
      if (!models.has(model)) models.set(model, []);
      models.get(model).push(name);
      continue;
    }
    if (name in SCALARS) { scalars.push(name); continue; }
    if (importMap.has(name)) { imports.push({ name, ...importMap.get(name) }); continue; }
    throw new Error(`归不了类的自由名字: ${name}`);
  }
  for (const list of models.values()) list.sort();
  imports.sort((a, b) => a.name.localeCompare(b.name));
  return { models, imports, scalars };
}

// ---------- 5. 定位区块 ----------
const U = {};
U.deviceAddForm = one(byTestid("engine-device-add-form"), "engine-device-add-form");
U.deviceEditDialog = ancestorTag(one(byTestid("engine-device-edit-dialog"), "engine-device-edit-dialog"), "Dialog");
const syncCollapsible = ancestorTag(one(byTestid("engine-sync-header"), "engine-sync-header"), "Collapsible");
const syncResultDialog = ancestorTag(one(byTestid("engine-sync-result-dialog"), "engine-sync-result-dialog"), "Dialog");
const syncExpression = enclosingJsxExpression(syncCollapsible);
U.engineSync = { getStart: () => syncExpression.getStart(sf), getEnd: () => syncResultDialog.getEnd() };
const torchCollapsible = ancestorTag(one(byTestid("torch-upgrade-header"), "torch-upgrade-header"), "Collapsible");
const torchExpression = enclosingJsxExpression(torchCollapsible);
U.torch = torchExpression;
U.sshAddForm = one(byTestid("ssh-connection-add-form"), "ssh-connection-add-form");
U.sshEditDialog = ancestorTag(one(byTestid("ssh-connection-edit-dialog"), "ssh-connection-edit-dialog"), "Dialog");
const shutdownAlert = ancestorTag(one(byTestid("shutdown-confirm-ok"), "shutdown-confirm-ok"), "AlertDialog");
const mcpFormDialog = ancestorTag(one(byTestid("mcp-save-server"), "mcp-save-server"), "Dialog");
U.dialogs = { getStart: () => shutdownAlert.getStart(sf), getEnd: () => mcpFormDialog.getEnd() };
const R = sectionRow("remote-engine");
const S = sectionRow("ssh-remote");

const rangeOf = (n) => ({ start: n.getStart(sf), end: n.getEnd() });
const slice = (n) => text.slice(n.getStart(sf), n.getEnd());

// 完整性断言:几段的两头形状
const must = (cond, msg) => { if (!cond) throw new Error(msg); };
must(slice(U.engineSync).startsWith("{remoteActive && ("), "引擎同步块起点形状不对");
must(slice(U.engineSync).endsWith("</Dialog>"), "引擎同步块终点形状不对");
must(slice(U.torch).startsWith("{remoteActive && ("), "Torch 块起点形状不对");
must(slice(U.deviceAddForm).startsWith('<div'), "添加设备表单起点形状不对");
must(slice(U.sshAddForm).startsWith('<div'), "添加 SSH 表单起点形状不对");
must(slice(U.dialogs).startsWith("<AlertDialog"), "弹窗群起点形状不对");
must(slice(U.dialogs).endsWith("</Dialog>"), "弹窗群终点形状不对");
must(R.getStart(sf) < U.deviceAddForm.getStart(sf) && U.torch.getEnd() < R.getEnd(), "远程引擎区块范围包不住子块");
must(S.getStart(sf) < U.sshAddForm.getStart(sf) && U.sshEditDialog.getEnd() < S.getEnd(), "SSH 区块范围包不住子块");
const between = text.slice(syncExpression.getEnd(), syncResultDialog.getStart(sf));
must(/^\s*\{\/\*[\s\S]*\*\/\}\s*$/.test(between), "引擎同步两子块之间不只是注释");
// 同步结果弹窗与 Torch 折叠块之间只隔空白(两块先后替换,互不重叠)
must(/^\s*$/.test(text.slice(syncResultDialog.getEnd(), torchExpression.getStart(sf))), "同步结果弹窗与 Torch 折叠块之间有别的content");
must(syncExpression.getEnd() < syncResultDialog.getStart(sf), "同步折叠表达式与结果弹窗重叠");
must(U.engineSync.getEnd() <= U.torch.getStart(sf), "同步块与 Torch 块重叠");
// 弹窗群:恰两个 AlertDialog + 两个 Dialog
must((slice(U.dialogs).match(/<AlertDialog\b/g) ?? []).length === 2, "弹窗群 AlertDialog 数不对");
must((slice(U.dialogs).match(/<Dialog\b/g) ?? []).length === 2, "弹窗群 Dialog 数不对");

// ---------- 6. 子组件规格 ----------
const SUB = {
  deviceAddForm: { node: U.deviceAddForm, comp: "EngineDeviceAddForm", file: "McpDeviceForms.tsx", wrap: false,
    doc: ["添加设备表单(名字选填+地址;可先测试再保存生效)。"] },
  deviceEditDialog: { node: U.deviceEditDialog, comp: "EngineDeviceEditDialog", file: "McpDeviceForms.tsx", wrap: false,
    doc: ["编辑设备弹窗(改名或换地址;生效中的设备换地址自动切到新地址)。"] },
  engineSync: { node: U.engineSync, comp: "EngineSyncSection", file: "McpEngineSyncSection.tsx", wrap: true,
    doc: ["引擎同步折叠子区(单真源清单+勾选+逐项进度)与同步结果弹窗。"] },
  torch: { node: U.torch, comp: "TorchUpgradeSection", file: "McpTorchUpgradeSection.tsx", wrap: true,
    doc: ["引擎 PyTorch / CUDA 升级折叠子区(升级对象说明/三件套对照/目标版本与通道/升级按钮/进度)。"] },
  sshAddForm: { node: U.sshAddForm, comp: "SshConnectionAddForm", file: "McpSshForms.tsx", wrap: false,
    doc: ["添加 SSH 连接表单(只入列表不落章,点行才连接)。"] },
  sshEditDialog: { node: U.sshEditDialog, comp: "SshConnectionEditDialog", file: "McpSshForms.tsx", wrap: false,
    doc: ["编辑 SSH 连接弹窗(改所有字段保 id;密码留空=不改)。"] },
};
for (const s of Object.values(SUB)) {
  s.range = rangeOf(s.node);
  s.body = slice(s.node);
  s.free = freeNames(s.body, s.wrap);
  s.cls = classify(s.free);
}

const callSite = (comp, models, indentUnit) => {
  if (models.length <= 1) {
    const one = `<${comp}${models.map((m) => ` ${m}={${m}}`).join(" ")} />`;
    if (one.length <= 100) return one;
  }
  return `<${comp}\n${models.map((m) => `${indentUnit}${m}={${m}}`).join("\n")}\n${indentUnit.slice(2)}/>`;
};

// ---------- 7. 三个大区块(内含子组件调用) ----------
function section(name, node, subs, file, doc, wrap) {
  const start = node.getStart(sf);
  const body = slice(node);
  const inner = text.slice(start, node.getEnd());
  let outText = inner;
  const modelSet = new Set();
  for (const key of [...subs].sort((a, b) => SUB[b].range.start - SUB[a].range.start)) {
    const s = SUB[key];
    const relS = s.range.start - start;
    const relE = s.range.end - start;
    must(outText.slice(relS, relE) === s.body, `子块 ${key} 与区块文本对不上`);
    const models = [...s.cls.models.keys()];
    for (const m of models) modelSet.add(m);
    // 子组件调用点:模型对象 + 它用到的页面级标量(折叠态两名字,同名传递)
    outText = outText.slice(0, relS) + callSite(s.comp, [...models, ...s.cls.scalars], " ".repeat(18)) + outText.slice(relE);
  }
  const subCompNames = new Set(subs.map((k) => SUB[k].comp));
  // 按「替换之后」的文本算自由名字:搬给子组件的名字不再在本区块解构
  const cls = classify(freeNames(outText, wrap).filter((n) => !modelSet.has(n) && !subCompNames.has(n)));
  // 子组件调用点引用的模型对象,本区块也要作为 props 接收(可能没有要解构的名字)
  for (const m of modelSet) if (!cls.models.has(m)) cls.models.set(m, []);
  return { name, file, doc, wrap, body: outText, cls, subs, range: { start, end: node.getEnd() } };
}
const SEC = [
  section("McpRemoteEngineSection", R, ["deviceAddForm", "deviceEditDialog", "engineSync", "torch"], "McpRemoteEngineSection.tsx",
    ["远程引擎区块(ComfyUI 引擎地址·远程):全景状态条+设备列表(本机行恒在+远端设备行)", "+探活结果与详情弹窗,内嵌引擎同步子区与 PyTorch/CUDA 升级子区。"], false),
  section("McpSshConnectionsSection", S, ["sshAddForm", "sshEditDialog"], "McpSshConnectionsSection.tsx",
    ["SSH 远端连接区块(多条):连接列表(点行即连接)+隧道开关+测试/令牌结果,内嵌添加表单与编辑弹窗。"], false),
  section("McpSettingsDialogs", U.dialogs, [], "McpSettingsDialogs.tsx",
    ["设置页顶层弹窗群:关闭远端 MYStudio 确认/PyTorch 升级确认与结果/MCP 服务器表单。"], true),
];

// ---------- 8. 生成组件文件 ----------
function emitImportLines(imports) {
  const byMod = new Map();
  for (const im of imports) {
    if (!byMod.has(im.module)) byMod.set(im.module, { values: [], types: [] });
    (im.typeOnly ? byMod.get(im.module).types : byMod.get(im.module).values).push(im.name);
  }
  const lines = [];
  for (const [mod, g] of [...byMod.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const vals = [...new Set(g.values)].sort();
    const types = [...new Set(g.types)].sort();
    for (const [names, kw] of [[vals, ""], [types, "type "]]) {
      if (!names.length) continue;
      const single = `import ${kw}{ ${names.join(", ")} } from "${mod}";`;
      lines.push(single.length <= 110 ? single : `import ${kw}{\n${names.map((n) => `  ${n},`).join("\n")}\n} from "${mod}";`);
    }
  }
  return lines;
}
function compText(comp) {
  const { models, scalars } = comp.cls;
  const modelNames = Object.keys(HOOKS).filter((m) => models.has(m));
  const props = [...modelNames, ...scalars];
  const lines = [];
  lines.push("/**", ...comp.doc.map((d) => ` * ${d}`), " */");
  lines.push(`export function ${comp.name}({`);
  for (const p of props) lines.push(`  ${p},`);
  lines.push("}: {");
  for (const m of modelNames) lines.push(`  ${m}: ReturnType<typeof ${HOOKS[m].hook}>;`);
  for (const s of scalars) lines.push(`  ${s}: ${SCALARS[s]};`);
  lines.push("}) {");
  for (const m of modelNames) {
    if (models.get(m).length) lines.push(`  const {\n${models.get(m).map((n) => `    ${n},`).join("\n")}\n  } = ${m};`);
  }
  lines.push("  return (");
  lines.push(comp.wrap ? `    <>\n${comp.body}\n    </>` : comp.body);
  lines.push("  );", "}");
  return lines.join("\n");
}

const files = new Map(); // file → comps
for (const s of Object.values(SUB)) {
  if (!files.has(s.file)) files.set(s.file, []);
  files.get(s.file).push({ name: s.comp, doc: s.doc, body: s.body, wrap: s.wrap, cls: s.cls });
}
for (const sec of SEC) files.set(sec.file, [sec]);

const FILE_DOC = {
  "McpDeviceForms.tsx": "MCP 设置页·远程设备表单与弹窗(1124 超线文件拆分:自 McpSettingsTab 原样搬出;props=域模型对象,块内零改动)。",
  "McpRemoteEngineSection.tsx": "MCP 设置页·远程引擎区块(1124 超线文件拆分:自 McpSettingsTab 原样搬出;props=域模型对象,块内零改动)。",
  "McpEngineSyncSection.tsx": "MCP 设置页·引擎同步子区(1124 超线文件拆分:自 McpSettingsTab 原样搬出;props=域模型对象,块内零改动)。",
  "McpTorchUpgradeSection.tsx": "MCP 设置页·PyTorch/CUDA 升级子区(1124 超线文件拆分:自 McpSettingsTab 原样搬出;props=域模型对象,块内零改动)。",
  "McpSshForms.tsx": "MCP 设置页·SSH 连接表单与弹窗(1124 超线文件拆分:自 McpSettingsTab 原样搬出;props=域模型对象,块内零改动)。",
  "McpSshConnectionsSection.tsx": "MCP 设置页·SSH 远端连接区块(1124 超线文件拆分:自 McpSettingsTab 原样搬出;props=域模型对象,块内零改动)。",
  "McpSettingsDialogs.tsx": "MCP 设置页·顶层弹窗群(1124 超线文件拆分:自 McpSettingsTab 原样搬出;props=域模型对象,块内零改动)。",
};
const OUTPUT = new Map();
for (const [file, comps] of files) {
  const imports = [];
  const modelDeps = new Set();
  let needSectionId = false;
  for (const c of comps) {
    imports.push(...c.cls.imports);
    for (const m of c.cls.models.keys()) modelDeps.add(m);
    if (c.cls.scalars.length) needSectionId = true;
  }
  const own = new Set(comps.map((c) => c.name));
  const byFile = new Map();
  for (const c of comps) {
    for (const key of c.subs ?? []) {
      const sub = SUB[key];
      if (own.has(sub.comp)) continue;
      if (!byFile.has(sub.file)) byFile.set(sub.file, new Set());
      byFile.get(sub.file).add(sub.comp);
    }
  }
  const lines = ["/**", ` * ${FILE_DOC[file]}`, " */"];
  for (const l of emitImportLines(imports)) lines.push(l);
  for (const [f, names] of [...byFile.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    lines.push(`import { ${[...names].sort().join(", ")} } from "./${f.replace(/\.tsx$/, "")}";`);
  }
  for (const m of Object.keys(HOOKS).filter((k) => modelDeps.has(k))) lines.push(`import type { ${HOOKS[m].hook} } from "./${HOOKS[m].file}";`);
  if (needSectionId && !imports.some((i) => i.name === "SectionId")) lines.push(`import type { SectionId } from "./McpSettingsParts";`);
  lines.push("");
  for (const c of comps) {
    lines.push(compText(c));
    lines.push("");
  }
  const out = lines.join("\n");
  OUTPUT.set(DIR + file, out);
}

// ---------- 9. 入口改写 ----------
let outText = text;
const lineIndent = (pos) => {
  const ls = text.lastIndexOf("\n", pos - 1) + 1;
  const indent = text.slice(ls, pos);
  must(/^\s*$/.test(indent), "区块起点不在行首");
  return indent;
};
const entryCalls = [];
for (const sec of SEC) {
  const models = Object.keys(HOOKS).filter((m) => sec.cls.models.has(m));
  const props = [...models, ...sec.cls.scalars];
  const indent = lineIndent(sec.range.start);
  const call = `<${sec.name}\n${props.map((p) => `${indent}  ${p}={${p}}`).join("\n")}\n${indent}/>`;
  entryCalls.push({ ...sec, start: sec.range.start, end: sec.range.end, call });
}
for (const c of [...entryCalls].sort((a, b) => b.start - a.start)) {
  outText = outText.slice(0, c.start) + c.call + outText.slice(c.end);
}

// 入口导入三个区块组件(紧随钩子导入之后)
{
  const anchor = 'import { useEngineFamilyWorkflows } from "./use-engine-family-workflows";\n';
  must(outText.includes(anchor), "入口找不到钩子导入锚");
  outText = outText.replace(anchor, anchor + SEC.map((s) => `import { ${s.name} } from "./${s.file.replace(/\.tsx$/, "")}";`).join("\n") + "\n", 1);
}

// 钩子调用改写:模型对象 + 仅解构入口仍在用的名字
{
  const sf2 = ts.createSourceFile(ENTRY, outText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const fn = one(sf2.statements.filter((s) => ts.isFunctionDeclaration(s) && s.name?.text === COMPONENT), "组件函数");
  const hookNames = new Map(Object.entries(HOOKS).map(([m, h]) => [h.hook, m]));
  const stmts = [];
  const visit = (n) => {
    if (ts.isVariableStatement(n) && n.declarationList.declarations.length === 1) {
      const d = n.declarationList.declarations[0];
      if (ts.isObjectBindingPattern(d.name) && d.initializer && ts.isCallExpression(d.initializer) &&
          ts.isIdentifier(d.initializer.expression) && hookNames.has(d.initializer.expression.text)) {
        stmts.push(n);
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(fn);
  must(stmts.length === Object.keys(HOOKS).length, `入口钩子解构语句数 ${stmts.length} ≠ ${Object.keys(HOOKS).length}`);
  // 组件函数体内全部「引用」(声明名不计)
  const refs = new Set();
  const collect = (n) => {
    if (ts.isIdentifier(n)) {
      const p = n.parent;
      if (!(p && p.name === n && !ts.isShorthandPropertyAssignment(p)) && !(p && ts.isQualifiedName(p) && p.right === n)) refs.add(n.text);
    }
    ts.forEachChild(n, collect);
  };
  collect(fn);
  const rewrites = [];
  for (const st of stmts) {
    const d = st.declarationList.declarations[0];
    const hook = d.initializer.expression.text;
    const model = hookNames.get(hook);
    const args = d.initializer.arguments.map((a) => a.getText(sf2)).join(", ");
    const bound = d.name.elements.filter((e) => ts.isIdentifier(e.name)).map((e) => e.name.text);
    must(bound.length === d.name.elements.length, "钩子解构里有非标识符绑定");
    const kept = bound.filter((b) => refs.has(b));
    let repl = `const ${model} = ${hook}(${args});`;
    if (kept.length) repl += `\n  const {\n${kept.map((k) => `    ${k},`).join("\n")}\n  } = ${model};`;
    rewrites.push({ start: st.getStart(sf2), end: st.getEnd(), repl });
  }
  for (const r of rewrites.sort((a, b) => b.start - a.start)) {
    outText = outText.slice(0, r.start) + r.repl + outText.slice(r.end);
  }
}

// ---------- 10. 写盘 ----------
const report = [];
for (const [path, content] of OUTPUT) {
  must(!fs.existsSync(path), `目标文件已存在: ${path}`);
  fs.writeFileSync(path, content);
  report.push(`  ${path.replace(DIR, "")}: ${content.split("\n").length - 1} 行`);
}
fs.writeFileSync(ENTRY, outText);
console.log(`✓ 入口 ${text.split("\n").length - 1} → ${outText.split("\n").length - 1} 行`);
console.log(report.join("\n"));
for (const [key, s] of Object.entries(SUB)) {
  console.log(`  [${s.comp}] ${s.range.end - s.range.start} 字符; 模型: ${[...s.cls.models.keys()].join(",") || "-"}; 导入: ${s.cls.imports.map((i) => i.name).join(",") || "-"}`);
}
for (const sec of SEC) {
  console.log(`  [${sec.name}] ${sec.range.end - sec.range.start} 字符; 模型: ${[...sec.cls.models.keys()].join(",")}; 标量: ${sec.cls.scalars.join(",") || "-"}; 导入: ${sec.cls.imports.map((i) => i.name).join(",") || "-"}`);
}
