/**
 * 生图完成提示音(1021 用户令:作图生成之后必须响一声,只响成功)。
 *
 * 覆盖矩阵(两侧 client_id 单播语义天然零重响):
 * - App 代码生图:三条漏斗(image-generator-core / image-generation-engine /
 *   image-generator-grid)成功出口统一调 notifyImageGenerationSuccess();
 * - 手动 ComfyUI 队列/画布本地队列:浏览器提交方单播收到
 *   execution_success,由引擎侧 my_nodes/web/sound-notification.js 同令响;
 * - App 经 sidecar 提交(带随机 client_id,execute.py)浏览器听不到,不重响。
 *
 * 渲染层专用:漏斗全在渲染层执行(comfy-cloud-relay 主进程只转发),
 * WebAudio 合成零资产零 IPC。节流 1s 防并行批次收口连环响;任何失败
 * 必须静默——提示音不得影响生图链路本身。
 */

const CHIME_THROTTLE_MS = 1_000;
let lastChimeAt = 0;

/** 生图成功出图后响一声(1s 内多张连成只响一次)。 */
export function notifyImageGenerationSuccess(): void {
  const now = Date.now();
  if (now - lastChimeAt < CHIME_THROTTLE_MS) return;
  lastChimeAt = now;
  try {
    playWebAudioChime();
  } catch {
    // 提示音失败静默:不吞生图链路的任何状态
  }
}

/** 双分音「叮」:E6 基音 + 低八度衬音,快起音指数衰减。 */
function playWebAudioChime(): void {
  if (typeof AudioContext === 'undefined') return;
  const ctx = new AudioContext();
  if (ctx.state === 'suspended') void ctx.resume().catch(() => {});
  const t0 = ctx.currentTime;
  const notes: ReadonlyArray<{ freq: number; gain: number; offset: number }> = [
    { freq: 1318.51, gain: 0.22, offset: 0 },
    { freq: 659.25, gain: 0.1, offset: 0.02 },
  ];
  for (const { freq, gain, offset } of notes) {
    const osc = ctx.createOscillator();
    const amp = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    amp.gain.setValueAtTime(0, t0 + offset);
    amp.gain.linearRampToValueAtTime(gain, t0 + offset + 0.012);
    amp.gain.exponentialRampToValueAtTime(0.0001, t0 + offset + 0.5);
    osc.connect(amp).connect(ctx.destination);
    osc.start(t0 + offset);
    osc.stop(t0 + offset + 0.55);
  }
  // 播完即关,AudioContext 句柄不驻留
  setTimeout(() => void ctx.close().catch(() => {}), 800);
}

/** 仅供测试复位节流窗。 */
export function resetGenerationChimeForTests(): void {
  lastChimeAt = 0;
}
