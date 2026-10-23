// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
import { app } from "/scripts/app.js";
import { api } from "/scripts/api.js";

/**
 * 画布图像源动作件(1001 TE-MAN B7 子件②③共件):
 * ② 裁切回灌——画布上任一可解析图像源(执行预览 node.images 末元素 /
 *    LoadImage 家 image widget)挂「裁切回灌」按钮,DOM 浮层框选(比例锁
 *    预设)→离屏 canvas 裁源像素→POST /upload/image(overwrite 缺省撞名
 *    自动改名,以响应 name 为真值)→新 LoadImage 节点落源节点右侧(回灌=
 *    i2i/edit 下一跳现成输入)。
 * ③ 宫格拆分——同附着面第二枚按钮,原图+网格线预览(rows/cols 1-8,
 *    B3 MAX_GRID_AXIS 同源)→逐格裁切→串行上传(名={前缀}_r{r}c{c}.png)
 *    全成才一次性建 LoadImage 节点阵列(fail-fast:任一格失败零建节点,
 *    已传文件留 input 无害,重试撞名自动改名);gridCellBoxes 的 floor
 *    边界几何与 B3 python grid_cell_boxes 逐字同义(并集=整幅/互不重叠/
 *    右下缘吸收余数),探针硬编码对拍锚死;A5 铁约束警示随浮层(宫格图
 *    只作中间产物、拆分后再用,绝不当视频参考——B3 同款口径)。
 * 工程纪律(照仓内先例):
 * - 按钮走 node.addWidget("button",…,{serialize:false})(绑定项目按钮先
 *   例),幂等标记 node.__myFeedBtn;node.images 执行后才出现→预览节点
 *   懒挂:setup 一次性闩挂 api executed 监听,rAF 延一拍后按 detail.node/
 *   display_node 在「当前显示图」里找节点补挂(B6 事件口径)。
 * - 子图坑(b8 件注):开子图只切 canvas.graph,app.graph 恒返根图——
 *   一切扫描/建节点必取 app.canvas?.graph ?? app.graph。
 * - DOM 浮层挂 document.body 全屏 backdrop(登录遮蔽先例),事件只在
 *   层内捕获(down 在舞台、move/up 收在浮层根),画布零事件交叉;按钮
 *   面即用即拆,不嵌画布 DOM。
 * - graph.add 无 beforeChange/afterChange 包裹→建节点后 app.graph?.change?.()
 *   统一兜底标脏。
 */

// ── tokens(设计单源位=theme.js;本批 ①②③ 并行实现文件面互斥,theme.js
//    不在本件可写面——先模块内单源导出+探针锁值,归并轮统一迁 theme.js)──
export const FEED_ACTION_TOKENS = {
  gapX: 60,           // ② 裁切回灌节点落点:源节点右侧间距(px;③ 阵列起点同式)
  gapY: 40,           // 设计 token 表成员(垂直基准;② 落点同排、③ 行距走
                       // nodeRowsGap,本件暂不消费——留档防漂)
  minCropPx: 8,       // 裁切最小面(px,源像素;探针锁值)
  modalMaxW: 920,     // 浮层面板宽上限(px)
  modalMaxH: 720,     // 浮层面板高上限(px)
  maxGridAxis: 8,     // ③ 行列上限(B3 MAX_GRID_AXIS 同源;探针对拍锚)
  nodeColsGap: 60,    // ③ 阵列列间距(px;列对齐宫格列)
  nodeRowsGap: 80,    // ③ 阵列行间距(px)
  loadNodeW: 270,     // ③ 阵列 LoadImage 布局尺寸(仅布阵数学,非节点真实尺寸)
  loadNodeH: 430,
  toastMs: 1500,      // DOM toast 消隐时长(ms)
};

const TOKENS = FEED_ACTION_TOKENS;
const FEED_MARKER = "__myFeedBtn";
const LOAD_IMAGE_CLASSES = new Set(["LoadImage", "LoadImageOutput"]);
const CROP_DEFAULT_PREFIX = "my_crop";
const GRID_DEFAULT_PREFIX = "my_grid";
const RATIO_PRESETS = [
  ["自由", null], ["1:1", 1], ["4:3", 4 / 3], ["3:4", 3 / 4],
  ["16:9", 16 / 9], ["9:16", 9 / 16], ["原图", "natural"],
];

// 指针事件族:PointerEvent 可用走 pointer 三件套(引擎现役面),缺席
// (老 webview/jsdom 探针)退 mouse 三件套兜底——两路共用同一处理逻辑。
const POINTER_OK = typeof window !== "undefined"
  && typeof window.PointerEvent === "function";
const EVT_DOWN = POINTER_OK ? "pointerdown" : "mousedown";
const EVT_MOVE = POINTER_OK ? "pointermove" : "mousemove";
const EVT_UP = POINTER_OK ? "pointerup" : "mouseup";

const nextFrame = (fn) => {
  try {
    if (typeof requestAnimationFrame === "function") return requestAnimationFrame(fn);
  } catch { /* 无 rAF 环境走宏任务兜底 */ }
  return setTimeout(fn, 0);
};

/** 当前显示图(子图坑:开子图只切 canvas.graph,app.graph 恒返根图)。 */
const currentGraph = () => app.canvas?.graph ?? app.graph;

const clampInt = (v, lo, hi) => Math.min(Math.max(Math.round(v), lo), Math.max(lo, hi));

// ── 图像源解析(两路;探针直测面) ─────────────────────────────────────

/** 预览路:node.images 末元素(执行预览,SaveImage/任一 OUTPUT_NODE 预览)。 */
function previewImageOf(node) {
  const images = Array.isArray(node?.images) ? node.images : [];
  const last = images[images.length - 1];
  if (!last || typeof last.filename !== "string" || !last.filename) return null;
  return {
    filename: last.filename,
    subfolder: typeof last.subfolder === "string" ? last.subfolder : "",
    type: typeof last.type === "string" ? last.type : "output",
  };
}

/** LoadImage 路:LoadImage 家(comfyClass 判定)image widget 值拆
 *  subfolder/name(取值口径与写入同构),type=input。 */
function loadImageValueOf(node) {
  if (!LOAD_IMAGE_CLASSES.has(String(node?.comfyClass ?? ""))) return null;
  const widget = (node.widgets || []).find((w) => w?.name === "image");
  const value = widget && typeof widget.value === "string" ? widget.value.trim() : "";
  if (!value) return null;
  const slash = value.lastIndexOf("/");
  const subfolder = slash >= 0 ? value.slice(0, slash) : "";
  const filename = slash >= 0 ? value.slice(slash + 1) : value;
  if (!filename) return null;
  return { filename, subfolder, type: "input" };
}

/** 两路解析:预览路优先,LoadImage 路兜底;两不中=null(不挂按钮/点击提示)。 */
export function resolveImageSource(node) {
  return previewImageOf(node) || loadImageValueOf(node) || null;
}

// ── 纯函数面(探针直测) ───────────────────────────────────────────────

/** 比例锁约束(盒先归一,锚点=左上角):ratio=null/非有效值=自由;
 *  有效时 h=w/ratio;超 bounds 高/宽以 bounds 为准反调;最后 x/y 夹回
 *  bounds 内。返回新盒(不改入参,值取整)。 */
export function constrainToRatio(box, ratio, bounds = null) {
  let w = Math.max(Number(box?.w) || 0, 1);
  let h = Math.max(Number(box?.h) || 0, 1);
  const r = Number(ratio);
  const lock = Number.isFinite(r) && r > 0 ? r : null;
  const maxW = bounds ? Math.max(Number(bounds.w) || 0, 1) : null;
  const maxH = bounds ? Math.max(Number(bounds.h) || 0, 1) : null;
  if (lock) {
    h = w / lock;
    if (maxH != null && h > maxH) { h = maxH; w = h * lock; }
    if (maxW != null && w > maxW) { w = maxW; h = w / lock; }
  }
  if (maxW != null && w > maxW) w = maxW;
  if (maxH != null && h > maxH) h = maxH;
  let x = Number(box?.x) || 0;
  let y = Number(box?.y) || 0;
  if (bounds) {
    const bx = Number(bounds.x) || 0;
    const by = Number(bounds.y) || 0;
    x = Math.min(Math.max(x, bx), bx + maxW - w);
    y = Math.min(Math.max(y, by), by + maxH - h);
  }
  return { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
}

/** 显示坐标盒→源像素盒:round 取整、夹回自然边界;任一边小于 minCropPx
 *  抛中文错(浮层确认路接住转 toast,零上传零建节点)。 */
export function cropToSource(box, scale, naturalW, naturalH) {
  const k = Number(scale) > 0 ? Number(scale) : 1;
  const W = Math.max(Math.floor(Number(naturalW) || 0), 0);
  const H = Math.max(Math.floor(Number(naturalH) || 0), 0);
  const bx = Number(box?.x) || 0;
  const by = Number(box?.y) || 0;
  const bw = Number(box?.w) || 0;
  const bh = Number(box?.h) || 0;
  const sx = clampInt(bx * k, 0, W);
  const sy = clampInt(by * k, 0, H);
  const ex = clampInt((bx + bw) * k, 0, W);
  const ey = clampInt((by + bh) * k, 0, H);
  const sw = ex - sx;
  const sh = ey - sy;
  if (sw < TOKENS.minCropPx || sh < TOKENS.minCropPx) {
    throw new Error(`裁切区过小:取整后 ${sw}×${sh}px,小于 ${TOKENS.minCropPx}px 下限——请扩大框选`);
  }
  return { sx, sy, sw, sh };
}

/** 行列夹取 1..maxGridAxis(步进器+纯函数双保险;round 取整,垃圾值→1)。 */
export function clampGridAxis(value) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return 1;
  return Math.min(Math.max(n, 1), TOKENS.maxGridAxis);
}

/** 像素盒{x,y,w,h}→rows×cols 格盒列表(行主序 r0c0…)。
 *  floor 边界几何与 B3 python grid_cell_boxes 逐字同义:x0+(w*c)//cols——
 *  并集恰=原盒、格间互不重叠、右/下缘吸收整除余数;待切区宽/高不足
 *  列/行数抛中文错(B3 同义)。 */
export function gridCellBoxes(box, rows, cols) {
  const R = clampGridAxis(rows);
  const C = clampGridAxis(cols);
  const x0 = Number(box?.x) || 0;
  const y0 = Number(box?.y) || 0;
  const w = Number(box?.w) || 0;
  const h = Number(box?.h) || 0;
  if (w < C || h < R) {
    throw new Error(`宫格拆分像素不足:待切区 ${w}×${h}px 撑不起 ${R}×${C} 格(每格至少 1 像素)——请减小行列数`);
  }
  const boxes = [];
  for (let r = 0; r < R; r++) {
    const ys = y0 + Math.floor((h * r) / R);
    const ye = y0 + Math.floor((h * (r + 1)) / R);
    for (let c = 0; c < C; c++) {
      const xs = x0 + Math.floor((w * c) / C);
      const xe = x0 + Math.floor((w * (c + 1)) / C);
      boxes.push({ sx: xs, sy: ys, sw: xe - xs, sh: ye - ys });
    }
  }
  return boxes;
}

/** 阵列落点(行主序与 gridCellBoxes 同序,列对齐宫格列)。 */
export function gridLayoutPositions(start, rows, cols, nodeSize, gaps) {
  const R = clampGridAxis(rows);
  const C = clampGridAxis(cols);
  const x0 = Number(start?.x) || 0;
  const y0 = Number(start?.y) || 0;
  const nw = Number(nodeSize?.w) || TOKENS.loadNodeW;
  const nh = Number(nodeSize?.h) || TOKENS.loadNodeH;
  const gx = gaps && gaps.x != null ? Number(gaps.x) : TOKENS.nodeColsGap;
  const gy = gaps && gaps.y != null ? Number(gaps.y) : TOKENS.nodeRowsGap;
  const out = [];
  for (let r = 0; r < R; r++) {
    for (let c = 0; c < C; c++) {
      out.push([x0 + c * (nw + gx), y0 + r * (nh + gy)]);
    }
  }
  return out;
}

// ── 上传/建节点链(②③共用;探针桩面) ─────────────────────────────────

/** POST /upload/image(同源零令牌):multipart image=裁切 Blob(part 文件名
 *  即服务端落名依据)+name(可读副本,服务端不消费)+type=input;overwrite
 *  不传=撞名自动改名 `name (1).png`——**以响应 name/subfolder 为真值**
 *  (禁用请求名),返回响应对象 {name,subfolder,type,…}。 */
export async function uploadInputImage(blob, name) {
  const form = new FormData();
  form.append("image", blob, name);
  form.append("name", name);
  form.append("type", "input");
  const response = await fetch("/upload/image", { method: "POST", body: form });
  if (!response?.ok) throw new Error(`上传失败(HTTP ${response?.status})`);
  const data = await response.json().catch(() => null);
  if (!data || typeof data.name !== "string" || !data.name) {
    throw new Error("上传失败:响应缺文件名");
  }
  return data;
}

/** 建 LoadImage 节点:LiteGraph.createNode→graph.add→设 image widget 值
 *  (subfolder?`${subfolder}/${name}`:name 口径)→title。graph 由调用方
 *  取当前显示图传入(子图坑);add 后的标脏由调用方 app.graph.change() 兜底。 */
export function createLoadImage(graph, value, pos, title) {
  const lg = (typeof window !== "undefined" && window.LiteGraph)
    || (typeof globalThis !== "undefined" ? globalThis.LiteGraph : null);
  const node = typeof lg?.createNode === "function" ? lg.createNode("LoadImage") : null;
  if (!node) throw new Error("画布未就绪(LiteGraph 缺席),无法创建 LoadImage 节点");
  if (Array.isArray(pos) && Number.isFinite(Number(pos[0])) && Number.isFinite(Number(pos[1]))) {
    node.pos = [Number(pos[0]), Number(pos[1])];
  }
  if (!graph || typeof graph.add !== "function") {
    throw new Error("画布未就绪(图对象缺席),无法添加节点");
  }
  graph.add(node);
  const widget = (node.widgets || []).find((w) => w?.name === "image");
  if (widget) widget.value = value;
  else node.widgets_values = [value];   // widget 未实例化兜底(configure 面消费)
  if (title) node.title = title;
  return node;
}

/** 离屏裁切:OffscreenCanvas 可用则用(大图少卡顿),否则 DOM canvas;
 *  drawImage 九参裁源像素→PNG Blob(确认时一次执行,非逐帧)。 */
export async function cropImageBlob(img, sx, sy, sw, sh) {
  let canvas;
  if (typeof OffscreenCanvas === "function") {
    canvas = new OffscreenCanvas(sw, sh);
  } else {
    canvas = document.createElement("canvas");
    canvas.width = sw;
    canvas.height = sh;
  }
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("裁切失败:画布 2D 上下文不可用");
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
  if (typeof canvas.convertToBlob === "function") {
    return canvas.convertToBlob({ type: "image/png" });
  }
  return new Promise((resolve, reject) => canvas.toBlob(
    (blob) => (blob ? resolve(blob) : reject(new Error("裁切失败:PNG 编码失败"))),
    "image/png"));
}

/** /view 取原图 URL(filename/subfolder/type 全编码)。 */
function viewUrl(source) {
  const q = new URLSearchParams();
  q.set("filename", String(source?.filename ?? ""));
  q.set("subfolder", String(source?.subfolder ?? ""));
  q.set("type", String(source?.type ?? "output"));
  return `/view?${q.toString()}`;
}

// ── DOM 浮层(挂 body;事件只在层内,画布零交叉) ───────────────────────

const whenImageReady = (img) => new Promise((resolve) => {
  const finish = () => resolve({
    naturalW: Number(img.naturalWidth) || 0,
    naturalH: Number(img.naturalHeight) || 0,
  });
  if (img.complete && Number(img.naturalWidth) > 0) { finish(); return; }
  img.addEventListener("load", finish, { once: true });
  img.addEventListener("error", finish, { once: true });
});

const toast = (message) => {
  if (typeof document === "undefined" || !document.body) return;
  const el = document.createElement("div");
  el.textContent = message;
  el.style.cssText = "position:fixed;right:16px;bottom:16px;z-index:99999;"
    + "padding:8px 14px;border-radius:8px;background:rgba(10,14,24,0.88);"
    + "color:rgba(240,244,250,0.95);font-size:12px;pointer-events:none;";
  document.body.appendChild(el);
  setTimeout(() => el.remove(), TOKENS.toastMs);
};

const sanitizePrefix = (value, fallback) => {
  const s = String(value ?? "").replace(/[\/\\:*?"<>|\s]+/g, "").trim();
  return s || fallback;
};

function buildModal(title) {
  const root = document.createElement("div");
  root.className = "my-feed-modal";
  root.style.cssText = "position:fixed;inset:0;z-index:99998;display:flex;"
    + "align-items:center;justify-content:center;background:rgba(6,10,18,0.62);";
  const panel = document.createElement("div");
  panel.className = "my-feed-panel";
  panel.style.cssText = "display:flex;flex-direction:column;gap:10px;padding:14px 16px;"
    + `max-width:${TOKENS.modalMaxW}px;max-height:${TOKENS.modalMaxH}px;`
    + "background:#141926;color:rgba(240,244,250,0.96);border-radius:12px;"
    + "box-shadow:0 12px 40px rgba(0,0,0,0.5);font-size:12px;font-family:sans-serif;";
  root.appendChild(panel);
  const head = document.createElement("div");
  head.className = "my-feed-title";
  head.textContent = title;
  head.style.cssText = "font-size:14px;font-weight:600;";
  panel.appendChild(head);
  const stage = document.createElement("div");
  stage.className = "my-feed-stage";
  stage.style.cssText = "position:relative;display:inline-block;line-height:0;"
    + "max-width:100%;overflow:hidden;cursor:crosshair;user-select:none;touch-action:none;";
  const img = document.createElement("img");
  img.className = "my-feed-img";
  img.alt = "source";
  img.style.cssText = `display:block;max-width:100%;max-height:${Math.max(TOKENS.modalMaxH - 200, 120)}px;`
    + "pointer-events:none;";
  stage.appendChild(img);
  panel.appendChild(stage);
  return { root, panel, stage, img };
}

const addRow = (panel, className) => {
  const row = document.createElement("div");
  row.className = className;
  row.style.cssText = "display:flex;flex-wrap:wrap;gap:6px;align-items:center;";
  panel.appendChild(row);
  return row;
};

const mkButton = (label, className) => {
  const b = document.createElement("button");
  b.type = "button";
  b.className = className;
  b.textContent = label;
  b.style.cssText = "padding:4px 10px;border-radius:6px;border:1px solid rgba(255,255,255,0.16);"
    + "background:rgba(255,255,255,0.06);color:rgba(240,244,250,0.95);cursor:pointer;font-size:12px;";
  return b;
};

const mkTextInput = (className, value, width) => {
  const input = document.createElement("input");
  input.type = "text";
  input.className = className;
  input.value = value;
  input.style.cssText = `width:${width}px;padding:4px 8px;border-radius:6px;`
    + "border:1px solid rgba(255,255,255,0.16);background:rgba(0,0,0,0.3);"
    + "color:inherit;font-size:12px;";
  return input;
};

const mkNumberInput = (className, value) => {
  const input = document.createElement("input");
  input.type = "number";
  input.className = className;
  input.min = "1";
  input.max = String(TOKENS.maxGridAxis);
  input.step = "1";
  input.value = String(value);
  input.style.cssText = "width:64px;padding:4px 8px;border-radius:6px;"
    + "border:1px solid rgba(255,255,255,0.16);background:rgba(0,0,0,0.3);"
    + "color:inherit;font-size:12px;";
  return input;
};

/** 浮层通用关闭面:取消按钮+backdrop 点按+Escape;即用即拆。 */
function wireClose(shell, close) {
  shell.cancelBtn.addEventListener("click", close);
  shell.root.addEventListener(EVT_DOWN, (ev) => {
    if (ev.target === shell.root) close();   // 只有点中 backdrop 本体才关(拖拽面不误触)
  });
  shell.keyHandler = (ev) => { if (ev.key === "Escape") close(); };
  document.addEventListener("keydown", shell.keyHandler);
}

const tearDown = (shell) => {
  shell.root.remove();
  if (shell.keyHandler && typeof document.removeEventListener === "function") {
    document.removeEventListener("keydown", shell.keyHandler);
  }
};

// ── ② 裁切回灌浮层 ────────────────────────────────────────────────────

function openCropModal(node) {
  const src = resolveImageSource(node);
  if (!src) { toast("该节点当前没有可取图片(执行出图或选择图片后再试)"); return; }
  const shell = buildModal("裁切回灌");
  const { root, stage, img } = shell;

  const selBox = document.createElement("div");
  selBox.className = "my-feed-sel";
  selBox.style.cssText = "position:absolute;display:none;border:1px solid rgba(52,211,153,0.95);"
    + "background:rgba(52,211,153,0.14);pointer-events:none;";
  stage.appendChild(selBox);

  const presetRow = addRow(shell.panel, "my-feed-presets");
  const readout = document.createElement("div");
  readout.className = "my-feed-readout";
  readout.style.cssText = "color:rgba(178,188,204,0.9);";
  shell.panel.appendChild(readout);
  const nameRow = addRow(shell.panel, "my-feed-name");
  const prefixLabel = document.createElement("span");
  prefixLabel.textContent = "文件名前缀";
  const prefixInput = mkTextInput("my-feed-prefix", CROP_DEFAULT_PREFIX, 160);
  nameRow.append(prefixLabel, prefixInput);
  const actionRow = addRow(shell.panel, "my-feed-actions");
  const confirmBtn = mkButton("确认", "my-feed-confirm");
  shell.cancelBtn = mkButton("取消", "my-feed-cancel");
  actionRow.append(confirmBtn, shell.cancelBtn);

  const close = () => tearDown(shell);
  wireClose(shell, close);
  readout.textContent = "原图加载中…";
  document.body.appendChild(root);

  void (async () => {
    img.src = viewUrl(src);
    const { naturalW, naturalH } = await whenImageReady(img);
    if (!root.isConnected) return;   // 加载期间用户已关闭
    if (!naturalW || !naturalH) { toast("原图加载失败——无法裁切"); close(); return; }
    const rect = img.getBoundingClientRect();
    const dispW = Number(rect?.width) > 0 ? Number(rect.width) : naturalW;
    const dispH = Number(rect?.height) > 0 ? Number(rect.height) : naturalH;
    const scale = naturalW / dispW;   // 显示 px → 源 px

    const state = { sel: null, ratio: null };   // ratio:null=自由|number|"natural"
    const localPoint = (ev) => {
      const r = stage.getBoundingClientRect();
      return [(Number(ev.clientX) || 0) - (Number(r?.left) || 0),
        (Number(ev.clientY) || 0) - (Number(r?.top) || 0)];
    };
    const ratioValue = () => (state.ratio === "natural" ? naturalW / naturalH : state.ratio);
    const applyRatio = () => {
      if (!state.sel || ratioValue() == null) return;
      state.sel = constrainToRatio(state.sel, ratioValue(), { x: 0, y: 0, w: dispW, h: dispH });
    };
    const render = () => {
      if (!state.sel) { selBox.style.display = "none"; return; }
      selBox.style.display = "block";
      selBox.style.left = `${state.sel.x}px`;
      selBox.style.top = `${state.sel.y}px`;
      selBox.style.width = `${state.sel.w}px`;
      selBox.style.height = `${state.sel.h}px`;
      try {
        const s = cropToSource(state.sel, scale, naturalW, naturalH);
        readout.textContent = `裁切 ${s.sw}×${s.sh}px(源图 ${naturalW}×${naturalH};落点 ${s.sx},${s.sy})`;
      } catch {
        readout.textContent = `框选过小(源像素须 ≥${TOKENS.minCropPx}px)`;
      }
    };

    // 拖拽框选:down 在舞台、move/up 收在浮层根(层内捕获,画布零交叉)
    let drag = null;
    stage.addEventListener(EVT_DOWN, (ev) => {
      if (ev.button !== undefined && Number(ev.button) !== 0) return;
      const [px, py] = localPoint(ev);
      drag = { x0: px, y0: py };
      state.sel = { x: px, y: py, w: 0, h: 0 };
      applyRatio();
      render();
      if (typeof ev.preventDefault === "function") ev.preventDefault();
    });
    root.addEventListener(EVT_MOVE, (ev) => {
      if (!drag) return;
      const [px, py] = localPoint(ev);
      state.sel = {
        x: Math.min(drag.x0, px), y: Math.min(drag.y0, py),
        w: Math.abs(px - drag.x0), h: Math.abs(py - drag.y0),
      };
      applyRatio();
      render();
    });
    root.addEventListener(EVT_UP, () => { drag = null; });

    // 比例锁预设:自由/1:1/4:3/3:4/16:9/9:16/原图
    for (const [label, value] of RATIO_PRESETS) {
      const b = mkButton(label, "my-feed-preset");
      b.addEventListener("click", () => {
        state.ratio = value;
        applyRatio();
        render();
      });
      presetRow.appendChild(b);
    }
    readout.textContent = "在图上拖拽框选要裁切的区域";

    const run = async () => {
      if (!state.sel) { toast("请先在图上框选裁切区域"); return; }
      try {
        const box = cropToSource(state.sel, scale, naturalW, naturalH);   // 过小→中文抛
        const blob = await cropImageBlob(img, box.sx, box.sy, box.sw, box.sh);
        const prefix = sanitizePrefix(prefixInput.value, CROP_DEFAULT_PREFIX);
        const up = await uploadInputImage(blob, `${prefix}_${Date.now()}.png`);
        const value = up.subfolder ? `${up.subfolder}/${up.name}` : up.name;
        createLoadImage(currentGraph(), value,
          [Number(node.pos?.[0]) + Number(node.size?.[0]) + TOKENS.gapX, Number(node.pos?.[1])],
          "裁切回灌");
        app.graph?.change?.();   // add 无 change 包裹,兜底标脏
        toast(`已回灌:${up.name}`);
        close();
      } catch (error) {
        toast(error?.message || String(error));   // 失败=错误 toast+零建节点
      }
    };
    confirmBtn.addEventListener("click", () => { void run(); });
  })();
}

// ── ③ 宫格拆分浮层 ────────────────────────────────────────────────────

function openGridModal(node) {
  const src = resolveImageSource(node);
  if (!src) { toast("该节点当前没有可取图片(执行出图或选择图片后再试)"); return; }
  const shell = buildModal("宫格拆分");
  const { root, stage, img } = shell;

  // A5 铁约束警示随浮层(B3 同款口径):宫格只作中间产物,拆分后再用
  const warn = document.createElement("div");
  warn.className = "my-feed-a5";
  warn.style.cssText = "color:#fbbf24;padding:6px 8px;border:1px solid rgba(251,191,36,0.35);"
    + "border-radius:6px;";
  warn.textContent = "⚠️ A5 铁约束:宫格图只作中间产物、拆分后再用;宫格图本身绝不当视频参考"
    + "——视频模型会把宫格版式带进成片(版式泄漏)。";
  shell.panel.appendChild(warn);

  const gridRow = addRow(shell.panel, "my-feed-grid");
  const rowsLabel = document.createElement("span");
  rowsLabel.textContent = "行数";
  const rowsInput = mkNumberInput("my-feed-rows", 2);
  const colsLabel = document.createElement("span");
  colsLabel.textContent = "列数";
  const colsInput = mkNumberInput("my-feed-cols", 2);
  gridRow.append(rowsLabel, rowsInput, colsLabel, colsInput);
  const nameRow = addRow(shell.panel, "my-feed-name");
  const prefixLabel = document.createElement("span");
  prefixLabel.textContent = "文件名前缀";
  const prefixInput = mkTextInput("my-feed-prefix", GRID_DEFAULT_PREFIX, 160);
  nameRow.append(prefixLabel, prefixInput);
  const readout = document.createElement("div");
  readout.className = "my-feed-readout";
  readout.style.cssText = "color:rgba(178,188,204,0.9);";
  shell.panel.appendChild(readout);
  const actionRow = addRow(shell.panel, "my-feed-actions");
  const confirmBtn = mkButton("确认", "my-feed-confirm");
  shell.cancelBtn = mkButton("取消", "my-feed-cancel");
  actionRow.append(confirmBtn, shell.cancelBtn);

  const close = () => tearDown(shell);
  wireClose(shell, close);
  readout.textContent = "原图加载中…";
  document.body.appendChild(root);

  void (async () => {
    img.src = viewUrl(src);
    const { naturalW, naturalH } = await whenImageReady(img);
    if (!root.isConnected) return;
    if (!naturalW || !naturalH) { toast("原图加载失败——无法拆分"); close(); return; }

    // 网格线预览+每格像素读出(rows/cols 变更即时重绘)
    const renderLines = () => {
      const rows = clampGridAxis(rowsInput.value);
      const cols = clampGridAxis(colsInput.value);
      for (const el of [...stage.querySelectorAll(".my-feed-gridline")]) el.remove();
      for (let c = 1; c < cols; c++) {
        const v = document.createElement("div");
        v.className = "my-feed-gridline";
        v.style.cssText = `position:absolute;top:0;bottom:0;left:${(c * 100) / cols}%;`
          + "width:1px;background:rgba(255,255,255,0.5);pointer-events:none;";
        stage.appendChild(v);
      }
      for (let r = 1; r < rows; r++) {
        const h = document.createElement("div");
        h.className = "my-feed-gridline";
        h.style.cssText = `position:absolute;left:0;right:0;top:${(r * 100) / rows}%;`
          + "height:1px;background:rgba(255,255,255,0.5);pointer-events:none;";
        stage.appendChild(h);
      }
      try {
        const boxes = gridCellBoxes({ x: 0, y: 0, w: naturalW, h: naturalH }, rows, cols);
        readout.textContent = `${rows}×${cols}=${boxes.length} 格,每格约 ${boxes[0].sw}×${boxes[0].sh}px`
          + `(源图 ${naturalW}×${naturalH})`;
      } catch (error) {
        readout.textContent = error?.message || String(error);
      }
    };
    rowsInput.addEventListener("input", () => {
      rowsInput.value = String(clampGridAxis(rowsInput.value));   // 步进器面夹取
      renderLines();
    });
    colsInput.addEventListener("input", () => {
      colsInput.value = String(clampGridAxis(colsInput.value));
      renderLines();
    });
    renderLines();

    const run = async () => {
      const rows = clampGridAxis(rowsInput.value);
      const cols = clampGridAxis(colsInput.value);
      let boxes;
      try {
        boxes = gridCellBoxes({ x: 0, y: 0, w: naturalW, h: naturalH }, rows, cols);
      } catch (error) {
        toast(error?.message || String(error));
        return;
      }
      const prefix = sanitizePrefix(prefixInput.value, GRID_DEFAULT_PREFIX);
      // 串行逐格:裁切→上传(名={前缀}_r{r}c{c}.png,读响应真名);fail-fast
      const uploaded = [];
      for (let i = 0; i < boxes.length; i++) {
        const r = Math.floor(i / cols);
        const c = i % cols;
        const cell = boxes[i];
        try {
          const blob = await cropImageBlob(img, cell.sx, cell.sy, cell.sw, cell.sh);
          const up = await uploadInputImage(blob, `${prefix}_r${r}c${c}.png`);
          uploaded.push(up);
          readout.textContent = `上传中 ${uploaded.length}/${boxes.length}…`;
        } catch (error) {
          toast(`宫格拆分失败:已完成 ${uploaded.length}/${boxes.length},失败于 r${r}c${c}`
            + `(${error?.message || error})——已上传的分格保留,可直接重试`);
          return;   // 零建节点(防半阵列);已传文件留 input 无害,重试撞名自动改名
        }
      }
      // 全成才一次性建阵列:网格布局,列对齐宫格列,title=格标识
      const positions = gridLayoutPositions(
        { x: Number(node.pos?.[0]) + Number(node.size?.[0]) + TOKENS.gapX,
          y: Number(node.pos?.[1]) },
        rows, cols,
        { w: TOKENS.loadNodeW, h: TOKENS.loadNodeH },
        { x: TOKENS.nodeColsGap, y: TOKENS.nodeRowsGap });
      const graph = currentGraph();   // 子图坑:落当前显示图
      uploaded.forEach((up, i) => {
        const r = Math.floor(i / cols);
        const c = i % cols;
        const value = up.subfolder ? `${up.subfolder}/${up.name}` : up.name;
        createLoadImage(graph, value, positions[i], `r${r}c${c}`);
      });
      app.graph?.change?.();   // 批量 add 后统一兜底一次
      toast(`已拆 ${uploaded.length} 格`);
      close();
    };
    confirmBtn.addEventListener("click", () => { void run(); });
  })();
}

// ── 附着面:按钮幂等挂载(nodeCreated 直挂+executed 懒挂) ──────────────

function attachFeedButtons(node) {
  if (!node || node[FEED_MARKER]) return false;
  const isLoadFamily = LOAD_IMAGE_CLASSES.has(String(node?.comfyClass ?? ""));
  if (!isLoadFamily && !resolveImageSource(node)) return false;   // 无源零按钮
  if (typeof node.addWidget !== "function") return false;
  node[FEED_MARKER] = true;
  node.addWidget("button", "裁切回灌", null, () => {
    try { openCropModal(node); } catch (error) { toast(error?.message || String(error)); }
  }, { serialize: false });
  node.addWidget("button", "宫格拆分", null, () => {
    try { openGridModal(node); } catch (error) { toast(error?.message || String(error)); }
  }, { serialize: false });
  return true;
}

let executedBound = false;   // setup 重入闩(监听只挂一次)

// 预览路懒挂:node.images 执行后才出现——executed 后 rAF 延一拍(此时
// images 已落节点),按 detail.node/display_node 在当前显示图里找节点
// 补挂(B6 事件口径:display_node 优先展示面,real node 兜 progress 面)。
function onExecutedLazyAttach(event) {
  const detail = event?.detail;
  if (!detail) return;
  nextFrame(() => {
    try {
      const graph = app.canvas?.graph ?? app.graph;
      const ids = new Set([detail.node, detail.display_node]
        .filter((v) => v !== undefined && v !== null).map(String));
      for (const n of graph?._nodes ?? []) {
        if (ids.has(String(n?.id))) attachFeedButtons(n);
      }
    } catch { /* 事件回调零抛出 */ }
  });
}

app.registerExtension({
  name: "my.image.feed",
  nodeCreated(node) {
    try { attachFeedButtons(node); } catch { /* 构造期零抛出 */ }
  },
  setup() {
    // setup 重入闩:监听只挂一次(引擎同名二次注册抛错,闩在前静默)
    if (executedBound) return;
    executedBound = true;
    api.addEventListener("executed", onExecutedLazyAttach);
  },
});
