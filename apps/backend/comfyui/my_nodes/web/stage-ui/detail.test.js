// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
/**
 * 详情浮层·纯函数断言(stage-ui/detail,1115 详情入 ComfyUI)。
 * 跑法:node --test apps/backend/comfyui/my_nodes/web/stage-ui/detail.test.js
 * (node --test my_nodes/web 目录扫描亦收入)
 *
 * 机器钉面(方案 D1/D3/D4 分档如实):
 * - resolveDetailRequest 四模式分派(chapterShots/shot/asset/workbench)+
 *   真文档型(script)不进浮层;
 * - chapterListHTML/shotHTML/assetHTML/workbenchHTML 关键字段与
 *   data-act/data-shot-id/data-asset-name 属性在案(「点出详情」入口钉);
 * - alignShotId 旧行对齐:数符→id,数不符→null(禁错开镜);
 * - D3 属性钉:storyboard-table/storyboard-panel/assets 三型渲染 HTML 含
 *   点击属性(模块直 import,ESM 纯渲染零 DOM);
 * - D4/D5 源码契约钉:stage-node.js(pointer-events 规则串/HINTS_ITEMS
 *   退役/9999 渲染器在案)——stage-node 顶层 import /scripts/app.js 不可
 *   直跑,故走源码串断言(sidebar_shots_panel 同款口径)。
 * 浮层开合/遮罩关闭/wireActions 双入口实点=手验清单,非机器钉(记档)。
 *
 * 双 runner 适配(同 open-receipt.test.mjs 头注口径):VT 全量默认 glob
 * 拾取 *.test.js,node:test 用例不被 vitest 认领→套套红;按 runner 取
 * 注册 API,断言面零改。
 */
const { test } = await import(process.env.VITEST ? "vitest" : "node:test");
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const {
  resolveDetailRequest, alignShotId,
  chapterListHTML, shotHTML, assetHTML, assetOverviewHTML, workbenchHTML,
} = await import("./detail.js");
const storyboardTableUI = (await import("./storyboard-table.js")).default;
const storyboardPanelUI = (await import("./storyboard-panel.js")).default;
const assetsUI = (await import("./assets.js")).default;

// ── resolveDetailRequest 四模式分派 ─────────────────────────────────

test("resolveDetailRequest: view-doc 五型分派(详情型进浮层,script 不进)", () => {
  const ctx = { projectId: "p1", chapter: "chapter-001", payload: {} };
  assert.equal(resolveDetailRequest({ kind: "storyboardTable", ...ctx }).mode,
    "chapterShots");
  assert.equal(resolveDetailRequest({ kind: "storyboard", ...ctx }).mode,
    "chapterShots");
  assert.equal(resolveDetailRequest({ kind: "assets", ...ctx }).mode, "asset");
  assert.equal(resolveDetailRequest({ kind: "workbench", ...ctx }).mode,
    "workbench");
  assert.equal(resolveDetailRequest({ kind: "remotionProduction", ...ctx }).mode,
    "workbench");
  // 真文档型(script/scriptPlan「全文」)=null 不进浮层
  assert.equal(resolveDetailRequest({ kind: "script", ...ctx }), null);
  assert.equal(resolveDetailRequest({ kind: "scriptPlan", ...ctx }), null);
});

test("resolveDetailRequest: 行/贴/卡点击分派(有 id 直达,缺 id 走对齐兜底)", () => {
  const ctx = { projectId: "p1", chapter: "chapter-001", payload: {} };
  const shot = resolveDetailRequest({ act: "shot-detail", shotId: "sb-c1-007", ...ctx });
  assert.equal(shot.mode, "shot");
  assert.equal(shot.shotId, "sb-c1-007");
  const legacy = resolveDetailRequest({ act: "shot-detail", idx: 7, rowCount: 19, ...ctx });
  assert.equal(legacy.mode, "chapterShots");
  assert.equal(legacy.needAlign, true);
  assert.equal(legacy.alignIndex, 7);
  assert.equal(legacy.rowCount, 19);
  const asset = resolveDetailRequest({ act: "asset-detail", assetName: "青盐鞭", ...ctx });
  assert.equal(asset.mode, "asset");
  assert.equal(asset.assetName, "青盐鞭");
});

// ── alignShotId 旧行对齐(跨源一致性:行数不符禁错开镜) ───────────────

test("alignShotId: 数符→id;数不符/无该行→null", () => {
  const list = { shots: [
    { index: 1, id: "sb-c1-001" }, { index: 2, id: "sb-c1-002" },
    { index: 3, id: "sb-c1-003" },
  ] };
  assert.equal(alignShotId(list, 3, 2), "sb-c1-002");
  assert.equal(alignShotId(list, 19, 2), null);  // 行数≠清单数=换代,禁猜
  assert.equal(alignShotId(list, 3, 9), null);   // 无该行号
  assert.equal(alignShotId(null, 3, 1), null);
});

// ── 四模式 HTML 关键字段 ─────────────────────────────────────────────

test("chapterListHTML: 行带 data-act=shot-detail+data-shot-id;换代警示文案", () => {
  const data = { shots: [
    { index: 1, id: "sb-c1-001", title: "巷口夜街", lines: "台词一",
      duration: 6, state: "ready", imageReady: true },
  ] };
  const html = chapterListHTML(data);
  assert.match(html, /data-act="shot-detail"/);
  assert.match(html, /data-shot-id="sb-c1-001"/);
  assert.match(html, /巷口夜街/);
  const warned = chapterListHTML(data, { mismatch: true });
  assert.match(warned, /表\/分片换代不一致，请重开工作流/);
});

test("shotHTML: 15 列标签+台词全量+图/视频 URL 属性", () => {
  const shot = {
    id: "sb-c1-001", state: "ready", imageReady: true, revision: 3,
    imageUrl: "/my_daoyan/chapter_image?project=p1&rel=a%2Fb.png",
    videoUrl: "/my_daoyan/chapter_image?project=p1&rel=c%2Fd.mp4",
    columns: [
      ["镜号", 1], ["场次", "001-01"], ["画面描述", "塾馆巷口夜街"],
      ["视频描述", "人流行进"], ["时长", "6 秒"], ["景别", "全景"],
      ["运镜", "极缓移"], ["动作", "入画 → 出画"], ["朝向", "正面"],
      ["空间关系", "中轴"], ["情绪", "紧绷"], ["台词", "背囊里，归元又是一烫。"],
      ["旁白", "旁白一"], ["音效", "音效:风"], ["关联资产", "独孤剑尘、青盐鞭"],
    ],
  };
  const html = shotHTML(shot);
  for (const label of ["镜号", "场次", "画面描述", "视频描述", "时长", "景别",
    "运镜", "动作", "朝向", "空间关系", "情绪", "台词", "旁白", "音效",
    "关联资产"]) {
    assert.match(html, new RegExp(`<dt>${label}</dt>`), label);
  }
  assert.match(html, /背囊里，归元又是一烫。/);
  assert.match(html, /sb-c1-001/);
  assert.match(html, /src="\/my_daoyan\/chapter_image\?project=p1&amp;rel=a%2Fb\.png"/);
  assert.match(html, /data-act="shot-video"/);
  assert.match(html, /data-url="\/my_daoyan\/chapter_image\?project=p1&amp;rel=c%2Fd\.mp4"/);
});

test("assetHTML: cover/prompt/state/血缘(D0 扩键);缺键优雅退化", () => {
  const html = assetHTML({
    name: "青盐鞭", typeLabel: "道具", state: "ready", cover: "asset-1.jpg",
    prompt: "赤练蛇皮长鞭，一圈圈绕在肩上", sourceName: "赵四",
    derivedNames: ["青盐鞭·夜行"],
  });
  assert.match(html, /青盐鞭/);
  assert.match(html, /赤练蛇皮长鞭/);
  assert.match(html, /源卡/);
  assert.match(html, /赵四/);
  assert.match(html, /青盐鞭·夜行/);
  assert.match(html, /\/view\?filename=asset-1\.jpg/); // cover 走引擎 input 口
  // 旧载荷(无 D0 扩键):退化「—」不炸
  const bare = assetHTML({ name: "赵四", typeLabel: "角色" });
  assert.match(bare, /—/);
  assert.doesNotMatch(bare, /undefined/);
  assert.match(assetHTML(null), /未找到该资产卡/);
});

test("assetOverviewHTML: 总览行带 data-act=asset-detail+data-asset-name", () => {
  const html = assetOverviewHTML({ assets: [
    { name: "青盐鞭", typeLabel: "道具", state: "ready" },
  ] });
  assert.match(html, /data-act="asset-detail"/);
  assert.match(html, /data-asset-name="青盐鞭"/);
});

test("workbenchHTML: 轨道+finalExport 徽章+逐镜队列(载荷直渲)", () => {
  const html = workbenchHTML({
    finalExport: true, rendererLabel: "remotion → h3",
    tracks: [{ name: "轨道一", state: "ready", count: 3, mediaCount: 2, duration: 65 }],
    shots: [{ index: 1, label: "分镜 1", videoReady: true, ttsReady: true }],
  });
  assert.match(html, /已导出成片/);
  assert.match(html, /轨道一/);
  assert.match(html, /remotion → h3/);
  assert.match(html, /分镜 1/);
  assert.match(workbenchHTML({}), /暂无轨道\/队列数据/);
});

// ── D3 属性钉:三型渲染 HTML 含点击属性 ──────────────────────────────

test("storyboard-table 渲染:行带 shot-detail+shot-id+idx 退化位", () => {
  const html = storyboardTableUI.render({
    key: "storyboardTable",
    tableRows: [{ index: 1, id: "sb-c1-001", scene: "夜街", title: "巷口",
      lines: "台词", shotSize: "全景", cameraMove: "缓移", duration: 6 }],
  });
  assert.match(html, /data-act="shot-detail"/);
  assert.match(html, /data-shot-id="sb-c1-001"/);
  assert.match(html, /data-idx="1"/);
  // 旧行(无 id):shot-id 空串=对齐兜底路径,不误带旧 id
  const legacy = storyboardTableUI.render({
    key: "storyboardTable",
    tableRows: [{ index: 2, scene: "夜街", title: "客栈", lines: "" }],
  });
  assert.match(legacy, /data-shot-id=""/);
  assert.match(legacy, /data-idx="2"/);
});

test("storyboard-panel 渲染:磁贴带 shot-detail+shot-id+idx", () => {
  const html = storyboardPanelUI.render({
    key: "storyboard",
    tiles: [{ index: 3, id: "sb-c1-003", title: "S03", preview: "p.jpg" }],
  });
  assert.match(html, /data-act="shot-detail"/);
  assert.match(html, /data-shot-id="sb-c1-003"/);
  assert.match(html, /data-idx="3"/);
});

test("assets 渲染:卡带 asset-detail+asset-name", () => {
  const html = assetsUI.render({
    key: "assets",
    assetGroups: { characters: ["独孤剑尘"] },
    assets: [{ name: "青盐鞭", typeLabel: "道具", state: "ready" }],
  });
  assert.match(html, /data-act="asset-detail"/);
  assert.match(html, /data-asset-name="青盐鞭"/);
});

// ── D4/D5 源码契约钉(stage-node.js 不可直 import,走源码串) ─────────

const STAGE_NODE_SRC = readFileSync(
  path.resolve(HERE, "../stage-node.js"), "utf8");

test("D4 pointer-events 门:行/贴/卡点得动规则串在案", () => {
  assert.match(STAGE_NODE_SRC,
    /\.ms-row\[data-act\],\.ms-tile\[data-act\],\.ms-card\[data-act\]\{pointer-events:auto;cursor:pointer/);
});

test("D5 写死文案退役:HINTS_ITEMS 数组退役,9999 渲染器在案", () => {
  assert.doesNotMatch(STAGE_NODE_SRC, /const HINTS_ITEMS/);
  assert.match(STAGE_NODE_SRC, /HINTS_NODE_ID/); // 图内 9999 说明节点单源
  assert.match(STAGE_NODE_SRC, /renderMarkdown/); // md 渲染复用 common.js
});
