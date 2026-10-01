#!/usr/bin/env node
/** B7② 裁切回灌探针(1001,jsdom 仿真——本轮零引擎约束,引擎实弹延期):
 *  装载真 image-feed-actions.js(/scripts/app.js+/scripts/api.js 两导入重定向
 *  到 jsdom 桩,余零改),按钮挂载→浮层框选→上传→建节点全场景断言:
 *  静态门(AGPL 头逐字节/零道劫词/导入面恰 app+api 两处)+ tokens 设计钉
 *  死值(gapX60/minCropPx8/maxGridAxis8)+ 按钮幂等挂载(LoadImage 直挂/
 *  LoadImageOutput 同族/预览节点经 executed+rAF 懒挂/二次零重复/无源零按钮/
 *  子图坑=只扫当前显示图 canvas.graph)+ resolveImageSource 三形态(裸名/
 *  subfolder 名/images 末元素/无源 null)+ constrainToRatio 全预设(自由+
 *  bounds 夹取/1:1/16:9/原图比/高界反调/非法 ratio 按自由)+ cropToSource
 *  (换算/超界夹取/过小抛中文/下限恰过)+ 浮层 DOM(挂 body/标题/img src
 *  filename·subfolder·type 全编码/预设按钮恰 7)+ 拖拽序列(MouseEvent
 *  mousedown→move→up)→框选盒状态+像素读出+比例锁方盒 + 确认链(fetch 桩:
 *  URL=/upload/image·POST·FormData 含 image/name/type;canvas 桩:drawImage
 *  源盒数学;LiteGraph 桩:createNode 收 LoadImage·落当前显示图·pos 数学·
 *  title;撞名改名响应真值透传 widget;change() 标脏;toast;modal 即拆)+
 *  上传失败→错误 toast 零建节点 + 框选过小→零上传 + 取消即拆。 */
import { JSDOM } from "jsdom";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB = join(HERE, "../web");
const EXT = join(WEB, "image-feed-actions.js");
const SIBLING = join(WEB, "save-prompt-panel.js");

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

const tmp = await mkdtemp(join(tmpdir(), "b7-crop-feed-probe-"));
try {
  // ── 桩:/scripts/app.js + /scripts/api.js(api=真 EventTarget) ─────────
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

  // ── 全局桩:LiteGraph / fetch / canvas 工厂 ───────────────────────────
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

  // ── 图桩:根图(canvas 子图坑断言用) ─────────────────────────────────
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
  app.canvas = { graph: canvasGraph };

  // ── 装载(先 jsdom 全局后动态 import,顺序保证桩构造时 window 就位)──
  await import(proxyExt);
  const { FEED_ACTION_TOKENS: TOKENS, resolveImageSource, constrainToRatio,
    cropToSource, clampGridAxis } = await import(proxyExt);
  const ext = app.__registry.find((e) => e.name === "my.image.feed");
  ok("扩展已注册(名 my.image.feed)", !!ext, `registry=${app.__registry.map(e => e.name).join(",")}`);

  // ── setup:executed 监听一次性闩(引擎 setup 由前端调;探针代调) ─────
  let executedBindings = 0;
  const origAddEv = api.addEventListener.bind(api);
  api.addEventListener = (type, fn, opts) => {
    if (type === "executed") executedBindings++;
    return origAddEv(type, fn, opts);
  };
  ext.setup(app);
  ok("setup 绑 executed 监听恰一次", executedBindings === 1, `实际=${executedBindings}`);
  ext.setup(app);
  ok("二次 setup 零新增监听(重入闩)", executedBindings === 1, `实际=${executedBindings}`);

  // ── tokens:设计钉死值 ───────────────────────────────────────────────
  console.log("[tokens]");
  ok("裁切回灌落点间距 gapX=60(设计钉死)", TOKENS.gapX === 60);
  ok("裁切最小面 minCropPx=8(设计钉死)", TOKENS.minCropPx === 8);
  ok("宫格轴上限 maxGridAxis=8(B3 同源钉死)", TOKENS.maxGridAxis === 8);
  ok("垂直基准 gapY=40(设计钉死)", TOKENS.gapY === 40);

  // ── 节点工厂 ─────────────────────────────────────────────────────────
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
  const buttonsOf = (node) => node.widgets.filter((w) => w.type === "button");
  const bodyToasts = () => [...document.body.querySelectorAll("div")]
    .filter((d) => d.style?.zIndex === "99999").map((d) => d.textContent);
  const fireExecuted = (detail) =>
    api.dispatchEvent(new dom.window.CustomEvent("executed", { detail }));

  // ── 按钮挂载 ─────────────────────────────────────────────────────────
  console.log("[按钮挂载]");
  const plain = mkNode();
  ext.nodeCreated(plain);
  ok("无源节点零按钮", plain.widgets.length === 0);
  const ln = mkNode({ comfyClass: "LoadImage",
    widgets: [{ name: "image", value: "sub/dir/ref.png" }] });
  ext.nodeCreated(ln);
  const btns = buttonsOf(ln);
  ok("LoadImage 直挂两按钮(裁切回灌+宫格拆分)", btns.length === 2
    && btns.map((b) => b.name).join(",") === "裁切回灌,宫格拆分");
  ok("按钮 serialize:false(序列化契约零影响)", btns.every((b) => b.serialize === false));
  ok("幂等标记 __myFeedBtn 落节点", ln.__myFeedBtn === true);
  ext.nodeCreated(ln);
  ok("二次 nodeCreated 零重复(按钮不重挂)", buttonsOf(ln).length === 2);
  const lno = mkNode({ comfyClass: "LoadImageOutput",
    widgets: [{ name: "image", value: "bare.png" }] });
  ext.nodeCreated(lno);
  ok("LoadImageOutput 同族直挂", buttonsOf(lno).length === 2);

  // 预览节点懒挂:node.images 执行后才出现→executed+rAF 一拍补挂
  const preview = mkNode({ comfyClass: "SaveImage" });
  preview.images = [{ filename: "p.png", subfolder: "", type: "output" }];
  canvasGraph._nodes = [preview];
  const rootTwin = mkNode({ comfyClass: "SaveImage",
    images: [{ filename: "q.png", subfolder: "", type: "output" }] });
  rootTwin.id = preview.id;   // 同 id 异对象:子图坑断言用(根图里的分身)
  rootGraph._nodes = [rootTwin];
  fireExecuted({ node: preview.id });
  await sleep(40);            // rAF 延一拍
  ok("预览节点经 executed+rAF 懒挂两按钮", buttonsOf(preview).length === 2);
  ok("子图坑:只扫当前显示图(canvas.graph),根图同 id 分身零触碰",
    buttonsOf(rootTwin).length === 0);
  fireExecuted({ node: "424242", display_node: preview.id });
  await sleep(40);
  ok("executed 二次零重复(display_node 路径可达+幂等)", buttonsOf(preview).length === 2);

  // ── resolveImageSource:三形态 ────────────────────────────────────────
  console.log("[resolveImageSource]");
  ok("LoadImage 裸名 → input 直取", JSON.stringify(resolveImageSource(mkNode({
    comfyClass: "LoadImage", widgets: [{ name: "image", value: "foo.png" }] })))
    === JSON.stringify({ filename: "foo.png", subfolder: "", type: "input" }));
  ok("LoadImage subfolder 名拆解", JSON.stringify(resolveImageSource(mkNode({
    comfyClass: "LoadImage", widgets: [{ name: "image", value: "sub/dir/foo.png" }] })))
    === JSON.stringify({ filename: "foo.png", subfolder: "sub/dir", type: "input" }));
  ok("预览路:images 末元素(多图取最新)", JSON.stringify(resolveImageSource(mkNode({
    images: [{ filename: "a.png", subfolder: "", type: "output" },
      { filename: "b.png", subfolder: "s", type: "output" }] })))
    === JSON.stringify({ filename: "b.png", subfolder: "s", type: "output" }));
  ok("无源 null / LoadImage 空值 null", resolveImageSource(mkNode()) === null
    && resolveImageSource(mkNode({ comfyClass: "LoadImage",
      widgets: [{ name: "image", value: "" }] })) === null);

  // ── constrainToRatio:全预设 ─────────────────────────────────────────
  console.log("[constrainToRatio]");
  const jsonEq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  ok("自由(ratio=null)+bounds 夹回界", jsonEq(
    constrainToRatio({ x: -10, y: 20, w: 500, h: 100 }, null, { x: 0, y: 0, w: 400, h: 240 }),
    { x: 0, y: 20, w: 400, h: 100 }));
  ok("1:1 锚点不动(w 不变,h=w)", jsonEq(
    constrainToRatio({ x: 50, y: 40, w: 200, h: 100 }, 1),
    { x: 50, y: 40, w: 200, h: 200 }));
  ok("16:9 高=宽×9/16(取整)", constrainToRatio({ x: 10, y: 10, w: 300, h: 100 }, 16 / 9).h === 169);
  ok("原图比(naturalW/naturalH)", jsonEq(
    constrainToRatio({ x: 0, y: 0, w: 300, h: 300 }, 800 / 480),
    { x: 0, y: 0, w: 300, h: 180 }));
  ok("高界反调:h 超界→h=bounds.h,w=h×ratio", jsonEq(
    constrainToRatio({ x: 0, y: 0, w: 300, h: 150 }, 1, { x: 0, y: 0, w: 400, h: 200 }),
    { x: 0, y: 0, w: 200, h: 200 }));
  ok("非法 ratio(0)按自由(不改尺寸)", jsonEq(
    constrainToRatio({ x: 5, y: 5, w: 100, h: 50 }, 0),
    { x: 5, y: 5, w: 100, h: 50 }));

  // ── cropToSource:换算/夹取/最小面 ───────────────────────────────────
  console.log("[cropToSource]");
  ok("显示→源像素换算(round)", jsonEq(
    cropToSource({ x: 10, y: 20, w: 100, h: 60 }, 0.5, 800, 480),
    { sx: 5, sy: 10, sw: 50, sh: 30 }));
  ok("超界夹回自然边界", jsonEq(
    cropToSource({ x: -20, y: -10, w: 4000, h: 2000 }, 1, 100, 100),
    { sx: 0, sy: 0, sw: 100, sh: 100 }));
  let threwTiny = false;
  try { cropToSource({ x: 0, y: 0, w: 2, h: 2 }, 1, 800, 480); }
  catch (error) { threwTiny = /过小/.test(error.message); }
  ok("小于 8px 守卫抛中文错", threwTiny);
  ok("恰 8px 下限放行", jsonEq(
    cropToSource({ x: 0, y: 0, w: 4, h: 4 }, 2, 800, 480),
    { sx: 0, sy: 0, sw: 8, sh: 8 }));
  ok("clampGridAxis 0→1 / 9→8(B3 上限同源)", clampGridAxis(0) === 1 && clampGridAxis(9) === 8);

  // ── 浮层 DOM + 拖拽 + 确认链 ─────────────────────────────────────────
  console.log("[浮层与确认链]");
  const prepareImage = async (naturalW, naturalH, dispW, dispH) => {
    // 取「最后一个」浮层(失败场景浮层不自闭,同屏可能叠多枚——只驱动最新)
    const root = [...document.querySelectorAll(".my-feed-modal")].at(-1);
    const img = root.querySelector(".my-feed-img");
    Object.defineProperty(img, "naturalWidth", { value: naturalW, configurable: true });
    Object.defineProperty(img, "naturalHeight", { value: naturalH, configurable: true });
    Object.defineProperty(img, "getBoundingClientRect",
      { value: () => ({ left: 0, top: 0, width: dispW, height: dispH }), configurable: true });
    const stage = root.querySelector(".my-feed-stage");
    Object.defineProperty(stage, "getBoundingClientRect",
      { value: () => ({ left: 0, top: 0, width: dispW, height: dispH }), configurable: true });
    img.dispatchEvent(new dom.window.Event("load"));
    await sleep(20);
    return { img, stage, root };
  };
  // 拖拽派发:与源件同一选型(PointerEvent 可用走 pointer 三件套,缺席退
  // mouse 三件套兜底)——派发事件族必须与源件绑定族一致才可达
  const PTR = typeof dom.window.PointerEvent === "function";
  const drag = (stage, root, x0, y0, x1, y1) => {
    const mkEv = (type, x, y) => (PTR
      ? new dom.window.PointerEvent(type, { clientX: x, clientY: y, button: 0, bubbles: true, cancelable: true })
      : new dom.window.MouseEvent(type, { clientX: x, clientY: y, button: 0, bubbles: true, cancelable: true }));
    stage.dispatchEvent(mkEv(PTR ? "pointerdown" : "mousedown", x0, y0));
    root.dispatchEvent(mkEv(PTR ? "pointermove" : "mousemove", x1, y1));
    root.dispatchEvent(mkEv(PTR ? "pointerup" : "mouseup", x1, y1));
  };
  const clickByText = (root, selector, text) => {
    const el = [...root.querySelectorAll(selector)].find((b) => b.textContent === text);
    el.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true, cancelable: true }));
    return el;
  };

  // 场景 A:LoadImage 源完整确认链(撞名改名真值)
  created.length = 0;
  fetchCalls.length = 0;
  draws.length = 0;
  rootGraph.changeCount = 0;
  fetchResponder = (entry) => ({ ok: true, json: async () => ({
    name: String(entry.form.get("name")).replace(/\.png$/, " (1).png"),
    subfolder: "", type: "input" }) });
  ln.widgets.find((w) => w.name === "裁切回灌").callback();
  ok("按钮点击→浮层挂 body(根 .my-feed-modal)", !!document.querySelector(".my-feed-modal"));
  let shell = await prepareImage(800, 480, 400, 240);
  const srcAttr = shell.img.getAttribute("src");
  ok("img src=/view 且 filename/subfolder/type 全编码",
    srcAttr.startsWith("/view?") && srcAttr.includes("filename=ref.png")
    && srcAttr.includes("subfolder=sub%2Fdir") && srcAttr.includes("type=input"));
  const presetLabels = [...shell.root.querySelectorAll(".my-feed-preset")].map((b) => b.textContent);
  ok("比例锁预设恰 7(自由/1:1/4:3/3:4/16:9/9:16/原图)",
    presetLabels.join(",") === "自由,1:1,4:3,3:4,16:9,9:16,原图");
  drag(shell.stage, shell.root, 100, 60, 300, 180);
  const selEl = shell.root.querySelector(".my-feed-sel");
  ok("拖拽序列(pointer 三件套)→框选盒状态(x/y/w/h)", selEl.style.left === "100px"
    && selEl.style.top === "60px" && selEl.style.width === "200px"
    && selEl.style.height === "120px");
  ok("像素读出:scale=2(800/400)→源 400×240px",
    shell.root.querySelector(".my-feed-readout").textContent.includes("400×240"));
  clickByText(shell.root, ".my-feed-preset", "1:1");
  ok("1:1 预设→框选盒变方(w=h)且夹回界内(60+200>240→top 40)",
    selEl.style.width === selEl.style.height && selEl.style.width === "200px"
    && selEl.style.top === "40px");
  clickByText(shell.root, ".my-feed-confirm", "确认");
  await sleep(30);

  ok("上传恰一次:URL=/upload/image·POST", fetchCalls.length === 1
    && fetchCalls[0].url === "/upload/image" && fetchCalls[0].method === "POST");
  const sentName = fetchCalls[0].form.get("name");
  ok("FormData 含 name(默认前缀 my_crop_时间戳.png)与 type=input",
    /^my_crop_\d+\.png$/.test(sentName) && fetchCalls[0].form.get("type") === "input");
  ok("FormData image part 文件名=name(服务端落名依据)",
    fetchCalls[0].form.get("image")?.name === sentName);
  ok("drawImage 源盒数学:框选{100,40,200,200}×scale2→源(200,80,400,400)",
    JSON.stringify(draws.at(-1).slice(1)) === JSON.stringify([200, 80, 400, 400, 0, 0, 400, 400]));
  ok("createNode 收 LoadImage 恰一次", created.length === 1 && created[0].type === "LoadImage");
  ok("撞名改名→widget 取响应真值 `… (1).png`(不用请求名)",
    created[0].widgets[0].value === `${sentName.replace(/\.png$/, "")} (1).png`);
  ok("节点落当前显示图(canvas.graph,子图坑)而非根图",
    canvasGraph._nodes.includes(created[0]) && !rootGraph._nodes.includes(created[0]));
  ok("pos 数学=源节点右侧 GAP 处+title 裁切回灌",
    JSON.stringify(created[0].pos) === JSON.stringify(
      [ln.pos[0] + ln.size[0] + TOKENS.gapX, ln.pos[1]]) && created[0].title === "裁切回灌");
  ok("app.graph.change() 兜底标脏恰一次", rootGraph.changeCount === 1);
  ok("toast 已回灌(含真名)且浮层即拆", bodyToasts().some((t) => t.includes("已回灌") && t.includes("(1).png"))
    && !document.querySelector(".my-feed-modal"));

  // 场景 B:上传失败→错误 toast+零建节点
  created.length = 0;
  fetchCalls.length = 0;
  fetchResponder = () => ({ ok: false, status: 500, json: async () => ({}) });
  ln.widgets.find((w) => w.name === "裁切回灌").callback();
  shell = await prepareImage(800, 480, 400, 240);
  drag(shell.stage, shell.root, 20, 20, 300, 200);
  clickByText(shell.root, ".my-feed-confirm", "确认");
  await sleep(30);
  ok("上传失败(HTTP 500)→错误 toast", bodyToasts().some((t) => t.includes("上传失败")));
  ok("上传失败→零建节点(createNode 恒 0)", created.length === 0);
  clickByText(shell.root, ".my-feed-cancel", "取消");   // 失败浮层留守→收走防串场

  // 场景 C:框选过小→零上传零建节点
  created.length = 0;
  fetchCalls.length = 0;
  ln.widgets.find((w) => w.name === "裁切回灌").callback();
  shell = await prepareImage(800, 480, 400, 240);
  drag(shell.stage, shell.root, 10, 10, 12, 12);   // 2×2 显示 px → 4×4 源 px < 8
  ok("过小框选→读出提示过小",
    shell.root.querySelector(".my-feed-readout").textContent.includes("过小"));
  clickByText(shell.root, ".my-feed-confirm", "确认");
  await sleep(30);
  ok("过小确认→中文 toast+零上传(fetch 恒 0)",
    bodyToasts().some((t) => t.includes("过小")) && fetchCalls.length === 0);
  clickByText(shell.root, ".my-feed-cancel", "取消");   // 同上,收走留守浮层

  // 场景 D:取消即拆
  ln.widgets.find((w) => w.name === "裁切回灌").callback();
  shell = await prepareImage(800, 480, 400, 240);
  clickByText(shell.root, ".my-feed-cancel", "取消");
  ok("取消→浮层即拆(zero 残留)", !document.querySelector(".my-feed-modal"));

  console.log(`\nB7② 探针结果: ${pass} 通过 / ${fail} 失败`);
  if (fail > 0) process.exitCode = 1;
} finally {
  await rm(tmp, { recursive: true, force: true });
}
