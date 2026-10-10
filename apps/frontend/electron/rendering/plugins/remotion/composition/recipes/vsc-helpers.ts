// vsc:* recipe shared utilities — the video-shotcraft assets/lib/helpers
// equivalent (seeded random + camera curves), rewritten for this repo's fixed
// bundle. Attribution and the source commit live in ATTRIBUTION-vsc.md.
//
// Design rules (task 10-10 design §1):
// - Deterministic rendering: no Math.random()/Date.now(). All pseudo-randomness
//   goes through mulberry32 seeded from the shot index (shotSeed below), so the
//   same props render frame-identical output every time.
// - Pure functions of (frame, params): no cross-frame state, so the Player and
//   the render worker compute identical curves.
// - No import from the video-shotcraft plugin: this file is the vendored
//   equivalent (数值语义与上游一致,包括缓动常数/包络系数,便于对照卡片回验)。

import { Easing, interpolate } from "remotion";

// ---------------------------------------------------------------------------
// Seeded randomness (upstream assets/lib/helpers/rand.ts equivalent)
// ---------------------------------------------------------------------------

/**
 * Deterministic PRNG: same seed → same sequence, values in [0, 1).
 * 算法与上游 mulberry32 逐值等价(同种子同序列),配方里一切「随机」都必须
 * 经它产生——种子从镜头 index 派生(shotSeed),严禁裸 Math.random()。
 */
export function mulberry32(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Derive a stable int32 seed from the shot index (+ optional per-recipe salt).
 * FNV-1a over `vsc:${salt}:${shotIndex}` — same index/salt always maps to the
 * same seed, different shots never collide on purpose. This is the ONLY
 * sanctioned way recipes obtain randomness (镜头 index 派生,铁律)。
 */
export function shotSeed(shotIndex: number, salt = ""): number {
  const key = `vsc:${salt}:${shotIndex}`;
  let hash = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash | 0;
}

/** Seeded float in [min, max) — convenience wrapper over mulberry32(shotSeed). */
export function seededFloat(shotIndex: number, salt: string, min: number, max: number): number {
  return min + mulberry32(shotSeed(shotIndex, salt))() * (max - min);
}

// ---------------------------------------------------------------------------
// Motion signals (upstream assets/lib/helpers/motion.ts equivalent)
// ---------------------------------------------------------------------------

/** Sample a trajectory at frame±dt (central difference) → velocity/speed/heading. */
export function velocityAt(
  posAt: (f: number) => { x: number; y: number },
  frame: number,
  dt = 0.5,
): { vx: number; vy: number; speed: number; direction: number } {
  const before = posAt(frame - dt);
  const after = posAt(frame + dt);
  const vx = (after.x - before.x) / (2 * dt);
  const vy = (after.y - before.y) / (2 * dt);
  return { vx, vy, speed: Math.hypot(vx, vy), direction: Math.atan2(vy, vx) };
}

/** Follow-through without state: trailing layer = primary state at frame−delay. */
export function lagged<T>(
  stateAt: (f: number) => T,
  frame: number,
  delayFrames: number,
): T {
  return stateAt(frame - delayFrames);
}

/**
 * Closed-form damped oscillation for recoil/settle tails, t in frames from
 * impact: signed offset factor decaying to 0, scale by the peak amplitude.
 * freq in cycles/frame (~0.1), damping per frame (~0.15).
 */
export function dampedSettle(t: number, freq: number, damping: number): number {
  return t <= 0 ? 0 : Math.exp(-damping * t) * Math.sin(2 * Math.PI * freq * t);
}

// ---------------------------------------------------------------------------
// Deterministic shake (upstream assets/lib/helpers/shake.ts equivalent)
// ---------------------------------------------------------------------------

/**
 * Deterministic hand-held camera noise: layered sines at incommensurate
 * frequencies read as organic drift; amplitude in world/percent units.
 * (上游为 three.js 机位漂移;此处同一曲线供 2D 通道消费。)
 */
export function handheld(frame: number, amp = 0.012): [number, number, number] {
  return [
    amp * (Math.sin(frame * 0.31) + 0.6 * Math.sin(frame * 0.83 + 1.7)),
    amp * (Math.sin(frame * 0.47 + 0.9) + 0.5 * Math.sin(frame * 1.13 + 3.1)),
    0,
  ];
}

// ---------------------------------------------------------------------------
// Camera curves (upstream assets/lib/helpers/camera.tsx Rig, 2D equivalent)
// ---------------------------------------------------------------------------

/**
 * Upstream Rig default ease (Easing.bezier(0.4, 0, 0.2, 1)) — camera moves
 * read as one continuous gesture. Constants kept identical to the source so
 * card re-verification compares like for like.
 */
export const VSC_EASE_IN_OUT = Easing.bezier(0.4, 0.0, 0.2, 1.0);

/** Crash-zoom push ease (demos/camera/crash-zoom-punch): 急加速的 ease-in。 */
export const VSC_CRASH_EASE_IN = Easing.bezier(0.55, 0, 0.7, 1);

/**
 * One scalar key on a camera curve: the frame it happens at plus the value.
 * (上游 CamKeyframe 的 2D 等价:去掉 three.js 的 pos/look/fov,保留
 * 「逐段缓动插值」语义;dutch-roll 等配方把 rotate 当作其中一条曲线。)
 */
export interface CamScalarKey {
  frame: number;
  value: number;
}

/**
 * Keyframe lookup + eased segment progress (the Rig loop, made pure):
 * finds the segment [a, b] containing `frame` (endpoints held outside the
 * range) and returns the eased progress across it. `easing` defaults to
 * VSC_EASE_IN_OUT like the upstream Rig.
 */
export function camSegmentProgress(
  frame: number,
  keyframes: CamScalarKey[],
  easing: (t: number) => number = VSC_EASE_IN_OUT,
): { from: number; to: number; easedT: number } {
  if (keyframes.length === 0) throw new Error("camSegmentProgress 需要至少一个关键帧");
  let a = keyframes[0];
  let b = keyframes[keyframes.length - 1];
  for (let i = 0; i < keyframes.length - 1; i++) {
    if (frame >= keyframes[i].frame && frame <= keyframes[i + 1].frame) {
      a = keyframes[i];
      b = keyframes[i + 1];
      break;
    }
  }
  const easedT = a.frame === b.frame
    ? 1
    : interpolate(frame, [a.frame, b.frame], [0, 1], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
        easing,
      });
  return { from: a.value, to: b.value, easedT };
}

/**
 * Scalar camera curve sampled per frame: eased key by key, endpoints held.
 * crash-zoom / slow-push / dutch-roll 全用这一条通用曲线驱动各自通道。
 */
export function camScalarAtFrame(
  frame: number,
  keyframes: CamScalarKey[],
  easing?: (t: number) => number,
): number {
  const { from, to, easedT } = camSegmentProgress(frame, keyframes, easing);
  return from + (to - from) * easedT;
}

// ---------------------------------------------------------------------------
// crash-zoom-punch curves (card: references/shots/camera/crash-zoom-punch.md)
// ---------------------------------------------------------------------------

/**
 * 回弹幅度缺省 = 上游实测档的精确比例(2.6→2.45,即 ≈5.77%,卡片 3–6% 区间)。
 * 用表达式而非字面量,让「为什么是这个数」自注释。
 */
const DEFAULT_REBOUND_FRACTION = (2.6 - 2.45) / 2.6;

/** 急推参数:卡片默认值烧死(D4——AI 只选 id 不调参,motionParams 首批不接)。 */
export interface CrashZoomCurveOptions {
  /** 急推起始帧(前置 hold 由调用方排布;卡片:前 hold ≥30f 建立全景)。 */
  startFrame: number;
  /** 急推时长,默认 6f(卡片 4–8f;>10f 读作普通推近,冲击感消失)。 */
  zoomFrames?: number;
  /** 起点/终点 zoom,默认 1 → 2.6(卡片目标 2.4–2.8)。 */
  fromScale?: number;
  toScale?: number;
  /**
   * 落位回弹(弹性款):过冲后回收。缺省 = 撞停款(zoom 到位即静止,抖动
   * 走 impactShakeAtFrame)。回弹幅度 = toScale 的 3–6%(2.6→2.45 实测档)。
   */
  rebound?: { frames?: number; fraction?: number };
}

/** 急推 zoom 曲线(纯函数):hold → ease-in 急推 → 回弹/静止,两端钳制。 */
export function crashZoomScaleAtFrame(frame: number, opts: CrashZoomCurveOptions): number {
  const zoomFrames = opts.zoomFrames ?? 6;
  const from = opts.fromScale ?? 1;
  const to = opts.toScale ?? 2.6;
  const hit = opts.startFrame + zoomFrames;
  if (opts.rebound) {
    const reboundFrames = opts.rebound.frames ?? 5;
    const settled = to * (1 - (opts.rebound.fraction ?? DEFAULT_REBOUND_FRACTION));
    // 2.6→2.45 实测档;回收段沿用同插值器(与上游多停靠点单调用等价)。
    return camScalarAtFrame(
      frame,
      [
        { frame: opts.startFrame, value: from },
        { frame: hit, value: to },
        { frame: hit + reboundFrames, value: settled },
      ],
      // 上游 demo:推 40→46 用 crash ease-in,过冲回收 46→51 走同插值器外段。
      VSC_CRASH_EASE_IN,
    );
  }
  return camScalarAtFrame(
    frame,
    [
      { frame: opts.startFrame, value: from },
      { frame: hit, value: to },
    ],
    VSC_CRASH_EASE_IN,
  );
}

/** 撞停震屏参数:包络 14px·e^(−t/τ),τ≈1.8f(卡片可感性判例档,>20px 读作故障)。 */
export interface ImpactShakeOptions {
  hitFrame: number;
  amplitudePx?: number;
  /** 衰减时间常数(帧),缺省 1.8。 */
  tau?: number;
}

/**
 * 撞停震屏(纯函数,无随机):到位帧起高频抖 + 指数衰减,~6f 收干后真静止。
 * 双轴频率与上游 CrashImpactReal 逐值一致(sin 3.3t / 0.7·sin(4.1t+0.9))。
 */
export function impactShakeAtFrame(
  frame: number,
  opts: ImpactShakeOptions,
): { x: number; y: number } {
  const amp = opts.amplitudePx ?? 14;
  const tau = opts.tau ?? 1.8;
  const since = frame - opts.hitFrame;
  // 上游语义:到位帧(since=0)即起抖(env 满幅,sin(0)=0 使 x=0 而 y≠0)。
  if (since < 0 || amp <= 0) return { x: 0, y: 0 };
  const env = amp * Math.exp(-since / tau);
  return {
    x: round3(env * Math.sin(since * 3.3)),
    y: round3(env * 0.7 * Math.sin(since * 4.1 + 0.9)),
  };
}

// Trim float noise so identical math yields byte-identical style strings
// (与 visual-style.ts 的 round 同纪律)。
function round3(value: number): number {
  return Math.round(value * 1e3) / 1e3;
}

// ---------------------------------------------------------------------------
// dutch-roll-to-level curves (card: references/shots/camera/tension-camera-moves.md
// 式 B @ 5ddbf521,参考实现 demos/camera/tension-camera-moves/DutchRollToLevel.tsx)
// ---------------------------------------------------------------------------

/** 斜角滚正参数:卡片默认值烧死(D4)。 */
export interface DutchRollCurveOptions {
  /** 滚正起拍帧(此前为斜置悬停期;上游 ROLL=70)。 */
  rollFrame?: number;
  /** 滚正冲程:冲过 0 到过冲点的帧数,缺省 14(卡片 14f ease-out)。 */
  pushFrames?: number;
  /** 过冲收回帧数,缺省 10(单次过冲不振荡;卡片:振荡两次以上读作弹簧玩具)。 */
  settleFrames?: number;
  /** 斜置角,缺省 -10(卡片 B 式斜置档)。 */
  tiltDeg?: number;
  /** 过冲角,缺省 +1.2(过冲即「扶正的手劲」)。 */
  overshootDeg?: number;
  /** 斜置期角度漂移幅(±deg,长周期正弦),缺省 0.8。 */
  driftAmpDeg?: number;
  /** 斜置期纵向漂移幅(px,正弦),缺省 2。 */
  driftAmpPx?: number;
  /** 防露边起点 scale / 滚正终点 scale,缺省 1.15 → 1.08。 */
  fromScale?: number;
  toScale?: number;
}

/** dutch-roll 某帧的三通道采样(rotate / 纵漂 / scale 全帧闭式,无随机)。 */
export interface DutchRollSample {
  rotateDeg: number;
  translateYPx: number;
  scale: number;
}

/**
 * 斜角滚正曲线(纯函数):斜置(tilt±drift 正弦,漂移是「悬着难受」的活感)
 * → rollFrame 起 14f ease-out(cubic) 冲过 0 到 +overshoot → 10f ease-in-out(quad)
 * 收回 0;scale 同步 1.15→1.08(inOut cubic);漂移随滚正 [roll, roll+6] 淡出。
 * 逐值对齐上游 DutchRollToLevel.tsx(测试重写上游公式逐帧核对)。
 */
export function dutchRollAtFrame(
  frame: number,
  opts: DutchRollCurveOptions = {},
): DutchRollSample {
  const roll = opts.rollFrame ?? 70;
  const pushFrames = opts.pushFrames ?? 14;
  const settleFrames = opts.settleFrames ?? 10;
  const overFrame = roll + pushFrames;
  const levelFrame = overFrame + settleFrames;
  const tilt = opts.tiltDeg ?? -10;
  const overshoot = opts.overshootDeg ?? 1.2;
  // 斜置期缓慢漂移:±0.8° 长周期正弦 + 2px 纵漂(上游 driftT = min(f, ROLL))。
  const driftT = Math.min(frame, roll);
  const driftRot = Math.sin(driftT * 0.035) * (opts.driftAmpDeg ?? 0.8);
  const driftY = Math.sin(driftT * 0.05) * (opts.driftAmpPx ?? 2);
  // 滚正期间漂移随进度淡出(上游 [ROLL, ROLL+6])。
  const driftFade = interpolate(frame, [roll, roll + 6], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  // 滚正:14f ease-out 冲过 0 到 +1.2°,再 10f ease-in-out 收回 0(上游分支逐句对齐)。
  const baseRot = frame < roll
    ? tilt
    : frame < overFrame
      ? interpolate(frame, [roll, overFrame], [tilt, overshoot], {
          easing: Easing.out(Easing.cubic),
        })
      : interpolate(frame, [overFrame, levelFrame], [overshoot, 0], {
          extrapolateRight: "clamp",
          easing: Easing.inOut(Easing.quad),
        });
  const scale = interpolate(frame, [roll, levelFrame], [opts.fromScale ?? 1.15, opts.toScale ?? 1.08], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.inOut(Easing.cubic),
  });
  return { rotateDeg: baseRot + driftRot * driftFade, translateYPx: driftY * driftFade, scale };
}

// ---------------------------------------------------------------------------
// slow-push-in curves (card: tension-camera-moves.md 式 C,
// 参考实现 demos/camera/tension-camera-moves/SlowPushIn.tsx)
// ---------------------------------------------------------------------------

/** 慢推压迫参数:卡片默认值烧死(D4)。 */
export interface SlowPushCurveOptions {
  /** 推近时长,缺省 120f(4s@30fps;顶点帧零过渡硬切语义留给转场链)。 */
  durationFrames?: number;
  /** 起点/终点 scale,缺省 1.00 → 1.14(卡片:>1.2 变成普通推镜头)。 */
  fromScale?: number;
  toScale?: number;
  /** 暗角最深处 opacity,缺省 0.5(与推近同曲线渐深,压迫感第二来源)。 */
  vignetteMax?: number;
}

/** slow-push 某帧的双通道采样(scale 与暗角同 Easing.in(quad) 曲线)。 */
export interface SlowPushSample {
  scale: number;
  vignetteOpacity: number;
}

/**
 * 慢推压迫曲线(纯函数):Easing.in(quad) 匀加速 1.00→1.14,暗角 opacity
 * 0→vignetteMax 同曲线(加速曲线是本体——匀速推读作普通 zoom)。到达
 * durationFrames 后两端钳制持住终点(硬切由转场链接棒,本曲线不含景 B)。
 */
export function slowPushAtFrame(
  frame: number,
  opts: SlowPushCurveOptions = {},
): SlowPushSample {
  const duration = opts.durationFrames ?? 120;
  // 暗景 A 的暗角渐深与推近共用同一条加速曲线(上游同一 interpolate 形状)。
  const ease = Easing.in(Easing.quad);
  return {
    scale: camScalarAtFrame(
      frame,
      [{ frame: 0, value: opts.fromScale ?? 1.0 }, { frame: duration, value: opts.toScale ?? 1.14 }],
      ease,
    ),
    vignetteOpacity: camScalarAtFrame(
      frame,
      [{ frame: 0, value: 0 }, { frame: duration, value: opts.vignetteMax ?? 0.5 }],
      ease,
    ),
  };
}

// ---------------------------------------------------------------------------
// pull-back-isolation curves (card: tension-camera-moves.md 式 D,
// 参考实现 demos/camera/tension-camera-moves/PullBackIsolation.tsx;单镜版)
// ---------------------------------------------------------------------------

/** 拉远孤立参数:卡片默认值烧死(D4)。 */
export interface PullBackCurveOptions {
  /** 后拉时长,缺省 110f(前 20f 主体仍占满画面,开场即特写无需另加 hold)。 */
  pullFrames?: number;
  /** 起点/终点 scale,缺省 2.2(怼脸特写)→ 0.62(大远景孤悬)。 */
  fromScale?: number;
  toScale?: number;
  /** 背景沉黑窗(帧),缺省 60 → 110(与后拉同步收尾)。 */
  darkStartFrame?: number;
  darkEndFrame?: number;
  /** 主体光晕淡入窗(帧),缺省 60 → 100(与沉黑同步才成立)。 */
  glowStartFrame?: number;
  glowEndFrame?: number;
  /** 光晕最深处(主卡双层白 box-shadow 的 alpha 顶),缺省 0.35。 */
  glowMax?: number;
}

/** pull-back 某帧的三通道采样(scale / 沉黑进度 / 光晕)。 */
export interface PullBackSample {
  scale: number;
  /** 沉黑进度 0→1(inOut quad):驱动背景灰 236→20 与「世界向外塌暗」。 */
  sinkT: number;
  /** 主体白光晕 alpha,0 → glowMax(60–100f 线性淡入,「只剩它」的视觉证词)。 */
  glow: number;
}

/**
 * 拉远孤立曲线(纯函数):scale 2.2→0.62 / 110f Easing.out(cubic)(开场即
 * 特写,缓后拉露全景);背景沉黑与主体光晕按卡片窗口渐变。上游多卡版另有
 * 8 张兄弟卡按距离错峰熄灭——单镜版主体=整张静图,无兄弟层,该通道剥离
 * (沉黑语义由背景色+光晕承接,见组件头改造说明)。
 */
export function pullBackAtFrame(
  frame: number,
  opts: PullBackCurveOptions = {},
): PullBackSample {
  const pullFrames = opts.pullFrames ?? 110;
  const darkStart = opts.darkStartFrame ?? 60;
  const darkEnd = opts.darkEndFrame ?? pullFrames;
  const glowStart = opts.glowStartFrame ?? 60;
  const glowEnd = opts.glowEndFrame ?? 100;
  return {
    scale: camScalarAtFrame(
      frame,
      [{ frame: 0, value: opts.fromScale ?? 2.2 }, { frame: pullFrames, value: opts.toScale ?? 0.62 }],
      Easing.out(Easing.cubic),
    ),
    sinkT: interpolate(frame, [darkStart, darkEnd], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: Easing.inOut(Easing.quad),
    }),
    glow: interpolate(frame, [glowStart, glowEnd], [0, opts.glowMax ?? 0.35], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    }),
  };
}

// ---------------------------------------------------------------------------
// drone-dive-landing curves (card: references/shots/camera/space-camera-moves.md
// 式 C @ 5ddbf521,参考实现 demos/camera/space-camera-moves/DroneDiveLanding.tsx)
// ---------------------------------------------------------------------------

/** 无人机俯冲降落参数:卡片默认值烧死(D4)。 */
export interface DroneDiveCurveOptions {
  /** 前置 hold 帧(建立上帝视角),缺省 20。 */
  diveStartFrame?: number;
  /** 主俯冲段帧数,缺省 25(越冲越快)。 */
  diveFrames?: number;
  /** 气垫段帧数,缺省 20(长尾减速,之后真静止)。 */
  landFrames?: number;
  /** 俯冲段行程占比,缺省 0.82(82/18 比例比帧数更关键——切换帧速度骤降
   *  = 气垫顶住的体感)。 */
  diveShare?: number;
  /** 俯角抬平,缺省 rotateX 72° → 0(近垂直俯角悬停 → 立正)。 */
  fromRotateXDeg?: number;
  toRotateXDeg?: number;
  /** 缩放,缺省 0.42(全景平躺)→ 1.35(hero 特写)。 */
  fromScale?: number;
  toScale?: number;
  /** 落点主体锚点(0..1 画面百分比;上游钉 hero 卡中心 (518,335)/1920×1080)。 */
  originX?: number;
  originY?: number;
  /** 起手悬停相对落点终位的像素偏移,缺省 (-186,-55)=上游 (774,485)−(960,540)
   * (页面悬在中央偏上的起手构图;终位=锚点对准画面中心)。 */
  startOffsetXPx?: number;
  startOffsetYPx?: number;
  /** 构图帧尺寸,缺省 1920×1080(composition 固定帧;组件用 useVideoConfig 覆写)。 */
  frameWidthPx?: number;
  frameHeightPx?: number;
}

/** drone-dive 某帧的全通道采样(一条 p 驱动,同一台「相机」的一次连续机动)。 */
export interface DroneDiveSample {
  /** 行程 0→1:主俯冲 in(cubic) 吃 82%,气垫 out(poly(5)) 走 18%。 */
  p: number;
  rotateXDeg: number;
  scale: number;
  translateXPx: number;
  translateYPx: number;
  /** 地面软影 opacity(俯视悬空 0.32 → 落地收干 0;p=0.8 处归零)。 */
  shadowOpacity: number;
  /** 地面软影宽(px;随 scale 张合)。 */
  shadowWidthPx: number;
}

/**
 * 单一行程曲线 p(纯函数):两段速度曲线拼一条行程——先 in(cubic) 猛加速
 * 扎下吃 diveShare,再 out(poly(5)) 气垫长尾减速走余量(Remotion 无
 * Easing.quint,写 Easing.poly(5),卡片自注的坑)。逐值对齐上游
 * DroneDiveLanding.tsx 的 pDive/pLand(测试重写上游公式逐帧核对)。
 */
export function droneDiveProgressAtFrame(
  frame: number,
  opts: DroneDiveCurveOptions = {},
): number {
  const diveStart = opts.diveStartFrame ?? 20;
  const diveFrames = opts.diveFrames ?? 25;
  const landFrames = opts.landFrames ?? 20;
  const share = opts.diveShare ?? 0.82;
  const diveEnd = diveStart + diveFrames;
  const pDive = interpolate(frame, [diveStart, diveEnd], [0, share], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.in(Easing.cubic),
  });
  const pLand = interpolate(frame, [diveEnd, diveEnd + landFrames], [0, 1 - share], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.poly(5)),
  });
  return frame < diveEnd ? pDive : share + pLand;
}

/**
 * 俯冲降落全通道采样(纯函数):rotateX / scale / translate 三轴联动全部由
 * 同一条 p 驱动(一条 p = 一台相机一次机动;分开驱动读作三个动画打架)。
 * 平移收拢:起手=锚点悬在画面中心偏上,终位=锚点对准画面中心(origin 钉死
 * 主体锚点,卡片「如 518,335」的单镜推广)。
 */
export function droneDiveAtFrame(
  frame: number,
  opts: DroneDiveCurveOptions = {},
): DroneDiveSample {
  const p = droneDiveProgressAtFrame(frame, opts);
  const width = opts.frameWidthPx ?? 1920;
  const height = opts.frameHeightPx ?? 1080;
  const originX = Math.min(1, Math.max(0, opts.originX ?? 0.5));
  const originY = Math.min(1, Math.max(0, opts.originY ?? 0.5));
  // 终位 translate:让锚点(originX/Y 百分比)正对画面中心。
  const endX = (0.5 - originX) * width;
  const endY = (0.5 - originY) * height;
  return {
    p,
    rotateXDeg: interpolate(p, [0, 1], [opts.fromRotateXDeg ?? 72, opts.toRotateXDeg ?? 0]),
    scale: interpolate(p, [0, 1], [opts.fromScale ?? 0.42, opts.toScale ?? 1.35]),
    translateXPx: interpolate(p, [0, 1], [endX + (opts.startOffsetXPx ?? -186), endX]),
    translateYPx: interpolate(p, [0, 1], [endY + (opts.startOffsetYPx ?? -55), endY]),
    shadowOpacity: interpolate(p, [0, 0.8], [0.32, 0], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    }),
    shadowWidthPx: 1300 * (0.6 + interpolate(p, [0, 1], [opts.fromScale ?? 0.42, opts.toScale ?? 1.35]) * 0.4),
  };
}
