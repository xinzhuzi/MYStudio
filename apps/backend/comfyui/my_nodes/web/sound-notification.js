// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
import { api } from "/scripts/api.js";

/**
 * 生成完成提示音(1021 用户令:作图生成之后必须响一声,只响成功)。
 *
 * 事件面(引擎 execution.py:827 现核):execution_success 为单播——
 * add_message(..., broadcast=False) 只发回提交该任务的 client_id。
 * 因此本件只对本浏览器自己排的队列响(手动点 Queue / 画布本地派发),
 * 漫影 App 经 sidecar 提交(execute.py:302 随机 client_id)听不到,
 * 两侧天然零重响。App 代码路由渲染层 generation-chime.ts 同令覆盖。
 *
 * 新前端(1.55.x)无内置完成提示音(官方仓库 main 树核实未移植),
 * 本件即手动路唯一落点。WebAudio 合成零资产;节流 1s 防连点连环响;
 * 任何失败静默,不得影响队列/画布本身。
 */

const CHIME_THROTTLE_MS = 1000;
let lastChimeAt = 0;

function playChime() {
  const Ctor = window.AudioContext || window.webkitAudioContext;
  if (!Ctor) return;
  const ctx = new Ctor();
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  const t0 = ctx.currentTime;
  const notes = [
    { freq: 1318.51, gain: 0.22, offset: 0 },
    { freq: 659.25, gain: 0.1, offset: 0.02 },
  ];
  for (const { freq, gain, offset } of notes) {
    const osc = ctx.createOscillator();
    const amp = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    amp.gain.setValueAtTime(0, t0 + offset);
    amp.gain.linearRampToValueAtTime(gain, t0 + offset + 0.012);
    amp.gain.exponentialRampToValueAtTime(0.0001, t0 + offset + 0.5);
    osc.connect(amp).connect(ctx.destination);
    osc.start(t0 + offset);
    osc.stop(t0 + offset + 0.55);
  }
  setTimeout(() => ctx.close().catch(() => {}), 800);
}

api.addEventListener("execution_success", () => {
  const now = Date.now();
  if (now - lastChimeAt < CHIME_THROTTLE_MS) return;
  lastChimeAt = now;
  try {
    playChime();
  } catch {
    // 提示音失败静默
  }
});
