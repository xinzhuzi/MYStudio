import { describe, expect, it } from "vitest";
import { panZoomAtFrame, panZoomProgressAtFrame } from "./pan-zoom";
import type { CompositionPanZoom } from "./composition-props";

const zoomIn: CompositionPanZoom = {
  fromScale: 1,
  toScale: 1.2,
  originX: 0.5,
  originY: 0.5,
};

describe("panZoomAtFrame", () => {
  it("holds fromScale at the first frame and toScale at the last", () => {
    expect(panZoomAtFrame(0, 61, zoomIn).scale).toBeCloseTo(1);
    expect(panZoomAtFrame(60, 61, zoomIn).scale).toBeCloseTo(1.2);
  });

  it("interpolates scale with ease-in-out cubic across the clip", () => {
    // span = 60 frames. Easing.inOut(cubic) is symmetric: the exact midpoint
    // (frame 30) still lands on the linear midpoint, while the quarter points
    // lag/lead the linear ramp (0.25 -> 0.0625, 0.75 -> 0.9375 eased progress).
    expect(panZoomAtFrame(15, 61, zoomIn).scale).toBeCloseTo(1.0125);
    expect(panZoomAtFrame(30, 61, zoomIn).scale).toBeCloseTo(1.1);
    expect(panZoomAtFrame(45, 61, zoomIn).scale).toBeCloseTo(1.1875);
  });

  it("clamps progress so frames outside the clip hold the endpoints", () => {
    expect(panZoomAtFrame(-5, 61, zoomIn).scale).toBeCloseTo(1);
    expect(panZoomAtFrame(999, 61, zoomIn).scale).toBeCloseTo(1.2);
  });

  it("keeps a single-frame clip at fromScale", () => {
    expect(panZoomAtFrame(0, 1, zoomIn).scale).toBeCloseTo(1);
  });

  it("passes origin through, clamped to 0..1", () => {
    const offOrigin: CompositionPanZoom = {
      fromScale: 1,
      toScale: 1.5,
      originX: -0.3,
      originY: 1.8,
    };
    const result = panZoomAtFrame(0, 30, offOrigin);
    expect(result.originX).toBe(0);
    expect(result.originY).toBe(1);
  });

  it("rejects a non-positive or fractional duration", () => {
    expect(() => panZoomAtFrame(0, 0, zoomIn)).toThrow("panZoom 时长必须是正整数帧");
    expect(() => panZoomAtFrame(0, 1.5, zoomIn)).toThrow("panZoom 时长必须是正整数帧");
  });

  it("explicit easing=cubic is frame-identical to the default curve", () => {
    const cubic: CompositionPanZoom = { ...zoomIn, easing: "cubic" };
    for (const frame of [0, 7, 15, 30, 45, 59, 60]) {
      expect(panZoomAtFrame(frame, 61, cubic).scale)
        .toBe(panZoomAtFrame(frame, 61, zoomIn).scale);
    }
  });

  describe("easing=spring（08-21 Remotion spring 接入）", () => {
    const springZoom: CompositionPanZoom = { ...zoomIn, easing: "spring" };

    it("starts at fromScale and lands on toScale at the last frame", () => {
      expect(panZoomAtFrame(0, 61, springZoom).scale).toBeCloseTo(1);
      // durationInFrames 归一：spring 在末帧精确到达 to=1
      expect(panZoomAtFrame(60, 61, springZoom).scale).toBeCloseTo(1.2);
    });

    it("overshoots the target mid-clip (弹性过冲) unlike the cubic curve", () => {
      // damping 14 / stiffness 100 / mass 1（ζ≈0.7）约 4-5% 过冲：
      // 1→1.2 的 zoom-in 在中段 scale 会短暂越过 1.2；cubic 曲线永不越界。
      const peak = Math.max(
        ...Array.from({ length: 61 }, (_, frame) => panZoomAtFrame(frame, 61, springZoom).scale),
      );
      expect(peak).toBeGreaterThan(1.2);
      const cubicPeak = Math.max(
        ...Array.from({ length: 61 }, (_, frame) => panZoomAtFrame(frame, 61, zoomIn).scale),
      );
      expect(cubicPeak).toBeCloseTo(1.2);
    });

    it("single-frame spring clip holds fromScale like the default", () => {
      expect(panZoomAtFrame(0, 1, springZoom).scale).toBeCloseTo(1);
    });
  });
});

// ---------------------------------------------------------------------------
// rotate 通道（10-10 vsc 配方接入）+ 旧 motion 帧级回归锁
// ---------------------------------------------------------------------------

// 旧 motion 帧级回归锁金样:2026-10-10 在 rotate 通道合入【前】对既有实现
// 逐帧采样所得（cubic/spring/非中心 origin/单帧 clip 四形态）。金样只锁
// scale/origin——rotate 通道是纯增量字段,缺席时恒 0,不得扰动以下任何一帧。
const LEGACY_FRAME_GOLDENS: Record<string, Array<[number, number, number]>> = {
  // zoomIn-cubic-61f — 61 帧
  "zoomIn-cubic-61f": [[1,0.5,0.5],[1.0000037037037037,0.5,0.5],[1.0000296296296296,0.5,0.5],[1.0001,0.5,0.5],[1.000237037037037,0.5,0.5],[1.0004629629629629,0.5,0.5],[1.0008,0.5,0.5],[1.0012703703703705,0.5,0.5],[1.0018962962962963,0.5,0.5],[1.0027,0.5,0.5],[1.0037037037037038,0.5,0.5],[1.0049296296296297,0.5,0.5],[1.0064,0.5,0.5],[1.008137037037037,0.5,0.5],[1.010162962962963,0.5,0.5],[1.0125,0.5,0.5],[1.0151703703703703,0.5,0.5],[1.0181962962962963,0.5,0.5],[1.0216,0.5,0.5],[1.0254037037037036,0.5,0.5],[1.0296296296296297,0.5,0.5],[1.0343,0.5,0.5],[1.039437037037037,0.5,0.5],[1.0450629629629629,0.5,0.5],[1.0512,0.5,0.5],[1.0578703703703705,0.5,0.5],[1.0650962962962962,0.5,0.5],[1.0729,0.5,0.5],[1.0813037037037037,0.5,0.5],[1.0903296296296296,0.5,0.5],[1.1,0.5,0.5],[1.1096703703703703,0.5,0.5],[1.1186962962962963,0.5,0.5],[1.1271,0.5,0.5],[1.1349037037037037,0.5,0.5],[1.1421296296296295,0.5,0.5],[1.1488,0.5,0.5],[1.154937037037037,0.5,0.5],[1.1605629629629628,0.5,0.5],[1.1657,0.5,0.5],[1.1703703703703703,0.5,0.5],[1.1745962962962961,0.5,0.5],[1.1784,0.5,0.5],[1.1818037037037037,0.5,0.5],[1.1848296296296297,0.5,0.5],[1.1875,0.5,0.5],[1.189837037037037,0.5,0.5],[1.191862962962963,0.5,0.5],[1.1936,0.5,0.5],[1.1950703703703702,0.5,0.5],[1.1962962962962962,0.5,0.5],[1.1973,0.5,0.5],[1.1981037037037037,0.5,0.5],[1.1987296296296295,0.5,0.5],[1.1992,0.5,0.5],[1.199537037037037,0.5,0.5],[1.199762962962963,0.5,0.5],[1.1999,0.5,0.5],[1.1999703703703704,0.5,0.5],[1.1999962962962962,0.5,0.5],[1.2,0.5,0.5]],
  // offOrigin-cubic-30f — 30 帧
  "offOrigin-cubic-30f": [[1,0.2,0.8],[1.0000820041822134,0.2,0.8],[1.0006560334577064,0.2,0.8],[1.0022141129197588,0.2,0.8],[1.0052482676616508,0.2,0.8],[1.0102505227766616,0.2,0.8],[1.0177129033580712,0.2,0.8],[1.0281274344991596,0.2,0.8],[1.0419861412932059,0.2,0.8],[1.0597810488334904,0.2,0.8],[1.0820041822132929,0.2,0.8],[1.1091475665258927,0.2,0.8],[1.1417032268645702,0.2,0.8],[1.1801631883226045,0.2,0.8],[1.2250194759932758,0.2,0.8],[1.2749805240067245,0.2,0.8],[1.3198368116773955,0.2,0.8],[1.3582967731354298,0.2,0.8],[1.3908524334741073,0.2,0.8],[1.4179958177867071,0.2,0.8],[1.4402189511665096,0.2,0.8],[1.4580138587067941,0.2,0.8],[1.4718725655008407,0.2,0.8],[1.4822870966419288,0.2,0.8],[1.4897494772233384,0.2,0.8],[1.4947517323383492,0.2,0.8],[1.4977858870802412,0.2,0.8],[1.4993439665422936,0.2,0.8],[1.4999179958177868,0.2,0.8],[1.5,0.2,0.8]],
  // zoomOut-spring-45f — 45 帧
  "zoomOut-spring-45f": [[1.8,0.35,0.65],[1.7906071420597685,0.35,0.65],[1.7651890803363517,0.35,0.65],[1.7275210244603245,0.35,0.65],[1.6809017596546578,0.35,0.65],[1.628174082997208,0.35,0.65],[1.571751483559828,0.35,0.65],[1.5136492156463057,0.35,0.65],[1.4555181844234362,0.35,0.65],[1.3986803151769351,0.35,0.65],[1.3441643091432554,0.35,0.65],[1.2927408991600204,0.35,0.65],[1.2449569067588029,0.35,0.65],[1.2011675689039265,0.35,0.65],[1.1615667479411587,0.35,0.65],[1.1262147634062762,0.35,0.65],[1.0950636903714472,0.35,0.65],[1.067980057381795,0.35,0.65],[1.0447649492793007,0.35,0.65],[1.0251715779111479,0.35,0.65],[1.0089204284724447,0.35,0.65],[0.995712122610786,0.35,0.65],[0.9852381629379051,0.35,0.65],[0.9771897386878867,0.35,0.65],[0.9712647802722181,0.35,0.65],[0.9671734526422971,0.35,0.65],[0.964642274799122,0.35,0.65],[0.9634170464906202,0.35,0.65],[0.9632647539965383,0.35,0.65],[0.9639746156932085,0.35,0.65],[0.9653584154823829,0.35,0.65],[0.9672502587247334,0.35,0.65],[0.9695058715107947,0.35,0.65],[0.97200155031541,0.35,0.65],[0.9746328556240724,0.35,0.65],[0.9773131302299575,0.35,0.65],[0.9799719107572953,0.35,0.65],[0.9825532896959779,0.35,0.65],[0.9850142749148988,0.35,0.65],[0.9873231843007602,0.35,0.65],[0.9894581048569681,0.35,0.65],[0.991405438280611,0.35,0.65],[0.9931585486812373,0.35,0.65],[0.9947165226649682,0.35,0.65],[0.9960830474220421,0.35,0.65]],
  // zoomIn-cubic-1f — 1 帧
  "zoomIn-cubic-1f": [[1,0.5,0.5]],
};

const LEGACY_GOLDEN_CONFIGS: Array<[string, CompositionPanZoom, number]> = [
  ["zoomIn-cubic-61f", zoomIn, 61],
  ["offOrigin-cubic-30f", { fromScale: 1, toScale: 1.5, originX: 0.2, originY: 0.8 }, 30],
  ["zoomOut-spring-45f", { fromScale: 1.8, toScale: 1.0, originX: 0.35, originY: 0.65, easing: "spring" }, 45],
  ["zoomIn-cubic-1f", { fromScale: 1, toScale: 2.6, originX: 0.5, originY: 0.5 }, 1],
];

describe("旧 motion 帧级回归锁（rotate 通道合入不得扰动存量）", () => {
  for (const [name, config, duration] of LEGACY_GOLDEN_CONFIGS) {
    it(`${name}: scale/origin 逐帧等于合入前金样,且 rotateDeg 恒 0`, () => {
      const golden = LEGACY_FRAME_GOLDENS[name];
      expect(golden).toHaveLength(duration);
      for (let frame = 0; frame < duration; frame++) {
        const at = panZoomAtFrame(frame, duration, config);
        expect(at.scale).toBe(golden[frame][0]);
        expect(at.originX).toBe(golden[frame][1]);
        expect(at.originY).toBe(golden[frame][2]);
        expect(at.rotateDeg).toBe(0);
      }
    });
  }

  it("旧 panZoom 经 buildVisualStyle 的样式串逐字节不变（rotate 项 round(x+0)≡round(x)）", async () => {
    const { buildVisualStyle } = await import("./visual-style");
    const transform = { x: 12.5, y: -30, scaleX: 1.5, scaleY: 0.75, rotation: -8, opacity: 0.9 };
    const style = buildVisualStyle(transform, panZoomAtFrame(17, 61, zoomIn));
    // 金样同在 rotate 通道合入前采样(2026-10-10)。
    expect(style).toEqual({
      transform: "translate(12.5px, -30px) scale(1.527294, 0.763647) rotate(-8deg)",
      opacity: 0.9,
      transformOrigin: "50% 50%",
    });
  });
});

describe("panZoomAtFrame rotate 通道", () => {
  const dutch: CompositionPanZoom = {
    fromScale: 1,
    toScale: 1.2,
    originX: 0.5,
    originY: 0.5,
    rotate: { fromDeg: -15, toDeg: 0 },
  };

  it("缺席 rotate 时恒为 0（已在回归锁全帧断言,此处锁类型缺省语义）", () => {
    expect(panZoomAtFrame(0, 30, zoomIn).rotateDeg).toBe(0);
    expect(panZoomAtFrame(29, 30, zoomIn).rotateDeg).toBe(0);
  });

  it("端点取 fromDeg/toDeg,钳制越界帧", () => {
    expect(panZoomAtFrame(0, 61, dutch).rotateDeg).toBeCloseTo(-15);
    expect(panZoomAtFrame(60, 61, dutch).rotateDeg).toBeCloseTo(0);
    expect(panZoomAtFrame(999, 61, dutch).rotateDeg).toBeCloseTo(0);
  });

  it("rotate 与 scale 同曲线:逐帧 easedProgress 相等（cubic 对称中点=线性中点）", () => {
    for (const frame of [0, 15, 30, 45, 60]) {
      const at = panZoomAtFrame(frame, 61, dutch);
      const progress = (at.scale - dutch.fromScale) / (dutch.toScale - dutch.fromScale);
      expect(at.rotateDeg).toBeCloseTo(-15 + 15 * progress, 12);
    }
    // cubic ease-in-out 的对称性:frame 30(中点)= 线性中点。
    expect(panZoomAtFrame(30, 61, dutch).rotateDeg).toBeCloseTo(-7.5);
  });

  it("spring 缓动下 rotate 同样跟随 scale 曲线（同一 easedProgress 驱动）", () => {
    const springDutch: CompositionPanZoom = { ...dutch, easing: "spring" };
    for (const frame of [0, 9, 17, 26, 35, 44, 52, 60]) {
      const at = panZoomAtFrame(frame, 61, springDutch);
      const progress = (at.scale - springDutch.fromScale) / (springDutch.toScale - springDutch.fromScale);
      expect(at.rotateDeg).toBeCloseTo(-15 + 15 * progress, 12);
    }
  });
});

describe("panZoomProgressAtFrame（10-10 批B,vsc depth 层锚进度）", () => {
  it("与 panZoomAtFrame 同 eased 进度:端点 0/1,中点=cubic 对称点", () => {
    expect(panZoomProgressAtFrame(0, 61, zoomIn)).toBeCloseTo(0);
    expect(panZoomProgressAtFrame(60, 61, zoomIn)).toBeCloseTo(1);
    // easeInOutCubic 对称:精确中点落线性中点
    expect(panZoomProgressAtFrame(30, 61, zoomIn)).toBeCloseTo(0.5);
    expect(panZoomProgressAtFrame(15, 61, zoomIn)).toBeCloseTo(0.0625);
    expect(panZoomProgressAtFrame(45, 61, zoomIn)).toBeCloseTo(0.9375);
  });

  it("出窗钳制 0..1(负帧/超帧不越界;spring 过冲同理不入层锚)", () => {
    expect(panZoomProgressAtFrame(-5, 61, zoomIn)).toBe(0);
    expect(panZoomProgressAtFrame(999, 61, zoomIn)).toBe(1);
    const springPan: CompositionPanZoom = { ...zoomIn, easing: "spring" };
    for (let frame = 0; frame <= 90; frame += 1) {
      const progress = panZoomProgressAtFrame(frame, 91, springPan);
      expect(progress).toBeGreaterThanOrEqual(0);
      expect(progress).toBeLessThanOrEqual(1);
    }
  });

  it("无 panZoom(分层锚静态 fromPx 场景)恒 0;非法时长恒 0", () => {
    expect(panZoomProgressAtFrame(10, 61, undefined)).toBe(0);
    expect(panZoomProgressAtFrame(10, 0, zoomIn)).toBe(0);
  });
});
