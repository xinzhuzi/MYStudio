// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

/**
 * self-media-ui-audit-rules 规则单测(1125 二轮收尾计划 L14 脚手架)。
 * 只测规则模块的纯函数,零 DOM、零进程、零等待。
 * 跑法①(cwd=apps/):npx vitest run --config frontend/config/vite.config.ts build/smoke/self-media-ui-audit-rules.test.mjs
 * 跑法②:node --test apps/build/smoke/self-media-ui-audit-rules.test.mjs
 * runner 适配同 smoke-process-lifecycle.test.mjs:vitest 全量会拾取 apps/ 下任意 *.test.mjs,
 * node:test 用例 vitest 不认领,所以按 runner 取注册 API,两道门锁同一断言面。
 */

const { test } = await import(process.env.VITEST ? "vitest" : "node:test");
import assert from "node:assert/strict";
import {
  AUDIT_PROJECT_ID,
  AUDIT_STATES,
  DEFAULT_VIEWPORT,
  EXIT_CODES,
  MIN_VIEWPORT,
  SCREENSHOT_THEME_IDS,
  SEED_PRODUCTS,
  SEED_STATES,
  SEED_TASK_GROUPS,
  SEED_TEMPLATE,
  TAB_STATES,
  THEMES,
  accumulatedOpacity,
  chainOf,
  classifyContrastScope,
  clipText,
  compositeBackdrop,
  compositeBackdropWithImages,
  compositeOver,
  contrastRatio,
  countByScope,
  evaluateContrast,
  evaluateOverlap,
  evaluateTruncation,
  isAncestorOrSelf,
  isOwnedTempProfile,
  parseCssColor,
  parseGradientStops,
  parseThemeTokens,
  planCollectionUnits,
  relativeLuminance,
  resolveExitCode,
  resolveLaunchGuard,
  splitBackgroundLayers,
  visibleRect,
} from "./self-media-ui-audit-rules.mjs";

const FULL = { x: 0, y: 0, w: 1000, h: 800 };

/** 元素表的默认值:一条线性父链(第 n 个的父是第 n-1 个),其余全是「没有任何特殊声明」。 */
function makeSnapshot(overrides = [], { texts = [], controls = [] } = {}) {
  return {
    viewport: { width: 1400, height: 900 },
    elements: overrides.map((override, id) => ({
      id,
      parent: id - 1,
      tag: "div",
      path: `el#${id}`,
      text: "",
      rect: { ...FULL },
      bg: "rgba(0, 0, 0, 0)",
      opacity: 1,
      color: "rgb(0, 0, 0)",
      overflowX: "visible",
      overflowY: "visible",
      ellipsis: false,
      lineClamp: false,
      image: false,
      ariaHidden: false,
      nativeDisabled: false,
      ariaDisabled: false,
      hidden: false,
      fontSize: 14,
      fontWeight: 400,
      ...override,
    })),
    texts,
    controls,
  };
}

const near = (actual, expected, tolerance = 1e-6) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} 不接近 ${expected}`);

// ── 颜色解析 ───────────────────────────────────────────────────────────────

test("parseCssColor:浏览器序列化的 rgb/rgba(逗号写法,透明度在第 4 个分量)", () => {
  assert.deepEqual(parseCssColor("rgb(118, 118, 118)"), { r: 118, g: 118, b: 118, a: 1 });
  assert.deepEqual(parseCssColor("rgba(0, 0, 0, 0)"), { r: 0, g: 0, b: 0, a: 0 });
  assert.deepEqual(parseCssColor("rgba(255, 255, 255, 0.8)"), { r: 255, g: 255, b: 255, a: 0.8 });
  assert.deepEqual(parseCssColor("rgba(50%, 50%, 50%, 50%)"), { r: 127.5, g: 127.5, b: 127.5, a: 0.5 });
});

test("parseCssColor:空格写法、十六进制、transparent、hsl", () => {
  assert.deepEqual(parseCssColor("rgb(0 145 255 / 0.5)"), { r: 0, g: 145, b: 255, a: 0.5 });
  for (const input of ["hsla(212, 100%, 48%, 0.5)", "hsl(212 100% 48% / 0.5)"]) {
    const { r, g, b, a } = parseCssColor(input);
    assert.deepEqual([r, a], [0, 0.5], input);
    near(g, 114.24);
    near(b, 244.8);
  }
  assert.deepEqual(parseCssColor("#767676"), { r: 118, g: 118, b: 118, a: 1 });
  assert.deepEqual(parseCssColor("#abc"), { r: 170, g: 187, b: 204, a: 1 });
  const withAlpha = parseCssColor("#11223344");
  assert.deepEqual([withAlpha.r, withAlpha.g, withAlpha.b], [17, 34, 51]);
  near(withAlpha.a, 68 / 255);
  assert.deepEqual(parseCssColor("transparent"), { r: 0, g: 0, b: 0, a: 0 });
  assert.deepEqual(parseCssColor("  RGB(1,2,3) "), { r: 1, g: 2, b: 3, a: 1 });
});

test("parseCssColor:color(srgb) 与 oklab/oklch(Tailwind v4 透明度修饰符可能出现的写法)", () => {
  assert.deepEqual(parseCssColor("color(srgb 0.5 0 0 / 0.5)"), { r: 127.5, g: 0, b: 0, a: 0.5 });
  assert.deepEqual(parseCssColor("color(srgb-linear 1 0 0)"), { r: 255, g: 0, b: 0, a: 1 });
  const white = parseCssColor("oklab(1 0 0)");
  near(white.r, 255, 0.01);
  near(white.g, 255, 0.01);
  near(white.b, 255, 0.01);
  assert.deepEqual(parseCssColor("oklab(0 0 0)"), { r: 0, g: 0, b: 0, a: 1 });
  const red = parseCssColor("oklab(0.627955 0.224863 0.125846)");
  near(red.r, 255, 0.01);
  near(red.g, 0, 0.01);
  near(red.b, 0, 0.01);
  near(parseCssColor("oklch(1 0 0)").r, 255, 0.01);
});

test("parseCssColor:认不出的一律 null,交给调用方记「不可解析」", () => {
  for (const input of ["currentColor", "", "rgb(bad)", "#12", "color(display-p3 1 0 0)", "rgb(1, 2, 3, 4, 5)", "hsl(1, 2)", null, undefined]) {
    assert.equal(parseCssColor(input), null, String(input));
  }
});

// ── 合成、相对亮度、对比度 ─────────────────────────────────────────────────

test("compositeOver:source-over 的四个边界", () => {
  const white = { r: 255, g: 255, b: 255, a: 1 };
  const red = { r: 255, g: 0, b: 0, a: 1 };
  assert.deepEqual(compositeOver(red, white), red);
  assert.deepEqual(compositeOver({ r: 10, g: 10, b: 10, a: 0 }, white), white);
  assert.deepEqual(compositeOver({ r: 10, g: 10, b: 10, a: 0 }, { r: 0, g: 0, b: 0, a: 0 }), { r: 0, g: 0, b: 0, a: 0 });
  assert.deepEqual(compositeOver({ r: 0, g: 0, b: 0, a: 0.5 }, white), { r: 127.5, g: 127.5, b: 127.5, a: 1 });
});

test("contrastRatio:计划第 5 节给的四个参考值", () => {
  const white = { r: 255, g: 255, b: 255, a: 1 };
  const black = { r: 0, g: 0, b: 0, a: 1 };
  assert.equal(contrastRatio(black, white).toFixed(3), "21.000");
  assert.equal(contrastRatio(parseCssColor("#767676"), white).toFixed(3), "4.542");
  assert.equal(contrastRatio(parseCssColor("#777777"), white).toFixed(3), "4.478");
  const halfBlack = compositeOver({ r: 0, g: 0, b: 0, a: 0.5 }, white);
  assert.equal(contrastRatio(halfBlack, white).toFixed(3), "3.949");
});

test("对比度:合成结果取整到 8 位才算亮度(127.5 归到 128 才是 3.949;不取整是 3.977,对不上参考值)", () => {
  const white = { r: 255, g: 255, b: 255, a: 1 };
  assert.equal(relativeLuminance({ r: 127.5, g: 127.5, b: 127.5 }), relativeLuminance({ r: 128, g: 128, b: 128 }));
  // 三个值各自用独立算式核对过:127 → 4.0041,127.5 → 3.9767,128 → 3.9494
  assert.equal(contrastRatio({ r: 127, g: 127, b: 127, a: 1 }, white).toFixed(4), "4.0041");
  assert.equal(contrastRatio({ r: 127.5, g: 127.5, b: 127.5, a: 1 }, white).toFixed(4), "3.9494");
  assert.equal(contrastRatio(white, { r: 128, g: 128, b: 128, a: 1 }).toFixed(4), "3.9494");
  assert.equal(relativeLuminance(white).toFixed(3), "1.000");
});

// ── 祖先链 ─────────────────────────────────────────────────────────────────

test("chainOf:根到叶含自身;越界给空数组;父指针成环不死循环", () => {
  const { elements } = makeSnapshot([{}, {}, {}]);
  assert.deepEqual(chainOf(elements, 2).map((element) => element.id), [0, 1, 2]);
  assert.deepEqual(chainOf(elements, 9), []);
  const loop = makeSnapshot([{ parent: 1 }, { parent: 0 }]).elements;
  assert.ok(chainOf(loop, 0).length <= loop.length + 1);
});

test("accumulatedOpacity:自身与祖先相乘;缺省或非法当 1", () => {
  const { elements } = makeSnapshot([{ opacity: 0.5 }, { opacity: 0.5 }, {}]);
  assert.equal(accumulatedOpacity(elements, 1), 0.25);
  assert.equal(accumulatedOpacity(elements, 2), 0.25);
  const broken = makeSnapshot([{ opacity: "abc" }, { opacity: undefined }]).elements;
  assert.equal(accumulatedOpacity(broken, 1), 1);
});

test("compositeBackdrop:从根起逐层合成;祖先的 opacity 同样压低背景层", () => {
  const whitePage = makeSnapshot([
    { bg: "rgb(255, 255, 255)" },
    { bg: "rgba(0, 0, 0, 0.5)" },
  ]).elements;
  const flat = compositeBackdrop(whitePage);
  assert.deepEqual([flat.color.r, flat.color.g, flat.color.b], [127.5, 127.5, 127.5]);
  assert.equal(flat.coverage, 1);
  assert.equal(flat.approximate, false);

  // 白底已经铺满,上面叠一层被祖先压到 50% 的红:背景是确定的粉,不是「没铺满」
  const dimmed = compositeBackdrop(
    makeSnapshot([{ bg: "rgb(255, 255, 255)" }, { opacity: 0.5 }, { bg: "rgb(255, 0, 0)" }]).elements,
  );
  assert.deepEqual([dimmed.color.r, dimmed.color.g, dimmed.color.b], [255, 127.5, 127.5]);
  assert.equal(dimmed.coverage, 1);
  assert.equal(dimmed.approximate, false);
});

test("compositeBackdrop:背景没铺满、链上有渐变都标近似;认不出的颜色收进 unparsed 不抛错", () => {
  const sheer = compositeBackdrop(makeSnapshot([{ bg: "rgba(0, 0, 0, 0.3)" }]).elements);
  assert.equal(sheer.approximate, true);
  near(sheer.coverage, 0.3);

  const gradient = compositeBackdrop(makeSnapshot([{ bg: "rgb(255, 255, 255)", image: true }]).elements);
  assert.equal(gradient.approximate, true);
  assert.equal(gradient.coverage, 1);

  const unparsed = compositeBackdrop(makeSnapshot([{ bg: "currentColor" }, { bg: "rgb(255, 255, 255)" }]).elements);
  assert.deepEqual(unparsed.unparsed, ["currentColor"]);
  assert.equal(unparsed.approximate, false);
});

// ── 背景图(渐变)合成 ───────────────────────────────────────────────────────

/**
 * 1125 逐层探针从装机实例实采的 computed backgroundImage(亮色主题):
 * .studio-shell 带 bg-background,backgroundColor 计算值却是透明的,浅底全靠最后那张不透明渐变。
 */
const SHELL_IMAGE = "radial-gradient(circle at 32% 0%, rgba(0, 114, 245, 0.08), rgba(0, 0, 0, 0) 34%), radial-gradient(circle at 80% 18%, rgba(245, 159, 10, 0.07), rgba(0, 0, 0, 0) 26%), linear-gradient(rgba(173, 196, 171, 0.26), rgba(0, 0, 0, 0) 240px), linear-gradient(135deg, rgb(200, 221, 197) 0%, rgb(212, 229, 210) 46%, rgb(200, 221, 197) 100%)";
const MAIN_IMAGE = "linear-gradient(90deg, rgba(200, 221, 197, 0.08), rgba(0, 0, 0, 0) 18%)";
const rgbOf = (color) => [color.r, color.g, color.b].map((value) => Math.round(value));

test("splitBackgroundLayers / parseGradientStops:括号内的逗号不分层;方向、形状、位置段跳过;url 图片不是渐变", () => {
  assert.equal(splitBackgroundLayers(SHELL_IMAGE).length, 4);
  assert.equal(splitBackgroundLayers(MAIN_IMAGE).length, 1);
  assert.deepEqual(splitBackgroundLayers("none"), []);
  assert.deepEqual(splitBackgroundLayers(""), []);
  const layers = splitBackgroundLayers(SHELL_IMAGE);
  assert.deepEqual(parseGradientStops(layers[3]).map(rgbOf), [[200, 221, 197], [212, 229, 210], [200, 221, 197]]);
  const tint = parseGradientStops(layers[0]);
  assert.deepEqual(tint.map((stop) => [rgbOf(stop), +stop.a.toFixed(2)]), [[[0, 114, 245], 0.08], [[0, 0, 0], 0]]);
  assert.equal(parseGradientStops('url("file:///cover.png")'), null);
});

test("compositeBackdropWithImages:实采链——外壳用渐变画浅底,不再把文字算成压在深色上(期望值经独立手算对拍)", () => {
  // html 米白 → body 与 #root 不透明深色 → .studio-shell(四层背景图) → .studio-main(一层) → 导航条 80% 透明
  const chain = makeSnapshot([
    { bg: "rgb(242, 239, 227)" },
    { bg: "rgb(23, 25, 28)" },
    { bg: "rgb(23, 25, 28)" },
    {},
    { image: true, bgImage: SHELL_IMAGE },
    {},
    { image: true, bgImage: MAIN_IMAGE },
    {},
    {},
    {},
    {},
    { bg: "oklab(0.875654 -0.0306111 0.0244271 / 0.8)" },
  ]).elements;
  const throughMain = compositeBackdropWithImages(chain.slice(0, 7));
  // 不透明渐变给出两端;三层着色各按最大透明度逐层叠上去
  assert.deepEqual(throughMain.bounds.map(rgbOf), [[182, 204, 184], [189, 209, 192]]);
  assert.equal(throughMain.approximate, true);
  assert.equal(throughMain.indeterminate, false);
  near(throughMain.coverage, 1);
  const throughNav = compositeBackdropWithImages(chain);
  assert.deepEqual(throughNav.bounds.map(rgbOf), [[197, 218, 195], [198, 219, 196]]);
  // 对照:只认 backgroundColor 的旧口径把同一条链算成 (165,182,163)——比真实画面暗了三十多
  assert.deepEqual(rgbOf(compositeBackdrop(chain).color), [165, 182, 163]);
});

test("compositeBackdropWithImages:只有「有背景图」没有图层串的旧快照照算但标近似;url 图片记不确定", () => {
  const legacy = compositeBackdropWithImages(makeSnapshot([{ bg: "rgb(255, 255, 255)", image: true }]).elements);
  assert.deepEqual(rgbOf(legacy.color), [255, 255, 255]);
  assert.equal(legacy.approximate, true);
  assert.equal(legacy.indeterminate, false);
  const photo = compositeBackdropWithImages(makeSnapshot([{ bg: "rgb(255, 255, 255)", image: true, bgImage: 'url("a.png")' }]).elements);
  assert.equal(photo.indeterminate, true);
  // 估不出的图层不改动已有背景,也不假装通过
  assert.deepEqual(rgbOf(photo.color), [255, 255, 255]);
});

test("isAncestorOrSelf / visibleRect:逐轴裁剪;控件盒不被自己的 overflow 裁", () => {
  const { elements } = makeSnapshot([
    { overflowX: "hidden", overflowY: "visible", rect: { x: 100, y: 0, w: 200, h: 800 } },
    {},
  ]);
  assert.equal(isAncestorOrSelf(elements, 0, 1), true);
  assert.equal(isAncestorOrSelf(elements, 1, 1), true);
  assert.equal(isAncestorOrSelf(elements, 1, 0), false);

  const chain = chainOf(elements, 1);
  const rect = { x: 50, y: 10, w: 400, h: 20 };
  assert.deepEqual(visibleRect(rect, chain), { x: 100, y: 10, w: 200, h: 20 });
  const ownClip = makeSnapshot([{ overflowX: "hidden", rect: { x: 0, y: 0, w: 10, h: 10 } }]).elements;
  const full = { ...FULL };
  assert.deepEqual(visibleRect(full, chainOf(ownClip, 0), false), full);
  assert.equal(visibleRect(full, chainOf(ownClip, 0), true).w, 10);
});

// ── 规则一:对比度 ──────────────────────────────────────────────────────────

/** 元素 0 是白底页面;texts 里的 el 直接引用元素表的序号。 */
const WHITE_PAGE = [{ bg: "rgb(255, 255, 255)" }];
/** #777777:对白 4.478,差一点到 4.5,普通字号下判失败。 */
const NEAR_MISS = "rgb(119, 119, 119)";
/** #767676:对白 4.542,刚好过线。 */
const JUST_PASS = "rgb(118, 118, 118)";
const text = (el, content, rect = { x: 10, y: 10, w: 80, h: 20 }) => ({ el, text: content, rects: [rect] });
const NONE = { failures: [], warnings: [] };

test("对比度规则:白底黑字通过;#767676 刚好过线不报;#777777 判失败,并带计算值", () => {
  const contrastOnWhite = (color) => evaluateContrast(
    makeSnapshot([{ bg: "rgb(255, 255, 255)", color }], { texts: [text(0, "灰字")] }),
  );
  assert.deepEqual(contrastOnWhite("rgb(0, 0, 0)"), NONE);
  assert.deepEqual(contrastOnWhite(JUST_PASS), NONE);
  const { failures, warnings } = contrastOnWhite(NEAR_MISS);
  assert.deepEqual(warnings, []);
  assert.equal(failures.length, 1);
  const [finding] = failures;
  assert.deepEqual(
    { rule: finding.rule, path: finding.path, text: finding.text, threshold: finding.threshold, fontSize: finding.fontSize, fontWeight: finding.fontWeight, foreground: finding.foreground, background: finding.background, opacity: finding.opacity, approximate: finding.approximate },
    { rule: "contrast", path: "el#0", text: "灰字", threshold: 4.5, fontSize: 14, fontWeight: 400, foreground: NEAR_MISS, background: { r: 255, g: 255, b: 255, a: 1 }, opacity: 1, approximate: false },
  );
  assert.equal(finding.ratio.toFixed(3), "4.478");
});

test("对比度规则:大字阈值 3(字号 ≥ 24px,或 ≥ 18.66px 且字重 ≥ 700)", () => {
  const failuresFor = (fontSize, fontWeight) => evaluateContrast(
    makeSnapshot([{ bg: "rgb(255, 255, 255)", color: NEAR_MISS, fontSize, fontWeight }], { texts: [text(0, "字")] }),
  ).failures;
  assert.equal(failuresFor(24, 400).length, 0);
  assert.equal(failuresFor(23.99, 400).length, 1);
  assert.equal(failuresFor(18.66, 700).length, 0);
  assert.equal(failuresFor(18.66, 400).length, 1);
  assert.equal(failuresFor(18.65, 700).length, 1);
  // finding 里的阈值:普通字号记 4.5;大字要再浅一档才会失败,记的是 3
  assert.equal(failuresFor(23.99, 400)[0]?.threshold, 4.5);
  const largeText = evaluateContrast(
    makeSnapshot([{ bg: "rgb(255, 255, 255)", color: "rgb(153, 153, 153)", fontSize: 24 }], { texts: [text(0, "大字")] }),
  );
  assert.deepEqual(largeText.failures.map((failure) => failure.threshold), [3]);
});

test("对比度规则:禁用控件里的文字不计(原生 disabled 与 aria-disabled 都算)", () => {
  const grayTextIn = (button) => evaluateContrast(
    makeSnapshot([{ bg: "rgb(255, 255, 255)" }, { tag: "button", ...button }, { color: NEAR_MISS }], { texts: [text(2, "按钮文字")] }),
  );
  assert.deepEqual(grayTextIn({ nativeDisabled: true, opacity: 0.5 }), NONE);
  assert.deepEqual(grayTextIn({ ariaDisabled: true }), NONE);
  assert.equal(grayTextIn({ nativeDisabled: false }).failures.length, 1);
});

test("对比度规则:透明度按祖先链累乘后参与合成——黑字在 opacity 0.5 的容器里,对白底是 3.949", () => {
  const { failures } = evaluateContrast(
    makeSnapshot([{ bg: "rgb(255, 255, 255)" }, { opacity: 0.5 }, {}], { texts: [text(2, "半透明黑字")] }),
  );
  assert.equal(failures.length, 1);
  assert.equal(failures[0].ratio.toFixed(3), "3.949");
  assert.equal(failures[0].opacity, 0.5);
});

test("对比度规则:看不见的文字不计(累计透明度 <5%、visibility 藏起、aria-hidden、原生输入控件内、被裁光)", () => {
  const farRight = { x: 200, y: 10, w: 80, h: 20 };
  const cases = {
    faint: [{ bg: "rgb(255, 255, 255)" }, { opacity: 0.04 }, { color: NEAR_MISS }],
    hidden: [{ bg: "rgb(255, 255, 255)" }, { hidden: true }, { color: NEAR_MISS }],
    ariaHidden: [{ bg: "rgb(255, 255, 255)" }, { ariaHidden: true }, { color: NEAR_MISS }],
    inSelect: [{ bg: "rgb(255, 255, 255)" }, { tag: "select" }, { tag: "option", color: NEAR_MISS }],
    clippedOut: [{ bg: "rgb(255, 255, 255)" }, { overflowX: "hidden", overflowY: "hidden", rect: { x: 0, y: 0, w: 100, h: 100 } }, { color: NEAR_MISS }],
  };
  for (const [name, overrides] of Object.entries(cases)) {
    assert.deepEqual(evaluateContrast(makeSnapshot(overrides, { texts: [text(2, "字", farRight)] })), NONE, name);
  }
  // 对照:恰好 5% 照算
  const fivePercent = evaluateContrast(
    makeSnapshot([{ bg: "rgb(255, 255, 255)" }, { opacity: 0.05 }, { color: NEAR_MISS }], { texts: [text(2, "字")] }),
  );
  assert.equal(fivePercent.failures.length, 1);
});

test("对比度规则:链上有渐变照算但标近似;认不出的颜色记一条不可解析警告(同色只记一次),不抛错也不当作通过", () => {
  const onGradient = evaluateContrast(
    makeSnapshot([{ bg: "rgb(255, 255, 255)", image: true }, { color: NEAR_MISS }], { texts: [text(1, "字")] }),
  );
  assert.equal(onGradient.failures.length, 1);
  assert.equal(onGradient.failures[0].approximate, true);

  const unknown = evaluateContrast(
    makeSnapshot([{ bg: "rgb(255, 255, 255)" }, { color: "currentColor" }], { texts: [text(1, "甲"), text(1, "乙")] }),
  );
  assert.deepEqual(unknown.failures, []);
  assert.deepEqual(unknown.warnings, [{ rule: "contrast", kind: "unparsed-color", color: "currentColor" }]);
});

test("对比度规则:背景取可能区间里最不利的一端;估不出的背景图层记不确定警告,不判失败也不当作通过", () => {
  const onPage = (image, color) => evaluateContrast(
    makeSnapshot([{ bg: "rgb(23, 25, 28)" }, { image: true, bgImage: image }, { color }], { texts: [text(2, "字")] }),
  );
  // 深色字压在渐变画的浅底上:通过(旧口径会把它算成 1.24 并判失败)
  assert.deepEqual(onPage(SHELL_IMAGE, "rgb(34, 47, 42)"), NONE);
  // 浅色字压在同一条链上:按最亮的一端判,失败并标近似(这条链止于 .studio-shell,没有 .studio-main 那层着色)
  const lightOnShell = onPage(SHELL_IMAGE, "rgb(226, 230, 233)");
  assert.equal(lightOnShell.failures.length, 1);
  assert.equal(lightOnShell.failures[0].approximate, true);
  assert.deepEqual(lightOnShell.failures[0].background, { r: 188, g: 208, b: 191, a: 1 });
  // 背景是 url 图片:估不出,记一条不确定警告
  const photo = onPage('url("file:///cover.png")', "rgb(34, 47, 42)");
  assert.deepEqual(photo.failures, []);
  assert.deepEqual(photo.warnings, [{ rule: "contrast", kind: "indeterminate-backdrop", path: "el#2", text: "字" }]);
});

// ── 规则二:文本溢出或截断 ──────────────────────────────────────────────────

/** 一个 200×100 的裁剪容器。 */
const BOX = { x: 0, y: 0, w: 200, h: 100 };
const CLIP_BOX = { overflowX: "hidden", overflowY: "hidden", rect: BOX };

test("截断规则:没有裁剪容器不报;文字在容器里也不报", () => {
  assert.deepEqual(evaluateTruncation(makeSnapshot(WHITE_PAGE, { texts: [text(0, "字")] })), NONE);
  const inside = makeSnapshot([CLIP_BOX], { texts: [text(0, "字", { x: 10, y: 10, w: 150, h: 20 })] });
  assert.deepEqual(evaluateTruncation(inside), NONE);
});

test("截断规则:超出裁剪容器边缘 1px 以上、没声明省略号 → 裁切,判失败;不到 1px 不报", () => {
  const clippedBy = (width) => evaluateTruncation(
    makeSnapshot([CLIP_BOX], { texts: [text(0, "被裁的字", { x: 150, y: 10, w: width, h: 20 })] }),
  );
  assert.deepEqual(clippedBy(50), NONE);
  assert.deepEqual(clippedBy(50.8), NONE);
  const { failures, warnings } = clippedBy(51.2);
  assert.deepEqual(warnings, []);
  assert.deepEqual(failures, [{
    rule: "truncation", kind: "clip", axis: "x", path: "el#0", text: "被裁的字", overflow: 1.2,
    container: "el#0", textRect: { x: 150, y: 10, w: 51.2, h: 20 }, containerRect: BOX,
  }]);
  // 左缘同理
  assert.equal(evaluateTruncation(makeSnapshot([CLIP_BOX], { texts: [text(0, "字", { x: -12, y: 10, w: 50, h: 20 })] })).failures[0]?.overflow, 12);
});

test("截断规则:文字元素到容器之间声明了省略号 → 省略截断,只警告;声明在容器之外的不算数", () => {
  const { failures, warnings } = evaluateTruncation(
    makeSnapshot([CLIP_BOX, { ellipsis: true }], { texts: [text(1, "很长很长会被省略的标题文字", { x: 10, y: 10, w: 260, h: 20 })] }),
  );
  assert.deepEqual(failures, []);
  assert.deepEqual(warnings.map((warning) => [warning.kind, warning.axis, warning.overflow, warning.path, warning.container]), [
    ["ellipsis", "x", 70, "el#1", "el#0"],
  ]);
  // 省略号声明在更外层的祖先上(在裁剪容器之外),挡不住这里的裁切:容器右缘 200,文字右缘 310
  const declaredOutside = evaluateTruncation(
    makeSnapshot([{ ellipsis: true }, CLIP_BOX, {}], { texts: [text(2, "字", { x: 10, y: 10, w: 300, h: 20 })] }),
  );
  assert.deepEqual(declaredOutside.warnings, []);
  assert.deepEqual(declaredOutside.failures.map((failure) => [failure.kind, failure.axis, failure.overflow, failure.container]), [
    ["clip", "x", 110, "el#1"],
  ]);
});

test("截断规则:纵向同理,声明了行数截断的只警告", () => {
  const tall = { x: 10, y: 90, w: 100, h: 40 };
  const clamped = evaluateTruncation(
    makeSnapshot([{ ...CLIP_BOX, lineClamp: true }], { texts: [text(0, "第三行被夹掉", tall)] }),
  );
  assert.deepEqual(clamped.failures, []);
  assert.deepEqual(clamped.warnings.map((warning) => [warning.kind, warning.axis, warning.overflow]), [["line-clamp", "y", 30]]);
  const cut = evaluateTruncation(makeSnapshot([CLIP_BOX], { texts: [text(0, "被切掉的行", tall)] }));
  assert.deepEqual(cut.warnings, []);
  assert.deepEqual(cut.failures.map((failure) => [failure.kind, failure.axis, failure.overflow]), [["clip", "y", 30]]);
});

test("截断规则:滚动容器不参与——先碰到 auto/scroll 就不管,哪怕更外层有裁剪容器", () => {
  const throughScroller = (middle) => evaluateTruncation(
    makeSnapshot([CLIP_BOX, { ...middle, rect: BOX }, {}], { texts: [text(2, "横向滚动列表里的文字", { x: 150, y: 10, w: 300, h: 20 })] }),
  );
  assert.deepEqual(throughScroller({ overflowX: "auto", overflowY: "auto" }), NONE);
  assert.deepEqual(throughScroller({ overflowX: "scroll", overflowY: "scroll" }), NONE);
  // 对照:中间那层换成 visible,外层裁剪容器就报出来
  assert.deepEqual(
    throughScroller({ overflowX: "visible", overflowY: "visible" }).failures.map((failure) => [failure.kind, failure.overflow, failure.container]),
    [["clip", 250, "el#0"]],
  );
});

test("截断规则:原生输入控件内、aria-hidden 子树、只露出 1px 的 sr-only 文本都不报", () => {
  const wide = { x: 10, y: 10, w: 400, h: 20 };
  const cases = {
    option: [{ tag: "select", ...CLIP_BOX }, { tag: "option" }],
    ariaHidden: [{ ariaHidden: true, ...CLIP_BOX }],
    // sr-only:1px 宽的裁剪容器,文字远超它,但露出来的只有 1px,算不上看得见的截断
    srOnly: [{ overflowX: "hidden", overflowY: "hidden", rect: { x: 0, y: 0, w: 1, h: 1 } }],
  };
  for (const [name, overrides] of Object.entries(cases)) {
    assert.deepEqual(evaluateTruncation(makeSnapshot(overrides, { texts: [text(overrides.length - 1, "字", wide)] })), NONE, name);
  }
});

// ── 规则三:元素重叠 ──────────────────────────────────────────────────────────

test("重叠规则:两个兄弟文字块相交,两个方向都超过 1px 且面积超过 4 → 判失败;不相交不报", () => {
  const siblings = (second) => evaluateOverlap(
    makeSnapshot([{ bg: "rgb(255, 255, 255)" }, { parent: 0 }, { parent: 0 }], {
      texts: [text(1, "甲", { x: 10, y: 10, w: 100, h: 20 }), text(2, "乙", second)],
    }),
  );
  assert.deepEqual(siblings({ x: 200, y: 10, w: 100, h: 20 }), NONE);
  const { failures, warnings } = siblings({ x: 60, y: 10, w: 100, h: 20 });
  assert.deepEqual(warnings, []);
  assert.deepEqual(failures, [{
    rule: "overlap",
    aKind: "text", aPath: "el#1", aText: "甲", aRect: { x: 10, y: 10, w: 100, h: 20 },
    bKind: "text", bPath: "el#2", bText: "乙", bRect: { x: 60, y: 10, w: 100, h: 20 },
    intersection: { width: 50, height: 20, area: 1000 },
  }]);
});

test("重叠规则:互为祖先的一对不算(按钮里的文字与按钮自身)", () => {
  const button = evaluateOverlap(
    makeSnapshot([{ bg: "rgb(255, 255, 255)" }, {}, { tag: "button", rect: { x: 0, y: 0, w: 200, h: 40 }, text: "按钮" }, {}], {
      texts: [text(3, "按钮", { x: 20, y: 10, w: 50, h: 20 })],
      controls: [2],
    }),
  );
  assert.deepEqual(button, NONE);
});

test("重叠规则:交集不够大不算(面积恰好 4、宽恰好 1);刚过线就算", () => {
  const failuresFor = (second) => evaluateOverlap(
    makeSnapshot([{ bg: "rgb(255, 255, 255)" }, { parent: 0 }, { parent: 0 }], {
      texts: [text(1, "甲", { x: 0, y: 0, w: 100, h: 100 }), text(2, "乙", second)],
    }),
  ).failures.length;
  assert.equal(failuresFor({ x: 98, y: 0, w: 100, h: 2 }), 0);
  assert.equal(failuresFor({ x: 99, y: 0, w: 100, h: 50 }), 0);
  assert.equal(failuresFor({ x: 98.5, y: 0, w: 100, h: 3 }), 1);
});

test("重叠规则:aria-hidden 的控件、累计透明度低于 5% 的控件、被滚动容器裁掉的部分都不算", () => {
  // 元素 1(文字)与元素 2(按钮)是兄弟,按钮盒正好压在文字上
  const covering = (override) => evaluateOverlap(
    makeSnapshot([{ bg: "rgb(255, 255, 255)" }, {}, { parent: 0, tag: "button", rect: { x: 10, y: 10, w: 100, h: 20 }, text: "按钮", ...override }], {
      texts: [text(1, "甲", { x: 10, y: 10, w: 100, h: 20 })],
      controls: [2],
    }),
  );
  assert.equal(covering({}).failures.length, 1);
  assert.deepEqual(covering({ ariaHidden: true }), NONE);
  assert.deepEqual(covering({ opacity: 0.04 }), NONE);

  // 两个矩形坐标完全相同,但各在自己滚动容器里只露出一块(0–100 与 200–300),不相交
  const SCROLLER = { overflowX: "auto", overflowY: "auto", rect: { x: 0, y: 0, w: 100, h: 50 } };
  const scrolled = makeSnapshot([
    { bg: "rgb(255, 255, 255)" },
    SCROLLER,
    { ...SCROLLER, parent: 0, rect: { x: 200, y: 0, w: 100, h: 50 } },
    { parent: 1 },
    { parent: 2 },
  ], { texts: [text(3, "甲", { x: 0, y: 10, w: 300, h: 20 }), text(4, "乙", { x: 0, y: 10, w: 300, h: 20 })] });
  assert.deepEqual(evaluateOverlap(scrolled), NONE);
});

test("三条规则:每条 finding 都带上 context(页签、主题、视口)", () => {
  const context = { state: "a1", theme: "light", viewport: "1400x900" };
  const tag = (finding) => [finding.state, finding.theme, finding.viewport, finding.rule];
  const lowContrast = evaluateContrast(makeSnapshot([{ bg: "rgb(255, 255, 255)", color: NEAR_MISS }], { texts: [text(0, "字")] }), context);
  const cut = evaluateTruncation(makeSnapshot([CLIP_BOX], { texts: [text(0, "字", { x: 150, y: 10, w: 80, h: 20 })] }), context);
  const stacked = evaluateOverlap(
    makeSnapshot([{ bg: "rgb(255, 255, 255)" }, { parent: 0 }, { parent: 0 }], { texts: [text(1, "甲"), text(2, "乙")] }),
    context,
  );
  assert.deepEqual([lowContrast.failures, cut.failures, stacked.failures].map((list) => tag(list[0])), [
    ["a1", "light", "1400x900", "contrast"],
    ["a1", "light", "1400x900", "truncation"],
    ["a1", "light", "1400x900", "overlap"],
  ]);
});

// ── 运行决策与审计矩阵 ──────────────────────────────────────────────────────

test("clipText:截到 40 字,折叠空白,按码点截不切断字符", () => {
  assert.equal(clipText("短文字"), "短文字");
  assert.equal(clipText("字".repeat(40)), "字".repeat(40));
  const clipped = clipText("字".repeat(41));
  assert.equal([...clipped].length, 41);
  assert.equal(clipped.endsWith("…"), true);
  assert.equal(clipText("  甲\n\t乙  "), "甲 乙");
  assert.equal([...clipText("😀".repeat(41))].length, 41);
  assert.equal(clipText(null), "");
});

test("启动守卫真值表:缺解锁一律拒;带了解锁又带强杀开关也拒;两个判据都严格等于 \"1\"", () => {
  const UNLOCK = { MANYYING_ALLOW_APP_LAUNCH: "1" };
  assert.deepEqual(resolveLaunchGuard({}), { ok: false, reasons: ["locked"] });
  assert.deepEqual(resolveLaunchGuard({ MYSTUDIO_SMOKE_PREKILL_FORCE: "1" }), { ok: false, reasons: ["locked", "prekill-force"] });
  assert.deepEqual(resolveLaunchGuard({ ...UNLOCK, MYSTUDIO_SMOKE_PREKILL_FORCE: "1" }), { ok: false, reasons: ["prekill-force"] });
  assert.deepEqual(resolveLaunchGuard({ ...UNLOCK, MYSTUDIO_SMOKE_PREKILL_FORCE: "0" }), { ok: true, reasons: [] });
  assert.deepEqual(resolveLaunchGuard({ MANYYING_ALLOW_APP_LAUNCH: "true" }), { ok: false, reasons: ["locked"] });
});

test("退出码:运行失败 2;有失败项 1;都没有 0;运行失败优先", () => {
  assert.equal(resolveExitCode({}), 0);
  assert.equal(resolveExitCode({ failures: [{}] }), 1);
  assert.equal(resolveExitCode({ runErrors: [{}] }), 2);
  assert.equal(resolveExitCode({ runErrors: [{}], failures: [{}] }), 2);
});

test("isOwnedTempProfile:只认临时目录之下、以 mystudio-smoke- 开头的一级目录", () => {
  const root = "/tmp/audit-root";
  assert.equal(isOwnedTempProfile("/tmp/audit-root/mystudio-smoke-AbC123", root), true);
  assert.equal(isOwnedTempProfile("/tmp/audit-root/mystudio-smoke-AbC123/nested", root), false);
  assert.equal(isOwnedTempProfile("/tmp/other/mystudio-smoke-AbC123", root), false);
  assert.equal(isOwnedTempProfile("/tmp/audit-root/manying-smoke-AbC123", root), false);
  assert.equal(isOwnedTempProfile("", root), false);
  assert.equal(isOwnedTempProfile("/tmp/audit-root/mystudio-smoke-x", ""), false);
});

test("审计矩阵:九个页签默认态、十四个主题变体、两个视口、十五个采集单元", () => {
  assert.deepEqual(TAB_STATES.map((state) => state.id), ["a1", "a2", "a3", "a4", "a5", "a6", "a7", "a8", "a9"]);
  assert.equal(new Set(TAB_STATES.map((state) => state.label)).size, 9);
  assert.equal(new Set(TAB_STATES.map((state) => state.title)).size, 9);

  assert.equal(THEMES.length, 14);
  assert.equal(THEMES.filter((theme) => theme.mode === "light").length, 8);
  assert.equal(THEMES.filter((theme) => theme.mode === "dark").length, 6);
  assert.equal(THEMES.filter((theme) => theme.preset === null).length, 2);
  assert.equal(new Set(THEMES.map((theme) => theme.id)).size, 14);
  assert.ok(THEMES.every((theme) => theme.preset === null || theme.id === `${theme.mode}-${theme.preset}`));
  assert.ok(SCREENSHOT_THEME_IDS.every((id) => THEMES.some((theme) => theme.id === id)));
  assert.deepEqual(
    [DEFAULT_VIEWPORT.width, DEFAULT_VIEWPORT.height, MIN_VIEWPORT.width, MIN_VIEWPORT.height],
    [1400, 900, 1200, 700],
  );

  const units = planCollectionUnits();
  assert.equal(units.length, 15);
  assert.deepEqual(
    units.filter((unit) => unit.viewport === DEFAULT_VIEWPORT).map((unit) => unit.theme.id),
    THEMES.map((theme) => theme.id),
  );
  assert.deepEqual(units[0].rules, ["contrast", "truncation", "overlap"]);
  assert.ok(units.slice(1, 14).every((unit) => unit.rules.length === 1 && unit.rules[0] === "contrast"));
  assert.deepEqual(units[14], { theme: THEMES[0], viewport: MIN_VIEWPORT, rules: ["truncation", "overlap"] });
  assert.equal(units.filter((unit) => unit.rules.includes("contrast")).length, 14);
  assert.equal(units.filter((unit) => unit.rules.includes("truncation")).length, 2);
});

test("状态矩阵:a 组九个页签在前,b 组五个种子态随后,c 组最后;页签文字都取自页签清单;顺序满足种子依赖", () => {
  assert.deepEqual(AUDIT_STATES.map((state) => state.id), ["a1", "a2", "a3", "a4", "a5", "a6", "a7", "a8", "a9", "b1", "b2", "b3", "b4", "b5", "c1", "c1-history", "c1-global", "c2"]);
  assert.deepEqual(AUDIT_STATES.slice(0, 9).map((state) => state.label), TAB_STATES.map((state) => state.label));
  for (const state of AUDIT_STATES) {
    assert.ok(TAB_STATES.some((tab) => tab.label === state.label), `${state.id} 的页签「${state.label}」不在页签清单里`);
    assert.ok(state.texts.length > 0, `${state.id} 没有断言文字`);
    assert.ok(state.steps.length > 0, `${state.id} 没有进入步骤`);
  }
  // a 组每个都只是点一下页签
  assert.ok(AUDIT_STATES.slice(0, 9).every((state, index) => state.steps[0][0] === "clickTab" && state.steps[0][1].label === TAB_STATES[index].label));
  // 种子产品在 b1 的第一步写入;模板在 b3 写入并绑在第一件产品上;
  // b4 的「新建模板」排在写过产品之后(没有产品时这个按钮是禁用的)
  assert.deepEqual(SEED_STATES.map((state) => state.id), ["b1", "b2", "b3", "b4", "b5"]);
  assert.deepEqual(SEED_STATES[0].steps[0], ["seedProducts", { products: SEED_PRODUCTS }]);
  assert.deepEqual(SEED_STATES[2].steps[0], ["seedTemplate", { template: SEED_TEMPLATE }]);
  assert.deepEqual(SEED_STATES[3].steps.map(([, payload]) => payload.text), ["新建模板", "显示预览"]);
  assert.ok(SEED_STATES[3].texts.includes("隐藏预览"));
});

test("c 组状态:种子在「任务」页签上做;历史与全部产品只点页签;c2 先播种再进全平台", () => {
  const states = Object.fromEntries(AUDIT_STATES.map((state) => [state.id, state]));
  const [, c1Seed] = states.c1.steps;
  assert.deepEqual(states.c1.steps[0], ["clickTab", { label: "任务" }]);
  assert.equal(c1Seed[0], "seedTasks");
  assert.deepEqual(c1Seed[1].tasks, SEED_TASK_GROUPS.c1);
  assert.equal(c1Seed[1].projectId, AUDIT_PROJECT_ID);
  assert.deepEqual(states["c1-history"].steps, [["clickTab", { label: "历史" }]]);
  assert.deepEqual(states["c1-global"].steps, [["clickTab", { label: "全部产品" }]]);
  const [c2Seed, c2Click] = states.c2.steps;
  assert.equal(c2Seed[0], "seedTasks");
  assert.deepEqual(c2Seed[1].tasks, SEED_TASK_GROUPS.c2);
  assert.deepEqual(c2Click, ["clickTab", { label: "全平台" }]);
  // 断言文字锚在稳定的标题上;c2 另锚排队次日的状态标签
  assert.deepEqual(states.c1.texts, ["运行中的任务"]);
  assert.deepEqual(states.c2.texts, ["全平台批量发布", "发布进度", "排队次日"]);
});

test("c 组种子任务:失败任务不带 scheduledAt(立即建单即失败,回执就带 failure),定时任务都在 30 分钟后", () => {
  for (const group of Object.values(SEED_TASK_GROUPS)) {
    for (const spec of group) {
      const { draft, expectStatus } = spec;
      if (expectStatus === "failure") {
        assert.equal(draft.scheduledAt, undefined, `${spec.id} 应立即建单(无 scheduledAt)`);
      } else {
        const at = Date.parse(draft.scheduledAt);
        assert.ok(Number.isFinite(at), `${spec.id} 的 scheduledAt 应可解析`);
        assert.ok(at > Date.now() + 29 * 60_000, `${spec.id} 的定时任务应在 30 分钟后,审计期间不执行`);
      }
      assert.equal(expectStatus === "failure", draft.scheduledAt === undefined, `${spec.id} 的 expectStatus 与 scheduledAt 应一致`);
    }
  }
});

test("c 组种子任务:c1 非批次;c2 三条同批、角色齐全且失败成员排第一;账号 ID 都是不存在的", () => {
  for (const spec of SEED_TASK_GROUPS.c1) {
    assert.equal(spec.draft.batchId, undefined, "c1 不带批次字段");
    assert.equal(spec.draft.batchRole, undefined);
  }
  const [member, verification, queued] = SEED_TASK_GROUPS.c2;
  const batchIds = new Set(SEED_TASK_GROUPS.c2.map((spec) => spec.draft.batchId));
  assert.equal(batchIds.size, 1);
  assert.ok(batchIds.values().next().value, "批次 ID 非空");
  assert.deepEqual(SEED_TASK_GROUPS.c2.map((spec) => spec.draft.batchRole), ["member", "verification", "queued"]);
  assert.equal(member.expectStatus, "failure", "失败成员必须排第一:此刻批里还没有首发验证,闸门与级联都拦不到它");
  assert.equal(verification.expectStatus, "scheduled");
  // 排队次日:明天本地时间 08:05(implement.md §1 第 2 条)
  const queuedAt = new Date(queued.draft.scheduledAt);
  assert.equal(queuedAt.getHours(), 8);
  assert.equal(queuedAt.getMinutes(), 5);
  assert.ok(queuedAt.getTime() > Date.now());
  for (const group of Object.values(SEED_TASK_GROUPS)) {
    for (const spec of group) {
      assert.ok(spec.draft.accountIds.length === 1 && spec.draft.accountIds[0].length > 0);
      assert.ok(!spec.draft.accountIds[0].includes("real"), "种子账号一律是不存在的 ID(零外发保证)");
    }
  }
});

test("c 组种子草稿:字段照草稿契约给全且经 JSON 往返不变(页面参数走 JSON 序列化)", () => {
  for (const group of Object.values(SEED_TASK_GROUPS)) {
    for (const spec of group) {
      const draft = JSON.parse(JSON.stringify(spec.draft));
      assert.equal(draft.projectId, AUDIT_PROJECT_ID);
      assert.equal(draft.contentType, "image-text");
      assert.ok(draft.title.length > 0 && draft.title.length <= 100);
      assert.equal(draft.visibility, "public");
      assert.deepEqual(draft.platformOptions, { platform: "xhs" });
      assert.equal(draft.assets.length, 1);
      assert.deepEqual(draft.assets[0], { assetId: "ui-audit-asset-1", projectId: AUDIT_PROJECT_ID, kind: "image", approvedUrl: "https://example.invalid/ui-audit.png" });
      assert.ok(!Number.isNaN(Date.parse(draft.updatedAt)));
      // expectStatus 与任务列表动作的 spec 形状
      assert.deepEqual(Object.keys(spec).sort(), ["draft", "expectStatus", "id"]);
    }
  }
});

test("种子数据:产品与模板的字段照类型给全,时间戳固定,模板绑在第一件产品上", () => {
  // 字段清单照 types/product.ts 的 Product 与 types/promotion-template.ts 的 PromotionTemplate,按键名升序。
  const productKeys = ["brandProfile", "coverImage", "createdAt", "description", "detail", "id", "links", "name", "projectIds", "promotion", "slug", "tags", "updatedAt"];
  for (const product of SEED_PRODUCTS) {
    assert.deepEqual(Object.keys(product).sort(), productKeys, product.id);
    // 主进程的 upsert 只校验 id、name、slug 是字符串且 id 非空
    assert.ok(product.id.trim() && typeof product.name === "string" && typeof product.slug === "string");
    assert.ok(Array.isArray(product.links) && Array.isArray(product.tags) && Array.isArray(product.projectIds));
    assert.ok(product.promotion.defaultTags && product.promotion.utm && product.promotion.ctaType);
  }
  assert.equal(new Set(SEED_PRODUCTS.map((product) => product.id)).size, 2);
  assert.deepEqual(
    Object.keys(SEED_TEMPLATE).sort(),
    ["bodyTemplate", "createdAt", "defaultTags", "id", "mediaSlots", "name", "platform", "productId", "titleTemplate", "updatedAt"],
  );
  assert.equal(SEED_TEMPLATE.productId, SEED_PRODUCTS[0].id);
  assert.equal(SEED_TEMPLATE.platform, "xhs");
});

// ── 失败项归属 ─────────────────────────────────────────────────────────────

test("parseThemeTokens / classifyContrastScope:主色前景压主色记 theme-token,其余记 panel", () => {
  const tokens = parseThemeTokens({ primary: "rgb(0, 114, 245)", primaryForeground: "rgb(255, 255, 255)" });
  assert.deepEqual(tokens, { primary: { r: 0, g: 114, b: 245, a: 1 }, primaryForeground: { r: 255, g: 255, b: 255, a: 1 } });
  // 变量没解析出来(透明或空)时返回 null,调用方一律记 panel
  assert.equal(parseThemeTokens({ primary: "rgba(0, 0, 0, 0)", primaryForeground: "rgb(255, 255, 255)" }), null);
  assert.equal(parseThemeTokens(null), null);

  const button = { rule: "contrast", foreground: "rgb(255, 255, 255)", background: { r: 0, g: 114, b: 245, a: 1 } };
  assert.equal(classifyContrastScope(button, tokens), "theme-token");
  // 取整带来的一两档偏差不影响归属
  assert.equal(classifyContrastScope({ ...button, background: { r: 1, g: 115, b: 246, a: 1 } }, tokens), "theme-token");
  const hint = { rule: "contrast", foreground: "rgb(80, 94, 87)", background: { r: 198, g: 219, b: 196, a: 1 } };
  assert.equal(classifyContrastScope(hint, tokens), "panel");
  assert.equal(classifyContrastScope(button, null), "panel");
});

test("countByScope:对比度失败按归属分计,其它规则计 other;退出码只看有没有失败项", () => {
  const failures = [
    { rule: "contrast", scope: "theme-token" },
    { rule: "contrast", scope: "theme-token" },
    { rule: "contrast", scope: "panel" },
    { rule: "navigation" },
  ];
  assert.deepEqual(countByScope(failures), { panel: 1, themeToken: 2, other: 1 });
  assert.deepEqual(countByScope([]), { panel: 0, themeToken: 0, other: 0 });
  // 只有主题 token 级失败项时退出码仍是「有发现」,不因为归属而放行
  assert.equal(resolveExitCode({ failures: [{ rule: "contrast", scope: "theme-token" }] }), EXIT_CODES.findings);
});
