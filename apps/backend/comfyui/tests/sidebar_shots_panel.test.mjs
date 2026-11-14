// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
/**
 * 分镜阶段面板(renderShotsPane)grill 门禁(11-15-shots-pane-grill)。
 * 跑法:node --test apps/backend/comfyui/tests/sidebar_shots_panel.test.mjs
 *
 * 被测对象 = my_nodes/web/sidebar.js 真源(剥 ES import/export 后 vm 直跑,
 * theme/open-workflow helper 全桩;断言面=行为:动作接线 kind/origin 双参、
 * 进度与画面真值计数、镜行回填参数、刷新键挂载位置与重拉、文案契约)。
 * theme.js statusBadge 文案(未生图)以源码契约钉(vm 不加载 theme.js,
 * 其含 /scripts/app.js 副作用)。
 * 双 runner 适配(同 daoyan_panel.test.mjs 头注口径):VT 全量默认 glob
 * 拾取 *.test.mjs,node:test 用例不被 vitest 认领→套套红;按 runner 取
 * 注册 API,断言面零改。
 */
const { test } = await import(process.env.VITEST ? "vitest" : "node:test");
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.resolve(HERE, "../my_nodes/web");

/** 最小 DOM stub:append 记序、textContent/style 直存、closest 可注入 */
function stubElement(tag = "div") {
  const el = {
    tagName: tag, children: [], textContent: "", title: "", style: {},
    append(...nodes) { el.children.push(...nodes); },
    appendChild(node) { el.children.push(node); return node; },
    remove() {}, click() {},
    setAttribute() {}, getAttribute() { return null; },
    querySelector() { return null; }, querySelectorAll() { return []; },
    closest() { return null; },
    addEventListener() {}, removeEventListener() {},
  };
  return el;
}

/** 剥 ES import(多行感知)与 export 行 → vm 可直跑的脚本体 */
function stripModuleSyntax(source) {
  const out = [];
  let inImport = false;
  for (const line of source.split("\n")) {
    const t = line.trim();
    if (inImport) {
      if (/from\s+"[^"]+";?$/.test(t)) inImport = false;
      continue;
    }
    if (t.startsWith("import ")) {
      if (!/from\s+"[^"]+";?$/.test(t)) inImport = true;
      continue;
    }
    if (t.startsWith("export ")) continue;
    out.push(line);
  }
  return out.join("\n");
}

const FIXTURE = {
  updatedAt: Date.now(), staleAfterMs: 900000,
  currentEpisodeId: "chapter-001", originProjectId: "project-a",
  shots: [
    { id: "sb-1", label: "S01 · 开篇", episodeId: "chapter-001", videoReady: true, imageReady: true },
    { id: "sb-2", label: "S02", episodeId: "chapter-001", videoReady: false, imageReady: true },
    { id: "sb-3", label: "S03", episodeId: "chapter-001", videoReady: false, imageReady: false },
  ],
};

/** 装载真源 + 跑 renderShotsPane + 等异步链沉淀 → { sandbox, pane, barActions, rec } */
async function renderPane({ snapshot = FIXTURE, withBarActions = true } = {}) {
  const rec = {
    sections: [], buttons: [], badges: [], progress: [], groups: [],
    postJson: [], apply: [], binds: 0, fetchShots: 0, fetchJson: 0,
  };
  const pane = stubElement();
  const barActions = stubElement();
  const barHost = stubElement();
  barHost.querySelector = (sel) => (String(sel).includes("data-my-bar-actions") ? barActions : null);
  pane.closest = (sel) => (String(sel).includes("data-my-ui") && withBarActions ? barHost : null);

  const sandbox = {
    console, Date, JSON, Math, Number, String, Boolean, Array, Object,
    Map, Set, Promise, isFinite, parseInt, parseFloat, Error,
    setTimeout: (fn) => { if (typeof fn === "function") fn(); }, clearTimeout() {},
    THEME: { accent: "#6ea8fe", accentDim: "rgba(0,0,0,.2)", text2: "#9aa4b2", line: "#333a45", ok: "#4ade80", pending: "#fbbf24", idle: "#7d8ba1" },
    ICONS: new Proxy({}, { get: () => "M0 0" }),
    icon: () => stubElement("svg"),
    sectionLabel: (text) => { rec.sections.push(text); return stubElement(); },
    paneStatus: (text) => { const el = stubElement("p"); el.textContent = text; return el; },
    statusBadge: (kind) => { rec.badges.push(kind); const el = stubElement("span"); el.__kind = kind; return el; },
    progressBar: (done, total) => { rec.progress.push([done, total]); return stubElement(); },
    collapseGroup: (title, count, opts = {}) => { rec.groups.push({ title, count, tone: opts.tone, open: !!opts.open }); return stubElement("details"); },
    actionButton: ({ label, primary }) => { const el = stubElement("button"); el.__btn = { label, primary }; rec.buttons.push(el); return el; },
    fetchJson: async () => { rec.fetchJson += 1; return { currentEpisodeId: snapshot.currentEpisodeId }; },
    fetchShots: async () => { rec.fetchShots += 1; return snapshot; },
    postJson: async (url, body) => { rec.postJson.push({ url, body }); return { duplicate: false }; },
    bindSelectedProject: async () => { rec.binds += 1; return { ok: true, message: "已绑定回写项目:project-a" }; },
    applyShotToSelection: (...args) => { rec.apply.push(args); return { ok: true, message: "已回填" }; },
    snapshotOrigin: (data) => (data && data.originProjectId) || "",
    BRIDGE_URL: "http://bridge.test",
    myScope: () => "studio",
    syncMySettingsFlags: () => {},
    app: { registerExtension() {} },
    MY_STORE_BASE: "", cloneGraph: (g) => g,
    openWorkflowSingleInstance: async () => {}, cleanupLegacyUnsavedTabs: () => {},
    document: { createElement: (tag) => stubElement(tag) },
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;

  const ctx = vm.createContext(sandbox);
  vm.runInContext(stripModuleSyntax(readFileSync(path.join(WEB, "sidebar.js"), "utf8")), ctx, { filename: "sidebar.js" });
  sandbox.renderShotsPane(pane);
  await new Promise((resolve) => setTimeout(resolve, 10)); // void 异步链(章节拉取+load)沉淀
  return { sandbox, pane, barActions, rec };
}

/** 递归收集树内全部元素 */
function walk(el, out = []) {
  out.push(el);
  for (const child of el.children || []) walk(child, out);
  return out;
}

const findText = (root, needle) => walk(root).find((el) => String(el.textContent).includes(needle));

test("章节徽章=真值(chapter-001 落位)", async () => {
  const { pane } = await renderPane();
  const pill = pane.children[0];
  assert.equal(pill.children.length, 2); // dot + text
  assert.equal(pill.children[1].textContent, "chapter-001");
});

test("退役块清零:无「分镜工作流」分区、无「主线随」叙述文案", async () => {
  const { pane, rec } = await renderPane();
  assert.deepEqual(rec.sections, ["制作动作", "视频进度"]); // 仅此二分区,顺序即渲染序
  const allText = walk(pane).map((el) => String(el.textContent)).join("|");
  assert.ok(!allText.includes("主线随"), `叙述文案应清场,实际:${allText}`);
  assert.ok(!allText.includes("加载主线"), "退役块的初始态文案不应再出现");
});

test("制作动作三按钮:一键生图唯一主按钮,视频/绑定次级", async () => {
  const { rec } = await renderPane();
  assert.deepEqual(rec.buttons.map((b) => b.__btn), [
    { label: "一键生图", primary: true },
    { label: "一键生成视频", primary: false },
    { label: "绑定当前项目", primary: false },
  ]);
});

test("一键生图真接线:generate-images + origin 双参", async () => {
  const { rec } = await renderPane();
  rec.buttons[0].onclick();
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(rec.postJson.length, 1);
  assert.ok(rec.postJson[0].url.includes("/comfy/bridge/actions"));
  // body 在 vm realm 造出,展开拷贝到本 realm 再 deepEqual(跨 realm 原型差异)
  assert.deepEqual({ ...rec.postJson[0].body }, { kind: "generate-images", originProjectId: "project-a", originEpisodeId: "chapter-001" });
});

test("一键生成视频真接线+状态文案用按钮全名", async () => {
  const { pane, rec } = await renderPane();
  rec.buttons[1].onclick();
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(rec.postJson[0].body.kind, "generate-videos");
  const actionStatus = findText(pane, "已提交");
  assert.ok(actionStatus, "应有提交反馈");
  assert.equal(actionStatus.textContent, "一键生成视频:已提交,宿主执行中");
});

test("绑定当前项目走 bindSelectedProject 通道", async () => {
  const { pane, rec } = await renderPane();
  await rec.buttons[2].onclick();
  assert.equal(rec.binds, 1);
  assert.ok(findText(pane, "已绑定回写项目"), "绑定结果应有状态反馈");
});

test("视频进度真值:已出视频 1/3 进度条 + 画面 2/3 文本 + 两折叠组计数", async () => {
  const { pane, rec } = await renderPane();
  assert.deepEqual(rec.progress, [[1, 3]]);
  assert.equal(findText(pane, "画面 2/3").textContent.startsWith("画面 2/3"), true);
  assert.deepEqual(rec.groups, [
    { title: "已出视频", count: 1, tone: "done", open: false },
    { title: "待出视频", count: 2, tone: "pending", open: false },
  ]);
});

test("镜行回填接线:参数三件套 + 徽章三态(done/pending/idle)", async () => {
  const { pane, rec } = await renderPane();
  assert.deepEqual(rec.badges, ["done", "pending", "idle"]);
  // 镜行=list 树内带 onclick 且携带徽章子的 button(refresh 键无 __kind 子,天然排除)
  const rows = walk(pane).filter((el) => el.tagName === "button" && el.onclick
    && el.children.length === 2 && el.children[1] && el.children[1].__kind);
  assert.equal(rows.length, 3);
  rows[0].onclick();
  assert.deepEqual(rec.apply, [["sb-1", "S01 · 开篇", "project-a"]]);
});

test("刷新键挂页签动作槽(不占 pane 体);点击真重拉;槽缺席回退 pane 底", async () => {
  const first = await renderPane();
  assert.equal(first.barActions.children.length, 1);
  assert.equal(first.barActions.children[0].title, "刷新分镜列表");
  assert.ok(!walk(first.pane).some((el) => el.title === "刷新分镜列表"), "pane 体不应再出现刷新键(槽在位时)");
  first.barActions.children[0].onclick();
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(first.rec.fetchShots, 2, "初始拉取+点击重拉");

  const fallback = await renderPane({ withBarActions: false });
  assert.ok(walk(fallback.pane).some((el) => el.title === "刷新分镜列表"), "槽缺席应回退 pane 底");
});

test("快照较旧提示=新措辞(指向漫影分镜面板)", async () => {
  const stale = { ...FIXTURE, updatedAt: Date.now() - 16 * 60 * 1000 };
  const { pane } = await renderPane({ snapshot: stale });
  const line = findText(pane, "快照较旧");
  assert.ok(line, "应有较旧提示");
  assert.ok(line.textContent.includes("快照较旧(打开漫影分镜面板刷新)"), `措辞应为新口径,实际:${line.textContent}`);
  assert.ok(!line.textContent.includes("画布页"));
});

test("文案契约(theme.js 徽章正名 + sidebar.js 死物清零)", () => {
  const theme = readFileSync(path.join(WEB, "theme.js"), "utf8");
  assert.ok(theme.includes('"未生图"'), "statusBadge idle 应为「未生图」");
  assert.ok(!theme.includes('"未绑定"'), "「未绑定」误导文案应清场");
  const sidebar = readFileSync(path.join(WEB, "sidebar.js"), "utf8");
  assert.ok(!sidebar.includes("myTooltipsEnabled"), "死 import 应清");
  assert.ok(!sidebar.includes("主线随"), "退役叙述文案应清场");
});
