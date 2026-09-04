"use client";

import shutterUrl from "@/assets/sounds/shutter.mp3";

/**
 * MYStudio 电影级 UI 音效系统
 *
 * 设计目标：影厅里按下一个实体键的听感 —— 低频有重量、高频只留一点微光、
 * 尾部有一层自然消散的空气残响。刻意避开旧版的高 Q 谐振金属声。
 *
 * 分层结构（每个音效都由同一个 voice 合成）：
 *   1. body    低频正弦，频率轻微下滑，模拟键落底的重量
 *   2. sub     低八度垫底，只给胸腔感不给音高
 *   3. sparkle 极轻的高频噪声微光，2ms 起、28ms 灭，点出"按下"的瞬间
 *   4. air     低通噪声长尾，模拟空气残响
 *
 * - 不依赖任何音频资源
 * - 首次点击时自动激活 AudioContext（解决 Chrome 自动播放策略限制）
 * - 峰值约为旧金属谐振版本的 25%
 */

/** 主输出增益：整体音量的唯一闸门 */
const MASTER_GAIN = 0.16;

/** 旧版 activate 的线性峰值（masterGain 0.4 × (噪声 0.5 + 谐波 0.4)），用于回归断言 */
export const LEGACY_PEAK = 0.36;

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
    _masterGain.gain.value = MASTER_GAIN;
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

export interface VoiceProfile {
  /** body 起始频率（Hz） */
  bodyFreq: number;
  /** body 落点频率倍率，<1 下滑、>1 上扬 */
  bodyDrop: number;
  bodyLevel: number;
  /** 低八度垫底电平，0 表示不加 */
  subLevel: number;
  sparkleFreq: number;
  /** 高频微光电平，0 表示纯低频 */
  sparkleLevel: number;
  /** 空气尾电平，0 表示干声 */
  airLevel: number;
  /** 空气尾时长（秒） */
  airDecay: number;
  attack: number;
  decay: number;
  /** body/sub 的总低通，去掉金属感的关键 */
  lowpass: number;
}

/** 单个 voice 的理论线性峰值（各层同时到顶的最坏情况） */
export function voicePeak(p: VoiceProfile): number {
  return (p.bodyLevel + p.subLevel + p.sparkleLevel + p.airLevel) * MASTER_GAIN;
}

function playVoice(ctx: AudioContext, dest: AudioNode, p: VoiceProfile, at: number) {
  const now = at;
  const end = now + p.decay;

  // 总低通：body 与 sub 都经过它，保证听感是"沉"而不是"叮"
  const tone = ctx.createBiquadFilter();
  tone.type = "lowpass";
  tone.frequency.value = p.lowpass;
  tone.Q.value = 0.7;
  tone.connect(dest);

  const body = ctx.createOscillator();
  body.type = "sine";
  body.frequency.setValueAtTime(p.bodyFreq, now);
  body.frequency.exponentialRampToValueAtTime(p.bodyFreq * p.bodyDrop, end);
  const bodyGain = ctx.createGain();
  bodyGain.gain.setValueAtTime(0.0001, now);
  bodyGain.gain.exponentialRampToValueAtTime(p.bodyLevel, now + p.attack);
  bodyGain.gain.exponentialRampToValueAtTime(0.0001, end);
  body.connect(bodyGain).connect(tone);
  body.start(now);
  body.stop(end + 0.02);

  if (p.subLevel > 0) {
    const sub = ctx.createOscillator();
    sub.type = "sine";
    sub.frequency.setValueAtTime(p.bodyFreq * 0.5, now);
    const subGain = ctx.createGain();
    subGain.gain.setValueAtTime(0.0001, now);
    subGain.gain.exponentialRampToValueAtTime(p.subLevel, now + p.attack * 1.5);
    subGain.gain.exponentialRampToValueAtTime(0.0001, end);
    sub.connect(subGain).connect(tone);
    sub.start(now);
    sub.stop(end + 0.02);
  }

  // 微光走独立支路：它本来就在总低通之上，经过 tone 会被完全削掉
  if (p.sparkleLevel > 0) {
    const sparkle = ctx.createBufferSource();
    sparkle.buffer = getNoiseBuffer(ctx);
    const sparkleFilter = ctx.createBiquadFilter();
    sparkleFilter.type = "bandpass";
    sparkleFilter.frequency.value = p.sparkleFreq;
    sparkleFilter.Q.value = 1.2;
    const sparkleGain = ctx.createGain();
    sparkleGain.gain.setValueAtTime(0.0001, now);
    sparkleGain.gain.exponentialRampToValueAtTime(p.sparkleLevel, now + 0.002);
    sparkleGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.028);
    sparkle.connect(sparkleFilter).connect(sparkleGain).connect(dest);
    sparkle.start(now);
    sparkle.stop(now + 0.04);
  }

  // 空气尾：噪声经过持续下滑的低通，听起来像残响自然变暗而不是被剪断
  if (p.airLevel > 0) {
    const air = ctx.createBufferSource();
    air.buffer = getNoiseBuffer(ctx);
    const airFilter = ctx.createBiquadFilter();
    airFilter.type = "lowpass";
    airFilter.frequency.setValueAtTime(900, now);
    airFilter.frequency.exponentialRampToValueAtTime(320, now + p.airDecay);
    airFilter.Q.value = 0.5;
    const airGain = ctx.createGain();
    airGain.gain.setValueAtTime(0.0001, now);
    airGain.gain.exponentialRampToValueAtTime(p.airLevel, now + 0.012);
    airGain.gain.exponentialRampToValueAtTime(0.0001, now + p.airDecay);
    air.connect(airFilter).connect(airGain).connect(dest);
    air.start(now);
    air.stop(now + p.airDecay + 0.02);
  }
}

export type SoundEffect = "activate" | "click" | "success" | "cancel" | "slide";

/** 成功音的第二声延迟（秒），用 AudioContext 时钟而不是 setTimeout，保证采样级准确 */
const SUCCESS_TAIL_DELAY = 0.09;

export const SOUND_PROFILES: Record<SoundEffect, VoiceProfile> = {
  /** 主按钮：模拟高端相机快门开帘/打板，body + sub + 瞬态微光 + 紧致余响 */
  activate: {
    bodyFreq: 110, bodyDrop: 0.85, bodyLevel: 0.20, subLevel: 0.06,
    sparkleFreq: 4200, sparkleLevel: 0.06,
    airLevel: 0.04, airDecay: 0.16,
    attack: 0.003, decay: 0.08, lowpass: 1300,
  },
  /** 轻交互：同一口快门嗓音，缩短并提高频率，模拟镜间叶片快门（leaf shutter）的轻盈哒哒声 */
  click: {
    bodyFreq: 120, bodyDrop: 0.80, bodyLevel: 0.16, subLevel: 0.04,
    sparkleFreq: 4600, sparkleLevel: 0.055,
    airLevel: 0.03, airDecay: 0.06,
    attack: 0.002, decay: 0.05, lowpass: 1400,
  },
  /** 成功：亮丽 of 齿音配合短促的声调变化（见 playSuccess） */
  success: {
    bodyFreq: 120, bodyDrop: 0.85, bodyLevel: 0.22, subLevel: 0.10,
    sparkleFreq: 3200, sparkleLevel: 0.05,
    airLevel: 0.05, airDecay: 0.18,
    attack: 0.004, decay: 0.12, lowpass: 1200,
  },
  /** 取消：低沉下坠，长尾自然消散 */
  cancel: {
    bodyFreq: 72, bodyDrop: 0.50, bodyLevel: 0.22, subLevel: 0.14,
    sparkleFreq: 1600, sparkleLevel: 0.02,
    airLevel: 0.06, airDecay: 0.28,
    attack: 0.008, decay: 0.22, lowpass: 800,
  },
  /** 滑动：上扬的呼啸声，主要保留气流声 */
  slide: {
    bodyFreq: 140, bodyDrop: 1.25, bodyLevel: 0.12, subLevel: 0,
    sparkleFreq: 3200, sparkleLevel: 0.02,
    airLevel: 0.02, airDecay: 0.08,
    attack: 0.005, decay: 0.07, lowpass: 1600,
  },
};

/** 成功音的第二声：比第一声高一个五度、更暖、尾更长 */
export const SUCCESS_TAIL_PROFILE: VoiceProfile = {
  bodyFreq: 180, bodyDrop: 0.90, bodyLevel: 0.20, subLevel: 0.10,
  sparkleFreq: 3100, sparkleLevel: 0.04,
  airLevel: 0.07, airDecay: 0.32,
  attack: 0.008, decay: 0.20, lowpass: 1400,
};

/** 摄影快门音的第二声：落镜/合帘的声音，更量感、更低沉（合成 palette，保留备用） */
export const ACTIVATE_TAIL_PROFILE: VoiceProfile = {
  bodyFreq: 80, bodyDrop: 0.65, bodyLevel: 0.20, subLevel: 0.10,
  sparkleFreq: 3200, sparkleLevel: 0.04,
  airLevel: 0.05, airDecay: 0.15,
  attack: 0.004, decay: 0.12, lowpass: 900,
};

/** 播放音效 */
export function playSound(effect: SoundEffect) {
  if (_muted) return;
  // activate（摄像机快门）改用真实 mp3 采样，听感比合成更扎实。
  // 所有按钮点击都经 interaction-sound 的 INTENT_TO_EFFECT 落到 activate，
  // 因此这里一处接管即可让全部按钮声变成快门采样。
  if (effect === "activate") {
    playShutter();
    return;
  }
  try {
    const ctx = getCtx();
    if (!ctx || !_masterGain) return;
    const now = ctx.currentTime;
    playVoice(ctx, _masterGain, SOUND_PROFILES[effect], now);
    if (effect === "success") {
      playVoice(ctx, _masterGain, SUCCESS_TAIL_PROFILE, now + SUCCESS_TAIL_DELAY);
    }
  } catch {
    // ignore
  }
}

/** 快门采样音量（独立于合成的 MASTER_GAIN，因为 mp3 是成品录音，电平不同） */
const SHUTTER_VOLUME = 0.25;

let _shutterAudio: HTMLAudioElement | null = null;

function getShutterAudio(): HTMLAudioElement | null {
  if (typeof window === "undefined") return null;
  if (!_shutterAudio) {
    try {
      const audio = new Audio(shutterUrl);
      audio.preload = "auto";
      audio.volume = SHUTTER_VOLUME;
      _shutterAudio = audio;
    } catch {
      return null;
    }
  }
  return _shutterAudio;
}

/**
 * 播放摄像机快门采样（`assets/sounds/shutter.mp3`）。
 * 受全局静音 `_muted` 控制；用单一共享元素 + currentTime 重置实现快速重触发，
 * 极速连击会被 interaction-sound 的 MIN_REPLAY_INTERVAL_MS 节流。
 */
export function playShutter(): void {
  if (_muted) return;
  const audio = getShutterAudio();
  if (!audio) return;
  try {
    audio.currentTime = 0;
    void audio.play().catch(() => {
      // 自动播放策略或极速重触发可能 reject，忽略
    });
  } catch {
    // ignore
  }
}

/** 全局静音 */
export function setSoundMuted(muted: boolean) {
  _muted = muted;
}

/** 初始化音频上下文（首次用户交互时调用） */
export function initSound() {
  getCtx();
}
