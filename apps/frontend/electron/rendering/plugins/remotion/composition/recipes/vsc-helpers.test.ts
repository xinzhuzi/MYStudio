import { describe, expect, it } from "vitest";
import { Easing, interpolate } from "remotion";
import {
  VSC_CRASH_EASE_IN,
  camScalarAtFrame,
  crashZoomScaleAtFrame,
  dampedSettle,
  droneDiveAtFrame,
  droneDiveProgressAtFrame,
  dutchRollAtFrame,
  handheld,
  impactShakeAtFrame,
  lagged,
  mulberry32,
  pullBackAtFrame,
  seededFloat,
  shotSeed,
  slowPushAtFrame,
  velocityAt,
} from "./vsc-helpers";

// ---------------------------------------------------------------------------
// mulberry32 / shotSeed —— 种子随机(确定性渲染铁律:禁 Math.random/Date.now)
// ---------------------------------------------------------------------------

describe("mulberry32", () => {
  it("returns values in [0, 1)", () => {
    const rand = mulberry32(42);
    for (let i = 0; i < 1000; i++) {
      const v = rand();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("is deterministic: same seed → same sequence", () => {
    const a = mulberry32(123);
    const b = mulberry32(123);
    expect(Array.from({ length: 100 }, () => a())).toEqual(Array.from({ length: 100 }, () => b()));
  });

  it("different seeds → different sequences", () => {
    const a = Array.from({ length: 20 }, mulberry32(1));
    const b = Array.from({ length: 20 }, mulberry32(2));
    expect(a).not.toEqual(b);
  });

  it("no hidden state leak: interleaved instances stay on their own sequence", () => {
    const a = mulberry32(7);
    const b = mulberry32(7);
    const firstSixOfA = Array.from({ length: 6 }, () => a());
    // 交错消费 b 不影响各自序列;再取一个新实例从头重放,前 6 个值与 a 全等。
    const interleaved = [b(), a(), b(), a(), b(), a()];
    expect(interleaved).toHaveLength(6);
    const c = mulberry32(7);
    expect(Array.from({ length: 6 }, () => c())).toEqual(firstSixOfA);
  });

  it("handles edge seeds (0, negative, float, int32 bounds) without throwing", () => {
    for (const seed of [0, -1, 3.7, 2147483647, -2147483648]) {
      const v = mulberry32(seed)();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("locks reference sequences (算法数值与上游 rand.ts 等价的金样)", () => {
    // 值由本实现与上游同算法现场计算后烧入:改算法常数即红。
    expect(Array.from({ length: 4 }, mulberry32(0))).toEqual([
      0.26642920868471265, 0.0003297457005828619, 0.2232720274478197, 0.1462021479383111,
    ]);
    expect(Array.from({ length: 4 }, mulberry32(42))).toEqual([
      0.6011037519201636, 0.44829055899754167, 0.8524657934904099, 0.6697340414393693,
    ]);
    expect(Array.from({ length: 4 }, mulberry32(-7))).toEqual([
      0.43306733411736786, 0.32539576734416187, 0.5442695003002882, 0.48018999374471605,
    ]);
  });
});

describe("shotSeed", () => {
  it("is stable per (shotIndex, salt) and stable across calls", () => {
    expect(shotSeed(3, "crash-zoom-punch")).toBe(shotSeed(3, "crash-zoom-punch"));
    expect(shotSeed(3, "crash-zoom-punch")).toBe(565819840);
  });

  it("different salts / indexes → different seeds", () => {
    expect(shotSeed(3, "crash-zoom-punch")).not.toBe(shotSeed(3, "dutch-roll"));
    expect(shotSeed(0)).not.toBe(shotSeed(1));
  });

  it("returns an int32 mulberry32 can consume (edge indexes included)", () => {
    for (const seed of [shotSeed(0), shotSeed(-5), shotSeed(3, "dutch-roll")]) {
      expect(Number.isInteger(seed)).toBe(true);
      const v = mulberry32(seed)();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("seededFloat maps the first draw deterministically into [min, max)", () => {
    const min = 0.3;
    const max = 0.6;
    const expected = min + mulberry32(shotSeed(9, "salt"))() * (max - min);
    expect(seededFloat(9, "salt", min, max)).toBe(expected);
    expect(seededFloat(9, "salt", min, max)).toBeGreaterThanOrEqual(min);
    expect(seededFloat(9, "salt", min, max)).toBeLessThan(max);
  });
});

// ---------------------------------------------------------------------------
// motion signals(上游 motion.ts 等价)
// ---------------------------------------------------------------------------

describe("velocityAt", () => {
  const line = (f: number) => ({ x: 2 * f, y: -3 * f });

  it("recovers constant velocity", () => {
    const v = velocityAt(line, 10);
    expect(v.vx).toBeCloseTo(2, 10);
    expect(v.vy).toBeCloseTo(-3, 10);
    expect(v.speed).toBeCloseTo(Math.hypot(2, 3), 10);
  });

  it("direction matches atan2(vy, vx)", () => {
    expect(velocityAt(line, 10).direction).toBeCloseTo(Math.atan2(-3, 2), 10);
  });

  it("returns zero for a stationary subject", () => {
    const v = velocityAt(() => ({ x: 5, y: 5 }), 3);
    expect(v).toEqual({ vx: 0, vy: 0, speed: 0, direction: 0 });
  });

  it("is central-difference accurate for a quadratic trajectory", () => {
    expect(velocityAt((f) => ({ x: f * f, y: 0 }), 4).vx).toBeCloseTo(8, 6);
  });
});

describe("lagged", () => {
  it("samples the state function at frame − delay", () => {
    const stateAt = (f: number) => ({ f });
    expect(lagged(stateAt, 20, 4)).toEqual({ f: 16 });
    expect(lagged(stateAt, 20, 0)).toEqual({ f: 20 });
  });

  it("propagates generic types unchanged", () => {
    expect(lagged((f: number) => `t${f}`, 10, 3)).toBe("t7");
  });
});

describe("dampedSettle", () => {
  it("is zero at impact (t <= 0)", () => {
    expect(dampedSettle(0, 0.1, 0.15)).toBe(0);
    expect(dampedSettle(-5, 0.1, 0.15)).toBe(0);
  });

  it("decays to zero with time", () => {
    const peak1 = dampedSettle(2.5, 0.1, 0.15);
    expect(Math.abs(dampedSettle(42.5, 0.1, 0.15))).toBeLessThan(Math.abs(peak1) * 0.05);
  });

  it("is deterministic for same args", () => {
    expect(dampedSettle(17.3, 0.13, 0.2)).toBe(dampedSettle(17.3, 0.13, 0.2));
  });
});

// ---------------------------------------------------------------------------
// handheld(上游 shake.ts 等价)
// ---------------------------------------------------------------------------

describe("handheld", () => {
  it("returns a 3-tuple (x, y, z=0)", () => {
    const [x, y, z] = handheld(0);
    expect(typeof x).toBe("number");
    expect(typeof y).toBe("number");
    expect(z).toBe(0);
  });

  it("is deterministic and amp scales linearly", () => {
    expect(handheld(37)).toEqual(handheld(37));
    expect(handheld(10, 0.024)[0]).toBeCloseTo(handheld(10, 0.012)[0] * 2, 10);
  });

  it("stays within the layered-sine envelope", () => {
    for (let f = 0; f < 500; f++) {
      const [x, y] = handheld(f, 1);
      expect(Math.abs(x)).toBeLessThanOrEqual(1.6 + 1e-9);
      expect(Math.abs(y)).toBeLessThanOrEqual(1.5 + 1e-9);
    }
  });
});

// ---------------------------------------------------------------------------
// camScalarAtFrame(上游 Rig 逐段缓动插值的 2D 等价)
// ---------------------------------------------------------------------------

describe("camScalarAtFrame", () => {
  const keys = [
    { frame: 0, value: 10 },
    { frame: 30, value: 40 },
    { frame: 60, value: 20 },
  ];

  it("holds the endpoints outside the keyframe range", () => {
    expect(camScalarAtFrame(-5, keys)).toBe(10);
    expect(camScalarAtFrame(0, keys)).toBe(10);
    expect(camScalarAtFrame(60, keys)).toBe(20);
    expect(camScalarAtFrame(999, keys)).toBe(20);
  });

  it("hits the exact keyframe values at each key", () => {
    expect(camScalarAtFrame(30, keys)).toBe(40);
  });

  it("eases per segment with the default upstream bezier (数值=Remotion 多停靠点插值)", () => {
    const upstream = interpolate(
      17,
      [0, 30, 60],
      [10, 40, 20],
      { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.bezier(0.4, 0, 0.2, 1) },
    );
    expect(camScalarAtFrame(17, keys)).toBeCloseTo(upstream, 12);
  });

  it("accepts a custom easing (crash ease-in)", () => {
    const crashKeys = [{ frame: 0, value: 1 }, { frame: 6, value: 2.6 }];
    expect(camScalarAtFrame(0, crashKeys, VSC_CRASH_EASE_IN)).toBe(1);
    expect(camScalarAtFrame(6, crashKeys, VSC_CRASH_EASE_IN)).toBeCloseTo(2.6, 12);
    expect(camScalarAtFrame(3, crashKeys, VSC_CRASH_EASE_IN)).toBeLessThan(1.8);
  });

  it("rejects an empty keyframe list (fail-closed)", () => {
    expect(() => camScalarAtFrame(0, [])).toThrow("至少一个关键帧");
  });
});

// ---------------------------------------------------------------------------
// crash-zoom 曲线(card: crash-zoom-punch.md 参数表)
// ---------------------------------------------------------------------------

describe("crashZoomScaleAtFrame", () => {
  const opts = { startFrame: 30 };

  it("holds fromScale before the push and reaches 2.6 at the hit frame", () => {
    expect(crashZoomScaleAtFrame(0, opts)).toBe(1);
    expect(crashZoomScaleAtFrame(29, opts)).toBe(1);
    expect(crashZoomScaleAtFrame(36, opts)).toBeCloseTo(2.6, 12);
  });

  it("eases in (quad-like): midpoint of the push stays below the linear midpoint", () => {
    const mid = crashZoomScaleAtFrame(33, opts);
    expect(mid).toBeGreaterThan(1);
    expect(mid).toBeLessThan(1.8);
  });

  it("impact 款(无 rebound):hit 后真静止(不回弹)", () => {
    expect(crashZoomScaleAtFrame(36, opts)).toBeCloseTo(2.6, 12);
    expect(crashZoomScaleAtFrame(60, opts)).toBeCloseTo(2.6, 12);
    expect(crashZoomScaleAtFrame(500, opts)).toBeCloseTo(2.6, 12);
  });

  it("rebound 款:过冲后 5f 回收到 2.6×(1−fraction),数值对齐上游 demo 曲线", () => {
    // 上游 CrashZoomReal: interpolate(frame, [40,46,51], [1,2.6,2.45], crash-ease)
    // 平移到 startFrame=30 → [30,36,41]。
    const reboundOpts = { startFrame: 30, rebound: {} };
    const upstream = (f: number) =>
      interpolate(f, [30, 36, 41], [1, 2.6, 2.45], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
        easing: Easing.bezier(0.55, 0, 0.7, 1),
      });
    for (const frame of [0, 15, 30, 33, 36, 38, 41, 50, 120]) {
      expect(crashZoomScaleAtFrame(frame, reboundOpts)).toBeCloseTo(upstream(frame), 10);
    }
  });

  it("frames the whole curve deterministically (same args → same values)", () => {
    const runA = Array.from({ length: 60 }, (_, f) => crashZoomScaleAtFrame(f, { ...opts, rebound: {} }));
    const runB = Array.from({ length: 60 }, (_, f) => crashZoomScaleAtFrame(f, { ...opts, rebound: {} }));
    expect(runA).toEqual(runB);
  });
});

describe("impactShakeAtFrame", () => {
  const opts = { hitFrame: 36 };

  it("is zero before the hit frame", () => {
    expect(impactShakeAtFrame(34, opts)).toEqual({ x: 0, y: 0 });
    expect(impactShakeAtFrame(35, opts)).toEqual({ x: 0, y: 0 });
  });

  it("matches the upstream CrashImpactReal envelope 14·e^(−t/1.8) frame by frame", () => {
    for (let since = 0; since <= 8; since++) {
      const env = 14 * Math.exp(-since / 1.8);
      const got = impactShakeAtFrame(36 + since, opts);
      expect(got.x).toBeCloseTo(env * Math.sin(since * 3.3), 3);
      expect(got.y).toBeCloseTo(env * 0.7 * Math.sin(since * 4.1 + 0.9), 3);
    }
  });

  it("decays below perception after ~6 frames", () => {
    const at = (f: number) => Math.max(...Object.values(impactShakeAtFrame(f, opts)).map(Math.abs));
    expect(at(42)).toBeLessThan(1);
  });

  it("is deterministic for same args", () => {
    expect(impactShakeAtFrame(37, opts)).toEqual(impactShakeAtFrame(37, opts));
  });
});

// ---------------------------------------------------------------------------
// dutchRollAtFrame(card: tension-camera-moves.md 式 B,上游 DutchRollToLevel.tsx)
// ---------------------------------------------------------------------------

describe("dutchRollAtFrame", () => {
  it("斜置期:rotate = -10 ± 0.8° 正弦漂移 + 2px 纵漂,scale 恒 1.15", () => {
    for (let f = 0; f < 70; f++) {
      const s = dutchRollAtFrame(f);
      expect(s.rotateDeg).toBeGreaterThanOrEqual(-10.8);
      expect(s.rotateDeg).toBeLessThanOrEqual(-9.2);
      expect(s.translateYPx).toBeGreaterThanOrEqual(-2);
      expect(s.translateYPx).toBeLessThanOrEqual(2);
      expect(s.scale).toBeCloseTo(1.15, 10);
    }
  });

  it("滚正:14f 冲过 0 到 +1.2°(ease-out cubic),再 10f 收回 0,此后真静止", () => {
    // 起拍帧漂移未淡出(fade 从 ROLL 起才走),rot = -10 + sin(70·0.035)·0.8(上游同式)。
    expect(dutchRollAtFrame(70).rotateDeg).toBeCloseTo(-10 + Math.sin(70 * 0.035) * 0.8, 10);
    expect(dutchRollAtFrame(84).rotateDeg).toBeCloseTo(1.2, 6);
    expect(dutchRollAtFrame(94).rotateDeg).toBeCloseTo(0, 6);
    // 漂移已淡出(76 帧起 fade=0),滚正后角严格为 0(单次过冲不振荡)。
    expect(dutchRollAtFrame(94).rotateDeg).toBe(0);
    expect(dutchRollAtFrame(120).rotateDeg).toBe(0);
    // -0 与 0 在 Object.is 下不等(样式串里同为 "0"),用 toBeCloseTo 断真静止。
    expect(dutchRollAtFrame(76).translateYPx).toBeCloseTo(0, 12);
  });

  it("过冲只过一次:84→94 单调收回,94 后无第二次起摆", () => {
    let prev = dutchRollAtFrame(84).rotateDeg;
    for (let f = 85; f <= 94; f++) {
      const rot = dutchRollAtFrame(f).rotateDeg;
      expect(rot).toBeLessThan(prev);
      prev = rot;
    }
  });

  it("scale 同步 1.15→1.08(inOut cubic),滚正前/后两端持住", () => {
    expect(dutchRollAtFrame(0).scale).toBeCloseTo(1.15, 10);
    expect(dutchRollAtFrame(94).scale).toBeCloseTo(1.08, 10);
    expect(dutchRollAtFrame(500).scale).toBeCloseTo(1.08, 10);
  });

  it("上游等价:逐帧重写 DutchRollToLevel.tsx 公式,三通道全帧核对", () => {
    const clamp = { extrapolateLeft: "clamp" as const, extrapolateRight: "clamp" as const };
    const upstream = (f: number) => {
      const driftT = Math.min(f, 70);
      const driftRot = Math.sin(driftT * 0.035) * 0.8;
      const driftY = Math.sin(driftT * 0.05) * 2;
      const fade = interpolate(f, [70, 76], [1, 0], clamp);
      const base =
        f < 70
          ? -10
          : f < 84
            ? interpolate(f, [70, 84], [-10, 1.2], { easing: Easing.out(Easing.cubic) })
            : interpolate(f, [84, 94], [1.2, 0], {
                extrapolateRight: "clamp",
                easing: Easing.inOut(Easing.quad),
              });
      const scale = interpolate(f, [70, 94], [1.15, 1.08], {
        ...clamp,
        easing: Easing.inOut(Easing.cubic),
      });
      return { rot: base + driftRot * fade, y: driftY * fade, scale };
    };
    for (let f = 0; f <= 110; f++) {
      const got = dutchRollAtFrame(f);
      expect(got.rotateDeg).toBeCloseTo(upstream(f).rot, 12);
      expect(got.translateYPx).toBeCloseTo(upstream(f).y, 12);
      expect(got.scale).toBeCloseTo(upstream(f).scale, 12);
    }
  });

  it("is deterministic for same args", () => {
    expect(dutchRollAtFrame(83)).toEqual(dutchRollAtFrame(83));
  });
});

// ---------------------------------------------------------------------------
// slowPushAtFrame(card: tension-camera-moves.md 式 C,上游 SlowPushIn.tsx)
// ---------------------------------------------------------------------------

describe("slowPushAtFrame", () => {
  it("端点:0f=1.00(前 2 秒几乎不可察),120f=1.14,此后持住(硬切留给转场链)", () => {
    expect(slowPushAtFrame(0).scale).toBeCloseTo(1.0, 12);
    expect(slowPushAtFrame(120).scale).toBeCloseTo(1.14, 12);
    expect(slowPushAtFrame(200).scale).toBeCloseTo(1.14, 12);
  });

  it("匀加速:中点值低于线性中点(加速曲线是本体),前半程增幅 < 后半程", () => {
    const mid = slowPushAtFrame(60).scale;
    expect(mid).toBeGreaterThan(1.0);
    expect(mid).toBeLessThan(1.07); // 线性中点
    const firstHalf = slowPushAtFrame(60).scale - slowPushAtFrame(0).scale;
    const secondHalf = slowPushAtFrame(120).scale - slowPushAtFrame(60).scale;
    expect(firstHalf).toBeLessThan(secondHalf);
  });

  it("暗角与推近同曲线:0→0.5,同帧同比", () => {
    for (const f of [0, 30, 60, 90, 120, 150]) {
      const s = slowPushAtFrame(f);
      expect(s.vignetteOpacity).toBeCloseTo(((s.scale - 1.0) / 0.14) * 0.5, 10);
    }
    expect(slowPushAtFrame(120).vignetteOpacity).toBeCloseTo(0.5, 12);
  });

  it("上游等价:interpolate Easing.in(quad) 重写,全帧核对", () => {
    const clamp = { extrapolateLeft: "clamp" as const, extrapolateRight: "clamp" as const };
    for (let f = 0; f <= 130; f++) {
      const scale = interpolate(f, [0, 120], [1.0, 1.14], { ...clamp, easing: Easing.in(Easing.quad) });
      const vignette = interpolate(f, [0, 120], [0, 0.5], { ...clamp, easing: Easing.in(Easing.quad) });
      const got = slowPushAtFrame(f);
      expect(got.scale).toBeCloseTo(scale, 12);
      expect(got.vignetteOpacity).toBeCloseTo(vignette, 12);
    }
  });
});

// ---------------------------------------------------------------------------
// pullBackAtFrame(card: tension-camera-moves.md 式 D,上游 PullBackIsolation.tsx)
// ---------------------------------------------------------------------------

describe("pullBackAtFrame", () => {
  it("后拉:0f=2.2(怼脸特写)→110f=0.62(大远景孤悬),out(cubic) 前快后慢", () => {
    expect(pullBackAtFrame(0).scale).toBeCloseTo(2.2, 12);
    expect(pullBackAtFrame(110).scale).toBeCloseTo(0.62, 12);
    // out(cubic):首 1/4 行程的减幅远大于末 1/4。
    const d1 = pullBackAtFrame(0).scale - pullBackAtFrame(27).scale;
    const d2 = pullBackAtFrame(83).scale - pullBackAtFrame(110).scale;
    expect(d1).toBeGreaterThan(d2);
  });

  it("前 20f 主体仍占满画面(开场即特写不需要另加 hold)", () => {
    // out(cubic) 前快后慢:f=20 时 scale≈1.485,静图仍大于整帧(cover 不露底)。
    expect(pullBackAtFrame(20).scale).toBeGreaterThan(1.4);
    expect(pullBackAtFrame(20).scale).toBeLessThan(2.2);
  });

  it("沉黑 60→110f:灰阶 236→20 的进度曲线 inOut(quad);光晕 60→100f 线性到 0.35", () => {
    expect(pullBackAtFrame(59).sinkT).toBe(0);
    expect(pullBackAtFrame(110).sinkT).toBeCloseTo(1, 12);
    expect(pullBackAtFrame(85).sinkT).toBeCloseTo(0.5, 12);
    expect(pullBackAtFrame(59).glow).toBe(0);
    expect(pullBackAtFrame(80).glow).toBeCloseTo(0.35 * 0.5, 12);
    expect(pullBackAtFrame(100).glow).toBeCloseTo(0.35, 12);
    expect(pullBackAtFrame(150).glow).toBeCloseTo(0.35, 12);
  });

  it("上游等价:interpolate 重写后拉/沉黑/光晕三条曲线,全帧核对", () => {
    const clamp = { extrapolateLeft: "clamp" as const, extrapolateRight: "clamp" as const };
    for (let f = 0; f <= 140; f++) {
      const scale = interpolate(f, [0, 110], [2.2, 0.62], { ...clamp, easing: Easing.out(Easing.cubic) });
      const sinkT = interpolate(f, [60, 110], [0, 1], { ...clamp, easing: Easing.inOut(Easing.quad) });
      const glow = interpolate(f, [60, 100], [0, 0.35], clamp);
      const got = pullBackAtFrame(f);
      expect(got.scale).toBeCloseTo(scale, 12);
      expect(got.sinkT).toBeCloseTo(sinkT, 12);
      expect(got.glow).toBeCloseTo(glow, 12);
    }
  });

  it("110f 后三通道真静止(收尾给足静止,D 式是全片句号)", () => {
    const settled = pullBackAtFrame(111);
    expect(settled).toEqual(pullBackAtFrame(150));
  });
});

// ---------------------------------------------------------------------------
// droneDiveProgressAtFrame / droneDiveAtFrame
// (card: space-camera-moves.md 式 C,上游 DroneDiveLanding.tsx)
// ---------------------------------------------------------------------------

describe("droneDiveProgressAtFrame", () => {
  it("前置 hold:20f 前 p=0(上帝视角建立)", () => {
    expect(droneDiveProgressAtFrame(0)).toBe(0);
    expect(droneDiveProgressAtFrame(19)).toBe(0);
  });

  it("两段行程:45f(切换帧)恰为 0.82,65f 到 1,此后持住", () => {
    expect(droneDiveProgressAtFrame(45)).toBeCloseTo(0.82, 12);
    expect(droneDiveProgressAtFrame(65)).toBeCloseTo(1, 12);
    expect(droneDiveProgressAtFrame(90)).toBeCloseTo(1, 12);
  });

  it("主俯冲 in(cubic) 越冲越快;气垫 out(poly(5)) 长尾减速", () => {
    // 俯冲段末 1/3 的行程增量 > 首 1/3(ease-in)。
    const early = droneDiveProgressAtFrame(28) - droneDiveProgressAtFrame(20);
    const late = droneDiveProgressAtFrame(45) - droneDiveProgressAtFrame(37);
    expect(late).toBeGreaterThan(early);
    // 气垫段末 1/3 的行程增量 < 首 1/3(ease-out 长尾)。
    const landEarly = droneDiveProgressAtFrame(52) - droneDiveProgressAtFrame(45);
    const landLate = droneDiveProgressAtFrame(65) - droneDiveProgressAtFrame(58);
    expect(landLate).toBeLessThan(landEarly);
  });

  it("上游等价:pDive/pLand 两条 interpolate 重写,全帧核对", () => {
    const clamp = { extrapolateLeft: "clamp" as const, extrapolateRight: "clamp" as const };
    const upstream = (f: number) => {
      const pDive = interpolate(f, [20, 45], [0, 0.82], { ...clamp, easing: Easing.in(Easing.cubic) });
      const pLand = interpolate(f, [45, 65], [0, 0.18], { ...clamp, easing: Easing.out(Easing.poly(5)) });
      return f < 45 ? pDive : 0.82 + pLand;
    };
    for (let f = 0; f <= 80; f++) {
      expect(droneDiveProgressAtFrame(f)).toBeCloseTo(upstream(f), 12);
    }
  });
});

describe("droneDiveAtFrame", () => {
  it("一条 p 驱动三轴:p=0 → rotateX 72° / scale 0.42;p=1 → 0° / 1.35", () => {
    const start = droneDiveAtFrame(0);
    expect(start.rotateXDeg).toBeCloseTo(72, 12);
    expect(start.scale).toBeCloseTo(0.42, 12);
    const landed = droneDiveAtFrame(65);
    expect(landed.rotateXDeg).toBeCloseTo(0, 12);
    expect(landed.scale).toBeCloseTo(1.35, 12);
    expect(landed.p).toBeCloseTo(1, 12);
  });

  it("平移收拢:终位=锚点对准画面中心;软影随落地收干", () => {
    const landed = droneDiveAtFrame(65);
    expect(landed.translateXPx).toBeCloseTo((0.5 - 0.5) * 1920, 10);
    expect(landed.translateYPx).toBeCloseTo(0, 10);
    expect(landed.shadowOpacity).toBe(0);
    const hovering = droneDiveAtFrame(0);
    expect(hovering.shadowOpacity).toBeCloseTo(0.32, 12);
    expect(hovering.translateXPx).toBeCloseTo(-186, 8);
    expect(hovering.translateYPx).toBeCloseTo(-55, 8);
  });

  it("上游等价:锚点取 hero(518,335)/1920×1080 时三轴+软影逐帧复刻上游", () => {
    const opts = { originX: 518 / 1920, originY: 335 / 1080 };
    for (const f of [0, 10, 20, 30, 45, 55, 65, 70]) {
      const got = droneDiveAtFrame(f, opts);
      const p = droneDiveProgressAtFrame(f);
      expect(got.rotateXDeg).toBeCloseTo(interpolate(p, [0, 1], [72, 0]), 10);
      expect(got.scale).toBeCloseTo(interpolate(p, [0, 1], [0.42, 1.35]), 10);
      // 上游:tx [256, 960-518=442]、ty [150, 540-335=205]。
      expect(got.translateXPx).toBeCloseTo(interpolate(p, [0, 1], [256, 442]), 8);
      expect(got.translateYPx).toBeCloseTo(interpolate(p, [0, 1], [150, 205]), 8);
      expect(got.shadowOpacity).toBeCloseTo(interpolate(p, [0, 0.8], [0.32, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }), 10);
      expect(got.shadowWidthPx).toBeCloseTo(1300 * (0.6 + got.scale * 0.4), 8);
    }
  });

  it("65f 后真静止(全通道持住)", () => {
    expect(droneDiveAtFrame(66)).toEqual(droneDiveAtFrame(120));
  });
});
