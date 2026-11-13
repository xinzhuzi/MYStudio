// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
/**
 * 导演台面板·阶段2 全逻辑无头测试(11-13-director-console-remake,PRD R2)。
 * 1113 门禁追认批补 ⑮⑯⑰:素材进出全量(真上传/替换/缩略图)、收起态
 * 摘要行(PRD R1.6-1)、导出→导入全字段闭环。
 * 跑法:node --test apps/backend/comfyui/tests/daoyan_panel.test.mjs
 *
 * 被测对象 = my_nodes/web/daoyan/ 六件 IIFE 组件(serial/timeline/cards/
 * params/prompt/toolbar)——vm 加载真源文件 + 最小 DOM stub(无 jsdom、
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
  for (const f of ["serial.js", "toolbar.js", "params.js", "timeline.js", "cards.js", "prompt.js", "live.js"]) {
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
test("② 时长贴网格:5s→124f,4s→107f;拖边界边缘钳制", () => {
  const sb = loadPanel();
  const { ctrl } = makeCtrl(sb);
  assert.equal(sb.DaoyanSerial.secondsToFrames(5), 124, "PRD 钉例 5s→124f");
  assert.equal(sb.DaoyanSerial.secondsToFrames(4), 107, "PRD 钉例 4s→107f");
  assert.equal(sb.DaoyanSerial.secondsToFrames(3), 73, "3s→73f(17×4+5)");
  sb.DaoyanTimeline.actions.addSegment(ctrl);
  sb.DaoyanTimeline.actions.setSegmentSeconds(ctrl, 0, 5);
  assert.equal(ctrl.state.segments[0].frames, 124);
  assert.equal(ctrl.state.segments[0].seconds, 5);
  sb.DaoyanTimeline.actions.setSegmentSeconds(ctrl, 0, 4);
  assert.equal(ctrl.state.segments[0].frames, 107);
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
  assert.equal(parsed.segments[0].frames, 107);
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

// ── ⑩ 槽守门:公共+本组合计 ≤9(AUTOGROW max=9 口径)─────────────────
test("⑩ 槽守门:公共+本组合计≤9;去重;秒数双单位渲染", () => {
  const sb = loadPanel();
  const { ctrl } = makeCtrl(sb, { debounceMs: 10 });
  for (let i = 0; i < 8; i++) {
    assert.equal(sb.DaoyanCards.actions.addCommonImage(ctrl, "c" + i + ".png"), true);
  }
  assert.equal(sb.DaoyanCards.actions.addCommonImage(ctrl, "c0.png"), false, "重名去重");
  assert.equal(sb.DaoyanCards.actions.addCommonImage(ctrl, "c8.png"), true, "第 9 张公共=合计顶格仍合法");
  assert.equal(sb.DaoyanCards.actions.addCommonImage(ctrl, "c9.png"), false, "第 10 张=破 9 上限拒加");
  sb.DaoyanCards.actions.removeCommonImage(ctrl, 0);
  sb.DaoyanCards.actions.addGroup(ctrl);
  assert.equal(sb.DaoyanCards.actions.addGroupImage(ctrl, 0, "a.png"), true, "8公共+1本组=9 合法");
  assert.equal(sb.DaoyanCards.actions.addGroupImage(ctrl, 0, "b.png"), false, "再添=破 9 上限拒加");
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
  assert.equal(ctrl.state.segments[0].frames, 107, "恢复时贴网格(4s→107f)");
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
  assert.equal(lay.items[0].end, 4.96, "124f=4.96s");
  assert.equal(lay.items[1].start, 4.96);
  assert.equal(lay.items[1].end, 9.24, "107f=4.28s 顺累计 4.96+4.28");
  assert.equal(lay.total, 9.24);
  assert.equal(JSON.stringify(sb.DaoyanSerial.FRAME_GRID), JSON.stringify({ k: 17, bias: 5, fps: 25 }));
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
  // 上传路径同吃 ≤9 守门:公共顶格后上传 ok:false
  for (let i = 0; i < 6; i++) await sb.DaoyanCards.actions.uploadToZone(ctrl, "common", 0, { name: "c" + i + ".png" });
  const r4 = await sb.DaoyanCards.actions.uploadToZone(ctrl, "common", 0, { name: "c9.png" });
  assert.equal(r4.ok, false, "8公共+1本组=9 顶格,再上传拒");
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
  sb.DaoyanTimeline.actions.addSegment(ctrl, { id: "A", seconds: 5, mode: "i2v" });  // 124f=4.96s
  sb.DaoyanTimeline.actions.addSegment(ctrl, { id: "B", seconds: 4, mode: "r2v" });  // 107f=4.28s
  sb.DaoyanTimeline.actions.addSegment(ctrl, { id: "C", seconds: 6, mode: "r2v" });  // 158f=6.32s
  // PRD R1.6-1 例形「3 组 · 45s · r2v」:三组/总时长/多数派 mode
  assert.equal(sb.DaoyanSerial.summaryLine(ctrl.state), "3 组 · 15.56s · r2v");
  // 并列(各 1 票)取先见者
  const st2 = sb.DaoyanSerial.normalizeState({ segments: [
    { id: "x", mode: "t2v", seconds: 5 }, { id: "y", mode: "fl2v", seconds: 4 }] });
  assert.equal(sb.DaoyanSerial.summaryLine(st2), "2 组 · 9.24s · t2v");
});

// ── ⑰ 导出→导入全字段闭环(1113 门禁深检修:不再只回填三字段)────────
test("⑰ 导出→导入全字段闭环:stages/color_fix/common_params/advanced/perf 零丢失", async () => {
  const sb = loadPanel();
  const src = makeCtrl(sb, { debounceMs: 10 });
  sb.DaoyanCards.actions.addGroup(src.ctrl);
  sb.DaoyanToolbar.actions.setStage(src.ctrl, "sancai", true);
  sb.DaoyanParams.actions.setAdvanced(src.ctrl, "first_steps", 12);
  sb.DaoyanParams.actions.togglePerf(src.ctrl, "resume"); // → false
  sb.DaoyanParams.actions.cycleColorFix(src.ctrl); // none→adain
  sb.DaoyanCards.actions.addCommonImage(src.ctrl, "canon-jc.png");
  sb.DaoyanPrompt.actions.setPromptField(src.ctrl, "summary", "Miners in fog.");
  const json = sb.DaoyanToolbar.actions.exportPayload(src.ctrl);
  // 导出包含全字段(交换格式=canonical 全量)
  const exported = JSON.parse(json);
  assert.equal(exported.stages.sancai, true);
  assert.equal(exported.color_fix, "adain");
  assert.equal(exported.advanced.first_steps, 12);
  assert.equal(exported.perf.resume, false);
  // 回导新 ctrl:逐字段保全(旧缺陷=只回填 chapter/segments/common_images)
  const dst = makeCtrl(sb, { debounceMs: 10 });
  const r = sb.DaoyanToolbar.actions.importPayload(dst.ctrl, json);
  assert.equal(JSON.stringify(r), JSON.stringify({ ok: true, count: 1 }));
  assert.equal(dst.ctrl.state.stages.sancai, true, "勾选阶段不丢");
  assert.equal(dst.ctrl.state.color_fix, "adain", "color_fix 不丢");
  assert.equal(dst.ctrl.state.advanced.first_steps, 12, "高级采样偏离档不丢");
  assert.equal(dst.ctrl.state.perf.resume, false, "性能开关不丢");
  assert.equal(dst.ctrl.state.common_images[0], "canon-jc.png");
  assert.equal(dst.ctrl.state.segments[0].prompt.summary, "Miners in fog.");
  // 终极断言:整包 canonical 状态同构(导出↔导入零损)
  assert.equal(JSON.stringify(dst.ctrl.state), JSON.stringify(src.ctrl.state));
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
test("⑲ 卡片产物槽:未落盘=「候落盘」×3;落盘=绿胶囊 /view output 链接", () => {
  const sb = loadPanel();
  const { ctrl } = makeCtrl(sb);
  sb.DaoyanCards.actions.addGroup(ctrl);
  const root = stubElement();
  sb.DaoyanCards.build(root, ctrl);
  assert.equal((root.innerHTML.match(/候落盘/g) || []).length, 3, "空态三槽占位");
  assert.ok(!root.innerHTML.includes("dy-art--have"), "未落盘无点亮胶囊");
  // 落盘一槽:绿胶囊+output 型 /view 直看链
  ctrl.apply(function (st) {
    st.segments[0].artifacts.p2 = "video/导演台/chapter-b001/sb-01/p2-final.mp4";
  });
  sb.DaoyanCards.build(root, ctrl);
  const a = root.innerHTML.match(/<a class="dy-art dy-art--have"[^>]*>/)[0];
  assert.ok(a.includes("/view?filename=p2-final.mp4"), "链接指 /view output");
  assert.ok(a.includes("type=output"), "output 型(非 input 缩略通道)");
  assert.ok(root.innerHTML.includes("p2-final.mp4"), "文件名入胶囊");
  assert.ok(root.innerHTML.includes("候落盘"), "其余两槽仍候落盘");
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

// require() 幂等防 tree-shake(双 runner 下保持 CJS 依赖引用)
assert.ok(typeof require === "function");
