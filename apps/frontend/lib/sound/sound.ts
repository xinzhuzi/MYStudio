"use client";

/**
 * MYStudio 高端 UI 音效系统
 *
 * 设计目标：模仿 Apple Vision Pro / Tesla / Hermes 那种"清脆的瞬态"激活音
 * 关键技术：噪声瞬态 + 双谐波 + 谐振低通，让声音有"啪"的物理质感
 * - 不依赖任何音频资源
 * - 首次点击时自动激活 AudioContext（解决 Chrome 策略限制）
 */

let _ctx: AudioContext | null = null;
let _masterGain: GainNode | null = null;
let _muted = false;
let _noiseBuffer: AudioBuffer | null = null;

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (_ctx && _ctx.state !== "closed") {
    if (_ctx.state === "suspended") _ctx.resume().catch(() => {});
    return _ctx;
  }
  try {
    const Ctor = (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext);
    if (!Ctor) return null;
    _ctx = new Ctor();
    _masterGain = _ctx.createGain();
    _masterGain.gain.value = 0.4;
    _masterGain.connect(_ctx.destination);
    return _ctx;
  } catch {
    return null;
  }
}

/** 生成一次性噪声 buffer（4 秒白噪声） */
function getNoiseBuffer(ctx: AudioContext): AudioBuffer {
  if (_noiseBuffer && _noiseBuffer.sampleRate === ctx.sampleRate) return _noiseBuffer;
  const len = ctx.sampleRate * 4;
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  _noiseBuffer = buf;
  return buf;
}

/** 噪声瞬态 + 谐振低通 → "啪"的金属感 */
function makeClickTransient(ctx: AudioContext, dest: AudioNode, opts: {
  freq: number;
  q: number;
  noiseLevel: number;
  oscLevel: number;
  duration: number;
  attack: number;
  decay: number;
}) {
  const now = ctx.currentTime;

  // 1. 噪声瞬态（提供"啪"的攻击感）
  const noise = ctx.createBufferSource();
  noise.buffer = getNoiseBuffer(ctx);
  const noiseFilter = ctx.createBiquadFilter();
  noiseFilter.type = "bandpass";
  noiseFilter.frequency.value = opts.freq * 4;
  noiseFilter.Q.value = 2;
  const noiseGain = ctx.createGain();
  noiseGain.gain.setValueAtTime(0, now);
  noiseGain.gain.linearRampToValueAtTime(opts.noiseLevel, now + opts.attack);
  noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + opts.attack + opts.decay * 0.3);
  noise.connect(noiseFilter).connect(noiseGain).connect(dest);
  noise.start(now);
  noise.stop(now + opts.attack + opts.decay * 0.3 + 0.01);

  // 2. 谐振低通的双谐波（提供"叮"的金属感）
  const osc1 = ctx.createOscillator();
  osc1.type = "sine";
  osc1.frequency.setValueAtTime(opts.freq, now);
  osc1.frequency.exponentialRampToValueAtTime(opts.freq * 0.5, now + opts.duration);

  const osc2 = ctx.createOscillator();
  osc2.type = "sine";
  osc2.frequency.setValueAtTime(opts.freq * 1.5, now);
  osc2.frequency.exponentialRampToValueAtTime(opts.freq * 0.75, now + opts.duration);

  // 谐振低通（关键：增加金属感）
  const resFilter = ctx.createBiquadFilter();
  resFilter.type = "lowpass";
  resFilter.frequency.value = opts.freq * 3;
  resFilter.Q.value = opts.q;

  const oscGain = ctx.createGain();
  oscGain.gain.setValueAtTime(0, now);
  oscGain.gain.linearRampToValueAtTime(opts.oscLevel, now + opts.attack);
  oscGain.gain.exponentialRampToValueAtTime(0.0001, now + opts.duration);

  osc1.connect(oscGain);
  osc2.connect(oscGain);
  oscGain.connect(resFilter);
  resFilter.connect(dest);

  osc1.start(now);
  osc2.start(now);
  osc1.stop(now + opts.duration);
  osc2.stop(now + opts.duration);
}

/** 激活音：清脆的"啪"+"叮"，Apple Vision Pro 风格 */
function playActivate() {
  const ctx = getCtx();
  if (!ctx || !_masterGain) return;

  makeClickTransient(ctx, _masterGain, {
    freq: 1200,        // 主频
    q: 8,              // 高谐振
    noiseLevel: 0.5,   // 噪声瞬态
    oscLevel: 0.4,     // 谐波
    duration: 0.08,    // 短促
    attack: 0.001,     // 极快起音
    decay: 0.04,
  });
}

/** 轻点击音：更轻的"嗒" */
function playClick() {
  const ctx = getCtx();
  if (!ctx || !_masterGain) return;

  makeClickTransient(ctx, _masterGain, {
    freq: 900,
    q: 6,
    noiseLevel: 0.35,
    oscLevel: 0.25,
    duration: 0.05,
    attack: 0.001,
    decay: 0.025,
  });
}

/** 成功音：双音"叮咚"，上扬确认感 */
function playSuccess() {
  const ctx = getCtx();
  if (!ctx || !_masterGain) return;
  const now = ctx.currentTime;

  // 第一声
  makeClickTransient(ctx, _masterGain, {
    freq: 1100, q: 8, noiseLevel: 0.45, oscLevel: 0.4,
    duration: 0.07, attack: 0.001, decay: 0.035,
  });
  // 间隔 60ms 后第二声（更高）
  setTimeout(() => {
    if (!ctx || !_masterGain) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(1500, t);
    osc.frequency.exponentialRampToValueAtTime(1500, t + 0.1);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.35, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    const f = ctx.createBiquadFilter();
    f.type = "lowpass"; f.frequency.value = 4000; f.Q.value = 4;
    osc.connect(g).connect(f).connect(_masterGain);
    osc.start(t); osc.stop(t + 0.15);
  }, 60);
}

/** 取消音：下行"噗"，柔和的否认感 */
function playCancel() {
  const ctx = getCtx();
  if (!ctx || !_masterGain) return;
  const now = ctx.currentTime;

  const osc = ctx.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(500, now);
  osc.frequency.exponentialRampToValueAtTime(180, now + 0.15);

  const g = ctx.createGain();
  g.gain.setValueAtTime(0, now);
  g.gain.linearRampToValueAtTime(0.3, now + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);

  const f = ctx.createBiquadFilter();
  f.type = "lowpass";
  f.frequency.value = 800;
  f.Q.value = 2;

  osc.connect(g).connect(f).connect(_masterGain);
  osc.start(now);
  osc.stop(now + 0.2);
}

/** 滑动音：上传/下载进度条等 */
function playSlide() {
  const ctx = getCtx();
  if (!ctx || !_masterGain) return;

  const osc = ctx.createOscillator();
  osc.type = "sine";
  const now = ctx.currentTime;
  osc.frequency.setValueAtTime(300, now);
  osc.frequency.exponentialRampToValueAtTime(600, now + 0.06);

  const g = ctx.createGain();
  g.gain.setValueAtTime(0, now);
  g.gain.linearRampToValueAtTime(0.18, now + 0.003);
  g.gain.exponentialRampToValueAtTime(0.0001, now + 0.08);

  osc.connect(g).connect(_masterGain);
  osc.start(now);
  osc.stop(now + 0.1);
}

export type SoundEffect = "activate" | "click" | "success" | "cancel" | "slide";

const PLAYERS: Record<SoundEffect, () => void> = {
  activate: playActivate,
  click: playClick,
  success: playSuccess,
  cancel: playCancel,
  slide: playSlide,
};

/** 播放音效 */
export function playSound(effect: SoundEffect) {
  if (_muted) return;
  try {
    PLAYERS[effect]();
  } catch {
    // ignore
  }
}

/** 全局静音 */
export function setSoundMuted(muted: boolean) {
  _muted = muted;
}

/** 初始化音频上下文（首次用户点击时调用） */
export function initSound() {
  getCtx();
}
