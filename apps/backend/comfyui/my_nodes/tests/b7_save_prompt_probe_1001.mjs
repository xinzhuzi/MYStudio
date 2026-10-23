#!/usr/bin/env node
/** B7① 存图 prompt 面板探针(1001,jsdom 仿真——本轮零引擎约束,引擎实弹延期):
 *  装载真 save-prompt-panel.js(/scripts/app.js 唯一导入重定向到 jsdom 桩,
 *  余零改),python 回传→面板→交互全场景断言:静态门(AGPL 头逐字节/零道劫
 *  词/导入面恰 app 一处)+ tokens 设计钉死值(折叠2行/展开30行/双击350ms/
 *  位移容差5px)+ 只认 MyImageSave + 三板斧五钩子齐 + 占位 widget(custom/
 *  serialize:false)+ onExecuted 四形态(列表形/dict 桩形/空/垃圾容错)+
 *  wrapText(注入 measure 桩:CJK 逐字/西文按词/超长词独占/显式换行/空文/
 *  行首空白吞)+ clipLines 折叠/展开截断 + 实绘(头行/正文/空态/截断省略行/
 *  collapsed 不画/折行缓存宽度失效)+ widget.mouse 双击复制(clipboard 桩收
 *  全文;缺席→execCommand 兜底)/折叠切换(头行单击翻/双击净零漂移)/时序
 *  (超窗不算双击)/位移(超容差不算双击)/面板外不消费(事件不外溢劫持)+
 *  重入幂等(properties 不换引用+widget 不重复加)+ serialize/configure
 *  状态夹取。 */
import { JSDOM } from "jsdom";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB = join(HERE, "../web");
const EXT = join(WEB, "save-prompt-panel.js");
const SIBLING = join(WEB, "my-image-ab-compare.js");

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/" });
globalThis.window = dom.window;
globalThis.document = dom.window.document;

let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? " — " + extra : ""}`); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const tmp = await mkdtemp(join(tmpdir(), "b7-save-prompt-probe-"));
try {
  // ── 桩:/scripts/app.js(本件唯一 /scripts/* 依赖) ───────────────────
  const stubApp = join(tmp, "stub-app.mjs");
  await writeFile(stubApp, `export const app = {
  __registry: [],
  registerExtension(ext) { this.__registry.push(ext); },
};
`);
  // ── 重定向装载:仅替换 /scripts/app.js 一处导入,余零改 ──────────────
  const extSrc = await readFile(EXT, "utf8");
  const proxyExt = join(tmp, "ext.proxy.mjs");
  await writeFile(proxyExt, extSrc
    .replace('from "/scripts/app.js"', `from ${JSON.stringify(pathToFileURL(stubApp).href)}`));

  // ── 静态门:AGPL 头逐字节 / 零道劫词 / 导入面 ────────────────────────
  console.log("[静态门]");
  const headerOf = async (p) => (await readFile(p, "utf8")).split("\n").slice(0, 3).join("\n") + "\n";
  ok("AGPL 头与兄弟件逐字节一致", (await headerOf(EXT)) === (await headerOf(SIBLING)));
  ok("新件零道劫词", !extSrc.includes("道劫"));
  ok("导入面恰 /scripts/app.js 一处(无 api/其他依赖)", (extSrc.match(/from "\/scripts\//g) ?? []).length === 1 && extSrc.includes('from "/scripts/app.js"'));

  // ── 装载(先 jsdom 全局后动态 import,顺序保证桩构造时 window 就位)──
  const { app } = await import(stubApp);
  await import(proxyExt);
  const { SAVE_PROMPT_PANEL_TOKENS: TOKENS, wrapText, clipLines } = await import(proxyExt);
  const ext = app.__registry.find((e) => e.name === "my.save.prompt.panel");
  ok("扩展已注册(名 my.save.prompt.panel)", !!ext, `registry=${app.__registry.map(e => e.name).join(",")}`);

  // ── tokens:设计钉死值 ───────────────────────────────────────────────
  console.log("[tokens]");
  ok("折叠态行数=2(设计钉死)", TOKENS.collapseLines === 2);
  ok("展开上限行数=30(设计钉死)", TOKENS.maxLines === 30);
  ok("双击判定窗=350ms(设计钉死)", TOKENS.dblClickMs === 350);
  ok("双击位移容差=5px(设计钉死)", TOKENS.dblClickSlop === 5);

  // ── 只认 MyImageSave(其它 nodeData 零触碰) ─────────────────────────
  console.log("[门控]");
  const otherType = { prototype: { marker: 1 } };
  await ext.beforeRegisterNodeDef(otherType, { name: "SaveImage" });
  ok("非 MyImageSave 原型零触碰", otherType.prototype.onNodeCreated === undefined && otherType.prototype.marker === 1);
  const saveType = { prototype: {} };
  await ext.beforeRegisterNodeDef(saveType, { name: "MyImageSave" });
  const P = saveType.prototype;
  ok("三板斧五钩子+实绘齐挂(6 方法)", ["onNodeCreated", "onExecuted", "onResize", "onSerialize", "onConfigure", "onDrawBackground"].every(k => typeof P[k] === "function"));

  // ── 节点工厂(占位 widget 收集器+脏计数) ────────────────────────────
  const mkNode = () => ({
    properties: {}, widgets: [], size: [340, 320], flags: {}, dirty: 0,
    setDirtyCanvas() { this.dirty++; },
    addCustomWidget(spec) { const w = { ...spec, y: 0, computedHeight: 0 }; this.widgets.push(w); return w; },
  });
  const mkCtx = () => {
    const calls = { fillText: [] };
    return { calls, font: "", fillStyle: "", strokeStyle: "", lineWidth: 1,
      save() {}, restore() {}, beginPath() {}, closePath() {}, moveTo() {},
      lineTo() {}, arcTo() {}, arc() {}, rect() {}, clip() {}, fill() {},
      stroke() {}, fillRect() {},
      fillText(t, x, y) { calls.fillText.push(String(t)); },
      measureText(s) { return { width: String(s).length * 7 }; } };
  };
  const down = (widget, node, x, y, t) =>
    widget.mouse({ type: "pointerdown", timeStamp: t }, [x, y], node);
  const bodyToasts = () => [...document.body.querySelectorAll("div")].map((d) => d.textContent);

  // ── onNodeCreated:占位 widget+缺省态+幂等 ───────────────────────────
  console.log("[onNodeCreated]");
  const node = mkNode();
  P.onNodeCreated.call(node);
  ok("状态缺省落 properties.mySavePrompt(文本空/折叠态)", node.properties.mySavePrompt
    && node.properties.mySavePrompt.text === "" && node.properties.mySavePrompt.collapsed === true);
  ok("占位 widget 恰一个(custom+serialize:false)", node.widgets.length === 1
    && node.widgets[0].type === "custom" && node.widgets[0].serialize === false);
  ok("占位 widget 挂 mouse 派发+computeSize", typeof node.widgets[0].mouse === "function"
    && typeof node.widgets[0].computeSize === "function");
  ok("computeSize 折叠预算=头行+2行+边距", JSON.stringify(node.widgets[0].computeSize(340)) === JSON.stringify([340, TOKENS.headerH + 2 * TOKENS.lineH + TOKENS.pad]));
  const stateRef = node.properties.mySavePrompt;
  P.onNodeCreated.call(node);
  ok("重入幂等:widget 不重复加+properties 不换引用", node.widgets.length === 1
    && node.properties.mySavePrompt === stateRef);

  // ── onResize:最小宽守卫 ─────────────────────────────────────────────
  const nodeR = mkNode();
  P.onNodeCreated.call(nodeR);
  nodeR.size[0] = 100;
  P.onResize.call(nodeR);
  ok("onResize 守最小宽(100→" + TOKENS.minW + ")", nodeR.size[0] === TOKENS.minW);

  // ── wrapText:注入 measure 桩(等宽 W=每字宽) ────────────────────────
  console.log("[wrapText]");
  const mW = (w) => (s) => ({ width: String(s).length * w });
  ok("CJK 逐字折行", JSON.stringify(wrapText("一二三四五", 30, mW(10))) === JSON.stringify(["一二三", "四五"]));
  ok("西文按词折行(词不拆)", JSON.stringify(wrapText("the quick brown fox", 40, mW(4))) === JSON.stringify(["the quick", "brown fox"]));
  ok("超长词独占一行(不截字)", JSON.stringify(wrapText("abcdefghij foo", 20, mW(4))) === JSON.stringify(["abcdefghij", "foo"]));
  ok("显式换行保留", JSON.stringify(wrapText("甲\n乙丙", 30, mW(10))) === JSON.stringify(["甲", "乙丙"]));
  ok("CJK/西文混排", JSON.stringify(wrapText("你好 world 你好", 50, mW(10))) === JSON.stringify(["你好", "world", "你好"]));
  ok("空文/null→单条空行", JSON.stringify(wrapText("", 30, mW(10))) === '[""]'
    && JSON.stringify(wrapText(null, 30, mW(10))) === '[""]');
  ok("换行吞空白+行尾零空白", wrapText("aaaa bb  cccc", 12, mW(4)).every((l) => l === l.trimEnd()));

  // ── clipLines:折叠/展开显示截断 ────────────────────────────────────
  console.log("[clipLines]");
  const lines40 = Array.from({ length: 40 }, (_, i) => `行${i}`);
  ok("折叠=2 行+截断标记", (() => { const r = clipLines(lines40, true); return r.lines.length === 2 && r.truncated === true; })());
  ok("展开=30 行封顶+截断标记", (() => { const r = clipLines(lines40, false); return r.lines.length === 30 && r.truncated === true; })());
  ok("行数在预算内零截断", clipLines(["甲", "乙"], true).truncated === false
    && clipLines(["甲", "乙"], false).lines.length === 2);

  // ── onExecuted:ui.myPrompt 四形态 ──────────────────────────────────
  console.log("[onExecuted]");
  const nodeE = mkNode();
  P.onNodeCreated.call(nodeE);
  P.onExecuted.call(nodeE, { myPrompt: [{ text: "甲乙丙", chars: 3 }] });
  ok("列表形(引擎扁平化契约):文本+字数落 properties", nodeE.properties.mySavePrompt.text === "甲乙丙"
    && nodeE.properties.mySavePrompt.chars === 3);
  P.onExecuted.call(nodeE, { myPrompt: { text: "hello world", chars: 11 } });
  ok("dict 桩形双读兼容", nodeE.properties.mySavePrompt.text === "hello world");
  P.onExecuted.call(nodeE, { myPrompt: [{ text: "", chars: 0 }] });
  ok("空载荷=面板空态", nodeE.properties.mySavePrompt.text === "");
  P.onExecuted.call(nodeE, { myPrompt: [{ text: "旧值", chars: 2 }] });
  const before = { ...nodeE.properties.mySavePrompt };
  let threw = false;
  try {
    P.onExecuted.call(nodeE, {});
    P.onExecuted.call(nodeE, { myPrompt: 12345 });
    P.onExecuted.call(nodeE, { myPrompt: "junk" });
    P.onExecuted.call(nodeE, { myPrompt: null });
  } catch { threw = true; }
  ok("缺键/垃圾载荷容错:零抛错+面板维持旧值", !threw
    && nodeE.properties.mySavePrompt.text === before.text
    && nodeE.properties.mySavePrompt.chars === before.chars);
  ok("执行后触发脏画布+折行缓存失效", nodeE.dirty > 0 && nodeE.__mySaveWrap === null);

  // ── 实绘:onDrawBackground ──────────────────────────────────────────
  console.log("[实绘]");
  const nodeD = mkNode();
  P.onNodeCreated.call(nodeD);
  P.onExecuted.call(nodeD, { myPrompt: [{ text: "甲乙丙丁戊己庚", chars: 7 }] });
  const widgetD = nodeD.widgets[0];
  widgetD.y = 200; widgetD.computedHeight = TOKENS.headerH + 2 * TOKENS.lineH + TOKENS.pad;
  let ctx = mkCtx();
  P.onDrawBackground.call(nodeD, ctx);
  ok("头行画「提示词 N 字」+折叠箭头", ctx.calls.fillText.some((t) => t.startsWith("提示词 7 字")));
  ok("正文画 prompt 文本行", ctx.calls.fillText.includes("甲乙丙丁戊己庚"));
  ok("命中矩形缓存落节点(头行/正文/面板)", nodeD.__mySaveHits?.header && nodeD.__mySaveHits?.body && nodeD.__mySaveHits?.panel);
  const wrapW = nodeD.__mySaveWrap?.width;
  nodeD.size[0] = 380;
  ctx = mkCtx();
  P.onDrawBackground.call(nodeD, ctx);
  ok("节点变宽→折行缓存失效重建", nodeD.__mySaveWrap.width !== wrapW);
  nodeD.flags.collapsed = true;
  ctx = mkCtx();
  P.onDrawBackground.call(nodeD, ctx);
  ok("节点折叠(collapsed)不画面板", ctx.calls.fillText.length === 0);
  const nodeEmpty = mkNode();
  P.onNodeCreated.call(nodeEmpty);
  const widget0 = nodeEmpty.widgets[0]; widget0.y = 150;
  ctx = mkCtx();
  P.onDrawBackground.call(nodeEmpty, ctx);
  ok("空态画接线提示文案", ctx.calls.fillText.some((t) => t.includes("prompt_text")));
  const nodeLong = mkNode();
  P.onNodeCreated.call(nodeLong);
  P.onExecuted.call(nodeLong, { myPrompt: [{ text: Array.from({ length: 40 }, (_, i) => `行${i}`).join("\n"), chars: 200 }] });
  nodeLong.widgets[0].y = 150;
  ctx = mkCtx();
  P.onDrawBackground.call(nodeLong, ctx);
  ok("截断省略行(共 40 行+双击复制提示)", ctx.calls.fillText.some((t) => t.includes("共 40 行") && t.includes("双击复制")));

  // ── widget.mouse:双击复制 / clipboard 主路 ─────────────────────────
  console.log("[双击复制]");
  const clipCalls = [];
  Object.defineProperty(dom.window.navigator, "clipboard", {
    value: { writeText: (t) => { clipCalls.push(t); return Promise.resolve(); } },
    configurable: true,
  });
  const nodeC = mkNode();
  P.onNodeCreated.call(nodeC);
  const longText = "追溯全文".repeat(40);   // 显示截断,但复制恒全文
  P.onExecuted.call(nodeC, { myPrompt: [{ text: longText, chars: longText.length }] });
  nodeC.widgets[0].y = 150;
  P.onDrawBackground.call(nodeC, mkCtx());
  const wC = nodeC.widgets[0];
  const hitsC = nodeC.__mySaveHits;
  const bodyPt = [hitsC.body.x + 5, hitsC.body.y + 5];
  const rSingle = down(wC, nodeC, bodyPt[0], bodyPt[1], 1000);
  ok("体内单击=消费不外溢(return true)", rSingle === true);
  down(wC, nodeC, bodyPt[0], bodyPt[1], 1200);
  await sleep(10);
  ok("双击→clipboard 桩收全文(截断显示不碍全文复制)", clipCalls.length === 1 && clipCalls[0] === longText);
  ok("toast「已复制 N 字」落 body", bodyToasts().some((t) => t.includes(`已复制 ${longText.length} 字`)));
  ok("「已复制」闪示态落 properties", nodeC.properties.mySavePrompt.copiedAt > 0);

  // ── 双击判定:时序窗+位移容差 ───────────────────────────────────────
  clipCalls.length = 0;
  down(wC, nodeC, bodyPt[0], bodyPt[1], 5000);
  down(wC, nodeC, bodyPt[0], bodyPt[1], 5500);   // 间隔 500ms > 350ms
  await sleep(10);
  ok("超窗两次单击≠双击(零复制)", clipCalls.length === 0);
  down(wC, nodeC, bodyPt[0], bodyPt[1], 7000);
  down(wC, nodeC, bodyPt[0] + 12, bodyPt[1], 7100);  // 位移 12px > 5px
  await sleep(10);
  ok("超容差位移两次单击≠双击(零复制)", clipCalls.length === 0);
  ok("面板外 down 不消费(事件还给画布)", wC.mouse({ type: "pointerdown", timeStamp: 8000 }, [2, 2], nodeC) === false);
  ok("非 down 事件不消费", wC.mouse({ type: "pointermove", timeStamp: 8100 }, bodyPt, nodeC) === false);

  // ── clipboard 缺席→execCommand 兜底 ────────────────────────────────
  console.log("[兜底路]");
  Object.defineProperty(dom.window.navigator, "clipboard", { value: undefined, configurable: true });
  let execCalls = 0;
  dom.window.document.execCommand = (cmd) => { execCalls++; return cmd === "copy"; };
  clipCalls.length = 0;
  const nodeF = mkNode();
  P.onNodeCreated.call(nodeF);
  P.onExecuted.call(nodeF, { myPrompt: [{ text: "兜底复制文本", chars: 6 }] });
  nodeF.widgets[0].y = 150;
  P.onDrawBackground.call(nodeF, mkCtx());
  const wF = nodeF.widgets[0];
  const bodyF = [nodeF.__mySaveHits.body.x + 5, nodeF.__mySaveHits.body.y + 5];
  down(wF, nodeF, bodyF[0], bodyF[1], 100);
  down(wF, nodeF, bodyF[0], bodyF[1], 200);
  await sleep(10);
  ok("clipboard 缺席→隐藏 textarea+execCommand 兜底", execCalls === 1 && clipCalls.length === 0);

  // ── 折叠切换:头行单击翻/双击净零漂移 ───────────────────────────────
  console.log("[折叠]");
  const nodeT = mkNode();
  P.onNodeCreated.call(nodeT);
  P.onExecuted.call(nodeT, { myPrompt: [{ text: Array.from({ length: 40 }, (_, i) => `行${i}`).join("\n"), chars: 200 }] });
  nodeT.widgets[0].y = 150;
  P.onDrawBackground.call(nodeT, mkCtx());
  const wT = nodeT.widgets[0];
  const headPt = [nodeT.__mySaveHits.header.x + 5, nodeT.__mySaveHits.header.y + 10];
  const collapsed0 = nodeT.properties.mySavePrompt.collapsed;
  down(wT, nodeT, headPt[0], headPt[1], 100);
  ok("头行单击切折叠", nodeT.properties.mySavePrompt.collapsed === !collapsed0);
  const execBefore = execCalls;
  down(wT, nodeT, headPt[0], headPt[1], 400);   // 400-100=300ms<350ms → 双击
  await sleep(10);
  ok("头行双击=折叠净零漂移(第二击翻回)", nodeT.properties.mySavePrompt.collapsed === collapsed0);
  ok("头行双击同时复制全文(execCommand 兜底路再收一次)", execCalls === execBefore + 1);

  // ── serialize/configure:状态夹取与复原 ─────────────────────────────
  console.log("[存取]");
  const nodeS = mkNode();
  P.onNodeCreated.call(nodeS);
  const sRef = nodeS.properties.mySavePrompt;
  P.onSerialize.call(nodeS, {});
  ok("onSerialize 兜底归一(properties 恒在+引用不换)", nodeS.properties.mySavePrompt === sRef);
  const nodeR2 = mkNode();
  nodeR2.properties.mySavePrompt = { text: "旧工作流带来", chars: 6, collapsed: false, copiedAt: 0 };
  P.onConfigure.call(nodeR2);
  ok("onConfigure 夹取复原(引用不换+脏画布)", nodeR2.properties.mySavePrompt.text === "旧工作流带来"
    && nodeR2.dirty > 0 && nodeR2.__mySaveWrap === null);
  P.onConfigure.call(nodeR2);
  ok("onConfigure 重入幂等(状态引用稳)", nodeR2.properties.mySavePrompt.text === "旧工作流带来");

  console.log(`\nB7① 探针结果: ${pass} 通过 / ${fail} 失败`);
  if (fail > 0) process.exitCode = 1;
} finally {
  await rm(tmp, { recursive: true, force: true });
}
