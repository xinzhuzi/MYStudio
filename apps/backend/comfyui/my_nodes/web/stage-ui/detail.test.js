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

test("shotHTML: 16 列标签+台词全量+图/视频 URL 属性", () => {
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
      ["绑定参考", "①夜街(场景)、②独孤剑尘(角色)、③青盐鞭(道具)"],
    ],
  };
  const html = shotHTML(shot);
  for (const label of ["镜号", "场次", "画面描述", "视频描述", "时长", "景别",
    "运镜", "动作", "朝向", "空间关系", "情绪", "台词", "旁白", "音效",
    "关联资产", "绑定参考"]) {
    assert.match(html, new RegExp(`<dt>${label}</dt>`), label);
  }
  assert.match(html, /背囊里，归元又是一烫。/);
  assert.match(html, /sb-c1-001/);
  assert.match(html, /src="\/my_daoyan\/chapter_image\?project=p1&amp;rel=a%2Fb\.png"/);
  assert.match(html, /data-act="shot-video"/);
  assert.match(html, /data-url="\/my_daoyan\/chapter_image\?project=p1&amp;rel=c%2Fd\.mp4"/);
});

// ── 1120 绑定三件套·件一:绑定参考列渲染(后端单源,前端零拼) ─────────

test("shotHTML 绑定参考列:值随列数据直渲;缺席=空列退化「—」", () => {
  const bound = shotHTML({
    id: "sb-c1-001",
    columns: [
      ["关联资产", "独孤剑尘、青盐鞭"],
      ["绑定参考", "①夜街(场景)、②独孤剑尘(角色)、③青盐鞭(道具)"],
    ],
  });
  // ①=slot 序号+名+(类型) 整串原样渲染(转义不破坏带圈序号/括号)
  assert.match(bound, /<dt>绑定参考<\/dt>/);
  assert.match(bound, /①夜街\(场景\)、②独孤剑尘\(角色\)、③青盐鞭\(道具\)/);
  // assetBindings 缺席=后端空列(null)→「—」退化,前端不猜序不拼名
  const empty = shotHTML({
    id: "sb-c1-002",
    columns: [["关联资产", null], ["绑定参考", null]],
  });
  assert.match(empty, /<dt>绑定参考<\/dt><dd>—<\/dd>/);
});

// ── 1120 分镜面板退役迁引擎:单镜动作面(桥动作钮 HTML 契约) ───────────

test("shotHTML 单镜动作面:五类桥动作钮+混音下拉,note=镜 id 编码", () => {
  const shot = {
    id: "sb-c1-001", state: "ready", imageReady: true,
    imageUrl: "/x/a.png", videoUrl: "/x/v.mp4",
    audioMix: "mixed",
    columns: [["镜号", 1]],
  };
  const html = shotHTML(shot);
  // 进图工作流(open-shot-image,note=shotId)
  assert.match(html, /data-kind="open-shot-image"/);
  assert.match(html, /data-note="sb-c1-001"/);
  assert.match(html, /进入图工作流/);
  // 1120 单镜重出(generate-shot-image,note=shotId;当前画面入库为历史版本)
  assert.match(html, /data-kind="generate-shot-image"/);
  assert.match(html, /重出本镜/);
  // 截帧回灌两式(仅视频在场时):single 存帧 / uniform 抽帧
  const keyframeBtns = html.match(/data-kind="keyframe-extract"/g) || [];
  assert.equal(keyframeBtns.length, 2);
  assert.match(html, /data-note="sb-c1-001\|single\|0"/);
  assert.match(html, /data-note="sb-c1-001\|uniform\|3"/);
  assert.match(html, /存为关键帧/);
  assert.match(html, /自动抽帧/);
  // 版本对双钮(note=shotId)
  assert.match(html, /data-kind="compare-frames"/);
  assert.match(html, /data-kind="compare-video"/);
  assert.match(html, /对比两帧/);
  assert.match(html, /对比上一版/);
  // 混音下拉三值+当前值选中(note 编码在 change 侧拼 shotId|value)
  assert.match(html, /data-act="audio-mix"/);
  assert.match(html, /data-shot-id="sb-c1-001"/);
  assert.match(html, /value="h3-baked"/);
  assert.match(html, /value="tts-stack"/);
  assert.match(html, /value="mixed" selected/);
  assert.match(html, /用片内声/);
  assert.match(html, /配音主导/);
  assert.match(html, /双层混音/);
  // 统一动作钮通道:桥按钮挂 data-act="bridge-action"
  assert.match(html, /data-act="bridge-action"/);
});

test("shotHTML 单镜动作面降级:无视频=截帧/混音隐藏,进图工作流/对比仍在", () => {
  const shot = {
    id: "sb-c1-002", state: "pending", imageReady: false,
    columns: [["镜号", 2]],
  };
  const html = shotHTML(shot);
  assert.match(html, /data-kind="open-shot-image"/);
  assert.match(html, /data-kind="compare-frames"/);
  assert.match(html, /data-kind="compare-video"/);
  assert.doesNotMatch(html, /data-kind="keyframe-extract"/);
  assert.doesNotMatch(html, /data-act="audio-mix"/);
  // 缺 id(换代兜底):零动作面(桥 note 无从编码)
  assert.doesNotMatch(shotHTML({ columns: [["镜号", 3]] }), /data-act="bridge-action"/);
});

test("detail.js 源码契约:单镜动作面桥提交与 change 委托在案(stage-node postAction 通道不动)", () => {
  const src = readFileSync(path.resolve(HERE, "./detail.js"), "utf8");
  // 桥端点与 sidebar.js 同款(动作直达宿主收件箱)
  assert.match(src, /\/comfy\/bridge\/actions/);
  assert.match(src, /originProjectId: request\.projectId/);
  assert.match(src, /originEpisodeId: request\.chapter/);
  // select 混音走 change 委托(click 不选值)
  assert.match(src, /addEventListener\("change", onRootChange\)/);
  assert.match(src, /submitBridgeAction\("set-audio-mix"/);
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
