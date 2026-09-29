// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
import { app } from "/scripts/app.js";

/**
 * 视频对比审片器 DOM 件(0929 TE-MAN 排查 B2 仿写件)。
 * 双 <video> 滑动帘 + rAF 同步(syncToken 防竞态:每轮同步持令牌,旧循环
 * 见令牌易主即自杀,换源/跳帧/播放态切换绝不留双环)+ 帧对齐(共享帧号
 * F,A/B 各按自身 frame_count/frame_rate 换算各自的秒,两路帧率可不同,
 * 播放中 B 侧 playbackRate=rateB/rateA 贴帧走,漂移超容限即校正 seek)
 * + A/B 声道切换(单边出声,<video>.muted 行为)。
 * 后端 MyVideoABCompare 执行时把双路落 temp mp4+帧元数据,onExecuted 接
 * ui.abCompare;交互状态存 node.properties.myAbVideo 随工作流保存/重开
 * 复原,禁走 widgets_values。DOM widget 的 pointer/wheel 被动区一律转发回
 * app.canvas._xxx_callback(不转发=画布僵死;转发样板=仓内 VHS 同款),
 * 交互区(按钮行/帘手柄)本地消费 setPointerCapture 拖帘。
 */

import { AB_COMPARE_TOKENS as TOKENS } from "./theme.js";

const clamp01 = (x) => Math.min(Math.max(Number(x) || 0, 0), 1);
const clampRate = (r) => Math.min(
  Math.max(Number(r) || 1, TOKENS.rateClamp[0]), TOKENS.rateClamp[1]);

// 帧对齐换算(与 py 侧 time_to_frame/aligned_time 同源口径)
const timeToFrame = (t, rate, count) => Math.min(
  Math.max(Math.round(t * rate), 0), Math.max(count - 1, 0));
const alignedTime = (frame, rate, count) => Math.min(
  Math.max(frame / rate, 0), Math.max(count - 1, 0) / rate);

// 声道枚举(与 py 侧 AUDIO_CHANNELS 同源;a/b/mute 三态)
const AUDIO_KEYS = ["a", "b", "mute"];

const DEFAULT_STATE = () => ({
  curtain: 0.5,   // 帘位(0=全 B,1=全 A;0.5=正中)
  frame: 0,       // 共享帧号(A/B 各自换算到自己的秒)
  audio: AUDIO_KEYS[0],
  a: null, b: null,  // ui.abCompare 单侧引用(含 frame_count/frame_rate)
});

const ensureState = (node) => {
  const props = node.properties || (node.properties = {});
  const state = props.myAbVideo || (props.myAbVideo = DEFAULT_STATE());
  state.curtain = clamp01(state.curtain);
  state.frame = Math.max(Number.parseInt(state.frame, 10) || 0, 0);
  if (!AUDIO_KEYS.includes(state.audio)) state.audio = AUDIO_KEYS[0];
  return state;
};

const viewUrl = (entry) => `/view?filename=${encodeURIComponent(entry.filename)}`
  + `&subfolder=${encodeURIComponent(entry.subfolder || "")}`
  + `&type=${encodeURIComponent(entry.type || "temp")}`;

// ── 样式(尺寸/配色全走 AB_COMPARE_TOKENS 单源,零散落魔法数)──────────
const STYLES = `
.my-ab-video{pointer-events:none;box-sizing:border-box;width:100%;
  padding:${TOKENS.pad}px;border-radius:8px;
  font:400 11px/1.5 -apple-system,"PingFang SC","Hiragino Sans GB",sans-serif;
  display:flex;flex-direction:column;gap:${TOKENS.barGap}px;}
.my-ab-video *{box-sizing:border-box;margin:0;}
.abv-stage{pointer-events:none;position:relative;width:100%;
  height:${TOKENS.stageH}px;background:${TOKENS.colors.stageBg};
  border:1px solid ${TOKENS.colors.stageBorder};border-radius:8px;
  overflow:hidden;user-select:none;}
.abv-v{position:absolute;inset:0;width:100%;height:100%;
  object-fit:contain;pointer-events:none;background:transparent;}
.abv-v--b{clip-path:inset(0 0 0 50%);} /* 帘右露 B;JS 随帘位改 inset */
.abv-divider{pointer-events:none;position:absolute;top:0;bottom:0;left:50%;
  width:${TOKENS.dividerW}px;background:${TOKENS.colors.divider};
  box-shadow:0 0 6px ${TOKENS.colors.dividerGlow};}
.abv-handle{pointer-events:auto;position:absolute;top:50%;left:50%;
  transform:translate(-50%,-50%);width:${TOKENS.handleR * 2}px;
  height:${TOKENS.handleR * 2}px;border-radius:50%;
  background:${TOKENS.colors.handleBg};border:${TOKENS.lensBorderW}px solid ${TOKENS.colors.divider};
  color:${TOKENS.colors.handleIcon};cursor:ew-resize;
  display:flex;align-items:center;justify-content:center;
  font:700 10px/1 inherit;}
.abv-badge{position:absolute;top:6px;padding:1px 7px;border-radius:7px;
  background:${TOKENS.colors.badgeBg};color:${TOKENS.colors.badgeText};
  font:600 10px/1.5 inherit;pointer-events:none;}
.abv-badge--a{left:8px;}
.abv-badge--b{right:8px;}
.abv-bar{pointer-events:auto;display:flex;flex-wrap:wrap;align-items:center;
  gap:5px;min-height:${TOKENS.buttonRowH}px;}
.abv-btn{cursor:pointer;font:600 10px/1 inherit;height:${TOKENS.barBtnH}px;
  padding:0 9px;border-radius:7px;white-space:nowrap;
  color:${TOKENS.colors.pillOffText};
  background:${TOKENS.colors.pillOffBg};
  border:1px solid ${TOKENS.colors.pillOffBorder};
  transition:background 120ms ease;}
.abv-btn:hover{background:${TOKENS.colors.pillBg};}
.abv-btn.is-on{color:${TOKENS.colors.pillText};
  background:${TOKENS.colors.pillBg};
  border-color:${TOKENS.colors.pillBorder};}
.abv-readout{margin-left:auto;color:${TOKENS.colors.readout};
  font:500 10px/1.5 ui-monospace,Menlo,monospace;white-space:nowrap;}
.abv-empty{position:absolute;inset:0;display:flex;align-items:center;
  justify-content:center;color:${TOKENS.colors.readout};pointer-events:none;}
`;

const ensureStyles = () => {
  if (document.getElementById("my-ab-video-styles")) return;
  const style = document.createElement("style");
  style.id = "my-ab-video-styles";
  style.textContent = STYLES;
  document.head.append(style);
};

app.registerExtension({
  name: "my.abcompare.video",
  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData?.name !== "MyVideoABCompare") return;

    // ── rAF 同步引擎:syncToken 防竞态(旧环见令牌易主即自杀)──────────
    const startSyncLoop = (node) => {
      const ui = node.__myAbVideo;
      if (!ui) return;
      ui.syncToken += 1;
      const token = ui.syncToken;
      const loop = () => {
        if (!node.__myAbVideo || ui.syncToken !== token) return; // 竞态自杀
        tickSync(node);
        // 暂停态一拍即歇环(读数由 seek/交互直更;静置节点零 rAF 常驻)
        if (!ui.playing) return;
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    };

    // 每帧:A 为主钟推共享帧号;B 漂移超容限即校正;读数/播完收尾
    const tickSync = (node) => {
      const ui = node.__myAbVideo;
      // 生命周期守卫:节点已删(DOM 脱离)即歇环,不写 detached 节点
      if (!ui || !ui.el.isConnected) return;
      const state = ensureState(node);
      const { videoA, videoB } = ui;
      if (!state.a || !state.b || !videoA.src || !videoB.src) return;
      if (ui.playing && !videoA.paused) {
        const rateA = state.a.frame_rate;
        const countA = state.a.frame_count;
        const countB = state.b.frame_count;
        const rateB = state.b.frame_rate;
        const shared = Math.min(countA, countB) - 1;
        const frame = timeToFrame(videoA.currentTime, rateA, countA);
        if (frame !== state.frame) state.frame = Math.min(frame, shared);
        const targetB = alignedTime(state.frame, rateB, countB);
        if (Math.abs(videoB.currentTime - targetB) > TOKENS.driftTolerance) {
          videoB.currentTime = targetB; // 帧对齐校正(漂移超容限)
        }
        if (frame >= shared || videoA.ended) {
          setPlaying(node, false); // 对齐窗口播完即停(B 不越界独行)
        }
      } else if (ui.playing && videoA.paused && !videoA.seeking) {
        // 外部暂停(标签页后台/浏览器媒体键):状态收口回「暂停」面
        setPlaying(node, false);
      }
      updateReadout(node);
    };

    const updateReadout = (node) => {
      const ui = node.__myAbVideo;
      const state = ensureState(node);
      if (!state.a || !state.b) {
        ui.readout.textContent = "";
        return;
      }
      const frame = Math.min(state.frame, Math.min(state.a.frame_count, state.b.frame_count) - 1);
      const text = `A f${String(frame).padStart(3, "0")}/${state.a.frame_count}·${state.a.frame_rate}fps`
        + ` B f${String(frame).padStart(3, "0")}/${state.b.frame_count}·${state.b.frame_rate}fps`
        + (ui.playing ? " ▶" : " ⏸");
      if (ui.readout.textContent !== text) ui.readout.textContent = text;
    };

    const applyCurtain = (node) => {
      const ui = node.__myAbVideo;
      const state = ensureState(node);
      const pct = state.curtain * 100;
      ui.videoB.style.clipPath = `inset(0 0 0 ${pct}%)`;
      ui.divider.style.left = `${pct}%`;
      ui.handle.style.left = `${pct}%`;
    };

    const applyAudio = (node) => {
      const ui = node.__myAbVideo;
      const state = ensureState(node);
      ui.videoA.muted = state.audio !== "a";
      ui.videoB.muted = state.audio !== "b";
      for (const key of AUDIO_KEYS) {
        ui.audioBtns[key]?.classList.toggle("is-on", state.audio === key);
      }
    };

    const setPlaying = (node, playing) => {
      const ui = node.__myAbVideo;
      const state = ensureState(node);
      ui.playing = playing;
      ui.playBtn.textContent = playing ? "⏸ 暂停" : "▶ 播放";
      ui.playBtn.classList.toggle("is-on", playing);
      if (!state.a || !state.b) return;
      if (playing) {
        // 帧率不同路:B 以 rateB/rateA 倍速贴帧走(夹浏览器安全带)
        ui.videoB.playbackRate = clampRate(state.b.frame_rate / state.a.frame_rate);
        // play() 恒 Promise 化包一层(真浏览器 Promise/降级宿主 undefined 双兼容)
        Promise.resolve(ui.videoA.play()).catch(() => { setPlaying(node, false); });
        Promise.resolve(ui.videoB.play()).catch(() => { /* 单路失败不拦主路 */ });
      } else {
        ui.videoA.pause();
        ui.videoB.pause();
        seekFrame(node, state.frame); // 暂停即回帧对齐(消半途相位差)
      }
      startSyncLoop(node); // 播放态切换=新令牌重开同步环
    };

    const seekFrame = (node, frame) => {
      const ui = node.__myAbVideo;
      const state = ensureState(node);
      if (!state.a || !state.b) return;
      const shared = Math.min(state.a.frame_count, state.b.frame_count) - 1;
      state.frame = Math.min(Math.max(frame, 0), Math.max(shared, 0));
      ui.videoA.currentTime = alignedTime(state.frame, state.a.frame_rate, state.a.frame_count);
      ui.videoB.currentTime = alignedTime(state.frame, state.b.frame_rate, state.b.frame_count);
      updateReadout(node);
    };

    const loadSides = (node) => {
      const ui = node.__myAbVideo;
      const state = ensureState(node);
      const empty = ui.stage.querySelector(".abv-empty");
      if (!state.a || !state.b) {
        empty.hidden = false;
        empty.textContent = "接 A/B 两路 VIDEO 后执行Queue即可同步审看";
        return;
      }
      empty.hidden = true;
      ui.badgeA.textContent = String(state.a.label ?? "A");
      ui.badgeB.textContent = String(state.b.label ?? "B");
      ui.videoA.src = viewUrl(state.a);
      ui.videoB.src = viewUrl(state.b);
      const reseek = () => seekFrame(node, state.frame);
      ui.videoA.onloadedmetadata = reseek;
      ui.videoB.onloadedmetadata = reseek;
      applyCurtain(node);
      applyAudio(node);
      setPlaying(node, false);
      startSyncLoop(node); // 换源=新令牌(旧同步环自杀,双环绝迹)
    };

    // ── DOM 骨架 + 官方 addDOMWidget(样板同 stage-node/shot-node)────────
    const mountDom = (node) => {
      ensureStyles();
      const el = document.createElement("div");
      el.className = "my-ab-video";
      el.innerHTML = `
        <div class="abv-stage">
          <video class="abv-v" data-side="a" playsinline preload="metadata"></video>
          <video class="abv-v abv-v--b" data-side="b" playsinline preload="metadata"></video>
          <span class="abv-badge abv-badge--a">A</span>
          <span class="abv-badge abv-badge--b">B</span>
          <div class="abv-divider"></div>
          <div class="abv-handle" title="拖动滑动帘对比">↔</div>
          <div class="abv-empty"></div>
        </div>
        <div class="abv-bar">
          <button class="abv-btn abv-play" type="button">▶ 播放</button>
          <button class="abv-btn abv-prev" type="button" title="上一帧(帧对齐)">−1帧</button>
          <button class="abv-btn abv-next" type="button" title="下一帧(帧对齐)">+1帧</button>
          <button class="abv-btn abv-audio" data-audio="a" type="button">A 声</button>
          <button class="abv-btn abv-audio" data-audio="b" type="button">B 声</button>
          <button class="abv-btn abv-audio" data-audio="mute" type="button">静音</button>
          <span class="abv-readout"></span>
        </div>`;
      const widget = node.addDOMWidget("my-ab-video", "my-ab-video", el, {
        hideOnZoom: false,
        serialize: false,  // 纯 UI 面零序列化(官方 audioUI 同款;widgets_values 只留 label 双件)
        getHeight: () => TOKENS.stageH + TOKENS.buttonRowH + TOKENS.pad * 2 + TOKENS.barGap,
        getMinHeight: () => TOKENS.stageH + TOKENS.buttonRowH + TOKENS.barGap,
      });
      widget.serialize = false;  // 双保险(官方 audioUI/VHS 同款置法)
      const stage = el.querySelector(".abv-stage");
      node.__myAbVideo = {
        el, widget, stage,
        videoA: el.querySelector('[data-side="a"]'),
        videoB: el.querySelector('[data-side="b"]'),
        badgeA: el.querySelector(".abv-badge--a"),
        badgeB: el.querySelector(".abv-badge--b"),
        divider: el.querySelector(".abv-divider"),
        handle: el.querySelector(".abv-handle"),
        playBtn: el.querySelector(".abv-play"),
        readout: el.querySelector(".abv-readout"),
        audioBtns: {
          a: el.querySelector('[data-audio="a"]'),
          b: el.querySelector('[data-audio="b"]'),
          mute: el.querySelector('[data-audio="mute"]'),
        },
        syncToken: 0,
        playing: false,
      };
      const ui = node.__myAbVideo;

      // 控件(交互区本地消费)
      ui.playBtn.addEventListener("click", () => setPlaying(node, !ui.playing));
      el.querySelector(".abv-prev").addEventListener("click", () => {
        setPlaying(node, false);
        seekFrame(node, ensureState(node).frame - 1);
      });
      el.querySelector(".abv-next").addEventListener("click", () => {
        setPlaying(node, false);
        seekFrame(node, ensureState(node).frame + 1);
      });
      for (const key of AUDIO_KEYS) {
        ui.audioBtns[key].addEventListener("click", () => {
          ensureState(node).audio = key;
          applyAudio(node);
        });
      }

      // 滑帘拖拽:setPointerCapture 锁定,move/up 恒落 handle(不被转发)
      ui.handle.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        event.stopPropagation();
        // 降级宿主无 setPointerCapture 亦可拖(真浏览器恒在,jsdom 类宿主缺席)
        ui.handle.setPointerCapture?.(event.pointerId);
        ui.dragging = true;
      });
      ui.handle.addEventListener("pointermove", (event) => {
        if (!ui.dragging) return;
        event.stopPropagation();
        const rect = stage.getBoundingClientRect();
        ensureState(node).curtain = clamp01((event.clientX - rect.left) / rect.width);
        applyCurtain(node);
      });
      const endDrag = (event) => {
        if (!ui.dragging) return;
        ui.dragging = false;
        if (ui.handle.hasPointerCapture?.(event.pointerId)) {
          ui.handle.releasePointerCapture(event.pointerId);
        }
      };
      ui.handle.addEventListener("pointerup", endDrag);
      ui.handle.addEventListener("pointercancel", endDrag);

      // 三板斧纪律:被动区 pointer/wheel 转发回画布(不转发=画布僵死;
      // 转发样板=VHS 同款 capture 段;交互区 closest() 放行本地消费)
      const interactive = (target) => Boolean(target.closest?.(".abv-bar, .abv-handle"));
      el.addEventListener("pointerdown", (event) => {
        if (interactive(event.target)) return;
        event.preventDefault();
        return app.canvas._mousedown_callback(event);
      }, true);
      el.addEventListener("pointermove", (event) => {
        if (interactive(event.target)) return;
        event.preventDefault();
        return app.canvas._mousemove_callback(event);
      }, true);
      el.addEventListener("pointerup", (event) => {
        if (interactive(event.target)) return;
        event.preventDefault();
        return app.canvas._mouseup_callback(event);
      }, true);
      el.addEventListener("mousewheel", (event) => {
        event.preventDefault();
        return app.canvas._mousewheel_callback(event);
      }, true);
      el.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        return app.canvas._mousedown_callback(event);
      }, true);
    };

    // ── 三板斧五钩子 ────────────────────────────────────────────────
    const onNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      const result = onNodeCreated?.apply(this, arguments);
      try {
        ensureState(this);
        mountDom(this);
        loadSides(this);
        this.size[0] = Math.max(this.size[0] || 0, TOKENS.stageMinW);
      } catch (error) { /* 兜底=原生外观 */ }
      return result;
    };

    const onExecuted = nodeType.prototype.onExecuted;
    nodeType.prototype.onExecuted = function (message) {
      const result = onExecuted?.apply(this, arguments);
      try {
        const payload = message?.abCompare;
        // 引擎 ui 契约:每个 ui 值被列表扁平化 → abCompare=[侧a,侧b](side 字段
        // 显式标识);旧 dict 形(探针桩)双读兼容
        const a = Array.isArray(payload) ? payload.find((p) => p && p.side === "a") : payload?.a;
        const b = Array.isArray(payload) ? payload.find((p) => p && p.side === "b") : payload?.b;
        if (!a || !b) return result;
        const state = ensureState(this);
        state.a = a;
        state.b = b;
        state.frame = Math.min(state.frame || 0,
          Math.min(a.frame_count, b.frame_count) - 1);
        loadSides(this);
      } catch (error) { /* 无源兜底=占位文案 */ }
      return result;
    };

    const onResize = nodeType.prototype.onResize;
    nodeType.prototype.onResize = function () {
      const result = onResize?.apply(this, arguments);
      try {
        this.size[0] = Math.max(this.size[0] || 0, TOKENS.stageMinW);
      } catch (error) { /* 无碍 */ }
      return result;
    };

    const onSerialize = nodeType.prototype.onSerialize;
    nodeType.prototype.onSerialize = function () {
      const result = onSerialize?.apply(this, arguments);
      try { ensureState(this); } catch (error) { /* 无碍 */ }
      return result;
    };

    const onConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function () {
      const result = onConfigure?.apply(this, arguments);
      try {
        ensureState(this);
        if (this.__myAbVideo) {
          loadSides(this);
          applyCurtain(this);
          applyAudio(this);
        }
      } catch (error) { /* 无碍 */ }
      return result;
    };

    // ── 生命周期收口:onRemoved(播放中删节点=同步环立死+双 video 停播停声)──
    // rAF 环另有 tickSync 侧 isConnected 守卫双保险(宿主不调 onRemoved 也不空转)
    const onRemoved = nodeType.prototype.onRemoved;
    nodeType.prototype.onRemoved = function () {
      const result = onRemoved?.apply(this, arguments);
      try {
        const ui = this.__myAbVideo;
        if (ui) {
          ui.playing = false;
          ui.syncToken += 1;  // 在途 rAF 环见令牌易主即自杀
          ui.videoA?.pause();
          ui.videoB?.pause();
        }
      } catch (error) { /* 无碍 */ }
      return result;
    };
  },
});
