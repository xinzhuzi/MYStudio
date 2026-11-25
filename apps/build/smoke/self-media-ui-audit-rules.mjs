// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

/**
 * 自媒体面板界面审计:规则模块(1125 二轮收尾计划 L14 脚手架)。
 * 全部是纯函数,不碰 DOM、不碰 IO。页面侧(self-media-ui-audit.mjs)只采集原始事实,
 * 判定一律在这里做,所以每条规则都能用手工构造的快照单测;单测见 *.test.mjs。
 *
 * 快照(snapshot)的形状,由页面侧采集函数产出:
 *   { viewport, elements: [{ id, parent, tag, path, text, rect, clip?, bg, opacity, color,
 *     overflowX, overflowY, ellipsis, lineClamp, image, ariaHidden, nativeDisabled,
 *     ariaDisabled, hidden, fontSize, fontWeight }],
 *     texts: [{ el, text, rects }], controls: [元素 id] }
 * elements[id].id === id;parent 是祖先的元素 id,根元素为 -1。rect 是 border box;
 * clip 是 padding box(溢出裁剪的真实边界),只在该元素某一轴的 overflow 不是 visible
 * 时出现。text 只有控件元素带(自身的文字),写进重叠报告用。
 */

import { basename, dirname } from "node:path";

// ── 颜色解析 ───────────────────────────────────────────────────────────────

const NAMED_COLORS = { transparent: [0, 0, 0, 0] };

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function clamp01(value) {
  return clamp(value, 0, 1);
}

/** 数字或百分比文本 → 数值;百分比先除以 100。不是数值返回 NaN。 */
function parseNumber(token) {
  const match = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)(%)?$/i.exec(token);
  if (!match) return NaN;
  return Number(match[1]) / (match[2] ? 100 : 1);
}

/** 角度文本 → 度。支持 deg / rad / grad / turn。 */
function parseAngle(token) {
  const match = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)(deg|rad|grad|turn)?$/i.exec(token);
  if (!match) return NaN;
  const value = Number(match[1]);
  switch ((match[2] || "deg").toLowerCase()) {
    case "rad":
      return (value * 180) / Math.PI;
    case "grad":
      return value * 0.9;
    case "turn":
      return value * 360;
    default:
      return value;
  }
}

function hslToRgb(hue, saturation, lightness) {
  const h = (((hue % 360) + 360) % 360) / 60;
  const s = clamp01(saturation);
  const l = clamp01(lightness);
  const chroma = (1 - Math.abs(2 * l - 1)) * s;
  const x = chroma * (1 - Math.abs((h % 2) - 1));
  const m = l - chroma / 2;
  let rgb;
  if (h < 1) rgb = [chroma, x, 0];
  else if (h < 2) rgb = [x, chroma, 0];
  else if (h < 3) rgb = [0, chroma, x];
  else if (h < 4) rgb = [0, x, chroma];
  else if (h < 5) rgb = [x, 0, chroma];
  else rgb = [chroma, 0, x];
  return rgb.map((channel) => (channel + m) * 255);
}

/** OKLab → sRGB(0–255,已裁剪到色域)。Björn Ottosson 的标准公式。 */
function oklabToSrgb(lightness, a, b) {
  const l_ = lightness + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = lightness - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = lightness - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ ** 3;
  const m = m_ ** 3;
  const s = s_ ** 3;
  const linear = [
    +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  return linear.map((value) => {
    const encoded = value <= 0.0031308 ? 12.92 * value : 1.055 * value ** (1 / 2.4) - 0.055;
    return clamp01(encoded) * 255;
  });
}

/**
 * 拆函数参数:透明度在斜杠后(rgb(0 0 0 / 0.5)),或在旧式逗号写法的第 4 个分量里
 * (rgba(0, 0, 0, 0.5),浏览器序列化的就是这一种)。
 */
function splitFunctional(body) {
  const [main, slashAlpha] = body.split("/").map((part) => part.trim());
  const parts = main.split(/[\s,]+/).filter(Boolean);
  const alpha = slashAlpha ?? (parts.length === 4 ? parts.pop() : "1");
  return { parts, alpha };
}

/** rgb() 的分量:"118" 是 0–255 的数,"46.3%" 是百分比;一律折成 0–255。 */
function to255(token) {
  const value = parseNumber(token);
  return /%$/.test(token) ? value * 255 : value;
}

function parseRgbFunction(parts, alpha) {
  if (parts.length !== 3) return null;
  const [r, g, b] = parts.map(to255);
  const a = parseNumber(alpha);
  if ([r, g, b, a].some(Number.isNaN)) return null;
  return { r, g, b, a: clamp01(a) };
}

function parseHslFunction(parts, alpha) {
  if (parts.length !== 3) return null;
  const [r, g, b] = hslToRgb(parseAngle(parts[0]), parseNumber(parts[1]), parseNumber(parts[2]));
  const a = parseNumber(alpha);
  if ([...[r, g, b], a].some(Number.isNaN)) return null;
  return { r, g, b, a: clamp01(a) };
}

function parseColorFunction(body) {
  const splitAt = body.search(/\s/);
  const space = body.slice(0, splitAt).toLowerCase();
  const rest = body.slice(splitAt + 1).trim();
  if (splitAt < 0 || !["srgb", "srgb-linear"].includes(space)) return null;
  const { parts, alpha } = splitFunctional(rest);
  if (parts.length !== 3) return null;
  const [r0, g0, b0] = parts.map(parseNumber);
  const a = parseNumber(alpha);
  if ([r0, g0, b0, a].some(Number.isNaN)) return null;
  const encode = (value) =>
    space === "srgb" ? value : value <= 0.0031308 ? 12.92 * value : 1.055 * value ** (1 / 2.4) - 0.055;
  return {
    r: clamp01(r0) * 255,
    g: clamp01(g0) * 255,
    b: clamp01(b0) * 255,
    a: clamp01(a),
  };
}

function parseOklabFunction(body, withHue) {
  const { parts, alpha } = splitFunctional(body);
  if (parts.length !== 3) return null;
  const [first, second, third] = parts.map(parseNumber);
  const a = parseNumber(alpha);
  if ([first, second, third, a].some(Number.isNaN)) return null;
  const [r, g, b] = withHue
    ? oklabToSrgb(first, second * Math.cos((third * Math.PI) / 180), second * Math.sin((third * Math.PI) / 180))
    : oklabToSrgb(first, second, third);
  return { r, g, b, a: clamp01(a) };
}

/**
 * 解析浏览器序列化的 CSS 颜色 → { r, g, b, a }(0–255,0–1)。认不出的返回 null,
 * 由调用方记为「不可解析」,不静默当作通过。
 * 支持:transparent、#rgb/#rgba/#rrggbb/#rrggbbaa、rgb()/rgba()(逗号与空格两种写法)、
 * hsl()/hsla()、color(srgb|srgb-linear …)、oklab()/oklch()。
 * 后三种是为 Tailwind v4 的透明度修饰符(color-mix)准备的:浏览器把结果序列化成哪种
 * 写法未经实跑确认,所以三种都认。
 */
export function parseCssColor(input) {
  const text = String(input ?? "").trim().toLowerCase();
  if (Object.hasOwn(NAMED_COLORS, text)) {
    const [r, g, b, a] = NAMED_COLORS[text];
    return { r, g, b, a };
  }
  if (text.startsWith("#")) {
    const hex = text.slice(1);
    if (/^[0-9a-f]{3,4}$/.test(hex)) {
      const full = [...hex].map((char) => char + char).join("");
      return { r: parseInt(full.slice(0, 2), 16), g: parseInt(full.slice(2, 4), 16), b: parseInt(full.slice(4, 6), 16), a: parseInt(full.slice(6, 8) || "ff", 16) / 255 };
    }
    if (/^[0-9a-f]{6}([0-9a-f]{2})?$/.test(hex)) {
      return { r: parseInt(hex.slice(0, 2), 16), g: parseInt(hex.slice(2, 4), 16), b: parseInt(hex.slice(4, 6), 16), a: parseInt(hex.slice(6, 8) || "ff", 16) / 255 };
    }
    return null;
  }
  const match = /^([a-z-]+)\((.*)\)$/.exec(text);
  if (!match) return null;
  const [, name, body] = match;
  if (name === "rgb" || name === "rgba") {
    const { parts, alpha } = splitFunctional(body);
    return parseRgbFunction(parts, alpha);
  }
  if (name === "hsl" || name === "hsla") {
    const { parts, alpha } = splitFunctional(body);
    return parseHslFunction(parts, alpha);
  }
  if (name === "color") return parseColorFunction(body);
  if (name === "oklab") return parseOklabFunction(body, false);
  if (name === "oklch") return parseOklabFunction(body, true);
  return null;
}

// ── 合成、相对亮度、对比度 ─────────────────────────────────────────────────

/**
 * 源色叠在底色上(source-over)。结果保留小数;量化成 8 位整数这一步放在
 * relativeLuminance 的入口,对应「屏幕上最终那个颜色」。
 */
export function compositeOver(top, bottom) {
  const topAlpha = clamp01(top.a);
  const bottomAlpha = clamp01(bottom.a);
  const outAlpha = topAlpha + bottomAlpha * (1 - topAlpha);
  if (outAlpha === 0) return { r: 0, g: 0, b: 0, a: 0 };
  const over = (topChannel, bottomChannel) =>
    (topChannel * topAlpha + bottomChannel * bottomAlpha * (1 - topAlpha)) / outAlpha;
  return {
    r: over(top.r, bottom.r),
    g: over(top.g, bottom.g),
    b: over(top.b, bottom.b),
    a: outAlpha,
  };
}

function linearize(channel8) {
  const channel = Math.round(channel8) / 255;
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

/** WCAG 相对亮度。分量先取整到 8 位:浏览器把合成结果写进帧缓冲时也是这样量化的。 */
export function relativeLuminance(color) {
  return (
    0.2126 * linearize(color.r) + 0.7152 * linearize(color.g) + 0.0722 * linearize(color.b)
  );
}

/** WCAG 对比度:(亮者 + 0.05) / (暗者 + 0.05)。 */
export function contrastRatio(first, second) {
  const [lighter, darker] = [relativeLuminance(first), relativeLuminance(second)].sort(
    (left, right) => right - left,
  );
  return (lighter + 0.05) / (darker + 0.05);
}

// ── 祖先链 ─────────────────────────────────────────────────────────────────

const CLIP_VALUES = ["hidden", "clip"];
const NATIVE_INPUT_TAGS = ["input", "textarea", "select"];
/** 页面没有自己的背景时,浏览器画布的底色。 */
const CANVAS_BASE = { r: 255, g: 255, b: 255, a: 1 };
/** 一条规则在一个快照里最多列多少条;超出的只留一句提示,免得报告被刷爆。 */
const MAX_FINDINGS_PER_LIST = 1000;

/** 累计透明度低于 5% 的文字和控件视为不可见(计划第 5 节重叠规则的口径,三条规则共用)。 */
export const MIN_VISIBLE_OPACITY = 0.05;

/** 从根到叶的祖先链,含自身。id 越界返回空数组;父指针成环时走到元素总数就停。 */
export function chainOf(elements, id) {
  const chain = [];
  let current = elements[id];
  for (let depth = 0; current && depth <= elements.length; depth += 1) {
    chain.push(current);
    current = current.parent >= 0 ? elements[current.parent] : null;
  }
  return chain.reverse();
}

function opacityOf(element) {
  const value = Number(element.opacity);
  return Number.isFinite(value) ? clamp01(value) : 1;
}

function multiplyAlong(chain, pick) {
  return chain.reduce((product, element) => product * pick(element), 1);
}

/** 累计透明度:自身与全部祖先的 opacity 相乘。 */
export function accumulatedOpacity(elements, id) {
  return multiplyAlong(chainOf(elements, id), opacityOf);
}

function axisOverflow(element, axis) {
  return axis === "x" ? element.overflowX : element.overflowY;
}

/** 溢出裁剪的真实边界:padding box;页面侧没给 clip 时退回 border box。 */
function clipBounds(element) {
  return element.clip ?? element.rect;
}

function clipRectAxis(rect, bounds, axis) {
  if (axis === "x") {
    const x = Math.max(rect.x, bounds.x);
    return { x, y: rect.y, w: Math.min(rect.x + rect.w, bounds.x + bounds.w) - x, h: rect.h };
  }
  const y = Math.max(rect.y, bounds.y);
  return { x: rect.x, y, w: rect.w, h: Math.min(rect.y + rect.h, bounds.y + bounds.h) - y };
}

/**
 * 矩形被各层 overflow 不是 visible 的祖先裁剪之后实际露出的部分,逐轴裁(x 看 overflowX,
 * y 看 overflowY)。includeSelf 为假时不拿元素自己的 overflow 裁(控件盒只裁内容)。
 */
export function visibleRect(rect, chain, includeSelf = true) {
  let out = rect;
  for (const element of chain) {
    if (!includeSelf && element === chain[chain.length - 1]) continue;
    for (const axis of ["x", "y"]) {
      if (axisOverflow(element, axis) !== "visible") {
        out = clipRectAxis(out, clipBounds(element), axis);
      }
    }
    if (out.w <= 0 || out.h <= 0) break;
  }
  return out;
}

/** 两个方向都超过 1px 才算露出来了。视觉隐藏的 sr-only 文本(裁到 1px 宽)靠这一条排除。 */
function isVisibleRect(rect) {
  return rect.w > 1 && rect.h > 1;
}

/** A 是否在 B 的祖先链上(含 A === B)。 */
export function isAncestorOrSelf(elements, ancestorId, descendantId) {
  let current = elements[descendantId];
  for (let depth = 0; current && depth <= elements.length; depth += 1) {
    if (current.id === ancestorId) return true;
    current = current.parent >= 0 ? elements[current.parent] : null;
  }
  return false;
}

/**
 * 背景合成:从根元素起把链上各层的背景色逐层叠上去。每层的有效不透明度是
 * 「背景透明度 × 该层及其祖先的 opacity 累乘」。返回合成色、背景覆盖率,
 * 以及是否只能算近似(链上有渐变或背景图,或背景没铺满)。
 */
export function compositeBackdrop(chain) {
  let color = CANVAS_BASE;
  let transparency = 1;
  let inheritedOpacity = 1;
  let approximate = false;
  const unparsed = [];
  for (const element of chain) {
    inheritedOpacity *= opacityOf(element);
    if (element.image) approximate = true;
    if (!element.bg) continue;
    const background = parseCssColor(element.bg);
    if (!background) {
      unparsed.push(element.bg);
      continue;
    }
    const layerAlpha = clamp01(background.a * inheritedOpacity);
    if (layerAlpha <= 0) continue;
    color = compositeOver({ ...background, a: layerAlpha }, color);
    transparency *= 1 - layerAlpha;
  }
  if (transparency > 1e-6) approximate = true;
  return { color, coverage: 1 - transparency, approximate, unparsed };
}

/** 每个元素的祖先链事实,按元素 id 缓存:同一个快照里同一元素只算一次。 */
function createFacts(elements) {
  const cache = new Map();
  return {
    of(id) {
      if (!cache.has(id)) {
        const chain = chainOf(elements, id);
        cache.set(id, {
          chain,
          opacity: multiplyAlong(chain, opacityOf),
          backdrop: compositeBackdrop(chain),
          ariaHidden: chain.some((element) => element.ariaHidden),
          disabled: chain.some((element) => element.nativeDisabled || element.ariaDisabled),
          hidden: chain.some((element) => element.hidden),
          insideInput: chain.some((element) => NATIVE_INPUT_TAGS.includes(element.tag)),
        });
      }
      return cache.get(id);
    },
  };
}

/**
 * 文字节点此刻露出来的矩形。累计透明度低于 5%、被 visibility 藏起来、在 aria-hidden
 * 子树里、在原生输入控件里的,都不参与任何一条规则。
 */
function visibleTextRects(facts, rects) {
  if (facts.opacity < MIN_VISIBLE_OPACITY || facts.hidden || facts.ariaHidden || facts.insideInput) return [];
  return rects.filter((rect) => isVisibleRect(visibleRect(rect, facts.chain, true)));
}/** 文字片段:折叠空白后截到 40 字,按码点截,不切断字符。 */
export function clipText(text, max = 40) {
  const chars = [...String(text ?? "").replace(/\s+/g, " ").trim()];
  return chars.length > max ? `${chars.slice(0, max).join("")}…` : chars.join("");
}

function rounded(value, digits = 3) {
  return Number(value.toFixed(digits));
}

function roundedColor(color) {
  return { r: Math.round(color.r), g: Math.round(color.g), b: Math.round(color.b), a: rounded(color.a) };
}

/** 结果收集器:每类带上限,超出后只补一句提示。每条 finding 都带上 context(页签、主题、视口)。 */
function createCollector(context) {
  const lists = { failures: [], warnings: [] };
  const dropped = { failures: 0, warnings: 0 };
  return {
    add(level, finding) {
      const list = lists[level];
      if (list.length < MAX_FINDINGS_PER_LIST) list.push({ ...context, ...finding });
      else dropped[level] += 1;
    },
    finish() {
      for (const level of ["failures", "warnings"]) {
        if (dropped[level] > 0) {
          lists[level].push({
            ...context,
            rule: "limit",
            note: `这一类还有 ${dropped[level]} 条没列出(每类上限 ${MAX_FINDINGS_PER_LIST} 条)`,
          });
        }
      }
      return lists;
    },
  };
}

/**
 * 规则一,对比度。前景取文字所在元素的计算色、透明度按祖先链累乘;背景从根元素逐层合成。
 * 阈值:普通文字 4.5;大字 3(字号 ≥ 24px,或 ≥ 18.66px 且字重 ≥ 700)。禁用控件里的文字不计。
 * 链上有渐变或背景图的照算,但标 approximate(近似)。
 */
export function evaluateContrast(snapshot, context = {}) {
  const collector = createCollector(context);
  const facts = createFacts(snapshot.elements);
  const reportedUnparsed = new Set();
  const noteUnparsed = (colors) => {
    for (const color of colors) {
      if (reportedUnparsed.has(color)) continue;
      reportedUnparsed.add(color);
      collector.add("warnings", { rule: "contrast", kind: "unparsed-color", color });
    }
  };
  for (const item of snapshot.texts ?? []) {
    const element = snapshot.elements[item.el];
    if (!element) continue;
    const chainFacts = facts.of(item.el);
    if (visibleTextRects(chainFacts, item.rects ?? []).length === 0) continue;
    if (chainFacts.disabled) continue;
    const { backdrop } = chainFacts;
    noteUnparsed(backdrop.unparsed);
    const foreground = parseCssColor(element.color);
    if (!foreground) {
      noteUnparsed([element.color]);
      continue;
    }
    const painted = compositeOver({ ...foreground, a: foreground.a * chainFacts.opacity }, backdrop.color);
    const ratio = contrastRatio(painted, backdrop.color);
    const fontSize = Number(element.fontSize) || 0;
    const fontWeight = Number(element.fontWeight) || 400;
    const large = fontSize >= 24 || (fontSize >= 18.66 && fontWeight >= 700);
    const threshold = large ? 3 : 4.5;
    if (ratio >= threshold) continue;
    collector.add("failures", {
      rule: "contrast",
      path: element.path,
      text: clipText(item.text),
      ratio: rounded(ratio, 4),
      threshold,
      fontSize,
      fontWeight,
      foreground: element.color,
      background: roundedColor(backdrop.color),
      opacity: rounded(chainFacts.opacity),
      approximate: backdrop.approximate,
    });
  }
  return collector.finish();
}

/** 沿该轴向上找裁剪容器。先碰到滚动容器(auto/scroll)就不参与。 */
function findClipper(elements, id, axis) {
  let current = elements[id];
  for (let depth = 0; current && depth <= elements.length; depth += 1) {
    const overflow = axisOverflow(current, axis);
    if (CLIP_VALUES.includes(overflow)) return current;
    if (overflow !== "visible") return null;
    current = current.parent >= 0 ? elements[current.parent] : null;
  }
  return null;
}

/** 从文字元素向上到裁剪容器(含)之间,有没有元素声明了某个截断手法。 */
function declaredUpTo(elements, id, stopId, pick) {
  let current = elements[id];
  for (let depth = 0; current && depth <= elements.length; depth += 1) {
    if (pick(current)) return true;
    if (current.id === stopId) return false;
    current = current.parent >= 0 ? elements[current.parent] : null;
  }
  return false;
}

/**
 * 规则二,文本溢出或截断。对每个露出来的文字矩形,沿轴找最近的裁剪容器(hidden/clip),
 * 超出容器任一边缘 1px 以上即截断。到容器之间声明了省略号的记「省略截断」只警告;
 * 纵向声明了行数截断的同样只警告;都没有的记「裁切」,判失败。
 */
export function evaluateTruncation(snapshot, context = {}) {
  const collector = createCollector(context);
  const facts = createFacts(snapshot.elements);
  for (const item of snapshot.texts ?? []) {
    const element = snapshot.elements[item.el];
    if (!element) continue;
    for (const rect of visibleTextRects(facts.of(item.el), item.rects ?? [])) {
      for (const axis of ["x", "y"]) {
        const clipper = findClipper(snapshot.elements, item.el, axis);
        if (!clipper) continue;
        const bounds = clipBounds(clipper);
        const farEdge = (axis === "x" ? rect.x + rect.w : rect.y + rect.h) - (axis === "x" ? bounds.x + bounds.w : bounds.y + bounds.h);
        const nearEdge = (axis === "x" ? bounds.x - rect.x : bounds.y - rect.y);
        const overflow = rounded(Math.max(farEdge, nearEdge), 2);
        if (overflow <= 1) continue;
        const declared = declaredUpTo(
          snapshot.elements,
          item.el,
          clipper.id,
          axis === "x" ? (node) => node.ellipsis : (node) => node.lineClamp,
        );
        collector.add(declared ? "warnings" : "failures", {
          rule: "truncation",
          kind: axis === "x" ? (declared ? "ellipsis" : "clip") : (declared ? "line-clamp" : "clip"),
          axis,
          path: element.path,
          text: clipText(item.text),
          overflow,
          container: clipper.path,
          textRect: rect,
          containerRect: bounds,
        });
      }
    }
  }
  return collector.finish();
}

/**
 * 规则三,元素重叠。取露出来的文字块和交互控件的矩形两两求交;互为祖先的一对不算,
 * aria-hidden 子树、累计透明度低于 5% 的不算。交集两个方向都超过 1px 且面积超过
 * 4 平方像素即判失败。
 */
export function evaluateOverlap(snapshot, context = {}) {
  const collector = createCollector(context);
  const facts = createFacts(snapshot.elements);
  const boxes = [];
  const pushBox = (kind, id, rect, text) => {
    const chainFacts = facts.of(id);
    if (chainFacts.opacity < MIN_VISIBLE_OPACITY || chainFacts.hidden || chainFacts.ariaHidden) return;
    const visible = visibleRect(rect, chainFacts.chain, kind === "text");
    if (!isVisibleRect(visible)) return;
    boxes.push({ kind, id, rect: visible, text, path: snapshot.elements[id].path });
  };
  for (const item of snapshot.texts ?? []) {
    if (!snapshot.elements[item.el]) continue;
    for (const rect of item.rects ?? []) pushBox("text", item.el, rect, item.text);
  }
  for (const id of snapshot.controls ?? []) {
    const element = snapshot.elements[id];
    if (element?.rect) pushBox("control", id, element.rect, element.text ?? "");
  }
  const describe = (box, prefix) => ({
    [`${prefix}Kind`]: box.kind,
    [`${prefix}Path`]: box.path,
    [`${prefix}Text`]: clipText(box.text),
    [`${prefix}Rect`]: box.rect,
  });
  for (let i = 0; i < boxes.length; i += 1) {
    for (let j = i + 1; j < boxes.length; j += 1) {
      const first = boxes[i];
      const second = boxes[j];
      const width = Math.min(first.rect.x + first.rect.w, second.rect.x + second.rect.w) - Math.max(first.rect.x, second.rect.x);
      const height = Math.min(first.rect.y + first.rect.h, second.rect.y + second.rect.h) - Math.max(first.rect.y, second.rect.y);
      if (width <= 1 || height <= 1 || width * height <= 4) continue;
      const { elements } = snapshot;
      if (isAncestorOrSelf(elements, first.id, second.id) || isAncestorOrSelf(elements, second.id, first.id)) continue;
      collector.add("failures", {
        rule: "overlap",
        ...describe(first, "a"),
        ...describe(second, "b"),
        intersection: { width: rounded(width, 2), height: rounded(height, 2), area: rounded(width * height, 2) },
      });
    }
  }
  return collector.finish();
}

// ── 运行决策(守卫、退出码、临时档案) ───────────────────────────────────────

export const EXIT_CODES = Object.freeze({ ok: 0, findings: 1, runFailed: 2 });

/**
 * 启动守卫。两道门:locked=缺 MANYYING_ALLOW_APP_LAUNCH=1(「无用户亲手解锁,任何人不许跑」);
 * prekill-force=带了 MYSTUDIO_SMOKE_PREKILL_FORCE=1(冒烟脚本的强杀开关,审计不认)。
 * 判据与冒烟脚本逐字一致(严格等于 "1")。做成纯函数是为了让真值表由单测钉住。
 */
export function resolveLaunchGuard(env) {
  const reasons = [];
  if (env.MANYYING_ALLOW_APP_LAUNCH !== "1") reasons.push("locked");
  if (env.MYSTUDIO_SMOKE_PREKILL_FORCE === "1") reasons.push("prekill-force");
  return { ok: reasons.length === 0, reasons };
}

/** 退出码:运行失败 2;有失败项 1;都没有 0。 */
export function resolveExitCode({ runErrors = [], failures = [] } = {}) {
  if (runErrors.length > 0) return EXIT_CODES.runFailed;
  return failures.length > 0 ? EXIT_CODES.findings : EXIT_CODES.ok;
}

/**
 * 这个目录是不是本脚本自己建的隔离档案:直接位于临时目录之下,目录名以 mystudio-smoke-
 * 开头(与冒烟的隔离前缀相同)。清理临时档案前必须过这一道。
 */
export function isOwnedTempProfile(dir, tmpRoot) {
  if (typeof dir !== "string" || typeof tmpRoot !== "string" || !dir || !tmpRoot) return false;
  return dirname(dir) === tmpRoot && /^mystudio-smoke-[^/\\]+$/.test(basename(dir));
}

// ── 审计矩阵:状态、主题、视口、采集单元 ────────────────────────────────────

/**
 * a1–a9,九个页签的默认态。label 是页签按钮的文字,title 是切过去之后内容区必须出现的文字。
 * 文字出处(1125 本会话实读磁盘;行号会漂移,终跑前对照源码复核):账号、任务、历史、全部产品
 * → index.tsx 各视图的 h2;发布 → compose-view.tsx 的 CardDescription(标题「发布」太泛);
 * 全平台 → batch-publish-view.tsx 的 CardTitle;产品 → products-view.tsx;模板 → template-view.tsx;
 * 展示页 → showcase-view.tsx,各取 h2/CardTitle。
 */
export const TAB_STATES = Object.freeze([
  { id: "a1", label: "账号", title: "平台账号" },
  { id: "a2", label: "发布", title: "创建并发布内容到指定平台" },
  { id: "a3", label: "全平台", title: "全平台批量发布" },
  { id: "a4", label: "任务", title: "运行中的任务" },
  { id: "a5", label: "历史", title: "发布历史" },
  { id: "a6", label: "产品", title: "产品目录" },
  { id: "a7", label: "模板", title: "推广模板" },
  { id: "a8", label: "展示页", title: "产品展示页" },
  { id: "a9", label: "全部产品", title: "全部产品历史" },
]);

const LIGHT_PRESETS = ["neutral", "blueprint", "warmPaper", "sageInk", "mist", "porcelain", "lavender"];
const DARK_PRESETS = ["cinema", "graphite", "midnight", "ink", "ember"];

/**
 * 主题的 14 个变体:亮色基线 + 7 个亮色预置、暗色基线 + 5 个暗色预置。主题由根元素的类控制:
 * light 或 dark,再加一个可选的 theme-preset-*;预置 id 与 index.css 里的选择器一一对应。
 */
export const THEMES = Object.freeze([
  { id: "light", mode: "light", preset: null },
  ...LIGHT_PRESETS.map((preset) => ({ id: `light-${preset}`, mode: "light", preset })),
  { id: "dark", mode: "dark", preset: null },
  ...DARK_PRESETS.map((preset) => ({ id: `dark-${preset}`, mode: "dark", preset })),
]);

/** 截图只截这两个主题:默认亮与默认暗。 */
export const SCREENSHOT_THEME_IDS = Object.freeze(["light", "dark"]);

/** 默认窗口 1400×900(main-window-state.ts),最小窗口 1200×700(main-window.ts)。 */
export const DEFAULT_VIEWPORT = Object.freeze({ id: "1400x900", width: 1400, height: 900 });
export const MIN_VIEWPORT = Object.freeze({ id: "1200x700", width: 1200, height: 700 });

/**
 * 一个状态要走的采集单元,顺序就是执行顺序。对比度跑全部 14 个主题(默认视口);
 * 截断与重叠在默认亮色下跑两个视口;默认亮 × 默认视口那一个单元同时喂三条规则。共 15 个。
 */
export function planCollectionUnits() {
  const contrastUnits = THEMES.map((theme) => ({
    theme,
    viewport: DEFAULT_VIEWPORT,
    rules: ["contrast"],
  }));
  return [
    { ...contrastUnits[0], rules: ["contrast", "truncation", "overlap"] },
    ...contrastUnits.slice(1),
    { theme: THEMES[0], viewport: MIN_VIEWPORT, rules: ["truncation", "overlap"] },
  ];
}

/**
 * b1–b5,种子态。顺序有依赖,不能换:产品由 b1 的第一步写入;b2 点的是 b1 列表里的卡片;
 * b4 的「新建模板」要先有产品才点得动;b5 展示的是应用里已加载的产品。
 * steps 是进入它的页面动作序列 [动作名, 参数],texts 是进入后内容区必须出现的文字。
 * 种子只经 preload 桥接写库;字段照 types/product.ts 与 types/promotion-template.ts 给全,
 * 时间戳用固定值,让每次审计的数据都一样。
 */
const SEED_AT = Date.UTC(2026, 10, 25);
export const SEED_PRODUCTS = [
  { id: "ui-audit-product-1", name: "界面审计种子产品甲", slug: "ui-audit-jia" },
  { id: "ui-audit-product-2", name: "界面审计种子产品乙", slug: "ui-audit-yi" },
].map((seed, index) => ({
  ...seed,
  description: `用于界面审计的种子产品,第${index + 1}件,描述保持一句话长度。`,
  detail: "这是界面审计用的种子产品详情。",
  coverImage: "",
  links: [],
  tags: ["审计", "种子"],
  projectIds: [],
  brandProfile: { primaryColor: "#0091ff", tone: [], forbiddenWords: [] },
  promotion: { defaultTags: ["审计"], utm: { campaign: "ui-audit" }, ctaType: "learn_more" },
  createdAt: SEED_AT + index,
  updatedAt: SEED_AT + index,
}));
export const SEED_TEMPLATE = {
  id: "ui-audit-template-1",
  productId: SEED_PRODUCTS[0].id,
  name: "界面审计种子模板",
  platform: "xhs",
  titleTemplate: "{{product.name}} 上新",
  bodyTemplate: "{{product.description}}",
  defaultTags: ["审计"],
  mediaSlots: 3,
  createdAt: SEED_AT,
  updatedAt: SEED_AT,
};
export const SEED_STATES = Object.freeze([
  {
    id: "b1", label: "产品", texts: ["产品目录", ...SEED_PRODUCTS.map((product) => product.name)],
    steps: [["seedProducts", { products: SEED_PRODUCTS }], ["clickTab", { label: "产品" }]],
  },
  {
    id: "b2", label: "产品", texts: ["编辑产品"],
    steps: [["clickProductEdit", { name: SEED_PRODUCTS[0].name }]],
  },
  {
    id: "b3", label: "模板", texts: ["推广模板", SEED_TEMPLATE.name],
    steps: [["seedTemplate", { template: SEED_TEMPLATE }], ["clickTab", { label: "模板" }]],
  },
  {
    id: "b4", label: "模板", texts: ["多平台预览", "隐藏预览"],
    steps: [["clickMainButton", { text: "新建模板" }], ["clickMainButton", { text: "显示预览" }]],
  },
  {
    id: "b5", label: "展示页", texts: ["产品展示页", ...SEED_PRODUCTS.map((product) => product.name)],
    steps: [["clickTab", { label: "展示页" }]],
  },
]);

// ── c 组种子:失败任务与定时任务(走真实建单链路,L6 落地后生效) ──────────────
/** 审计项目的固定 ID:脚本预建 _p/<ID>/ 让应用把它恢复成项目,种子草稿也挂在这个项目下。 */
export const AUDIT_PROJECT_ID = "self-media-ui-audit";
/**
 * c 组种子任务。失败任务用不存在的账号 ID:发布路径先查账号库再碰任何网络
 * (platform-bridge.ts:417-425,查无此人即抛 account-not-found);隔离档案里没有账号库,
 * 这是零外发的保证。失败任务不带 scheduledAt 立即建单——建单处理器同步走完发布路径、
 * 把失败态任务带回回执(self-media-ipc.ts:483-504),不用「排到 5 秒后再轮询等它失败」的抖动写法。
 * batchId/batchRole 是 L6 的字段名(implement.md §1:verification 首发、member 当天、queued 次日);
 * L6 落地前草稿白名单会剥掉它们,c 组要等 L6 落地后才出预期状态。定时任务排 30 分钟后,
 * 审计期间(分钟级)不会执行。
 */
const AUDIT_ASSET = { assetId: "ui-audit-asset-1", projectId: AUDIT_PROJECT_ID, kind: "image", approvedUrl: "https://example.invalid/ui-audit.png" };
const AUDIT_BATCH_ID = "ui-audit-batch-1";
const inMinutes = (minutes) => new Date(Date.now() + minutes * 60_000).toISOString();
const tomorrowAt = (hours, minutes) => { const at = new Date(); at.setDate(at.getDate() + 1); at.setHours(hours, minutes, 0, 0); return at.toISOString(); };
function seedTaskDraft({ id, batchRole, scheduledAt }) {
  return {
    id, projectId: AUDIT_PROJECT_ID, contentType: "image-text",
    title: `界面审计种子草稿 ${id}`, description: "", topics: [],
    assets: [{ ...AUDIT_ASSET }], accountIds: [`ui-audit-account-${id}`],
    visibility: "public", platformOptions: { platform: "xhs" }, scheduledAt,
    ...(batchRole ? { batchId: AUDIT_BATCH_ID, batchRole } : {}),
    updatedAt: "2026-11-25T00:00:00.000Z",
  };
}
const seedTask = (id, expectStatus, extra = {}) => ({ id, expectStatus, draft: seedTaskDraft({ id, ...extra }) });
export const SEED_TASK_GROUPS = {
  // c1:一条失败任务 + 一条定时任务(非批次),任务/历史/全部产品三个页签各自呈现
  c1: [seedTask("c1-fail", "failure"), seedTask("c1-scheduled", "scheduled", { scheduledAt: inMinutes(30) })],
  // c2:同一批三条。失败成员先建——此刻批里还没有首发验证,闸门的首发检查与级联都拦不到它,
  // 立即建单即在 vault.get 处失败;首发验证(待发)与排队次日随后建,审计期间保持已排期,
  // 级联(首发验证进入失败才触发)在审计窗口内不会发生
  c2: [
    seedTask("c2-member", "failure", { batchRole: "member" }),
    seedTask("c2-verification", "scheduled", { batchRole: "verification", scheduledAt: inMinutes(30) }),
    seedTask("c2-queued", "scheduled", { batchRole: "queued", scheduledAt: tomorrowAt(8, 5) }),
  ],
};
const seedStep = (groupId) => ["seedTasks", { groupId, projectId: AUDIT_PROJECT_ID, tasks: SEED_TASK_GROUPS[groupId] }];
const C_STATES = [
  // 种子在「任务」页签上做:面板的进度订阅(终态任务进历史、按事件更新任务表)靠它活着
  { id: "c1", label: "任务", texts: ["运行中的任务"], steps: [["clickTab", { label: "任务" }], seedStep("c1")] },
  { id: "c1-history", label: "历史", texts: ["发布历史"], steps: [["clickTab", { label: "历史" }]] },
  { id: "c1-global", label: "全部产品", texts: ["全部产品历史"], steps: [["clickTab", { label: "全部产品" }]] },
  // c2 的断言文字:卡片标题、进度面板标题(复用现有逐条状态行)、排队次日的状态标签
  { id: "c2", label: "全平台", texts: ["全平台批量发布", "发布进度", "排队次日"], steps: [seedStep("c2"), ["clickTab", { label: "全平台" }]] },
];
/** 全部状态,按执行顺序:a 组在前(此时没有种子),b 组在后,c 组最后(种子任务,依赖 L6)。 */
export const AUDIT_STATES = Object.freeze([
  ...TAB_STATES.map((state) => ({ ...state, texts: [state.title], steps: [["clickTab", { label: state.label }]] })),
  ...SEED_STATES,
  ...C_STATES,
]);
