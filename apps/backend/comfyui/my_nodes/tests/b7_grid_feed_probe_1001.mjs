#!/usr/bin/env node
/** B7③ 宫格拆分探针(1001,jsdom 仿真——本轮零引擎约束,引擎实弹延期):
 *  装载真 image-feed-actions.js(/scripts/* 两导入重定向到 jsdom 桩,余零改),
 *  几何对拍+浮层+批量流全场景断言:**几何对拍 B3**——期望值取自 python
 *  grid_cell_boxes 同输入产出(硬编码,禁由 JS 版反推),并读 B3 源
 *  my_image_grid_split.py 锚死 floor 边界算式与 MAX_GRID_AXIS=8(B3 改几何
 *  →源锚红→义务同步本探针,设计钉死)+ JS 版逐值一致(整除/余数吸收/
 *  1×1 恒等/不足抛中文)+ 不变量(并集=整幅/互不重叠/每格≥1px)+ 行列
 *  边界夹取(0→1/9→8)+ 阵列布局数学(显参与 tokens 缺省两路)+ 浮层
 *  (A5 警示在场/步进器 min1-max8/前缀默认 my_grid/网格线预览/每格像素
 *  读出)+ 批量流(fetch 桩按序收 4 个 FormData,名序 r0c0/r0c1/r1c0/
 *  r1c1;LiteGraph 桩 4 次 createNode+pos 布局+title 格标识;响应真值透传
 *  含撞名改名与 subfolder 形;change() 恰一次;toast 已拆 4 格)+ fail-fast
 *  (第 3 格 reject→第 4 格不再发·零 createNode·toast 含 k/n 与格号)。 */
import { JSDOM } from "jsdom";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB = join(HERE, "../web");
const EXT = join(WEB, "image-feed-actions.js");
const SIBLING = join(WEB, "save-prompt-panel.js");
const B3_PY = join(HERE, "../nodes/my_image_grid_split.py");   // B3 python 几何真源

const dom = new JSDOM("<!doctype html><html><body></body></html>",
  { url: "http://localhost/", pretendToBeVisual: true });
globalThis.window = dom.window;
globalThis.document = dom.window.document;

let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? " — " + extra : ""}`); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const jsonEq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const tmp = await mkdtemp(join(tmpdir(), "b7-grid-feed-probe-"));
try {
  // ── 桩:/scripts/app.js + /scripts/api.js ─────────────────────────────
  const stubApp = join(tmp, "stub-app.mjs");
  const stubApi = join(tmp, "stub-api.mjs");
  await writeFile(stubApp, `export const app = {
  __registry: [],
  registerExtension(ext) { this.__registry.push(ext); },
  canvas: null,
  graph: null,
};
`);
  await writeFile(stubApi, `export const api = new window.EventTarget();
`);
  const appUrl = pathToFileURL(stubApp).href;
  const apiUrl = pathToFileURL(stubApi).href;

  // ── 重定向装载:仅替换 /scripts/* 两导入,余零改 ──────────────────────
  const extSrc = await readFile(EXT, "utf8");
  const proxyExt = join(tmp, "ext.proxy.mjs");
  await writeFile(proxyExt, extSrc
    .replace('from "/scripts/app.js"', `from ${JSON.stringify(appUrl)}`)
    .replace('from "/scripts/api.js"', `from ${JSON.stringify(apiUrl)}`));

  // ── 静态门:AGPL 头逐字节 / 零道劫词 / 导入面 ────────────────────────
  console.log("[静态门]");
  const headerOf = async (p) => (await readFile(p, "utf8")).split("\n").slice(0, 3).join("\n") + "\n";
  ok("AGPL 头与兄弟件逐字节一致", (await headerOf(EXT)) === (await headerOf(SIBLING)));
  ok("新件零道劫词", !extSrc.includes("道劫"));
  ok("导入面恰 /scripts/* 两处(app+api,无其他依赖)",
    (extSrc.match(/from "\/scripts\//g) ?? []).length === 2
    && extSrc.includes('from "/scripts/app.js"') && extSrc.includes('from "/scripts/api.js"'));

  // ── 全局桩:LiteGraph / fetch / canvas 工厂 / 图 ──────────────────────
  const created = [];
  window.LiteGraph = {
    createNode(type) {
      const node = { type, title: "", pos: null, widgets: [{ name: "image", value: null }] };
      created.push(node);
      return node;
    },
  };
  const fetchCalls = [];
  let fetchResponder = null;
  globalThis.fetch = async (url, opts) => {
    const entry = { url: String(url), method: opts?.method, form: opts?.body };
    fetchCalls.push(entry);
    return fetchResponder(entry, fetchCalls.length);
  };
  const draws = [];
  const origCreate = document.createElement.bind(document);
  document.createElement = (tag, ...rest) => {
    const el = origCreate(tag, ...rest);
    if (String(tag).toLowerCase() === "canvas") {
      el.getContext = () => ({ drawImage: (...args) => draws.push(args) });
      el.toBlob = (cb) => { cb(new Blob(["png"], { type: "image/png" })); };
    }
    return el;
  };
  const { app } = await import(stubApp);
  const { api } = await import(stubApi);
  const mkGraph = () => {
    const g = { _nodes: [], addCount: 0 };
    g.add = (n) => { g.addCount++; g._nodes.push(n); };
    return g;
  };
  const rootGraph = mkGraph();
  rootGraph.changeCount = 0;
  rootGraph.change = function () { this.changeCount++; };
  const canvasGraph = mkGraph();
  app.graph = rootGraph;
  app.canvas = { graph: canvasGraph };   // 子图坑:当前显示图

  // ── 装载 ─────────────────────────────────────────────────────────────
  await import(proxyExt);
  const { FEED_ACTION_TOKENS: TOKENS, clampGridAxis, gridCellBoxes,
    gridLayoutPositions } = await import(proxyExt);
  const ext = app.__registry.find((e) => e.name === "my.image.feed");
  ok("扩展已注册(名 my.image.feed)", !!ext, `registry=${app.__registry.map(e => e.name).join(",")}`);

  // ── B3 源锚:几何真源公式在场(B3 改算式→此处红→义务同步本探针) ────
  console.log("[B3 源锚]");
  const pySrc = await readFile(B3_PY, "utf8");
  ok("B3 源锚:x 轴 floor 边界算式逐字在场",
    pySrc.includes("xs, xe = x0 + (w * c) // cols, x0 + (w * (c + 1)) // cols"));
  ok("B3 源锚:y 轴 floor 边界算式逐字在场",
    pySrc.includes("ys, ye = y0 + (h * r) // rows, y0 + (h * (r + 1)) // rows"));
  ok("B3 源锚:MAX_GRID_AXIS=8 在场", /MAX_GRID_AXIS = 8/.test(pySrc));

  // ── 几何对拍:期望值=B3 grid_cell_boxes 同输入产出(硬编码手算) ─────
  console.log("[几何对拍 B3]");
  // 100×60 盒 2×3:列界 0/33/66/100(33+33+34,右缘吸收余数),行界 0/30/60
  ok("100×60 盒 2×3 逐值一致(行主序,右缘吸收余数)", jsonEq(
    gridCellBoxes({ x: 0, y: 0, w: 100, h: 60 }, 2, 3),
    [{ sx: 0, sy: 0, sw: 33, sh: 30 }, { sx: 33, sy: 0, sw: 33, sh: 30 },
      { sx: 66, sy: 0, sw: 34, sh: 30 }, { sx: 0, sy: 30, sw: 33, sh: 30 },
      { sx: 33, sy: 30, sw: 33, sh: 30 }, { sx: 66, sy: 30, sw: 34, sh: 30 }]));
  // (10,20) 100×43 盒 3×2:行界 20/34/48/63(14+14+15,下缘吸收余数),列界 10/60/110
  ok("(10,20) 100×43 盒 3×2 逐值一致(下缘吸收余数)", jsonEq(
    gridCellBoxes({ x: 10, y: 20, w: 100, h: 43 }, 3, 2),
    [{ sx: 10, sy: 20, sw: 50, sh: 14 }, { sx: 60, sy: 20, sw: 50, sh: 14 },
      { sx: 10, sy: 34, sw: 50, sh: 14 }, { sx: 60, sy: 34, sw: 50, sh: 14 },
      { sx: 10, sy: 48, sw: 50, sh: 15 }, { sx: 60, sy: 48, sw: 50, sh: 15 }]));
  ok("1×1 恒等(整盒原样)", jsonEq(
    gridCellBoxes({ x: 5, y: 6, w: 100, h: 60 }, 1, 1),
    [{ sx: 5, sy: 6, sw: 100, sh: 60 }]));
  let threwW = false, threwH = false;
  try { gridCellBoxes({ x: 0, y: 0, w: 2, h: 10 }, 2, 3); } catch (e) { threwW = /像素不足/.test(e.message); }
  try { gridCellBoxes({ x: 0, y: 0, w: 10, h: 2 }, 3, 1); } catch (e) { threwH = /像素不足/.test(e.message); }
  ok("待切区宽<列数抛中文错(B3 同义)", threwW);
  ok("待切区高<行数抛中文错(B3 同义)", threwH);
  // 不变量:并集=整幅(每行宽和=w/每列高和=h)、互不重叠(边界衔接)、每格≥1px
  const sweep = gridCellBoxes({ x: 0, y: 0, w: 97, h: 53 }, 4, 3);
  const rowSums = [0, 1, 2, 3].map((r) =>
    sweep.filter((_, i) => Math.floor(i / 3) === r).reduce((s, b) => s + b.sw, 0));
  const colSums = [0, 1, 2].map((c) =>
    sweep.filter((_, i) => i % 3 === c).reduce((s, b) => s + b.sh, 0));
  ok("不变量:12 格·每行宽和=97·每列高和=53·每格≥1px(并集整幅互不重叠)",
    sweep.length === 12 && rowSums.every((s) => s === 97) && colSums.every((s) => s === 53)
    && sweep.every((b) => b.sw >= 1 && b.sh >= 1));

  // ── 行列夹取(步进器+纯函数双保险) ──────────────────────────────────
  console.log("[行列夹取]");
  ok("clampGridAxis:0→1·9→8·-3→1", clampGridAxis(0) === 1 && clampGridAxis(9) === 8
    && clampGridAxis(-3) === 1);
  ok("clampGridAxis:2.6→3(round)·垃圾值→1", clampGridAxis(2.6) === 3 && clampGridAxis("abc") === 1);

  // ── 阵列布局数学 ─────────────────────────────────────────────────────
  console.log("[阵列布局]");
  ok("gridLayoutPositions 显参数学(列对齐宫格列)", jsonEq(
    gridLayoutPositions({ x: 100, y: 50 }, 2, 2, { w: 270, h: 430 }, { x: 60, y: 80 }),
    [[100, 50], [430, 50], [100, 560], [430, 560]]));
  ok("gridLayoutPositions 缺省走 tokens(nodeColsGap/RowsGap·loadNodeW/H)",
    jsonEq(gridLayoutPositions({ x: 0, y: 0 }, 2, 2),
      [[0, 0], [TOKENS.loadNodeW + TOKENS.nodeColsGap, 0],
        [0, TOKENS.loadNodeH + TOKENS.nodeRowsGap],
        [TOKENS.loadNodeW + TOKENS.nodeColsGap, TOKENS.loadNodeH + TOKENS.nodeRowsGap]]));
  ok("tokens 设计钉死值(nodeColsGap60/nodeRowsGap80/maxGridAxis8)",
    TOKENS.nodeColsGap === 60 && TOKENS.nodeRowsGap === 80 && TOKENS.maxGridAxis === 8);

  // ── 节点工厂与浮层驱动 ───────────────────────────────────────────────
  let nextId = 1;
  const mkNode = (extra = {}) => Object.assign({
    id: String(nextId++),
    comfyClass: "KSampler",
    widgets: [],
    images: null,
    pos: [100, 200],
    size: [300, 400],
    addWidget(type, name, value, callback, options) {
      const w = { type, name, value, callback, options, serialize: options?.serialize };
      this.widgets.push(w);
      return w;
    },
  }, extra);
  const bodyToasts = () => [...document.body.querySelectorAll("div")]
    .filter((d) => d.style?.zIndex === "99999").map((d) => d.textContent);
  const prepareImage = async (naturalW, naturalH, dispW, dispH) => {
    const root = [...document.querySelectorAll(".my-feed-modal")].at(-1);
    const img = root.querySelector(".my-feed-img");
    Object.defineProperty(img, "naturalWidth", { value: naturalW, configurable: true });
    Object.defineProperty(img, "naturalHeight", { value: naturalH, configurable: true });
    Object.defineProperty(img, "getBoundingClientRect",
      { value: () => ({ left: 0, top: 0, width: dispW, height: dispH }), configurable: true });
    img.dispatchEvent(new dom.window.Event("load"));
    await sleep(20);
    return { img, stage: root.querySelector(".my-feed-stage"), root };
  };
  const clickByText = (root, selector, text) => {
    const el = [...root.querySelectorAll(selector)].find((b) => b.textContent === text);
    el.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true, cancelable: true }));
    return el;
  };

  // ── 浮层 DOM ─────────────────────────────────────────────────────────
  console.log("[浮层]");
  const ln = mkNode({ comfyClass: "LoadImage",
    widgets: [{ name: "image", value: "board_grid.png" }] });
  ext.nodeCreated(ln);
  const gridBtn = ln.widgets.find((w) => w.name === "宫格拆分");
  ok("LoadImage 节点挂「宫格拆分」按钮", !!gridBtn && gridBtn.serialize === false);
  gridBtn.callback();
  ok("按钮点击→浮层挂 body(标题 宫格拆分)", (() => {
    const t = document.querySelector(".my-feed-title");
    return !!document.querySelector(".my-feed-modal") && t?.textContent === "宫格拆分";
  })());
  let shell = await prepareImage(800, 480, 400, 240);
  ok("img src=/view 且 type=input(LoadImage 源)",
    shell.img.getAttribute("src").startsWith("/view?")
    && shell.img.getAttribute("src").includes("filename=board_grid.png")
    && shell.img.getAttribute("src").includes("type=input"));
  const a5 = shell.root.querySelector(".my-feed-a5");
  ok("A5 警示随浮层(中间产物+绝不当视频参考)",
    !!a5 && a5.textContent.includes("中间产物") && a5.textContent.includes("绝不当视频参考"));
  const rowsInput = shell.root.querySelector(".my-feed-rows");
  const colsInput = shell.root.querySelector(".my-feed-cols");
  ok("步进器 min=1·max=8·step=1·默认 2×2(B3 MAX_GRID_AXIS 同源)",
    rowsInput.min === "1" && rowsInput.max === "8" && rowsInput.step === "1"
    && rowsInput.value === "2" && colsInput.value === "2");
  ok("前缀默认 my_grid", shell.root.querySelector(".my-feed-prefix").value === "my_grid");
  ok("默认 2×2 网格线预览(1竖+1横)", shell.stage.querySelectorAll(".my-feed-gridline").length === 2);
  ok("每格像素读出(800×480 2×2→400×240)",
    shell.root.querySelector(".my-feed-readout").textContent.includes("400×240"));
  colsInput.value = "4";
  colsInput.dispatchEvent(new dom.window.Event("input"));
  ok("cols=4→网格线 3竖+1横", shell.stage.querySelectorAll(".my-feed-gridline").length === 4);
  colsInput.value = "9";
  colsInput.dispatchEvent(new dom.window.Event("input"));
  ok("cols 填 9→步进器面夹回 8(7竖+1横)", colsInput.value === "8"
    && shell.stage.querySelectorAll(".my-feed-gridline").length === 8);

  // ── 批量流:2×2 全成→节点阵列 ────────────────────────────────────────
  console.log("[批量流]");
  created.length = 0;
  fetchCalls.length = 0;
  draws.length = 0;
  rootGraph.changeCount = 0;
  colsInput.value = "2";
  colsInput.dispatchEvent(new dom.window.Event("input"));
  shell.root.querySelector(".my-feed-prefix").value = "board";
  fetchResponder = (entry, n) => ({ ok: true, json: async () => {
    const requested = String(entry.form.get("name"));
    if (n === 2) return { name: requested, subfolder: "gridfeed", type: "input" };
    if (n === 3) return { name: requested.replace(/\.png$/, " (1).png"), subfolder: "", type: "input" };
    return { name: requested, subfolder: "", type: "input" };
  } });
  clickByText(shell.root, ".my-feed-confirm", "确认");
  await sleep(60);

  ok("串行上传恰 4 次·名序 r0c0/r0c1/r1c0/r1c1(前缀可改)",
    fetchCalls.length === 4
    && fetchCalls.map((c) => c.form.get("name")).join(",")
      === "board_r0c0.png,board_r0c1.png,board_r1c0.png,board_r1c1.png"
    && fetchCalls.every((c) => c.url === "/upload/image" && c.method === "POST"
      && c.form.get("type") === "input"));
  ok("逐格 drawImage 几何=floor 边界四象限(0,0/400,0/0,240/400,240 各 400×240)",
    jsonEq(draws.map((d) => d.slice(1)), [
      [0, 0, 400, 240, 0, 0, 400, 240], [400, 0, 400, 240, 0, 0, 400, 240],
      [0, 240, 400, 240, 0, 0, 400, 240], [400, 240, 400, 240, 0, 0, 400, 240]]));
  ok("全成才建阵列:4 次 createNode 全 LoadImage+title 格标识",
    created.length === 4 && created.every((n) => n.type === "LoadImage")
    && created.map((n) => n.title).join(",") === "r0c0,r0c1,r1c0,r1c1");
  ok("widget 取响应真值(直名/subfolder 形/撞名改名形)",
    created[0].widgets[0].value === "board_r0c0.png"
    && created[1].widgets[0].value === "gridfeed/board_r0c1.png"
    && created[2].widgets[0].value === "board_r1c0 (1).png"
    && created[3].widgets[0].value === "board_r1c1.png");
  ok("阵列落当前显示图(canvas.graph,子图坑)恰 4 个",
    canvasGraph.addCount === 4 && canvasGraph._nodes.length === 4
    && rootGraph._nodes.length === 0);
  ok("pos 符合布局数学(源右侧起·列对齐·tokens 间距)",
    jsonEq(created.map((n) => n.pos), [[460, 200], [790, 200], [460, 710], [790, 710]]));
  ok("app.graph.change() 批量后恰一次", rootGraph.changeCount === 1);
  ok("toast 已拆 4 格+浮层即拆", bodyToasts().some((t) => t.includes("已拆 4 格"))
    && !document.querySelector(".my-feed-modal"));

  // ── fail-fast:第 3 格(r1c0)失败 ─────────────────────────────────────
  console.log("[fail-fast]");
  created.length = 0;
  fetchCalls.length = 0;
  fetchResponder = (entry, n) => {
    if (n === 3) throw new Error("network down");
    return { ok: true, json: async () => ({
      name: String(entry.form.get("name")), subfolder: "", type: "input" }) };
  };
  gridBtn.callback();
  shell = await prepareImage(800, 480, 400, 240);
  clickByText(shell.root, ".my-feed-confirm", "确认");
  await sleep(60);
  ok("第 3 格失败→第 4 格不再发(fetch 恰 3 次)", fetchCalls.length === 3);
  ok("fail-fast→零建节点(无半阵列)", created.length === 0 && canvasGraph.addCount === 4);
  ok("toast 含 k/n 进度与失败格号(已完成 2/4·r1c0)",
    bodyToasts().some((t) => t.includes("2/4") && t.includes("r1c0")));

  console.log(`\nB7③ 探针结果: ${pass} 通过 / ${fail} 失败`);
  if (fail > 0) process.exitCode = 1;
} finally {
  await rm(tmp, { recursive: true, force: true });
}
