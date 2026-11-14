// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
/**
 * 导演台面板·阶段2 全逻辑无头测试(11-13-director-console-remake,PRD R2)。
 * 1113 门禁追认批补 ⑮⑯⑰:素材进出全量(真上传/替换/缩略图)、收起态
 * 摘要行(PRD R1.6-1)、导出→导入全字段闭环。
 * 跑法:node --test apps/backend/comfyui/tests/daoyan_panel.test.mjs
 *
 * 被测对象 = my_nodes/web/daoyan/ 七件 IIFE 组件(serial/timeline/cards/
 * params/prompt/toolbar/logs)——vm 加载真源文件 + 最小 DOM stub(无 jsdom、
 * 无引擎、无 GPU;断言面=动作函数/序列化/渲染 HTML 字符串)。
 * index.js 为引擎 ES module 入口(/scripts/app.js 依赖),不入 vm;
 * 其接线逻辑(去抖写回/onConfigure 恢复/Ctrl+Z)由控制器 API 同面覆盖。
 *
 * 双 runner 适配(同 open-receipt.test.mjs 头注口径):VT 全量默认 glob
 * 拾取 *.test.mjs,node:test 用例不被 vitest 认领→套套红;按 runner 取
 * 注册 API,断言面零改。
 */
const { test } = await import(process.env.VITEST ? "vitest" : "node:test");
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.resolve(HERE, "../my_nodes/web/daoyan");

/** 最小 DOM stub:组件只用 getElementById/createElement/head.appendChild/
 * root.innerHTML/addEventListener/querySelector/closest/classList */
function stubElement() {
  return {
    innerHTML: "",
    style: {},
    listeners: {},
    addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); },
    removeEventListener() {},
    querySelector() { return null; },
    querySelectorAll() { return []; },
    closest() { return null; },
    classList: { add() {}, remove() {}, contains() { return false; } },
    getAttribute() { return null; },
    setAttribute() {},
    appendChild() {},
    remove() {},
    click() {},
    getBoundingClientRect() { return { width: 0, height: 0, left: 0, top: 0 }; },
  };
}

/** vm 装载六件组件 → 沙箱 window.DaoyanXxx(真源文件直跑,零转译) */
function loadPanel() {
  const sandbox = {
    console,
    setTimeout, clearTimeout, setInterval, clearInterval,
    Date, JSON, Math, Number, String, Boolean, Array, Object, isFinite, parseInt, parseFloat,
    addEventListener() {}, removeEventListener() {},
    FileReader: function () { this.readAsText = () => {}; },
    Blob: function () {}, URL: { createObjectURL: () => "", revokeObjectURL: () => {} },
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.document = {
    getElementById: () => null,
    createElement: () => stubElement(),
    head: { appendChild() {} },
    body: { appendChild() {} },
  };
  const ctx = vm.createContext(sandbox);
  for (const f of ["serial.js", "toolbar.js", "params.js", "timeline.js", "cards.js", "prompt.js", "live.js", "logs.js", "picker.js", "video.js"]) {
    const code = readFileSync(path.join(WEB, f), "utf8");
    vm.runInContext(code, ctx, { filename: f });
  }
  return sandbox;
}

/** widget 桩:面板↔节点唯一通道 timeline_data 的 value 存取 */
function makeWidgetStub(initial) {
  return { name: "timeline_data", value: initial == null ? "" : initial, hidden: false };
}

function makeCtrl(sandbox, opts) {
  const w = makeWidgetStub(opts && opts.initial);
  const ctrl = sandbox.DaoyanSerial.createController({
    read: () => w.value,
    write: (json) => { w.value = json; },
    debounceMs: opts && opts.debounceMs != null ? opts.debounceMs : 30,
  });
  return { ctrl, widget: w };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 旧台账样本(1112 批量役 chapter-script.json 同 schema,两镜缩样) */
const LEGACY_SCRIPT = JSON.stringify({
  chapter: "chapter-b001",
  mode: "r2v",
  frames: 124,
  shots: [
    {
      id: "sb-b001-01", seed: 101,
      refs: ["/Users/x/repo/apps/output/chapter001/sb001_scene.jpg"],
      prompt: "2D Chinese ink-wash guofeng animation. Miners wade through fog. 5 seconds.",
    },
    {
      id: "sb-b001-02", seed: 102,
      refs: ["/Users/x/repo/apps/output/chapter001/sb-002.png", "/Users/x/repo/apps/output/canon-jc.png"],
      prompt: "Overseer with whip arcing over kneeling laborer. 5 seconds.",
    },
  ],
});

// ── ① 时间线:增删分段计数 ───────────────────────────────────────────
test("① 时间线增删分段:addSegment×2→2 段,removeSegment→1 段", () => {
  const sb = loadPanel();
  const { ctrl } = makeCtrl(sb);
  assert.equal(ctrl.state.segments.length, 0);
  sb.DaoyanTimeline.actions.addSegment(ctrl);
  sb.DaoyanTimeline.actions.addSegment(ctrl);
  assert.equal(ctrl.state.segments.length, 2, "增两段后应=2");
  sb.DaoyanTimeline.actions.removeSegment(ctrl, 0);
  assert.equal(ctrl.state.segments.length, 1, "删一段后应=1");
  // 选中切换:selectSegment 后 selectedSegment 即当前组
  sb.DaoyanTimeline.actions.selectSegment(ctrl, 0);
  assert.equal(ctrl.selectedSegment().id, "镜头2");
});

// ── ② 拖边界/秒输入→17k+5 网格 ──────────────────────────────────────
test("② 时长贴网格:5s→124f,4s→90f;拖边界边缘钳制", () => {
  const sb = loadPanel();
  const { ctrl } = makeCtrl(sb);
  assert.equal(sb.DaoyanSerial.secondsToFrames(5), 124, "PRD 钉例 5s→124f");
  assert.equal(sb.DaoyanSerial.secondsToFrames(4), 90, "PRD 钉例 4s→90f");
  assert.equal(sb.DaoyanSerial.secondsToFrames(3), 73, "3s→73f(17×4+5)");
  sb.DaoyanTimeline.actions.addSegment(ctrl);
  sb.DaoyanTimeline.actions.setSegmentSeconds(ctrl, 0, 5);
  assert.equal(ctrl.state.segments[0].frames, 124);
  assert.equal(ctrl.state.segments[0].seconds, 5);
  sb.DaoyanTimeline.actions.setSegmentSeconds(ctrl, 0, 4);
  assert.equal(ctrl.state.segments[0].frames, 90);
  // 拖边界数学:右缘 +1.2s → 5.2s → 贴 (130-5)/17=7.35→7 →124f
  const raw = sb.DaoyanTimeline.edgeDragToSeconds(4, "r", 1.2);
  assert.equal(raw, 5.2);
  assert.equal(sb.DaoyanSerial.secondsToFrames(raw), 124);
  // 左缘越界负向钳 ≥0.2s
  assert.equal(sb.DaoyanTimeline.edgeDragToSeconds(0.5, "l", 5), 0.2);
  // 非法输入钳制
  sb.DaoyanTimeline.actions.setSegmentSeconds(ctrl, 0, -3);
  assert.equal(ctrl.state.segments[0].seconds, 0.2);
  assert.ok(ctrl.state.segments[0].frames >= 22, "最小合法档 17×1+5=22f");
});

// ── ③ 序列化闭环:编辑→500ms 去抖→widget 值;roundtrip 等价 ──────────
test("③ 序列化闭环:编辑→去抖→timeline_data JSON 写回;roundtrip 状态等", async () => {
  const sb = loadPanel();
  assert.equal(sb.DaoyanSerial.TIMELINE_SYNC_DEBOUNCE_MS, 500, "去抖间隔=AIMixer 同值 500ms");
  const { ctrl, widget } = makeCtrl(sb, { debounceMs: 40 });
  sb.DaoyanTimeline.actions.addSegment(ctrl);
  sb.DaoyanTimeline.actions.setSegmentSeconds(ctrl, 0, 4);
  assert.equal(widget.value, "", "去抖窗口内不写回");
  await sleep(80);
  assert.ok(widget.value.length > 0, "去抖到期写回 widget");
  const parsed = JSON.parse(widget.value);
  assert.equal(parsed.segments.length, 1);
  assert.equal(parsed.segments[0].frames, 90);
  // roundtrip:序列化→再解析→状态等价(canonical 闭环;跨 vm 域对象
  // 用 JSON 同构比较,规避 deepStrictEqual 的 realm 原型判等)
  const state2 = sb.DaoyanSerial.normalizeState(widget.value);
  assert.deepEqual(JSON.parse(JSON.stringify(state2)), JSON.parse(JSON.stringify(ctrl.state)));
  // 强 flush:未到去抖窗也能立即落盘(入队前钩子同面)
  const { ctrl: c2, widget: w2 } = makeCtrl(sb, { debounceMs: 5000 });
  sb.DaoyanTimeline.actions.addSegment(c2);
  c2.flush();
  assert.ok(w2.value.length > 0, "flush 直写绕过去抖");
});

// ── ④ 续号制:公共 3 图+本组第 1 槽=图片4 ────────────────────────────
test("④ 续号制:公共图区占图片1-3,本组图区从图片4 续号(与 <Picture N> 全局一致)", () => {
  const sb = loadPanel();
  const { ctrl } = makeCtrl(sb);
  sb.DaoyanCards.actions.addCommonImage(ctrl, "canon-jc.png");
  sb.DaoyanCards.actions.addCommonImage(ctrl, "hero-card.png");
  sb.DaoyanCards.actions.addCommonImage(ctrl, "scene-card.png");
  sb.DaoyanCards.actions.addGroup(ctrl);
  assert.equal(sb.DaoyanCards.actions.addGroupImage(ctrl, 0, "sb001_scene.jpg"), true);
  assert.equal(sb.DaoyanCards.pictureLabel(ctrl.state, "common", 0), "图片 1");
  assert.equal(sb.DaoyanCards.pictureLabel(ctrl.state, "common", 2), "图片 3");
  assert.equal(sb.DaoyanCards.pictureLabel(ctrl.state, "own", 0), "图片 4", "公共3图+本组第1槽=图片4");
  assert.equal(sb.DaoyanCards.pictureLabel(ctrl.state, "own", 1), "图片 5", "本组第2槽续号=图片5");
  // 渲染面:卡片 HTML 带续号说明与后续空槽标签(已占槽显示文件名)
  const root = stubElement();
  sb.DaoyanCards.build(root, ctrl);
  assert.ok(root.innerHTML.includes("从 图片4 续号"), "渲染应示续号起点");
  assert.ok(root.innerHTML.includes("sb001_scene.jpg"), "本组图槽文件名入卡");
  assert.ok(root.innerHTML.includes("图片 5</small>"), "本组首个空槽标签=图片 5(续号)");
});

// ── ⑤ 撤销回退(Ctrl+Z 快照栈)──────────────────────────────────────
test("⑤ 撤销:误删组/误改时长可回退;栈空返 false", async () => {
  const sb = loadPanel();
  const { ctrl } = makeCtrl(sb, { debounceMs: 10 });
  sb.DaoyanCards.actions.addGroup(ctrl);
  sb.DaoyanCards.actions.addGroup(ctrl);
  assert.equal(ctrl.state.segments.length, 2);
  sb.DaoyanCards.actions.deleteGroup(ctrl, 0);
  sb.DaoyanCards.actions.deleteGroup(ctrl, 0); // 两步确认后真删
  assert.equal(ctrl.state.segments.length, 1);
  assert.equal(ctrl.undo(), true);
  assert.equal(ctrl.state.segments.length, 2, "撤销恢复被删组");
  sb.DaoyanTimeline.actions.setSegmentSeconds(ctrl, 0, 8);
  assert.equal(ctrl.state.segments[0].frames, 192);
  ctrl.undo();
  assert.equal(ctrl.state.segments[0].frames, 124, "撤销恢复误拖时长");
  while (ctrl.undo()) { /* 清到栈底 */ }
  assert.equal(ctrl.undo(), false, "栈空不可再撤");
  assert.equal(ctrl.canUndo(), false);
});

// ── ⑥ 空状态引导(零组=大按钮引导卡,禁白屏)────────────────────────
test("⑥ 空状态:零组渲染引导卡「添加第一组」;时间线示零分段", () => {
  const sb = loadPanel();
  const { ctrl } = makeCtrl(sb);
  const cardsRoot = stubElement();
  sb.DaoyanCards.build(cardsRoot, ctrl);
  assert.ok(cardsRoot.innerHTML.includes("添加第一组"), "空状态=大按钮引导卡");
  assert.ok(cardsRoot.innerHTML.includes("data-act=\"add-group\""), "引导卡可点=真添加");
  const tlRoot = stubElement();
  sb.DaoyanTimeline.build(tlRoot, ctrl);
  assert.ok(tlRoot.innerHTML.includes("零分段"), "时间线空态提示");
  // 引导卡点击动作=addGroup(事件委托处理器面)
  sb.DaoyanCards.actions.addGroup(ctrl);
  const cardsRoot2 = stubElement();
  sb.DaoyanCards.build(cardsRoot2, ctrl);
  assert.ok(!cardsRoot2.innerHTML.includes("添加第一组"), "有组后引导卡让位");
});

// ── ⑦ 三勾选联动写 timeline_data.stages ─────────────────────────────
test("⑦ 三勾选:勾二采→stages.ercai=true 落 timeline_data;渲染 checked", async () => {
  const sb = loadPanel();
  const { ctrl, widget } = makeCtrl(sb, { debounceMs: 10 });
  assert.equal(JSON.stringify(ctrl.state.stages), JSON.stringify({ yicai: false, ercai: false, sancai: false }));
  sb.DaoyanToolbar.actions.setStage(ctrl, "ercai", true);
  sb.DaoyanToolbar.actions.setStage(ctrl, "sancai", true);
  await sleep(40);
  const parsed = JSON.parse(widget.value);
  assert.equal(JSON.stringify(parsed.stages), JSON.stringify({ yicai: false, ercai: true, sancai: true }));
  // 渲染面:checkbox checked
  const root = stubElement();
  sb.DaoyanToolbar.build(root, ctrl);
  assert.ok(root.innerHTML.includes("data-key='ercai' checked"), "ercai 勾选态渲染");
  assert.ok(root.innerHTML.includes("data-key='sancai' checked"), "sancai 勾选态渲染");
  // 取消勾选再写回
  sb.DaoyanToolbar.actions.setStage(ctrl, "ercai", false);
  await sleep(40);
  assert.equal(JSON.parse(widget.value).stages.ercai, false);
});

// ── ⑧ 旧台账导入(「导入导演包」兼容 chapter-script.json)────────────
test("⑧ 旧台账导入:chapter-script.json 解析→segments 映射(seed/prompt/refs basename)", () => {
  const sb = loadPanel();
  const state = sb.DaoyanSerial.chapterScriptToState(LEGACY_SCRIPT);
  assert.equal(state.chapter, "chapter-b001");
  assert.equal(state.segments.length, 2);
  const s1 = state.segments[0];
  assert.equal(s1.id, "sb-b001-01");
  assert.equal(s1.seed, 101);
  assert.equal(s1.mode, "r2v");
  assert.equal(s1.frames, 124);
  assert.equal(s1.images[0], "sb001_scene.jpg", "refs 取 basename=input/ 文件名引用口径");
  assert.ok(s1.prompt.description.includes("ink-wash"), "prompt 整段→description");
  assert.equal(JSON.stringify(state.segments[1].images), JSON.stringify(["sb-002.png", "canon-jc.png"]));
  // 坏 JSON 兜底
  assert.equal(sb.DaoyanSerial.chapterScriptToState("not-json{"), null);
  // 控制器导入面(「导入导演包」按钮动作)
  const { ctrl } = makeCtrl(sb, { debounceMs: 10 });
  const r = sb.DaoyanToolbar.actions.importPayload(ctrl, LEGACY_SCRIPT);
  assert.equal(JSON.stringify(r), JSON.stringify({ ok: true, count: 2 }));
  assert.equal(ctrl.state.segments.length, 2);
  assert.equal(ctrl.state.segments[0].id, "sb-b001-01");
  // 新 schema 导出包也能回导(交换格式闭环)
  const exported = sb.DaoyanToolbar.actions.exportPayload(ctrl);
  const r2 = sb.DaoyanToolbar.actions.importPayload(makeCtrl(sb, { debounceMs: 10 }).ctrl, exported);
  assert.equal(JSON.stringify(r2), JSON.stringify({ ok: true, count: 2 }));
});

// ── ⑨ 组管理:翻页/复制/两步删除/重掷态 ─────────────────────────────
test("⑨ 组管理:上一组下一组/复制组(副本)/删组两步确认/单镜重掷按钮态", () => {
  const sb = loadPanel();
  const { ctrl } = makeCtrl(sb, { debounceMs: 10 });
  sb.DaoyanCards.actions.addGroup(ctrl);
  sb.DaoyanCards.actions.addGroup(ctrl);
  sb.DaoyanCards.actions.addGroup(ctrl);
  assert.equal(ctrl.view.selected, 2, "新组自动选中");
  assert.equal(sb.DaoyanCards.actions.prevGroup(ctrl), true);
  assert.equal(ctrl.view.selected, 1);
  assert.equal(sb.DaoyanCards.actions.nextGroup(ctrl), true);
  assert.equal(ctrl.view.selected, 2);
  assert.equal(sb.DaoyanCards.actions.nextGroup(ctrl), false, "末组不可再下");
  // 复制组:深拷贝+副本标记+插其后并选中
  ctrl.state.segments[1].prompt.description = "孤本";
  sb.DaoyanCards.actions.duplicateGroup(ctrl, 1);
  assert.equal(ctrl.state.segments.length, 4);
  assert.equal(ctrl.view.selected, 2);
  assert.equal(ctrl.state.segments[2].id, "镜头2 副本");
  assert.equal(ctrl.state.segments[2].prompt.description, "孤本", "复制=深拷贝");
  assert.equal(ctrl.state.segments[3].id, "镜头3", "后续组不受扰");
  // 删组两步确认:第一步只布防不删
  const len = ctrl.state.segments.length;
  assert.equal(sb.DaoyanCards.actions.deleteGroup(ctrl, 2), false);
  assert.equal(ctrl.state.segments.length, len, "第一步未删");
  assert.equal(sb.DaoyanCards.actions.deleteGroup(ctrl, 2), true);
  assert.equal(ctrl.state.segments.length, len - 1, "第二步真删");
  // 单镜重掷:按钮态翻转+渲染亮态
  sb.DaoyanCards.actions.toggleRerun(ctrl, 0);
  assert.equal(ctrl.state.segments[0].rerun, true, "重掷已布防");
  const root = stubElement();
  ctrl.view.selected = 0;
  sb.DaoyanCards.build(root, ctrl);
  assert.ok(root.innerHTML.includes("重跑此镜 ✓"), "布防态渲染 ✓");
  assert.ok(root.innerHTML.includes("重掷已布防"), "meta 示布防");
});

// ── ⑩ 槽守门:公共+本组合计 ≤9 槽/异图 ≤8(1114 用户裁定,App 组装器同口径)──
test("⑩ 槽守门:公共+本组合计≤9槽;异图≤8;重复图不占预算;秒数双单位渲染", () => {
  const sb = loadPanel();
  const { ctrl } = makeCtrl(sb, { debounceMs: 10 });
  for (let i = 0; i < 7; i++) {
    assert.equal(sb.DaoyanCards.actions.addCommonImage(ctrl, "c" + i + ".png"), true);
  }
  assert.equal(sb.DaoyanCards.actions.addCommonImage(ctrl, "c0.png"), false, "重名去重");
  assert.equal(sb.DaoyanCards.actions.addCommonImage(ctrl, "c7.png"), true, "第 8 张公共=异图顶格仍合法");
  assert.equal(sb.DaoyanCards.actions.addCommonImage(ctrl, "c8.png"), false, "第 9 张=破异图 8 拒加(槽 9 未破→纯异图门)");
  sb.DaoyanCards.actions.removeCommonImage(ctrl, 0);
  sb.DaoyanCards.actions.addGroup(ctrl);
  assert.equal(sb.DaoyanCards.actions.addGroupImage(ctrl, 0, "a.png"), true, "7公共+1本组=8异图合法");
  assert.equal(sb.DaoyanCards.actions.addGroupImage(ctrl, 0, "b.png"), false, "第 9 异图拒加(槽 9 未破→纯异图门)");
  assert.equal(sb.DaoyanCards.actions.addGroupImage(ctrl, 0, "c1.png"), true, "跨区重名=重复图不占异图预算,槽 9 顶格");
  assert.equal(sb.DaoyanCards.actions.addGroupImage(ctrl, 0, "d.png"), false, "第 10 槽亦拒");
  // 组级参数渲染:参考图尺寸 match▾ + 秒数→帧双单位
  sb.DaoyanTimeline.actions.setSegmentSeconds(ctrl, 0, 5);
  const root = stubElement();
  sb.DaoyanCards.build(root, ctrl);
  assert.ok(root.innerHTML.includes('data-act="set-match"'), "参考图尺寸 match▾ 下拉在卡");
  assert.ok(root.innerHTML.includes(">match</option>"), "match 档在列");
  assert.ok(root.innerHTML.includes("→ 124f"), "秒数→帧双单位显示");
});

// ── ⑪ 公共参数行(已启用/展开/禁用)+ 高级区偏离黄条 ─────────────────
test("⑪ 公共参数行与高级采样:启停/展开/本组禁用;偏离验证档出黄条", () => {
  const sb = loadPanel();
  const { ctrl } = makeCtrl(sb, { debounceMs: 10 });
  sb.DaoyanCards.actions.addGroup(ctrl);
  assert.equal(ctrl.state.common_params.enabled, true);
  assert.equal(sb.DaoyanCards.actions.toggleCommonEnabled(ctrl), false, "启→停");
  assert.equal(ctrl.state.common_params.enabled, false);
  assert.equal(sb.DaoyanCards.actions.toggleCommonExpanded(ctrl), true, "展开");
  const root = stubElement();
  sb.DaoyanCards.build(root, ctrl);
  assert.ok(root.innerHTML.includes("已停用"), "状态文案=已停用");
  assert.ok(root.innerHTML.includes("公共档:"), "展开示公共档明细");
  // 本组禁用公共参数
  sb.DaoyanCards.actions.setUseCommon(ctrl, 0, false);
  assert.equal(ctrl.state.segments[0].use_common, false);
  const root2 = stubElement();
  sb.DaoyanCards.build(root2, ctrl);
  assert.ok(root2.innerHTML.includes("公共参数已禁用(本组)"));
  // 高级采样:默认=验证档无黄条;改 steps→偏离出黄条;恢复档回绿
  assert.equal(sb.DaoyanParams.advancedDeviated(ctrl.state), false);
  sb.DaoyanParams.actions.setAdvanced(ctrl, "first_steps", 12);
  assert.equal(sb.DaoyanParams.advancedDeviated(ctrl.state), true);
  const pRoot = stubElement();
  sb.DaoyanParams.build(pRoot, ctrl);
  assert.ok(pRoot.innerHTML.includes("已偏离产线验证档"), "偏离黄条渲染");
  sb.DaoyanParams.actions.resetAdvanced(ctrl);
  assert.equal(sb.DaoyanParams.advancedDeviated(ctrl.state), false);
});

// ── ⑫ 提示词四段编辑+插入结构模板 ───────────────────────────────────
test("⑫ 提示词:四段写回选中组;模板只填空段;打字连击快照合并", async () => {
  const sb = loadPanel();
  const { ctrl } = makeCtrl(sb, { debounceMs: 10 });
  sb.DaoyanCards.actions.addGroup(ctrl);
  assert.equal(sb.DaoyanPrompt.actions.setPromptField(ctrl, "summary", "Miners in fog."), true);
  // 打字连击(coalesceKey)不爆撤销栈
  for (const chunk of ["Miners", " wade", " slowly."]) {
    sb.DaoyanPrompt.actions.setPromptField(ctrl, "description", chunk);
  }
  assert.ok(ctrl.undoDepth() <= 3, "连击合并后栈深受控");
  assert.equal(ctrl.state.segments[0].prompt.description, " slowly.", "静默写不打断,末值在册");
  // 模板插入:只填空段
  assert.equal(sb.DaoyanPrompt.actions.insertTemplate(ctrl), true);
  const p = ctrl.state.segments[0].prompt;
  assert.equal(p.summary, "Miners in fog.", "已有段不覆盖");
  assert.ok(p.retention.startsWith("[retention]"), "空段填骨架");
  assert.ok(p.soundscape.startsWith("[soundscape]"));
  assert.ok(p.description.startsWith(" slowly."), "非空段保留");
  // 渲染面:四段 textarea 值进 DOM
  const root = stubElement();
  sb.DaoyanPrompt.build(root, ctrl);
  assert.ok(root.innerHTML.includes('data-field="soundscape"'));
  assert.ok(root.innerHTML.includes("Miners in fog."));
  // 撤销两步:①回退模板插入(空段骨架退场)②回退整句打字连击(一次回退一句)
  ctrl.undo();
  assert.equal(ctrl.state.segments[0].prompt.retention, "", "①模板插入可撤销");
  ctrl.undo();
  assert.equal(ctrl.state.segments[0].prompt.description, "", "②连击整句一次回退");
});

// ── ⑬ 业务条:章节名/取消按钮态/进度占位/旧 schema 通道读回 ───────────
test("⑬ 业务条与 onConfigure 读回:章节名写回;运行态取消钮活;reload 恢复", async () => {
  const sb = loadPanel();
  const { ctrl, widget } = makeCtrl(sb, { debounceMs: 10 });
  sb.DaoyanToolbar.actions.setChapter(ctrl, "chapter-b002");
  await sleep(40);
  assert.equal(JSON.parse(widget.value).chapter, "chapter-b002");
  // 运行态机:选择运行→取消活;取消→回待运行(进度=占位,执行链排阶段3)
  sb.DaoyanCards.actions.addGroup(ctrl);
  sb.DaoyanToolbar.actions.startRun(ctrl);
  let root = stubElement();
  sb.DaoyanToolbar.build(root, ctrl);
  assert.ok(!/data-act="cancel" disabled/.test(root.innerHTML), "运行态取消钮可点");
  assert.ok(root.innerHTML.includes("第 0/1 组"), "进度逐镜占位");
  sb.DaoyanToolbar.actions.cancelRun(ctrl);
  root = stubElement();
  sb.DaoyanToolbar.build(root, ctrl);
  assert.ok(/data-act="cancel" disabled/.test(root.innerHTML), "待运行态取消钮禁用");
  // onConfigure 读回恢复:外部写 widget(工作流加载)→reload→状态恢复
  widget.value = JSON.stringify({
    version: 1, chapter: "chapter-b009",
    stages: { yicai: true, ercai: false, sancai: false },
    segments: [{ id: "sb-x", mode: "i2v", seconds: 4, images: ["a.png"] },
               { id: "sb-y", seconds: 5 }, { id: "sb-z", seconds: 6 }],
  });
  ctrl.reload();
  assert.equal(ctrl.state.segments.length, 3, "reload 恢复 3 组");
  assert.equal(ctrl.state.segments[0].frames, 90, "恢复时贴网格(4s→90f)");
  assert.equal(ctrl.state.segments[0].mode, "i2v");
  assert.equal(ctrl.state.chapter, "chapter-b009");
});

// ── ⑭ 布局推导+帧常量钉值 ───────────────────────────────────────────
test("⑭ 时间线布局:分段顺序累计;17k+5 网格常量钉值", () => {
  const sb = loadPanel();
  const { ctrl } = makeCtrl(sb);
  sb.DaoyanTimeline.actions.addSegment(ctrl, { id: "A", seconds: 5 });
  sb.DaoyanTimeline.actions.addSegment(ctrl, { id: "B", seconds: 4 });
  const lay = sb.DaoyanTimeline.layout(ctrl.state);
  assert.equal(lay.items.length, 2);
  assert.equal(lay.items[0].start, 0);
  assert.equal(lay.items[0].end, 5.17, "124f=5.17s(24fps)");
  assert.equal(lay.items[1].start, 5.17);
  assert.equal(lay.items[1].end, 8.92, "90f=3.75s 顺累计 5.17+3.75(24fps)");
  assert.equal(lay.total, 8.92);
  assert.equal(JSON.stringify(sb.DaoyanSerial.FRAME_GRID), JSON.stringify({ k: 17, bias: 5, fps: 24 }));
});

// ── ⑮ 真上传(input/ 通道)+缩略图+原位替换(1113 门禁追认补)────────
test("⑮ 素材进出全量:真上传入槽/上传守门/原位替换/缩略图渲染/失败路径", async () => {
  const sb = loadPanel();
  const { ctrl } = makeCtrl(sb, { debounceMs: 10 });
  // 上传器桩:记录调用,回「引擎名」(默认实现=POST /upload/image,vm 无
  // fetch → 注入桩即产品契约面:file→{name,subfolder})
  const calls = [];
  sb.DaoyanCards.setUploader(function (file) {
    calls.push(file.name);
    return Promise.resolve({ name: file.name, subfolder: "" });
  });
  // 公共图真上传 → 入槽
  const r1 = await sb.DaoyanCards.actions.uploadToZone(ctrl, "common", 0, { name: "canon-jc.png" });
  assert.equal(r1.ok, true);
  assert.deepEqual(calls, ["canon-jc.png"], "上传器吃原始文件对象");
  assert.equal(ctrl.state.common_images[0], "canon-jc.png");
  // 本组真上传 + 原位替换(槽位/续号不动)
  sb.DaoyanCards.actions.addGroup(ctrl);
  const r2 = await sb.DaoyanCards.actions.uploadToZone(ctrl, "own", 0, { name: "sb001_scene.jpg" });
  assert.equal(r2.ok, true);
  assert.equal(ctrl.state.segments[0].images.length, 1);
  const labelBefore = sb.DaoyanCards.pictureLabel(ctrl.state, "own", 0);
  const r3 = await sb.DaoyanCards.actions.uploadReplaceSlot(ctrl, "own", 0, 0, { name: "sb002_scene.jpg" });
  assert.equal(r3.ok, true);
  assert.equal(JSON.stringify(ctrl.state.segments[0].images), JSON.stringify(["sb002_scene.jpg"]), "原位换图");
  assert.equal(ctrl.state.segments[0].images.length, 1, "替换不加槽");
  assert.equal(sb.DaoyanCards.pictureLabel(ctrl.state, "own", 0), labelBefore, "续号不动");
  // 文件名替换与他槽重名拒;原位同名幂等直过
  assert.equal(sb.DaoyanCards.actions.replaceCommonImage(ctrl, 0, "canon-jc.png"), true, "原位同名幂等");
  sb.DaoyanCards.actions.addCommonImage(ctrl, "hero.png");
  assert.equal(sb.DaoyanCards.actions.replaceCommonImage(ctrl, 0, "hero.png"), false, "换 成他槽已有名拒");
  // 上传路径同吃 ≤9槽/≤8异图守门:异图顶格后上传 ok:false
  for (let i = 0; i < 5; i++) {
    const r = await sb.DaoyanCards.actions.uploadToZone(ctrl, "common", 0, { name: "c" + i + ".png" });
    assert.equal(r.ok, true);
  }
  const r4 = await sb.DaoyanCards.actions.uploadToZone(ctrl, "common", 0, { name: "c9.png" });
  assert.equal(r4.ok, false, "7公共+1本组=8异图顶格,再上传=第9异图拒");
  // 缩略图渲染:/view 真缩略图+死图回退类+⇄ 替换按钮+⬆ 上传按钮
  const root = stubElement();
  sb.DaoyanCards.build(root, ctrl);
  assert.ok(root.innerHTML.includes("/view?filename="), "缩略图 URL=input 通道 /view");
  assert.ok(root.innerHTML.includes("dy-thumb--dead"), "死图回退类在(onerror)");
  assert.ok(root.innerHTML.includes('data-act="swap-own"'), "槽角 ⇄ 替换按钮");
  assert.ok(root.innerHTML.includes('data-act="upload-common"'), "⬆ 上传按钮(公共区)");
  assert.ok(root.innerHTML.includes('data-act="upload-file-own"'), "隐藏 file input(上传通道)");
  // 失败路径:上传器抛错 → ok:false+错误记录,不咬状态
  sb.DaoyanCards.setUploader(function () { return Promise.reject(new Error("no server")); });
  const before = JSON.stringify(ctrl.state);
  const r5 = await sb.DaoyanCards.actions.uploadToZone(ctrl, "common", 0, { name: "x.png" });
  assert.equal(r5.ok, false);
  assert.ok(r5.err.includes("no server"));
  assert.equal(JSON.stringify(ctrl.state), before, "失败零状态污染");
  assert.ok(sb.DaoyanCards.lastUploadError().includes("no server"));
});

// ── ⑯ 节点收起态摘要行(PRD R1.6-1)─────────────────────────────────
test("⑯ 收起态摘要行:「N 组 · Xs · 主mode」;空态/多数派/并列取先见", () => {
  const sb = loadPanel();
  assert.equal(sb.DaoyanSerial.summaryLine(sb.DaoyanSerial.normalizeState(null)), "0 组 · 待添加");
  const { ctrl } = makeCtrl(sb);
  sb.DaoyanTimeline.actions.addSegment(ctrl, { id: "A", seconds: 5, mode: "i2v" });  // 124f=5.17s
  sb.DaoyanTimeline.actions.addSegment(ctrl, { id: "B", seconds: 4, mode: "r2v" });  // 90f=3.75s
  sb.DaoyanTimeline.actions.addSegment(ctrl, { id: "C", seconds: 6, mode: "r2v" });  // 141f=5.88s(6s@24 贴网格)
  // PRD R1.6-1 例形「3 组 · 45s · r2v」:三组/总时长/多数派 mode
  assert.equal(sb.DaoyanSerial.summaryLine(ctrl.state), "3 组 · 14.8s · r2v");
  // 并列(各 1 票)取先见者
  const st2 = sb.DaoyanSerial.normalizeState({ segments: [
    { id: "x", mode: "t2v", seconds: 5 }, { id: "y", mode: "fl2v", seconds: 4 }] });
  assert.equal(sb.DaoyanSerial.summaryLine(st2), "2 组 · 8.92s · t2v");
});

// ── ⑰ 导出→导入全字段闭环(1113 门禁深检修:不再只回填三字段)────────
test("⑰ 导出→导入全字段闭环:stages/color_fix/common_params/advanced/perf 零丢失", async () => {
  const sb = loadPanel();
  const src = makeCtrl(sb, { debounceMs: 10 });
  sb.DaoyanCards.actions.addGroup(src.ctrl);
  sb.DaoyanToolbar.actions.setStage(src.ctrl, "sancai", true);
  sb.DaoyanParams.actions.setAdvanced(src.ctrl, "first_steps", 12);
  sb.DaoyanParams.actions.togglePerf(src.ctrl, "free_h3"); // → false
  sb.DaoyanParams.actions.cycleColorFix(src.ctrl); // none→adain
  sb.DaoyanCards.actions.addCommonImage(src.ctrl, "canon-jc.png");
  sb.DaoyanPrompt.actions.setPromptField(src.ctrl, "summary", "Miners in fog.");
  const json = sb.DaoyanToolbar.actions.exportPayload(src.ctrl);
  // 导出包含全字段(交换格式=canonical 全量)
  const exported = JSON.parse(json);
  assert.equal(exported.stages.sancai, true);
  assert.equal(exported.color_fix, "adain");
  assert.equal(exported.advanced.first_steps, 12);
  assert.equal(exported.perf.free_h3, false);
  // 回导新 ctrl:逐字段保全(旧缺陷=只回填 chapter/segments/common_images)
  const dst = makeCtrl(sb, { debounceMs: 10 });
  const r = sb.DaoyanToolbar.actions.importPayload(dst.ctrl, json);
  assert.equal(JSON.stringify(r), JSON.stringify({ ok: true, count: 1 }));
  assert.equal(dst.ctrl.state.stages.sancai, true, "勾选阶段不丢");
  assert.equal(dst.ctrl.state.color_fix, "adain", "color_fix 不丢");
  assert.equal(dst.ctrl.state.advanced.first_steps, 12, "高级采样偏离档不丢");
  assert.equal(dst.ctrl.state.perf.free_h3, false, "性能开关不丢");
  assert.equal(dst.ctrl.state.common_images[0], "canon-jc.png");
  assert.equal(dst.ctrl.state.segments[0].prompt.summary, "Miners in fog.");
  // 终极断言:整包 canonical 状态同构(导出↔导入零损)
  assert.equal(JSON.stringify(dst.ctrl.state), JSON.stringify(src.ctrl.state));
  // 1115 缺口4/5/7 增量三字段扩展:skip/audios/continuity 导出→导入零丢
  // (钉 importPayload 补 st.continuity 点名行:顶层字段不随 segments 携带)
  sb.DaoyanCards.actions.toggleSkip(src.ctrl, 0);          // → skip=true(不参与运行)
  sb.DaoyanCards.actions.addSegmentAudio(src.ctrl, 0, "a.mp3");
  sb.DaoyanParams.actions.toggleContinuity(src.ctrl);      // → false(段间引导关)
  const json2 = sb.DaoyanToolbar.actions.exportPayload(src.ctrl);
  const dst2 = makeCtrl(sb, { debounceMs: 10 });
  const r2 = sb.DaoyanToolbar.actions.importPayload(dst2.ctrl, json2);
  assert.equal(JSON.stringify(r2), JSON.stringify({ ok: true, count: 1 }));
  assert.equal(dst2.ctrl.state.continuity, false, "continuity 不丢(顶层字段点名回填)");
  assert.equal(dst2.ctrl.state.segments[0].skip, true, "skip 不丢(segments 整组置换携带)");
  assert.equal(JSON.stringify(dst2.ctrl.state.segments[0].audios),
    JSON.stringify(["a.mp3"]), "audios 不丢");
  assert.equal(JSON.stringify(dst2.ctrl.state), JSON.stringify(src.ctrl.state),
    "增量三字段后整包仍同构");
});

// ── ⑱ 产物回看 schema(1114 缺口②:artifacts/chapter_outputs 落盘回填通道)──
test("⑱ 产物 schema:normalize 兜底 null;roundtrip 路径保全;导入零丢", async () => {
  const sb = loadPanel();
  const { ctrl } = makeCtrl(sb, { debounceMs: 10 });
  sb.DaoyanCards.actions.addGroup(ctrl);
  // 默认=三槽 null(未落盘;跨 vm 域对象用 JSON 串比对)
  assert.equal(JSON.stringify(ctrl.state.segments[0].artifacts), '{"p1":null,"p2":null,"p3":null}');
  assert.equal(JSON.stringify(ctrl.state.chapter_outputs), '{"draft":null,"final":null}');
  // 模拟阶段3 执行链回填(apply 直写=面板侧唯一入口面)
  ctrl.apply(function (st) {
    st.segments[0].artifacts.p1 = "video/导演台/chapter-b001/sb-01/p1-draft.mp4";
    st.chapter_outputs.draft = "video/导演台/chapter-b001/章草片.mp4";
  });
  await sleep(30);
  // 序列化 roundtrip:widget JSON → 新控制器读回,路径零丢
  const dst = makeCtrl(sb, { initial: ctrl.state });
  assert.equal(dst.ctrl.state.segments[0].artifacts.p1,
    "video/导演台/chapter-b001/sb-01/p1-draft.mp4", "p1 路径 roundtrip 不丢");
  assert.equal(dst.ctrl.state.chapter_outputs.draft, "video/导演台/chapter-b001/章草片.mp4");
  // 导出→导入交换格式同样保全
  const json = sb.DaoyanToolbar.actions.exportPayload(ctrl);
  const back = makeCtrl(sb, { debounceMs: 10 });
  sb.DaoyanToolbar.actions.importPayload(back.ctrl, json);
  assert.equal(back.ctrl.state.segments[0].artifacts.p1.includes("p1-draft.mp4"), true,
    "导入后产物路径在");
  // 导入路径门禁(1114 深检 F-1 补:删 toolbar importPayload 回填行须红此处)
  assert.equal(back.ctrl.state.chapter_outputs.draft, "video/导演台/chapter-b001/章草片.mp4",
    "chapter_outputs 走导入路径回填(非仅读回路径)");
  // 非串/空串兜底 null(不产生垃圾路径)
  const bad = sb.DaoyanSerial.normalizeState({ segments: [{ artifacts: { p1: "", p2: 42, p3: "ok.mp4" } }] });
  assert.equal(JSON.stringify(bad.segments[0].artifacts), '{"p1":null,"p2":null,"p3":"ok.mp4"}');
});

// ── ⑲ 卡片产物槽(缺口②:每镜 p1/p2/p3 槽位占位+点亮态)──────────────
// 1115 缺口3 ⑲迁移:徽章 <a target=_blank>→<span data-act=play-art
// data-view>,原 <a> 正则在 span 徽章下必 null→[0] 抛 TypeError(已 node
// 复现);span 正则+data-view 承载=URL 正确性断言语义不降级。
test("⑲ 卡片产物槽:未落盘=「候落盘」×3;落盘=绿胶囊 data-view 面板内播放", () => {
  const sb = loadPanel();
  const { ctrl } = makeCtrl(sb);
  sb.DaoyanCards.actions.addGroup(ctrl);
  const root = stubElement();
  sb.DaoyanCards.build(root, ctrl);
  assert.equal((root.innerHTML.match(/候落盘/g) || []).length, 3, "空态三槽占位");
  assert.ok(!root.innerHTML.includes("dy-art--have"), "未落盘无点亮胶囊");
  // 落盘一槽:绿胶囊 span(data-view 承载 /view output URL=面板内播放)
  ctrl.apply(function (st) {
    st.segments[0].artifacts.p2 = "video/导演台/chapter-b001/sb-01/p2-final.mp4";
  });
  sb.DaoyanCards.build(root, ctrl);
  const a = root.innerHTML.match(/<span class="dy-art dy-art--have"[^>]*>/)[0];
  assert.ok(a.includes("/view?filename=p2-final.mp4"), "data-view 指向 /view output");
  assert.ok(a.includes("type=output"), "output 型(非 input 缩略通道)");
  assert.ok(a.includes('data-act="play-art"'), "点开=面板内播放(DaoyanVideo)");
  assert.ok(root.innerHTML.includes("p2-final.mp4"), "文件名入胶囊");
  assert.ok(root.innerHTML.includes("候落盘"), "其余两槽仍候落盘");
  assert.ok(!root.innerHTML.includes('target="_blank"'), "新页通道退场");
  // URL 正确性断言面保留:data-view 值经 DaoyanVideo.open 打开
  const dv = a.match(/data-view="([^"]*)"/)[1].replace(/&amp;/g, "&");
  assert.ok(dv.startsWith("/view?filename=p2-final.mp4"));
  sb.DaoyanVideo.open(dv, "p2");
  assert.equal(sb.DaoyanVideo.state().open, true, "data-view 可开浮层");
  assert.equal(sb.DaoyanVideo.state().url, dv);
  sb.DaoyanVideo.close();
});

// ── ⑳ 产物总览 gallery(缺口②:章级+逐镜一屏点看,面板里看不去翻文件夹)──
test("⑳ 产物总览:toggleGallery 开合;章级/逐镜行俱在;落盘点亮", () => {
  const sb = loadPanel();
  const { ctrl } = makeCtrl(sb);
  sb.DaoyanCards.actions.addGroup(ctrl);
  sb.DaoyanCards.actions.addGroup(ctrl);
  ctrl.apply(function (st) {
    st.segments[0].artifacts.p1 = "video/导演台/c/sb-01/p1-draft.mp4";
    st.chapter_outputs.final = "video/导演台/c/章终片.mp4";
  });
  const root = stubElement();
  sb.DaoyanToolbar.build(root, ctrl);
  assert.ok(!root.innerHTML.includes("daoyan-gallery"), "默认收起");
  assert.equal(sb.DaoyanToolbar.actions.toggleGallery(ctrl), true, "开");
  sb.DaoyanToolbar.build(root, ctrl);
  assert.ok(root.innerHTML.includes("daoyan-gallery"), "开后渲染");
  assert.ok(root.innerHTML.includes("章草片"), "章级行在");
  assert.ok(root.innerHTML.includes("镜 2 · 镜头2"), "逐镜行在");
  assert.equal((root.innerHTML.match(/dy-art--have/g) || []).length, 2, "章终片+镜1 p1 两处点亮");
  assert.ok(root.innerHTML.includes("镜 2") && root.innerHTML.includes("候落盘"), "镜2 全候落盘");
  sb.DaoyanToolbar.actions.toggleGallery(ctrl);
  sb.DaoyanToolbar.build(root, ctrl);
  assert.ok(!root.innerHTML.includes("daoyan-gallery"), "再toggle收起");
});

// ── ㉑ 实时预览事件通道(缺口③:daoyan_preview→DaoyanLive→预览条)────
test("㉑ 实时预览:onSample 滚动样本;宿主直渲;开关门;按钮点亮路", () => {
  const sb = loadPanel();
  sb.DaoyanLive.reset();
  const { ctrl } = makeCtrl(sb);
  sb.DaoyanCards.actions.addGroup(ctrl);
  // 事件入口:坏 payload 拒收,好 payload 入样
  assert.equal(sb.DaoyanLive.onSample(null), false);
  assert.equal(sb.DaoyanLive.onSample({ segment_index: 0, url: "/view?filename=f1.png&type=output" }), true);
  assert.equal(sb.DaoyanLive.onSample({ segment_index: 0, step: 3, total: 8, url: "/view?filename=f2.png&type=output" }), true);
  const last = sb.DaoyanLive.lastSample();
  assert.equal(last.step, 3, "最新样本=后到者");
  // 开关+宿主直渲(自持 DOM 更新,不依赖控制器重渲)
  const liveEl = stubElement();
  const host = { querySelector: (sel) => (sel === ".daoyan-live" ? liveEl : null) };
  sb.DaoyanLive.bindHost(host);
  sb.DaoyanLive.setEnabled(true);
  assert.ok(liveEl.innerHTML.includes("f2.png"), "开启即渲最新帧");
  assert.ok(liveEl.innerHTML.includes("步 3/8"), "步进信息入条");
  sb.DaoyanLive.onSample({ segment_index: 1, step: 4, total: 8, url: "/view?filename=f3.png&type=output" });
  assert.ok(liveEl.innerHTML.includes("f3.png"), "新事件即时刷");
  assert.ok(liveEl.innerHTML.includes("共 3 帧样本"), "滚动计数");
  // 关=不再刷(事件仍入样,渲染停)
  sb.DaoyanLive.setEnabled(false);
  sb.DaoyanLive.onSample({ segment_index: 1, step: 5, total: 8, url: "/view?filename=f4.png&type=output" });
  assert.ok(!liveEl.innerHTML.includes("f4.png"), "关后不刷");
  // 按钮路:toggleLivePreview 开→工具条嵌预览条 html(非 disabled 壳)
  const bar = stubElement();
  assert.equal(sb.DaoyanToolbar.actions.toggleLivePreview(ctrl), true);
  sb.DaoyanToolbar.build(bar, ctrl);
  assert.ok(bar.innerHTML.includes("daoyan-live"), "工具条嵌预览条");
  assert.ok(!bar.innerHTML.includes('data-act="live-preview" disabled'), "按钮已点亮非灰壳");
  assert.ok(bar.innerHTML.includes("实时预览已开启") || bar.innerHTML.includes("帧样本"), "预览条有实内容");
  sb.DaoyanLive.reset();
});

// ── ㉒ 项目/章节两级下拉(1114 阶段3.5;fetch guard+桩填充+选章写回)──
test("㉒ 选择器:无 fetch 禁用占位;fetch 桩→项目/章表填充;选章写 st.chapter", async () => {
  const sb = loadPanel();
  sb.DaoyanToolbar.selectors.reset();
  const { ctrl } = makeCtrl(sb, { debounceMs: 10 });
  // 无 fetch(vm 沙箱默认):两下拉禁用+占位
  let root = stubElement();
  sb.DaoyanToolbar.build(root, ctrl);
  assert.ok(/data-act="pick-project" disabled/.test(root.innerHTML), "项目下拉禁用");
  assert.ok(root.innerHTML.includes("项目不可用"), "项目不可用占位");
  assert.ok(/data-act="pick-chapter" disabled/.test(root.innerHTML), "章节下拉禁用(未选项目)");
  // (后段断言壳项隐没)(/my_daoyan/projects|chapters 同源只读路由)
  // (先 reset:无 fetch 阶段已把「不可用」结果缓存进 promise=同源一次性语义)
  sb.DaoyanToolbar.selectors.reset();
  sb.fetch = function (url) {
    const d = url.indexOf("/my_daoyan/projects") >= 0
      ? { projects: [{ id: "p1", name: "道劫", location: "/x/MA" },
                     { id: "shell", name: "漫影工作室项目", location: "" }],
          activeProjectId: "p1" }
      : { chapters: [{ id: "chapter-001", n: 1, title: "第1章：断剑为谁而鸣" },
                     { id: "chapter-002", n: 2, title: "" }], count: 2 };
    return Promise.resolve({ json: () => Promise.resolve(d) });
  };
  await sb.DaoyanToolbar.selectors.ensureProjects();
  assert.equal(sb.DaoyanToolbar.selectors.currentProject(), "p1", "activeProjectId 默认选中");
  root = stubElement();
  sb.DaoyanToolbar.build(root, ctrl);
  assert.ok(root.innerHTML.includes("道劫"), "项目 option 填充");
  assert.ok(!root.innerHTML.includes("漫影工作室项目"), "无 location 壳项隐没");
  await sb.DaoyanToolbar.selectors.ensureChapters("p1");
  root = stubElement();
  sb.DaoyanToolbar.build(root, ctrl);
  assert.ok(root.innerHTML.includes("第1章：断剑为谁而鸣"), "章 option 纯章名");
  assert.ok(!/chapter-001 ·/.test(root.innerHTML), "章 option 无 chapter-xxx 前缀");
  assert.ok(root.innerHTML.includes("第2章"), "空章名派生「第N章」");
  // 选章:唯一写入口=actions.setChapter 同路(写 st.chapter)
  sb.DaoyanToolbar.actions.pickChapter(ctrl, "chapter-001");
  assert.equal(ctrl.state.chapter, "chapter-001");
  root = stubElement();
  sb.DaoyanToolbar.build(root, ctrl);
  assert.ok(/value="chapter-001" selected/.test(root.innerHTML), "列表内值预选");
  // 手输章节不在列表:占位示明,不覆盖不偷写
  sb.DaoyanToolbar.actions.setChapter(ctrl, "chapter-b001");
  root = stubElement();
  sb.DaoyanToolbar.build(root, ctrl);
  assert.ok(root.innerHTML.includes("(手输章节:chapter-b001)"), "手输值占位不偷写");
  assert.equal(ctrl.state.chapter, "chapter-b001", "手输值未被下拉偷改");
  delete sb.fetch;
  sb.DaoyanToolbar.selectors.reset();
});

// ── ㉓ DaoyanLogs 日志区(1114 阶段3.5:fetch/渲染/刷新/错误降级)────
test("㉓ DaoyanLogs:fetch 载入渲染行;手动刷新;无 fetch/不可达降级", async () => {
  const sb = loadPanel();
  sb.DaoyanLogs.reset();
  const el = stubElement();
  // 无 fetch:降级 error 文案(不炸)
  let st = await sb.DaoyanLogs.open(el, "chapter-b001");
  assert.ok(st.error.includes("无 fetch 环境"));
  assert.ok(el.innerHTML.includes("无 fetch 环境"), "降级文案渲染");
  // fetch 桩:行渲染+路径头+刷新钮
  let n = 0;
  sb.fetch = function () {
    n += 1;
    return Promise.resolve({ json: () => Promise.resolve({
      chapter: "chapter-b001",
      path: "output/video/导演台/chapter-b001/run-log.txt",
      lines: ["09:00:01 run 开始 章节=chapter-b001", "09:00:05 plan 第1镜(sb-01) p1=未命中"],
    }) });
  };
  st = await sb.DaoyanLogs.open(el, "chapter-b001");
  assert.equal(st.error, null);
  assert.ok(el.innerHTML.includes("plan 第1镜(sb-01)"), "日志行渲染");
  assert.ok(el.innerHTML.includes("run-log.txt"), "路径头渲染");
  assert.ok(el.innerHTML.includes('data-act="runlog-refresh"'), "刷新钮在");
  await sb.DaoyanLogs.refresh(el);
  assert.equal(n, 2, "refresh 再拉一次");
  // fetch reject:错误降级(文案渲染,不炸)
  sb.fetch = function () { return Promise.reject(new Error("net down")); };
  st = await sb.DaoyanLogs.refresh(el);
  assert.ok(st.error.includes("日志服务不可达"));
  assert.ok(el.innerHTML.includes("日志服务不可达"), "不可达降级渲染");
  // 轮询 API 面:启停幂等(间隔 5s,不真等)
  assert.equal(typeof sb.DaoyanLogs.startPolling, "function");
  assert.equal(sb.DaoyanLogs.stopPolling(), true);
  assert.equal(sb.DaoyanLogs.polling(), false);
  delete sb.fetch;
  sb.DaoyanLogs.reset();
});

// ── ㉔ 同形 preview payload 喂 onSample(与 pytest 侧键集双端钉死)───
test("㉔ 同形 preview payload:onSample「第 2 镜」正确显示(segment_index 生效)", () => {
  const sb = loadPanel();
  sb.DaoyanLive.reset();
  // 与 director_executor.emit_preview 同形 payload(键集由
  // test_director_executor.py::test_preview_payload_contract 钉死)
  const payload = { node_id: 7, segment_id: "sb-02", segment_index: 1,
                    step: null, total: null,
                    url: "/view?filename=f9.png&subfolder=x&type=output" };
  assert.equal(sb.DaoyanLive.onSample(payload), true);
  const last = sb.DaoyanLive.lastSample();
  assert.equal(last.segment_index, 1, "segment_index 透传");
  const liveEl = stubElement();
  const host = { querySelector: (sel) => (sel === ".daoyan-live" ? liveEl : null) };
  sb.DaoyanLive.bindHost(host);
  sb.DaoyanLive.setEnabled(true);
  assert.ok(liveEl.innerHTML.includes("第 2 镜"), "segment_index=1→「第 2 镜」");
  assert.ok(liveEl.innerHTML.includes("步 ?/?"), "step/total null→? 容错显示");
  sb.DaoyanLive.reset();
});

// ── ㉕ 进度文本显示当前阶段消息+运行日志开关(1114 阶段3.5)──────────
test("㉕ 进度文本:view.message(当前阶段消息)优先;运行日志钮开关日志槽", () => {
  const sb = loadPanel();
  sb.DaoyanToolbar.selectors.reset();
  const { ctrl } = makeCtrl(sb, { debounceMs: 10 });
  sb.DaoyanCards.actions.addGroup(ctrl);
  sb.DaoyanToolbar.actions.startRun(ctrl);
  ctrl.view.message = "第 1/1 镜 · 一采 运行中 · 进度 0/1";
  let root = stubElement();
  sb.DaoyanToolbar.build(root, ctrl);
  assert.ok(root.innerHTML.includes("第 1/1 镜 · 一采 运行中"), "消息优先于占位");
  assert.ok(!root.innerHTML.includes("执行链排阶段3"), "旧占位退场");
  // 无消息:回退运行中文案(仍非旧占位)
  ctrl.view.message = null;
  sb.DaoyanToolbar.build(root, ctrl);
  assert.ok(root.innerHTML.includes("运行中"), "无消息回退文案");
  // 运行日志按钮:开→日志槽渲染+按钮点亮;关→槽退场
  assert.equal(sb.DaoyanToolbar.actions.toggleRunLog(ctrl), true);
  sb.DaoyanToolbar.build(root, ctrl);
  assert.ok(root.innerHTML.includes('data-log="daoyan"'), "日志槽在");
  assert.ok(!root.innerHTML.includes('data-act="runlog" disabled'), "日志钮点亮");
  assert.equal(sb.DaoyanToolbar.actions.toggleRunLog(ctrl), false);
  sb.DaoyanToolbar.build(root, ctrl);
  assert.ok(!root.innerHTML.includes('data-log="daoyan"'), "再 toggle 收起");
});

// require() 幂等防 tree-shake(双 runner 下保持 CJS 依赖引用)
assert.ok(typeof require === "function");


// ── ㉖ 章节驾驶舱(1114:选章自动带出+分镜表入时间线)───────────────────
test("㉖ 驾驶舱:选章自动带出三件;分镜表→时间线整组替换可撤销", async () => {
  const sb = loadPanel();
  sb.DaoyanToolbar.selectors.reset();
  const { ctrl } = makeCtrl(sb, { debounceMs: 10 });
  // fetch 桩:项目册/章表/章数据/导入 POST 全覆盖
  sb.fetch = function (url, opts) {
    if (url.indexOf("/my_daoyan/projects") >= 0) {
      return Promise.resolve({ json: () => Promise.resolve(
        { projects: [{ id: "p1", name: "道劫" }], activeProjectId: "p1" }) });
    }
    if (url.indexOf("/my_daoyan/chapters") >= 0) {
      return Promise.resolve({ json: () => Promise.resolve(
        { chapters: [{ id: "chapter-001", title: "第1章" }], count: 1 }) });
    }
    if (url.indexOf("/my_daoyan/chapter_data") >= 0) {
      return Promise.resolve({ json: () => Promise.resolve({
        chapter: "chapter-001", title: "第1章：断剑为谁而鸣",
        script: { text: "1-1 码头 ·约50秒\n镜头1：雾中渡河", lines: 2 },
        directorPlan: { text: "《导演创作规划》", updatedAt: "t2" },
        storyboards: { count: 2, items: [
          { index: 1, duration: 5, videoDesc: "渡河", line: "走", image: "workflow-images/c1/sb1.png" },
          { index: 2, duration: 4, videoDesc: "回望", line: "", image: "" }] } }) });
    }
    if (url.indexOf("/my_daoyan/import_storyboard") >= 0 && opts && opts.method === "POST") {
      return Promise.resolve({ json: () => Promise.resolve({
        ok: true, count: 2, copied: ["daoyan-sb-chapter-001-001.png"],
        segments: [
          { id: "sb-001-1", mode: "r2v", seconds: 5, seed: null,
            prompt: { description: "渡河" }, images: ["daoyan-sb-chapter-001-001.png"] },
          { id: "sb-001-2", mode: "r2v", seconds: 4, seed: null,
            prompt: { description: "回望" }, images: [] }] }) });
    }
    return Promise.reject(new Error("unexpected " + url));
  };
  sb.DaoyanToolbar.selectors.reset();
  let root = stubElement();
  sb.DaoyanToolbar.build(root, ctrl);
  await sleep(30);
  sb.DaoyanToolbar.build(root, ctrl);  // 项目册到后再渲
  // 选项目→选章
  sb.DaoyanToolbar.actions.pickProject(ctrl, "p1");
  await sleep(20);
  sb.DaoyanToolbar.actions.pickChapter(ctrl, "chapter-001");
  await sleep(30);
  root = stubElement();
  sb.DaoyanToolbar.build(root, ctrl);
  await sleep(20);
  sb.DaoyanToolbar.build(root, ctrl);
  const html = root.innerHTML;
  assert.ok(html.includes("章节驾驶舱"), "驾驶舱区渲染");
  assert.ok(html.includes("第1章：断剑为谁而鸣"), "章名带出");
  assert.ok(html.includes("雾中渡河"), "剧本内容带出");
  assert.ok(html.includes("导演创作规划"), "导演计划带出");
  assert.ok(html.includes("2 镜") && html.includes("分镜表 → 时间线"), "分镜表行+导入钮");
  assert.ok(html.includes("/my_daoyan/chapter_image?"), "分镜缩略图走章图路由");
  // 导入:segments 整组替换+可撤销
  assert.equal(sb.DaoyanToolbar.actions.importStoryboard(ctrl), true);
  await sleep(40);
  assert.equal(ctrl.state.segments.length, 2, "两镜入时间线");
  assert.equal(ctrl.state.segments[0].id, "sb-001-1");
  assert.equal(ctrl.state.segments[0].prompt.description, "渡河");
  assert.equal(JSON.stringify(ctrl.state.segments[0].images), '["daoyan-sb-chapter-001-001.png"]');
  assert.equal(ctrl.state.segments[0].frames, 124, "秒数贴网格(5s→124f@24)");
  ctrl.undo();
  assert.equal(ctrl.state.segments.length, 0, "导入可撤销");
});


// ── ㉗ 真发车/真中断(1114 审计修:半壳按钮补实)───────────────────────
test("㉗ 选择运行=enqueue 真发车;取消=interrupt 真中断(无 Runner=态机降级)", async () => {
  const sb = loadPanel();
  const { ctrl } = makeCtrl(sb, { debounceMs: 10 });
  const calls = [];
  sb.DaoyanRunner = {
    enqueue: () => calls.push("enqueue"),
    interrupt: () => calls.push("interrupt"),
  };
  sb.DaoyanToolbar.actions.startRun(ctrl);
  assert.deepEqual(calls, ["enqueue"]);
  sb.DaoyanToolbar.actions.cancelRun(ctrl);
  assert.deepEqual(calls, ["enqueue", "interrupt"]);
  assert.equal(ctrl.view.running, false, "取消后运行态清");
  // 无 Runner(预览/测试态)=不炸,纯态机
  sb.DaoyanRunner = undefined;
  assert.equal(sb.DaoyanToolbar.actions.startRun(ctrl), true);
  assert.equal(ctrl.view.running, true);
  assert.equal(sb.DaoyanToolbar.actions.cancelRun(ctrl), true);
  assert.equal(ctrl.view.running, false);
  // 重复章节文本框已砍(一功能一入口)
  const root = stubElement();
  sb.DaoyanToolbar.build(root, ctrl);
  assert.ok(!root.innerHTML.includes('data-act="chapter"'), "重复章节输入框已移除");
});


// ── ㉘ 输出条真值+假件清场(1115 grill)──────────────────────────────
test("㉘ 输出条=三采阶梯真值只读;占位假件(声音/导出方式/段间引导三件)清场;perf 假开关删除", () => {
  const sb = loadPanel();
  const { ctrl } = makeCtrl(sb);
  const root = stubElement();
  sb.DaoyanToolbar.build(root, ctrl);
  const html = root.innerHTML;
  assert.ok(html.includes("960×544") && html.includes("1440×832")
    && html.includes("2880×1664"), "三采阶梯真值(与执行链 DIRECTOR_RECIPE 同源)");
  assert.ok(html.includes('帧率 <b>24</b>'), "帧率24真值保留");
  assert.ok(!html.includes("占位"), "无「占位」过时话");
  assert.ok(!html.includes("使用原声") && !html.includes("全部导出"), "恒真非参数件已删");
  assert.ok(!html.includes("段间引导") && !html.includes("上下文帧数")
    && !html.includes("引导方式"), "段间引导三件(一镜到底域概念)已清");
  assert.ok(html.includes("实时预览"), "实时预览(真通道)保留");
  // perf 键集:恰 free_h3/vram_clear(1115 grill:resume/gallery 假开关删)
  const perfKeys = Object.keys(ctrl.state.perf).sort();
  assert.equal(JSON.stringify(perfKeys), '["free_h3","vram_clear"]');
  const proot = stubElement();
  sb.DaoyanParams.build(proot, ctrl);
  assert.ok(!proot.innerHTML.includes("断点续跑") && !proot.innerHTML.includes("产物回看"),
    "两假开关胶囊已删");
});


// ── ㉙ 提示词 token chips 渲染(1115 缺口1:已填槽 <Picture N>/<Audio J>)──
test("㉙ chips 渲染:公共2图+本组1图→恰 <Picture 1/2/3> 三钮;零图零音频整行不渲;audios→<Audio J>", () => {
  const sb = loadPanel();
  const { ctrl } = makeCtrl(sb, { debounceMs: 10 });
  sb.DaoyanCards.actions.addGroup(ctrl);
  // 零图零音频=chips 行整行不渲
  let root = stubElement();
  sb.DaoyanPrompt.build(root, ctrl);
  assert.ok(!root.innerHTML.includes("dy-chips"), "零参考图零音频=chips 行不渲");
  assert.ok(!root.innerHTML.includes('data-act="chip-picture"'));
  // 公共2图+本组1图 → pictureLabel 连续编号恰三钮(空槽不占位)
  sb.DaoyanCards.actions.addCommonImage(ctrl, "c1.png");
  sb.DaoyanCards.actions.addCommonImage(ctrl, "c2.png");
  sb.DaoyanCards.actions.addGroupImage(ctrl, 0, "o1.png");
  root = stubElement();
  sb.DaoyanPrompt.build(root, ctrl);
  assert.equal((root.innerHTML.match(/data-act="chip-picture"/g) || []).length, 3,
    "恰三枚图 chips");
  assert.ok(root.innerHTML.includes("&lt;Picture 1&gt;"), "公共1→<Picture 1>");
  assert.ok(root.innerHTML.includes("&lt;Picture 2&gt;"), "公共2→<Picture 2>");
  assert.ok(root.innerHTML.includes("&lt;Picture 3&gt;"), "本组1续号→<Picture 3>");
  assert.ok(!root.innerHTML.includes("&lt;Picture 4&gt;"), "空槽不占位");
  // 音频 chips:<Audio J>(J=idx+1,1-based)
  sb.DaoyanCards.actions.addSegmentAudio(ctrl, 0, "a.mp3");
  sb.DaoyanCards.actions.addSegmentAudio(ctrl, 0, "b.mp3");
  root = stubElement();
  sb.DaoyanPrompt.build(root, ctrl);
  assert.equal((root.innerHTML.match(/data-act="chip-audio"/g) || []).length, 2,
    "恰两枚音频 chips");
  assert.ok(root.innerHTML.includes("&lt;Audio 1&gt;"));
  assert.ok(root.innerHTML.includes("&lt;Audio 2&gt;"));
  assert.equal((root.innerHTML.match(/data-act="chip-picture"/g) || []).length, 3,
    "图 chips 不受音频影响");
});

// ── ㉚ 插入数学+静默写(1115 缺口1)──────────────────────────────────
test("㉚ 插入数学:insertAtCursor('abc',2,'<Picture 2>')→'ab<Picture 2>c' 新光标=13;insertToken 静默+一次回退整枚 token", () => {
  const sb = loadPanel();
  const r = sb.DaoyanPrompt.insertAtCursor("abc", 2, "<Picture 2>");
  assert.equal(r.text, "ab<Picture 2>c", "插入不改邻近字符");
  assert.equal(r.cursor, 13, "新光标=pos+token.length(2+11)");
  // 越界钳制:pos 负→0,超长→末尾
  assert.equal(sb.DaoyanPrompt.insertAtCursor("ab", 99, "X").cursor, 3);
  assert.equal(sb.DaoyanPrompt.insertAtCursor("ab", -5, "X").cursor, 1);
  const { ctrl } = makeCtrl(sb, { debounceMs: 10 });
  sb.DaoyanCards.actions.addGroup(ctrl);
  sb.DaoyanPrompt.actions.setPromptField(ctrl, "description", "abc");
  let notified = 0;
  ctrl.subscribe(() => { notified += 1; });
  const cur = sb.DaoyanPrompt.actions.insertToken(ctrl, "description", "<Picture 2>", 2);
  assert.equal(cur, 13, "返回新光标");
  assert.equal(ctrl.state.segments[0].prompt.description, "ab<Picture 2>c");
  assert.equal(notified, 0, "applySilent 静默写=不通知重渲(打字同款不丢焦点)");
  // Ctrl+Z 一次回退整枚 token(coalesce key 与打字/模板分离)
  assert.equal(ctrl.undo(), true);
  assert.equal(ctrl.state.segments[0].prompt.description, "abc", "一次回退整枚 token");
});

// ── ㉛ chips DOM 接线面(1115 缺口1:纯 textarea,禁 contenteditable)──
test("㉛ chips DOM 接线:chip-picture/chip-audio 与目标 textarea data-field 俱在;无 contenteditable", () => {
  const sb = loadPanel();
  const { ctrl } = makeCtrl(sb, { debounceMs: 10 });
  sb.DaoyanCards.actions.addGroup(ctrl);
  sb.DaoyanCards.actions.addCommonImage(ctrl, "c1.png");
  sb.DaoyanCards.actions.addSegmentAudio(ctrl, 0, "a.mp3");
  const root = stubElement();
  sb.DaoyanPrompt.build(root, ctrl);
  assert.ok(root.innerHTML.includes('data-act="chip-picture"'), "图 chip 按钮在");
  assert.ok(root.innerHTML.includes('data-act="chip-audio"'), "音频 chip 按钮在");
  assert.ok(root.innerHTML.includes('data-token="&lt;Picture 1&gt;"'), "data-token 承载原文");
  assert.ok(root.innerHTML.includes('data-field="description"'), "目标 textarea 在(focusin 记段)");
  assert.ok(root.innerHTML.includes('data-field="soundscape"'));
  assert.ok(!root.innerHTML.includes("contenteditable"), "纯 textarea 增强,禁 contenteditable");
});

// ── ㉜ 库内选图器:无 fetch 降级(1115 缺口2)─────────────────────────
test("㉜ DaoyanPicker 无 fetch:open() 降级 error 面不炸(state().error 非空)", async () => {
  const sb = loadPanel();
  const { ctrl } = makeCtrl(sb, { debounceMs: 10 });
  sb.DaoyanCards.actions.addGroup(ctrl);
  const st = await sb.DaoyanPicker.open({ zone: "own", segIdx: 0, slot: null, ctrl });
  assert.ok(st.error && st.error.includes("无 fetch"), "无 fetch=降级 error(error 非空)");
  assert.equal(sb.DaoyanPicker.state().open, true, "浮层仍开(示错误,不炸)");
  assert.ok(sb.DaoyanPicker.overlayHtml().includes("无 fetch"), "错误文案入面");
  sb.DaoyanPicker.close();
  assert.equal(sb.DaoyanPicker.state().open, false, "close 复位");
  assert.equal(sb.DaoyanPicker.close(), true, "close 幂等");
});

// ── ㉝ 库内选图器:fetch 桩点选回调(1115 缺口2)───────────────────────
test("㉝ DaoyanPicker fetch 桩:open 渲 input/ 缩略图;点选→addGroupImage/replaceGroupImage;拒时留痕不自闭;fileRow「图库」钮", async () => {
  const sb = loadPanel();
  const { ctrl } = makeCtrl(sb, { debounceMs: 10 });
  sb.DaoyanCards.actions.addGroup(ctrl);
  const calls = [];
  sb.fetch = function (url) {
    calls.push(url);
    return Promise.resolve({ json: () => Promise.resolve({
      files: [
        { name: "a.png", mtime: 2, size: 10 },
        { name: "3d/b.png", mtime: 1, size: 20 },   // 子夹相对 posix 名
      ],
      count: 2 }) });
  };
  await sb.DaoyanPicker.open({ zone: "own", segIdx: 0, slot: null, ctrl });
  assert.equal(calls.length, 1);
  assert.ok(calls[0].includes("/my_daoyan/input_media?limit=200"), "GET 图库路由");
  const html = sb.DaoyanPicker.overlayHtml();
  assert.ok(html.includes("a.png") && html.includes("3d/b.png"), "files 渲(mtime 倒序=服务侧序)");
  assert.ok(html.indexOf("a.png") < html.indexOf("3d/b.png"), "渲染序=返回序");
  assert.ok(html.includes("type=input"), "缩略图走 thumbUrl input 通道");
  assert.ok(html.includes("⬆ 上传新图"), "上传钮内嵌");
  // 新增模式点选→addGroupImage 入槽(9槽/8异图守门在 cards 侧生效)
  assert.equal(sb.DaoyanPicker.pick("a.png"), true);
  assert.equal(JSON.stringify(ctrl.state.segments[0].images), JSON.stringify(["a.png"]),
    "点选回调→addGroupImage 入槽");
  assert.equal(sb.DaoyanPicker.state().open, false, "入槽成功自闭");
  // 重名拒:notice 留痕+面不关
  await sb.DaoyanPicker.open({ zone: "own", segIdx: 0, slot: null, ctrl });
  assert.equal(sb.DaoyanPicker.pick("a.png"), false, "重名拒(addGroupImage 守门)");
  assert.ok(sb.DaoyanPicker.state().notice.includes("入槽被拒"), "拒因留痕");
  assert.equal(sb.DaoyanPicker.state().open, true, "被拒不自闭");
  sb.DaoyanPicker.close();
  // 替换模式:slot=0→replaceGroupImage 原位换名
  await sb.DaoyanPicker.open({ zone: "own", segIdx: 0, slot: 0, ctrl });
  assert.equal(sb.DaoyanPicker.state().slot, 0, "replace 模式(slot=0)");
  assert.equal(sb.DaoyanPicker.pick("3d/b.png"), true);
  assert.equal(JSON.stringify(ctrl.state.segments[0].images), JSON.stringify(["3d/b.png"]),
    "replace 模式原位换名(槽位/续号不动)");
  // cards fileRow「🖼 图库」钮(公共/本组两入口)
  const root = stubElement();
  sb.DaoyanCards.build(root, ctrl);
  assert.ok(root.innerHTML.includes('data-act="pick-own"'), "本组图库钮");
  assert.ok(root.innerHTML.includes('data-act="pick-common"'), "公共图库钮");
  assert.ok(root.innerHTML.includes("🖼 图库"));
  delete sb.fetch;
});

// ── ㉞ 面板内视频播放:DaoyanVideo 基础面(1115 缺口3)─────────────────
test("㉞ DaoyanVideo:open/close/state/overlayHtml;src 恒 esc(内联样式浮层)", () => {
  const sb = loadPanel();
  sb.DaoyanVideo.close();
  assert.equal(sb.DaoyanVideo.state().open, false, "初始关");
  assert.equal(sb.DaoyanVideo.open("/view?filename=x.mp4&type=output", "x.mp4"), true);
  const st = sb.DaoyanVideo.state();
  assert.equal(st.open, true);
  assert.equal(st.url, "/view?filename=x.mp4&type=output");
  assert.equal(st.title, "x.mp4");
  const html = sb.DaoyanVideo.overlayHtml();
  assert.ok(html.includes("<video controls"), "video[controls]");
  assert.ok(html.includes("autoplay"));
  assert.ok(html.includes('src="/view?filename=x.mp4&amp;type=output"'), "/view 直链(esc)");
  assert.ok(html.includes('data-act="video-close"'), "遮罩点击=关");
  sb.DaoyanVideo.close();
  assert.equal(sb.DaoyanVideo.state().open, false, "close 复位");
  assert.equal(sb.DaoyanVideo.state().url, "", "url 清空");
  // esc(src):引号/尖括号不裸进属性
  const bad = sb.DaoyanVideo.overlayHtml('a" onerror="x', "t");
  assert.ok(!bad.includes('src="a" onerror'), "引号已转义");
  assert.ok(bad.includes("&quot;"), "esc 落地");
});

// ── ㉟ gallery 产物=面板内播放(1115 缺口3:两消费面新页通道退场)──────
test("㉟ gallery play-art:galleryOpen 后 data-act=play-art;root 零 target=\"_blank\"", () => {
  const sb = loadPanel();
  const { ctrl } = makeCtrl(sb, { debounceMs: 10 });
  sb.DaoyanCards.actions.addGroup(ctrl);
  ctrl.apply(function (st) {
    st.segments[0].artifacts.p2 = "video/导演台/c/sb-01/p2-final.mp4";
    st.chapter_outputs.final = "video/导演台/c/章终片.mp4";
  });
  sb.DaoyanToolbar.actions.toggleGallery(ctrl);
  const root = stubElement();
  sb.DaoyanToolbar.build(root, ctrl);
  assert.ok(root.innerHTML.includes('data-act="play-art"'), "gallery 产物=面板内播放");
  assert.ok(root.innerHTML.includes("data-view="), "data-view 承载 /view URL");
  assert.ok(!root.innerHTML.includes('target="_blank"'), "toolbar 新页通道全数退场");
  // ⑳ 存活面:dy-art--have 类名保留(计数/includes 式断言不降级)
  assert.ok((root.innerHTML.match(/dy-art--have/g) || []).length >= 2, "点亮胶囊类名保留");
});

// ── ㊱ 逐段参与运行 skip:动作+卡片/时间线/gallery 渲染(1115 缺口4)──
test("㊱ skip:toggleSkip 写 seg.skip;卡片 data-act=toggle-skip checked+.dy--skip;时间线块/gallery 同步", () => {
  const sb = loadPanel();
  const { ctrl } = makeCtrl(sb, { debounceMs: 10 });
  sb.DaoyanCards.actions.addGroup(ctrl);
  assert.equal(ctrl.state.segments[0].skip, false, "默认参与");
  let root = stubElement();
  sb.DaoyanCards.build(root, ctrl);
  assert.ok(/data-act="toggle-skip" checked/.test(root.innerHTML), "默认勾=参与运行");
  assert.ok(!root.innerHTML.includes("dy--skip"), "参与态无降透明类");
  assert.equal(sb.DaoyanCards.actions.toggleSkip(ctrl, 0), true, "翻转为 skip");
  assert.equal(ctrl.state.segments[0].skip, true, "skip 写 state");
  root = stubElement();
  sb.DaoyanCards.build(root, ctrl);
  assert.ok(root.innerHTML.includes('class="dy-card dy--skip"'), "卡片 .dy--skip 降透明类");
  assert.ok(!/data-act="toggle-skip" checked/.test(root.innerHTML), "勾退场");
  assert.ok(root.innerHTML.includes("已跳过"), "meta 示跳过");
  // 时间线块同步降透明
  const tl = stubElement();
  sb.DaoyanTimeline.build(tl, ctrl);
  assert.ok(tl.innerHTML.includes("dy--skip"), "时间线块 .dy--skip");
  // gallery 行「跳过」小徽
  sb.DaoyanToolbar.actions.toggleGallery(ctrl);
  const tbar = stubElement();
  sb.DaoyanToolbar.build(tbar, ctrl);
  assert.ok(tbar.innerHTML.includes("跳过"), "gallery 跳过小徽");
});

// ── ㊲ skip/audios 旧 payload 兜底+roundtrip 保全(1115 缺口4/5)──────
test("㊲ 旧 payload 兜底:无 skip 键→false;无 audios→[];roundtrip 全保全;continuity 默认 true", async () => {
  const sb = loadPanel();
  const st = sb.DaoyanSerial.normalizeState({ segments: [{ id: "x" }] });
  assert.equal(st.segments[0].skip, false, "旧 payload 无 skip 键→false 兜底");
  assert.equal(JSON.stringify(st.segments[0].audios), "[]", "无 audios→[]");
  const initialJson = JSON.stringify({
    segments: [{ id: "x", skip: true, audios: ["a.mp3"] }],
    continuity: false,
  });
  const { ctrl, widget } = makeCtrl(sb, { debounceMs: 10, initial: initialJson });
  assert.equal(ctrl.state.segments[0].skip, true, "读回恢复(skip)");
  assert.equal(ctrl.state.continuity, false, "读回恢复(continuity)");
  ctrl.apply(function () {}); // 触发去抖写回(roundtrip 面)
  await sleep(40);
  const parsed = JSON.parse(widget.value);
  assert.equal(parsed.segments[0].skip, true, "skip roundtrip 保全");
  assert.equal(JSON.stringify(parsed.segments[0].audios), JSON.stringify(["a.mp3"]),
    "audios roundtrip 保全");
  assert.equal(parsed.continuity, false, "continuity roundtrip 保全");
  assert.equal(sb.DaoyanSerial.normalizeState({}).continuity, true, "无键默认开");
});

// ── ㊳ 参考音频槽:≤3/重名拒/移除/上传通道(1115 缺口5)─────────────────
test("㊳ audios 槽:addSegmentAudio 三连成+第4拒+重名拒+remove;上传走注入音频上传器;🎧槽行渲染", async () => {
  const sb = loadPanel();
  const { ctrl } = makeCtrl(sb, { debounceMs: 10 });
  sb.DaoyanCards.actions.addGroup(ctrl);
  assert.equal(sb.DaoyanCards.actions.addSegmentAudio(ctrl, 0, "a.mp3"), true);
  assert.equal(sb.DaoyanCards.actions.addSegmentAudio(ctrl, 0, "b.mp3"), true);
  assert.equal(sb.DaoyanCards.actions.addSegmentAudio(ctrl, 0, "c.mp3"), true);
  assert.equal(sb.DaoyanCards.actions.addSegmentAudio(ctrl, 0, "d.mp3"), false, "第 4 拒(帽 3)");
  assert.equal(sb.DaoyanCards.actions.addSegmentAudio(ctrl, 0, "a.mp3"), false, "重名拒");
  assert.equal(JSON.stringify(ctrl.state.segments[0].audios),
    JSON.stringify(["a.mp3", "b.mp3", "c.mp3"]), "保序入槽");
  assert.equal(sb.DaoyanCards.actions.removeSegmentAudio(ctrl, 0, 1), true);
  assert.equal(JSON.stringify(ctrl.state.segments[0].audios),
    JSON.stringify(["a.mp3", "c.mp3"]), "按槽移除");
  // 上传通道:注入音频上传器(引擎真传=POST /my_daoyan/upload_audio
  // X-Filename+原始 body;测试桩面同构 image setUploader 先例)
  const calls = [];
  sb.DaoyanCards.setAudioUploader(function (file) {
    calls.push(file.name);
    return Promise.resolve({ name: file.name, subfolder: "" });
  });
  const up = await sb.DaoyanCards.actions.uploadAudioToZone(ctrl, 0, { name: "e.wav" });
  assert.deepEqual(calls, ["e.wav"], "音频上传器吃原始文件对象");
  assert.equal(up.ok, true);
  assert.equal(JSON.stringify(ctrl.state.segments[0].audios),
    JSON.stringify(["a.mp3", "c.mp3", "e.wav"]), "上传后入槽");
  const up2 = await sb.DaoyanCards.actions.uploadAudioToZone(ctrl, 0, { name: "f.wav" });
  assert.equal(up2.ok, false, "帽 3 后上传拒");
  assert.ok(sb.DaoyanCards.lastAudioError().includes("入槽被拒"), "拒因留痕");
  // 槽行渲染:🎧 已填槽+✕+文件名引用/上传(accept=audio/*)
  const root = stubElement();
  sb.DaoyanCards.build(root, ctrl);
  assert.ok(root.innerHTML.includes("参考音频"), "音频槽行标题");
  assert.ok(root.innerHTML.includes("🎧"), "已填槽 🎧");
  assert.ok(root.innerHTML.includes('data-act="del-audio"'), "槽角 ✕");
  assert.ok(root.innerHTML.includes('data-act="add-audio"'), "文件名引用添加钮");
  assert.ok(root.innerHTML.includes('accept="audio/*"'), "上传 accept=audio/*");
  assert.ok(root.innerHTML.includes("a.mp3"), "文件名入槽");
});

// ── ㊴ audios normalize 去重帽3(1115 缺口5 修E:chips 编号恒不悬空)──
test("㊴ audios normalize:['a','a','b','c','d']→['a','b','c'](去重保序+帽3);roundtrip 保全;MAX_AUDIO_REFS=3", () => {
  const sb = loadPanel();
  const st = sb.DaoyanSerial.normalizeState({ segments: [{ audios: ["a", "a", "b", "c", "d"] }] });
  assert.equal(JSON.stringify(st.segments[0].audios), JSON.stringify(["a", "b", "c"]),
    "归一面收敛:去重保序+帽 3(修E)");
  assert.equal(sb.DaoyanSerial.MAX_AUDIO_REFS, 3, "引擎 AUTOGROW ref_audio_0..2 口径");
  const round = JSON.parse(sb.DaoyanSerial.buildTimelinePayload(st));
  assert.equal(JSON.stringify(round.segments[0].audios), JSON.stringify(["a", "b", "c"]),
    "roundtrip 保全");
});

// ── ㊷ 段间引导 continuity:默认开/toggle/params 渲染(1115 缺口7)─────
test("㊷ 段间引导:normalizeState 默认 true;{continuity:false}→false;roundtrip 保全;toggleContinuity 写 state+渲 capToggle", async () => {
  const sb = loadPanel();
  assert.equal(sb.DaoyanSerial.normalizeState({}).continuity, true, "默认开");
  assert.equal(sb.DaoyanSerial.normalizeState({ continuity: false }).continuity, false);
  assert.equal(sb.DaoyanSerial.normalizeState({ continuity: true }).continuity, true);
  assert.equal(JSON.parse(sb.DaoyanSerial.buildTimelinePayload(
    sb.DaoyanSerial.normalizeState({ continuity: false }))).continuity, false, "roundtrip 保全");
  const { ctrl } = makeCtrl(sb, { debounceMs: 10 });
  assert.equal(ctrl.state.continuity, true, "控制器态默认开");
  assert.equal(sb.DaoyanParams.actions.toggleContinuity(ctrl), false, "翻转为关");
  assert.equal(ctrl.state.continuity, false, "toggle 写 st.continuity");
  const proot = stubElement();
  sb.DaoyanParams.build(proot, ctrl);
  assert.ok(proot.innerHTML.includes('data-act="toggle-continuity"'), "capToggle 渲染");
  assert.ok(proot.innerHTML.includes("段间引导"), "采样区胶囊行");
  assert.ok(proot.innerHTML.includes("上一镜末帧入参考首槽"), "hint 在");
  assert.equal(sb.DaoyanParams.actions.toggleContinuity(ctrl), true, "再翻回开");
  assert.equal(ctrl.state.continuity, true);
});
