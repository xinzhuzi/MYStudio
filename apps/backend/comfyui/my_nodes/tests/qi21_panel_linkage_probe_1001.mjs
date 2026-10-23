#!/usr/bin/env node
/** P3 qi21 面板联动探针(1001,jsdom 仿真——引擎实弹另跑 CDP 场景):
 *  装载真 qi21-panel-linkage.js(/scripts/app.js 唯一导入重定向到 jsdom 桩,
 *  余零改),覆盖:静态门(AGPL 头逐字节/零道劫词/导入面恰一处)+ tokens
 *  设计钉死值(400ms/自由/五控件名/子图名锚词)+ 宿主门控(t2i 双保险两路
 *  命中/i2i 旧形态不命中/edit 旧形态不命中/签名齐但锚词双缺不命中)+
 *  联动四场景(九型→透明隐藏/自由→显示/PE开→手填隐藏/PE关→显示)+
 *  零值写断言(全场景五控件值原样=「只管显隐不管值」)+ onWidgetChanged
 *  链式包装(即时联动/原钩子链保留/幂等不双层)+ 轮询兜底(hidden 被外部
 *  重置后 ≤1 tick 自动复原)+ dirty 才 setDirtyCanvas(空转零重复)+ 注册面
 *  (恰 setup 一钩)。 */
import { JSDOM } from "jsdom";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB = join(HERE, "../web");
const EXT = join(WEB, "qi21-panel-linkage.js");
const SIBLING = join(WEB, "daojie-subgraph-autofit.js");

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/" });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.addEventListener = dom.window.addEventListener.bind(dom.window);

let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? " — " + extra : ""}`); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const tmp = await mkdtemp(join(tmpdir(), "qi21-panel-linkage-probe-"));
try {
  // ── 桩:/scripts/app.js(本件唯一 /scripts/* 依赖) ───────────────────
  const stubApp = join(tmp, "stub-app.mjs");
  await writeFile(stubApp, `export const app = {
  __registry: [],
  registerExtension(ext) { this.__registry.push(ext); },
};
`);
  const extSrc = await readFile(EXT, "utf8");
  const proxyExt = join(tmp, "ext.proxy.mjs");
  await writeFile(proxyExt, extSrc
    .replace('from "/scripts/app.js"', `from ${JSON.stringify(pathToFileURL(stubApp).href)}`));

  // ── 静态门 ──────────────────────────────────────────────────────────
  console.log("[静态门]");
  const headerOf = async (p) => (await readFile(p, "utf8")).split("\n").slice(0, 3).join("\n") + "\n";
  ok("AGPL 头与兄弟件逐字节一致", (await headerOf(EXT)) === (await headerOf(SIBLING)));
  ok("新件零道劫词", !extSrc.includes("道劫"));
  ok("导入面恰 /scripts/app.js 一处(无 api/其他依赖)",
    (extSrc.match(/from "\/scripts\//g) ?? []).length === 1 && extSrc.includes('from "/scripts/app.js"'));

  // ── 装载 + tokens ───────────────────────────────────────────────────
  const { app } = await import(stubApp);
  await import(proxyExt);
  const { QI21_PANEL_LINKAGE_TOKENS: T } = await import(proxyExt);
  const ext = app.__registry.find((e) => e.name === "my.qi21.panel.linkage");
  ok("扩展已注册(名 my.qi21.panel.linkage)", !!ext,
    `registry=${app.__registry.map((e) => e.name).join(",")}`);

  console.log("[tokens]");
  ok("轮询周期=400ms(设计钉死)", T.tickMs === 400);
  ok("自由档名=自由(设计钉死)", T.freeType === "自由");
  ok("五控件名钉死", JSON.stringify(T.widgetNames) ===
    JSON.stringify({ type: "型选择", pe: "PE开关", alpha: "透明", manualW: "手动宽", manualH: "手动高" }),
    JSON.stringify(T.widgetNames));
  ok("子图名锚词钉死", T.subgraphNameHint === "提示词类型优化子图");

  // ── 桩件工厂 ────────────────────────────────────────────────────────
  const mkWidget = (name, value, type) => ({ name, value, type, hidden: false });
  const mkNode = ({ title, subgraphName, widgets, withOnWidgetChanged }) => {
    let dirtyCalls = 0;
    const node = {
      title, widgets, subgraph: subgraphName == null ? undefined : { name: subgraphName },
      computeSize() { return [100, 100]; },
      setDirtyCanvas() { dirtyCalls++; },
    };
    if (withOnWidgetChanged) {
      node.onWidgetChanged = function () { this.__origCalls = (this.__origCalls || 0) + 1; };
    }
    node.__dirtyCalls = () => dirtyCalls;
    return node;
  };
  // t2i 术后宿主面板:主体句+型选择+PE开关+透明+手动宽+手动高(Q3 序)
  const t2iWidgets = () => [
    mkWidget("主体句", "一位筑基后期的年轻女修……", "text"),
    mkWidget("型选择", "人物", "combo"),
    mkWidget("PE开关", true, "toggle"),
    mkWidget("透明", false, "toggle"),
    mkWidget("手动宽", 0, "number"),
    mkWidget("手动高", 0, "number"),
  ];
  // i2i 旧形态:型选择+RGBA透明(三态 combo)+PE开关(无 透明布尔/手动宽高)
  const i2iWidgets = () => [
    mkWidget("主体句", "…", "text"),
    mkWidget("型选择", "人物", "combo"),
    mkWidget("PE开关", false, "toggle"),
    mkWidget("RGBA透明", "跟随型", "combo"),
    mkWidget("画幅联动开关", true, "toggle"),
  ];
  // edit 旧形态:仅 PE开关
  const editWidgets = () => [mkWidget("PE开关", false, "toggle"), mkWidget("seed", 42, "number")];

  const host = mkNode({
    title: "[40] 提示词类型优化子图",
    subgraphName: "[40] 提示词类型优化子图(双击进入)",
    widgets: t2iWidgets(),
    withOnWidgetChanged: true,
  });
  const i2i = mkNode({ title: "[40] 提示词类型优化子图(双击进入)", subgraphName: "[40] 提示词类型优化子图(双击进入)", widgets: i2iWidgets() });
  const edit = mkNode({ title: "[40] 提示词类型优化子图(双击进入)", subgraphName: "[40] 提示词类型优化子图(双击进入)", widgets: editWidgets() });
  const noAnchor = mkNode({ title: "随便什么", subgraphName: undefined, widgets: t2iWidgets() });
  const titleOnly = mkNode({ title: "[40] 提示词类型优化子图", subgraphName: undefined, widgets: t2iWidgets() });

  // ── setup(真实 setInterval,探针末 process.exit 收束) ─────────────
  console.log("[setup·首轮同步应用]");
  app.graph = { _nodes: [host, i2i, edit, noAnchor, titleOnly] };
  ext.setup();
  const W = host.widgets;
  const byName = (n, name) => n.widgets.find((w) => w.name === name);
  ok("t2i 宿主已附着(子图名锚命中)", typeof host.onWidgetChanged === "function" && !!host.onWidgetChanged.__qi21PanelLinkage);
  ok("title-only 宿主也附着(title 锚回落)", typeof titleOnly.onWidgetChanged === "function");
  ok("i2i 旧形态零附着", i2i.onWidgetChanged === undefined);
  ok("edit 旧形态零附着", edit.onWidgetChanged === undefined);
  ok("签名齐但锚词双缺零附着", noAnchor.onWidgetChanged === undefined);

  // ── 联动四场景(ask 口径:型九型→透明隐藏/自由→显示/pe开→手填隐藏/pe关→显示)
  console.log("[联动四场景]");
  ok("场景1 型=人物(九型)→ 透明隐藏", byName(host, "透明").hidden === true);
  ok("场景3 PE开=true → 手动宽/手动高隐藏",
    byName(host, "手动宽").hidden === true && byName(host, "手动高").hidden === true);

  const alpha0 = W.find((w) => w.name === "透明").value;
  byName(host, "型选择").value = "自由";
  host.onWidgetChanged("型选择", "自由", "人物", byName(host, "型选择"));
  ok("场景2 型=自由 → 透明显示(onWidgetChanged 即时通路)", byName(host, "透明").hidden === false);

  byName(host, "PE开关").value = false;
  host.onWidgetChanged("PE开关", false, true, byName(host, "PE开关"));
  ok("场景4 PE关=false → 手动宽/手动高显示(即时通路)",
    byName(host, "手动宽").hidden === false && byName(host, "手动高").hidden === false);

  // ── 零值写(「只管显隐不管值」:全场景联动后值原样) ─────────────────
  console.log("[零值写]");
  const vals = {};
  for (const w of host.widgets) vals[w.name] = w.value;
  byName(host, "型选择").value = "道具";
  host.onWidgetChanged("型选择", "道具", "自由", byName(host, "型选择"));
  byName(host, "PE开关").value = true;
  host.onWidgetChanged("PE开关", true, false, byName(host, "PE开关"));
  ok("切九型/切PE后 透明布尔值原样不被覆写(恒存)", byName(host, "透明").value === alpha0);
  ok("手动宽/手动高值原样不被覆写",
    byName(host, "手动宽").value === vals["手动宽"] && byName(host, "手动高").value === vals["手动高"]);
  ok("主体句值原样", byName(host, "主体句").value === vals["主体句"]);
  ok("联动重应用(道具+PE开)→ 透明/手填复隐藏",
    byName(host, "透明").hidden === true && byName(host, "手动宽").hidden === true);

  // ── onWidgetChanged 链式包装 ────────────────────────────────────────
  console.log("[链式包装]");
  const callsBefore = host.__origCalls || 0;
  host.onWidgetChanged("型选择", "自由", "道具", byName(host, "型选择"));
  ok("原钩子被调(链保留)", (host.__origCalls || 0) === callsBefore + 1);
  ok("包装幂等(重复 attach 不双层)", host.onWidgetChanged.__qi21PanelLinkage === true);

  // ── 轮询兜底:hidden 外部重置(模拟 store 投影重建)≤1 tick 复原 ────
  console.log("[轮询兜底]");
  byName(host, "型选择").value = "自由";
  await sleep(T.tickMs + 60); // 走纯值变化(不经钩子)= 轮询通路
  ok("纯 value 变化经轮询联动(自由→透明显示)", byName(host, "透明").hidden === false);
  byName(host, "透明").hidden = false; // 当前期望即 false,先翻到 true 再看复原:
  byName(host, "透明").hidden = false;
  byName(host, "型选择").value = "人物"; // 期望隐藏
  byName(host, "透明").hidden = false;   // 外部强置(丢失态)
  await sleep(T.tickMs + 60);
  ok("hidden 丢失自动重写(人物→透明复隐藏)", byName(host, "透明").hidden === true);

  // ── dirty 才 setDirtyCanvas(空转零重复) ────────────────────────────
  console.log("[setDirtyCanvas]");
  const d0 = host.__dirtyCalls();
  await sleep(T.tickMs + 60); // 状态无变化空转一轮
  await sleep(T.tickMs + 60);
  ok("无变化空转零新增 setDirtyCanvas", host.__dirtyCalls() === d0, `before=${d0} after=${host.__dirtyCalls()}`);

  // ── 注册面:恰 setup 一钩 ───────────────────────────────────────────
  console.log("[注册面]");
  ok("扩展钩子面恰 setup 一项", Object.keys(ext).length === 2 && ext.name !== undefined && typeof ext.setup === "function",
    JSON.stringify(Object.keys(ext)));
} finally {
  await rm(tmp, { recursive: true, force: true }).catch(() => {});
}
console.log(`\nqi21-panel-linkage 探针: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
